//! CSS quality baselines and regression comparison.
//!
//! Baselines capture Health Score aggregates, per-file fingerprints, and
//! diagnostic fingerprints (without full CSS source). Comparison classifies
//! score, size, diagnostic, and file-level changes for CI quality gates.

mod baseline;
mod compare;
mod fingerprint;
mod gates;

pub use baseline::{
    BaselineConfigSnapshot, BaselineDiagnostic, BaselineDimensionScore, BaselineDocument,
    BaselineFileEntry, BaselineGitMetadata, BaselineHealthSnapshot, BaselineProjectMetadata,
    BaselineValidation, CURRENT_BASELINE_SCHEMA, validate_baseline_document,
};
pub use compare::{
    CompareOptions, CountDelta, DiagnosticChangeSet, DiagnosticDiffEntry, DimensionDelta,
    FileChangeSet, FileDiffEntry, RegressionChanges, RegressionReport, RegressionStatus, SizeDelta,
    SnapshotRef, compare_baselines, compare_baselines_with_gates,
};
pub use fingerprint::{content_fingerprint, diagnostic_fingerprint, normalize_relative_path};
pub use gates::{
    GateCheckResult, GateEvaluation, MinDimensionScore, QualityGateConfig, evaluate_quality_gates,
};
