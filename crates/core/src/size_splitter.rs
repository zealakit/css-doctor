//! Size-budget CSS splitting and CSS-variable isolation.
//!
//! This module is the second tier of the optimization pipeline. It receives a
//! CSS chunk that may be larger than the configured byte budget, optionally
//! moves custom properties and variable-defining rules into a dedicated
//! stylesheet, and groups the remaining top-level rules into serialized chunks
//! that fit the budget.
//!
//! Rules are never cut in half: a `@media`, `@supports`, `@keyframes`, or any
//! other top-level rule is moved as one AST node. If a single rule is larger
//! than the budget it is emitted alone and reported as oversized.

use lightningcss::declaration::DeclarationBlock;
use lightningcss::properties::Property;
use lightningcss::rules::CssRule;
use lightningcss::rules::CssRuleList;
use lightningcss::rules::nesting::NestingRule;
use lightningcss::rules::style::StyleRule;
use lightningcss::stylesheet::{ParserOptions, PrinterOptions, StyleSheet};
use lightningcss::traits::ToCss;

/// Configuration for physical size splitting.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SizeSplitterConfig {
    /// Maximum serialized size of a generated body chunk, in bytes.
    pub max_chunk_size: usize,
    /// Move CSS variables and variable-defining rules into a separate chunk.
    pub isolate_variables: bool,
    /// Minify serialized chunks.
    pub minify: bool,
}

impl Default for SizeSplitterConfig {
    fn default() -> Self {
        Self {
            max_chunk_size: 60 * 1024,
            isolate_variables: true,
            minify: true,
        }
    }
}

/// Result of splitting one oversized CSS chunk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SizeSplitOutput {
    /// Variables and variable-defining rules, when isolation is enabled.
    pub variables_css: String,
    /// Body chunks in source order, each normally at most `max_chunk_size`.
    pub chunks: Vec<String>,
    /// Whether any output was produced by a size-budget split.
    pub split: bool,
    /// True when a single indivisible rule (or the variables chunk) exceeds the
    /// configured budget.
    pub oversized: bool,
}

/// Splits a CSS string according to a byte budget.
///
/// When the input already fits the budget it is returned unchanged, which keeps
/// the original formatting and avoids unnecessary AST round-trips.
///
/// # Errors
///
/// Returns an error for an invalid budget, malformed CSS, or a serialization
/// failure.
pub fn split_css_by_size(
    css: &str,
    config: &SizeSplitterConfig,
) -> Result<SizeSplitOutput, String> {
    if config.max_chunk_size == 0 {
        return Err("max_chunk_size must be greater than zero".to_string());
    }

    // Measure against the would-be emitted form. When minify is on, prefer a
    // single minified stylesheet whenever it already fits the budget so we do
    // not invent unnecessary chunks from unminified source size alone.
    if config.minify {
        let minified = minify_css(css)?;
        if minified.len() <= config.max_chunk_size {
            return Ok(SizeSplitOutput {
                variables_css: String::new(),
                chunks: if minified.is_empty() {
                    Vec::new()
                } else {
                    vec![minified]
                },
                split: false,
                oversized: false,
            });
        }
    } else if css.len() <= config.max_chunk_size {
        return Ok(SizeSplitOutput {
            variables_css: String::new(),
            chunks: if css.trim().is_empty() {
                Vec::new()
            } else {
                vec![css.to_string()]
            },
            split: false,
            oversized: false,
        });
    }

    let options = ParserOptions {
        filename: "<css-doctor-size>".to_string(),
        error_recovery: true,
        ..ParserOptions::default()
    };
    let stylesheet = StyleSheet::parse(css, options)
        .map_err(|error| format!("failed to parse CSS for size splitting: {error}"))?;

    let mut variables = Vec::new();
    let mut body = Vec::new();

    if config.isolate_variables {
        partition_rules(&stylesheet.rules.0, &mut variables, &mut body)?;
    } else {
        body.extend(stylesheet.rules.0.iter().cloned());
    }

    let variables_css = render_rules(&variables, config.minify)?;
    // When variables alone exceed the budget after isolation, keep them as a
    // single oversized variables chunk rather than inventing false body splits.
    let (prelude, body) = take_leading_hoisted_rules(body);
    let mut chunks = split_rules(body, config.max_chunk_size, config.minify)?;
    if !prelude.is_empty() {
        let prelude_css = render_rules(&prelude, config.minify)?;
        if let Some(first) = chunks.first_mut() {
            if first.is_empty() {
                *first = prelude_css;
            } else if !prelude_css.is_empty() {
                *first = format!("{prelude_css}{first}");
            }
        } else if !prelude_css.is_empty() {
            chunks.push(prelude_css);
        }
    }
    let oversized = (!variables_css.is_empty() && variables_css.len() > config.max_chunk_size)
        || chunks
            .iter()
            .any(|chunk| chunk.len() > config.max_chunk_size);

    Ok(SizeSplitOutput {
        variables_css,
        chunks,
        split: true,
        oversized,
    })
}

/// Minifies a stylesheet without splitting it.
///
/// # Errors
///
/// Returns an error when the stylesheet cannot be parsed or serialized.
pub fn minify_css(css: &str) -> Result<String, String> {
    if css.trim().is_empty() {
        return Ok(String::new());
    }

    let stylesheet = StyleSheet::parse(
        css,
        ParserOptions {
            filename: "<css-doctor-minify>".to_string(),
            error_recovery: true,
            ..ParserOptions::default()
        },
    )
    .map_err(|error| format!("failed to parse CSS for minification: {error}"))?;

    stylesheet
        .to_css(PrinterOptions {
            minify: true,
            ..PrinterOptions::default()
        })
        .map(|result| result.code)
        .map_err(|error| format!("failed to minify CSS: {error}"))
}

fn partition_rules<'i>(
    rules: &[CssRule<'i>],
    variables: &mut Vec<CssRule<'i>>,
    body: &mut Vec<CssRule<'i>>,
) -> Result<(), String> {
    for rule in rules {
        match rule {
            CssRule::Property(_) | CssRule::CustomMedia(_) => {
                variables.push(rule.clone());
            }
            // `@custom-media` / `@property` / `@theme` may parse as unknown rules
            // depending on parser options; treat them as variable definitions.
            CssRule::Unknown(unknown)
                if ["theme", "custom-media", "property"]
                    .iter()
                    .any(|name| unknown.name.as_ref().eq_ignore_ascii_case(name)) =>
            {
                variables.push(rule.clone());
            }
            CssRule::Style(style) => {
                let (style_variables, body_style) = partition_style(style)?;

                for style in style_variables {
                    variables.push(CssRule::Style(style));
                }

                if let Some(body_style) = body_style {
                    body.push(CssRule::Style(body_style));
                }
            }
            CssRule::Nesting(nesting) => {
                let (style_variables, body_style) = partition_style(&nesting.style)?;

                for style in style_variables {
                    variables.push(CssRule::Nesting(NestingRule {
                        style,
                        loc: nesting.loc,
                    }));
                }

                if let Some(style) = body_style {
                    body.push(CssRule::Nesting(NestingRule {
                        style,
                        loc: nesting.loc,
                    }));
                }
            }
            CssRule::Media(media) => {
                partition_nested(&media.rules.0, variables, body, |rules| {
                    let mut clone = media.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Media(clone)
                })?;
            }
            CssRule::Supports(supports) => {
                partition_nested(&supports.rules.0, variables, body, |rules| {
                    let mut clone = supports.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Supports(clone)
                })?;
            }
            CssRule::LayerBlock(layer) => {
                partition_nested(&layer.rules.0, variables, body, |rules| {
                    let mut clone = layer.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::LayerBlock(clone)
                })?;
            }
            CssRule::Container(container) => {
                partition_nested(&container.rules.0, variables, body, |rules| {
                    let mut clone = container.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Container(clone)
                })?;
            }
            CssRule::Scope(scope) => {
                partition_nested(&scope.rules.0, variables, body, |rules| {
                    let mut clone = scope.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::Scope(clone)
                })?;
            }
            CssRule::StartingStyle(starting_style) => {
                partition_nested(&starting_style.rules.0, variables, body, |rules| {
                    let mut clone = starting_style.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::StartingStyle(clone)
                })?;
            }
            CssRule::MozDocument(document) => {
                partition_nested(&document.rules.0, variables, body, |rules| {
                    let mut clone = document.clone();
                    clone.rules = CssRuleList(rules);
                    CssRule::MozDocument(clone)
                })?;
            }
            _ => body.push(rule.clone()),
        }
    }

    Ok(())
}

fn partition_nested<'i, F>(
    rules: &[CssRule<'i>],
    variables: &mut Vec<CssRule<'i>>,
    body: &mut Vec<CssRule<'i>>,
    wrap: F,
) -> Result<(), String>
where
    F: Fn(Vec<CssRule<'i>>) -> CssRule<'i>,
{
    let mut inner_variables = Vec::new();
    let mut inner_body = Vec::new();
    partition_rules(rules, &mut inner_variables, &mut inner_body)?;

    if !inner_variables.is_empty() {
        variables.push(wrap(inner_variables));
    }

    if !inner_body.is_empty() {
        body.push(wrap(inner_body));
    }

    Ok(())
}

fn partition_style<'i>(
    style: &StyleRule<'i>,
) -> Result<(Vec<StyleRule<'i>>, Option<StyleRule<'i>>), String> {
    // Only custom properties belong in the variables chunk. A bare `:root` /
    // `:host` rule with normal declarations must stay in body CSS — otherwise
    // we invent a variables chunk with no custom properties.
    let mut variable_declarations = DeclarationBlock::default();
    let mut body_declarations = DeclarationBlock::default();

    for property in &style.declarations.important_declarations {
        if is_custom_property(property) {
            variable_declarations
                .important_declarations
                .push(property.clone());
        } else {
            body_declarations
                .important_declarations
                .push(property.clone());
        }
    }

    for property in &style.declarations.declarations {
        if is_custom_property(property) {
            variable_declarations.declarations.push(property.clone());
        } else {
            body_declarations.declarations.push(property.clone());
        }
    }

    if variable_declarations.is_empty() {
        return Ok((Vec::new(), Some(style.clone())));
    }

    let mut variable_style = style.clone();
    variable_style.declarations = variable_declarations;
    variable_style.rules = CssRuleList(Vec::new());

    let has_body_declarations = !body_declarations.is_empty();
    let has_nested_rules = !style.rules.0.is_empty();

    let body_style = if has_body_declarations || has_nested_rules {
        let mut clone = style.clone();
        clone.declarations = body_declarations;
        Some(clone)
    } else {
        None
    };

    Ok((vec![variable_style], body_style))
}

fn is_hoisted_prelude_rule(rule: &CssRule<'_>) -> bool {
    matches!(
        rule,
        CssRule::Import(_) | CssRule::Namespace(_) | CssRule::LayerStatement(_)
    )
}

fn take_leading_hoisted_rules<'i>(
    mut rules: Vec<CssRule<'i>>,
) -> (Vec<CssRule<'i>>, Vec<CssRule<'i>>) {
    let mut prelude = Vec::new();
    while rules
        .first()
        .is_some_and(|rule| is_hoisted_prelude_rule(rule))
    {
        if let Some(rule) = rules.first().cloned() {
            prelude.push(rule);
            rules.remove(0);
        }
    }
    (prelude, rules)
}

fn is_custom_property(property: &Property<'_>) -> bool {
    matches!(property, Property::Custom(_))
}

/// Greedily groups top-level rules into chunks no larger than `max_chunk_size`.
///
/// Each rule is serialized once to learn its size; chunks are then rendered
/// once each (instead of re-printing the growing buffer after every rule, which
/// was O(n²) in the number of rules). The separator between rules is measured
/// from a probe so the estimate matches the printer exactly; a final exact
/// check per chunk keeps correctness even if the estimate were off.
fn split_rules<'i>(
    rules: Vec<CssRule<'i>>,
    max_chunk_size: usize,
    minify: bool,
) -> Result<Vec<String>, String> {
    if rules.is_empty() {
        return Ok(Vec::new());
    }

    let sizes = rules
        .iter()
        .map(|rule| render_rule_len(rule, minify))
        .collect::<Result<Vec<_>, _>>()?;
    let (separator, trailer) = measure_framing(&rules, &sizes, minify)?;

    let mut chunks = Vec::new();
    let mut start = 0usize;

    while start < rules.len() {
        let mut end = start;
        let mut estimate = trailer;

        while end < rules.len() {
            let next = sizes[end] + if end > start { separator } else { 0 };
            if end > start && estimate + next > max_chunk_size {
                break;
            }
            estimate += next;
            end += 1;
        }

        // Exact check: shrink only if the estimate undershot the real size.
        let mut rendered = render_rules(&rules[start..end], minify)?;
        while end - start > 1 && rendered.len() > max_chunk_size {
            end -= 1;
            rendered = render_rules(&rules[start..end], minify)?;
        }

        chunks.push(rendered);
        start = end;
    }

    Ok(chunks)
}

fn render_rule_len(rule: &CssRule<'_>, minify: bool) -> Result<usize, String> {
    <CssRule<'_> as ToCss>::to_css_string(
        rule,
        PrinterOptions {
            minify,
            ..PrinterOptions::default()
        },
    )
    .map(|css| css.len())
    .map_err(|error| format!("failed to render CSS rule: {error}"))
}

/// Measures the printer's framing: `(between two rules, after the last rule)`.
/// Both are 0 when minified.
fn measure_framing(
    rules: &[CssRule<'_>],
    sizes: &[usize],
    minify: bool,
) -> Result<(usize, usize), String> {
    let Some(first) = rules.first() else {
        return Ok((0, 0));
    };
    let trailer = render_rules(std::slice::from_ref(first), minify)?
        .len()
        .saturating_sub(sizes[0]);
    if rules.len() < 2 {
        return Ok((0, trailer));
    }
    let joined = render_rules(&rules[..2], minify)?.len();
    let separator = joined.saturating_sub(sizes[0] + sizes[1] + trailer);
    Ok((separator, trailer))
}

fn render_rules<'i>(rules: &[CssRule<'i>], minify: bool) -> Result<String, String> {
    if rules.is_empty() {
        return Ok(String::new());
    }

    let stylesheet = StyleSheet::new(
        vec!["<css-doctor-size>".to_string()],
        CssRuleList(rules.to_vec()),
        ParserOptions::default(),
    );

    stylesheet
        .to_css(PrinterOptions {
            minify,
            ..PrinterOptions::default()
        })
        .map(|result| result.code)
        .map_err(|error| format!("failed to render CSS size chunk: {error}"))
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use super::*;

    #[test]
    fn keeps_small_css_unchanged() {
        let css = ".a { color: red; }";
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 1024,
                isolate_variables: true,
                minify: false,
            },
        )
        .expect("split succeeds");

        assert!(!output.split);
        assert_eq!(output.chunks, vec![css.to_string()]);
        assert!(output.variables_css.is_empty());
    }

    #[test]
    fn isolates_variables_and_splits_body() {
        let css = r#"
            :root { --brand: red; --space: 4px; }
            .a { color: var(--brand); padding: var(--space); }
            .b { background: blue; }
            .c { border: 1px solid red; }
            .d { margin: 2rem; }
        "#;

        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 90,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.split);
        assert!(output.variables_css.contains("--brand"));
        assert!(
            !output
                .chunks
                .iter()
                .any(|chunk| chunk.contains("--brand: red"))
        );
        assert!(output.chunks.len() > 1);
        assert!(
            output
                .chunks
                .iter()
                .all(|chunk| chunk.len() <= 90 || output.oversized)
        );
    }

    #[test]
    fn keeps_conditional_blocks_intact() {
        let css = r#"
            @media (min-width: 600px) {
                .a { color: red; }
                .b { color: blue; }
            }
            .c { display: block; }
        "#;
        let minified = minify_css(css).expect("minify");
        // Force a split after minify by budgeting below the full sheet but
        // above a typical single rule so @media stays intact as one node.
        let budget = (minified.len() / 2).max(20);

        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: budget,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.split);
        assert_eq!(output.variables_css, "");
        assert!(output.chunks.iter().any(|chunk| chunk.contains("@media")));
        for chunk in &output.chunks {
            assert!(
                !chunk.contains("@media")
                    || chunk.matches('{').count() == chunk.matches('}').count()
            );
        }
    }

    #[test]
    fn can_disable_variable_isolation() {
        let css = ":root { --brand: red; } .a { color: var(--brand); }";
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 20,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.variables_css.is_empty());
        assert!(output.chunks.iter().any(|chunk| chunk.contains("--brand")));
    }

    #[test]
    fn rejects_zero_budget() {
        let error = split_css_by_size(
            ".a { color: red; }",
            &SizeSplitterConfig {
                max_chunk_size: 0,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect_err("zero budget is invalid");

        assert!(error.contains("max_chunk_size"));
    }
    #[test]
    fn isolates_property_custom_media_and_theme() {
        let css = r#"
            @property --brand {
                syntax: "<color>";
                inherits: false;
                initial-value: red;
            }
            @custom-media --narrow (max-width: 30em);
            @theme {
                --color-brand: red;
            }
            :root { --space: 4px; }
            .a { color: var(--brand); }
        "#;

        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 20,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        for marker in ["@property", "@custom-media", "@theme", ":root"] {
            assert!(output.variables_css.contains(marker), "missing {marker}");
        }
        assert!(
            !output
                .chunks
                .iter()
                .any(|chunk| chunk.contains("@property"))
        );
    }

    #[test]
    fn splits_custom_declarations_from_a_style_rule() {
        let css = ".card { --brand: red; color: blue; } .other { color: green; }";
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 20,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.variables_css.contains("--brand:red"));
        assert!(output.variables_css.contains(".card"));
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.contains(".card") && chunk.contains("#00f"))
        );
        assert!(!output.chunks.iter().any(|chunk| chunk.contains("--brand")));
    }
    #[test]
    fn minifies_small_css_when_requested() {
        let output = split_css_by_size(
            ".a { color: red; }",
            &SizeSplitterConfig {
                max_chunk_size: 1024,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(!output.split);
        assert_eq!(output.chunks, vec![".a{color:red}".to_string()]);
    }

    #[test]
    fn does_not_split_when_only_unminified_source_exceeds_budget() {
        let css = ".card { color: red; background: blue; margin: 1rem; padding: 1rem; }";
        let minified = minify_css(css).expect("minify");
        assert!(css.len() > minified.len());
        let budget = minified.len();
        assert!(css.len() > budget);

        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: budget,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(!output.split);
        assert_eq!(output.chunks, vec![minified]);
        assert!(output.variables_css.is_empty());
    }

    #[test]
    fn does_not_create_variables_chunk_for_root_without_custom_properties() {
        let css = format!(":root {{ color: red; }} {}", ".x{color:blue}".repeat(40));
        let output = split_css_by_size(
            &css,
            &SizeSplitterConfig {
                max_chunk_size: 40,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.variables_css.is_empty());
        assert!(output.chunks.iter().any(|chunk| chunk.contains(":root")
            && chunk.contains("color:red")
            || chunk.contains("color:red")));
    }

    #[test]
    fn preserves_layer_statement_order_in_the_first_chunk() {
        let css = r#"
            @layer reset, components, utilities;
            @layer reset { .a { margin: 0; } }
            @layer components { .b { color: red; } }
            @layer utilities { .c { padding: 1rem; } }
            .d { display: block; }
            .e { display: flex; }
            .f { display: grid; }
        "#;
        let minified = minify_css(css).expect("minify");
        let budget = (minified.len() / 2).max(40);
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: budget,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.split);
        let first = output.chunks.first().expect("first chunk");
        assert!(
            first.contains("@layer reset, components, utilities")
                || first.contains("@layer reset,components,utilities"),
            "layer order statement must stay in the first chunk: {first}"
        );
        assert!(
            output
                .chunks
                .iter()
                .skip(1)
                .all(|chunk| !chunk.contains("@layer reset,")),
            "later chunks must not repeat the layer order statement: {:?}",
            output.chunks
        );
    }

    #[test]
    fn marks_oversized_variables_chunk_without_dropping_custom_properties() {
        let css = format!(
            ":root {{ {} }} .a {{ color: var(--v0); }}",
            (0..40)
                .map(|index| format!("--v{index}: {index}px;"))
                .collect::<Vec<_>>()
                .join(" ")
        );
        let output = split_css_by_size(
            &css,
            &SizeSplitterConfig {
                max_chunk_size: 40,
                isolate_variables: true,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(!output.variables_css.is_empty());
        assert!(output.variables_css.contains("--v0"));
        assert!(output.oversized || output.variables_css.len() <= 40);
        assert!(
            output
                .chunks
                .iter()
                .any(|chunk| chunk.contains("var(--v0)") || chunk.contains(".a"))
        );
    }

    #[test]
    fn keeps_import_rules_at_the_start_of_the_first_chunk() {
        let css = r#"
            @import url("tokens.css");
            .a { color: red; }
            .b { color: blue; }
            .c { color: green; }
            .d { color: navy; }
            .e { color: teal; }
            .f { color: purple; }
        "#;
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 30,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.split);
        assert!(
            output
                .chunks
                .first()
                .is_some_and(|chunk| chunk.contains("@import")),
            "first chunk should keep @import: {:?}",
            output.chunks
        );
        assert!(
            output
                .chunks
                .iter()
                .skip(1)
                .all(|chunk| !chunk.contains("@import")),
            "later chunks must not contain @import: {:?}",
            output.chunks
        );
    }

    #[test]
    fn does_not_duplicate_rules_across_size_chunks() {
        let css =
            ".a{color:red}.b{color:blue}.c{color:green}.d{color:#000}.e{color:#fff}.f{color:navy}";
        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 30,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split succeeds");

        assert!(output.split);
        assert!(output.chunks.len() > 1);

        let mut seen = HashSet::new();
        for chunk in &output.chunks {
            for selector in [".a", ".b", ".c", ".d", ".e", ".f"] {
                if chunk.contains(selector) {
                    assert!(
                        seen.insert(selector),
                        "selector {selector} duplicated across chunks: {chunks:?}",
                        chunks = output.chunks
                    );
                }
            }
        }

        assert_eq!(seen.len(), 6, "every input selector should appear once");
    }

    fn many_rules_css(count: usize) -> String {
        (0..count)
            .map(|i| {
                format!(
                    ".r{i} {{ color: #{c:06x}; margin: {m}px; }}",
                    c = i * 977,
                    m = i % 40
                )
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn rule_size_estimate_matches_the_printer_for_both_modes() {
        let css = ".a { color: red; } @media (min-width: 10px) { .b { margin: 0; } } .c:hover { top: 1px; }";
        let stylesheet = StyleSheet::parse(css, ParserOptions::default()).expect("parse");
        let rules = stylesheet.rules.0;

        for minify in [true, false] {
            let sizes = rules
                .iter()
                .map(|rule| render_rule_len(rule, minify).expect("len"))
                .collect::<Vec<_>>();
            let (separator, trailer) = measure_framing(&rules, &sizes, minify).expect("framing");
            let estimate: usize =
                sizes.iter().sum::<usize>() + separator * (rules.len() - 1) + trailer;
            let exact = render_rules(&rules, minify).expect("render").len();
            assert_eq!(estimate, exact, "minify={minify}");
        }
    }

    #[test]
    fn many_rules_split_into_budgeted_chunks_without_losing_rules() {
        let css = many_rules_css(400);
        for minify in [true, false] {
            let output = split_css_by_size(
                &css,
                &SizeSplitterConfig {
                    max_chunk_size: 1_000,
                    isolate_variables: false,
                    minify,
                },
            )
            .expect("split");

            assert!(output.chunks.len() > 5);
            assert!(!output.oversized);
            assert!(output.chunks.iter().all(|chunk| chunk.len() <= 1_000));
            let joined = output.chunks.join("");
            for i in 0..400 {
                assert!(joined.contains(&format!(".r{i}")), "missing .r{i}");
            }
        }
    }

    #[test]
    fn an_oversized_rule_is_emitted_alone() {
        let big = format!(".big {{ content: \"{}\"; }}", "x".repeat(300));
        let css = format!(".a {{ color: red; }}\n{big}\n.b {{ color: blue; }}");
        let output = split_css_by_size(
            &css,
            &SizeSplitterConfig {
                max_chunk_size: 100,
                isolate_variables: false,
                minify: true,
            },
        )
        .expect("split");

        assert!(output.oversized);
        assert_eq!(output.chunks.len(), 3);
        assert!(output.chunks[1].contains(".big"));
    }
}
