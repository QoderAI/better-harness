use crate::grammar::{GrammarSource, LanguageEntry};

fn language() -> tree_sitter::Language {
    tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into()
}

/// Shared with `tsx` and `javascript`: all three surfaces parse with the TSX
/// grammar (JS is a permissive subset of it) and expose the same declaration
/// node kinds, so one query covers all three — same reuse Zed's own language
/// configs make.
pub(crate) const QUERY: &str = r#"
(class_declaration name: (_) @name) @item.class

(interface_declaration name: (_) @name) @item.interface

(enum_declaration name: (_) @name) @item.enum

(function_declaration name: (_) @name) @item.function

(method_definition name: (_) @name) @item.method
"#;

pub const ENTRY: LanguageEntry = LanguageEntry {
    id: "typescript",
    display_name: "TypeScript",
    extensions: &["ts", "cts", "mts"],
    source: GrammarSource::Native(language),
    query: Some(QUERY),
};
