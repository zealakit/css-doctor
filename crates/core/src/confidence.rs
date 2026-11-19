//! Shared confidence model for static, runtime and config evidence.
//!
//! A *level* tells users how far to trust a verdict (especially "dead"):
//!
//! | Evidence | Verdict | Level |
//! |---|---|---|
//! | runtime hit | used | high |
//! | static confirmed (precise match) | used | high |
//! | static partial / any-class | used (partial) | medium |
//! | only unresolved / unsupported evidence | unknown | low |
//! | no static evidence, route runtime-covered | unused | high |
//! | no static evidence, static only | unused | medium |
//!
//! Dead-code removal may only act on `unused` verdicts whose level is at least
//! a configurable minimum ([`meets_min_confidence`]). The default minimum is
//! [`ConfidenceLevel::Medium`], which preserves pre-confidence behavior.

use serde::{Deserialize, Serialize};

use crate::markup_match::{MatchConfidence, SelectorUsageStatus};

/// How far a usage verdict can be trusted. Ordered `Low < Medium < High`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConfidenceLevel {
    Low,
    Medium,
    High,
}

impl ConfidenceLevel {
    /// Lowercase label (`"low"` / `"medium"` / `"high"`).
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Low => "low",
            Self::Medium => "medium",
            Self::High => "high",
        }
    }

    /// Parses a label case-insensitively.
    pub fn parse(value: &str) -> Result<Self, String> {
        match value.trim().to_ascii_lowercase().as_str() {
            "low" => Ok(Self::Low),
            "medium" => Ok(Self::Medium),
            "high" => Ok(Self::High),
            other => Err(format!(
                "invalid confidence level '{other}': expected low, medium or high"
            )),
        }
    }
}

/// Where a verdict's evidence came from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceSource {
    Static,
    Runtime,
    Config,
}

impl EvidenceSource {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Static => "static",
            Self::Runtime => "runtime",
            Self::Config => "config",
        }
    }
}

/// What runtime coverage (browser) says about a selector on the analysed routes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum RuntimeEvidence {
    /// No coverage collected for this selector's routes.
    #[default]
    NotCollected,
    /// Routes were covered and the selector never matched.
    CoveredUnused,
    /// A covered route used the selector.
    Hit,
}

/// A usage verdict with its trust level and evidence sources.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageVerdict {
    pub status: SelectorUsageStatus,
    pub level: ConfidenceLevel,
    pub sources: Vec<EvidenceSource>,
}

/// Combines static match output with optional runtime and config evidence.
///
/// `forced_by_config` is true when the selector is protected by a config
/// override such as `forceCommonSelectors`.
pub fn derive_verdict(
    static_confidence: MatchConfidence,
    static_status: SelectorUsageStatus,
    runtime: RuntimeEvidence,
    forced_by_config: bool,
) -> UsageVerdict {
    let mut sources = vec![EvidenceSource::Static];

    if forced_by_config {
        sources.push(EvidenceSource::Config);
        return UsageVerdict {
            status: SelectorUsageStatus::Used,
            level: ConfidenceLevel::High,
            sources,
        };
    }

    if runtime == RuntimeEvidence::Hit {
        sources.push(EvidenceSource::Runtime);
        return UsageVerdict {
            status: SelectorUsageStatus::Used,
            level: ConfidenceLevel::High,
            sources,
        };
    }

    let (status, mut level) = match static_confidence {
        MatchConfidence::Confirmed => (SelectorUsageStatus::Used, ConfidenceLevel::High),
        MatchConfidence::Partial => (static_status, ConfidenceLevel::Medium),
        MatchConfidence::Unresolved | MatchConfidence::Unsupported => {
            (SelectorUsageStatus::Unknown, ConfidenceLevel::Low)
        }
        MatchConfidence::None => (SelectorUsageStatus::Unused, ConfidenceLevel::Medium),
    };

    if runtime == RuntimeEvidence::CoveredUnused {
        sources.push(EvidenceSource::Runtime);
        // A full browser pass that never touched the selector settles an
        // otherwise static-only "unused"; it cannot upgrade a static hit.
        if status == SelectorUsageStatus::Unused {
            level = ConfidenceLevel::High;
        }
    }

    UsageVerdict {
        status,
        level,
        sources,
    }
}

/// True when dead-code removal may act on `verdict` at `min` confidence.
///
/// Only `Unused` verdicts are ever removable.
pub fn meets_min_confidence(verdict: &UsageVerdict, min: ConfidenceLevel) -> bool {
    verdict.status == SelectorUsageStatus::Unused && verdict.level >= min
}

#[cfg(test)]
mod tests {
    use super::*;

    fn verdict(
        confidence: MatchConfidence,
        status: SelectorUsageStatus,
        runtime: RuntimeEvidence,
    ) -> UsageVerdict {
        derive_verdict(confidence, status, runtime, false)
    }

    #[test]
    fn runtime_hit_is_used_high() {
        let v = verdict(
            MatchConfidence::None,
            SelectorUsageStatus::Unused,
            RuntimeEvidence::Hit,
        );
        assert_eq!(v.status, SelectorUsageStatus::Used);
        assert_eq!(v.level, ConfidenceLevel::High);
        assert_eq!(
            v.sources,
            vec![EvidenceSource::Static, EvidenceSource::Runtime]
        );
    }

    #[test]
    fn static_confirmed_is_high_partial_is_medium() {
        let confirmed = verdict(
            MatchConfidence::Confirmed,
            SelectorUsageStatus::Used,
            RuntimeEvidence::NotCollected,
        );
        assert_eq!(
            (confirmed.status, confirmed.level),
            (SelectorUsageStatus::Used, ConfidenceLevel::High)
        );

        let partial = verdict(
            MatchConfidence::Partial,
            SelectorUsageStatus::Partial,
            RuntimeEvidence::NotCollected,
        );
        assert_eq!(partial.level, ConfidenceLevel::Medium);
        assert_eq!(partial.status, SelectorUsageStatus::Partial);
    }

    #[test]
    fn unresolved_only_is_unknown_low() {
        for confidence in [MatchConfidence::Unresolved, MatchConfidence::Unsupported] {
            let v = verdict(
                confidence,
                SelectorUsageStatus::Unknown,
                RuntimeEvidence::NotCollected,
            );
            assert_eq!(
                (v.status, v.level),
                (SelectorUsageStatus::Unknown, ConfidenceLevel::Low)
            );
        }
    }

    #[test]
    fn unused_is_medium_static_only_and_high_when_runtime_covered() {
        let static_only = verdict(
            MatchConfidence::None,
            SelectorUsageStatus::Unused,
            RuntimeEvidence::NotCollected,
        );
        assert_eq!(static_only.level, ConfidenceLevel::Medium);
        assert_eq!(static_only.sources, vec![EvidenceSource::Static]);

        let covered = verdict(
            MatchConfidence::None,
            SelectorUsageStatus::Unused,
            RuntimeEvidence::CoveredUnused,
        );
        assert_eq!(covered.level, ConfidenceLevel::High);
        assert!(covered.sources.contains(&EvidenceSource::Runtime));
    }

    #[test]
    fn runtime_cover_does_not_upgrade_static_hit_or_unknown() {
        let unknown = verdict(
            MatchConfidence::Unresolved,
            SelectorUsageStatus::Unknown,
            RuntimeEvidence::CoveredUnused,
        );
        assert_eq!(unknown.level, ConfidenceLevel::Low);
    }

    #[test]
    fn config_forced_selectors_are_used() {
        let v = derive_verdict(
            MatchConfidence::None,
            SelectorUsageStatus::Unused,
            RuntimeEvidence::NotCollected,
            true,
        );
        assert_eq!(v.status, SelectorUsageStatus::Used);
        assert!(v.sources.contains(&EvidenceSource::Config));
    }

    #[test]
    fn removal_respects_minimum_confidence() {
        let medium_unused = verdict(
            MatchConfidence::None,
            SelectorUsageStatus::Unused,
            RuntimeEvidence::NotCollected,
        );
        assert!(meets_min_confidence(
            &medium_unused,
            ConfidenceLevel::Medium
        ));
        assert!(!meets_min_confidence(&medium_unused, ConfidenceLevel::High));

        let used = verdict(
            MatchConfidence::Confirmed,
            SelectorUsageStatus::Used,
            RuntimeEvidence::NotCollected,
        );
        assert!(!meets_min_confidence(&used, ConfidenceLevel::Low));
    }

    #[test]
    fn level_parsing_and_ordering() {
        assert_eq!(
            ConfidenceLevel::parse(" High ").unwrap(),
            ConfidenceLevel::High
        );
        assert!(ConfidenceLevel::parse("max").is_err());
        assert!(ConfidenceLevel::Low < ConfidenceLevel::Medium);
    }
}
