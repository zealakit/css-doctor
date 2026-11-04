//! Dimension analyzers for CSS Health Score.

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::convert::Infallible;

use lightningcss::properties::Property;
use lightningcss::properties::custom::CustomPropertyName;
use lightningcss::rules::CssRule;
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use lightningcss::visit_types;
use lightningcss::visitor::{Visit, VisitTypes, Visitor};

use crate::model::{CssAnalysisResult, SourceLocation};

use super::config::HealthThresholds;
use super::model::{DiagnosticCertainty, DimensionId, HealthDiagnostic, HealthSeverity};

/// Input context shared by dimension analyzers.
pub struct AnalysisContext<'a> {
    pub analysis: &'a CssAnalysisResult,
    pub css_content: &'a str,
    pub size_bytes: usize,
    pub file_path: Option<&'a str>,
    pub thresholds: &'a HealthThresholds,
}

pub fn analyze_selector_complexity(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut seen_codes = BTreeSet::new();

    for selector in &ctx.analysis.selectors {
        let specificity_classes = selector.specificity.classes;
        let specificity_ids = selector.specificity.ids;
        let combinators = selector.combinators.len();
        let token_estimate = selector.classes.len()
            + selector.ids.len()
            + selector.tags.len()
            + selector.attributes.len()
            + selector.pseudo_classes.len()
            + selector.pseudo_elements.len();

        if specificity_ids >= ctx.thresholds.high_specificity_ids
            || specificity_classes >= ctx.thresholds.high_specificity_classes
        {
            let key = format!("selector.high-specificity:{}", selector.raw);
            if seen_codes.insert(key) {
                diagnostics.push(diag(
                    "selector.high-specificity",
                    HealthSeverity::Warning,
                    DimensionId::SelectorComplexity,
                    format!(
                        "High selector specificity {} for `{}`.",
                        selector.specificity, selector.raw
                    ),
                    ctx.file_path,
                    rule_location(ctx, selector.rule_index),
                    Some(selector.raw.clone()),
                    "Reduce unnecessary IDs/classes or split into simpler selectors.",
                    DiagnosticCertainty::Confirmed,
                ));
            }
        }

        if combinators >= ctx.thresholds.deep_combinator_count {
            let key = format!("selector.deep-combinators:{}", selector.raw);
            if seen_codes.insert(key) {
                diagnostics.push(diag(
                    "selector.deep-combinators",
                    HealthSeverity::Warning,
                    DimensionId::SelectorComplexity,
                    format!(
                        "Deep descendant/combinator chain ({} combinators) in `{}`.",
                        combinators, selector.raw
                    ),
                    ctx.file_path,
                    rule_location(ctx, selector.rule_index),
                    Some(selector.raw.clone()),
                    "Flatten selector chains or use a single class where practical.",
                    DiagnosticCertainty::Confirmed,
                ));
            }
        }

        if selector.nesting_depth >= ctx.thresholds.deep_nesting_depth {
            let key = format!(
                "selector.deep-nesting:{}:{}",
                selector.nesting_depth, selector.raw
            );
            if seen_codes.insert(key) {
                diagnostics.push(diag(
                    "selector.deep-nesting",
                    HealthSeverity::Info,
                    DimensionId::SelectorComplexity,
                    format!(
                        "Deep style nesting (depth {}) around `{}`.",
                        selector.nesting_depth, selector.raw
                    ),
                    ctx.file_path,
                    rule_location(ctx, selector.rule_index),
                    Some(selector.raw.clone()),
                    "Limit nesting depth to keep cascade intent clear.",
                    DiagnosticCertainty::Confirmed,
                ));
            }
        }

        if token_estimate >= ctx.thresholds.long_selector_token_count {
            let key = format!("selector.long-chain:{}", selector.raw);
            if seen_codes.insert(key) {
                diagnostics.push(diag(
                    "selector.long-chain",
                    HealthSeverity::Info,
                    DimensionId::SelectorComplexity,
                    format!(
                        "Long selector compound (~{} simple selectors) in `{}`.",
                        token_estimate, selector.raw
                    ),
                    ctx.file_path,
                    rule_location(ctx, selector.rule_index),
                    Some(selector.raw.clone()),
                    "Prefer shorter, purpose-built class selectors.",
                    DiagnosticCertainty::Confirmed,
                ));
            }
        }
    }

    diagnostics
}

pub fn analyze_duplicate_rules(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();
    let mut first_seen: HashMap<&str, (usize, Option<SourceLocation>)> = HashMap::new();

    for selector in &ctx.analysis.selectors {
        let location = rule_location(ctx, selector.rule_index);
        match first_seen.get(selector.raw.as_str()) {
            None => {
                first_seen.insert(selector.raw.as_str(), (selector.rule_index, location));
            }
            Some((first_rule, first_location)) if *first_rule != selector.rule_index => {
                let first_line = first_location
                    .map(|loc| loc.line.to_string())
                    .unwrap_or_else(|| "?".to_string());
                diagnostics.push(diag(
                    "duplicate.selector",
                    HealthSeverity::Warning,
                    DimensionId::DuplicateRules,
                    format!(
                        "Selector `{}` appears in multiple rules (first around line {}). Cascade order may be intentional.",
                        selector.raw, first_line
                    ),
                    ctx.file_path,
                    location,
                    Some(selector.raw.clone()),
                    "Review repeated selectors and merge only when cascade-safe.",
                    DiagnosticCertainty::Confirmed,
                ));
            }
            Some(_) => {}
        }
    }

    // Exact duplicate declaration names within a single rule (last wins).
    for rule in &ctx.analysis.rules {
        // declaration fingerprinting requires AST walk — collected elsewhere via
        // custom property pass which also returns intra-rule duplicates.
        let _ = rule;
    }

    diagnostics.extend(collect_intra_rule_duplicate_properties(ctx));
    diagnostics
}

pub fn analyze_size_efficiency(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();
    let stats = &ctx.analysis.stats;
    let declarations = stats.declaration_count + stats.important_declaration_count;

    if ctx.size_bytes >= ctx.thresholds.critical_stylesheet_bytes {
        diagnostics.push(diag(
            "size.critical-stylesheet",
            HealthSeverity::Error,
            DimensionId::CssSizeEfficiency,
            format!("Stylesheet is very large ({} bytes).", ctx.size_bytes),
            ctx.file_path,
            None,
            None,
            "Split by route/page coverage or size budget, and remove unused rules.",
            DiagnosticCertainty::Confirmed,
        ));
    } else if ctx.size_bytes >= ctx.thresholds.large_stylesheet_bytes {
        diagnostics.push(diag(
            "size.large-stylesheet",
            HealthSeverity::Warning,
            DimensionId::CssSizeEfficiency,
            format!("Stylesheet is large ({} bytes).", ctx.size_bytes),
            ctx.file_path,
            None,
            None,
            "Consider page-coverage splitting or raising size-budget checks in CI.",
            DiagnosticCertainty::Confirmed,
        ));
    }

    if stats.selector_count >= ctx.thresholds.many_selectors {
        diagnostics.push(diag(
            "size.many-selectors",
            HealthSeverity::Warning,
            DimensionId::CssSizeEfficiency,
            format!("High selector count ({} selectors).", stats.selector_count),
            ctx.file_path,
            None,
            None,
            "Audit for duplicates and unused selectors; split large sheets by route.",
            DiagnosticCertainty::Confirmed,
        ));
    }

    for rule in &ctx.analysis.rules {
        let total = rule.declaration_count + rule.important_declaration_count;
        if total >= ctx.thresholds.heavy_rule_declarations {
            let selector = ctx
                .analysis
                .selectors_of(rule)
                .next()
                .map(|selector| selector.raw.clone());
            diagnostics.push(diag(
                "size.heavy-rule",
                HealthSeverity::Info,
                DimensionId::CssSizeEfficiency,
                format!("Rule has {total} declarations."),
                ctx.file_path,
                Some(rule.location),
                selector,
                "Split large rules or extract shared declarations into utilities.",
                DiagnosticCertainty::Confirmed,
            ));
        }
    }

    if ctx.size_bytes > 0 && declarations > 0 {
        let bytes_per_declaration = ctx.size_bytes as f64 / declarations as f64;
        if bytes_per_declaration > 120.0 && ctx.size_bytes >= 8 * 1024 {
            diagnostics.push(diag(
                "size.low-density",
                HealthSeverity::Info,
                DimensionId::CssSizeEfficiency,
                format!(
                    "Low declaration density (~{bytes_per_declaration:.0} bytes/declaration).",
                ),
                ctx.file_path,
                None,
                None,
                "Check for verbose values, duplicated blocks, or comments/bloat in source CSS.",
                DiagnosticCertainty::Heuristic,
            ));
        }
    }

    diagnostics
}

pub fn analyze_dead_css(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();
    let parent_rule_indices: BTreeSet<usize> = ctx
        .analysis
        .rules
        .iter()
        .filter_map(|rule| rule.parent_rule_index)
        .collect();

    for rule in &ctx.analysis.rules {
        let has_no_declarations =
            rule.declaration_count == 0 && rule.important_declaration_count == 0;
        let has_no_nested_rules = !parent_rule_indices.contains(&rule.index);

        if has_no_declarations && has_no_nested_rules {
            let selector_text = ctx
                .analysis
                .selectors_of(rule)
                .map(|selector| selector.raw.as_str())
                .collect::<Vec<_>>()
                .join(", ");
            diagnostics.push(diag(
                "dead.empty-rule",
                HealthSeverity::Warning,
                DimensionId::DeadCss,
                if selector_text.is_empty() {
                    "Rule has no declarations and no nested rules.".to_string()
                } else {
                    format!("Rule `{selector_text}` has no declarations and no nested rules.")
                },
                ctx.file_path,
                Some(rule.location),
                if selector_text.is_empty() {
                    None
                } else {
                    Some(selector_text)
                },
                "Remove the empty rule or restore its declarations.",
                DiagnosticCertainty::Confirmed,
            ));
        }
    }

    for warning in &ctx.analysis.warnings {
        diagnostics.push(diag(
            "dead.syntax-warning",
            HealthSeverity::Info,
            DimensionId::DeadCss,
            format!("Parser skipped malformed CSS: {}", warning.message),
            ctx.file_path,
            warning.location,
            None,
            "Fix the syntax so the intended rule is not dropped during recovery.",
            DiagnosticCertainty::Confirmed,
        ));
    }

    diagnostics
}

pub fn analyze_variable_consistency(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();
    let definitions = collect_custom_property_definitions(ctx.css_content);
    let usages = collect_custom_property_usages(ctx.css_content);

    let mut defined_counts: BTreeMap<String, Vec<SourceLocation>> = BTreeMap::new();
    for (name, location) in &definitions {
        defined_counts
            .entry(name.clone())
            .or_default()
            .push(*location);
    }

    for (name, locations) in &defined_counts {
        if locations.len() > 1 {
            diagnostics.push(diag(
                "variable.duplicate-definition",
                HealthSeverity::Warning,
                DimensionId::VariableConsistency,
                format!(
                    "Custom property `--{name}` is defined {} times in this stylesheet.",
                    locations.len()
                ),
                ctx.file_path,
                locations.last().copied(),
                None,
                "Keep a single source of truth for each custom property when cascade allows.",
                DiagnosticCertainty::Confirmed,
            ));
        }

        if !usages.contains(name) {
            diagnostics.push(diag(
                "variable.unused-definition",
                HealthSeverity::Info,
                DimensionId::VariableConsistency,
                format!(
                    "Custom property `--{name}` is defined but never referenced via var() in this stylesheet."
                ),
                ctx.file_path,
                locations.first().copied(),
                None,
                "Remove unused variables or verify they are consumed by other stylesheets/runtime CSS.",
                DiagnosticCertainty::Heuristic,
            ));
        }
    }

    // Naming consistency: mixed --camelCase and --kebab-case among defined vars.
    let has_kebab = defined_counts
        .keys()
        .any(|name| name.contains('-') && name.chars().any(|ch| ch.is_ascii_lowercase()));
    let has_camel = defined_counts
        .keys()
        .any(|name| name.chars().any(|ch| ch.is_ascii_uppercase()) && !name.contains('-'));

    if has_kebab && has_camel && defined_counts.len() >= 3 {
        diagnostics.push(diag(
            "variable.naming-inconsistency",
            HealthSeverity::Info,
            DimensionId::VariableConsistency,
            "Custom property names mix kebab-case and camelCase in the same stylesheet."
                .to_string(),
            ctx.file_path,
            None,
            None,
            "Standardize on one naming convention (prefer kebab-case for CSS variables).",
            DiagnosticCertainty::Heuristic,
        ));
    }

    for usage in &usages {
        if !defined_counts.contains_key(usage) {
            diagnostics.push(diag(
                "variable.undefined-reference",
                HealthSeverity::Info,
                DimensionId::VariableConsistency,
                format!("`var(--{usage})` is referenced but not defined in this stylesheet."),
                ctx.file_path,
                None,
                None,
                "Define the variable locally or confirm it is provided by a shared theme sheet.",
                DiagnosticCertainty::Heuristic,
            ));
        }
    }

    diagnostics
}

fn collect_intra_rule_duplicate_properties(ctx: &AnalysisContext<'_>) -> Vec<HealthDiagnostic> {
    let mut diagnostics = Vec::new();

    let Ok(mut stylesheet) = StyleSheet::parse(
        ctx.css_content,
        ParserOptions {
            filename: ctx.file_path.unwrap_or("<css>").to_owned(),
            error_recovery: true,
            ..ParserOptions::default()
        },
    ) else {
        return diagnostics;
    };

    let mut visitor = DuplicatePropertyVisitor {
        file_path: ctx.file_path.map(str::to_owned),
        diagnostics: Vec::new(),
        rule_stack: Vec::new(),
    };

    let _ = stylesheet.visit(&mut visitor);
    diagnostics.append(&mut visitor.diagnostics);
    diagnostics
}

struct DuplicatePropertyVisitor {
    file_path: Option<String>,
    diagnostics: Vec<HealthDiagnostic>,
    rule_stack: Vec<SourceLocation>,
}

impl<'i> Visitor<'i> for DuplicatePropertyVisitor {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        visit_types!(RULES)
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Self::Error> {
        match rule {
            CssRule::Style(style) => {
                let location =
                    SourceLocation::new(style.loc.line.saturating_add(1), style.loc.column);
                self.rule_stack.push(location);

                let mut seen = BTreeSet::new();
                let mut duplicates = BTreeSet::new();

                for property in style
                    .declarations
                    .declarations
                    .iter()
                    .chain(style.declarations.important_declarations.iter())
                {
                    let name = property_name(property);
                    if !seen.insert(name.clone()) {
                        duplicates.insert(name);
                    }
                }

                for name in duplicates {
                    self.diagnostics.push(diag(
                        "duplicate.declaration",
                        HealthSeverity::Info,
                        DimensionId::DuplicateRules,
                        format!("Property `{name}` is declared more than once in the same rule."),
                        self.file_path.as_deref(),
                        Some(location),
                        None,
                        "Keep a single declaration per property unless cascade override is intentional.",
                        DiagnosticCertainty::Confirmed,
                    ));
                }

                let result = style.rules.visit_children(self);
                self.rule_stack.pop();
                result
            }
            other => other.visit_children(self),
        }
    }
}

fn property_name(property: &Property<'_>) -> String {
    match property {
        Property::Custom(custom) => match &custom.name {
            CustomPropertyName::Custom(name) => {
                let raw = name.as_ref();
                if raw.starts_with("--") {
                    raw.to_string()
                } else {
                    format!("--{raw}")
                }
            }
            CustomPropertyName::Unknown(name) => name.as_ref().to_string(),
        },
        other => format!("{other:?}")
            .split_whitespace()
            .next()
            .unwrap_or("property")
            .trim_matches(|ch| ch == '(' || ch == ')')
            .to_ascii_lowercase(),
    }
}

fn collect_custom_property_definitions(css: &str) -> Vec<(String, SourceLocation)> {
    let Ok(mut stylesheet) = StyleSheet::parse(
        css,
        ParserOptions {
            filename: "<css>".to_owned(),
            error_recovery: true,
            ..ParserOptions::default()
        },
    ) else {
        return Vec::new();
    };

    let mut visitor = CustomPropertyVisitor {
        definitions: Vec::new(),
    };
    let _ = stylesheet.visit(&mut visitor);
    visitor.definitions
}

struct CustomPropertyVisitor {
    definitions: Vec<(String, SourceLocation)>,
}

impl<'i> Visitor<'i> for CustomPropertyVisitor {
    type Error = Infallible;

    fn visit_types(&self) -> VisitTypes {
        visit_types!(RULES)
    }

    fn visit_rule(&mut self, rule: &mut CssRule<'i>) -> Result<(), Self::Error> {
        match rule {
            CssRule::Style(style) => {
                let location =
                    SourceLocation::new(style.loc.line.saturating_add(1), style.loc.column);

                for property in style
                    .declarations
                    .declarations
                    .iter()
                    .chain(style.declarations.important_declarations.iter())
                {
                    if let Property::Custom(custom) = property
                        && let CustomPropertyName::Custom(name) = &custom.name
                    {
                        self.definitions
                            .push((normalize_custom_property_name(name.as_ref()), location));
                    }
                }

                style.rules.visit_children(self)
            }
            other => other.visit_children(self),
        }
    }
}

fn collect_custom_property_usages(css: &str) -> BTreeSet<String> {
    // Deterministic extraction of var(--token) references from stylesheet text.
    let mut usages = BTreeSet::new();
    let lower = css.to_ascii_lowercase();
    let mut search_from = 0;

    while let Some(relative) = lower[search_from..].find("var(") {
        let start = search_from + relative + 4;
        let rest = css.get(start..).unwrap_or("");
        let trimmed = rest.trim_start();
        if let Some(stripped) = trimmed.strip_prefix("--") {
            let name: String = stripped
                .chars()
                .take_while(|ch| ch.is_ascii_alphanumeric() || *ch == '_' || *ch == '-')
                .collect();
            if !name.is_empty() {
                usages.insert(name);
            }
        }
        search_from = start;
        if search_from >= css.len() {
            break;
        }
    }

    usages
}

fn rule_location(ctx: &AnalysisContext<'_>, rule_index: usize) -> Option<SourceLocation> {
    ctx.analysis.rules.get(rule_index).map(|rule| rule.location)
}

#[allow(clippy::too_many_arguments)]
fn diag(
    code: &str,
    severity: HealthSeverity,
    category: DimensionId,
    message: String,
    file_path: Option<&str>,
    location: Option<SourceLocation>,
    selector: Option<String>,
    remediation: &str,
    certainty: DiagnosticCertainty,
) -> HealthDiagnostic {
    HealthDiagnostic {
        code: code.to_string(),
        severity,
        category,
        message,
        file_path: file_path.map(str::to_owned),
        location,
        selector,
        remediation: remediation.to_string(),
        certainty,
    }
}

/// Normalize custom property names collected from LightningCSS (strip leading dashes).
pub fn normalize_custom_property_name(name: &str) -> String {
    name.trim().trim_start_matches('-').to_string()
}
