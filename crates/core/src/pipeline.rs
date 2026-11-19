//! Two-tier CSS optimization pipeline.
//!
//! Tier 1 performs semantic page-coverage splitting and dead-code removal.
//! Tier 2 enforces a byte budget and can isolate CSS variables into a separate
//! stylesheet. Either tier can be enabled independently.

use std::collections::{BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use crate::size_splitter::{SizeSplitterConfig, split_css_by_size};
use crate::splitter::{ChunkConfig, MatchingMode, SelectorStat, SplitInput, split_css_by_pages};

/// Configuration for tier 1 (semantic page-coverage splitting).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PageCoverageConfig {
    /// Enable semantic splitting. Defaults to `true`.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Minimum page coverage for the common chunk. Defaults to `0.5`.
    #[serde(default = "default_min_page_ratio")]
    pub min_page_ratio: f32,
    /// Selectors or classes that always stay in the common chunk.
    #[serde(default)]
    pub force_common: Vec<String>,
    /// Class matching strictness. Defaults to conservative (any class).
    #[serde(default)]
    pub matching: MatchingMode,
}

impl Default for PageCoverageConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            min_page_ratio: default_min_page_ratio(),
            force_common: Vec::new(),
            matching: MatchingMode::Conservative,
        }
    }
}

/// Configuration for tier 2 (physical size budget).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeBudgetConfig {
    /// Enable size-budget splitting. Defaults to `true`.
    #[serde(default = "default_true")]
    pub enabled: bool,
    /// Maximum serialized bytes per body chunk. Defaults to 60 KiB.
    #[serde(default = "default_max_chunk_size")]
    pub max_chunk_size: usize,
    /// Extract `:root`/`:host`, `@property`, `@custom-media`, `@theme`, and
    /// custom declarations before splitting. Defaults to `true`.
    #[serde(default = "default_true")]
    pub isolate_variables: bool,
}

impl Default for SizeBudgetConfig {
    fn default() -> Self {
        Self {
            enabled: true,
            max_chunk_size: default_max_chunk_size(),
            isolate_variables: true,
        }
    }
}

const fn default_true() -> bool {
    true
}

const fn default_min_page_ratio() -> f32 {
    0.5
}

const fn default_max_chunk_size() -> usize {
    60 * 1024
}

/// Input for [`optimize_css_pipeline`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineInput {
    /// Original CSS source.
    pub css_content: String,
    /// Map of page/route name to CSS classes used by that page.
    pub page_usage: HashMap<String, HashSet<String>>,
    /// Tier 1 configuration.
    #[serde(default)]
    pub page_coverage: PageCoverageConfig,
    /// Tier 2 configuration.
    #[serde(default)]
    pub size_budget: SizeBudgetConfig,
    /// Minify serialized output. Defaults to `true`.
    #[serde(default = "default_true")]
    pub minify: bool,
}

/// The stage that produced a chunk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PipelineChunkKind {
    /// Shared/common rules.
    Common,
    /// Page-specific rules.
    Page,
    /// Isolated CSS variables.
    Variables,
    /// A size-budget part.
    Part,
}

/// One CSS output chunk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineChunk {
    /// Logical file-stem, e.g. `common`, `page-home`, `common-vars`,
    /// `common-part-1`.
    pub name: String,
    /// Base logical chunk before physical splitting, e.g. `common` or
    /// `page-home`.
    pub source_chunk: String,
    /// Serialized CSS.
    pub css: String,
    /// Stage/kind of this chunk.
    pub kind: PipelineChunkKind,
    /// Page that owns this chunk, when applicable.
    pub page: Option<String>,
    /// Whether this chunk contains isolated CSS variables.
    pub variables: bool,
    /// 1-based part index when the chunk came from size splitting.
    pub part: Option<u32>,
    /// Serialized byte size.
    pub size_bytes: usize,
    /// True when this chunk exceeds the configured budget and cannot be split
    /// further without cutting an AST rule.
    pub oversized: bool,
    /// True when this chunk exists because the source chunk exceeded the
    /// budget.
    pub split_due_to_size: bool,
}

/// Result of the two-tier pipeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PipelineOutput {
    /// Final chunks in load order (variables before body parts).
    pub chunks: Vec<PipelineChunk>,
    /// Selector usage matrix from tier 1. Empty when tier 1 is disabled.
    pub stats: Vec<SelectorStat>,
    /// Dead selector occurrences removed by tier 1.
    pub dead_code_count: usize,
    /// Pages discovered from `page_usage`.
    pub pages: Vec<String>,
    /// Whether page-coverage splitting actually ran.
    pub page_coverage_applied: bool,
    /// Whether size-budget processing was enabled.
    pub size_budget_applied: bool,
}

/// Runs the two-tier CSS optimization pipeline.
///
/// # Errors
///
/// Returns an error for invalid configuration, malformed CSS, or AST
/// serialization failures.
pub fn optimize_css_pipeline(input: &PipelineInput) -> Result<PipelineOutput, String> {
    validate_page_coverage(&input.page_coverage)?;

    if input.size_budget.enabled && input.size_budget.max_chunk_size == 0 {
        return Err("max_chunk_size must be greater than zero".to_string());
    }

    let pages: Vec<String> = input.page_usage.keys().cloned().collect();
    let pages = {
        let mut sorted = pages;
        sorted.sort();
        sorted
    };

    let mut chunks = Vec::new();
    let mut stats = Vec::new();
    let mut dead_code_count = 0;
    let mut page_coverage_applied = false;
    let mut used_names = BTreeSet::from(["common".to_string()]);

    if input.page_coverage.enabled && !pages.is_empty() {
        page_coverage_applied = true;

        let split = split_css_by_pages(&SplitInput {
            css_content: input.css_content.clone(),
            page_usage: input.page_usage.clone(),
            config: ChunkConfig {
                min_page_ratio: input.page_coverage.min_page_ratio,
                force_common_selectors: input.page_coverage.force_common.clone(),
                minify: input.minify,
                matching: input.page_coverage.matching,
            },
        })?;

        stats = split.stats;
        dead_code_count = split.dead_code_count;

        append_size_chunks(
            &mut chunks,
            "common",
            &split.common_css,
            PipelineChunkKind::Common,
            None,
            &input.size_budget,
            input.minify,
        )?;

        for page in &pages {
            let Some(css) = split.page_chunks.get(page) else {
                continue;
            };

            let base = unique_page_name(page, &mut used_names);
            append_size_chunks(
                &mut chunks,
                &base,
                css,
                PipelineChunkKind::Page,
                Some(page.clone()),
                &input.size_budget,
                input.minify,
            )?;
        }
    } else {
        append_size_chunks(
            &mut chunks,
            "common",
            &input.css_content,
            PipelineChunkKind::Common,
            None,
            &input.size_budget,
            input.minify,
        )?;
    }

    Ok(PipelineOutput {
        chunks,
        stats,
        dead_code_count,
        pages,
        page_coverage_applied,
        size_budget_applied: input.size_budget.enabled,
    })
}

fn validate_page_coverage(config: &PageCoverageConfig) -> Result<(), String> {
    if config.enabled
        && (!config.min_page_ratio.is_finite() || !(0.0..=1.0).contains(&config.min_page_ratio))
    {
        return Err("min_page_ratio must be a finite number between 0 and 1".to_string());
    }

    Ok(())
}

fn append_size_chunks(
    chunks: &mut Vec<PipelineChunk>,
    base_name: &str,
    css: &str,
    base_kind: PipelineChunkKind,
    page: Option<String>,
    config: &SizeBudgetConfig,
    minify: bool,
) -> Result<(), String> {
    if css.trim().is_empty() {
        return Ok(());
    }

    if !config.enabled {
        let css = if minify {
            crate::size_splitter::minify_css(css)?
        } else {
            css.to_string()
        };

        let size_bytes = css.len();

        chunks.push(PipelineChunk {
            name: base_name.to_string(),
            source_chunk: base_name.to_string(),
            css,
            kind: base_kind,
            page,
            variables: false,
            part: None,
            size_bytes,
            oversized: false,
            split_due_to_size: false,
        });
        return Ok(());
    }

    let output = split_css_by_size(
        css,
        &SizeSplitterConfig {
            max_chunk_size: config.max_chunk_size,
            isolate_variables: config.isolate_variables,
            minify,
        },
    )?;

    if !output.split {
        chunks.push(PipelineChunk {
            name: base_name.to_string(),
            source_chunk: base_name.to_string(),
            css: output.chunks.into_iter().next().unwrap_or_default(),
            kind: base_kind,
            page,
            variables: false,
            part: None,
            size_bytes: css.len(),
            oversized: false,
            split_due_to_size: false,
        });
        return Ok(());
    }

    if !output.variables_css.is_empty() {
        chunks.push(PipelineChunk {
            name: format!("{base_name}-vars"),
            source_chunk: base_name.to_string(),
            css: output.variables_css.clone(),
            kind: PipelineChunkKind::Variables,
            page: page.clone(),
            variables: true,
            part: None,
            size_bytes: output.variables_css.len(),
            oversized: output.variables_css.len() > config.max_chunk_size,
            split_due_to_size: true,
        });
    }

    for (index, part_css) in output.chunks.into_iter().enumerate() {
        let part = u32::try_from(index + 1).unwrap_or(u32::MAX);
        chunks.push(PipelineChunk {
            name: format!("{base_name}-part-{part}"),
            source_chunk: base_name.to_string(),
            size_bytes: part_css.len(),
            oversized: part_css.len() > config.max_chunk_size,
            css: part_css,
            kind: PipelineChunkKind::Part,
            page: page.clone(),
            variables: false,
            part: Some(part),
            split_due_to_size: true,
        });
    }

    Ok(())
}

fn unique_page_name(page: &str, used_names: &mut BTreeSet<String>) -> String {
    let safe = sanitize_page_name(page);
    let mut name = format!("page-{safe}");
    let mut index = 2;

    while used_names.contains(&name) {
        name = format!("page-{safe}-{index}");
        index += 1;
    }

    used_names.insert(name.clone());
    name
}

fn sanitize_page_name(page: &str) -> String {
    let mut result = String::new();
    let mut previous_dash = false;

    for character in page.chars() {
        let normalized = character.to_ascii_lowercase();

        if normalized.is_ascii_alphanumeric() || normalized == '_' {
            result.push(normalized);
            previous_dash = false;
        } else if !previous_dash {
            result.push('-');
            previous_dash = true;
        }
    }

    let trimmed = result.trim_matches('-');
    if trimmed.is_empty() {
        "index".to_string()
    } else {
        trimmed.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pages(entries: &[(&str, &[&str])]) -> HashMap<String, HashSet<String>> {
        entries
            .iter()
            .map(|(page, classes)| {
                (
                    (*page).to_string(),
                    classes.iter().map(|class| (*class).to_string()).collect(),
                )
            })
            .collect()
    }

    #[test]
    fn runs_page_coverage_without_size_budget() {
        let output = optimize_css_pipeline(&PipelineInput {
            css_content: ".shared { color: red; } .home { color: blue; } .dead { display: none; }"
                .to_string(),
            page_usage: pages(&[
                ("home", &["shared", "home"]),
                ("about", &["shared"]),
                ("contact", &["shared"]),
            ]),
            page_coverage: PageCoverageConfig {
                enabled: true,
                min_page_ratio: 0.5,
                force_common: Vec::new(),
                matching: Default::default(),
            },
            size_budget: SizeBudgetConfig {
                enabled: false,
                max_chunk_size: 60 * 1024,
                isolate_variables: true,
            },
            minify: false,
        })
        .expect("pipeline succeeds");

        assert!(output.page_coverage_applied);
        assert!(!output.size_budget_applied);
        assert_eq!(output.dead_code_count, 1);
        assert!(output.chunks.iter().any(|chunk| chunk.name == "common"));
        assert!(output.chunks.iter().any(|chunk| chunk.name == "page-home"));
        assert!(
            !output
                .chunks
                .iter()
                .any(|chunk| chunk.css.contains(".dead"))
        );
    }

    #[test]
    fn runs_size_budget_without_page_coverage() {
        let output = optimize_css_pipeline(&PipelineInput {
            css_content: r#"
                :root { --brand: red; }
                .a { color: var(--brand); }
                .b { padding: 1rem; }
                .c { margin: 2rem; }
            "#
            .to_string(),
            page_usage: pages(&[("home", &["a"])]),
            page_coverage: PageCoverageConfig {
                enabled: false,
                ..PageCoverageConfig::default()
            },
            size_budget: SizeBudgetConfig {
                enabled: true,
                max_chunk_size: 80,
                isolate_variables: true,
            },
            minify: false,
        })
        .expect("pipeline succeeds");

        assert!(!output.page_coverage_applied);
        assert!(output.size_budget_applied);
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.kind == PipelineChunkKind::Variables)
        );
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.kind == PipelineChunkKind::Part)
        );
        assert!(
            output
                .chunks
                .iter()
                .all(|chunk| !chunk.variables || chunk.css.contains("--brand"))
        );
    }

    #[test]
    fn disables_both_tiers() {
        let css = ".a { color: red; }";
        let output = optimize_css_pipeline(&PipelineInput {
            css_content: css.to_string(),
            page_usage: HashMap::new(),
            page_coverage: PageCoverageConfig {
                enabled: false,
                ..PageCoverageConfig::default()
            },
            size_budget: SizeBudgetConfig {
                enabled: false,
                ..SizeBudgetConfig::default()
            },
            minify: false,
        })
        .expect("pipeline succeeds");

        assert_eq!(output.chunks.len(), 1);
        assert_eq!(output.chunks[0].css, css);
        assert!(!output.chunks[0].split_due_to_size);
    }

    #[test]
    fn rejects_invalid_size_budget() {
        let error = optimize_css_pipeline(&PipelineInput {
            css_content: String::new(),
            page_usage: HashMap::new(),
            page_coverage: PageCoverageConfig::default(),
            size_budget: SizeBudgetConfig {
                enabled: true,
                max_chunk_size: 0,
                isolate_variables: true,
            },
            minify: false,
        })
        .expect_err("invalid budget fails");

        assert!(error.contains("max_chunk_size"));
    }

    #[test]
    fn sanitizes_page_names() {
        assert_eq!(sanitize_page_name("/About Us"), "about-us");
        assert_eq!(sanitize_page_name(""), "index");
    }
    #[test]
    fn applies_page_coverage_then_size_budget() {
        let output = optimize_css_pipeline(&PipelineInput {
            css_content: r#"
                :root { --brand: red; }
                .shared { color: var(--brand); }
                .home { color: blue; }
                .about { color: green; }
                .contact { color: orange; }
                .dead { display: none; }
            "#
            .to_string(),
            page_usage: pages(&[
                ("home", &["shared", "home"]),
                ("about", &["shared", "about"]),
                ("contact", &["shared", "contact"]),
            ]),
            page_coverage: PageCoverageConfig {
                enabled: true,
                min_page_ratio: 0.5,
                force_common: Vec::new(),
                matching: Default::default(),
            },
            size_budget: SizeBudgetConfig {
                enabled: true,
                max_chunk_size: 40,
                isolate_variables: true,
            },
            minify: false,
        })
        .expect("pipeline succeeds");

        assert!(output.page_coverage_applied);
        assert!(output.size_budget_applied);
        assert_eq!(output.dead_code_count, 1);
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.kind == PipelineChunkKind::Variables)
        );
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.kind == PipelineChunkKind::Part)
        );
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.page.as_deref() == Some("home"))
        );
    }
}
