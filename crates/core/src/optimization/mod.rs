//! Optimization intelligence: explanations, reports, and safe autofixes.
//!
//! Builds structured decisions from existing pipeline metadata and applies only
//! semantics-preserving source transforms (empty rules, intra-rule duplicate
//! declarations).

mod explain;
mod fix;
mod model;
mod report;

pub use explain::{ExplainOptions, explain_pipeline};
pub use fix::{
    ApplyFixesOptions, FixApplicationResult, FixCatalogEntry, FixPlan, FixPlanItem, FixSafety,
    apply_css_fixes, list_fix_catalog, plan_css_fixes,
};
pub use model::{
    DecisionCategory, DecisionConfidence, DecisionType, OptimizationDecision, OptimizationImpact,
    OptimizationSource,
};
pub use report::{
    OptimizationMetrics, OptimizationOperations, OptimizationReport, ReportOptions,
    build_optimization_report,
};
