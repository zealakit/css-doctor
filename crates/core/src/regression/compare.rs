//! Compare a current baseline snapshot against a stored reference baseline.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

use crate::health::{DimensionId, HealthGrade, HealthSeverity, HealthStatus};

use super::baseline::{
    BaselineDiagnostic, BaselineDocument, BaselineFileEntry, BaselineHealthSnapshot,
};
use super::fingerprint::normalize_relative_path;
use super::gates::{GateEvaluation, QualityGateConfig, evaluate_quality_gates};

/// Overall regression classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RegressionStatus {
    Healthy,
    Improved,
    Regressed,
    Mixed,
    Inconclusive,
}

/// Comparison tolerances used to avoid noisy reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompareOptions {
    /// Absolute score points ignored when classifying overall/dimension change.
    pub score_tolerance: u8,
    /// Absolute byte growth ignored unless percentage also exceeds threshold.
    pub size_absolute_tolerance_bytes: usize,
    /// Percentage size growth that counts as a size regression.
    pub size_increase_percent: f64,
    /// Absolute rule/declaration growth ignored for count regressions.
    pub count_absolute_tolerance: usize,
    /// Percentage rule/declaration growth that counts as regression.
    pub count_increase_percent: f64,
}

impl Default for CompareOptions {
    fn default() -> Self {
        Self {
            score_tolerance: 1,
            size_absolute_tolerance_bytes: 1_024,
            size_increase_percent: 10.0,
            count_absolute_tolerance: 5,
            count_increase_percent: 10.0,
        }
    }
}

/// Side-by-side health snapshot for reports.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotRef {
    pub score: u8,
    pub grade: HealthGrade,
    pub status: HealthStatus,
    pub timestamp: String,
    pub tool_version: String,
    pub size_bytes: usize,
    pub rules: usize,
    pub selectors: usize,
    pub declarations: usize,
    pub files: usize,
}

impl SnapshotRef {
    fn from_document(document: &BaselineDocument) -> Self {
        Self {
            score: document.health.overall,
            grade: document.health.grade,
            status: document.health.status,
            timestamp: document.created_at.clone(),
            tool_version: document.tool_version.clone(),
            size_bytes: document.health.size_bytes,
            rules: document.health.rules,
            selectors: document.health.selectors,
            declarations: document.health.declarations,
            files: document.health.files,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeDelta {
    pub baseline: usize,
    pub current: usize,
    pub change_bytes: i64,
    pub change_percent: Option<f64>,
}

impl SizeDelta {
    fn from_sizes(baseline: usize, current: usize) -> Self {
        let change_bytes = current as i64 - baseline as i64;
        let change_percent = if baseline == 0 {
            if current == 0 { Some(0.0) } else { None }
        } else {
            Some((change_bytes as f64 / baseline as f64) * 100.0)
        };
        Self {
            baseline,
            current,
            change_bytes,
            change_percent,
        }
    }

    fn is_significant_increase(&self, options: &CompareOptions) -> bool {
        if self.change_bytes <= 0 {
            return false;
        }
        if (self.change_bytes as usize) <= options.size_absolute_tolerance_bytes {
            return false;
        }
        self.change_percent
            .is_some_and(|percent| percent > options.size_increase_percent)
    }

    fn is_significant_decrease(&self, options: &CompareOptions) -> bool {
        if self.change_bytes >= 0 {
            return false;
        }
        let abs = (-self.change_bytes) as usize;
        if abs <= options.size_absolute_tolerance_bytes {
            return false;
        }
        self.change_percent
            .is_some_and(|percent| percent < -options.size_increase_percent)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CountDelta {
    pub baseline: usize,
    pub current: usize,
    pub change: i64,
    pub change_percent: Option<f64>,
}

impl CountDelta {
    fn from_counts(baseline: usize, current: usize) -> Self {
        let change = current as i64 - baseline as i64;
        let change_percent = if baseline == 0 {
            if current == 0 { Some(0.0) } else { None }
        } else {
            Some((change as f64 / baseline as f64) * 100.0)
        };
        Self {
            baseline,
            current,
            change,
            change_percent,
        }
    }

    fn is_significant_increase(&self, options: &CompareOptions) -> bool {
        if self.change <= 0 {
            return false;
        }
        if (self.change as usize) <= options.count_absolute_tolerance {
            return false;
        }
        self.change_percent
            .is_some_and(|percent| percent > options.count_increase_percent)
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DimensionDelta {
    pub id: DimensionId,
    pub baseline: Option<u8>,
    pub current: Option<u8>,
    pub change: Option<i16>,
    pub evaluated_baseline: bool,
    pub evaluated_current: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticDiffEntry {
    pub fingerprint: String,
    pub code: String,
    pub severity: HealthSeverity,
    pub category: DimensionId,
    pub file_path: Option<String>,
    pub selector: Option<String>,
    pub message: String,
}

impl From<&BaselineDiagnostic> for DiagnosticDiffEntry {
    fn from(diagnostic: &BaselineDiagnostic) -> Self {
        Self {
            fingerprint: diagnostic.fingerprint.clone(),
            code: diagnostic.code.clone(),
            severity: diagnostic.severity,
            category: diagnostic.category,
            file_path: diagnostic.file_path.clone(),
            selector: diagnostic.selector.clone(),
            message: diagnostic.message.clone(),
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticChangeSet {
    pub new: Vec<DiagnosticDiffEntry>,
    pub resolved: Vec<DiagnosticDiffEntry>,
    pub persistent: Vec<DiagnosticDiffEntry>,
    pub changed: Vec<DiagnosticDiffEntry>,
}

impl DiagnosticChangeSet {
    #[must_use]
    pub fn new_errors(&self) -> usize {
        self.new
            .iter()
            .filter(|entry| entry.severity == HealthSeverity::Error)
            .count()
    }

    #[must_use]
    pub fn new_warnings(&self) -> usize {
        self.new
            .iter()
            .filter(|entry| entry.severity == HealthSeverity::Warning)
            .count()
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileDiffEntry {
    pub path: String,
    pub baseline_size_bytes: Option<usize>,
    pub current_size_bytes: Option<usize>,
    pub size_change_percent: Option<f64>,
    pub content_changed: bool,
    pub quality_regressed: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeSet {
    pub added: Vec<FileDiffEntry>,
    pub removed: Vec<FileDiffEntry>,
    pub modified: Vec<FileDiffEntry>,
    pub regressed: Vec<FileDiffEntry>,
    pub unchanged: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegressionChanges {
    pub score: i16,
    pub css_size: SizeDelta,
    pub rules: CountDelta,
    pub selectors: CountDelta,
    pub declarations: CountDelta,
    pub dimensions: Vec<DimensionDelta>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegressionReport {
    pub schema_version: u32,
    pub status: RegressionStatus,
    pub baseline: SnapshotRef,
    pub current: SnapshotRef,
    pub changes: RegressionChanges,
    pub diagnostics: DiagnosticChangeSet,
    pub files: FileChangeSet,
    pub warnings: Vec<String>,
    pub quality_gates: Option<GateEvaluation>,
}

/// Compares `current` analysis snapshot against a stored `baseline`.
#[must_use]
pub fn compare_baselines(
    baseline: &BaselineDocument,
    current: &BaselineDocument,
    options: &CompareOptions,
) -> RegressionReport {
    compare_baselines_with_gates(baseline, current, options, None)
}

/// Compares baselines and optionally evaluates quality gates.
#[must_use]
pub fn compare_baselines_with_gates(
    baseline: &BaselineDocument,
    current: &BaselineDocument,
    options: &CompareOptions,
    gates: Option<&QualityGateConfig>,
) -> RegressionReport {
    let mut warnings = Vec::new();

    if baseline.schema_version != current.schema_version {
        warnings.push(format!(
            "schemaVersion differs (baseline={}, current={})",
            baseline.schema_version, current.schema_version
        ));
    }

    let score_change = i16::from(current.health.overall) - i16::from(baseline.health.overall);
    let css_size = SizeDelta::from_sizes(baseline.health.size_bytes, current.health.size_bytes);
    let rules = CountDelta::from_counts(baseline.health.rules, current.health.rules);
    let selectors = CountDelta::from_counts(baseline.health.selectors, current.health.selectors);
    let declarations =
        CountDelta::from_counts(baseline.health.declarations, current.health.declarations);
    let dimensions = compare_dimensions(&baseline.health, &current.health);
    let diagnostics = compare_diagnostics(&baseline.diagnostics, &current.diagnostics);
    let files = compare_files(&baseline.files, &current.files, options);

    let status = classify_status(
        score_change,
        &dimensions,
        &css_size,
        &rules,
        &declarations,
        &diagnostics,
        &files,
        options,
        &mut warnings,
    );

    let mut report = RegressionReport {
        schema_version: 1,
        status,
        baseline: SnapshotRef::from_document(baseline),
        current: SnapshotRef::from_document(current),
        changes: RegressionChanges {
            score: score_change,
            css_size,
            rules,
            selectors,
            declarations,
            dimensions,
        },
        diagnostics,
        files,
        warnings,
        quality_gates: None,
    };

    if let Some(config) = gates {
        report.quality_gates = Some(evaluate_quality_gates(&report, config));
    }

    report
}

fn compare_dimensions(
    baseline: &BaselineHealthSnapshot,
    current: &BaselineHealthSnapshot,
) -> Vec<DimensionDelta> {
    let ids = [
        DimensionId::SelectorComplexity,
        DimensionId::DuplicateRules,
        DimensionId::CssSizeEfficiency,
        DimensionId::DeadCss,
        DimensionId::VariableConsistency,
    ];

    ids.into_iter()
        .map(|id| {
            let baseline_dim = baseline
                .dimensions
                .iter()
                .find(|dimension| dimension.id == id);
            let current_dim = current
                .dimensions
                .iter()
                .find(|dimension| dimension.id == id);
            let baseline_score = baseline_dim.and_then(|dimension| dimension.score);
            let current_score = current_dim.and_then(|dimension| dimension.score);
            let change = match (baseline_score, current_score) {
                (Some(left), Some(right)) => Some(i16::from(right) - i16::from(left)),
                _ => None,
            };
            DimensionDelta {
                id,
                baseline: baseline_score,
                current: current_score,
                change,
                evaluated_baseline: baseline_dim.is_some_and(|dimension| dimension.evaluated),
                evaluated_current: current_dim.is_some_and(|dimension| dimension.evaluated),
            }
        })
        .collect()
}

fn compare_diagnostics(
    baseline: &[BaselineDiagnostic],
    current: &[BaselineDiagnostic],
) -> DiagnosticChangeSet {
    let baseline_map: BTreeMap<String, &BaselineDiagnostic> = baseline
        .iter()
        .map(|diagnostic| (diagnostic.identity_key(), diagnostic))
        .collect();
    let current_map: BTreeMap<String, &BaselineDiagnostic> = current
        .iter()
        .map(|diagnostic| (diagnostic.identity_key(), diagnostic))
        .collect();

    let baseline_keys: BTreeSet<_> = baseline_map.keys().cloned().collect();
    let current_keys: BTreeSet<_> = current_map.keys().cloned().collect();

    let mut new = Vec::new();
    let mut resolved = Vec::new();
    let mut persistent = Vec::new();
    let mut changed = Vec::new();

    for key in current_keys.difference(&baseline_keys) {
        if let Some(diagnostic) = current_map.get(key) {
            new.push(DiagnosticDiffEntry::from(*diagnostic));
        }
    }

    for key in baseline_keys.difference(&current_keys) {
        if let Some(diagnostic) = baseline_map.get(key) {
            resolved.push(DiagnosticDiffEntry::from(*diagnostic));
        }
    }

    for key in baseline_keys.intersection(&current_keys) {
        let Some(left) = baseline_map.get(key) else {
            continue;
        };
        let Some(right) = current_map.get(key) else {
            continue;
        };
        if left.message != right.message || left.fingerprint != right.fingerprint {
            changed.push(DiagnosticDiffEntry::from(*right));
        } else {
            persistent.push(DiagnosticDiffEntry::from(*right));
        }
    }

    new.sort_by(|left, right| left.fingerprint.cmp(&right.fingerprint));
    resolved.sort_by(|left, right| left.fingerprint.cmp(&right.fingerprint));
    persistent.sort_by(|left, right| left.fingerprint.cmp(&right.fingerprint));
    changed.sort_by(|left, right| left.fingerprint.cmp(&right.fingerprint));

    DiagnosticChangeSet {
        new,
        resolved,
        persistent,
        changed,
    }
}

fn compare_files(
    baseline: &[BaselineFileEntry],
    current: &[BaselineFileEntry],
    options: &CompareOptions,
) -> FileChangeSet {
    let baseline_map: BTreeMap<String, &BaselineFileEntry> = baseline
        .iter()
        .map(|file| (normalize_relative_path(&file.path), file))
        .collect();
    let current_map: BTreeMap<String, &BaselineFileEntry> = current
        .iter()
        .map(|file| (normalize_relative_path(&file.path), file))
        .collect();

    let baseline_keys: BTreeSet<_> = baseline_map.keys().cloned().collect();
    let current_keys: BTreeSet<_> = current_map.keys().cloned().collect();

    let mut added = Vec::new();
    let mut removed = Vec::new();
    let mut modified = Vec::new();
    let mut regressed = Vec::new();
    let mut unchanged = 0usize;

    for path in current_keys.difference(&baseline_keys) {
        let file = current_map[path];
        added.push(FileDiffEntry {
            path: path.clone(),
            baseline_size_bytes: None,
            current_size_bytes: Some(file.size_bytes),
            size_change_percent: None,
            content_changed: true,
            quality_regressed: false,
        });
    }

    for path in baseline_keys.difference(&current_keys) {
        let file = baseline_map[path];
        removed.push(FileDiffEntry {
            path: path.clone(),
            baseline_size_bytes: Some(file.size_bytes),
            current_size_bytes: None,
            size_change_percent: None,
            content_changed: true,
            quality_regressed: false,
        });
    }

    for path in baseline_keys.intersection(&current_keys) {
        let left = baseline_map[path];
        let right = current_map[path];
        let size = SizeDelta::from_sizes(left.size_bytes, right.size_bytes);
        let content_changed = left.content_hash != right.content_hash;
        if !content_changed && size.change_bytes == 0 {
            unchanged += 1;
            continue;
        }

        let quality_regressed = size.is_significant_increase(options);
        let entry = FileDiffEntry {
            path: path.clone(),
            baseline_size_bytes: Some(left.size_bytes),
            current_size_bytes: Some(right.size_bytes),
            size_change_percent: size.change_percent,
            content_changed,
            quality_regressed,
        };
        if quality_regressed {
            regressed.push(entry.clone());
        }
        modified.push(entry);
    }

    FileChangeSet {
        added,
        removed,
        modified,
        regressed,
        unchanged,
    }
}

#[allow(clippy::too_many_arguments)]
fn classify_status(
    score_change: i16,
    dimensions: &[DimensionDelta],
    css_size: &SizeDelta,
    rules: &CountDelta,
    declarations: &CountDelta,
    diagnostics: &DiagnosticChangeSet,
    files: &FileChangeSet,
    options: &CompareOptions,
    warnings: &mut Vec<String>,
) -> RegressionStatus {
    let mut improvements = 0u32;
    let mut regressions = 0u32;

    let score_tol = i16::from(options.score_tolerance);
    if score_change > score_tol {
        improvements += 1;
    } else if score_change < -score_tol {
        regressions += 1;
    }

    for dimension in dimensions {
        match dimension.change {
            Some(change) if change > score_tol => improvements += 1,
            Some(change) if change < -score_tol => regressions += 1,
            None if dimension.evaluated_baseline || dimension.evaluated_current => {
                warnings.push(format!(
                    "dimension {} lacks comparable scores",
                    dimension.id.as_str()
                ));
            }
            _ => {}
        }
    }

    if css_size.is_significant_increase(options)
        || rules.is_significant_increase(options)
        || declarations.is_significant_increase(options)
    {
        regressions += 1;
    } else if css_size.is_significant_decrease(options) {
        improvements += 1;
    }

    let new_errors = diagnostics.new_errors();
    let new_warnings = diagnostics.new_warnings();
    if new_errors > 0 {
        regressions += 1;
    } else if !diagnostics.new.is_empty() && new_warnings > 0 {
        // New non-error diagnostics count as a mild regression signal.
        regressions += 1;
    }
    if !diagnostics.resolved.is_empty() && diagnostics.new.is_empty() {
        improvements += 1;
    }

    if !files.regressed.is_empty() {
        regressions += 1;
    }

    let comparable = score_change != 0
        || dimensions
            .iter()
            .any(|dimension| dimension.change.is_some())
        || css_size.change_bytes != 0
        || !diagnostics.new.is_empty()
        || !diagnostics.resolved.is_empty()
        || !files.added.is_empty()
        || !files.removed.is_empty()
        || !files.modified.is_empty();

    if !comparable && improvements == 0 && regressions == 0 {
        return RegressionStatus::Healthy;
    }

    match (improvements > 0, regressions > 0) {
        (false, false) => RegressionStatus::Healthy,
        (true, false) => RegressionStatus::Improved,
        (false, true) => RegressionStatus::Regressed,
        (true, true) => RegressionStatus::Mixed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::health::{
        DiagnosticCertainty, HealthDiagnostic, HealthScoreConfig, evaluate_css_health,
    };
    use crate::regression::baseline::{
        BaselineConfigSnapshot, BaselineDiagnostic, BaselineDocument, BaselineFileEntry,
        BaselineGitMetadata, BaselineProjectMetadata,
    };

    #[test]
    fn detects_score_regression() {
        let baseline = make_doc(".a{color:red}", 95, "a.css");
        let mut current = make_doc(".a{color:red}", 80, "a.css");
        current.health.overall = 80;
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.status, RegressionStatus::Regressed);
        assert_eq!(report.changes.score, -15);
    }

    #[test]
    fn detects_improved_score() {
        let baseline = make_doc(".a{color:red}", 80, "a.css");
        let mut current = make_doc(".a{color:red}", 95, "a.css");
        current.health.overall = 95;
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.status, RegressionStatus::Improved);
    }

    #[test]
    fn healthy_when_unchanged() {
        let baseline = make_doc(".a{color:red}", 90, "a.css");
        let current = make_doc(".a{color:red}", 90, "a.css");
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.status, RegressionStatus::Healthy);
        assert!(report.diagnostics.new.is_empty());
        assert!(report.diagnostics.resolved.is_empty());
    }

    #[test]
    fn classifies_new_and_resolved_diagnostics() {
        let mut baseline = make_doc(".a{color:red}", 90, "a.css");
        let mut current = make_doc(".a{color:red}", 90, "a.css");

        baseline.diagnostics = vec![diag("dead.empty-rule", "a.css", ".dead")];
        current.diagnostics = vec![diag("selector.high-specificity", "a.css", ".nested")];

        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.diagnostics.new.len(), 1);
        assert_eq!(report.diagnostics.resolved.len(), 1);
        assert!(report.diagnostics.persistent.is_empty());
    }

    #[test]
    fn diagnostic_match_ignores_line_shifts() {
        let left = HealthDiagnostic {
            code: "dup.selector".into(),
            severity: HealthSeverity::Warning,
            category: DimensionId::DuplicateRules,
            message: "dup".into(),
            file_path: Some("src/a.css".into()),
            location: Some(crate::model::SourceLocation::new(10, 1)),
            selector: Some(".card".into()),
            remediation: "merge".into(),
            certainty: DiagnosticCertainty::Confirmed,
        };
        let mut right = left.clone();
        right.location = Some(crate::model::SourceLocation::new(50, 1));

        let baseline_diag = BaselineDiagnostic::from_health(&left);
        let current_diag = BaselineDiagnostic::from_health(&right);
        assert_eq!(baseline_diag.identity_key(), current_diag.identity_key());

        let mut baseline = make_doc(".a{color:red}", 90, "src/a.css");
        let mut current = make_doc(".a{color:red}", 90, "src/a.css");
        baseline.diagnostics = vec![baseline_diag];
        current.diagnostics = vec![current_diag];
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.diagnostics.persistent.len(), 1);
        assert!(report.diagnostics.new.is_empty());
        assert!(report.diagnostics.resolved.is_empty());
    }

    #[test]
    fn detects_added_and_removed_files() {
        let baseline = make_doc(".a{color:red}", 90, "a.css");
        let mut current = make_doc(".b{color:blue}", 90, "b.css");
        current.files = vec![BaselineFileEntry::from_css(
            "b.css",
            ".b{color:blue}",
            1,
            1,
            1,
        )];
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_eq!(report.files.added.len(), 1);
        assert_eq!(report.files.removed.len(), 1);
    }

    #[test]
    fn size_growth_can_trigger_regression_even_if_score_rises() {
        let small = ".a{color:red}";
        let large = &format!("{small}{}", ".x{color:blue}".repeat(200));
        let mut baseline = make_doc(small, 80, "a.css");
        let mut current = make_doc(large, 90, "a.css");
        baseline.health.overall = 80;
        baseline.health.size_bytes = small.len();
        baseline.files = vec![BaselineFileEntry::from_css("a.css", small, 1, 1, 1)];
        current.health.overall = 90;
        current.health.size_bytes = large.len();
        current.files = vec![BaselineFileEntry::from_css("a.css", large, 200, 200, 200)];

        let report = compare_baselines(
            &baseline,
            &current,
            &CompareOptions {
                size_absolute_tolerance_bytes: 10,
                size_increase_percent: 5.0,
                ..CompareOptions::default()
            },
        );
        assert!(matches!(
            report.status,
            RegressionStatus::Mixed | RegressionStatus::Regressed
        ));
        assert!(report.changes.css_size.change_bytes > 0);
    }

    #[test]
    fn missing_dimension_scores_are_not_improvements() {
        let mut baseline = make_doc(".a{color:red}", 90, "a.css");
        let mut current = make_doc(".a{color:red}", 90, "a.css");
        baseline.health.dimensions.clear();
        current.health.dimensions.clear();
        let report = compare_baselines(&baseline, &current, &CompareOptions::default());
        assert_ne!(report.status, RegressionStatus::Improved);
    }

    fn make_doc(css: &str, overall: u8, path: &str) -> BaselineDocument {
        let report =
            evaluate_css_health(css, Some(path), Some(10), &HealthScoreConfig::default()).unwrap();
        let mut document = BaselineDocument::from_health_report(
            &report,
            "1.0.0",
            "2026-11-04T00:00:00Z",
            BaselineConfigSnapshot::default(),
            vec![BaselineFileEntry::from_css(path, css, 1, 1, 1)],
            BaselineProjectMetadata::default(),
            BaselineGitMetadata::default(),
        );
        document.health.overall = overall;
        document.health.size_bytes = css.len();
        document
    }

    fn diag(code: &str, path: &str, selector: &str) -> BaselineDiagnostic {
        BaselineDiagnostic::from_health(&HealthDiagnostic {
            code: code.into(),
            severity: HealthSeverity::Warning,
            category: DimensionId::DeadCss,
            message: code.into(),
            file_path: Some(path.into()),
            location: Some(crate::model::SourceLocation::new(1, 1)),
            selector: Some(selector.into()),
            remediation: "fix".into(),
            certainty: DiagnosticCertainty::Confirmed,
        })
    }
}
