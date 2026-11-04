//! Configurable weights and thresholds for CSS Health Score.

use serde::{Deserialize, Serialize};

use super::model::ScoreBand;

/// Weights for the five health dimensions. Values should sum to approximately 1.0;
/// the scorer renormalizes whatever positive weights are provided.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthWeights {
    pub selector_complexity: f64,
    pub duplicate_rules: f64,
    pub css_size_efficiency: f64,
    pub dead_css: f64,
    pub variable_consistency: f64,
}

impl Default for HealthWeights {
    fn default() -> Self {
        Self {
            selector_complexity: 0.20,
            duplicate_rules: 0.20,
            css_size_efficiency: 0.20,
            dead_css: 0.25,
            variable_consistency: 0.15,
        }
    }
}

/// Deterministic thresholds used by dimension analyzers.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthThresholds {
    /// Specificity ids + classes components above this is high specificity.
    pub high_specificity_classes: u16,
    /// Number of id components that alone marks a selector as high specificity.
    pub high_specificity_ids: u16,
    /// Combinator count (descendant chains) considered deep.
    pub deep_combinator_count: usize,
    /// Nesting depth (style-rule nesting) considered deep.
    pub deep_nesting_depth: usize,
    /// Selector compound/simple-token length considered long.
    pub long_selector_token_count: usize,
    /// Stylesheet size in bytes that starts size-efficiency warnings.
    pub large_stylesheet_bytes: usize,
    /// Stylesheet size in bytes treated as critical.
    pub critical_stylesheet_bytes: usize,
    /// Declarations per rule that starts an efficiency warning.
    pub heavy_rule_declarations: usize,
    /// Selector count that starts a size/complexity pressure warning.
    pub many_selectors: usize,
}

impl Default for HealthThresholds {
    fn default() -> Self {
        Self {
            high_specificity_classes: 4,
            high_specificity_ids: 1,
            deep_combinator_count: 4,
            deep_nesting_depth: 4,
            long_selector_token_count: 6,
            large_stylesheet_bytes: 100 * 1024,
            critical_stylesheet_bytes: 300 * 1024,
            heavy_rule_declarations: 25,
            many_selectors: 500,
        }
    }
}

/// Full health-score configuration.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthScoreConfig {
    pub weights: HealthWeights,
    pub thresholds: HealthThresholds,
    /// Grade bands inclusive on the lower bound except F which covers the rest.
    pub bands: Vec<ScoreBand>,
    /// Soft-cap on total penalty points deducted per dimension (0–100 scale).
    pub max_dimension_penalty: f64,
    /// Severity penalties before diminishing returns.
    pub error_penalty: f64,
    pub warning_penalty: f64,
    pub info_penalty: f64,
    /// Diminishing factor applied to successive penalties within a dimension.
    pub penalty_decay: f64,
}

impl Default for HealthScoreConfig {
    fn default() -> Self {
        Self {
            weights: HealthWeights::default(),
            thresholds: HealthThresholds::default(),
            bands: ScoreBand::default_bands(),
            max_dimension_penalty: 85.0,
            error_penalty: 15.0,
            warning_penalty: 8.0,
            info_penalty: 3.0,
            penalty_decay: 0.88,
        }
    }
}

impl HealthScoreConfig {
    /// Validates numeric configuration.
    ///
    /// # Errors
    ///
    /// Returns a descriptive error when values are non-finite or out of range.
    pub fn validate(&self) -> Result<(), String> {
        let weights = [
            self.weights.selector_complexity,
            self.weights.duplicate_rules,
            self.weights.css_size_efficiency,
            self.weights.dead_css,
            self.weights.variable_consistency,
        ];

        if weights
            .iter()
            .any(|value| !value.is_finite() || *value < 0.0)
        {
            return Err("health weights must be finite and >= 0".to_string());
        }

        if weights.iter().sum::<f64>() <= 0.0 {
            return Err("at least one health weight must be > 0".to_string());
        }

        for value in [
            self.max_dimension_penalty,
            self.error_penalty,
            self.warning_penalty,
            self.info_penalty,
            self.penalty_decay,
        ] {
            if !value.is_finite() || value < 0.0 {
                return Err("health penalties must be finite and >= 0".to_string());
            }
        }

        if self.penalty_decay > 1.0 {
            return Err("penalty_decay must be between 0 and 1".to_string());
        }

        if self.bands.is_empty() {
            return Err("at least one score band is required".to_string());
        }

        Ok(())
    }
}
