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
use lightningcss::selector::Selector;
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

    if css.len() <= config.max_chunk_size {
        if !config.minify {
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

        return Ok(SizeSplitOutput {
            variables_css: String::new(),
            chunks: if css.trim().is_empty() {
                Vec::new()
            } else {
                vec![minify_css(css)?]
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
    let chunks = split_rules(body, config.max_chunk_size, config.minify)?;
    let oversized = variables_css.len() > config.max_chunk_size
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

fn is_variable_rule_css(rule: &CssRule<'_>) -> bool {
    match <CssRule<'_> as ToCss>::to_css_string(rule, PrinterOptions::default()) {
        Ok(css) => {
            let css = css.trim_start().to_ascii_lowercase();
            css.starts_with("@custom-media")
                || css.starts_with("@property")
                || css.starts_with("@theme")
        }
        Err(_) => false,
    }
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
        if is_variable_rule_css(rule) {
            variables.push(rule.clone());
            continue;
        }

        match rule {
            CssRule::Property(_) | CssRule::CustomMedia(_) => {
                variables.push(rule.clone());
            }
            CssRule::Unknown(unknown) if unknown.name.as_ref().eq_ignore_ascii_case("theme") => {
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
    if style.selectors.0.iter().any(selector_has_variable_scope) {
        return Ok((vec![style.clone()], None));
    }

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

fn selector_has_variable_scope(selector: &Selector<'_>) -> bool {
    match <Selector<'_> as ToCss>::to_css_string(selector, PrinterOptions::default()) {
        Ok(css) => {
            let lower = css.to_ascii_lowercase();
            lower.contains(":root") || lower.contains(":host")
        }
        Err(_) => false,
    }
}

fn is_custom_property(property: &Property<'_>) -> bool {
    matches!(property, Property::Custom(_))
}

fn split_rules<'i>(
    rules: Vec<CssRule<'i>>,
    max_chunk_size: usize,
    minify: bool,
) -> Result<Vec<String>, String> {
    let mut chunks = Vec::new();
    let mut current = Vec::new();

    for rule in rules {
        current.push(rule);

        let rendered = render_rules(&current, minify)?;

        if rendered.len() <= max_chunk_size {
            continue;
        }

        if current.len() == 1 {
            chunks.push(rendered);
            current.clear();
            continue;
        }

        let last = current
            .pop()
            .ok_or_else(|| "internal rule buffer error".to_string())?;
        chunks.push(render_rules(&current, minify)?);
        current.clear();
        current.push(last);

        let single = render_rules(&current, minify)?;

        if single.len() > max_chunk_size {
            chunks.push(single);
            current.clear();
        }
    }

    if !current.is_empty() {
        chunks.push(render_rules(&current, minify)?);
    }

    Ok(chunks)
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

        let output = split_css_by_size(
            css,
            &SizeSplitterConfig {
                max_chunk_size: 80,
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
}
