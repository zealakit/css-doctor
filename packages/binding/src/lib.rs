//! NAPI-RS bindings for the `css_doctor_core` analysis engine.
//!
//! The exported types mirror the core data model but use JavaScript-friendly
//! names and numeric types. [`analyze_css`] is synchronous, [`analyze_css_async`]
//! runs the same work on the libuv thread pool and returns a `Promise`, and
//! [`analyze_css_json`] returns a JSON string for callers that prefer to parse
//! the result themselves.

use std::collections::{HashMap, HashSet};

use napi::bindgen_prelude::AsyncTask;
use napi::{Env, Task};
use napi_derive::napi;
use serde::{Deserialize, Serialize};

use css_doctor_core as core;

/// The kind of a simple selector.
#[napi(string_enum = "snake_case")]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JsSelectorKind {
    /// A class selector such as `.button`.
    Class,
    /// An ID selector such as `#app`.
    Id,
    /// A type/tag selector such as `section`.
    Tag,
    /// An attribute selector such as `[data-state="open"]`.
    Attribute,
    /// A pseudo-class such as `:hover`.
    PseudoClass,
    /// A pseudo-element such as `::before`.
    PseudoElement,
    /// The universal selector `*`.
    Universal,
    /// The CSS nesting selector `&`.
    Nesting,
}

/// Decoded CSS specificity.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSpecificity {
    /// Number of ID selectors.
    pub ids: u32,
    /// Number of class, attribute and pseudo-class selectors.
    pub classes: u32,
    /// Number of type and pseudo-element selectors.
    pub types: u32,
}

/// A 1-based source location.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSourceLocation {
    /// 1-based line number.
    pub line: u32,
    /// 1-based column number.
    pub column: u32,
}

/// A non-fatal parser warning.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsAnalysisWarning {
    /// Human-readable description of the problem.
    pub message: String,
    /// Location of the problem, when known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub location: Option<JsSourceLocation>,
}

/// A selector extracted from a style rule.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSelectorInfo {
    /// Normalized selector text.
    pub raw: String,
    /// Simple-selector kinds present in the selector.
    pub kinds: Vec<JsSelectorKind>,
    /// Class names without the leading dot.
    pub classes: Vec<String>,
    /// ID names without the leading hash.
    pub ids: Vec<String>,
    /// Local type/tag names.
    pub tags: Vec<String>,
    /// Local attribute names.
    pub attributes: Vec<String>,
    /// Pseudo-class names without the leading colon or arguments.
    pub pseudo_classes: Vec<String>,
    /// Pseudo-element names without the leading `::` or arguments.
    pub pseudo_elements: Vec<String>,
    /// Tree combinators present (`" "`, `">"`, `"+"`, `"~"`).
    pub combinators: Vec<String>,
    /// Decoded specificity.
    pub specificity: JsSpecificity,
    /// Index into `CssAnalysisResult.rules`.
    pub rule_index: u32,
    /// Number of enclosing style rules.
    pub nesting_depth: u32,
}

/// A style rule and its selectors.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsStyleRuleInfo {
    /// Index of the rule in `CssAnalysisResult.rules`.
    pub index: u32,
    /// Index of the enclosing style rule, when nested.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parent_rule_index: Option<u32>,
    /// Indices into `CssAnalysisResult.selectors`.
    pub selector_indices: Vec<u32>,
    /// Number of normal declarations.
    pub declaration_count: u32,
    /// Number of `!important` declarations.
    pub important_declaration_count: u32,
    /// Number of enclosing style rules.
    pub nesting_depth: u32,
    /// Location of the rule in the source.
    pub location: JsSourceLocation,
}

/// Aggregate counters for an analysis run.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsAnalysisStats {
    /// Number of style rules.
    pub rule_count: u32,
    /// Number of selectors.
    pub selector_count: u32,
    /// Total number of normal declarations.
    pub declaration_count: u32,
    /// Total number of `!important` declarations.
    pub important_declaration_count: u32,
    /// Number of distinct class names.
    pub unique_class_count: u32,
    /// Number of distinct ID names.
    pub unique_id_count: u32,
    /// Number of distinct type/tag names.
    pub unique_tag_count: u32,
    /// Number of distinct attribute names.
    pub unique_attribute_count: u32,
    /// Deepest style-rule nesting observed.
    pub max_nesting_depth: u32,
    /// Number of parser warnings.
    pub warning_count: u32,
}

/// The complete result of analyzing a stylesheet.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsCssAnalysisResult {
    /// All selectors in document order.
    pub selectors: Vec<JsSelectorInfo>,
    /// All style rules in document order.
    pub rules: Vec<JsStyleRuleInfo>,
    /// Aggregate counters.
    pub stats: JsAnalysisStats,
    /// Recoverable parser warnings.
    pub warnings: Vec<JsAnalysisWarning>,
}

/// Analyzes a CSS string synchronously.
///
/// # Errors
///
/// Rejects with a JavaScript `Error` when the stylesheet cannot be parsed at
/// all. Recoverable syntax errors are returned as `warnings` instead.
#[napi(js_name = "analyzeCss")]
pub fn analyze_css(css_content: String) -> Result<JsCssAnalysisResult, napi::Error> {
    analyze_core(&css_content)
}

/// Analyzes a CSS string on the libuv thread pool and returns a `Promise`.
///
/// This is the preferred entry point for large stylesheets because it does not
/// block the Node.js event loop.
///
/// # Errors
///
/// Rejects with a JavaScript `Error` when the stylesheet cannot be parsed.
#[napi(
    js_name = "analyzeCssAsync",
    ts_return_type = "Promise<JsCssAnalysisResult>"
)]
pub fn analyze_css_async(css_content: String) -> AsyncTask<AnalyzeCssTask> {
    AsyncTask::new(AnalyzeCssTask { css_content })
}

/// Analyzes a CSS string and returns the result as a JSON string.
///
/// The JSON shape is identical to the object returned by `analyzeCss`.
///
/// # Errors
///
/// Rejects with a JavaScript `Error` when parsing or serialization fails.
#[napi(js_name = "analyzeCssJson")]
pub fn analyze_css_json(css_content: String) -> Result<String, napi::Error> {
    let result = analyze_core(&css_content)?;
    serde_json::to_string(&result).map_err(|error| {
        napi::Error::from_reason(format!("failed to serialize CSS analysis: {error}"))
    })
}

/// Background task used by [`analyze_css_async`].
pub struct AnalyzeCssTask {
    css_content: String,
}

impl Task for AnalyzeCssTask {
    type Output = JsCssAnalysisResult;
    type JsValue = JsCssAnalysisResult;

    fn compute(&mut self) -> Result<Self::Output, napi::Error> {
        analyze_core(&self.css_content)
    }

    fn resolve(&mut self, _env: Env, output: Self::Output) -> Result<Self::JsValue, napi::Error> {
        Ok(output)
    }
}

fn analyze_core(css_content: &str) -> Result<JsCssAnalysisResult, napi::Error> {
    core::analyze_css(css_content)
        .map(JsCssAnalysisResult::from)
        .map_err(napi::Error::from_reason)
}

fn to_u32(value: usize) -> u32 {
    u32::try_from(value).unwrap_or(u32::MAX)
}

impl From<core::SelectorKind> for JsSelectorKind {
    fn from(kind: core::SelectorKind) -> Self {
        match kind {
            core::SelectorKind::Class => Self::Class,
            core::SelectorKind::Id => Self::Id,
            core::SelectorKind::Tag => Self::Tag,
            core::SelectorKind::Attribute => Self::Attribute,
            core::SelectorKind::PseudoClass => Self::PseudoClass,
            core::SelectorKind::PseudoElement => Self::PseudoElement,
            core::SelectorKind::Universal => Self::Universal,
            core::SelectorKind::Nesting => Self::Nesting,
        }
    }
}

impl From<core::Specificity> for JsSpecificity {
    fn from(specificity: core::Specificity) -> Self {
        Self {
            ids: u32::from(specificity.ids),
            classes: u32::from(specificity.classes),
            types: u32::from(specificity.types),
        }
    }
}

impl From<core::SourceLocation> for JsSourceLocation {
    fn from(location: core::SourceLocation) -> Self {
        Self {
            line: location.line,
            column: location.column,
        }
    }
}

impl From<core::AnalysisWarning> for JsAnalysisWarning {
    fn from(warning: core::AnalysisWarning) -> Self {
        Self {
            message: warning.message,
            location: warning.location.map(JsSourceLocation::from),
        }
    }
}

impl From<core::SelectorInfo> for JsSelectorInfo {
    fn from(selector: core::SelectorInfo) -> Self {
        Self {
            raw: selector.raw,
            kinds: selector
                .kinds
                .into_iter()
                .map(JsSelectorKind::from)
                .collect(),
            classes: selector.classes,
            ids: selector.ids,
            tags: selector.tags,
            attributes: selector.attributes,
            pseudo_classes: selector.pseudo_classes,
            pseudo_elements: selector.pseudo_elements,
            combinators: selector.combinators,
            specificity: selector.specificity.into(),
            rule_index: to_u32(selector.rule_index),
            nesting_depth: to_u32(selector.nesting_depth),
        }
    }
}

impl From<core::StyleRuleInfo> for JsStyleRuleInfo {
    fn from(rule: core::StyleRuleInfo) -> Self {
        Self {
            index: to_u32(rule.index),
            parent_rule_index: rule.parent_rule_index.map(to_u32),
            selector_indices: rule.selector_indices.into_iter().map(to_u32).collect(),
            declaration_count: to_u32(rule.declaration_count),
            important_declaration_count: to_u32(rule.important_declaration_count),
            nesting_depth: to_u32(rule.nesting_depth),
            location: rule.location.into(),
        }
    }
}

impl From<core::AnalysisStats> for JsAnalysisStats {
    fn from(stats: core::AnalysisStats) -> Self {
        Self {
            rule_count: to_u32(stats.rule_count),
            selector_count: to_u32(stats.selector_count),
            declaration_count: to_u32(stats.declaration_count),
            important_declaration_count: to_u32(stats.important_declaration_count),
            unique_class_count: to_u32(stats.unique_class_count),
            unique_id_count: to_u32(stats.unique_id_count),
            unique_tag_count: to_u32(stats.unique_tag_count),
            unique_attribute_count: to_u32(stats.unique_attribute_count),
            max_nesting_depth: to_u32(stats.max_nesting_depth),
            warning_count: to_u32(stats.warning_count),
        }
    }
}

/// Configuration for page-coverage chunk splitting.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsChunkConfig {
    /// Minimum share of pages that must use a rule before it is considered
    /// common. Range: 0.0..=1.0.
    pub min_page_ratio: f64,
    /// Selectors or class names that should always stay in the common chunk.
    pub force_common_selectors: Vec<String>,
    /// Minify serialized CSS. Defaults to `true`.
    pub minify: Option<bool>,
}

/// Input for [`split_css_by_pages`].
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSplitInput {
    /// Original CSS source.
    pub css_content: String,
    /// Page/route name to class names used by that page.
    pub page_usage: HashMap<String, Vec<String>>,
    /// Splitting configuration.
    pub config: JsChunkConfig,
}

/// Usage information for one selector.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSelectorStat {
    /// Original selector text.
    pub selector: String,
    /// Matched class occurrences across pages.
    pub total_occurrences: u32,
    /// Number of pages using the selector.
    pub page_count: u32,
    /// Fraction of pages using the selector (0..1).
    pub coverage_ratio: f64,
    /// `common`, `dead`, or `page:<name>[,<name>...]`.
    pub target_chunk: String,
}

/// Result of page-coverage chunk splitting.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSplitOutput {
    /// CSS shared by pages reaching the coverage threshold, plus global rules.
    pub common_css: String,
    /// Page name to page-specific CSS.
    pub page_chunks: HashMap<String, String>,
    /// Per-selector usage matrix.
    pub stats: Vec<JsSelectorStat>,
    /// Number of dead selector occurrences removed.
    pub dead_code_count: u32,
}

/// Splits a stylesheet into common and page-specific CSS chunks.
///
/// # Errors
///
/// Rejects with a JavaScript `Error` when the configuration is invalid or the
/// stylesheet/AST cannot be processed.
#[napi]
pub fn split_css_by_pages(input: JsSplitInput) -> Result<JsSplitOutput, napi::Error> {
    let core_input = core::SplitInput {
        css_content: input.css_content,
        page_usage: input
            .page_usage
            .into_iter()
            .map(|(page, classes)| (page, classes.into_iter().collect::<HashSet<_>>()))
            .collect(),
        config: core::ChunkConfig {
            min_page_ratio: input.config.min_page_ratio as f32,
            force_common_selectors: input.config.force_common_selectors,
            minify: input.config.minify.unwrap_or(true),
        },
    };

    core::split_css_by_pages(&core_input)
        .map(JsSplitOutput::from)
        .map_err(napi::Error::from_reason)
}

/// Configuration for the semantic page-coverage tier.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsPageCoverageConfig {
    /// Enable page-coverage splitting. Defaults to `true`.
    pub enabled: Option<bool>,
    /// Minimum page coverage for common rules. Defaults to `0.5`.
    pub min_page_ratio: Option<f64>,
    /// Selectors or classes that always stay in the common chunk.
    pub force_common: Option<Vec<String>>,
}

/// Configuration for the physical size-budget tier.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsSizeBudgetConfig {
    /// Enable size-budget splitting. Defaults to `true`.
    pub enabled: Option<bool>,
    /// Maximum serialized bytes per body chunk. Defaults to 60 KiB.
    pub max_chunk_size: Option<u32>,
    /// Isolate CSS variables before splitting. Defaults to `true`.
    pub isolate_variables: Option<bool>,
}

/// Input for [`optimize_css`].
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsPipelineInput {
    /// Original CSS source.
    pub css_content: String,
    /// Page/route name to class names used by that page.
    pub page_usage: HashMap<String, Vec<String>>,
    /// Optional tier 1 configuration.
    pub page_coverage: Option<JsPageCoverageConfig>,
    /// Optional tier 2 configuration.
    pub size_budget: Option<JsSizeBudgetConfig>,
    /// Minify serialized CSS. Defaults to `true`.
    pub minify: Option<bool>,
}

/// The stage that produced a pipeline chunk.
#[napi(string_enum = "snake_case")]
#[derive(Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JsPipelineChunkKind {
    /// Shared/common rules.
    Common,
    /// Page-specific rules.
    Page,
    /// Isolated CSS variables.
    Variables,
    /// A size-budget part.
    Part,
}

/// One CSS chunk emitted by the pipeline.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsChunkOutput {
    /// Logical file stem, e.g. `common`, `page-home`, `common-vars`.
    pub name: String,
    /// Base chunk before physical splitting.
    pub source_chunk: String,
    /// Serialized CSS.
    pub css: String,
    /// Stage/kind of this chunk.
    pub kind: JsPipelineChunkKind,
    /// Page that owns this chunk, when applicable.
    pub page: Option<String>,
    /// Whether this chunk contains isolated CSS variables.
    pub variables: bool,
    /// 1-based part index when produced by size splitting.
    pub part: Option<u32>,
    /// Serialized byte size.
    pub size_bytes: u32,
    /// True when an indivisible rule exceeds the budget.
    pub oversized: bool,
    /// True when this chunk exists because of the size budget.
    pub split_due_to_size: bool,
}

/// Result of the two-tier optimization pipeline.
#[napi(object)]
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsPipelineOutput {
    /// Final chunks in load order.
    pub chunks: Vec<JsChunkOutput>,
    /// Selector usage matrix from tier 1.
    pub stats: Vec<JsSelectorStat>,
    /// Dead selector occurrences removed by tier 1.
    pub dead_code_count: u32,
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
/// Rejects with a JavaScript `Error` when the configuration is invalid or the
/// stylesheet/AST cannot be processed.
#[napi]
pub fn optimize_css(input: JsPipelineInput) -> Result<JsPipelineOutput, napi::Error> {
    let core_input = build_pipeline_input(input);
    core::optimize_css_pipeline(&core_input)
        .map(JsPipelineOutput::from)
        .map_err(napi::Error::from_reason)
}

/// Combined pipeline output + optimization report from a single native run.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsOptimizeExplained {
    pub pipeline: JsPipelineOutput,
    pub report_json: String,
}

/// Runs the optimization pipeline once and returns both chunks and a report.
///
/// Prefer this over calling [`optimize_css`] and [`optimize_css_report`]
/// separately to avoid double parsing/splitting.
///
/// # Errors
///
/// Rejects when the pipeline or report builder fails.
#[napi(js_name = "optimizeCssExplained")]
pub fn optimize_css_explained(
    input: JsPipelineInput,
    max_selector_decisions: Option<u32>,
) -> Result<JsOptimizeExplained, napi::Error> {
    let started = std::time::Instant::now();
    let core_input = build_pipeline_input(input);
    let output = core::optimize_css_pipeline(&core_input).map_err(napi::Error::from_reason)?;
    let mut explain = core::ExplainOptions::default();
    if let Some(limit) = max_selector_decisions {
        explain.max_selector_decisions = limit as usize;
    }
    let report = core::build_optimization_report(
        &core_input,
        &output,
        &core::ReportOptions {
            explain,
            file_path: None,
        },
        started.elapsed().as_secs_f64() * 1000.0,
    )
    .map_err(napi::Error::from_reason)?;

    let report_json = serde_json::to_string_pretty(&report)
        .map_err(|error| napi::Error::from_reason(error.to_string()))?;

    Ok(JsOptimizeExplained {
        pipeline: JsPipelineOutput::from(output),
        report_json,
    })
}

/// Runs the optimization pipeline and returns a versioned report JSON document
/// that includes decisions, metrics, and chunk inventory.
///
/// # Errors
///
/// Rejects when the pipeline or report builder fails.
#[napi(js_name = "optimizeCssReport")]
pub fn optimize_css_report(
    input: JsPipelineInput,
    max_selector_decisions: Option<u32>,
) -> Result<String, napi::Error> {
    Ok(optimize_css_explained(input, max_selector_decisions)?.report_json)
}

/// Lists built-in autofix rules as JSON.
#[napi(js_name = "listCssFixes")]
pub fn list_css_fixes() -> Result<String, napi::Error> {
    serde_json::to_string_pretty(&core::list_fix_catalog())
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}

/// Autofix input.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsFixInput {
    pub css_content: String,
    pub file_path: Option<String>,
    pub dry_run: Option<bool>,
    pub rules: Option<Vec<String>>,
    pub include_review: Option<bool>,
}

/// Plans or applies safe CSS autofixes. Returns a JSON `FixApplicationResult`.
///
/// # Errors
///
/// Rejects for parse/serialize failures or unsafe rule selection.
#[napi(js_name = "applyCssFixes")]
pub fn apply_css_fixes(input: JsFixInput) -> Result<String, napi::Error> {
    let result = core::apply_css_fixes(
        &input.css_content,
        input.file_path.as_deref(),
        &core::ApplyFixesOptions {
            dry_run: input.dry_run.unwrap_or(true),
            rules: input.rules.unwrap_or_default(),
            include_review: input.include_review.unwrap_or(false),
        },
    )
    .map_err(napi::Error::from_reason)?;

    serde_json::to_string_pretty(&result)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}

fn build_pipeline_input(input: JsPipelineInput) -> core::PipelineInput {
    let page_coverage = input.page_coverage;
    let size_budget = input.size_budget;

    core::PipelineInput {
        css_content: input.css_content,
        page_usage: input
            .page_usage
            .into_iter()
            .map(|(page, classes)| (page, classes.into_iter().collect::<HashSet<_>>()))
            .collect(),
        page_coverage: core::PageCoverageConfig {
            enabled: page_coverage
                .as_ref()
                .and_then(|config| config.enabled)
                .unwrap_or(true),
            min_page_ratio: page_coverage
                .as_ref()
                .and_then(|config| config.min_page_ratio)
                .map(|value| value as f32)
                .unwrap_or(0.5),
            force_common: page_coverage
                .and_then(|config| config.force_common)
                .unwrap_or_default(),
        },
        size_budget: core::SizeBudgetConfig {
            enabled: size_budget
                .as_ref()
                .and_then(|config| config.enabled)
                .unwrap_or(true),
            max_chunk_size: size_budget
                .as_ref()
                .and_then(|config| config.max_chunk_size)
                .map(|value| value as usize)
                .unwrap_or(60 * 1024),
            isolate_variables: size_budget
                .and_then(|config| config.isolate_variables)
                .unwrap_or(true),
        },
        minify: input.minify.unwrap_or(true),
    }
}

impl From<core::PipelineChunkKind> for JsPipelineChunkKind {
    fn from(kind: core::PipelineChunkKind) -> Self {
        match kind {
            core::PipelineChunkKind::Common => Self::Common,
            core::PipelineChunkKind::Page => Self::Page,
            core::PipelineChunkKind::Variables => Self::Variables,
            core::PipelineChunkKind::Part => Self::Part,
        }
    }
}

impl From<core::PipelineChunk> for JsChunkOutput {
    fn from(chunk: core::PipelineChunk) -> Self {
        Self {
            name: chunk.name,
            source_chunk: chunk.source_chunk,
            css: chunk.css,
            kind: chunk.kind.into(),
            page: chunk.page,
            variables: chunk.variables,
            part: chunk.part,
            size_bytes: to_u32(chunk.size_bytes),
            oversized: chunk.oversized,
            split_due_to_size: chunk.split_due_to_size,
        }
    }
}

impl From<core::PipelineOutput> for JsPipelineOutput {
    fn from(output: core::PipelineOutput) -> Self {
        Self {
            chunks: output.chunks.into_iter().map(JsChunkOutput::from).collect(),
            stats: output.stats.into_iter().map(JsSelectorStat::from).collect(),
            dead_code_count: to_u32(output.dead_code_count),
            pages: output.pages,
            page_coverage_applied: output.page_coverage_applied,
            size_budget_applied: output.size_budget_applied,
        }
    }
}

impl From<core::SelectorStat> for JsSelectorStat {
    fn from(stat: core::SelectorStat) -> Self {
        Self {
            selector: stat.selector,
            total_occurrences: to_u32(stat.total_occurrences),
            page_count: to_u32(stat.page_count),
            coverage_ratio: f64::from(stat.coverage_ratio),
            target_chunk: stat.target_chunk,
        }
    }
}

impl From<core::SplitOutput> for JsSplitOutput {
    fn from(output: core::SplitOutput) -> Self {
        Self {
            common_css: output.common_css,
            page_chunks: output.page_chunks,
            stats: output.stats.into_iter().map(JsSelectorStat::from).collect(),
            dead_code_count: to_u32(output.dead_code_count),
        }
    }
}

impl From<core::CssAnalysisResult> for JsCssAnalysisResult {
    fn from(result: core::CssAnalysisResult) -> Self {
        Self {
            selectors: result
                .selectors
                .into_iter()
                .map(JsSelectorInfo::from)
                .collect(),
            rules: result
                .rules
                .into_iter()
                .map(JsStyleRuleInfo::from)
                .collect(),
            stats: result.stats.into(),
            warnings: result
                .warnings
                .into_iter()
                .map(JsAnalysisWarning::from)
                .collect(),
        }
    }
}

/// Optional weights for CSS Health Score dimensions (must be >= 0).
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthWeights {
    pub selector_complexity: Option<f64>,
    pub duplicate_rules: Option<f64>,
    pub css_size_efficiency: Option<f64>,
    pub dead_css: Option<f64>,
    pub variable_consistency: Option<f64>,
}

/// Optional thresholds for CSS Health Score analyzers.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthThresholds {
    pub high_specificity_classes: Option<u32>,
    pub high_specificity_ids: Option<u32>,
    pub deep_combinator_count: Option<u32>,
    pub deep_nesting_depth: Option<u32>,
    pub long_selector_token_count: Option<u32>,
    pub large_stylesheet_bytes: Option<u32>,
    pub critical_stylesheet_bytes: Option<u32>,
    pub heavy_rule_declarations: Option<u32>,
    pub many_selectors: Option<u32>,
}

/// Input for [`evaluate_css_health`].
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthInput {
    pub css_content: String,
    pub file_path: Option<String>,
    pub size_bytes: Option<u32>,
    pub weights: Option<JsHealthWeights>,
    pub thresholds: Option<JsHealthThresholds>,
}

/// One health diagnostic finding.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthDiagnostic {
    pub code: String,
    pub severity: String,
    pub category: String,
    pub message: String,
    pub file_path: Option<String>,
    pub location: Option<JsSourceLocation>,
    pub selector: Option<String>,
    pub remediation: String,
    pub certainty: String,
}

/// Score metadata for one health dimension.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsDimensionScore {
    pub id: String,
    pub score: Option<u32>,
    pub weight: f64,
    pub effective_weight: f64,
    pub evaluated: bool,
    pub issue_count: u32,
    pub error_count: u32,
    pub warning_count: u32,
    pub info_count: u32,
    pub diagnostic_codes: Vec<String>,
    pub recommendations: Vec<String>,
    pub note: Option<String>,
}

/// Aggregate counters for a health report.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthScoreSummary {
    pub files: u32,
    pub rules: u32,
    pub selectors: u32,
    pub declarations: u32,
    pub size_bytes: u32,
    pub errors: u32,
    pub warnings: u32,
    pub suggestions: u32,
    pub analysis_ms: f64,
}

/// Complete CSS Health Score report.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthReport {
    pub schema_version: u32,
    pub overall: u32,
    pub grade: String,
    pub status: String,
    pub dimensions: Vec<JsDimensionScore>,
    pub summary: JsHealthScoreSummary,
    pub diagnostics: Vec<JsHealthDiagnostic>,
    pub recommendations: Vec<String>,
}

/// Evaluates CSS Health Score for a single stylesheet.
///
/// # Errors
///
/// Rejects when configuration is invalid or CSS cannot be parsed.
#[napi(js_name = "evaluateCssHealth")]
pub fn evaluate_css_health(input: JsHealthInput) -> Result<JsHealthReport, napi::Error> {
    let config = build_health_config(input.weights, input.thresholds)?;

    core::evaluate_css_health(
        &input.css_content,
        input.file_path.as_deref(),
        input.size_bytes.map(|value| value as usize),
        &config,
    )
    .map(JsHealthReport::from)
    .map_err(napi::Error::from_reason)
}

/// One stylesheet entry for multi-file health evaluation.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthFileInput {
    pub css_content: String,
    pub file_path: Option<String>,
    pub size_bytes: Option<u32>,
}

/// Multi-file health evaluation input.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsHealthBatchInput {
    pub files: Vec<JsHealthFileInput>,
    pub weights: Option<JsHealthWeights>,
    pub thresholds: Option<JsHealthThresholds>,
}

/// Evaluates and merges CSS Health Score across multiple stylesheets.
///
/// # Errors
///
/// Rejects when configuration is invalid or any stylesheet cannot be parsed.
#[napi(js_name = "evaluateCssHealthBatch")]
pub fn evaluate_css_health_batch(input: JsHealthBatchInput) -> Result<JsHealthReport, napi::Error> {
    let config = build_health_config(input.weights, input.thresholds)?;

    if input.files.is_empty() {
        return Ok(JsHealthReport::from(core::merge_health_reports(
            &[],
            &config,
        )));
    }

    let mut reports = Vec::with_capacity(input.files.len());

    for file in &input.files {
        let report = core::evaluate_css_health(
            &file.css_content,
            file.file_path.as_deref(),
            file.size_bytes.map(|value| value as usize),
            &config,
        )
        .map_err(napi::Error::from_reason)?;
        reports.push(report);
    }

    Ok(JsHealthReport::from(core::merge_health_reports(
        &reports, &config,
    )))
}

fn build_health_config(
    weights: Option<JsHealthWeights>,
    thresholds: Option<JsHealthThresholds>,
) -> Result<core::HealthScoreConfig, napi::Error> {
    let mut config = core::HealthScoreConfig::default();

    if let Some(weights) = weights {
        if let Some(value) = weights.selector_complexity {
            config.weights.selector_complexity = value;
        }
        if let Some(value) = weights.duplicate_rules {
            config.weights.duplicate_rules = value;
        }
        if let Some(value) = weights.css_size_efficiency {
            config.weights.css_size_efficiency = value;
        }
        if let Some(value) = weights.dead_css {
            config.weights.dead_css = value;
        }
        if let Some(value) = weights.variable_consistency {
            config.weights.variable_consistency = value;
        }
    }

    if let Some(thresholds) = thresholds {
        if let Some(value) = thresholds.high_specificity_classes {
            config.thresholds.high_specificity_classes = value as u16;
        }
        if let Some(value) = thresholds.high_specificity_ids {
            config.thresholds.high_specificity_ids = value as u16;
        }
        if let Some(value) = thresholds.deep_combinator_count {
            config.thresholds.deep_combinator_count = value as usize;
        }
        if let Some(value) = thresholds.deep_nesting_depth {
            config.thresholds.deep_nesting_depth = value as usize;
        }
        if let Some(value) = thresholds.long_selector_token_count {
            config.thresholds.long_selector_token_count = value as usize;
        }
        if let Some(value) = thresholds.large_stylesheet_bytes {
            config.thresholds.large_stylesheet_bytes = value as usize;
        }
        if let Some(value) = thresholds.critical_stylesheet_bytes {
            config.thresholds.critical_stylesheet_bytes = value as usize;
        }
        if let Some(value) = thresholds.heavy_rule_declarations {
            config.thresholds.heavy_rule_declarations = value as usize;
        }
        if let Some(value) = thresholds.many_selectors {
            config.thresholds.many_selectors = value as usize;
        }
    }

    config.validate().map_err(napi::Error::from_reason)?;
    Ok(config)
}

impl From<core::HealthReport> for JsHealthReport {
    fn from(report: core::HealthReport) -> Self {
        Self {
            schema_version: report.schema_version,
            overall: u32::from(report.overall),
            grade: format!("{:?}", report.grade),
            status: health_status_name(report.status).to_string(),
            dimensions: report
                .dimensions
                .into_iter()
                .map(JsDimensionScore::from)
                .collect(),
            summary: JsHealthScoreSummary::from(report.summary),
            diagnostics: report
                .diagnostics
                .into_iter()
                .map(JsHealthDiagnostic::from)
                .collect(),
            recommendations: report.recommendations,
        }
    }
}

impl From<core::DimensionScore> for JsDimensionScore {
    fn from(dimension: core::DimensionScore) -> Self {
        Self {
            id: dimension.id.as_str().to_string(),
            score: dimension.score.map(u32::from),
            weight: dimension.weight,
            effective_weight: dimension.effective_weight,
            evaluated: dimension.evaluated,
            issue_count: to_u32(dimension.issue_count),
            error_count: to_u32(dimension.error_count),
            warning_count: to_u32(dimension.warning_count),
            info_count: to_u32(dimension.info_count),
            diagnostic_codes: dimension.diagnostic_codes,
            recommendations: dimension.recommendations,
            note: dimension.note,
        }
    }
}

impl From<core::HealthScoreSummary> for JsHealthScoreSummary {
    fn from(summary: core::HealthScoreSummary) -> Self {
        Self {
            files: to_u32(summary.files),
            rules: to_u32(summary.rules),
            selectors: to_u32(summary.selectors),
            declarations: to_u32(summary.declarations),
            size_bytes: to_u32(summary.size_bytes),
            errors: to_u32(summary.errors),
            warnings: to_u32(summary.warnings),
            suggestions: to_u32(summary.suggestions),
            analysis_ms: summary.analysis_ms,
        }
    }
}

impl From<core::HealthDiagnostic> for JsHealthDiagnostic {
    fn from(diagnostic: core::HealthDiagnostic) -> Self {
        Self {
            code: diagnostic.code,
            severity: health_severity_name(diagnostic.severity).to_string(),
            category: diagnostic.category.as_str().to_string(),
            message: diagnostic.message,
            file_path: diagnostic.file_path,
            location: diagnostic.location.map(|location| JsSourceLocation {
                line: location.line,
                column: location.column,
            }),
            selector: diagnostic.selector,
            remediation: diagnostic.remediation,
            certainty: match diagnostic.certainty {
                core::DiagnosticCertainty::Confirmed => "confirmed".to_string(),
                core::DiagnosticCertainty::Heuristic => "heuristic".to_string(),
            },
        }
    }
}

fn health_severity_name(severity: core::HealthSeverity) -> &'static str {
    match severity {
        core::HealthSeverity::Error => "error",
        core::HealthSeverity::Warning => "warning",
        core::HealthSeverity::Info => "info",
    }
}

fn health_status_name(status: core::HealthStatus) -> &'static str {
    match status {
        core::HealthStatus::Excellent => "excellent",
        core::HealthStatus::Good => "good",
        core::HealthStatus::Fair => "fair",
        core::HealthStatus::Poor => "poor",
        core::HealthStatus::Critical => "critical",
        core::HealthStatus::InsufficientData => "insufficientData",
    }
}

/// File entry used when creating a baseline document.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsBaselineFileInput {
    pub path: String,
    pub css_content: String,
    pub size_bytes: Option<u32>,
}

/// Optional Git metadata for a baseline.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsBaselineGitMetadata {
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
}

/// Optional project metadata for a baseline.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsBaselineProjectMetadata {
    pub name: Option<String>,
    pub root: Option<String>,
}

/// Input for [`create_baseline`].
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsBaselineCreateInput {
    pub files: Vec<JsBaselineFileInput>,
    pub tool_version: String,
    pub created_at: Option<String>,
    pub patterns: Option<Vec<String>>,
    pub threshold: Option<u32>,
    pub project: Option<JsBaselineProjectMetadata>,
    pub git: Option<JsBaselineGitMetadata>,
    pub weights: Option<JsHealthWeights>,
    pub thresholds: Option<JsHealthThresholds>,
}

/// Validation outcome for a baseline document.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsBaselineValidationResult {
    pub status: String,
    pub message: Option<String>,
}

/// Comparison tolerances for regression detection.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsCompareOptions {
    pub score_tolerance: Option<u32>,
    pub size_absolute_tolerance_bytes: Option<u32>,
    pub size_increase_percent: Option<f64>,
    pub count_absolute_tolerance: Option<u32>,
    pub count_increase_percent: Option<f64>,
}

/// Minimum dimension score gate.
#[napi(object)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsMinDimensionScore {
    pub id: String,
    pub min_score: u32,
}

/// Quality-gate configuration for regression comparison.
#[napi(object)]
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JsQualityGateConfig {
    pub min_score: Option<u32>,
    pub min_dimension_scores: Option<Vec<JsMinDimensionScore>>,
    pub max_css_size: Option<u32>,
    pub max_size_increase_percent: Option<f64>,
    pub max_new_errors: Option<u32>,
    pub max_new_warnings: Option<u32>,
    pub fail_on_regression: Option<bool>,
    pub fail_on_new_errors: Option<bool>,
    pub fail_on_new_diagnostics: Option<bool>,
}

/// Creates a versioned baseline JSON document from CSS files.
///
/// # Errors
///
/// Rejects when configuration is invalid, CSS cannot be parsed, or
/// serialization fails.
#[napi(js_name = "createBaseline")]
pub fn create_baseline(input: JsBaselineCreateInput) -> Result<String, napi::Error> {
    let config = build_health_config(input.weights, input.thresholds)?;
    let created_at = input.created_at.unwrap_or_else(chrono_like_utc_now);

    if input.files.is_empty() {
        return Err(napi::Error::from_reason(
            "createBaseline requires at least one CSS file".to_string(),
        ));
    }

    let mut reports = Vec::with_capacity(input.files.len());
    let mut file_entries = Vec::with_capacity(input.files.len());

    for file in &input.files {
        let report = core::evaluate_css_health(
            &file.css_content,
            Some(&file.path),
            file.size_bytes
                .map(|value| value as usize)
                .or(Some(file.css_content.len())),
            &config,
        )
        .map_err(napi::Error::from_reason)?;

        let analysis = core::analyze_css(&file.css_content).map_err(napi::Error::from_reason)?;
        file_entries.push(core::BaselineFileEntry::from_css(
            &file.path,
            &file.css_content,
            analysis.stats.rule_count,
            analysis.stats.selector_count,
            analysis.stats.declaration_count,
        ));
        reports.push(report);
    }

    let merged = core::merge_health_reports(&reports, &config);
    let project = input.project.unwrap_or_default();
    let git = input.git.unwrap_or_default();
    let baseline = core::BaselineDocument::from_health_report(
        &merged,
        &input.tool_version,
        &created_at,
        core::BaselineConfigSnapshot {
            patterns: input.patterns.unwrap_or_default(),
            threshold: input.threshold,
        },
        file_entries,
        core::BaselineProjectMetadata {
            name: project.name,
            root: project.root,
        },
        core::BaselineGitMetadata {
            commit: git.commit,
            branch: git.branch,
            dirty: git.dirty,
        },
    );

    baseline
        .to_json_pretty()
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}

/// Validates a baseline JSON document.
///
/// # Errors
///
/// Rejects when the JSON cannot be parsed.
#[napi(js_name = "validateBaseline")]
pub fn validate_baseline(
    baseline_json: String,
    tool_version: String,
) -> Result<JsBaselineValidationResult, napi::Error> {
    let baseline = core::BaselineDocument::from_json(&baseline_json)
        .map_err(|error| napi::Error::from_reason(format!("invalid baseline JSON: {error}")))?;

    Ok(
        match core::validate_baseline_document(&baseline, &tool_version) {
            core::BaselineValidation::Compatible => JsBaselineValidationResult {
                status: "compatible".into(),
                message: None,
            },
            core::BaselineValidation::SoftWarning(message) => JsBaselineValidationResult {
                status: "softWarning".into(),
                message: Some(message),
            },
            core::BaselineValidation::Incompatible(message) => JsBaselineValidationResult {
                status: "incompatible".into(),
                message: Some(message),
            },
        },
    )
}

/// Compares a stored baseline against a current baseline snapshot.
///
/// Returns a versioned regression report as pretty JSON.
///
/// # Errors
///
/// Rejects when either document is invalid JSON or options are invalid.
#[napi(js_name = "compareBaselines")]
pub fn compare_baselines(
    baseline_json: String,
    current_json: String,
    options: Option<JsCompareOptions>,
    gates: Option<JsQualityGateConfig>,
) -> Result<String, napi::Error> {
    let baseline = core::BaselineDocument::from_json(&baseline_json)
        .map_err(|error| napi::Error::from_reason(format!("invalid baseline JSON: {error}")))?;
    let current = core::BaselineDocument::from_json(&current_json).map_err(|error| {
        napi::Error::from_reason(format!("invalid current baseline JSON: {error}"))
    })?;
    let compare_options = build_compare_options(options);
    let gate_config = gates.map(build_quality_gates).transpose()?;

    let report = core::compare_baselines_with_gates(
        &baseline,
        &current,
        &compare_options,
        gate_config.as_ref(),
    );

    serde_json::to_string_pretty(&report)
        .map_err(|error| napi::Error::from_reason(error.to_string()))
}

fn build_compare_options(options: Option<JsCompareOptions>) -> core::CompareOptions {
    let mut compare = core::CompareOptions::default();
    let Some(options) = options else {
        return compare;
    };

    if let Some(value) = options.score_tolerance {
        compare.score_tolerance = value.min(u32::from(u8::MAX)) as u8;
    }
    if let Some(value) = options.size_absolute_tolerance_bytes {
        compare.size_absolute_tolerance_bytes = value as usize;
    }
    if let Some(value) = options.size_increase_percent {
        compare.size_increase_percent = value;
    }
    if let Some(value) = options.count_absolute_tolerance {
        compare.count_absolute_tolerance = value as usize;
    }
    if let Some(value) = options.count_increase_percent {
        compare.count_increase_percent = value;
    }
    compare
}

fn build_quality_gates(gates: JsQualityGateConfig) -> Result<core::QualityGateConfig, napi::Error> {
    let mut min_dimension_scores = Vec::new();
    if let Some(requirements) = gates.min_dimension_scores {
        for requirement in requirements {
            let id = parse_dimension_id(&requirement.id)?;
            min_dimension_scores.push(core::MinDimensionScore {
                id,
                min_score: requirement.min_score.min(u32::from(u8::MAX)) as u8,
            });
        }
    }

    Ok(core::QualityGateConfig {
        min_score: gates
            .min_score
            .map(|value| value.min(u32::from(u8::MAX)) as u8),
        min_dimension_scores,
        max_css_size: gates.max_css_size.map(|value| value as usize),
        max_size_increase_percent: gates.max_size_increase_percent,
        max_new_errors: gates.max_new_errors.map(|value| value as usize),
        max_new_warnings: gates.max_new_warnings.map(|value| value as usize),
        fail_on_regression: gates.fail_on_regression.unwrap_or(false),
        fail_on_new_errors: gates.fail_on_new_errors.unwrap_or(false),
        fail_on_new_diagnostics: gates.fail_on_new_diagnostics.unwrap_or(false),
    })
}

fn parse_dimension_id(value: &str) -> Result<core::DimensionId, napi::Error> {
    match value {
        "selectorComplexity" | "selector-complexity" => Ok(core::DimensionId::SelectorComplexity),
        "duplicateRules" | "duplicate-rules" => Ok(core::DimensionId::DuplicateRules),
        "cssSizeEfficiency" | "css-size-efficiency" => Ok(core::DimensionId::CssSizeEfficiency),
        "deadCss" | "dead-css" => Ok(core::DimensionId::DeadCss),
        "variableConsistency" | "variable-consistency" => {
            Ok(core::DimensionId::VariableConsistency)
        }
        other => Err(napi::Error::from_reason(format!(
            "unknown dimension id `{other}`"
        ))),
    }
}

fn chrono_like_utc_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};

    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0);
    let days = secs / 86_400;
    let day_secs = secs % 86_400;
    let hours = day_secs / 3_600;
    let minutes = (day_secs % 3_600) / 60;
    let seconds = day_secs % 60;

    // Civil date from Unix days (proleptic Gregorian), enough for baseline metadata.
    let (year, month, day) = unix_days_to_ymd(days as i64);
    format!("{year:04}-{month:02}-{day:02}T{hours:02}:{minutes:02}:{seconds:02}Z")
}

fn unix_days_to_ymd(days: i64) -> (i32, u32, u32) {
    // Algorithm from civil_from_days (Howard Hinnant).
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1_460 + doe / 36_524 - doe / 146_096) / 365;
    let y = (yoe as i64) + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    (y as i32, m as u32, d as u32)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_a_complete_analysis_result() {
        let result = analyze_core(
            r#"
            #app .card:hover, .card--wide {
              color: red;
            }
            @media (min-width: 768px) {
              .hidden { display: none !important; }
            }
            "#,
        )
        .expect("analysis succeeds");

        assert_eq!(result.selectors.len(), 3);
        assert_eq!(result.rules.len(), 2);
        assert_eq!(result.stats.rule_count, 2);
        assert_eq!(result.stats.selector_count, 3);
        assert_eq!(result.stats.important_declaration_count, 1);
        assert_eq!(
            result.selectors[0].kinds,
            vec![
                JsSelectorKind::Id,
                JsSelectorKind::Class,
                JsSelectorKind::PseudoClass
            ]
        );
        assert_eq!(result.selectors[0].specificity.ids, 1);
        assert_eq!(result.selectors[0].specificity.classes, 2);
        assert_eq!(result.selectors[1].rule_index, 0);
        assert_eq!(result.rules[1].parent_rule_index, None);
    }

    #[test]
    fn json_output_matches_the_object_shape() {
        let result = analyze_core(".btn { color: red; }").expect("analysis succeeds");
        let json = serde_json::to_value(&result).expect("serializes");

        assert_eq!(json["selectors"][0]["raw"], ".btn");
        assert_eq!(json["selectors"][0]["kinds"][0], "class");
        assert_eq!(json["selectors"][0]["ruleIndex"], 0);
        assert_eq!(json["stats"]["ruleCount"], 1);
    }

    #[test]
    fn reports_recoverable_errors_as_warnings() {
        let result = analyze_core(".valid { color red; }").expect("analysis recovers");

        assert_eq!(result.rules.len(), 1);
        assert_eq!(result.warnings.len(), 1);
        assert_eq!(result.stats.warning_count, 1);
        assert!(result.warnings[0].location.is_some());
    }

    #[test]
    fn maps_page_splitting_output_to_javascript_objects() {
        let input = JsSplitInput {
            css_content: ".shared { color: red; } .about { color: blue; } .dead { display: none; }"
                .to_string(),
            page_usage: HashMap::from([
                ("home".to_string(), vec!["shared".to_string()]),
                (
                    "about".to_string(),
                    vec!["shared".to_string(), "about".to_string()],
                ),
                ("contact".to_string(), vec!["shared".to_string()]),
            ]),
            config: JsChunkConfig {
                min_page_ratio: 0.5,
                force_common_selectors: Vec::new(),
                minify: None,
            },
        };

        let output = split_css_by_pages(input).expect("split succeeds");

        assert!(output.common_css.contains(".shared"));
        assert!(output.page_chunks["about"].contains(".about"));
        assert!(!output.common_css.contains(".dead"));
        assert_eq!(output.dead_code_count, 1);
        assert_eq!(output.stats.len(), 3);

        let about = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".about")
            .expect("about stat");
        assert_eq!(about.page_count, 1);
        assert_eq!(about.target_chunk, "page:about");
        assert!((about.coverage_ratio - 0.3333).abs() < 0.0001);
    }

    #[test]
    fn reports_split_configuration_errors() {
        let input = JsSplitInput {
            css_content: String::new(),
            page_usage: HashMap::new(),
            config: JsChunkConfig {
                min_page_ratio: 2.0,
                force_common_selectors: Vec::new(),
                minify: None,
            },
        };

        let error = split_css_by_pages(input).expect_err("invalid config fails");
        assert!(error.to_string().contains("min_page_ratio"));
    }

    #[test]
    fn empty_css_produces_an_empty_result() {
        let result = analyze_core("").expect("empty CSS is valid");

        assert!(result.selectors.is_empty());
        assert!(result.rules.is_empty());
        assert_eq!(
            result.stats,
            JsAnalysisStats {
                rule_count: 0,
                selector_count: 0,
                declaration_count: 0,
                important_declaration_count: 0,
                unique_class_count: 0,
                unique_id_count: 0,
                unique_tag_count: 0,
                unique_attribute_count: 0,
                max_nesting_depth: 0,
                warning_count: 0,
            }
        );
        assert!(result.warnings.is_empty());
    }
    #[test]
    fn maps_health_score_report() {
        let report = evaluate_css_health(JsHealthInput {
            css_content: ".dead { } .ok { color: blue; }".to_string(),
            file_path: Some("demo.css".to_string()),
            size_bytes: Some(40),
            weights: None,
            thresholds: None,
        })
        .expect("health succeeds");

        assert_eq!(report.schema_version, 1);
        assert!(report.overall < 100);
        assert!(!report.dimensions.is_empty());
        assert!(
            report
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "dead.empty-rule")
        );
    }

    #[test]
    fn optimize_report_and_safe_fixes() {
        let explained = optimize_css_explained(
            JsPipelineInput {
                css_content: ".shared { color: red; } .dead { color: blue; }".into(),
                page_usage: HashMap::from([
                    ("home".into(), vec!["shared".into()]),
                    ("about".into(), vec!["shared".into()]),
                ]),
                page_coverage: Some(JsPageCoverageConfig {
                    enabled: Some(true),
                    min_page_ratio: Some(0.5),
                    force_common: None,
                }),
                size_budget: Some(JsSizeBudgetConfig {
                    enabled: Some(false),
                    max_chunk_size: None,
                    isolate_variables: Some(false),
                }),
                minify: Some(true),
            },
            Some(20),
        )
        .expect("explained");
        assert!(!explained.pipeline.chunks.is_empty());
        assert!(explained.report_json.contains("schemaVersion"));

        let report_json = optimize_css_report(
            JsPipelineInput {
                css_content:
                    ":root { --brand: red; } .shared { color: var(--brand); } .dead { color: blue; }"
                        .into(),
                page_usage: HashMap::from([
                    ("home".into(), vec!["shared".into()]),
                    ("about".into(), vec!["shared".into()]),
                ]),
                page_coverage: Some(JsPageCoverageConfig {
                    enabled: Some(true),
                    min_page_ratio: Some(0.5),
                    force_common: None,
                }),
                size_budget: Some(JsSizeBudgetConfig {
                    enabled: Some(true),
                    max_chunk_size: Some(10_000),
                    isolate_variables: Some(true),
                }),
                minify: Some(true),
            },
            Some(20),
        )
        .expect("report");
        let report: serde_json::Value = serde_json::from_str(&report_json).unwrap();
        assert_eq!(report["schemaVersion"], 1);
        assert!(report["decisions"].is_array());
        assert!(
            report["operations"]["deadCodeEliminated"]
                .as_bool()
                .unwrap()
        );

        let fix_json = apply_css_fixes(JsFixInput {
            css_content: ".ok { color: red; } .empty { }".into(),
            file_path: Some("demo.css".into()),
            dry_run: Some(false),
            rules: Some(vec!["dead.empty-rule".into()]),
            include_review: Some(false),
        })
        .expect("fix");
        let fix: serde_json::Value = serde_json::from_str(&fix_json).unwrap();
        assert_eq!(fix["changed"], true);
        assert!(!fix["fixedCss"].as_str().unwrap().contains(".empty"));
    }

    #[test]
    fn creates_and_compares_baselines() {
        let baseline = create_baseline(JsBaselineCreateInput {
            files: vec![JsBaselineFileInput {
                path: "src/a.css".into(),
                css_content: ".a { color: red; }".into(),
                size_bytes: Some(16),
            }],
            tool_version: "1.0.0".into(),
            created_at: Some("2026-11-01T00:00:00Z".into()),
            patterns: Some(vec!["src/**/*.css".into()]),
            threshold: None,
            project: None,
            git: None,
            weights: None,
            thresholds: None,
        })
        .expect("baseline create");

        let validation = validate_baseline(baseline.clone(), "1.0.0".into()).expect("validate");
        assert_eq!(validation.status, "compatible");

        let current = create_baseline(JsBaselineCreateInput {
            files: vec![JsBaselineFileInput {
                path: "src/a.css".into(),
                css_content: ".a { color: red; } .b { color: blue; } .c{}".into(),
                size_bytes: None,
            }],
            tool_version: "1.0.0".into(),
            created_at: Some("2026-11-04T00:00:00Z".into()),
            patterns: Some(vec!["src/**/*.css".into()]),
            threshold: None,
            project: None,
            git: None,
            weights: None,
            thresholds: None,
        })
        .expect("current create");

        let report_json = compare_baselines(
            baseline,
            current,
            Some(JsCompareOptions {
                score_tolerance: Some(0),
                size_absolute_tolerance_bytes: Some(0),
                size_increase_percent: Some(1.0),
                count_absolute_tolerance: Some(0),
                count_increase_percent: Some(1.0),
            }),
            Some(JsQualityGateConfig {
                fail_on_regression: Some(true),
                max_size_increase_percent: Some(5.0),
                ..JsQualityGateConfig::default()
            }),
        )
        .expect("compare");

        let report: serde_json::Value =
            serde_json::from_str(&report_json).expect("regression json");
        assert_eq!(report["schemaVersion"], 1);
        assert!(report["status"].is_string());
        assert!(report["qualityGates"].is_object());
    }

    #[test]
    fn maps_pipeline_output_and_defaults() {
        let input = JsPipelineInput {
            css_content: ":root { --brand: red; } .a { color: var(--brand); } .b { color: blue; }"
                .to_string(),
            page_usage: HashMap::from([("home".to_string(), vec!["a".to_string()])]),
            page_coverage: Some(JsPageCoverageConfig {
                enabled: Some(false),
                min_page_ratio: None,
                force_common: None,
            }),
            size_budget: Some(JsSizeBudgetConfig {
                enabled: Some(true),
                max_chunk_size: Some(40),
                isolate_variables: Some(true),
            }),
            minify: Some(true),
        };

        let output = optimize_css(input).expect("pipeline succeeds");

        assert!(!output.page_coverage_applied);
        assert!(output.size_budget_applied);
        assert!(output.chunks.iter().any(|chunk| chunk.variables));
        assert!(output.chunks.iter().any(|chunk| chunk.part.is_some()));
        assert!(output.chunks.iter().all(|chunk| !chunk.name.is_empty()));
    }
}
