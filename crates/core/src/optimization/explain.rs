//! Build structured optimization explanations from pipeline metadata.

use crate::pipeline::{PipelineChunkKind, PipelineInput, PipelineOutput};
use crate::size_splitter::minify_css;

use super::model::{
    DecisionCategory, DecisionConfidence, DecisionType, OptimizationDecision, OptimizationImpact,
    OptimizationSource,
};

/// Options controlling explanation verbosity and limits.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExplainOptions {
    /// Maximum page-coverage selector decisions to emit (default 40).
    pub max_selector_decisions: usize,
    /// Include per-selector page-coverage decisions.
    pub include_selector_decisions: bool,
}

impl Default for ExplainOptions {
    fn default() -> Self {
        Self {
            max_selector_decisions: 40,
            include_selector_decisions: true,
        }
    }
}

/// Builds optimization decisions from an already-executed pipeline result.
///
/// Explanations are derived only from measured pipeline metadata and config —
/// never fabricated coverage claims.
#[must_use]
pub fn explain_pipeline(
    input: &PipelineInput,
    output: &PipelineOutput,
    options: &ExplainOptions,
) -> Vec<OptimizationDecision> {
    let mut decisions = Vec::new();
    let mut counter = 0usize;

    if input.minify {
        counter += 1;
        let minified = minify_css(&input.css_content).ok();
        let after = minified.as_ref().map(|css| css.len());
        let changed = after.is_some_and(|len| len != input.css_content.len());
        decisions.push(OptimizationDecision {
            id: format!("minify-{counter:03}"),
            category: DecisionCategory::Minification,
            decision_type: DecisionType::Minify,
            title: "Minification applied to emitted CSS".to_string(),
            explanation: "Serialized chunks use LightningCSS minify mode.".to_string(),
            reason: "Pipeline option `minify` is enabled.".to_string(),
            source: OptimizationSource {
                file: None,
                selector: None,
                line: None,
                column: None,
            },
            destination: None,
            impact: OptimizationImpact {
                bytes_before: Some(input.css_content.len()),
                bytes_after: after,
                rules_affected: None,
                selectors_affected: None,
            },
            confidence: DecisionConfidence::High,
            changed,
            related_diagnostics: Vec::new(),
            routes: Vec::new(),
        });
    }

    if !input.page_coverage.enabled {
        // no page-coverage decisions
    } else if input.page_usage.is_empty() {
        counter += 1;
        decisions.push(OptimizationDecision {
            id: format!("page-coverage-{counter:03}"),
            category: DecisionCategory::PageCoverage,
            decision_type: DecisionType::SkipIncompleteCoverage,
            title: "Page-coverage splitting skipped".to_string(),
            explanation:
                "No page usage map was provided, so selectors cannot be classified by route coverage."
                    .to_string(),
            reason: "pageUsage is empty while pageCoverage.enabled is true.".to_string(),
            source: OptimizationSource {
                file: None,
                selector: None,
                line: None,
                column: None,
            },
            destination: None,
            impact: OptimizationImpact {
                bytes_before: Some(input.css_content.len()),
                bytes_after: None,
                rules_affected: None,
                selectors_affected: None,
            },
            confidence: DecisionConfidence::High,
            changed: false,
            related_diagnostics: Vec::new(),
            routes: Vec::new(),
        });
    } else if output.page_coverage_applied {
        let force_common = normalize_force_set(&input.page_coverage.force_common);
        let total_pages = output.pages.len().max(1);
        let mut selector_emitted = 0usize;

        for stat in &output.stats {
            if !options.include_selector_decisions {
                break;
            }
            if selector_emitted >= options.max_selector_decisions {
                break;
            }

            let forced = is_forced_common(&stat.selector, &force_common);
            let routes = routes_from_target(&stat.target_chunk);

            let (decision_type, title, explanation, reason, destination, confidence, changed) =
                if forced && stat.target_chunk == "common" {
                    (
                        DecisionType::ForceCommon,
                        "Selector forced into common CSS".to_string(),
                        format!(
                            "Selector `{}` matches forceCommon configuration and stays in the shared chunk.",
                            stat.selector
                        ),
                        "User-configured forceCommon override.".to_string(),
                        Some("common".to_string()),
                        DecisionConfidence::High,
                        true,
                    )
                } else if stat.target_chunk == "dead" {
                    (
                        DecisionType::RemoveDead,
                        "Dead selector removed from output".to_string(),
                        format!(
                            "Selector `{}` matched no page classes in the supplied pageUsage map and was eliminated.",
                            stat.selector
                        ),
                        format!("Measured coverage 0/{total_pages} pages from pageUsage."),
                        None,
                        DecisionConfidence::High,
                        true,
                    )
                } else if stat.target_chunk == "common" {
                    (
                        DecisionType::MoveToCommon,
                        "Shared selector moved to common CSS".to_string(),
                        format!(
                            "Selector `{}` is used by {} of {} analyzed routes (coverage {:.1}%).",
                            stat.selector,
                            stat.page_count,
                            total_pages,
                            stat.coverage_ratio * 100.0
                        ),
                        format!(
                            "coverage_ratio {:.4} >= min_page_ratio {:.4}",
                            stat.coverage_ratio, input.page_coverage.min_page_ratio
                        ),
                        Some("common".to_string()),
                        DecisionConfidence::High,
                        true,
                    )
                } else if stat.target_chunk.starts_with("page:") {
                    (
                        DecisionType::MoveToPage,
                        "Selector assigned to page-specific CSS".to_string(),
                        format!(
                            "Selector `{}` is used by {} of {} analyzed routes and stays below the common threshold.",
                            stat.selector, stat.page_count, total_pages
                        ),
                        format!(
                            "coverage_ratio {:.4} < min_page_ratio {:.4}",
                            stat.coverage_ratio, input.page_coverage.min_page_ratio
                        ),
                        Some(stat.target_chunk.clone()),
                        DecisionConfidence::High,
                        true,
                    )
                } else {
                    continue;
                };

            counter += 1;
            selector_emitted += 1;
            decisions.push(OptimizationDecision {
                id: format!("page-coverage-{counter:03}"),
                category: DecisionCategory::PageCoverage,
                decision_type,
                title,
                explanation,
                reason,
                source: OptimizationSource {
                    file: None,
                    selector: Some(stat.selector.clone()),
                    line: None,
                    column: None,
                },
                destination,
                impact: OptimizationImpact {
                    bytes_before: None,
                    bytes_after: None,
                    rules_affected: Some(1),
                    selectors_affected: Some(1),
                },
                confidence,
                changed,
                related_diagnostics: if decision_type == DecisionType::RemoveDead {
                    vec!["dead.code".to_string()]
                } else {
                    Vec::new()
                },
                routes,
            });
        }

        if output.dead_code_count > 0 {
            counter += 1;
            decisions.push(OptimizationDecision {
                id: format!("dead-code-{counter:03}"),
                category: DecisionCategory::DeadCode,
                decision_type: DecisionType::RemoveDead,
                title: "Dead selectors eliminated".to_string(),
                explanation: format!(
                    "Removed {} dead selector occurrence(s) based on pageUsage coverage.",
                    output.dead_code_count
                ),
                reason: "Selectors with zero matching page classes were dropped from emitted CSS."
                    .to_string(),
                source: OptimizationSource {
                    file: None,
                    selector: None,
                    line: None,
                    column: None,
                },
                destination: None,
                impact: OptimizationImpact {
                    bytes_before: Some(input.css_content.len()),
                    bytes_after: Some(total_output_bytes(output)),
                    rules_affected: None,
                    selectors_affected: Some(output.dead_code_count),
                },
                confidence: DecisionConfidence::High,
                changed: true,
                related_diagnostics: vec!["dead.code".to_string()],
                routes: output.pages.clone(),
            });
        }
    }

    if output.size_budget_applied {
        let vars: Vec<_> = output
            .chunks
            .iter()
            .filter(|chunk| chunk.variables)
            .collect();
        if !vars.is_empty() {
            counter += 1;
            let bytes: usize = vars.iter().map(|chunk| chunk.size_bytes).sum();
            decisions.push(OptimizationDecision {
                id: format!("variables-{counter:03}"),
                category: DecisionCategory::VariableIsolation,
                decision_type: DecisionType::IsolateVariables,
                title: "CSS custom properties isolated".to_string(),
                explanation: format!(
                    "Extracted variable definitions into {} dedicated chunk(s) ({} bytes).",
                    vars.len(),
                    bytes
                ),
                reason: "sizeBudget.isolateVariables is enabled.".to_string(),
                source: OptimizationSource {
                    file: None,
                    selector: Some(":root / custom properties".to_string()),
                    line: None,
                    column: None,
                },
                destination: Some(vars[0].name.clone()),
                impact: OptimizationImpact {
                    bytes_before: None,
                    bytes_after: Some(bytes),
                    rules_affected: None,
                    selectors_affected: None,
                },
                confidence: DecisionConfidence::High,
                changed: true,
                related_diagnostics: Vec::new(),
                routes: Vec::new(),
            });
        }

        let split_chunks: Vec<_> = output
            .chunks
            .iter()
            .filter(|chunk| chunk.split_due_to_size || chunk.part.is_some())
            .collect();
        if !split_chunks.is_empty() {
            counter += 1;
            decisions.push(OptimizationDecision {
                id: format!("size-budget-{counter:03}"),
                category: DecisionCategory::SizeBudget,
                decision_type: DecisionType::SplitBySize,
                title: "Stylesheet split to satisfy size budget".to_string(),
                explanation: format!(
                    "Produced {} size-budget part(s); configured maxChunkSize is {} bytes.",
                    split_chunks.len(),
                    input.size_budget.max_chunk_size
                ),
                reason: "One or more logical chunks exceeded the configured byte budget."
                    .to_string(),
                source: OptimizationSource {
                    file: None,
                    selector: None,
                    line: None,
                    column: None,
                },
                destination: None,
                impact: OptimizationImpact {
                    bytes_before: Some(input.css_content.len()),
                    bytes_after: Some(total_output_bytes(output)),
                    rules_affected: None,
                    selectors_affected: None,
                },
                confidence: DecisionConfidence::High,
                changed: true,
                related_diagnostics: vec![
                    "size.large-stylesheet".to_string(),
                    "size.critical-stylesheet".to_string(),
                ],
                routes: Vec::new(),
            });
        }

        for chunk in output.chunks.iter().filter(|chunk| chunk.oversized) {
            counter += 1;
            decisions.push(OptimizationDecision {
                id: format!("size-budget-{counter:03}"),
                category: DecisionCategory::SizeBudget,
                decision_type: DecisionType::OversizedChunk,
                title: "Chunk exceeds budget and cannot be split further".to_string(),
                explanation: format!(
                    "`{}` is {} bytes; a single AST rule or block exceeds maxChunkSize {}.",
                    chunk.name, chunk.size_bytes, input.size_budget.max_chunk_size
                ),
                reason: "Size splitter only cuts between top-level rules.".to_string(),
                source: OptimizationSource {
                    file: None,
                    selector: None,
                    line: None,
                    column: None,
                },
                destination: Some(chunk.name.clone()),
                impact: OptimizationImpact {
                    bytes_before: None,
                    bytes_after: Some(chunk.size_bytes),
                    rules_affected: None,
                    selectors_affected: None,
                },
                confidence: DecisionConfidence::High,
                changed: true,
                related_diagnostics: vec!["size.heavy-rule".to_string()],
                routes: chunk.page.clone().into_iter().collect(),
            });
        }
    }

    // Summary of retained uncertain dead CSS when page coverage could not run.
    if !output.page_coverage_applied && input.page_coverage.enabled {
        counter += 1;
        decisions.push(OptimizationDecision {
            id: format!("dead-code-{counter:03}"),
            category: DecisionCategory::DeadCode,
            decision_type: DecisionType::RetainUncertain,
            title: "Potential dead rules retained".to_string(),
            explanation: "Without reliable pageUsage, unused selectors cannot be confirmed dead and are kept."
                .to_string(),
            reason: "Conservative dead-code policy when coverage metadata is incomplete."
                .to_string(),
            source: OptimizationSource {
                file: None,
                selector: None,
                line: None,
                column: None,
            },
            destination: None,
            impact: OptimizationImpact {
                bytes_before: None,
                bytes_after: None,
                rules_affected: None,
                selectors_affected: None,
            },
            confidence: DecisionConfidence::Medium,
            changed: false,
            related_diagnostics: Vec::new(),
            routes: Vec::new(),
        });
    }

    let _ = PipelineChunkKind::Common; // keep kind import used for future filters
    decisions
}

fn total_output_bytes(output: &PipelineOutput) -> usize {
    output.chunks.iter().map(|chunk| chunk.size_bytes).sum()
}

fn normalize_force_set(force_common: &[String]) -> Vec<String> {
    force_common
        .iter()
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .collect()
}

fn is_forced_common(selector: &str, force_common: &[String]) -> bool {
    let normalized = selector.trim().to_ascii_lowercase();
    let classless = normalized.trim_start_matches('.');
    force_common.iter().any(|forced| {
        forced == &normalized || forced == classless || normalized.contains(&format!(".{forced}"))
    })
}

fn routes_from_target(target: &str) -> Vec<String> {
    if let Some(rest) = target.strip_prefix("page:") {
        rest.split(',')
            .map(str::trim)
            .filter(|part| !part.is_empty())
            .map(ToOwned::to_owned)
            .collect()
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::{PageCoverageConfig, SizeBudgetConfig, optimize_css_pipeline};
    use std::collections::{HashMap, HashSet};

    #[test]
    fn explains_common_page_and_dead_selectors() {
        let input = PipelineInput {
            css_content:
                ".shared { color: red; } .home-only { color: blue; } .dead { display: none; }"
                    .into(),
            page_usage: HashMap::from([
                (
                    "home".into(),
                    HashSet::from(["shared".into(), "home-only".into()]),
                ),
                ("about".into(), HashSet::from(["shared".into()])),
            ]),
            page_coverage: PageCoverageConfig {
                enabled: true,
                min_page_ratio: 0.75,
                force_common: vec![],
            },
            size_budget: SizeBudgetConfig {
                enabled: false,
                ..SizeBudgetConfig::default()
            },
            minify: false,
        };
        let output = optimize_css_pipeline(&input).unwrap();
        let decisions = explain_pipeline(&input, &output, &ExplainOptions::default());

        assert!(
            decisions
                .iter()
                .any(|decision| decision.decision_type == DecisionType::MoveToCommon)
        );
        assert!(
            decisions
                .iter()
                .any(|decision| decision.decision_type == DecisionType::MoveToPage)
        );
        assert!(
            decisions
                .iter()
                .any(|decision| decision.decision_type == DecisionType::RemoveDead)
        );
    }

    #[test]
    fn explains_forced_common_and_incomplete_coverage() {
        let forced = PipelineInput {
            css_content: ".legacy { color: red; }".into(),
            page_usage: HashMap::from([("home".into(), HashSet::from(["other".into()]))]),
            page_coverage: PageCoverageConfig {
                enabled: true,
                min_page_ratio: 0.5,
                force_common: vec![".legacy".into()],
            },
            size_budget: SizeBudgetConfig {
                enabled: false,
                ..SizeBudgetConfig::default()
            },
            minify: false,
        };
        let output = optimize_css_pipeline(&forced).unwrap();
        let decisions = explain_pipeline(&forced, &output, &ExplainOptions::default());
        assert!(
            decisions
                .iter()
                .any(|decision| decision.decision_type == DecisionType::ForceCommon)
        );

        let incomplete = PipelineInput {
            css_content: ".a { color: red; }".into(),
            page_usage: HashMap::new(),
            page_coverage: PageCoverageConfig::default(),
            size_budget: SizeBudgetConfig {
                enabled: false,
                ..SizeBudgetConfig::default()
            },
            minify: false,
        };
        let incomplete_out = optimize_css_pipeline(&incomplete).unwrap();
        let incomplete_decisions =
            explain_pipeline(&incomplete, &incomplete_out, &ExplainOptions::default());
        assert!(
            incomplete_decisions
                .iter()
                .any(|decision| decision.decision_type == DecisionType::SkipIncompleteCoverage)
        );
    }
}
