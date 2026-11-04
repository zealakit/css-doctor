//! Page-coverage based CSS chunk splitting.
//!
//! The splitter takes a stylesheet plus the set of CSS classes used by each
//! page/route, then emits:
//!
//! * a common stylesheet for rules whose coverage reaches `min_page_ratio`,
//! * one page stylesheet per page for page-specific rules,
//! * no output for dead rules.
//!
//! Class matching is case-insensitive. Selectors without a class (for example
//! `:root`, `html`, `body`, or an element-only reset) are treated as global and
//! routed to the common chunk. `force_common_selectors` can keep additional
//! selectors/classes alive in the common chunk even when no page uses them.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Serialize};

use lightningcss::declaration::DeclarationBlock;
use lightningcss::rules::CssRule;
use lightningcss::rules::CssRuleList;
use lightningcss::rules::nesting::NestingRule;
use lightningcss::rules::style::StyleRule;
use lightningcss::selector::{Component, Selector};
use lightningcss::stylesheet::{ParserOptions, PrinterOptions, StyleSheet};
use lightningcss::traits::ToCss;

/// Configuration for page-coverage splitting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChunkConfig {
    /// A rule is placed in the common chunk once it is used by at least this
    /// fraction of all pages. Range: `0.0..=1.0`.
    pub min_page_ratio: f32,
    /// Selectors or class names that should always stay in the common chunk.
    ///
    /// Entries may be full selectors (case-insensitive comparison), class names
    /// with or without a leading dot, or selectors with no class.
    #[serde(default)]
    pub force_common_selectors: Vec<String>,
    /// Minify serialized CSS. Defaults to `true`.
    #[serde(default = "default_minify")]
    pub minify: bool,
}

impl Default for ChunkConfig {
    fn default() -> Self {
        Self {
            min_page_ratio: 0.5,
            force_common_selectors: Vec::new(),
            minify: true,
        }
    }
}

const fn default_minify() -> bool {
    true
}

/// Input for [`split_css_by_pages`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitInput {
    /// Original CSS source.
    pub css_content: String,
    /// Map of page/route name to the CSS classes used by that page. Class names
    /// are compared case-insensitively.
    pub page_usage: HashMap<String, HashSet<String>>,
    /// Splitting configuration.
    pub config: ChunkConfig,
}

/// Usage information for one selector.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorStat {
    /// Original selector text.
    pub selector: String,
    /// Usage frequency: the number of matched class occurrences across pages.
    /// For selectors without a class this is the number of pages.
    pub total_occurrences: usize,
    /// Number of pages whose content uses this selector.
    pub page_count: usize,
    /// `page_count / page_total`, rounded to four decimal places.
    pub coverage_ratio: f32,
    /// `common`, `dead`, or `page:<name>[,<name>...]`.
    pub target_chunk: String,
}

/// Result of page-coverage splitting.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SplitOutput {
    /// CSS shared by pages reaching the coverage threshold, plus global rules.
    pub common_css: String,
    /// Page name to page-specific CSS. Every page in the input has an entry,
    /// which may be an empty string when the page has no specific rules.
    pub page_chunks: HashMap<String, String>,
    /// Per-selector usage matrix.
    pub stats: Vec<SelectorStat>,
    /// Number of dead selector occurrences that were removed.
    pub dead_code_count: usize,
}

/// Splits a stylesheet into common and page-specific CSS chunks.
///
/// # Errors
///
/// Returns an error when `min_page_ratio` is outside `0.0..=1.0`, the
/// stylesheet cannot be parsed, or an output AST cannot be serialized.
pub fn split_css_by_pages(input: &SplitInput) -> Result<SplitOutput, String> {
    validate_config(&input.config)?;

    let options = ParserOptions {
        filename: "<css-doctor-split>".to_string(),
        error_recovery: true,
        ..ParserOptions::default()
    };

    let stylesheet = StyleSheet::parse(&input.css_content, options)
        .map_err(|error| format!("failed to parse CSS: {error}"))?;

    let mut context = SplitContext::new(input);
    let mut groups = split_rule_list(&stylesheet.rules.0, &mut context)?;

    let common_css = render_css(groups.common, input.config.minify)?;
    let mut page_chunks = HashMap::new();

    for page in &context.page_names {
        let rules = groups.pages.remove(page).unwrap_or_default();
        page_chunks.insert(page.clone(), render_css(rules, input.config.minify)?);
    }

    let stats = context.stats.into_values().collect();

    Ok(SplitOutput {
        common_css,
        page_chunks,
        stats,
        dead_code_count: context.dead_code_count,
    })
}

fn validate_config(config: &ChunkConfig) -> Result<(), String> {
    if !config.min_page_ratio.is_finite() || !(0.0..=1.0).contains(&config.min_page_ratio) {
        return Err("min_page_ratio must be a finite number between 0 and 1".to_string());
    }

    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
enum Target {
    Common,
    Page(String),
}

#[derive(Debug, Clone)]
enum Classification {
    Common,
    Pages(Vec<String>),
    Dead,
}

#[derive(Debug, Clone)]
struct SelectorClassification {
    classification: Classification,
    used_pages: Vec<String>,
}

#[derive(Default)]
struct RuleGroups<'i> {
    common: Vec<CssRule<'i>>,
    pages: BTreeMap<String, Vec<CssRule<'i>>>,
}

impl<'i> RuleGroups<'i> {
    fn push(&mut self, target: Target, rule: CssRule<'i>) {
        match target {
            Target::Common => self.common.push(rule),
            Target::Page(page) => self.pages.entry(page).or_default().push(rule),
        }
    }

    fn merge(&mut self, other: RuleGroups<'i>) {
        self.common.extend(other.common);

        for (page, rules) in other.pages {
            self.pages.entry(page).or_default().extend(rules);
        }
    }

    fn targets(&self) -> BTreeSet<Target> {
        let mut targets = BTreeSet::new();

        if !self.common.is_empty() {
            targets.insert(Target::Common);
        }

        for (page, rules) in &self.pages {
            if !rules.is_empty() {
                targets.insert(Target::Page(page.clone()));
            }
        }

        targets
    }

    fn take(&mut self, target: &Target) -> Vec<CssRule<'i>> {
        match target {
            Target::Common => std::mem::take(&mut self.common),
            Target::Page(page) => self.pages.remove(page).unwrap_or_default(),
        }
    }
}

struct SplitContext {
    page_names: Vec<String>,
    page_usage: BTreeMap<String, HashSet<String>>,
    min_page_ratio: f32,
    force_common_selectors: Vec<String>,
    stats: BTreeMap<String, SelectorStat>,
    dead_code_count: usize,
}

impl SplitContext {
    fn new(input: &SplitInput) -> Self {
        let page_usage: BTreeMap<String, HashSet<String>> = input
            .page_usage
            .iter()
            .map(|(page, classes)| {
                let normalized = classes.iter().map(|class| class.to_lowercase()).collect();
                (page.clone(), normalized)
            })
            .collect();

        let page_names = page_usage.keys().cloned().collect();

        let force_common_selectors = input
            .config
            .force_common_selectors
            .iter()
            .map(|selector| selector.trim().to_lowercase())
            .filter(|selector| !selector.is_empty())
            .collect();

        Self {
            page_names,
            page_usage,
            min_page_ratio: input.config.min_page_ratio,
            force_common_selectors,
            stats: BTreeMap::new(),
            dead_code_count: 0,
        }
    }

    fn classify(&mut self, selector: &Selector<'_>) -> Result<SelectorClassification, String> {
        let selector_text = selector_to_css(selector)?;
        let selector_lower = selector_text.to_lowercase();
        let mut classes = BTreeSet::new();
        collect_classes(selector, &mut classes);

        let forced_common = self.is_forced_common(&selector_lower, &classes);

        let (pages, total_occurrences, coverage, classification) = if classes.is_empty() {
            let pages = self.page_names.clone();
            let coverage = if pages.is_empty() { 0.0 } else { 1.0 };
            let total = pages.len();
            (pages, total, coverage, Classification::Common)
        } else {
            let mut pages = Vec::new();
            let mut total_occurrences = 0;

            for page in &self.page_names {
                let Some(usage) = self.page_usage.get(page) else {
                    continue;
                };

                let hits = classes
                    .iter()
                    .filter(|class| usage.contains(*class))
                    .count();

                if hits > 0 {
                    pages.push(page.clone());
                    total_occurrences += hits;
                }
            }

            let ratio = if self.page_names.is_empty() {
                0.0
            } else {
                round_ratio(pages.len() as f32 / self.page_names.len() as f32)
            };

            let classification = if forced_common {
                Classification::Common
            } else if pages.is_empty() {
                Classification::Dead
            } else if ratio >= self.min_page_ratio {
                Classification::Common
            } else {
                Classification::Pages(pages.clone())
            };

            (pages, total_occurrences, ratio, classification)
        };

        let page_count = pages.len();
        let coverage = round_ratio(coverage);
        let target_chunk = target_chunk_name(&classification);

        let stat = SelectorStat {
            selector: selector_text,
            total_occurrences,
            page_count,
            coverage_ratio: coverage,
            target_chunk,
        };

        self.stats.entry(stat.selector.clone()).or_insert(stat);

        if matches!(classification, Classification::Dead) {
            self.dead_code_count += 1;
        }

        Ok(SelectorClassification {
            classification,
            used_pages: pages,
        })
    }

    fn is_forced_common(&self, selector_lower: &str, classes: &BTreeSet<String>) -> bool {
        self.force_common_selectors.iter().any(|forced| {
            selector_lower == forced
                || classes
                    .iter()
                    .any(|class| class == forced.trim_start_matches('.'))
        })
    }
}

fn target_chunk_name(classification: &Classification) -> String {
    match classification {
        Classification::Common => "common".to_string(),
        Classification::Dead => "dead".to_string(),
        Classification::Pages(pages) => format!("page:{}", pages.join(",")),
    }
}

fn split_style_rule<'i>(
    style: &StyleRule<'i>,
    context: &mut SplitContext,
) -> Result<BTreeMap<Target, StyleRule<'i>>, String> {
    let mut decisions: Vec<(Selector<'i>, SelectorClassification)> = Vec::new();
    let mut selector_groups: BTreeMap<Target, Vec<Selector<'i>>> = BTreeMap::new();

    for selector in &style.selectors.0 {
        let classification = context.classify(selector)?;

        match &classification.classification {
            Classification::Common => {
                selector_groups
                    .entry(Target::Common)
                    .or_default()
                    .push(selector.clone());
            }
            Classification::Pages(pages) => {
                for page in pages {
                    selector_groups
                        .entry(Target::Page(page.clone()))
                        .or_default()
                        .push(selector.clone());
                }
            }
            Classification::Dead => {}
        }

        decisions.push((selector.clone(), classification));
    }

    let mut nested = if style.rules.0.is_empty() {
        RuleGroups::default()
    } else {
        split_rule_list(&style.rules.0, context)?
    };

    let mut targets: BTreeSet<Target> = selector_groups.keys().cloned().collect();
    // Classless nested rules (`&:hover`, nested declarations, nested `@media`
    // with no classes) land in Common. When the parent is page-specific they
    // must ride along with those page fragments or they are dropped.
    redistribute_common_nested_to_pages(&mut nested, &targets);
    targets.extend(nested.targets());

    let mut fragments = BTreeMap::new();

    for target in targets {
        let own_selectors = selector_groups.remove(&target);
        let keep_declarations = own_selectors.is_some();

        let selectors = match own_selectors {
            Some(selectors) => selectors,
            None => decisions
                .iter()
                .filter(|(_, decision)| is_context_selector(&target, decision))
                .map(|(selector, _)| selector.clone())
                .collect(),
        };

        if selectors.is_empty() {
            continue;
        }

        let nested_rules = nested.take(&target);
        let mut fragment = style.clone();
        fragment.selectors.0 = selectors.into_iter().collect();
        fragment.rules = CssRuleList(nested_rules);

        if !keep_declarations {
            fragment.declarations = DeclarationBlock::default();
        }

        fragments.insert(target, fragment);
    }

    Ok(fragments)
}

fn redistribute_common_nested_to_pages<'i>(
    nested: &mut RuleGroups<'i>,
    parent_targets: &BTreeSet<Target>,
) {
    if nested.common.is_empty() {
        return;
    }

    let parent_pages: Vec<String> = parent_targets
        .iter()
        .filter_map(|target| match target {
            Target::Page(page) => Some(page.clone()),
            Target::Common => None,
        })
        .collect();

    if parent_pages.is_empty() {
        return;
    }

    let parent_has_common = parent_targets.contains(&Target::Common);

    for page in &parent_pages {
        nested
            .pages
            .entry(page.clone())
            .or_default()
            .extend(nested.common.iter().cloned());
    }

    if !parent_has_common {
        nested.common.clear();
    }
}

fn is_context_selector(target: &Target, decision: &SelectorClassification) -> bool {
    match target {
        Target::Common => {
            matches!(decision.classification, Classification::Common)
        }
        Target::Page(page) => decision.used_pages.contains(page),
    }
}

fn split_rule_list<'i>(
    rules: &[CssRule<'i>],
    context: &mut SplitContext,
) -> Result<RuleGroups<'i>, String> {
    let mut groups = RuleGroups::default();

    for rule in rules {
        match rule {
            CssRule::Style(style) => {
                for (target, fragment) in split_style_rule(style, context)? {
                    groups.push(target, CssRule::Style(fragment));
                }
            }
            CssRule::Media(media) => {
                let inner = split_rule_list(&media.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = media.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Media(clone)
                }));
            }
            CssRule::Supports(supports) => {
                let inner = split_rule_list(&supports.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = supports.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Supports(clone)
                }));
            }
            CssRule::LayerBlock(layer) => {
                let inner = split_rule_list(&layer.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = layer.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::LayerBlock(clone)
                }));
            }
            CssRule::Container(container) => {
                let inner = split_rule_list(&container.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = container.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Container(clone)
                }));
            }
            CssRule::Scope(scope) => {
                let inner = split_rule_list(&scope.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = scope.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Scope(clone)
                }));
            }
            CssRule::StartingStyle(starting_style) => {
                let inner = split_rule_list(&starting_style.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = starting_style.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::StartingStyle(clone)
                }));
            }
            CssRule::MozDocument(document) => {
                let inner = split_rule_list(&document.rules.0, context)?;

                groups.merge(wrap_rule_groups(inner, |rules| {
                    let mut clone = document.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::MozDocument(clone)
                }));
            }
            CssRule::Nesting(nesting) => {
                for (target, style) in split_style_rule(&nesting.style, context)? {
                    groups.push(
                        target,
                        CssRule::Nesting(NestingRule {
                            style,
                            loc: nesting.loc,
                        }),
                    );
                }
            }
            CssRule::Ignored => {}
            other => groups.common.push(other.clone()),
        }
    }

    Ok(groups)
}

fn wrap_rule_groups<'i, F>(groups: RuleGroups<'i>, mut make_rule: F) -> RuleGroups<'i>
where
    F: FnMut(Vec<CssRule<'i>>) -> CssRule<'i>,
{
    let mut wrapped = RuleGroups::default();

    if !groups.common.is_empty() {
        wrapped.common.push(make_rule(groups.common));
    }

    for (page, rules) in groups.pages {
        if !rules.is_empty() {
            wrapped.pages.insert(page, vec![make_rule(rules)]);
        }
    }

    wrapped
}

/// Collects classes that are positively required for a selector to match.
///
/// Classes inside `:not()` are ignored (they must be absent, not present).
/// For `:is()` / `:where()` / `:any()`, if any alternative can match without a
/// class the whole functional pseudo contributes no required classes — otherwise
/// the union of required classes from every alternative is kept. This keeps DCE
/// conservative: `div:not(.hidden)` and `:is(.unused, div)` stay alive.
fn collect_classes(selector: &Selector<'_>, classes: &mut BTreeSet<String>) {
    let _ = collect_required_classes(selector, classes);
}

/// Returns `true` when the selector can match without any of the collected classes.
fn collect_required_classes(selector: &Selector<'_>, classes: &mut BTreeSet<String>) -> bool {
    let mut local = BTreeSet::new();

    for component in selector.iter_raw_match_order() {
        match component {
            Component::Class(name) => {
                local.insert(name.0.to_lowercase());
            }
            Component::Negation(_) => {
                // Excluded classes are not usage requirements.
            }
            Component::Is(selectors)
            | Component::Where(selectors)
            | Component::Any(_, selectors) => {
                let mut union = BTreeSet::new();
                let mut any_classless = false;

                for inner in selectors.iter() {
                    let mut inner_classes = BTreeSet::new();
                    if collect_required_classes(inner, &mut inner_classes) {
                        any_classless = true;
                    }
                    union.extend(inner_classes);
                }

                if !any_classless {
                    local.extend(union);
                }
            }
            Component::Has(selectors) => {
                for inner in selectors.iter() {
                    collect_required_classes(inner, &mut local);
                }
            }
            Component::NthOf(data) => {
                for inner in data.selectors() {
                    collect_required_classes(inner, &mut local);
                }
            }
            Component::Host(Some(inner)) | Component::Slotted(inner) => {
                collect_required_classes(inner, &mut local);
            }
            _ => {}
        }
    }

    let classless = local.is_empty();
    classes.extend(local);
    classless
}

fn selector_to_css(selector: &Selector<'_>) -> Result<String, String> {
    <Selector<'_> as ToCss>::to_css_string(selector, PrinterOptions::default())
        .map_err(|error| format!("failed to serialize selector: {error}"))
}

fn render_css<'i>(rules: Vec<CssRule<'i>>, minify: bool) -> Result<String, String> {
    if rules.is_empty() {
        return Ok(String::new());
    }

    let stylesheet = StyleSheet::new(
        vec!["<css-doctor-split>".to_string()],
        CssRuleList(rules),
        ParserOptions::default(),
    );

    stylesheet
        .to_css(PrinterOptions {
            minify,
            ..PrinterOptions::default()
        })
        .map(|result| result.code)
        .map_err(|error| format!("failed to render CSS: {error}"))
}

fn round_ratio(value: f32) -> f32 {
    (value * 10_000.0).round() / 10_000.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::analyze_css;

    fn pages(entries: &[(&str, &[&str])]) -> HashMap<String, HashSet<String>> {
        entries
            .iter()
            .map(|(page, classes)| {
                (
                    (*page).to_string(),
                    classes.iter().map(|class| (*class).to_string()).collect(),
                )
            })
            .collect()
    }

    fn split(css: &str, usage: HashMap<String, HashSet<String>>) -> SplitOutput {
        split_css_by_pages(&SplitInput {
            css_content: css.to_string(),
            page_usage: usage,
            config: ChunkConfig {
                min_page_ratio: 0.5,
                force_common_selectors: Vec::new(),
                minify: false,
            },
        })
        .expect("split succeeds")
    }

    fn selector_names(css: &str) -> Vec<String> {
        analyze_css(css)
            .expect("chunk parses")
            .selectors
            .into_iter()
            .map(|selector| selector.raw)
            .collect()
    }

    #[test]
    fn splits_common_page_specific_and_dead_rules() {
        let css = r#"
            :root {
                --brand: #646cff;
            }

            html {
                box-sizing: border-box;
            }

            @font-face {
                font-family: "Demo";
                src: url("./demo.woff2");
            }

            .flex {
                display: flex;
            }

            .about-card {
                color: red;
            }

            .contact-form {
                color: blue;
            }

            .legacy-popup {
                display: none;
            }

            @media (min-width: 600px) {
                .flex {
                    gap: 8px;
                }

                .about-card {
                    padding: 1rem;
                }
            }
        "#;

        let usage = pages(&[
            ("home", &["flex", "hero"]),
            ("about", &["flex", "about-card"]),
            ("contact", &["flex", "contact-form"]),
        ]);

        let output = split(css, usage);
        let common = selector_names(&output.common_css);
        let about = selector_names(&output.page_chunks["about"]);
        let contact = selector_names(&output.page_chunks["contact"]);
        let home = selector_names(&output.page_chunks["home"]);

        assert!(common.contains(&":root".to_string()));
        assert!(common.contains(&"html".to_string()));
        assert!(common.contains(&".flex".to_string()));
        assert!(!common.contains(&".about-card".to_string()));
        assert!(!common.contains(&".legacy-popup".to_string()));

        assert!(about.contains(&".about-card".to_string()));
        assert!(!about.contains(&".flex".to_string()));
        assert!(contact.contains(&".contact-form".to_string()));
        assert!(home.is_empty());

        assert_eq!(output.dead_code_count, 1);
        assert!(output.common_css.contains("@font-face"));
        assert!(output.common_css.contains("@media"));

        let flex = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".flex")
            .expect("flex stat");
        assert_eq!(flex.page_count, 3);
        assert_eq!(flex.coverage_ratio, 1.0);
        assert_eq!(flex.target_chunk, "common");

        let about_card = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".about-card")
            .expect("about stat");
        assert_eq!(about_card.page_count, 1);
        assert_eq!(about_card.target_chunk, "page:about");
        assert!((about_card.coverage_ratio - 0.3333).abs() < 0.0001);

        let dead = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".legacy-popup")
            .expect("dead stat");
        assert_eq!(dead.page_count, 0);
        assert_eq!(dead.target_chunk, "dead");
    }

    #[test]
    fn splits_selector_lists_between_chunks() {
        let output = split(
            ".shared, .about-only, .dead { color: red; }",
            pages(&[
                ("home", &["shared"]),
                ("about", &["shared", "about-only"]),
                ("contact", &["shared"]),
            ]),
        );

        assert_eq!(
            selector_names(&output.common_css),
            vec![".shared".to_string()]
        );
        assert_eq!(
            selector_names(&output.page_chunks["about"]),
            vec![".about-only".to_string()]
        );
        assert_eq!(output.dead_code_count, 1);
        assert!(output.page_chunks["home"].is_empty());
        assert!(output.page_chunks["contact"].is_empty());
    }

    #[test]
    fn matches_classes_case_insensitively() {
        let output = split(
            ".MyCard, .UnusedCard { color: red; }",
            pages(&[("home", &["MYCARD"]), ("about", &[]), ("contact", &[])]),
        );

        assert!(output.page_chunks["home"].contains(".MyCard"));
        assert_eq!(output.dead_code_count, 1);

        let stat = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".MyCard")
            .expect("selector stat");
        assert_eq!(stat.page_count, 1);
        assert_eq!(stat.target_chunk, "page:home");
    }

    #[test]
    fn force_common_selectors_keeps_unused_rules_alive() {
        let output = split_css_by_pages(&SplitInput {
            css_content: ".legacy-popup { display: none; } .dead { color: red; }".to_string(),
            page_usage: pages(&[("home", &["app"])]),
            config: ChunkConfig {
                min_page_ratio: 0.5,
                force_common_selectors: vec![".legacy-popup".to_string()],
                minify: false,
            },
        })
        .expect("split succeeds");

        assert!(output.common_css.contains(".legacy-popup"));
        assert!(!output.common_css.contains(".dead"));
        assert_eq!(output.dead_code_count, 1);

        let kept = output
            .stats
            .iter()
            .find(|stat| stat.selector == ".legacy-popup")
            .expect("kept stat");
        assert_eq!(kept.target_chunk, "common");
        assert_eq!(kept.page_count, 0);
    }

    #[test]
    fn preserves_nested_rules_under_parent_selectors() {
        let output = split(
            r#"
            .card {
                color: red;
                .title { font-weight: bold; }
            }
            "#,
            pages(&[
                ("home", &["card", "title"]),
                ("about", &["card"]),
                ("contact", &["card"]),
            ]),
        );

        // `.card` is common; `.title` is home-specific and keeps its parent
        // selector context in the home chunk.
        assert!(output.common_css.contains(".card"));
        assert!(output.page_chunks["home"].contains(".title"));
    }

    #[test]
    fn keeps_classless_nests_under_page_specific_parents() {
        let output = split(
            r#"
            .card {
                color: red;
                &:hover { outline: 1px solid blue; }
                > p { margin: 0; }
            }
            "#,
            pages(&[
                ("home", &["card"]),
                ("about", &["other"]),
                ("contact", &["other"]),
            ]),
        );

        let home = &output.page_chunks["home"];
        assert!(
            home.contains(".card"),
            "home missing .card: {home:?} common={:?}",
            output.common_css
        );
        assert!(
            home.contains(":hover") || home.contains("hover"),
            "expected nested :hover in home chunk, got {home}"
        );
        assert!(
            home.contains("p") && home.contains("margin"),
            "expected nested > p rule in home chunk, got {home}"
        );
        assert!(!output.common_css.contains(".card"));
    }

    #[test]
    fn keeps_trailing_nested_declarations_under_page_parents() {
        let output = split(
            r#"
            .card {
                .title { font-weight: bold; }
                color: red;
            }
            "#,
            pages(&[
                ("home", &["card", "title"]),
                ("about", &["other"]),
                ("contact", &["other"]),
            ]),
        );

        let home = &output.page_chunks["home"];
        assert!(
            home.contains(".title") || home.contains("title"),
            "expected .title in home, got {home:?} common={:?}",
            output.common_css
        );
        assert!(
            home.contains("color") && home.contains("red"),
            "trailing nested declaration must stay with page parent, got {home}"
        );
    }

    #[test]
    fn does_not_treat_negation_classes_as_required() {
        let output = split(
            "div:not(.hidden) { display: block; } .unused { color: red; }",
            pages(&[("home", &["visible"]), ("about", &["visible"])]),
        );

        assert!(
            output.common_css.contains(":not") || output.common_css.contains("not"),
            "div:not(.hidden) must stay alive, got common={}",
            output.common_css
        );
        let dead = output
            .stats
            .iter()
            .find(|stat| stat.selector.contains("unused"))
            .expect("unused selector stat");
        assert_eq!(dead.target_chunk, "dead");

        let kept = output
            .stats
            .iter()
            .find(|stat| stat.selector.contains(":not") || stat.selector.contains("not("))
            .expect(":not selector stat");
        assert_eq!(kept.target_chunk, "common");
    }

    #[test]
    fn treats_is_with_classless_alternative_as_global() {
        let output = split(
            ":is(.nope, div) { color: blue; }",
            pages(&[("home", &["other"]), ("about", &["other"])]),
        );

        assert!(
            !output.common_css.is_empty(),
            ":is(.nope, div) must not be dead-code eliminated"
        );
        let kept = output
            .stats
            .iter()
            .find(|stat| stat.selector.contains(":is") || stat.selector.contains("is("))
            .expect(":is selector stat");
        assert_eq!(kept.target_chunk, "common");
    }

    #[test]
    fn rejects_invalid_min_page_ratio() {
        let error = split_css_by_pages(&SplitInput {
            css_content: String::new(),
            page_usage: HashMap::new(),
            config: ChunkConfig {
                min_page_ratio: 1.5,
                force_common_selectors: Vec::new(),
                minify: false,
            },
        })
        .expect_err("invalid config should fail");

        assert!(error.contains("min_page_ratio"));
    }
    #[test]
    fn minifies_common_and_page_chunks() {
        let output = split_css_by_pages(&SplitInput {
            css_content: ".shared { color: red; } .home { color: blue; }".to_string(),
            page_usage: pages(&[("home", &["shared", "home"]), ("about", &["shared"])]),
            config: ChunkConfig {
                min_page_ratio: 0.75,
                force_common_selectors: Vec::new(),
                minify: true,
            },
        })
        .expect("split succeeds");

        assert!(output.common_css.contains(".shared{color:red}"));
        assert!(output.page_chunks["home"].contains(".home{color:#00f}"));
        assert!(!output.common_css.contains("\n"));
    }
}
