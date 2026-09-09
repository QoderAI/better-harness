pub mod artifacts;
pub mod discover;
pub mod model;
pub mod memory;
pub mod paths;
pub mod platforms;
pub mod privacy;
pub mod time;
pub mod wire;

#[cfg(target_os = "macos")]
pub mod xpc;

use serde_json::{json, Value};

use crate::discover::{discover, observe_params, DiscoverParams};
use crate::wire::{
    encode_error, encode_ok, parse_request_frame, RequestFrame, HOST_PROTOCOL_VERSION,
};

pub fn handle_line(line: &str) -> Result<String, String> {
    let frame = parse_request_frame(line).map_err(|error| error.to_string())?;
    dispatch(&frame)
}

fn dispatch(frame: &RequestFrame) -> Result<String, String> {
    match frame.method.as_str() {
        "host.describe" => encode_ok(
            frame.id,
            json!({
                "protocol": HOST_PROTOCOL_VERSION,
                "pid": std::process::id(),
                "platforms": crate::model::PORTED,
                "capabilities": ["sessions.discover", "artifacts.observe", "memory.discover", "memory.read"],
            }),
        ),
        "sessions.discover" => {
            let params: DiscoverParams =
                serde_json::from_value(frame.params.clone()).map_err(|error| error.to_string())?;
            match discover(params) {
                Ok(result) => encode_ok(frame.id, result),
                Err(message) => encode_error(frame.id, "discover-failed", message),
            }
        }
        "artifacts.observe" => match observe_params(&frame.params) {
            Ok(result) => encode_ok(frame.id, result),
            Err(message) => encode_error(frame.id, "observe-failed", message),
        },
        "memory.discover" | "memory.read" => {
            let result = if frame.method == "memory.read" {
                memory::read(&frame.params)
            } else {
                memory::discover(&frame.params)
            };
            match result {
                Ok(value) => encode_ok(frame.id, value),
                Err(message) => encode_error(frame.id, "memory-unavailable", message),
            }
        }
        "shutdown" => encode_ok(frame.id, json!({ "status": "shutting-down" })),
        other => encode_error(
            frame.id,
            "unknown-method",
            format!("unknown method {other}"),
        ),
    }
}

pub fn handle_value(value: &Value) -> Value {
    let Ok(frame) = serde_json::from_value::<RequestFrame>(value.clone()) else {
        return json!({"version":1,"id":null,"error":{"code":"malformed"}});
    };
    match dispatch(&frame) {
        Ok(line) => serde_json::from_str(line.trim_end()).unwrap_or_else(
            |_| json!({"version":1,"id":frame.id,"error":{"code":"encode-failed"}}),
        ),
        Err(_) => json!({"version":1,"id":frame.id,"error":{"code":"encode-failed"}}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::parse_request_frame;

    #[test]
    fn unknown_method_is_a_call_error_not_a_process_fault() {
        let reply = handle_line(r#"{"version":1,"id":3,"method":"nope","params":{}}"#).unwrap();
        assert!(reply.contains("unknown-method"));
        assert!(reply.contains("\"id\":3"));
    }

    #[test]
    fn unknown_fields_fail_the_envelope() {
        let error =
            parse_request_frame(r#"{"version":1,"id":1,"method":"host.describe","extra":true}"#)
                .unwrap_err();
        assert!(error.to_string().contains("malformed"));
    }

    #[test]
    fn describe_reports_protocol() {
        let reply =
            handle_line(r#"{"version":1,"id":1,"method":"host.describe","params":{}}"#).unwrap();
        assert!(reply.contains(HOST_PROTOCOL_VERSION));
        assert!(reply.contains("grok"));
    }

    #[test]
    fn transport_proof_names_distinct_pids() {
        let line = crate::wire::transport_proof(10, 11);
        let value: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(value["event"]["transport"], "nsxpc");
        assert_eq!(value["event"]["servicePid"], 10);
        assert_eq!(value["event"]["bridgePid"], 11);
        assert_ne!(value["event"]["servicePid"], value["event"]["bridgePid"]);
    }
}
