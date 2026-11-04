//! CSS Health Score — deterministic, explainable stylesheet quality scoring.
//!
//! The engine reuses [`crate::analyze_css`] for selectors/rules and performs a
//! focused second pass for custom-property definitions. Page-usage based dead
//! CSS is only confirmed when callers supply page usage; otherwise empty rules
//! are the only confirmed dead-CSS signal.

mod config;
mod dimensions;
mod model;
mod scoring;

pub use config::{HealthScoreConfig, HealthThresholds, HealthWeights};
pub use model::{
    DiagnosticCertainty, DimensionId, DimensionScore, HealthDiagnostic, HealthGrade, HealthReport,
    HealthScoreSummary, HealthSeverity, HealthStatus, ScoreBand,
};
pub use scoring::{
    HealthEvaluationInput, evaluate_css_health, evaluate_health_report, grade_for_score,
    merge_health_reports,
};
