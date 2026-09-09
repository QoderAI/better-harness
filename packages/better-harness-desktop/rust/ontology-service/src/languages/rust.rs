use crate::grammar::{GrammarSource, LanguageEntry};

fn language() -> tree_sitter::Language {
    tree_sitter_rust::LANGUAGE.into()
}

/// Structs, enums, traits, impls, free functions, and modules. Deliberately
/// narrower than an editor outline query: no field/const/static/macro
/// entries, since those add breadcrumb noise without adding ontology value.
const QUERY: &str = r#"
(struct_item name: (_) @name) @item.struct

(enum_item name: (_) @name) @item.enum

(trait_item name: (_) @name) @item.trait

(impl_item type: (_) @name) @item.impl

(function_item name: (_) @name) @item.function

(mod_item name: (_) @name) @item.module
"#;

pub const ENTRY: LanguageEntry = LanguageEntry {
    id: "rust",
    display_name: "Rust",
    extensions: &["rs"],
    source: GrammarSource::Native(language),
    query: Some(QUERY),
};
