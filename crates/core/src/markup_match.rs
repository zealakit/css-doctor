//! Match CSS selectors against static markup evidence.
//!
//! # Matching semantics (Phase 3)
//!
//! - **Simple selectors** match when static evidence is sufficient.
//! - **Compound selectors** require every positive structural requirement on the
//!   *same* element. One matching token is never enough.
//! - **Combinators** use parent/sibling links *within a single source file*.
//!   Relationships are never inferred across files.
//! - **`:not()`** excludes elements that match the negated selector.
//! - **`:is()` / `:where()` / `:any()`** are OR alternatives.
//! - **`:has()`** requires a matching descendant in the same file tree.
//! - **Runtime pseudos** (`:hover`, `:focus`, …) and **pseudo-elements** never
//!   produce `Confirmed` confidence; structural hits become `Partial`.
//! - **Positional** pseudos (`:nth-child`, `:first-child`, …) cannot be fully
//!   verified from static markup → `Partial` / `Unknown`.
//!
//! # Metrics
//!
//! - `matched_elements` / `match_count`: distinct subject elements with a full
//!   structural match in the evidence set (per-file, then summed).
//! - `usage_occurrences`: same as matched elements (one count per matching
//!   subject element; duplicates in one attribute are not re-counted here).
//! - `usage_files`: distinct source files with ≥1 confirmed structural match.
//! - `partial_elements` / `unresolved_elements`: weaker evidence counts.

use std::collections::{BTreeMap, BTreeSet};

use cssparser::ToCss as _;
use lightningcss::rules::CssRule;
use lightningcss::selector::{Component, Selector};
use lightningcss::stylesheet::{ParserOptions, StyleSheet};
use parcel_selectors::attr::{AttrSelectorOperator, ParsedAttrSelectorOperation};
use serde::{Deserialize, Serialize};

/// How strongly static analysis supports a selector usage claim.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MatchConfidence {
    /// All statically verifiable structural requirements matched.
    Confirmed,
    /// Incomplete compound/combinator evidence, or runtime/positional unproven.
    Partial,
    /// Only unresolved dynamic evidence related to the selector.
    Unresolved,
    /// Runtime-/pseudo-only; static analysis cannot confirm.
    Unsupported,
    /// No supporting evidence.
    None,
}

/// Explicit unused-selector / usage classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SelectorUsageStatus {
    /// ≥1 confirmed structural match with no unproven runtime/positional dependency.
    Used,
    /// Scan completed; no matching evidence within supported analysis.
    Unused,
    /// Partial compound evidence, or structural match with unproven runtime/positional state.
    Partial,
    /// Insufficient information (unsupported / unresolved / dynamic-only).
    Unknown,
}

/// One markup element collected by a source scanner.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkupElement {
    #[serde(default)]
    pub tag: Option<String>,
    #[serde(default)]
    pub id: Option<String>,
    #[serde(default)]
    pub classes: Vec<String>,
    #[serde(default)]
    pub dynamic_classes: Vec<String>,
    #[serde(default)]
    pub attributes: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub dynamic_attributes: Vec<String>,
    #[serde(default)]
    pub parent_index: Option<u32>,
    #[serde(default)]
    pub depth: u32,
}

/// Markup from a single source file. Combinator matching stays inside this tree.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkupFileEvidence {
    /// Project-relative path (forward slashes). Empty when unknown.
    #[serde(default)]
    pub path: String,
    pub elements: Vec<MarkupElement>,
}

/// Markup evidence. Prefer [`MarkupEvidence::files`] so combinators never cross files.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkupEvidence {
    /// Flat elements (legacy). Treated as a *single anonymous file*.
    #[serde(default)]
    pub elements: Vec<MarkupElement>,
    /// Per-file trees. When non-empty, matching uses these and ignores `elements`.
    #[serde(default)]
    pub files: Vec<MarkupFileEvidence>,
}

/// Per-file confirmed usage hit (project-relative path when available).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorFileUsageHit {
    pub file: String,
    /// Confirmed matching subjects in this file.
    pub count: u32,
}

/// Result of matching one selector against markup evidence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectorUsageMatch {
    pub selector: String,
    pub confidence: MatchConfidence,
    pub status: SelectorUsageStatus,
    /// Distinct subject elements with a full structural match.
    pub match_count: u32,
    /// Alias of `match_count` (documented counting rule: one per matching subject).
    pub matched_elements: u32,
    /// Same as `matched_elements` for this phase (occurrence = matching subject).
    pub usage_occurrences: u32,
    /// Distinct source files with ≥1 confirmed structural match.
    pub usage_files: u32,
    /// Per-file confirmed usage. Empty when paths are unavailable.
    #[serde(default)]
    pub usage_by_file: Vec<SelectorFileUsageHit>,
    pub partial_elements: u32,
    pub unresolved_elements: u32,
    pub has_unproven_runtime_state: bool,
    pub has_unproven_positional: bool,
    pub notes: Vec<String>,
}

/// Matches a CSS selector string against markup evidence.
pub fn match_selector_against_markup(
    selector_css: &str,
    evidence: &MarkupEvidence,
) -> Result<SelectorUsageMatch, String> {
    let files = evidence_files(evidence);
    match_selector_against_files(selector_css, &files)
}

/// Matches many selectors (one parse each) against the same evidence.
pub fn match_selectors_against_markup(
    selectors: &[String],
    evidence: &MarkupEvidence,
) -> Result<Vec<SelectorUsageMatch>, String> {
    let files = evidence_files(evidence);
    let mut out = Vec::with_capacity(selectors.len());
    for selector_css in selectors {
        out.push(match_selector_against_files(selector_css, &files)?);
    }
    Ok(out)
}

fn evidence_files(evidence: &MarkupEvidence) -> Vec<MarkupFileEvidence> {
    if !evidence.files.is_empty() {
        return evidence.files.clone();
    }
    if evidence.elements.is_empty() {
        return Vec::new();
    }
    vec![MarkupFileEvidence {
        path: String::new(),
        elements: evidence.elements.clone(),
    }]
}

fn match_selector_against_files(
    selector_css: &str,
    files: &[MarkupFileEvidence],
) -> Result<SelectorUsageMatch, String> {
    let wrapped = format!("{selector_css}{{}}");
    let stylesheet = StyleSheet::parse(&wrapped, ParserOptions::default())
        .map_err(|error| format!("failed to parse selector `{selector_css}`: {error}"))?;

    let CssRule::Style(style) = stylesheet
        .rules
        .0
        .first()
        .ok_or_else(|| format!("selector `{selector_css}` produced no rules"))?
    else {
        return Err(format!(
            "selector `{selector_css}` did not parse as a style rule"
        ));
    };

    let selector = style
        .selectors
        .0
        .first()
        .ok_or_else(|| format!("selector `{selector_css}` was empty"))?;

    Ok(match_parsed_against_files(selector, selector_css, files))
}

fn match_parsed_against_files(
    selector: &Selector<'_>,
    selector_css: &str,
    files: &[MarkupFileEvidence],
) -> SelectorUsageMatch {
    let compounds = split_compounds(selector);
    let runtime = compounds.iter().any(|c| c.has_runtime());
    let positional = compounds.iter().any(|c| c.positional);

    if compounds.is_empty() {
        return finish_match(FinishMatchParams {
            selector_css,
            confidence: MatchConfidence::None,
            matched: 0,
            partial: 0,
            unresolved: 0,
            usage_files: 0,
            usage_by_file: Vec::new(),
            runtime,
            positional,
            notes: vec!["Empty selector.".to_owned()],
        });
    }

    if compounds.iter().all(CompoundReq::is_runtime_only) {
        return finish_match(FinishMatchParams {
            selector_css,
            confidence: MatchConfidence::Unsupported,
            matched: 0,
            partial: 0,
            unresolved: 0,
            usage_files: 0,
            usage_by_file: Vec::new(),
            runtime: true,
            positional,
            notes: vec![
                "Selector is runtime-state or pseudo-element only; static analysis cannot confirm usage."
                    .to_owned(),
            ],
        });
    }

    let mut matched = 0u32;
    let mut partial = 0u32;
    let mut unresolved = 0u32;
    let mut files_hit = 0u32;
    let mut usage_by_file: Vec<SelectorFileUsageHit> = Vec::new();

    for file in files {
        let local = match_compound_chain(&compounds, &file.elements);
        if local.full > 0 {
            files_hit += 1;
            let path = file.path.trim();
            if !path.is_empty() {
                usage_by_file.push(SelectorFileUsageHit {
                    file: path.to_owned(),
                    count: local.full,
                });
            }
        }
        matched += local.full;
        partial += local.partial;
        unresolved += local.unresolved;
    }

    usage_by_file.sort_by(|left, right| {
        right
            .count
            .cmp(&left.count)
            .then_with(|| left.file.cmp(&right.file))
    });

    let mut notes = Vec::new();
    if runtime {
        notes.push(
            "Structural parts may match, but runtime pseudo-class/pseudo-element state is unproven."
                .to_owned(),
        );
    }
    if positional {
        notes.push(
            "Positional pseudo-class (:nth-*, :first-child, …) cannot be fully verified statically."
                .to_owned(),
        );
    }

    // Runtime / positional never claim Confirmed.
    let confidence = if matched > 0 {
        if runtime || positional {
            MatchConfidence::Partial
        } else {
            MatchConfidence::Confirmed
        }
    } else if partial > 0 {
        MatchConfidence::Partial
    } else if unresolved > 0 {
        MatchConfidence::Unresolved
    } else {
        MatchConfidence::None
    };

    if confidence == MatchConfidence::Partial && matched == 0 {
        notes.push(
            "Only part of a compound/combinator selector matched; not counted as confirmed usage."
                .to_owned(),
        );
    }

    finish_match(FinishMatchParams {
        selector_css,
        confidence,
        matched,
        partial,
        unresolved,
        usage_files: files_hit,
        usage_by_file,
        runtime,
        positional,
        notes,
    })
}

struct FinishMatchParams<'a> {
    selector_css: &'a str,
    confidence: MatchConfidence,
    matched: u32,
    partial: u32,
    unresolved: u32,
    usage_files: u32,
    usage_by_file: Vec<SelectorFileUsageHit>,
    runtime: bool,
    positional: bool,
    notes: Vec<String>,
}

fn finish_match(input: FinishMatchParams<'_>) -> SelectorUsageMatch {
    let status = derive_status(
        input.confidence,
        input.matched,
        input.runtime,
        input.positional,
    );
    SelectorUsageMatch {
        selector: input.selector_css.to_owned(),
        confidence: input.confidence,
        status,
        match_count: input.matched,
        matched_elements: input.matched,
        usage_occurrences: input.matched,
        usage_files: input.usage_files,
        usage_by_file: input.usage_by_file,
        partial_elements: input.partial,
        unresolved_elements: input.unresolved,
        has_unproven_runtime_state: input.runtime,
        has_unproven_positional: input.positional,
        notes: input.notes,
    }
}

fn derive_status(
    confidence: MatchConfidence,
    matched: u32,
    runtime: bool,
    positional: bool,
) -> SelectorUsageStatus {
    match confidence {
        MatchConfidence::Confirmed => SelectorUsageStatus::Used,
        MatchConfidence::Partial if matched > 0 && (runtime || positional) => {
            SelectorUsageStatus::Partial
        }
        MatchConfidence::Partial => SelectorUsageStatus::Partial,
        MatchConfidence::Unresolved | MatchConfidence::Unsupported => SelectorUsageStatus::Unknown,
        MatchConfidence::None => SelectorUsageStatus::Unused,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum AttrRequirement {
    /// `[name]` — attribute presence.
    Exists,
    /// `[name=value]` / `AttributeInNoNamespace`.
    Equal(String),
    /// `[name~=value]`
    Includes(String),
    /// `[name|=value]`
    DashMatch(String),
    /// `[name^=value]`
    Prefix(String),
    /// `[name*=value]`
    Substring(String),
    /// `[name$=value]`
    Suffix(String),
}

#[derive(Debug, Default, Clone)]
struct AtomBundle {
    tags: BTreeSet<String>,
    ids: BTreeSet<String>,
    classes: BTreeSet<String>,
    attributes: Vec<(String, AttrRequirement)>,
}

impl AtomBundle {
    fn is_empty(&self) -> bool {
        self.tags.is_empty()
            && self.ids.is_empty()
            && self.classes.is_empty()
            && self.attributes.is_empty()
    }

    fn extend_from(&mut self, other: &Self) {
        self.tags.extend(other.tags.iter().cloned());
        self.ids.extend(other.ids.iter().cloned());
        self.classes.extend(other.classes.iter().cloned());
        self.attributes.extend(other.attributes.iter().cloned());
    }
}

#[derive(Debug, Default, Clone)]
struct CompoundReq {
    atoms: AtomBundle,
    /// OR alternatives from `:is()` / `:where()` / `:any()`.
    alternatives: Vec<AtomBundle>,
    /// From `:not()` — element must match none of these.
    negated: Vec<AtomBundle>,
    /// From `:has()` — a descendant must match one of these.
    has: Vec<AtomBundle>,
    runtime_pseudos: BTreeSet<String>,
    structural_pseudos: BTreeSet<String>,
    pseudo_elements: BTreeSet<String>,
    positional: bool,
    combinator_after: Option<lightningcss::selector::Combinator>,
}

impl CompoundReq {
    fn has_runtime(&self) -> bool {
        !self.runtime_pseudos.is_empty() || !self.pseudo_elements.is_empty()
    }

    fn is_runtime_only(&self) -> bool {
        self.structural_is_empty() && self.has_runtime() && self.has.is_empty()
    }

    fn structural_is_empty(&self) -> bool {
        self.atoms.is_empty()
            && self.alternatives.is_empty()
            && self.negated.is_empty()
            && self.has.is_empty()
            && self.structural_pseudos.is_empty()
            && !self.positional
    }
}

fn split_compounds(selector: &Selector<'_>) -> Vec<CompoundReq> {
    use lightningcss::selector::Combinator;

    let mut rtl_compounds: Vec<CompoundReq> = vec![CompoundReq::default()];
    let mut combinators_rtl: Vec<Combinator> = Vec::new();

    for component in selector.iter_raw_match_order() {
        match component {
            Component::Combinator(combinator) if is_tree_combinator(*combinator) => {
                combinators_rtl.push(*combinator);
                rtl_compounds.push(CompoundReq::default());
            }
            Component::Combinator(_) => {}
            other => {
                if let Some(current) = rtl_compounds.last_mut() {
                    apply_component(other, current);
                }
            }
        }
    }

    let mut compounds: Vec<CompoundReq> = rtl_compounds.into_iter().rev().collect();
    let combinators_ltr: Vec<Combinator> = combinators_rtl.into_iter().rev().collect();
    for (index, combinator) in combinators_ltr.into_iter().enumerate() {
        if let Some(compound) = compounds.get_mut(index) {
            compound.combinator_after = Some(combinator);
        }
    }
    compounds
}

fn is_tree_combinator(combinator: lightningcss::selector::Combinator) -> bool {
    use lightningcss::selector::Combinator;
    matches!(
        combinator,
        Combinator::Descendant
            | Combinator::Child
            | Combinator::NextSibling
            | Combinator::LaterSibling
    )
}

fn apply_component(component: &Component<'_>, req: &mut CompoundReq) {
    match component {
        Component::Class(name) => {
            req.atoms.classes.insert(name.0.to_lowercase());
        }
        Component::ID(name) => {
            req.atoms.ids.insert(name.0.to_lowercase());
        }
        Component::LocalName(name) => {
            req.atoms.tags.insert(name.name.0.to_lowercase());
        }
        Component::AttributeInNoNamespaceExists { local_name, .. } => {
            req.atoms
                .attributes
                .push((local_name.0.to_lowercase(), AttrRequirement::Exists));
        }
        Component::AttributeInNoNamespace {
            local_name,
            operator,
            value,
            ..
        } => {
            let requirement = attr_requirement_from_operator(*operator, value.0.to_lowercase());
            req.atoms
                .attributes
                .push((local_name.0.to_lowercase(), requirement));
        }
        Component::AttributeOther(attribute) => {
            let name = attribute.local_name.0.to_lowercase();
            match &attribute.operation {
                ParsedAttrSelectorOperation::Exists => {
                    req.atoms.attributes.push((name, AttrRequirement::Exists));
                }
                ParsedAttrSelectorOperation::WithValue {
                    operator,
                    expected_value,
                    ..
                } => {
                    let requirement =
                        attr_requirement_from_operator(*operator, expected_value.0.to_lowercase());
                    req.atoms.attributes.push((name, requirement));
                }
            }
        }
        Component::Negation(selectors) => {
            for inner in selectors.iter() {
                for compound in split_compounds(inner) {
                    let mut bundle = compound.atoms;
                    for alt in compound.alternatives {
                        // Negated :is() → negate each alternative separately.
                        req.negated.push(alt);
                    }
                    if !bundle.is_empty() {
                        req.negated.push(std::mem::take(&mut bundle));
                    }
                }
            }
        }
        Component::Is(selectors) | Component::Where(selectors) | Component::Any(_, selectors) => {
            for inner in selectors.iter() {
                for compound in split_compounds(inner) {
                    let bundle = compound.atoms.clone();
                    // Flatten nested alternatives into separate OR options.
                    if compound.alternatives.is_empty() {
                        if !bundle.is_empty()
                            || !compound.structural_pseudos.is_empty()
                            || compound.positional
                        {
                            // Classless alternative (e.g. bare `div` already in atoms,
                            // or truly empty) — empty bundle means "always matches".
                            req.alternatives.push(bundle);
                        } else {
                            req.alternatives.push(AtomBundle::default());
                        }
                    } else {
                        for alt in compound.alternatives {
                            let mut merged = bundle.clone();
                            merged.extend_from(&alt);
                            req.alternatives.push(merged);
                        }
                    }
                    req.positional |= compound.positional;
                    req.runtime_pseudos.extend(compound.runtime_pseudos);
                    req.structural_pseudos.extend(compound.structural_pseudos);
                }
            }
        }
        Component::Has(selectors) => {
            for inner in selectors.iter() {
                for compound in split_compounds(inner) {
                    let mut bundle = compound.atoms;
                    for alt in compound.alternatives {
                        req.has.push(alt);
                    }
                    if !bundle.is_empty() {
                        req.has.push(std::mem::take(&mut bundle));
                    }
                    req.positional |= compound.positional;
                }
            }
        }
        Component::Root
        | Component::Empty
        | Component::Scope
        | Component::Nth(_)
        | Component::NonTSPseudoClass(_) => {
            let name = serialize_pseudo(component);
            if name.is_empty() {
                return;
            }
            if is_runtime_pseudo(&name) {
                req.runtime_pseudos.insert(name);
            } else if is_positional_pseudo(&name) {
                req.positional = true;
                req.structural_pseudos.insert(name);
            } else {
                req.structural_pseudos.insert(name);
            }
        }
        Component::NthOf(_) => {
            req.positional = true;
        }
        Component::PseudoElement(_) => {
            let name = serialize_pseudo(component);
            if !name.is_empty() {
                req.pseudo_elements.insert(name);
            }
        }
        _ => {}
    }
}

fn serialize_pseudo(component: &Component<'_>) -> String {
    let mut css = String::new();
    if component.to_css(&mut css).is_err() {
        return String::new();
    }
    css.trim_start_matches(':')
        .split('(')
        .next()
        .unwrap_or_default()
        .to_lowercase()
}

fn is_runtime_pseudo(name: &str) -> bool {
    matches!(
        name,
        "hover"
            | "focus"
            | "focus-visible"
            | "focus-within"
            | "active"
            | "visited"
            | "link"
            | "target"
            | "fullscreen"
            | "hovering"
            | "past"
            | "current"
            | "future"
    )
}

fn is_positional_pseudo(name: &str) -> bool {
    matches!(
        name,
        "first-child"
            | "last-child"
            | "only-child"
            | "first-of-type"
            | "last-of-type"
            | "only-of-type"
            | "nth-child"
            | "nth-last-child"
            | "nth-of-type"
            | "nth-last-of-type"
    )
}

#[derive(Debug, Clone, Copy, Default)]
struct ChainCounts {
    full: u32,
    partial: u32,
    unresolved: u32,
}

fn match_compound_chain(compounds: &[CompoundReq], elements: &[MarkupElement]) -> ChainCounts {
    let mut counts = ChainCounts::default();
    if compounds.is_empty() || elements.is_empty() {
        return counts;
    }

    if compounds.len() == 1 {
        let compound = &compounds[0];
        for (index, element) in elements.iter().enumerate() {
            match score_element(compound, element, elements, index) {
                ElementScore::Full => counts.full += 1,
                ElementScore::Partial => counts.partial += 1,
                ElementScore::Unresolved => counts.unresolved += 1,
                ElementScore::None | ElementScore::Excluded => {}
            }
        }
        return counts;
    }

    let subject = compounds.last().expect("non-empty");
    for (index, element) in elements.iter().enumerate() {
        match score_element(subject, element, elements, index) {
            ElementScore::Full => {
                if chain_holds(compounds, elements, index) {
                    counts.full += 1;
                } else if any_prefix_partial(compounds, elements, index) {
                    counts.partial += 1;
                }
            }
            ElementScore::Partial => counts.partial += 1,
            ElementScore::Unresolved => counts.unresolved += 1,
            ElementScore::None | ElementScore::Excluded => {}
        }
    }
    counts
}

fn chain_holds(
    compounds: &[CompoundReq],
    elements: &[MarkupElement],
    subject_index: usize,
) -> bool {
    use lightningcss::selector::Combinator;

    let mut current_index = subject_index;
    for compound_index in (0..compounds.len() - 1).rev() {
        let compound = &compounds[compound_index];
        let combinator = compound.combinator_after.unwrap_or(Combinator::Descendant);
        match find_related(compound, combinator, elements, current_index) {
            Some(index) => current_index = index,
            None => return false,
        }
    }
    true
}

fn any_prefix_partial(
    compounds: &[CompoundReq],
    elements: &[MarkupElement],
    subject_index: usize,
) -> bool {
    let subject = elements.get(subject_index);
    let Some(subject) = subject else {
        return false;
    };
    for compound in &compounds[..compounds.len() - 1] {
        for (index, element) in elements.iter().enumerate() {
            if index == subject_index {
                continue;
            }
            if score_element(compound, element, elements, index) == ElementScore::Full
                && element.depth <= subject.depth
            {
                return true;
            }
        }
    }
    false
}

fn find_related(
    compound: &CompoundReq,
    combinator: lightningcss::selector::Combinator,
    elements: &[MarkupElement],
    from_index: usize,
) -> Option<usize> {
    use lightningcss::selector::Combinator;

    let from = elements.get(from_index)?;
    match combinator {
        Combinator::Descendant => {
            let mut parent = from.parent_index;
            while let Some(index) = parent {
                let idx = index as usize;
                if let Some(element) = elements.get(idx) {
                    if score_element(compound, element, elements, idx) == ElementScore::Full {
                        return Some(idx);
                    }
                    parent = element.parent_index;
                } else {
                    break;
                }
            }
            None
        }
        Combinator::Child => {
            let parent_index = from.parent_index? as usize;
            let parent = elements.get(parent_index)?;
            if score_element(compound, parent, elements, parent_index) == ElementScore::Full {
                Some(parent_index)
            } else {
                None
            }
        }
        Combinator::NextSibling | Combinator::LaterSibling => {
            let parent = from.parent_index;
            let mut previous: Option<usize> = None;
            for (index, element) in elements.iter().enumerate() {
                if index == from_index {
                    break;
                }
                if element.parent_index == parent {
                    previous = Some(index);
                    if matches!(combinator, Combinator::LaterSibling)
                        && score_element(compound, element, elements, index) == ElementScore::Full
                    {
                        return Some(index);
                    }
                }
            }
            if matches!(combinator, Combinator::NextSibling) {
                let index = previous?;
                let element = elements.get(index)?;
                if score_element(compound, element, elements, index) == ElementScore::Full {
                    return Some(index);
                }
            }
            None
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum ElementScore {
    Full,
    Partial,
    Unresolved,
    Excluded,
    None,
}

fn score_element(
    req: &CompoundReq,
    element: &MarkupElement,
    all: &[MarkupElement],
    index: usize,
) -> ElementScore {
    if req.structural_is_empty() && !req.has_runtime() {
        return ElementScore::None;
    }

    // :not() — excluded when any negated bundle matches.
    for negated in &req.negated {
        if bundle_fully_matches(negated, element) {
            return ElementScore::Excluded;
        }
    }

    let mut needed = 0u32;
    let mut confirmed = 0u32;
    let mut unresolved = 0u32;

    score_bundle(
        &req.atoms,
        element,
        &mut needed,
        &mut confirmed,
        &mut unresolved,
    );

    // :is() / :where() alternatives — at least one must fully match when present.
    if !req.alternatives.is_empty() {
        needed += 1;
        let mut any = false;
        let mut any_unresolved = false;
        let mut any_partial = false;
        for alt in &req.alternatives {
            if alt.is_empty() {
                // Classless alternative → satisfied.
                any = true;
                break;
            }
            let mut n = 0;
            let mut c = 0;
            let mut u = 0;
            score_bundle(alt, element, &mut n, &mut c, &mut u);
            if n > 0 && c == n {
                any = true;
                break;
            }
            if c > 0 {
                any_partial = true;
            }
            if u > 0 {
                any_unresolved = true;
            }
        }
        if any {
            confirmed += 1;
        } else if any_partial {
            // count as missing confirmed
        } else if any_unresolved {
            unresolved += 1;
        }
    }

    for pseudo in &req.structural_pseudos {
        if is_positional_pseudo(pseudo) {
            // Positional: do not increment needed; handled via `positional` flag.
            continue;
        }
        if let Some(attr) = structural_pseudo_to_attr(pseudo) {
            needed += 1;
            if element.attributes.contains_key(attr)
                || element.dynamic_attributes.iter().any(|name| name == attr)
            {
                confirmed += 1;
            }
        }
    }

    // :has() — require a descendant match.
    if !req.has.is_empty() {
        needed += 1;
        if has_matching_descendant(&req.has, all, index) {
            confirmed += 1;
        }
    }

    if needed == 0 {
        if req.has_runtime() || req.positional {
            // Only runtime/positional with no structural atoms — caller handles.
            ElementScore::None
        } else {
            ElementScore::None
        }
    } else if confirmed == needed {
        ElementScore::Full
    } else if confirmed > 0 {
        ElementScore::Partial
    } else if unresolved > 0 {
        ElementScore::Unresolved
    } else {
        ElementScore::None
    }
}

fn score_bundle(
    bundle: &AtomBundle,
    element: &MarkupElement,
    needed: &mut u32,
    confirmed: &mut u32,
    unresolved: &mut u32,
) {
    for tag in &bundle.tags {
        *needed += 1;
        if element
            .tag
            .as_ref()
            .is_some_and(|value| value.eq_ignore_ascii_case(tag))
        {
            *confirmed += 1;
        }
    }

    for id in &bundle.ids {
        *needed += 1;
        if element
            .id
            .as_ref()
            .is_some_and(|value| value.eq_ignore_ascii_case(id))
        {
            *confirmed += 1;
        }
    }

    let class_set: BTreeSet<String> = element.classes.iter().map(|c| c.to_lowercase()).collect();
    let dynamic_class_set: BTreeSet<String> = element
        .dynamic_classes
        .iter()
        .map(|c| c.to_lowercase())
        .collect();
    for class in &bundle.classes {
        *needed += 1;
        if class_set.contains(class) {
            *confirmed += 1;
        } else if dynamic_class_set.contains(class) {
            *unresolved += 1;
        }
    }

    for (name, requirement) in &bundle.attributes {
        *needed += 1;
        let values = element.attributes.get(name);
        let dynamic = element
            .dynamic_attributes
            .iter()
            .any(|attr| attr.eq_ignore_ascii_case(name));
        match (values, requirement) {
            (Some(_), AttrRequirement::Exists) => *confirmed += 1,
            (Some(list), requirement) => {
                if list
                    .iter()
                    .any(|item| attr_requirement_matches(requirement, item))
                {
                    *confirmed += 1;
                } else if dynamic || list.is_empty() {
                    *unresolved += 1;
                }
            }
            (None, _) if dynamic => *unresolved += 1,
            _ => {}
        }
    }
}

fn attr_requirement_from_operator(
    operator: AttrSelectorOperator,
    value: String,
) -> AttrRequirement {
    match operator {
        AttrSelectorOperator::Equal => AttrRequirement::Equal(value),
        AttrSelectorOperator::Includes => AttrRequirement::Includes(value),
        AttrSelectorOperator::DashMatch => AttrRequirement::DashMatch(value),
        AttrSelectorOperator::Prefix => AttrRequirement::Prefix(value),
        AttrSelectorOperator::Substring => AttrRequirement::Substring(value),
        AttrSelectorOperator::Suffix => AttrRequirement::Suffix(value),
    }
}

fn attr_requirement_matches(requirement: &AttrRequirement, actual: &str) -> bool {
    let actual_lower = actual.to_lowercase();
    match requirement {
        AttrRequirement::Exists => true,
        AttrRequirement::Equal(expected) => actual_lower == *expected,
        AttrRequirement::Includes(expected) => actual_lower
            .split_whitespace()
            .any(|token| token == expected),
        AttrRequirement::DashMatch(expected) => {
            actual_lower == *expected || actual_lower.starts_with(&format!("{expected}-"))
        }
        AttrRequirement::Prefix(expected) => actual_lower.starts_with(expected.as_str()),
        AttrRequirement::Substring(expected) => actual_lower.contains(expected.as_str()),
        AttrRequirement::Suffix(expected) => actual_lower.ends_with(expected.as_str()),
    }
}

fn bundle_fully_matches(bundle: &AtomBundle, element: &MarkupElement) -> bool {
    if bundle.is_empty() {
        return false;
    }
    let mut needed = 0;
    let mut confirmed = 0;
    let mut unresolved = 0;
    score_bundle(
        bundle,
        element,
        &mut needed,
        &mut confirmed,
        &mut unresolved,
    );
    needed > 0 && confirmed == needed
}

fn has_matching_descendant(
    bundles: &[AtomBundle],
    elements: &[MarkupElement],
    ancestor_index: usize,
) -> bool {
    for (index, element) in elements.iter().enumerate() {
        if index == ancestor_index {
            continue;
        }
        if !is_descendant_of(elements, index, ancestor_index) {
            continue;
        }
        for bundle in bundles {
            if bundle_fully_matches(bundle, element) {
                return true;
            }
        }
    }
    false
}

fn is_descendant_of(elements: &[MarkupElement], index: usize, ancestor: usize) -> bool {
    let mut parent = elements.get(index).and_then(|el| el.parent_index);
    while let Some(p) = parent {
        if p as usize == ancestor {
            return true;
        }
        parent = elements.get(p as usize).and_then(|el| el.parent_index);
    }
    false
}

fn structural_pseudo_to_attr(pseudo: &str) -> Option<&'static str> {
    match pseudo {
        "disabled" => Some("disabled"),
        "checked" => Some("checked"),
        "required" => Some("required"),
        "readonly" => Some("readonly"),
        "open" => Some("open"),
        "default" => Some("default"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn el(
        tag: &str,
        classes: &[&str],
        id: Option<&str>,
        attrs: &[(&str, &[&str])],
        parent: Option<u32>,
    ) -> MarkupElement {
        let mut attributes = BTreeMap::new();
        for (name, values) in attrs {
            attributes.insert(
                (*name).to_owned(),
                values.iter().map(|value| (*value).to_owned()).collect(),
            );
        }
        MarkupElement {
            tag: Some(tag.to_owned()),
            id: id.map(str::to_owned),
            classes: classes.iter().map(|value| (*value).to_owned()).collect(),
            dynamic_classes: Vec::new(),
            attributes,
            dynamic_attributes: Vec::new(),
            parent_index: parent,
            depth: parent.map_or(0, |_| 1),
        }
    }

    #[test]
    fn confirms_simple_class() {
        let evidence = MarkupEvidence {
            elements: vec![el("div", &["card"], None, &[], None)],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.status, SelectorUsageStatus::Used);
        assert_eq!(result.match_count, 1);
        assert_eq!(result.matched_elements, 1);
        assert_eq!(result.usage_occurrences, 1);
    }

    #[test]
    fn compound_requires_all_classes() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["card"], None, &[], None),
                el("div", &["card", "active"], None, &[], None),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card.active", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);

        let partial_only = MarkupEvidence {
            elements: vec![el("div", &["card"], None, &[], None)],
            ..MarkupEvidence::default()
        };
        let partial = match_selector_against_markup(".card.active", &partial_only).unwrap();
        assert_eq!(partial.confidence, MatchConfidence::Partial);
        assert_eq!(partial.status, SelectorUsageStatus::Partial);
        assert_eq!(partial.match_count, 0);
        assert_eq!(partial.partial_elements, 1);
    }

    #[test]
    fn button_primary_needs_tag_and_class() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["primary"], None, &[], None),
                el("button", &["primary"], None, &[], None),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup("button.primary", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn descendant_combinator_uses_parent_links() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["card"], None, &[], None),
                el("p", &[], None, &[], Some(0)),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card p", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn hover_is_partial_not_confirmed() {
        let evidence = MarkupEvidence {
            elements: vec![el("button", &["button"], None, &[], None)],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".button:hover", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Partial);
        assert_eq!(result.status, SelectorUsageStatus::Partial);
        assert!(result.has_unproven_runtime_state);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn attribute_value_matching() {
        let evidence = MarkupEvidence {
            elements: vec![el("div", &[], None, &[("data-state", &["open"])], None)],
            ..MarkupEvidence::default()
        };
        let open = match_selector_against_markup(r#"[data-state="open"]"#, &evidence).unwrap();
        assert_eq!(open.confidence, MatchConfidence::Confirmed);
        let closed = match_selector_against_markup(r#"[data-state="closed"]"#, &evidence).unwrap();
        assert_eq!(closed.confidence, MatchConfidence::None);
        assert_eq!(closed.status, SelectorUsageStatus::Unused);
    }

    #[test]
    fn ignores_pascal_case_components_as_tags() {
        let evidence = MarkupEvidence {
            elements: vec![MarkupElement {
                tag: None,
                classes: vec!["primary".into()],
                ..MarkupElement::default()
            }],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup("button.primary", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Partial);
    }

    #[test]
    fn id_and_disabled_attribute() {
        let evidence = MarkupEvidence {
            elements: vec![el("div", &[], Some("app"), &[("disabled", &[])], None)],
            ..MarkupEvidence::default()
        };
        assert_eq!(
            match_selector_against_markup("#app", &evidence)
                .unwrap()
                .confidence,
            MatchConfidence::Confirmed
        );
        assert_eq!(
            match_selector_against_markup("[disabled]", &evidence)
                .unwrap()
                .confidence,
            MatchConfidence::Confirmed
        );
    }

    #[test]
    fn not_excludes_matching_elements() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["hidden"], None, &[], None),
                el("div", &["ok"], None, &[], None),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup("div:not(.hidden)", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn is_alternatives_are_or() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["card", "active"], None, &[], None),
                el("div", &["card"], None, &[], None),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card:is(.active, .open)", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn has_requires_descendant() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("div", &["card"], None, &[], None),
                el("span", &["badge"], None, &[], Some(0)),
                el("div", &["card"], None, &[], None),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card:has(.badge)", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn first_child_is_partial_positional() {
        let evidence = MarkupEvidence {
            elements: vec![el("li", &["item"], None, &[], None)],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup("li:first-child", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Partial);
        assert!(result.has_unproven_positional);
        assert_eq!(result.status, SelectorUsageStatus::Partial);
    }

    #[test]
    fn cross_file_combinators_do_not_merge_trees() {
        let evidence = MarkupEvidence {
            files: vec![
                MarkupFileEvidence {
                    path: "a.tsx".into(),
                    elements: vec![el("div", &["card"], None, &[], None)],
                },
                MarkupFileEvidence {
                    path: "b.tsx".into(),
                    elements: vec![el("p", &[], None, &[], None)],
                },
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card p", &evidence).unwrap();
        assert_ne!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 0);
    }

    #[test]
    fn usage_files_count_distinct_paths() {
        let evidence = MarkupEvidence {
            files: vec![
                MarkupFileEvidence {
                    path: "a.tsx".into(),
                    elements: vec![el("div", &["card"], None, &[], None)],
                },
                MarkupFileEvidence {
                    path: "b.tsx".into(),
                    elements: vec![
                        el("div", &["card"], None, &[], None),
                        el("span", &["card"], None, &[], None),
                    ],
                },
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".card", &evidence).unwrap();
        assert_eq!(result.usage_files, 2);
        assert_eq!(result.matched_elements, 3);
        assert_eq!(
            result.usage_by_file,
            vec![
                SelectorFileUsageHit {
                    file: "b.tsx".into(),
                    count: 2,
                },
                SelectorFileUsageHit {
                    file: "a.tsx".into(),
                    count: 1,
                },
            ]
        );
    }

    #[test]
    fn attribute_prefix_and_substring_operators() {
        let evidence = MarkupEvidence {
            elements: vec![el("a", &[], None, &[("href", &["/docs/guide"])], None)],
            ..MarkupEvidence::default()
        };
        assert_eq!(
            match_selector_against_markup(r#"[href^="/docs"]"#, &evidence)
                .unwrap()
                .confidence,
            MatchConfidence::Confirmed
        );
        assert_eq!(
            match_selector_against_markup(r#"[href*="guide"]"#, &evidence)
                .unwrap()
                .confidence,
            MatchConfidence::Confirmed
        );
        assert_eq!(
            match_selector_against_markup(r#"[href^="/api"]"#, &evidence)
                .unwrap()
                .confidence,
            MatchConfidence::None
        );
    }

    #[test]
    fn general_sibling_combinator() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("section", &[], None, &[], None),
                el("div", &["item"], None, &[], Some(0)),
                el("div", &["other"], None, &[], Some(0)),
                el("div", &["item"], None, &[], Some(0)),
            ],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".item ~ .item", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::Confirmed);
        assert_eq!(result.match_count, 1);
    }

    #[test]
    fn unused_when_no_evidence() {
        let evidence = MarkupEvidence {
            elements: vec![el("div", &["other"], None, &[], None)],
            ..MarkupEvidence::default()
        };
        let result = match_selector_against_markup(".missing", &evidence).unwrap();
        assert_eq!(result.confidence, MatchConfidence::None);
        assert_eq!(result.status, SelectorUsageStatus::Unused);
    }

    #[test]
    fn child_and_sibling_combinators() {
        let evidence = MarkupEvidence {
            elements: vec![
                el("ul", &["menu"], None, &[], None),
                el("li", &["item"], None, &[], Some(0)),
                el("li", &["item"], None, &[], Some(0)),
            ],
            ..MarkupEvidence::default()
        };
        let child = match_selector_against_markup(".menu > li", &evidence).unwrap();
        assert_eq!(child.confidence, MatchConfidence::Confirmed);
        assert_eq!(child.match_count, 2);

        let adj = match_selector_against_markup(".item + .item", &evidence).unwrap();
        assert_eq!(adj.confidence, MatchConfidence::Confirmed);
        assert_eq!(adj.match_count, 1);
    }
}
