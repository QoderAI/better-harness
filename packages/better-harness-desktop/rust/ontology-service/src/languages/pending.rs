//! Languages registered for `host.describe` and `ontology.extract` routing,
//! but without a grammar loaded yet. `crates.io` publishes a native
//! `tree-sitter-*` crate for each (see ADR-0008's dependency table); this
//! host loads them as WASM modules at runtime instead once that plumbing
//! lands, rather than growing this binary's static link set indefinitely for
//! every future language (the Spec's Non-goals).

use crate::grammar::{GrammarSource, LanguageEntry};

pub const fn entry(
    id: &'static str,
    display_name: &'static str,
    extensions: &'static [&'static str],
) -> LanguageEntry {
    LanguageEntry {
        id,
        display_name,
        extensions,
        source: GrammarSource::WasmPending,
        query: None,
    }
}

pub const JAVA: LanguageEntry = entry("java", "Java", &["java"]);
pub const CSHARP: LanguageEntry = entry("csharp", "C#", &["cs"]);
pub const SWIFT: LanguageEntry = entry("swift", "Swift", &["swift"]);
pub const KOTLIN: LanguageEntry = entry("kotlin", "Kotlin", &["kt", "kts"]);
pub const SQL: LanguageEntry = entry("sql", "SQL", &["sql"]);
