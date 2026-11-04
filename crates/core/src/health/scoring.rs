//! Scoring math and report aggregation for CSS Health Score.

use std::collections::BTreeMap;
use std::time::Instant;

use crate::analyze_css;
use crate::model::CssAnalysisResult;

use super::config::HealthScoreConfig;
use super::dimensions::{
    AnalysisContext, analyze_dead_css, analyze_duplicate_rules, analyze_selector_complexity,
    analyze_size_efficiency, analyze_variable_consistency,
};
use super::model::{
    DimensionId, DimensionScore, HealthDiagnostic, HealthGrade, HealthReport, HealthScoreSummary,
    HealthSeverity, HealthStatus,
};

/// Input for evaluating CSS health for a single stylesheet.
#[derive(Debug, Clone)]
pub struct HealthEvaluationInput<'a> {
    pub css_content: &'a str,
    pub file_path: Option<&'a str>,
    pub size_bytes: Option<usize>,
    pub analysis: Option<&'a CssAnalysisResult>,
    pub config: &'a HealthScoreConfig,
}

/// Grades a numeric score using configured bands.
#[must_use]
pub fn grade_for_score(score: u8, config: &HealthScoreConfig) -> (HealthGrade, HealthStatus) {
    let mut bands = config.bands.clone();
    bands.sort_by_key(|band| std::cmp::Reverse(band.min_score));

    for band in bands {
        if score >= band.min_score {
            return (band.grade, band.status);
        }
    }

    (HealthGrade::F, HealthStatus::Critical)
}

/// Parses CSS (unless analysis is provided) and returns a health report.
///
/// # Errors
///
/// Returns an error when configuration is invalid or CSS cannot be parsed.
pub fn evaluate_css_health(
    css_content: &str,
    file_path: Option<&str>,
    size_bytes: Option<usize>,
    config: &HealthScoreConfig,
) -> Result<HealthReport, String> {
    config.validate()?;
    let started = Instant::now();
    let analysis = analyze_css(css_content)?;
    let mut report = evaluate_health_report(&HealthEvaluationInput {
        css_content,
        file_path,
        size_bytes,
        analysis: Some(&analysis),
        config,
    })?;
    report.summary.analysis_ms = started.elapsed().as_secs_f64() * 1_000.0;
    Ok(report)
}

/// Builds a health report from an existing analysis and raw CSS.
///
/// # Errors
///
/// Returns an error when configuration is invalid or analysis is missing when required.
pub fn evaluate_health_report(input: &HealthEvaluationInput<'_>) -> Result<HealthReport, String> {
    input.config.validate()?;

    let owned_analysis;
    let analysis = match input.analysis {
        Some(analysis) => analysis,
        None => {
            owned_analysis = analyze_css(input.css_content)?;
            &owned_analysis
        }
    };

    let size_bytes = input.size_bytes.unwrap_or(input.css_content.len());

    let ctx = AnalysisContext {
        analysis,
        css_content: input.css_content,
        size_bytes,
        file_path: input.file_path,
        thresholds: &input.config.thresholds,
    };

    let mut by_dimension: BTreeMap<DimensionId, Vec<HealthDiagnostic>> = BTreeMap::new();
    by_dimension.insert(
        DimensionId::SelectorComplexity,
        analyze_selector_complexity(&ctx),
    );
    by_dimension.insert(DimensionId::DuplicateRules, analyze_duplicate_rules(&ctx));
    by_dimension.insert(
        DimensionId::CssSizeEfficiency,
        analyze_size_efficiency(&ctx),
    );
    by_dimension.insert(DimensionId::DeadCss, analyze_dead_css(&ctx));
    by_dimension.insert(
        DimensionId::VariableConsistency,
        analyze_variable_consistency(&ctx),
    );

    dedupe_diagnostics(&mut by_dimension);

    let weight_for = |id: DimensionId| -> f64 {
        match id {
            DimensionId::SelectorComplexity => input.config.weights.selector_complexity,
            DimensionId::DuplicateRules => input.config.weights.duplicate_rules,
            DimensionId::CssSizeEfficiency => input.config.weights.css_size_efficiency,
            DimensionId::DeadCss => input.config.weights.dead_css,
            DimensionId::VariableConsistency => input.config.weights.variable_consistency,
        }
    };

    let mut dimensions = Vec::new();
    let mut weighted_total = 0.0;
    let mut weight_sum = 0.0;
    let mut all_diagnostics = Vec::new();

    for id in [
        DimensionId::SelectorComplexity,
        DimensionId::DuplicateRules,
        DimensionId::CssSizeEfficiency,
        DimensionId::DeadCss,
        DimensionId::VariableConsistency,
    ] {
        let diagnostics = by_dimension.remove(&id).unwrap_or_default();
        let weight = weight_for(id);
        let evaluated = dimension_can_evaluate(id, &ctx);
        let (score, note) = if evaluated {
            (Some(score_dimension(&diagnostics, input.config)), None)
        } else {
            (
                None,
                Some("Insufficient data to evaluate this dimension reliably.".to_string()),
            )
        };

        let error_count = count_severity(&diagnostics, HealthSeverity::Error);
        let warning_count = count_severity(&diagnostics, HealthSeverity::Warning);
        let info_count = count_severity(&diagnostics, HealthSeverity::Info);

        let recommendations = unique_remediations(&diagnostics, 3);
        let diagnostic_codes = diagnostics
            .iter()
            .map(|diagnostic| diagnostic.code.clone())
            .collect::<Vec<_>>();

        if let Some(score_value) = score {
            weighted_total += f64::from(score_value) * weight;
            weight_sum += weight;
        }

        all_diagnostics.extend(diagnostics);

        dimensions.push(DimensionScore {
            id,
            score,
            weight,
            effective_weight: 0.0,
            evaluated,
            issue_count: error_count + warning_count + info_count,
            error_count,
            warning_count,
            info_count,
            diagnostic_codes,
            recommendations,
            note,
        });
    }

    // Renormalize effective weights over evaluated dimensions.
    if weight_sum > 0.0 {
        for dimension in &mut dimensions {
            if dimension.evaluated {
                dimension.effective_weight = dimension.weight / weight_sum;
            }
        }
    }

    let overall = if weight_sum > 0.0 {
        (weighted_total / weight_sum).round().clamp(0.0, 100.0) as u8
    } else {
        0
    };

    let (grade, status) = grade_for_score(overall, input.config);

    all_diagnostics.sort_by(|left, right| {
        severity_rank(left.severity)
            .cmp(&severity_rank(right.severity))
            .then_with(|| left.code.cmp(&right.code))
            .then_with(|| {
                left.location
                    .map(|location| location.line)
                    .cmp(&right.location.map(|location| location.line))
            })
    });

    let recommendations = unique_remediations(&all_diagnostics, 5);

    let declarations =
        analysis.stats.declaration_count + analysis.stats.important_declaration_count;

    Ok(HealthReport {
        schema_version: 1,
        overall,
        grade,
        status,
        dimensions,
        summary: HealthScoreSummary {
            files: 1,
            rules: analysis.stats.rule_count,
            selectors: analysis.stats.selector_count,
            declarations,
            size_bytes,
            errors: count_severity(&all_diagnostics, HealthSeverity::Error),
            warnings: count_severity(&all_diagnostics, HealthSeverity::Warning),
            suggestions: count_severity(&all_diagnostics, HealthSeverity::Info),
            analysis_ms: 0.0,
        },
        diagnostics: all_diagnostics,
        recommendations,
    })
}

/// Merges multiple per-file health reports into one aggregate report.
#[must_use]
pub fn merge_health_reports(reports: &[HealthReport], config: &HealthScoreConfig) -> HealthReport {
    if reports.is_empty() {
        let (grade, status) = grade_for_score(100, config);
        return HealthReport {
            schema_version: 1,
            overall: 100,
            grade,
            status,
            dimensions: default_perfect_dimensions(config),
            summary: HealthScoreSummary::default(),
            diagnostics: Vec::new(),
            recommendations: Vec::new(),
        };
    }

    if reports.len() == 1 {
        return reports[0].clone();
    }

    let mut diagnostics = Vec::new();
    let mut summary = HealthScoreSummary::default();

    for report in reports {
        diagnostics.extend(report.diagnostics.iter().cloned());
        summary.files += report.summary.files.max(1);
        summary.rules += report.summary.rules;
        summary.selectors += report.summary.selectors;
        summary.declarations += report.summary.declarations;
        summary.size_bytes += report.summary.size_bytes;
        summary.analysis_ms += report.summary.analysis_ms;
    }

    diagnostics.sort_by(|left, right| {
        severity_rank(left.severity)
            .cmp(&severity_rank(right.severity))
            .then_with(|| left.code.cmp(&right.code))
    });

    // Re-score dimensions from merged diagnostics so multi-file runs stay consistent.
    let mut by_dimension: BTreeMap<DimensionId, Vec<HealthDiagnostic>> = BTreeMap::new();
    for diagnostic in &diagnostics {
        by_dimension
            .entry(diagnostic.category)
            .or_default()
            .push(diagnostic.clone());
    }

    let weight_for = |id: DimensionId| -> f64 {
        match id {
            DimensionId::SelectorComplexity => config.weights.selector_complexity,
            DimensionId::DuplicateRules => config.weights.duplicate_rules,
            DimensionId::CssSizeEfficiency => config.weights.css_size_efficiency,
            DimensionId::DeadCss => config.weights.dead_css,
            DimensionId::VariableConsistency => config.weights.variable_consistency,
        }
    };

    let mut dimensions = Vec::new();
    let mut weighted_total = 0.0;
    let mut weight_sum = 0.0;

    for id in [
        DimensionId::SelectorComplexity,
        DimensionId::DuplicateRules,
        DimensionId::CssSizeEfficiency,
        DimensionId::DeadCss,
        DimensionId::VariableConsistency,
    ] {
        let dimension_diagnostics = by_dimension.remove(&id).unwrap_or_default();
        let weight = weight_for(id);
        let score = score_dimension(&dimension_diagnostics, config);
        weighted_total += f64::from(score) * weight;
        weight_sum += weight;

        let error_count = count_severity(&dimension_diagnostics, HealthSeverity::Error);
        let warning_count = count_severity(&dimension_diagnostics, HealthSeverity::Warning);
        let info_count = count_severity(&dimension_diagnostics, HealthSeverity::Info);

        dimensions.push(DimensionScore {
            id,
            score: Some(score),
            weight,
            effective_weight: 0.0,
            evaluated: true,
            issue_count: error_count + warning_count + info_count,
            error_count,
            warning_count,
            info_count,
            diagnostic_codes: dimension_diagnostics
                .iter()
                .map(|diagnostic| diagnostic.code.clone())
                .collect(),
            recommendations: unique_remediations(&dimension_diagnostics, 3),
            note: None,
        });
    }

    if weight_sum > 0.0 {
        for dimension in &mut dimensions {
            dimension.effective_weight = dimension.weight / weight_sum;
        }
    }

    let overall = if weight_sum > 0.0 {
        (weighted_total / weight_sum).round().clamp(0.0, 100.0) as u8
    } else {
        0
    };
    let (grade, status) = grade_for_score(overall, config);

    summary.errors = count_severity(&diagnostics, HealthSeverity::Error);
    summary.warnings = count_severity(&diagnostics, HealthSeverity::Warning);
    summary.suggestions = count_severity(&diagnostics, HealthSeverity::Info);

    HealthReport {
        schema_version: 1,
        overall,
        grade,
        status,
        dimensions,
        summary,
        recommendations: unique_remediations(&diagnostics, 5),
        diagnostics,
    }
}

fn default_perfect_dimensions(config: &HealthScoreConfig) -> Vec<DimensionScore> {
    let ids = [
        (
            DimensionId::SelectorComplexity,
            config.weights.selector_complexity,
        ),
        (DimensionId::DuplicateRules, config.weights.duplicate_rules),
        (
            DimensionId::CssSizeEfficiency,
            config.weights.css_size_efficiency,
        ),
        (DimensionId::DeadCss, config.weights.dead_css),
        (
            DimensionId::VariableConsistency,
            config.weights.variable_consistency,
        ),
    ];

    let weight_sum: f64 = ids.iter().map(|(_, weight)| *weight).sum();

    ids.into_iter()
        .map(|(id, weight)| DimensionScore {
            id,
            score: Some(100),
            weight,
            effective_weight: if weight_sum > 0.0 {
                weight / weight_sum
            } else {
                0.0
            },
            evaluated: true,
            issue_count: 0,
            error_count: 0,
            warning_count: 0,
            info_count: 0,
            diagnostic_codes: Vec::new(),
            recommendations: Vec::new(),
            note: None,
        })
        .collect()
}

fn dimension_can_evaluate(id: DimensionId, ctx: &AnalysisContext<'_>) -> bool {
    match id {
        DimensionId::CssSizeEfficiency => ctx.size_bytes > 0 || !ctx.analysis.rules.is_empty(),
        DimensionId::VariableConsistency => true,
        DimensionId::SelectorComplexity | DimensionId::DuplicateRules | DimensionId::DeadCss => {
            true
        }
    }
}

fn score_dimension(diagnostics: &[HealthDiagnostic], config: &HealthScoreConfig) -> u8 {
    if diagnostics.is_empty() {
        return 100;
    }

    let mut penalties: Vec<f64> = diagnostics
        .iter()
        .map(|diagnostic| match diagnostic.severity {
            HealthSeverity::Error => config.error_penalty,
            HealthSeverity::Warning => config.warning_penalty,
            HealthSeverity::Info => config.info_penalty,
        })
        .collect();

    penalties.sort_by(|left, right| right.partial_cmp(left).unwrap_or(std::cmp::Ordering::Equal));

    let mut total = 0.0;
    let mut factor = 1.0;
    for penalty in penalties {
        total += penalty * factor;
        factor *= config.penalty_decay;
    }

    total = total.min(config.max_dimension_penalty);
    (100.0 - total).round().clamp(0.0, 100.0) as u8
}

fn count_severity(diagnostics: &[HealthDiagnostic], severity: HealthSeverity) -> usize {
    diagnostics
        .iter()
        .filter(|diagnostic| diagnostic.severity == severity)
        .count()
}

fn severity_rank(severity: HealthSeverity) -> u8 {
    match severity {
        HealthSeverity::Error => 0,
        HealthSeverity::Warning => 1,
        HealthSeverity::Info => 2,
    }
}

fn unique_remediations(diagnostics: &[HealthDiagnostic], limit: usize) -> Vec<String> {
    let mut seen = std::collections::BTreeSet::new();
    let mut recommendations = Vec::new();

    for diagnostic in diagnostics {
        if seen.insert(diagnostic.remediation.clone()) {
            recommendations.push(diagnostic.remediation.clone());
        }
        if recommendations.len() >= limit {
            break;
        }
    }

    recommendations
}

fn dedupe_diagnostics(by_dimension: &mut BTreeMap<DimensionId, Vec<HealthDiagnostic>>) {
    for diagnostics in by_dimension.values_mut() {
        let mut seen = std::collections::BTreeSet::new();
        diagnostics.retain(|diagnostic| {
            let key = (
                diagnostic.code.clone(),
                diagnostic.selector.clone(),
                diagnostic
                    .location
                    .map(|location| (location.line, location.column)),
                diagnostic.message.clone(),
            );
            seen.insert(key)
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::HealthScoreConfig;

    #[test]
    fn perfect_stylesheet_scores_100() {
        let config = HealthScoreConfig::default();
        let report = evaluate_css_health(
            ".card { color: red; } .title { font-weight: bold; }",
            Some("ok.css"),
            Some(40),
            &config,
        )
        .expect("health succeeds");

        assert_eq!(report.overall, 100);
        assert_eq!(report.grade, HealthGrade::A);
        assert!(report.diagnostics.is_empty());
        assert!(
            report
                .dimensions
                .iter()
                .all(|dimension| dimension.score == Some(100))
        );
    }

    #[test]
    fn empty_rules_penalize_dead_css_dimension() {
        let config = HealthScoreConfig::default();
        let report = evaluate_css_health(".dead { } .ok { color: blue; }", None, None, &config)
            .expect("health succeeds");

        let dead = report
            .dimensions
            .iter()
            .find(|dimension| dimension.id == DimensionId::DeadCss)
            .expect("dead dimension");
        assert!(dead.score.unwrap() < 100);
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "dead.empty-rule")
        );
        assert!(report.overall < 100);
    }

    #[test]
    fn high_specificity_penalizes_complexity() {
        let config = HealthScoreConfig::default();
        let report = evaluate_css_health(
            "#app .wrap .box .inner .button { color: red; }",
            None,
            None,
            &config,
        )
        .expect("health succeeds");

        let complexity = report
            .dimensions
            .iter()
            .find(|dimension| dimension.id == DimensionId::SelectorComplexity)
            .expect("complexity");
        assert!(complexity.score.unwrap() < 100);
    }

    #[test]
    fn duplicate_selectors_are_reported() {
        let config = HealthScoreConfig::default();
        let report = evaluate_css_health(
            ".box { color: red; } .box { margin: 0; }",
            Some("dup.css"),
            None,
            &config,
        )
        .expect("health succeeds");

        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "duplicate.selector")
        );
    }

    #[test]
    fn grade_boundaries_match_bands() {
        let config = HealthScoreConfig::default();
        assert_eq!(grade_for_score(90, &config).0, HealthGrade::A);
        assert_eq!(grade_for_score(89, &config).0, HealthGrade::B);
        assert_eq!(grade_for_score(70, &config).0, HealthGrade::C);
        assert_eq!(grade_for_score(60, &config).0, HealthGrade::D);
        assert_eq!(grade_for_score(59, &config).0, HealthGrade::F);
    }

    #[test]
    fn weighted_average_uses_dimension_weights() {
        let mut config = HealthScoreConfig::default();
        config.weights.dead_css = 1.0;
        config.weights.selector_complexity = 0.0;
        config.weights.duplicate_rules = 0.0;
        config.weights.css_size_efficiency = 0.0;
        config.weights.variable_consistency = 0.0;

        let report = evaluate_css_health(".dead { }", None, Some(10), &config).expect("ok");
        let dead = report
            .dimensions
            .iter()
            .find(|dimension| dimension.id == DimensionId::DeadCss)
            .unwrap()
            .score
            .unwrap();
        assert_eq!(report.overall, dead);
    }

    #[test]
    fn unused_custom_property_is_heuristic() {
        let config = HealthScoreConfig::default();
        let report = evaluate_css_health(
            ":root { --brand: red; --space: 4px; } .a { color: var(--brand); }",
            None,
            None,
            &config,
        )
        .expect("ok");

        let unused = report
            .diagnostics
            .iter()
            .find(|diagnostic| diagnostic.code == "variable.unused-definition")
            .expect("unused var");
        assert!(unused.message.contains("--space") || unused.message.contains("space"));
        assert_eq!(
            unused.certainty,
            crate::health::DiagnosticCertainty::Heuristic
        );
    }

    #[test]
    fn merge_reports_aggregates_files() {
        let config = HealthScoreConfig::default();
        let first =
            evaluate_css_health(".a { color: red; }", Some("a.css"), Some(20), &config).unwrap();
        let second = evaluate_css_health(".dead { }", Some("b.css"), Some(10), &config).unwrap();
        let merged = merge_health_reports(&[first, second], &config);
        assert_eq!(merged.summary.files, 2);
        assert!(merged.overall < 100);
    }

    #[test]
    fn rejects_invalid_weights() {
        let mut config = HealthScoreConfig::default();
        config.weights.dead_css = f64::NAN;
        let error = evaluate_css_health(".a{}", None, None, &config).expect_err("invalid");
        assert!(error.contains("weight"));
    }
}
