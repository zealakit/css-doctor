//! Quality-gate evaluation against a regression report.

use serde::{Deserialize, Serialize};

use super::compare::{RegressionReport, RegressionStatus};

/// Configurable quality-gate thresholds.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QualityGateConfig {
    pub min_score: Option<u8>,
    pub min_dimension_scores: Vec<MinDimensionScore>,
    pub max_css_size: Option<usize>,
    pub max_size_increase_percent: Option<f64>,
    pub max_new_errors: Option<usize>,
    pub max_new_warnings: Option<usize>,
    pub fail_on_regression: bool,
    pub fail_on_new_errors: bool,
    pub fail_on_new_diagnostics: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MinDimensionScore {
    pub id: crate::health::DimensionId,
    pub min_score: u8,
}

/// Result for a single quality-gate check.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateCheckResult {
    pub id: String,
    pub label: String,
    pub passed: bool,
    pub detail: String,
}

/// Aggregate gate evaluation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateEvaluation {
    pub passed: bool,
    pub results: Vec<GateCheckResult>,
    pub failure_summary: Option<String>,
}

/// Evaluates configured quality gates against a regression report.
#[must_use]
pub fn evaluate_quality_gates(
    report: &RegressionReport,
    config: &QualityGateConfig,
) -> GateEvaluation {
    let mut results = Vec::new();

    if let Some(min_score) = config.min_score {
        let current = report.current.score;
        let passed = current >= min_score;
        results.push(GateCheckResult {
            id: "minScore".into(),
            label: "Minimum Health Score".into(),
            passed,
            detail: format!("{current} >= {min_score}"),
        });
    }

    for requirement in &config.min_dimension_scores {
        let current = report
            .changes
            .dimensions
            .iter()
            .find(|dimension| dimension.id == requirement.id)
            .and_then(|dimension| dimension.current);
        let passed = current.is_some_and(|score| score >= requirement.min_score);
        let detail = match current {
            Some(score) => format!(
                "{}: {score} >= {}",
                requirement.id.as_str(),
                requirement.min_score
            ),
            None => format!(
                "{}: unavailable (required >= {})",
                requirement.id.as_str(),
                requirement.min_score
            ),
        };
        results.push(GateCheckResult {
            id: format!("minDimension.{}", requirement.id.as_str()),
            label: format!("Minimum {}", requirement.id.as_str()),
            passed,
            detail,
        });
    }

    if let Some(max_size) = config.max_css_size {
        let current = report.current.size_bytes;
        let passed = current <= max_size;
        results.push(GateCheckResult {
            id: "maxCssSize".into(),
            label: "Maximum CSS size".into(),
            passed,
            detail: format!("{current} <= {max_size}"),
        });
    }

    if let Some(max_increase) = config.max_size_increase_percent {
        let change = report.changes.css_size.change_percent;
        let passed = change.map(|value| value <= max_increase).unwrap_or(true);
        let detail = match change {
            Some(value) => format!("{value:.1}% <= {max_increase}%"),
            None => "size change unavailable".to_string(),
        };
        results.push(GateCheckResult {
            id: "maxSizeIncreasePercent".into(),
            label: "Maximum CSS growth".into(),
            passed,
            detail,
        });
    }

    if let Some(max_errors) = config.max_new_errors {
        let count = report.diagnostics.new_errors();
        let passed = count <= max_errors;
        results.push(GateCheckResult {
            id: "maxNewErrors".into(),
            label: "Maximum new errors".into(),
            passed,
            detail: format!("{count} <= {max_errors}"),
        });
    }

    if let Some(max_warnings) = config.max_new_warnings {
        let count = report.diagnostics.new_warnings();
        let passed = count <= max_warnings;
        results.push(GateCheckResult {
            id: "maxNewWarnings".into(),
            label: "Maximum new warnings".into(),
            passed,
            detail: format!("{count} <= {max_warnings}"),
        });
    }

    if config.fail_on_regression {
        let passed = !matches!(
            report.status,
            RegressionStatus::Regressed | RegressionStatus::Mixed
        );
        results.push(GateCheckResult {
            id: "failOnRegression".into(),
            label: "Fail on regression".into(),
            passed,
            detail: format!("status={:?}", report.status).to_lowercase(),
        });
    }

    if config.fail_on_new_errors {
        let count = report.diagnostics.new_errors();
        let passed = count == 0;
        results.push(GateCheckResult {
            id: "failOnNewErrors".into(),
            label: "Fail on new errors".into(),
            passed,
            detail: format!("{count} new errors"),
        });
    }

    if config.fail_on_new_diagnostics {
        let count = report.diagnostics.new.len();
        let passed = count == 0;
        results.push(GateCheckResult {
            id: "failOnNewDiagnostics".into(),
            label: "Fail on new diagnostics".into(),
            passed,
            detail: format!("{count} new diagnostics"),
        });
    }

    let failed: Vec<&GateCheckResult> = results.iter().filter(|result| !result.passed).collect();
    let passed = failed.is_empty();
    let failure_summary = if passed {
        None
    } else {
        Some(
            failed
                .iter()
                .map(|result| result.label.as_str())
                .collect::<Vec<_>>()
                .join("; "),
        )
    };

    GateEvaluation {
        passed,
        results,
        failure_summary,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::{HealthScoreConfig, evaluate_css_health};
    use crate::regression::baseline::{
        BaselineConfigSnapshot, BaselineDocument, BaselineFileEntry, BaselineGitMetadata,
        BaselineProjectMetadata,
    };
    use crate::regression::compare::{CompareOptions, compare_baselines};

    #[test]
    fn fails_on_size_growth() {
        let baseline = make_baseline(".a{color:red}", 100);
        let current = make_baseline(".a{color:red}.b{color:blue}.c{color:green}", 70);
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        let evaluation = evaluate_quality_gates(
            &report,
            &QualityGateConfig {
                max_size_increase_percent: Some(10.0),
                ..QualityGateConfig::default()
            },
        );
        assert!(!evaluation.passed);
        assert!(
            evaluation
                .results
                .iter()
                .any(|result| result.id == "maxSizeIncreasePercent" && !result.passed)
        );
    }

    #[test]
    fn passes_when_all_gates_ok() {
        let baseline = make_baseline(".a{color:red}", 90);
        let current = make_baseline(".a{color:red}", 92);
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        let evaluation = evaluate_quality_gates(
            &report,
            &QualityGateConfig {
                min_score: Some(80),
                max_new_errors: Some(0),
                ..QualityGateConfig::default()
            },
        );
        assert!(evaluation.passed);
    }

    fn make_baseline(css: &str, overall_override: u8) -> BaselineDocument {
        let report =
            evaluate_css_health(css, Some("a.css"), Some(10), &HealthScoreConfig::default())
                .unwrap();
        let mut document = BaselineDocument::from_health_report(
            &report,
            "1.0.0",
            "2026-11-04T00:00:00Z",
            BaselineConfigSnapshot::default(),
            vec![BaselineFileEntry::from_css("a.css", css, 1, 1, 1)],
            BaselineProjectMetadata::default(),
            BaselineGitMetadata::default(),
        );
        document.health.overall = overall_override;
        document.health.size_bytes = css.len();
        document
    }
}
