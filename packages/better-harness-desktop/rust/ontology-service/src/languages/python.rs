use crate::grammar::{GrammarSource, LanguageEntry};

fn language() -> tree_sitter::Language {
    tree_sitter_python::LANGUAGE.into()
}

const QUERY: &str = r#"
(class_definition name: (identifier) @name) @item.class

(function_definition name: (_) @name) @item.function
"#;

pub const ENTRY: LanguageEntry = LanguageEntry {
    id: "python",
    display_name: "Python",
    extensions: &["py", "pyi"],
    source: GrammarSource::Native(language),
    query: Some(QUERY),
};
