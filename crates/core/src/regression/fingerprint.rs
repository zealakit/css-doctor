//! Deterministic fingerprints for baseline files and diagnostics.

use crate::health::{HealthDiagnostic, HealthSeverity};

/// Normalizes a project-relative path for stable cross-platform comparison.
#[must_use]
pub fn normalize_relative_path(path: &str) -> String {
    path.replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches('/')
        .to_string()
}

/// Non-cryptographic content fingerprint (FNV-1a 64-bit, hex).
///
/// Used only to detect content changes between baseline and current runs.
#[must_use]
pub fn content_fingerprint(content: &str) -> String {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in content.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    format!("{hash:016x}")
}

/// Stable diagnostic identity that ignores line/column drift.
///
/// Format: `code|path|selector|severity`
#[must_use]
pub fn diagnostic_fingerprint(diagnostic: &HealthDiagnostic) -> String {
    diagnostic_fingerprint_parts(
        &diagnostic.code,
        diagnostic.file_path.as_deref(),
        diagnostic.selector.as_deref(),
        diagnostic.severity,
    )
}

#[must_use]
pub fn diagnostic_fingerprint_parts(
    code: &str,
    file_path: Option<&str>,
    selector: Option<&str>,
    severity: HealthSeverity,
) -> String {
    let path = file_path.map(normalize_relative_path).unwrap_or_default();
    let selector = selector.unwrap_or("").trim();
    let severity = match severity {
        HealthSeverity::Error => "error",
        HealthSeverity::Warning => "warning",
        HealthSeverity::Info => "info",
    };
    format!("{code}|{path}|{selector}|{severity}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::{DiagnosticCertainty, DimensionId, HealthDiagnostic};

    #[test]
    fn normalizes_windows_paths() {
        assert_eq!(
            normalize_relative_path(r".\src\styles\app.css"),
            "src/styles/app.css"
        );
    }

    #[test]
    fn fingerprint_ignores_location() {
        let left = HealthDiagnostic {
            code: "dead.empty-rule".into(),
            severity: HealthSeverity::Warning,
            category: DimensionId::DeadCss,
            message: "empty".into(),
            file_path: Some("src/a.css".into()),
            location: Some(crate::model::SourceLocation::new(10, 1)),
            selector: Some(".dead".into()),
            remediation: "remove".into(),
            certainty: DiagnosticCertainty::Confirmed,
        };
        let mut right = left.clone();
        right.location = Some(crate::model::SourceLocation::new(40, 1));
        assert_eq!(
            diagnostic_fingerprint(&left),
            diagnostic_fingerprint(&right)
        );
    }

    #[test]
    fn content_fingerprint_is_stable() {
        assert_eq!(
            content_fingerprint(".a{color:red}"),
            content_fingerprint(".a{color:red}")
        );
        assert_ne!(
            content_fingerprint(".a{color:red}"),
            content_fingerprint(".a{color:blue}")
        );
    }
}
