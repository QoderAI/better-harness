use super::typescript::QUERY;
use crate::grammar::{GrammarSource, LanguageEntry};

fn language() -> tree_sitter::Language {
    tree_sitter_typescript::LANGUAGE_TSX.into()
}

pub const ENTRY: LanguageEntry = LanguageEntry {
    id: "tsx",
    display_name: "TSX",
    extensions: &["tsx"],
    source: GrammarSource::Native(language),
    query: Some(QUERY),
};
