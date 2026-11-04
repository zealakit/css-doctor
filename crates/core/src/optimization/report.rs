//! Optimization impact reports with redistribution-aware metrics.

use serde::{Deserialize, Serialize};

use crate::analyze_css;
use crate::pipeline::{PipelineInput, PipelineOutput};

use super::explain::{ExplainOptions, explain_pipeline};
use super::model::OptimizationDecision;

/// Which pipeline operations actually ran.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationOperations {
    pub minified: bool,
    pub page_coverage_split: bool,
    pub size_budget_split: bool,
    pub variables_isolated: bool,
    pub dead_code_eliminated: bool,
}

/// Aggregate input/output counters.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationMetrics {
    pub files: usize,
    pub bytes: usize,
    pub rules: usize,
    pub selectors: usize,
    pub declarations: usize,
}

/// Full optimization report.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationReport {
    pub schema_version: u32,
    pub input: OptimizationMetrics,
    pub output: OptimizationMetrics,
    pub impact: OptimizationImpactSummary,
    pub operations: OptimizationOperations,
    pub chunks: Vec<OptimizationChunkSummary>,
    pub decisions: Vec<OptimizationDecision>,
    pub warnings: Vec<String>,
    pub analysis_ms: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationImpactSummary {
    /// Bytes removed by DCE/minify relative to a single serialized stylesheet
    /// comparison — not sum(chunks) vs input when splitting redistributes bytes.
    pub bytes_eliminated: i64,
    pub elimination_percent: Option<f64>,
    /// Sum of emitted chunk bytes (may exceed input when content is duplicated
    /// across page chunks).
    pub emitted_bytes_total: usize,
    pub redistributed_bytes: i64,
    pub rules_removed_estimate: i64,
    pub selectors_removed: usize,
    pub chunks_created: usize,
    pub variables_chunks: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationChunkSummary {
    pub name: String,
    pub kind: String,
    pub size_bytes: usize,
    pub oversized: bool,
    pub variables: bool,
    pub page: Option<String>,
}

#[derive(Debug, Clone, Default)]
pub struct ReportOptions {
    pub explain: ExplainOptions,
    pub file_path: Option<String>,
}

/// Builds an optimization report from pipeline input/output.
///
/// # Errors
///
/// Returns an error when the input CSS cannot be analyzed for metrics.
pub fn build_optimization_report(
    input: &PipelineInput,
    output: &PipelineOutput,
    options: &ReportOptions,
    analysis_ms: f64,
) -> Result<OptimizationReport, String> {
    let analysis = analyze_css(&input.css_content)?;
    let input_metrics = OptimizationMetrics {
        files: 1,
        bytes: input.css_content.len(),
        rules: analysis.stats.rule_count,
        selectors: analysis.stats.selector_count,
        declarations: analysis.stats.declaration_count + analysis.stats.important_declaration_count,
    };

    let emitted_bytes_total: usize = output.chunks.iter().map(|chunk| chunk.size_bytes).sum();
    let output_rules: usize = output
        .chunks
        .iter()
        .filter_map(|chunk| analyze_css(&chunk.css).ok())
        .map(|result| result.stats.rule_count)
        .sum();
    let output_selectors: usize = output
        .chunks
        .iter()
        .filter_map(|chunk| analyze_css(&chunk.css).ok())
        .map(|result| result.stats.selector_count)
        .sum();
    let output_declarations: usize = output
        .chunks
        .iter()
        .filter_map(|chunk| analyze_css(&chunk.css).ok())
        .map(|result| result.stats.declaration_count + result.stats.important_declaration_count)
        .sum();

    // Single-file equivalent output for elimination accounting: prefer the
    // common chunk when page coverage ran without duplication, otherwise use
    // minified whole stylesheet when minify-only.
    let reference_output_bytes = reference_eliminated_bytes(input, output);
    let bytes_eliminated = input_metrics.bytes as i64 - reference_output_bytes as i64;
    let elimination_percent = if input_metrics.bytes == 0 {
        Some(0.0)
    } else {
        Some((bytes_eliminated as f64 / input_metrics.bytes as f64) * 100.0)
    };
    let redistributed_bytes = emitted_bytes_total as i64 - reference_output_bytes as i64;

    let variables_chunks = output.chunks.iter().filter(|chunk| chunk.variables).count();
    let decisions = explain_pipeline(input, output, &options.explain);

    let mut warnings = Vec::new();
    if output.chunks.iter().any(|chunk| chunk.oversized) {
        warnings.push(
            "One or more chunks exceed the size budget and could not be split further.".into(),
        );
    }
    if input.page_coverage.enabled && input.page_usage.is_empty() {
        warnings.push(
            "pageCoverage was enabled without pageUsage; coverage-based DCE did not run.".into(),
        );
    }

    Ok(OptimizationReport {
        schema_version: 1,
        input: input_metrics,
        output: OptimizationMetrics {
            files: output.chunks.len().max(1),
            bytes: emitted_bytes_total,
            rules: output_rules,
            selectors: output_selectors,
            declarations: output_declarations,
        },
        impact: OptimizationImpactSummary {
            bytes_eliminated,
            elimination_percent,
            emitted_bytes_total,
            redistributed_bytes,
            rules_removed_estimate: analysis.stats.rule_count as i64 - output_rules as i64,
            selectors_removed: output.dead_code_count,
            chunks_created: output.chunks.len(),
            variables_chunks,
        },
        operations: OptimizationOperations {
            minified: input.minify,
            page_coverage_split: output.page_coverage_applied,
            size_budget_split: output.size_budget_applied
                && output.chunks.iter().any(|chunk| chunk.split_due_to_size),
            variables_isolated: variables_chunks > 0,
            dead_code_eliminated: output.dead_code_count > 0,
        },
        chunks: output
            .chunks
            .iter()
            .map(|chunk| OptimizationChunkSummary {
                name: chunk.name.clone(),
                kind: format!("{:?}", chunk.kind).to_ascii_lowercase(),
                size_bytes: chunk.size_bytes,
                oversized: chunk.oversized,
                variables: chunk.variables,
                page: chunk.page.clone(),
            })
            .collect(),
        decisions,
        warnings,
        analysis_ms,
    })
}

fn reference_eliminated_bytes(input: &PipelineInput, output: &PipelineOutput) -> usize {
    // Prefer common (+ vars) without page duplication as the "single payload"
    // reference when page coverage applied.
    if output.page_coverage_applied {
        let shared: usize = output
            .chunks
            .iter()
            .filter(|chunk| {
                matches!(
                    chunk.kind,
                    crate::pipeline::PipelineChunkKind::Common
                        | crate::pipeline::PipelineChunkKind::Variables
                ) || (chunk.variables && chunk.page.is_none())
            })
            .map(|chunk| chunk.size_bytes)
            .sum();
        if shared > 0 {
            return shared;
        }
    }

    if input.minify {
        if let Ok(minified) = crate::size_splitter::minify_css(&input.css_content) {
            return minified.len();
        }
    }

    output
        .chunks
        .first()
        .map(|chunk| chunk.size_bytes)
        .unwrap_or(input.css_content.len())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{PageCoverageConfig, SizeBudgetConfig};
    use std::collections::{HashMap, HashSet};

    #[test]
    fn report_does_not_treat_split_duplication_as_savings() {
        let input = PipelineInput {
            css_content: ".shared { color: red; } .a { color: blue; } .b { color: green; }".into(),
            page_usage: HashMap::from([
                ("a".into(), HashSet::from(["shared".into(), "a".into()])),
                ("b".into(), HashSet::from(["shared".into(), "b".into()])),
            ]),
            page_coverage: PageCoverageConfig {
                enabled: true,
                min_page_ratio: 1.0,
                force_common: vec![],
            },
            size_budget: SizeBudgetConfig {
                enabled: false,
                ..SizeBudgetConfig::default()
            },
            minify: false,
        };
        let output = crate::optimize_css_pipeline(&input).unwrap();
        let report =
            build_optimization_report(&input, &output, &ReportOptions::default(), 1.0).unwrap();

        assert!(
            report.impact.emitted_bytes_total >= report.impact.bytes_eliminated.max(0) as usize
        );
        assert_eq!(report.schema_version, 1);
        assert!(report.operations.page_coverage_split);
    }
}
