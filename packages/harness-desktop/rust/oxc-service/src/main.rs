use oxc_allocator::Allocator;
use oxc_ast_visit::utf8_to_utf16::Utf8ToUtf16;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_diagnostics::OxcDiagnostic;
use oxc_parser::{ParseOptions, Parser};
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use oxc_transformer::{JsxOptions, JsxRuntime, TransformOptions, Transformer};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};
use std::path::Path;

const MAX_SOURCE: usize = 512 * 1024;
const MAX_REQUEST: usize = 4 * 1024 * 1024;
const MAX_RESPONSE: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Method {
    Parse,
    Transform,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    id: u32,
    method: Method,
    filename: String,
    source: String,
}

fn diagnostic_values(errors: &[OxcDiagnostic], source: &str) -> Vec<Value> {
    errors
        .iter()
        .map(|error| {
            let labels: Vec<Value> = error
                .labels
                .iter()
                .map(|label| {
                    let offset =
                        source.floor_char_boundary((label.offset() as usize).min(source.len()));
                    let start = source.get(..offset).unwrap_or("").encode_utf16().count();
                    json!({"start": start})
                })
                .collect();
            json!({"message": error.message, "labels": labels})
        })
        .collect()
}

fn execute(request: &Request) -> Result<Value, &'static str> {
    if request.version != 1 || request.id == 0 {
        return Err("unsupported-envelope");
    }
    // Filename is a portable revision identifier, never opened as a file.
    if !request.filename.starts_with('/')
        || request.filename.len() > 4096
        || request.filename.contains(['\\', '\0'])
        || request.filename.split('/').any(|part| part == "..")
    {
        return Err("invalid-filename");
    }
    if request.source.len() > MAX_SOURCE {
        return Err("source-limit");
    }
    let allocator = Allocator::default();
    let parsed = Parser::new(&allocator, &request.source, SourceType::tsx())
        .with_options(ParseOptions {
            parse_regular_expression: true,
            ..ParseOptions::default()
        })
        .parse();
    if !parsed.diagnostics.is_empty() {
        return Ok(
            json!({"program": null, "code": "", "errors": diagnostic_values(&parsed.diagnostics, &request.source)}),
        );
    }
    let mut program = parsed.program;
    match request.method {
        Method::Parse => {
            Utf8ToUtf16::new(&request.source).convert_program(&mut program);
            let ast = program.to_estree_json(true, false);
            if ast.len() > MAX_RESPONSE - 1024 {
                return Err("response-limit");
            }
            let program: Value = serde_json::from_str(&ast).map_err(|_| "ast-serialization")?;
            Ok(json!({"program": program, "errors": []}))
        }
        Method::Transform => {
            let semantic = SemanticBuilder::new()
                .with_excess_capacity(2.0)
                .with_enum_eval(true)
                .build(&program);
            if !semantic.diagnostics.is_empty() {
                return Ok(
                    json!({"code": "", "errors": diagnostic_values(&semantic.diagnostics, &request.source)}),
                );
            }
            let options = TransformOptions {
                jsx: JsxOptions {
                    runtime: JsxRuntime::Automatic,
                    development: true,
                    import_source: Some("@studio/agent-react".into()),
                    refresh: None,
                    ..JsxOptions::default()
                },
                ..TransformOptions::default()
            };
            let transformed = Transformer::new(&allocator, Path::new(&request.filename), &options)
                .build_with_scoping(semantic.semantic.into_scoping(), &mut program);
            if !transformed.diagnostics.is_empty() {
                return Ok(
                    json!({"code": "", "errors": diagnostic_values(&transformed.diagnostics, &request.source)}),
                );
            }
            let generated = Codegen::new()
                .with_options(CodegenOptions {
                    source_map_path: Some(request.filename.clone().into()),
                    ..CodegenOptions::default()
                })
                .build(&program);
            let map = generated.map.map(|map| {
                serde_json::from_str::<Value>(&map.to_json_string()).expect("OXC sourcemap JSON")
            });
            Ok(json!({"code": generated.code, "map": map, "errors": []}))
        }
    }
}

fn error(id: Option<u32>, code: &str) -> Value {
    json!({"version": 1, "id": id, "error": {"code": code}})
}

fn handle(frame: &[u8]) -> Value {
    match serde_json::from_slice::<Request>(frame) {
        Ok(request) => match execute(&request) {
            Ok(result) => {
                json!({"version": 1, "id": request.id, "pid": std::process::id(), "result": result})
            }
            Err(code) => error(Some(request.id), code),
        },
        Err(_) => error(None, "invalid-request"),
    }
}

fn serve(mut input: impl BufRead, mut output: impl Write) -> io::Result<()> {
    loop {
        let mut frame = Vec::new();
        let bytes = input
            .by_ref()
            .take((MAX_REQUEST + 1) as u64)
            .read_until(b'\n', &mut frame)?;
        if bytes == 0 {
            return Ok(());
        }
        if bytes > MAX_REQUEST || frame.last() != Some(&b'\n') {
            writeln!(output, "{}", error(None, "frame-limit-or-truncated"))?;
            output.flush()?;
            return Ok(());
        }
        let response = handle(&frame);
        let encoded = serde_json::to_vec(&response)?;
        if encoded.len() > MAX_RESPONSE {
            writeln!(
                output,
                "{}",
                error(
                    response["id"].as_u64().and_then(|v| u32::try_from(v).ok()),
                    "response-limit"
                )
            )?;
        } else {
            output.write_all(&encoded)?;
            output.write_all(b"\n")?;
        }
        output.flush()?;
    }
}

fn main() -> io::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args == ["--version"] {
        println!("harness-oxc-service 0.1.0 (oxc 0.147.0; protocol 1)");
        return Ok(());
    }
    if args == ["--help"] {
        println!(
            "harness-oxc-service [--version|--help]\nReads protocol v1 JSONL parse/transform requests from stdin; writes JSONL results to stdout."
        );
        return Ok(());
    }
    if !args.is_empty() {
        eprintln!("Unknown argument. Use --help.");
        std::process::exit(2);
    }
    serve(io::stdin().lock(), io::stdout().lock())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn request(method: &str, source: &str) -> Value {
        handle(
            serde_json::to_string(
                &json!({"version":1,"id":1,"method":method,"filename":"/view.tsx","source":source}),
            )
            .unwrap()
            .as_bytes(),
        )
    }
    #[test]
    fn parse_uses_utf16_spans() {
        let result = request("parse", "const value = '你好😀'; const next = 1;");
        assert_eq!(result["result"]["program"]["body"][1]["start"], 22);
    }
    #[test]
    fn transforms_typescript_and_development_jsx() {
        let result = request("transform", "export const View = () => <h1>Hello</h1>;");
        let code = result["result"]["code"].as_str().unwrap();
        assert!(code.contains("@studio/agent-react/jsx-dev-runtime"));
        assert!(result["result"]["map"]["sources"].is_array());
    }
    #[test]
    fn rejects_unknown_fields_versions_and_methods() {
        assert!(handle(br#"{"version":1,"id":1,"method":"exec","filename":"/a.tsx","source":""}"#)["error"].is_object());
        assert!(handle(br#"{"version":2,"id":1,"method":"parse","filename":"/a.tsx","source":""}"#)["error"].is_object());
        assert!(handle(br#"{"version":1,"id":1,"method":"parse","filename":"/a.tsx","source":"","extra":1}"#)["error"].is_object());
        assert!(request("parse", &"a".repeat(MAX_SOURCE + 1))["error"].is_object());
    }
    #[test]
    fn truncated_and_oversized_frames_are_bounded() {
        for input in [b"{}".to_vec(), vec![b'a'; MAX_REQUEST + 1]] {
            let mut output = Vec::new();
            serve(io::Cursor::new(input), &mut output).unwrap();
            assert!(serde_json::from_slice::<Value>(&output).unwrap()["error"].is_object());
        }
    }
    #[test]
    fn invalid_syntax_returns_diagnostics_without_code() {
        assert!(
            !request("parse", "const =")["result"]["errors"]
                .as_array()
                .unwrap()
                .is_empty()
        );
    }
}
