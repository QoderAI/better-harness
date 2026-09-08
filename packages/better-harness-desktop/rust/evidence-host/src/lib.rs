pub mod artifacts;
pub mod discover;
pub mod model;
pub mod paths;
pub mod platforms;
pub mod time;
pub mod wire;

#[cfg(target_os = "macos")]
pub mod xpc;

use serde_json::{Value, json};

use crate::discover::{DiscoverParams, discover, observe_params};
use crate::wire::{HOST_PROTOCOL_VERSION, RequestFrame, encode_error, encode_ok, parse_request_frame};

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
        "shutdown" => encode_ok(frame.id, json!({ "status": "shutting-down" })),
        other => encode_error(frame.id, "unknown-method", format!("unknown method {other}")),
    }
}

pub fn handle_value(value: &Value) -> Value {
    let Ok(frame) = serde_json::from_value::<RequestFrame>(value.clone()) else {
        return json!({"version":1,"id":null,"error":{"code":"malformed"}});
    };
    match dispatch(&frame) {
        Ok(line) => serde_json::from_str(line.trim_end()).unwrap_or_else(|_| {
            json!({"version":1,"id":frame.id,"error":{"code":"encode-failed"}})
        }),
        Err(_) => json!({"version":1,"id":frame.id,"error":{"code":"encode-failed"}}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::wire::parse_request_frame;

    #[test]
    fn unknown_method_is_a_call_error_not_a_process_fault() {
        let reply = handle_line(
            r#"{"version":1,"id":3,"method":"nope","params":{}}"#,
        )
        .unwrap();
        assert!(reply.contains("unknown-method"));
        assert!(reply.contains("\"id\":3"));
    }

    #[test]
    fn unknown_fields_fail_the_envelope() {
        let error = parse_request_frame(r#"{"version":1,"id":1,"method":"host.describe","extra":true}"#)
            .unwrap_err();
        assert!(error.to_string().contains("malformed"));
    }

    #[test]
    fn describe_reports_protocol() {
        let reply = handle_line(r#"{"version":1,"id":1,"method":"host.describe","params":{}}"#).unwrap();
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
