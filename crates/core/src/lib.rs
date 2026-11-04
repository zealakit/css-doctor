//! Core analysis engine for [`css-doctor`](https://github.com/zealakit/css-doctor).
//!
//! `css_doctor_core` parses CSS with [`lightningcss`], walks the resulting AST
//! with a visitor, and exposes every selector in a serializable form. The
//! Public layers built on this crate:
//!
//! * **Usage analysis** — [`UsageMatrix`] counts selectors and the symbols they
//!   reference.
//! * **Health Score / regression** — [`evaluate_css_health`], baselines, and
//!   quality gates.
//! * **Optimization intelligence** — explanations, reports, and Safe autofixes.
//! * **Page-coverage chunk splitting** — [`split_css_by_pages`] turns a
//!   stylesheet plus per-page class usage into common/page CSS chunks and
//!   drops dead selectors.
//! * **Two-tier pipeline** — [`optimize_css_pipeline`] combines coverage, size
//!   budget, variable isolation, and minification.
//!
//! # Example
//!
//! ```
//! use css_doctor_core::analyze_css;
//!
//! let result = analyze_css(
//!     r#"
//!     #app .card:hover { color: red; }
//!     @media (min-width: 768px) {
//!       .card--wide { width: 100%; }
//!     }
//!     "#,
//! )
//! .unwrap();
//!
//! assert_eq!(result.selectors.len(), 2);
//! assert_eq!(result.selectors[0].ids, ["app"]);
//! assert_eq!(result.selectors[0].classes, ["card"]);
//! assert_eq!(result.selectors[0].pseudo_classes, ["hover"]);
//! assert_eq!(result.selectors[1].classes, ["card--wide"]);
//!
//! let json = result.to_json().unwrap();
//! let round_tripped = css_doctor_core::CssAnalysisResult::from_json(&json).unwrap();
//! assert_eq!(result, round_tripped);
//! ```

mod analyzer;
mod health;
mod model;
mod optimization;
mod pipeline;
mod regression;
mod size_splitter;
mod splitter;
mod usage;

pub use analyzer::analyze_css;
pub use health::{
    DiagnosticCertainty, DimensionId, DimensionScore, HealthDiagnostic, HealthEvaluationInput,
    HealthGrade, HealthReport, HealthScoreConfig, HealthScoreSummary, HealthSeverity, HealthStatus,
    HealthThresholds, HealthWeights, ScoreBand, evaluate_css_health, evaluate_health_report,
    grade_for_score, merge_health_reports,
};
pub use model::{
    AnalysisStats, AnalysisWarning, CssAnalysisResult, SelectorInfo, SelectorKind, SourceLocation,
    Specificity, StyleRuleInfo,
};
pub use optimization::{
    ApplyFixesOptions, DecisionCategory, DecisionConfidence, DecisionType, ExplainOptions,
    FixApplicationResult, FixCatalogEntry, FixPlan, FixPlanItem, FixSafety, OptimizationDecision,
    OptimizationImpact, OptimizationMetrics, OptimizationOperations, OptimizationReport,
    OptimizationSource, ReportOptions, apply_css_fixes, build_optimization_report,
    explain_pipeline, list_fix_catalog, plan_css_fixes,
};
pub use pipeline::{
    PageCoverageConfig, PipelineChunk, PipelineChunkKind, PipelineInput, PipelineOutput,
    SizeBudgetConfig, optimize_css_pipeline,
};
pub use regression::{
    BaselineConfigSnapshot, BaselineDiagnostic, BaselineDimensionScore, BaselineDocument,
    BaselineFileEntry, BaselineGitMetadata, BaselineHealthSnapshot, BaselineProjectMetadata,
    BaselineValidation, CURRENT_BASELINE_SCHEMA, CompareOptions, CountDelta, DiagnosticChangeSet,
    DiagnosticDiffEntry, DimensionDelta, FileChangeSet, FileDiffEntry, GateCheckResult,
    GateEvaluation, MinDimensionScore, QualityGateConfig, RegressionChanges, RegressionReport,
    RegressionStatus, SizeDelta, SnapshotRef, compare_baselines, compare_baselines_with_gates,
    content_fingerprint, diagnostic_fingerprint, evaluate_quality_gates, normalize_relative_path,
    validate_baseline_document,
};
pub use size_splitter::{SizeSplitOutput, SizeSplitterConfig, split_css_by_size};
pub use splitter::{ChunkConfig, SelectorStat, SplitInput, SplitOutput, split_css_by_pages};
pub use usage::UsageMatrix;
