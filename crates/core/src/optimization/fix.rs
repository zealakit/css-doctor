//! Safe autofix engine for confirmed, semantics-preserving CSS transforms.

use std::collections::BTreeSet;

use lightningcss::properties::Property;
use lightningcss::properties::custom::CustomPropertyName;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserOptions, PrinterOptions, StyleSheet};
use serde::{Deserialize, Serialize};

use crate::health::{HealthDiagnostic, HealthScoreConfig, evaluate_css_health};
use crate::model::SourceLocation;

use super::model::{
    DecisionCategory, DecisionConfidence, DecisionType, OptimizationDecision, OptimizationImpact,
    OptimizationSource,
};

/// Safety classification for autofixes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FixSafety {
    Safe,
    Review,
    Unsafe,
}

/// Catalog entry describing a known fix rule.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixCatalogEntry {
    pub id: String,
    pub description: String,
    pub safety: FixSafety,
    pub reason: String,
}

/// One planned fix occurrence.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixPlanItem {
    pub id: String,
    pub rule: String,
    pub safety: FixSafety,
    pub message: String,
    pub file_path: Option<String>,
    pub location: Option<SourceLocation>,
    pub selector: Option<String>,
    pub applied: bool,
    pub skipped_reason: Option<String>,
}

/// Planned fixes for a stylesheet.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixPlan {
    pub schema_version: u32,
    pub file_path: Option<String>,
    pub items: Vec<FixPlanItem>,
    pub safe_count: usize,
    pub review_count: usize,
    pub unsafe_count: usize,
}

/// Result of applying (or dry-running) fixes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FixApplicationResult {
    pub schema_version: u32,
    pub file_path: Option<String>,
    pub original_css: String,
    pub fixed_css: String,
    pub changed: bool,
    pub dry_run: bool,
    pub plan: FixPlan,
    pub decisions: Vec<OptimizationDecision>,
    pub bytes_before: usize,
    pub bytes_after: usize,
}

/// Options for applying fixes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplyFixesOptions {
    pub dry_run: bool,
    /// Only apply these rule ids when non-empty (e.g. `dead.empty-rule`).
    pub rules: Vec<String>,
    /// When true, also apply Review fixes (never Unsafe).
    pub include_review: bool,
}

impl Default for ApplyFixesOptions {
    fn default() -> Self {
        Self {
            dry_run: true,
            rules: Vec::new(),
            include_review: false,
        }
    }
}

/// Lists built-in autofix rules and their safety levels.
#[must_use]
pub fn list_fix_catalog() -> Vec<FixCatalogEntry> {
    vec![
        FixCatalogEntry {
            id: "dead.empty-rule".into(),
            description: "Remove style rules with no declarations and no nested rules.".into(),
            safety: FixSafety::Safe,
            reason: "Empty rules never match declarations; cascade is unchanged.".into(),
        },
        FixCatalogEntry {
            id: "duplicate.declaration".into(),
            description:
                "Remove earlier duplicate property declarations within the same rule list.".into(),
            safety: FixSafety::Safe,
            reason: "Within a single declaration list, the last declaration of a property wins."
                .into(),
        },
        FixCatalogEntry {
            id: "duplicate.selector".into(),
            description: "Consolidate repeated selectors across rules.".into(),
            safety: FixSafety::Review,
            reason: "Merging may change cascade order across intervening rules.".into(),
        },
        FixCatalogEntry {
            id: "variable.unused-definition".into(),
            description: "Remove unused custom property definitions.".into(),
            safety: FixSafety::Unsafe,
            reason: "Usage may be cross-file or runtime-dynamic.".into(),
        },
    ]
}

/// Plans fixes for a stylesheet without mutating it.
///
/// # Errors
///
/// Returns an error when CSS health evaluation fails.
pub fn plan_css_fixes(css: &str, file_path: Option<&str>) -> Result<FixPlan, String> {
    let report = evaluate_css_health(
        css,
        file_path,
        Some(css.len()),
        &HealthScoreConfig::default(),
    )?;
    let catalog = list_fix_catalog();
    let mut items = Vec::new();

    for diagnostic in &report.diagnostics {
        if let Some(entry) = catalog.iter().find(|entry| entry.id == diagnostic.code) {
            items.push(plan_item_from_diagnostic(
                diagnostic,
                entry.safety,
                false,
                None,
            ));
        }
    }

    // Count potential safe transforms even when health did not emit (defensive).
    finalize_plan_counts(file_path, items)
}

/// Applies safe autofixes (or dry-runs them) using LightningCSS AST rewrites.
///
/// # Errors
///
/// Returns an error when parsing or serialization fails.
pub fn apply_css_fixes(
    css: &str,
    file_path: Option<&str>,
    options: &ApplyFixesOptions,
) -> Result<FixApplicationResult, String> {
    let plan = plan_css_fixes(css, file_path)?;
    let allowed: BTreeSet<String> = if options.rules.is_empty() {
        list_fix_catalog()
            .into_iter()
            .filter(|entry| {
                matches!(entry.safety, FixSafety::Safe)
                    || (options.include_review && matches!(entry.safety, FixSafety::Review))
            })
            .map(|entry| entry.id)
            .collect()
    } else {
        options.rules.iter().cloned().collect()
    };

    // Reject Unsafe selections explicitly.
    for rule in &allowed {
        if list_fix_catalog()
            .iter()
            .any(|entry| entry.id == *rule && matches!(entry.safety, FixSafety::Unsafe))
        {
            return Err(format!(
                "refusing to apply unsafe fix `{rule}`; remove it from --rule selection"
            ));
        }
        if !options.include_review
            && list_fix_catalog()
                .iter()
                .any(|entry| entry.id == *rule && matches!(entry.safety, FixSafety::Review))
        {
            return Err(format!(
                "fix `{rule}` requires review; pass includeReview or omit it from --rule"
            ));
        }
    }

    let apply_empty = allowed.contains("dead.empty-rule");
    let apply_dup = allowed.contains("duplicate.declaration");

    let fixed_css = if apply_empty || apply_dup {
        transform_css(css, apply_empty, apply_dup)?
    } else {
        css.to_string()
    };

    let changed = fixed_css != css;
    let bytes_after = fixed_css.len();
    let mut items = Vec::new();
    let mut decisions = Vec::new();
    let mut counter = 0usize;

    for item in plan.items {
        let selected = allowed.contains(&item.rule);
        let safety_ok = matches!(item.safety, FixSafety::Safe)
            || (options.include_review && matches!(item.safety, FixSafety::Review));
        let (applied, skipped_reason) = if !selected {
            (false, Some("rule not selected".to_string()))
        } else if !safety_ok {
            (false, Some(format!("{:?} fix not enabled", item.safety)))
        } else if !changed && !options.dry_run {
            (
                false,
                Some("no matching transform produced a change".into()),
            )
        } else if selected && safety_ok && (changed || options.dry_run) {
            // Dry-run marks applicable safe items as would-apply when diagnostic present.
            (true, None)
        } else {
            (false, Some("skipped".into()))
        };

        if applied {
            counter += 1;
            decisions.push(OptimizationDecision {
                id: format!("autofix-{counter:03}"),
                category: DecisionCategory::Autofix,
                decision_type: if item.rule == "dead.empty-rule" {
                    DecisionType::RemoveEmptyRule
                } else {
                    DecisionType::RemoveDuplicateDeclaration
                },
                title: item.message.clone(),
                explanation: format!("Autofix `{}` ({:?}).", item.rule, item.safety),
                reason: list_fix_catalog()
                    .into_iter()
                    .find(|entry| entry.id == item.rule)
                    .map(|entry| entry.reason)
                    .unwrap_or_default(),
                source: OptimizationSource {
                    file: item.file_path.clone(),
                    selector: item.selector.clone(),
                    line: item.location.map(|location| location.line),
                    column: item.location.map(|location| location.column),
                },
                destination: item.file_path.clone(),
                impact: OptimizationImpact {
                    bytes_before: Some(css.len()),
                    bytes_after: Some(fixed_css.len()),
                    rules_affected: Some(1),
                    selectors_affected: None,
                },
                confidence: DecisionConfidence::High,
                changed: !options.dry_run && changed,
                related_diagnostics: vec![item.rule.clone()],
                routes: Vec::new(),
            });
        }

        items.push(FixPlanItem {
            applied,
            skipped_reason,
            ..item
        });
    }

    // Mark review/unsafe diagnostics that were not applied.
    for item in items.iter_mut() {
        if item.skipped_reason.is_none() && !item.applied {
            item.skipped_reason = Some("not applied".into());
        }
    }

    let plan = finalize_plan_counts(file_path, items)?;

    Ok(FixApplicationResult {
        schema_version: 1,
        file_path: file_path.map(ToOwned::to_owned),
        original_css: css.to_string(),
        // Dry-run still computes the transform for preview/diff metrics; callers
        // must not write files when dry_run is true.
        fixed_css,
        changed,
        dry_run: options.dry_run,
        plan,
        decisions,
        bytes_before: css.len(),
        bytes_after,
    })
}

fn finalize_plan_counts(
    file_path: Option<&str>,
    items: Vec<FixPlanItem>,
) -> Result<FixPlan, String> {
    let safe_count = items
        .iter()
        .filter(|item| matches!(item.safety, FixSafety::Safe))
        .count();
    let review_count = items
        .iter()
        .filter(|item| matches!(item.safety, FixSafety::Review))
        .count();
    let unsafe_count = items
        .iter()
        .filter(|item| matches!(item.safety, FixSafety::Unsafe))
        .count();

    Ok(FixPlan {
        schema_version: 1,
        file_path: file_path.map(ToOwned::to_owned),
        items,
        safe_count,
        review_count,
        unsafe_count,
    })
}

fn plan_item_from_diagnostic(
    diagnostic: &HealthDiagnostic,
    safety: FixSafety,
    applied: bool,
    skipped_reason: Option<String>,
) -> FixPlanItem {
    FixPlanItem {
        id: format!(
            "{}:{}:{}",
            diagnostic.code,
            diagnostic
                .location
                .map(|location| location.line)
                .unwrap_or(0),
            diagnostic.selector.clone().unwrap_or_default()
        ),
        rule: diagnostic.code.clone(),
        safety,
        message: diagnostic.message.clone(),
        file_path: diagnostic.file_path.clone(),
        location: diagnostic.location,
        selector: diagnostic.selector.clone(),
        applied,
        skipped_reason,
    }
}

fn transform_css(
    css: &str,
    remove_empty: bool,
    dedupe_declarations: bool,
) -> Result<String, String> {
    if css.trim().is_empty() {
        return Ok(String::new());
    }

    let mut stylesheet = StyleSheet::parse(
        css,
        ParserOptions {
            filename: "<css-doctor-fix>".to_string(),
            error_recovery: true,
            ..ParserOptions::default()
        },
    )
    .map_err(|error| format!("failed to parse CSS for autofix: {error}"))?;

    stylesheet.rules.0 = clean_rule_list(stylesheet.rules.0, remove_empty, dedupe_declarations);

    stylesheet
        .to_css(PrinterOptions {
            minify: false,
            ..PrinterOptions::default()
        })
        .map(|result| result.code)
        .map_err(|error| format!("failed to serialize fixed CSS: {error}"))
}

fn clean_rule_list(
    rules: Vec<CssRule<'_>>,
    remove_empty: bool,
    dedupe_declarations: bool,
) -> Vec<CssRule<'_>> {
    let mut cleaned = Vec::with_capacity(rules.len());

    for rule in rules {
        match rule {
            CssRule::Style(mut style) => {
                if dedupe_declarations {
                    dedupe_style_declarations(&mut style);
                }
                style.rules.0 = clean_rule_list(style.rules.0, remove_empty, dedupe_declarations);
                let empty = style.declarations.declarations.is_empty()
                    && style.declarations.important_declarations.is_empty()
                    && style.rules.0.is_empty();
                if remove_empty && empty {
                    continue;
                }
                cleaned.push(CssRule::Style(style));
            }
            CssRule::Media(mut media) => {
                media.rules.0 = clean_rule_list(media.rules.0, remove_empty, dedupe_declarations);
                if remove_empty && media.rules.0.is_empty() {
                    continue;
                }
                cleaned.push(CssRule::Media(media));
            }
            CssRule::Supports(mut supports) => {
                supports.rules.0 =
                    clean_rule_list(supports.rules.0, remove_empty, dedupe_declarations);
                if remove_empty && supports.rules.0.is_empty() {
                    continue;
                }
                cleaned.push(CssRule::Supports(supports));
            }
            CssRule::LayerBlock(mut layer) => {
                layer.rules.0 = clean_rule_list(layer.rules.0, remove_empty, dedupe_declarations);
                if remove_empty && layer.rules.0.is_empty() {
                    continue;
                }
                cleaned.push(CssRule::LayerBlock(layer));
            }
            CssRule::Container(mut container) => {
                container.rules.0 =
                    clean_rule_list(container.rules.0, remove_empty, dedupe_declarations);
                if remove_empty && container.rules.0.is_empty() {
                    continue;
                }
                cleaned.push(CssRule::Container(container));
            }
            other => cleaned.push(other),
        }
    }

    cleaned
}

fn dedupe_style_declarations(style: &mut lightningcss::rules::style::StyleRule<'_>) {
    style.declarations.declarations =
        keep_last_unique_properties(std::mem::take(&mut style.declarations.declarations));
    style.declarations.important_declarations = keep_last_unique_properties(std::mem::take(
        &mut style.declarations.important_declarations,
    ));
}

fn keep_last_unique_properties(properties: Vec<Property<'_>>) -> Vec<Property<'_>> {
    let mut seen = BTreeSet::new();
    let mut kept = Vec::new();

    for property in properties.into_iter().rev() {
        let name = property_key(&property);
        if seen.insert(name) {
            kept.push(property);
        }
    }

    kept.reverse();
    kept
}

fn property_key(property: &Property<'_>) -> String {
    match property {
        Property::Custom(custom) => match &custom.name {
            CustomPropertyName::Custom(name) => {
                let raw = name.as_ref();
                if raw.starts_with("--") {
                    raw.to_ascii_lowercase()
                } else {
                    format!("--{}", raw.to_ascii_lowercase())
                }
            }
            CustomPropertyName::Unknown(name) => name.as_ref().to_ascii_lowercase(),
        },
        other => format!("{other:?}")
            .split_whitespace()
            .next()
            .unwrap_or("property")
            .trim_matches(|ch| ch == '(' || ch == ')')
            .to_ascii_lowercase(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_empty_rules_safely() {
        let css = ".ok { color: red; } .dead { }";
        let result = apply_css_fixes(
            css,
            Some("a.css"),
            &ApplyFixesOptions {
                dry_run: false,
                rules: vec!["dead.empty-rule".into()],
                include_review: false,
            },
        )
        .unwrap();

        assert!(result.changed);
        assert!(result.fixed_css.contains(".ok"));
        assert!(!result.fixed_css.contains(".dead"));
        assert!(result.plan.items.iter().any(|item| item.applied));
    }

    #[test]
    fn removes_duplicate_declarations_keeping_last() {
        let css = ".a { color: red; color: blue; }";
        let result = apply_css_fixes(
            css,
            Some("a.css"),
            &ApplyFixesOptions {
                dry_run: false,
                rules: vec!["duplicate.declaration".into()],
                include_review: false,
            },
        )
        .unwrap();

        assert!(result.changed);
        // LightningCSS may serialize `blue` as `#00f`.
        assert!(
            result.fixed_css.contains("blue") || result.fixed_css.contains("#00f"),
            "fixed css: {}",
            result.fixed_css
        );
        assert!(!result.fixed_css.contains("red") && !result.fixed_css.contains("#f00"));
        let color_count = result.fixed_css.matches("color:").count();
        assert_eq!(color_count, 1);
    }

    #[test]
    fn refuses_unsafe_rules() {
        let err = apply_css_fixes(
            ".a { color: red; }",
            None,
            &ApplyFixesOptions {
                dry_run: true,
                rules: vec!["variable.unused-definition".into()],
                include_review: false,
            },
        )
        .unwrap_err();
        assert!(err.contains("unsafe"));
    }

    #[test]
    fn dry_run_does_not_claim_source_write() {
        let css = ".dead { }";
        let result = apply_css_fixes(
            css,
            None,
            &ApplyFixesOptions {
                dry_run: true,
                rules: vec!["dead.empty-rule".into()],
                include_review: false,
            },
        )
        .unwrap();
        assert!(result.dry_run);
        assert!(result.changed);
        assert_eq!(result.original_css, css);
    }

    #[test]
    fn catalog_lists_safety_levels() {
        let catalog = list_fix_catalog();
        assert!(
            catalog
                .iter()
                .any(|entry| entry.id == "dead.empty-rule"
                    && matches!(entry.safety, FixSafety::Safe))
        );
        assert!(
            catalog
                .iter()
                .any(|entry| entry.id == "variable.unused-definition"
                    && matches!(entry.safety, FixSafety::Unsafe))
        );
    }

    #[test]
    fn ignores_certainty_heuristic_for_unsafe_catalog_only() {
        // Ensure confirmed empty-rule diagnostics are planned.
        let plan = plan_css_fixes(".x{}", Some("x.css")).unwrap();
        assert!(plan.safe_count >= 1);
        assert!(
            plan.items.iter().any(
                |item| item.rule == "dead.empty-rule" && matches!(item.safety, FixSafety::Safe)
            )
        );
    }
}
