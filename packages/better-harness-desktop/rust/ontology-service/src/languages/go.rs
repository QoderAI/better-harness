use crate::grammar::{GrammarSource, LanguageEntry};

fn language() -> tree_sitter::Language {
    tree_sitter_go::LANGUAGE.into()
}

/// Plain `type Foo = ...` aliases are not captured: tree-sitter queries
/// match every pattern independently, so a generic `(type_spec name: (_)
/// @name)` pattern would double-count the struct/interface cases below
/// rather than act as a fallback. Left as a follow-up (Spec Non-goals).
const QUERY: &str = r#"
(function_declaration name: (identifier) @name) @item.function

(method_declaration name: (field_identifier) @name) @item.method

(type_spec
  name: (_) @name
  type: (struct_type)) @item.struct

(type_spec
  name: (_) @name
  type: (interface_type)) @item.interface
"#;

pub const ENTRY: LanguageEntry = LanguageEntry {
    id: "go",
    display_name: "Go",
    extensions: &["go"],
    source: GrammarSource::Native(language),
    query: Some(QUERY),
};
