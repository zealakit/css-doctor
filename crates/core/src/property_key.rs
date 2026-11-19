//! Stable CSS property identity for duplicate detection.
//!
//! Uses LightningCSS `Property::property_id()` + `ToCss` so unparsed values
//! (`var(...)`) and vendor-prefixed names stay distinct. Never uses `Debug`.

use lightningcss::properties::Property;
use lightningcss::stylesheet::PrinterOptions;
use lightningcss::traits::ToCss;

/// Returns a stable lowercase CSS property name including vendor prefix.
///
/// Examples: `color`, `-webkit-transform`, `--fg`.
pub(crate) fn property_identity_key(property: &Property<'_>) -> String {
    match property
        .property_id()
        .to_css_string(PrinterOptions::default())
    {
        Ok(name) if !name.is_empty() => name.to_ascii_lowercase(),
        _ => {
            // Extremely defensive fallback — should not happen for valid IDs.
            format!("{:?}", property.property_id()).to_ascii_lowercase()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use lightningcss::stylesheet::{ParserOptions, StyleSheet};

    fn keys_from_rule(css: &str) -> Vec<String> {
        let sheet = StyleSheet::parse(
            css,
            ParserOptions {
                filename: "t.css".into(),
                error_recovery: true,
                ..ParserOptions::default()
            },
        )
        .unwrap();
        let lightningcss::rules::CssRule::Style(style) = &sheet.rules.0[0] else {
            panic!("expected style");
        };
        style
            .declarations
            .declarations
            .iter()
            .chain(style.declarations.important_declarations.iter())
            .map(property_identity_key)
            .collect()
    }

    #[test]
    fn distinguishes_unparsed_custom_properties() {
        let keys = keys_from_rule(".a { color: var(--fg); background: var(--bg); }");
        assert_eq!(keys.len(), 2);
        assert_ne!(keys[0], keys[1]);
        assert!(keys.iter().any(|k| k == "color"));
        assert!(
            keys.iter()
                .any(|k| k == "background" || k.starts_with("background"))
        );
    }

    #[test]
    fn distinguishes_vendor_prefixed_transform() {
        let keys =
            keys_from_rule(".a { transform: translateX(0); -webkit-transform: translateX(0); }");
        assert_eq!(keys.len(), 2);
        assert_ne!(keys[0], keys[1]);
        assert!(keys.iter().any(|k| k == "transform"));
        assert!(
            keys.iter()
                .any(|k| k.contains("webkit") && k.contains("transform"))
        );
    }
}
