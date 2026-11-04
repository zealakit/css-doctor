//! Shared data model for optimization decisions.

use serde::{Deserialize, Serialize};

/// High-level optimization category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DecisionCategory {
    PageCoverage,
    SizeBudget,
    VariableIsolation,
    DeadCode,
    Minification,
    Autofix,
}

/// Specific decision kind within a category.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum DecisionType {
    MoveToCommon,
    MoveToPage,
    ForceCommon,
    RemoveDead,
    SplitBySize,
    OversizedChunk,
    IsolateVariables,
    Minify,
    SkipIncompleteCoverage,
    RetainUncertain,
    RemoveEmptyRule,
    RemoveDuplicateDeclaration,
}

/// Confidence based on available evidence (never inflated).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DecisionConfidence {
    High,
    Medium,
    Low,
}

/// Source location / selector that a decision refers to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationSource {
    pub file: Option<String>,
    pub selector: Option<String>,
    pub line: Option<u32>,
    pub column: Option<u32>,
}

/// Byte / count impact for a decision when measurable.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationImpact {
    pub bytes_before: Option<usize>,
    pub bytes_after: Option<usize>,
    pub rules_affected: Option<usize>,
    pub selectors_affected: Option<usize>,
}

/// One explainable optimization decision backed by pipeline/analysis metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OptimizationDecision {
    pub id: String,
    pub category: DecisionCategory,
    #[serde(rename = "type")]
    pub decision_type: DecisionType,
    pub title: String,
    pub explanation: String,
    pub reason: String,
    pub source: OptimizationSource,
    pub destination: Option<String>,
    pub impact: OptimizationImpact,
    pub confidence: DecisionConfidence,
    /// Whether emitted CSS differs from the input for this decision.
    pub changed: bool,
    pub related_diagnostics: Vec<String>,
    /// Optional routes that contributed to page-coverage classification.
    pub routes: Vec<String>,
}
