//! Baseline document schema and validation.

use serde::{Deserialize, Serialize};

use crate::health::{
    DimensionId, HealthDiagnostic, HealthGrade, HealthReport, HealthSeverity, HealthStatus,
};

use super::fingerprint::{
    content_fingerprint, diagnostic_fingerprint, diagnostic_fingerprint_parts,
    normalize_relative_path,
};

/// Current baseline schema version written by this crate.
pub const CURRENT_BASELINE_SCHEMA: u32 = 1;

/// Optional project metadata stored in a baseline.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineProjectMetadata {
    pub name: Option<String>,
    pub root: Option<String>,
}

/// Optional Git metadata (never required).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineGitMetadata {
    pub commit: Option<String>,
    pub branch: Option<String>,
    pub dirty: Option<bool>,
}

/// Analysis configuration snapshot used when the baseline was created.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineConfigSnapshot {
    pub patterns: Vec<String>,
    pub threshold: Option<u32>,
}

/// Compact health score snapshot (no full diagnostic list duplication).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineHealthSnapshot {
    pub overall: u8,
    pub grade: HealthGrade,
    pub status: HealthStatus,
    pub dimensions: Vec<BaselineDimensionScore>,
    pub files: usize,
    pub rules: usize,
    pub selectors: usize,
    pub declarations: usize,
    pub size_bytes: usize,
    pub errors: usize,
    pub warnings: usize,
    pub suggestions: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDimensionScore {
    pub id: DimensionId,
    pub score: Option<u8>,
    pub evaluated: bool,
}

/// Per-file metrics and content fingerprint (no CSS source).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineFileEntry {
    pub path: String,
    pub size_bytes: usize,
    pub content_hash: String,
    pub rules: usize,
    pub selectors: usize,
    pub declarations: usize,
}

/// Diagnostic stored in a baseline with a stable fingerprint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDiagnostic {
    pub fingerprint: String,
    pub code: String,
    pub severity: HealthSeverity,
    pub category: DimensionId,
    pub file_path: Option<String>,
    pub selector: Option<String>,
    pub certainty: String,
    pub message: String,
}

/// Versioned baseline document.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BaselineDocument {
    pub schema_version: u32,
    pub tool_version: String,
    pub created_at: String,
    pub project: BaselineProjectMetadata,
    pub git: BaselineGitMetadata,
    pub config: BaselineConfigSnapshot,
    pub health: BaselineHealthSnapshot,
    pub diagnostics: Vec<BaselineDiagnostic>,
    pub files: Vec<BaselineFileEntry>,
}

impl BaselineDocument {
    /// Builds a baseline from a health report plus per-file entries.
    #[must_use]
    pub fn from_health_report(
        report: &HealthReport,
        tool_version: &str,
        created_at: &str,
        config: BaselineConfigSnapshot,
        files: Vec<BaselineFileEntry>,
        project: BaselineProjectMetadata,
        git: BaselineGitMetadata,
    ) -> Self {
        let diagnostics = report
            .diagnostics
            .iter()
            .map(BaselineDiagnostic::from_health)
            .collect();

        Self {
            schema_version: CURRENT_BASELINE_SCHEMA,
            tool_version: tool_version.to_string(),
            created_at: created_at.to_string(),
            project,
            git,
            config,
            health: BaselineHealthSnapshot::from_report(report),
            diagnostics,
            files: normalize_files(files),
        }
    }

    /// Serializes the baseline to pretty JSON.
    ///
    /// # Errors
    ///
    /// Returns a serde error when serialization fails.
    pub fn to_json_pretty(&self) -> Result<String, serde_json::Error> {
        serde_json::to_string_pretty(self)
    }

    /// Parses a baseline from JSON.
    ///
    /// # Errors
    ///
    /// Returns a serde error when the JSON is invalid.
    pub fn from_json(json: &str) -> Result<Self, serde_json::Error> {
        serde_json::from_str(json)
    }
}

impl BaselineDiagnostic {
    #[must_use]
    pub fn from_health(diagnostic: &HealthDiagnostic) -> Self {
        Self {
            fingerprint: diagnostic_fingerprint(diagnostic),
            code: diagnostic.code.clone(),
            severity: diagnostic.severity,
            category: diagnostic.category,
            file_path: diagnostic.file_path.as_deref().map(normalize_relative_path),
            selector: diagnostic.selector.clone(),
            certainty: match diagnostic.certainty {
                crate::health::DiagnosticCertainty::Confirmed => "confirmed".to_string(),
                crate::health::DiagnosticCertainty::Heuristic => "heuristic".to_string(),
            },
            message: diagnostic.message.clone(),
        }
    }

    #[must_use]
    pub fn identity_key(&self) -> String {
        diagnostic_fingerprint_parts(
            &self.code,
            self.file_path.as_deref(),
            self.selector.as_deref(),
            self.severity,
        )
    }
}

impl BaselineHealthSnapshot {
    #[must_use]
    pub fn from_report(report: &HealthReport) -> Self {
        Self {
            overall: report.overall,
            grade: report.grade,
            status: report.status,
            dimensions: report
                .dimensions
                .iter()
                .map(|dimension| BaselineDimensionScore {
                    id: dimension.id,
                    score: dimension.score,
                    evaluated: dimension.evaluated,
                })
                .collect(),
            files: report.summary.files,
            rules: report.summary.rules,
            selectors: report.summary.selectors,
            declarations: report.summary.declarations,
            size_bytes: report.summary.size_bytes,
            errors: report.summary.errors,
            warnings: report.summary.warnings,
            suggestions: report.summary.suggestions,
        }
    }
}

impl BaselineFileEntry {
    /// Creates a file entry from path, CSS content, and analysis counters.
    #[must_use]
    pub fn from_css(
        path: &str,
        css_content: &str,
        rules: usize,
        selectors: usize,
        declarations: usize,
    ) -> Self {
        Self {
            path: normalize_relative_path(path),
            size_bytes: css_content.len(),
            content_hash: content_fingerprint(css_content),
            rules,
            selectors,
            declarations,
        }
    }
}

/// Validation outcome for a baseline document.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BaselineValidation {
    Compatible,
    SoftWarning(String),
    Incompatible(String),
}

/// Validates baseline schema and basic integrity.
#[must_use]
pub fn validate_baseline_document(
    baseline: &BaselineDocument,
    current_tool_version: &str,
) -> BaselineValidation {
    if baseline.schema_version == 0 {
        return BaselineValidation::Incompatible(
            "baseline schemaVersion is 0 or missing; recreate with `css-doctor baseline create`"
                .to_string(),
        );
    }

    if baseline.schema_version > CURRENT_BASELINE_SCHEMA {
        return BaselineValidation::Incompatible(format!(
            "baseline schemaVersion {} is newer than supported {}; upgrade css-doctor",
            baseline.schema_version, CURRENT_BASELINE_SCHEMA
        ));
    }

    if baseline.schema_version < CURRENT_BASELINE_SCHEMA {
        return BaselineValidation::Incompatible(format!(
            "baseline schemaVersion {} is outdated (current {}); recreate the baseline",
            baseline.schema_version, CURRENT_BASELINE_SCHEMA
        ));
    }

    if baseline.tool_version.is_empty() {
        return BaselineValidation::Incompatible("baseline is missing toolVersion".to_string());
    }

    if baseline.files.is_empty() && baseline.health.size_bytes == 0 {
        return BaselineValidation::SoftWarning(
            "baseline contains no file entries; comparisons may be inconclusive".to_string(),
        );
    }

    for file in &baseline.files {
        if file.path.is_empty() || file.content_hash.is_empty() {
            return BaselineValidation::Incompatible(
                "baseline file entry is missing path or contentHash".to_string(),
            );
        }
    }

    if baseline.tool_version != current_tool_version {
        return BaselineValidation::SoftWarning(format!(
            "baseline toolVersion {} differs from current {}; comparison continues",
            baseline.tool_version, current_tool_version
        ));
    }

    BaselineValidation::Compatible
}

fn normalize_files(mut files: Vec<BaselineFileEntry>) -> Vec<BaselineFileEntry> {
    for file in &mut files {
        file.path = normalize_relative_path(&file.path);
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    files
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::{HealthScoreConfig, evaluate_css_health};

    #[test]
    fn round_trips_baseline_json() {
        let report = evaluate_css_health(
            ".a { color: red; }",
            Some("src/a.css"),
            Some(20),
            &HealthScoreConfig::default(),
        )
        .unwrap();
        let files = vec![BaselineFileEntry::from_css(
            "src/a.css",
            ".a { color: red; }",
            1,
            1,
            1,
        )];
        let baseline = BaselineDocument::from_health_report(
            &report,
            "1.0.0",
            "2026-11-04T00:00:00Z",
            BaselineConfigSnapshot {
                patterns: vec!["src/**/*.css".into()],
                threshold: None,
            },
            files,
            BaselineProjectMetadata::default(),
            BaselineGitMetadata::default(),
        );
        let json = baseline.to_json_pretty().unwrap();
        let parsed = BaselineDocument::from_json(&json).unwrap();
        assert_eq!(parsed.schema_version, CURRENT_BASELINE_SCHEMA);
        assert_eq!(parsed.files[0].path, "src/a.css");
        assert!(!json.contains("color: red"));
    }

    #[test]
    fn rejects_future_schema() {
        let mut baseline = sample_baseline();
        baseline.schema_version = 99;
        match validate_baseline_document(&baseline, "1.0.0") {
            BaselineValidation::Incompatible(message) => {
                assert!(message.contains("newer"));
            }
            other => panic!("expected incompatible, got {other:?}"),
        }
    }

    #[test]
    fn soft_warns_on_tool_version_mismatch() {
        let baseline = sample_baseline();
        match validate_baseline_document(&baseline, "9.9.9") {
            BaselineValidation::SoftWarning(message) => {
                assert!(message.contains("toolVersion"));
            }
            other => panic!("expected soft warning, got {other:?}"),
        }
    }

    fn sample_baseline() -> BaselineDocument {
        let report = evaluate_css_health(
            ".a { color: red; }",
            Some("a.css"),
            Some(10),
            &HealthScoreConfig::default(),
        )
        .unwrap();
        BaselineDocument::from_health_report(
            &report,
            "1.0.0",
            "2026-11-04T00:00:00Z",
            BaselineConfigSnapshot::default(),
            vec![BaselineFileEntry::from_css(
                "a.css",
                ".a { color: red; }",
                1,
                1,
                1,
            )],
            BaselineProjectMetadata::default(),
            BaselineGitMetadata::default(),
        )
    }
}
