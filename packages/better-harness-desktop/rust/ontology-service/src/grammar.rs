//! The language registry: which languages this host knows about, how each
//! one's grammar is sourced, and the entity query that turns its parse tree
//! into ontology entities.
//!
//! Two grammar sources coexist deliberately (ADR-0008):
//! - `Native`: a `tree-sitter-*` crate linked into this binary. Zero startup
//!   cost, used for the pilot languages this slice ships working end to end.
//! - `WasmPending`: registered so the language is visible and routable, but
//!   no `.wasm` grammar buffer has been provisioned. Loading one is a runtime
//!   operation (`tree_sitter::WasmStore::load_language`) that this module
//!   does not perform yet; see the Spec's Non-goals. Extracting against a
//!   pending language fails with `grammar-unavailable` rather than panicking
//!   or silently returning no entities.

use serde::Serialize;

pub enum GrammarSource {
    Native(fn() -> tree_sitter::Language),
    WasmPending,
}

pub struct LanguageEntry {
    /// Stable id used on the wire (`ontology.extract` `language` param).
    pub id: &'static str,
    pub display_name: &'static str,
    pub extensions: &'static [&'static str],
    pub source: GrammarSource,
    /// Entity extraction query source. `None` for `WasmPending` languages.
    pub query: Option<&'static str>,
}

impl LanguageEntry {
    pub fn source_label(&self) -> &'static str {
        match self.source {
            GrammarSource::Native(_) => "native",
            GrammarSource::WasmPending => "wasm-pending",
        }
    }

    pub fn language(&self) -> Option<tree_sitter::Language> {
        match self.source {
            GrammarSource::Native(make) => Some(make()),
            GrammarSource::WasmPending => None,
        }
    }
}

#[derive(Serialize)]
pub struct LanguageDescription {
    pub id: &'static str,
    #[serde(rename = "displayName")]
    pub display_name: &'static str,
    pub extensions: &'static [&'static str],
    pub source: &'static str,
}

/// All languages this host knows about, in the order the Spec lists them.
/// Adding a language means adding one entry here plus, for a native pilot,
/// a `languages::<name>` module supplying the grammar function and query.
const REGISTRY: [LanguageEntry; 11] = [
    crate::languages::rust::ENTRY,
    crate::languages::python::ENTRY,
    crate::languages::go::ENTRY,
    crate::languages::typescript::ENTRY,
    crate::languages::tsx::ENTRY,
    crate::languages::javascript::ENTRY,
    crate::languages::pending::JAVA,
    crate::languages::pending::CSHARP,
    crate::languages::pending::SWIFT,
    crate::languages::pending::KOTLIN,
    crate::languages::pending::SQL,
];

pub fn registry() -> &'static [LanguageEntry] {
    &REGISTRY
}

pub fn describe_all() -> Vec<LanguageDescription> {
    registry()
        .iter()
        .map(|entry| LanguageDescription {
            id: entry.id,
            display_name: entry.display_name,
            extensions: entry.extensions,
            source: entry.source_label(),
        })
        .collect()
}

pub fn find_by_id(id: &str) -> Option<&'static LanguageEntry> {
    registry().iter().find(|entry| entry.id == id)
}

/// Resolve a language from a filename's extension, matching the longest
/// registered suffix (so `.d.ts`-style multi-dot names still pick `ts`).
pub fn find_by_filename(filename: &str) -> Option<&'static LanguageEntry> {
    let extension = filename.rsplit('.').next()?.to_ascii_lowercase();
    registry()
        .iter()
        .find(|entry| entry.extensions.contains(&extension.as_str()))
}
