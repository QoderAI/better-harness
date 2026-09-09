//! Turns one file's source into a nested tree of ontology entities.
//!
//! This is deliberately a single-file, single-pass extraction: parse once,
//! run the language's entity query once, and reconstruct nesting from byte
//! ranges. It has no opinion about cross-file relationships (calls, imports,
//! inheritance) — see ADR-0008's Decision on why that is a separate stage.

use serde::{Deserialize, Serialize};
use streaming_iterator::StreamingIterator;
use tree_sitter::{Parser, Query, QueryCursor};

const MAX_SOURCE: usize = 2 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractParams {
    pub filename: String,
    /// Overrides extension-based language detection. Unknown or omitted with
    /// no matching extension both fail as `language-not-found`.
    pub language: Option<String>,
    pub source: String,
}

#[derive(Debug)]
pub enum ExtractError {
    LanguageNotFound,
    GrammarUnavailable,
    SourceLimit,
    ParseFailed,
    InvalidQuery,
}

impl ExtractError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::LanguageNotFound => "language-not-found",
            Self::GrammarUnavailable => "grammar-unavailable",
            Self::SourceLimit => "source-limit",
            Self::ParseFailed => "parse-failed",
            Self::InvalidQuery => "invalid-query",
        }
    }
}

#[derive(Serialize, Debug, PartialEq)]
pub struct EntityRange {
    #[serde(rename = "startByte")]
    pub start_byte: usize,
    #[serde(rename = "endByte")]
    pub end_byte: usize,
    #[serde(rename = "startRow")]
    pub start_row: usize,
    #[serde(rename = "startColumn")]
    pub start_column: usize,
    #[serde(rename = "endRow")]
    pub end_row: usize,
    #[serde(rename = "endColumn")]
    pub end_column: usize,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct Entity {
    pub kind: String,
    pub name: String,
    pub range: EntityRange,
    pub children: Vec<Entity>,
}

struct FlatItem {
    kind: String,
    name: String,
    range: EntityRange,
    start_byte: usize,
    end_byte: usize,
}

pub fn extract(params: ExtractParams) -> Result<serde_json::Value, ExtractError> {
    if params.source.len() > MAX_SOURCE {
        return Err(ExtractError::SourceLimit);
    }
    let entry = match &params.language {
        Some(id) => crate::grammar::find_by_id(id).ok_or(ExtractError::LanguageNotFound)?,
        None => crate::grammar::find_by_filename(&params.filename)
            .ok_or(ExtractError::LanguageNotFound)?,
    };
    let language = entry.language().ok_or(ExtractError::GrammarUnavailable)?;
    let query_source = entry.query.ok_or(ExtractError::GrammarUnavailable)?;

    let mut parser = Parser::new();
    parser
        .set_language(&language)
        .map_err(|_| ExtractError::InvalidQuery)?;
    let tree = parser
        .parse(&params.source, None)
        .ok_or(ExtractError::ParseFailed)?;
    let query = Query::new(&language, query_source).map_err(|_| ExtractError::InvalidQuery)?;

    let bytes = params.source.as_bytes();
    let mut cursor = QueryCursor::new();
    let mut matches = cursor.matches(&query, tree.root_node(), bytes);
    let mut items = Vec::new();
    while let Some(matched) = matches.next() {
        let mut item_node = None;
        let mut kind = None;
        let mut name = String::new();
        for capture in matched.captures() {
            let capture_name = query.capture_names()[capture.index as usize];
            if let Some(suffix) = capture_name.strip_prefix("item.") {
                item_node = Some(capture.node);
                kind = Some(suffix.to_string());
            } else if capture_name == "name" {
                name = capture
                    .node
                    .utf8_text(bytes)
                    .unwrap_or_default()
                    .to_string();
            }
        }
        if let (Some(node), Some(kind)) = (item_node, kind) {
            let start = node.start_position();
            let end = node.end_position();
            items.push(FlatItem {
                kind,
                name,
                start_byte: node.start_byte(),
                end_byte: node.end_byte(),
                range: EntityRange {
                    start_byte: node.start_byte(),
                    end_byte: node.end_byte(),
                    start_row: start.row,
                    start_column: start.column,
                    end_row: end.row,
                    end_column: end.column,
                },
            });
        }
    }

    Ok(serde_json::json!({
        "language": entry.id,
        "source": entry.source_label(),
        "entities": nest(items),
    }))
}

/// Reconstructs containment from a list of items sorted by tree position: an
/// item nests under the nearest still-open item whose range has not yet
/// closed. Mirrors the stack-based depth assignment `Buffer::outline_items_containing_internal`
/// uses in Zed, generalized from a flat depth count to actual parent/child
/// nesting.
fn nest(mut items: Vec<FlatItem>) -> Vec<Entity> {
    items.sort_by(|a, b| {
        a.start_byte
            .cmp(&b.start_byte)
            .then(b.end_byte.cmp(&a.end_byte))
    });

    struct Open {
        end_byte: usize,
        entity: Entity,
    }

    fn close_to(stack: &mut Vec<Open>, roots: &mut Vec<Entity>, start_byte: usize) {
        while let Some(top) = stack.last() {
            if top.end_byte <= start_byte {
                let finished = stack.pop().unwrap().entity;
                match stack.last_mut() {
                    Some(parent) => parent.entity.children.push(finished),
                    None => roots.push(finished),
                }
            } else {
                break;
            }
        }
    }

    let mut stack: Vec<Open> = Vec::new();
    let mut roots: Vec<Entity> = Vec::new();
    for item in items {
        close_to(&mut stack, &mut roots, item.start_byte);
        stack.push(Open {
            end_byte: item.end_byte,
            entity: Entity {
                kind: item.kind,
                name: item.name,
                range: item.range,
                children: Vec::new(),
            },
        });
    }
    close_to(&mut stack, &mut roots, usize::MAX);
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    fn extract_ok(language: &str, filename: &str, source: &str) -> serde_json::Value {
        let result = extract(ExtractParams {
            filename: filename.to_string(),
            language: Some(language.to_string()),
            source: source.to_string(),
        });
        result.unwrap_or_else(|error| panic!("extraction failed: {}", error.code()))
    }

    #[test]
    fn nests_a_method_inside_a_class() {
        let result = extract_ok(
            "python",
            "a.py",
            "class Greeter:\n    def hello(self):\n        pass\n",
        );
        let entities = result["entities"].as_array().unwrap();
        assert_eq!(entities.len(), 1);
        assert_eq!(entities[0]["kind"], "class");
        assert_eq!(entities[0]["name"], "Greeter");
        let children = entities[0]["children"].as_array().unwrap();
        assert_eq!(children.len(), 1);
        assert_eq!(children[0]["kind"], "function");
        assert_eq!(children[0]["name"], "hello");
    }

    #[test]
    fn rust_captures_struct_impl_and_method() {
        let result = extract_ok(
            "rust",
            "a.rs",
            "struct Greeter;\n\nimpl Greeter {\n    fn hello(&self) {}\n}\n",
        );
        let entities = result["entities"].as_array().unwrap();
        assert_eq!(entities[0]["kind"], "struct");
        assert_eq!(entities[0]["name"], "Greeter");
        assert_eq!(entities[1]["kind"], "impl");
        let children = entities[1]["children"].as_array().unwrap();
        assert_eq!(children[0]["kind"], "function");
        assert_eq!(children[0]["name"], "hello");
    }

    #[test]
    fn go_captures_struct_and_method_with_receiver() {
        let result = extract_ok(
            "go",
            "a.go",
            "package main\n\ntype Greeter struct{}\n\nfunc (g Greeter) Hello() {}\n",
        );
        let entities = result["entities"].as_array().unwrap();
        assert_eq!(entities[0]["kind"], "struct");
        assert_eq!(entities[0]["name"], "Greeter");
        assert_eq!(entities[1]["kind"], "method");
        assert_eq!(entities[1]["name"], "Hello");
    }

    #[test]
    fn typescript_captures_interface_and_class_method() {
        let result = extract_ok(
            "typescript",
            "a.ts",
            "interface Greets {\n  hello(): void;\n}\n\nclass Greeter implements Greets {\n  hello() {}\n}\n",
        );
        let entities = result["entities"].as_array().unwrap();
        assert_eq!(entities[0]["kind"], "interface");
        assert_eq!(entities[1]["kind"], "class");
        let children = entities[1]["children"].as_array().unwrap();
        assert_eq!(children[0]["kind"], "method");
        assert_eq!(children[0]["name"], "hello");
    }

    #[test]
    fn tsx_and_javascript_share_the_typescript_grammar_family() {
        let tsx = extract_ok(
            "tsx",
            "a.tsx",
            "export function Greeter() {\n  return <div>hi</div>;\n}\n",
        );
        assert_eq!(tsx["entities"][0]["kind"], "function");
        assert_eq!(tsx["entities"][0]["name"], "Greeter");

        let javascript = extract_ok("javascript", "a.js", "class Greeter {\n  hello() {}\n}\n");
        assert_eq!(javascript["entities"][0]["kind"], "class");
        assert_eq!(javascript["entities"][0]["children"][0]["name"], "hello");
    }

    #[test]
    fn language_is_inferred_from_filename_when_omitted() {
        let result = extract(ExtractParams {
            filename: "a.py".into(),
            language: None,
            source: "def hello():\n    pass\n".into(),
        })
        .unwrap();
        assert_eq!(result["language"], "python");
        assert_eq!(result["entities"][0]["name"], "hello");
    }

    #[test]
    fn sibling_functions_stay_at_the_same_level() {
        let result = extract_ok(
            "python",
            "a.py",
            "def one():\n    pass\n\n\ndef two():\n    pass\n",
        );
        let entities = result["entities"].as_array().unwrap();
        assert_eq!(entities.len(), 2);
        assert_eq!(entities[0]["name"], "one");
        assert_eq!(entities[1]["name"], "two");
    }

    #[test]
    fn unknown_language_and_extension_are_rejected() {
        let missing_language = extract(ExtractParams {
            filename: "a.py".into(),
            language: Some("brainfuck".into()),
            source: String::new(),
        });
        assert_eq!(missing_language.err().unwrap().code(), "language-not-found");

        let missing_extension = extract(ExtractParams {
            filename: "a.unknown-ext".into(),
            language: None,
            source: String::new(),
        });
        assert_eq!(
            missing_extension.err().unwrap().code(),
            "language-not-found"
        );
    }

    #[test]
    fn wasm_pending_language_is_explicit_not_silent() {
        let result = extract(ExtractParams {
            filename: "a.java".into(),
            language: None,
            source: "class A {}".into(),
        });
        assert_eq!(result.err().unwrap().code(), "grammar-unavailable");
    }

    #[test]
    fn oversized_source_is_rejected_before_parsing() {
        let result = extract(ExtractParams {
            filename: "a.py".into(),
            language: None,
            source: "x".repeat(MAX_SOURCE + 1),
        });
        assert_eq!(result.err().unwrap().code(), "source-limit");
    }
}
