//! The Node <-> host wire contract (`ontology-rust-0.1.0+jsonl-v1`).
//!
//! Newline-delimited JSON in both directions, envelope shape and byte
//! ceilings deliberately identical to `harness-oxc-service` and
//! `harness-evidence-host` so the four hosts stay reviewable together.

use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{self, BufRead, Read, Write};

pub const MAX_REQUEST: usize = 4 * 1024 * 1024;
pub const MAX_RESPONSE: usize = 16 * 1024 * 1024;
pub const PROTOCOL_VERSION: &str = "ontology-rust-0.1.0+jsonl-v1";

// A hand-rolled method dispatch (rather than serde's adjacently-tagged enum
// sugar) because the three methods have incompatible `params` shapes — two
// take no params at all, one takes `ExtractParams` — and unit variants only
// accept `params: null` under `tag`/`content`, not the `{}` every real
// caller sends. Matching on the raw string keeps that a policy in one place.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    version: u32,
    id: u32,
    method: String,
    #[serde(default)]
    params: Value,
}

fn error(id: Option<u32>, code: &str) -> Value {
    json!({"version": 1, "id": id, "error": {"code": code}})
}

fn execute(method: &str, params: Value) -> Result<Value, &'static str> {
    match method {
        "host.describe" => Ok(json!({
            "protocol": PROTOCOL_VERSION,
            "pid": std::process::id(),
            "platforms": ["stdio", "nsxpc"],
        })),
        "languages.list" => Ok(json!({ "languages": crate::grammar::describe_all() })),
        "ontology.extract" => {
            let params: crate::entity::ExtractParams =
                serde_json::from_value(params).map_err(|_| "invalid-params")?;
            crate::entity::extract(params).map_err(|error| error.code())
        }
        _ => Err("unknown-method"),
    }
}

/// Parse and run one NDJSON frame, producing the response envelope. Never
/// panics on malformed input; a bad frame becomes an `error` envelope, not a
/// process fault, mirroring `harness-oxc-service::handle`.
pub fn handle(frame: &[u8]) -> Value {
    let request = match serde_json::from_slice::<Request>(frame) {
        Ok(request) => request,
        Err(_) => return error(None, "invalid-request"),
    };
    if request.version != 1 || request.id == 0 {
        return error(Some(request.id), "unsupported-envelope");
    }
    match execute(&request.method, request.params) {
        Ok(result) => {
            json!({"version": 1, "id": request.id, "pid": std::process::id(), "result": result})
        }
        Err(code) => error(Some(request.id), code),
    }
}

pub fn serve(mut input: impl BufRead, mut output: impl Write) -> io::Result<()> {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_unknown_fields_versions_and_methods() {
        assert!(
            handle(br#"{"version":1,"id":1,"method":"exec","params":{}}"#)["error"].is_object()
        );
        assert!(
            handle(br#"{"version":2,"id":1,"method":"host.describe","params":{}}"#)["error"]
                .is_object()
        );
        assert!(
            handle(br#"{"version":1,"id":1,"method":"host.describe","params":{},"extra":1}"#)["error"]
                .is_object()
        );
        assert!(
            handle(br#"{"version":1,"id":0,"method":"host.describe","params":{}}"#)["error"]
                .is_object()
        );
    }

    #[test]
    fn host_describe_reports_protocol_and_pid() {
        let result = handle(br#"{"version":1,"id":7,"method":"host.describe","params":{}}"#);
        assert_eq!(result["id"], 7);
        assert_eq!(result["result"]["protocol"], PROTOCOL_VERSION);
        assert_eq!(result["pid"], std::process::id());
    }

    #[test]
    fn truncated_and_oversized_frames_are_bounded() {
        for input in [b"{}".to_vec(), vec![b'a'; MAX_REQUEST + 1]] {
            let mut output = Vec::new();
            serve(io::Cursor::new(input), &mut output).unwrap();
            assert!(serde_json::from_slice::<Value>(&output).unwrap()["error"].is_object());
        }
    }
}
