//! Public data model for CSS Health Score reports.

use serde::{Deserialize, Serialize};

use crate::model::SourceLocation;

/// Severity of a health diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthSeverity {
    /// Critical correctness or serious CSS quality issue.
    Error,
    /// Potentially harmful CSS pattern.
    Warning,
    /// Optimization opportunity.
    Info,
}

/// Whether a finding is confirmed from static facts or heuristic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DiagnosticCertainty {
    /// Based on facts in the stylesheet alone (e.g. empty rule, duplicate selector text).
    Confirmed,
    /// Plausible issue that may be intentional or context-dependent.
    Heuristic,
}

/// Dimension identifiers used in reports and diagnostics.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DimensionId {
    SelectorComplexity,
    DuplicateRules,
    CssSizeEfficiency,
    DeadCss,
    VariableConsistency,
}

impl DimensionId {
    #[must_use]
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::SelectorComplexity => "selectorComplexity",
            Self::DuplicateRules => "duplicateRules",
            Self::CssSizeEfficiency => "cssSizeEfficiency",
            Self::DeadCss => "deadCss",
            Self::VariableConsistency => "variableConsistency",
        }
    }
}

/// Letter grade for an overall or dimension score.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum HealthGrade {
    A,
    B,
    C,
    D,
    F,
}

/// Human status label paired with a grade.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HealthStatus {
    Excellent,
    Good,
    Fair,
    Poor,
    Critical,
    /// Dimension could not be evaluated reliably.
    InsufficientData,
}

/// Inclusive score band used for grading.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScoreBand {
    pub min_score: u8,
    pub grade: HealthGrade,
    pub status: HealthStatus,
}

impl ScoreBand {
    #[must_use]
    pub fn default_bands() -> Vec<Self> {
        vec![
            Self {
                min_score: 90,
                grade: HealthGrade::A,
                status: HealthStatus::Excellent,
            },
            Self {
                min_score: 80,
                grade: HealthGrade::B,
                status: HealthStatus::Good,
            },
            Self {
                min_score: 70,
                grade: HealthGrade::C,
                status: HealthStatus::Fair,
            },
            Self {
                min_score: 60,
                grade: HealthGrade::D,
                status: HealthStatus::Poor,
            },
            Self {
                min_score: 0,
                grade: HealthGrade::F,
                status: HealthStatus::Critical,
            },
        ]
    }
}

/// A single health diagnostic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthDiagnostic {
    /// Stable machine-readable code, e.g. `selector.high-specificity`.
    pub code: String,
    pub severity: HealthSeverity,
    pub category: DimensionId,
    pub message: String,
    pub file_path: Option<String>,
    pub location: Option<SourceLocation>,
    pub selector: Option<String>,
    pub remediation: String,
    pub certainty: DiagnosticCertainty,
}

/// Score and metadata for one dimension.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionScore {
    pub id: DimensionId,
    /// `None` when the dimension could not be evaluated.
    pub score: Option<u8>,
    pub weight: f64,
    /// Renormalized weight actually applied to the overall score.
    pub effective_weight: f64,
    pub evaluated: bool,
    pub issue_count: usize,
    pub error_count: usize,
    pub warning_count: usize,
    pub info_count: usize,
    pub diagnostic_codes: Vec<String>,
    pub recommendations: Vec<String>,
    pub note: Option<String>,
}

/// Aggregate counters for a health report.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthScoreSummary {
    pub files: usize,
    pub rules: usize,
    pub selectors: usize,
    pub declarations: usize,
    pub size_bytes: usize,
    pub errors: usize,
    pub warnings: usize,
    pub suggestions: usize,
    pub analysis_ms: f64,
}

/// Complete health report for one or more stylesheets.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthReport {
    pub schema_version: u32,
    pub overall: u8,
    pub grade: HealthGrade,
    pub status: HealthStatus,
    pub dimensions: Vec<DimensionScore>,
    pub summary: HealthScoreSummary,
    pub diagnostics: Vec<HealthDiagnostic>,
    pub recommendations: Vec<String>,
}
