//! The Node ↔ host wire contract (`acp-rust-2.0.0+jsonl-v1`).
//!
//! Newline-delimited JSON in both directions. Node sends [`RequestFrame`] and
//! receives either a [`ResponseFrame`] carrying the matching `id`, or an
//! unsolicited [`EventFrame`] with no `id`. The unsolicited direction is the
//! only structural difference from the OXC service contract this reuses;
//! everything else (envelope shape, byte ceilings, fail-the-process-on-violation
//! posture) is deliberately identical so the two hosts stay reviewable together.
//!
//! Frames are bounded on both sides. A frame that violates its ceiling is a
//! protocol fault, not a recoverable condition: the host reports it and stops
//! rather than guessing where the caller's intent was truncated.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

/// Envelope version. Bumped only for an incompatible envelope change; the set of
/// methods and events may grow within a version.
pub const WIRE_VERSION: u32 = 1;

/// Ceiling for one inbound request frame.
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;

/// Ceiling for one outbound frame, including buffered agent output.
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;

/// Version stamp reported by `host.describe`, mirroring `RUST_OXC_COMPILER_VERSION`.
/// Encodes both the ACP crate version and the envelope generation, so a receipt
/// records which pair produced it.
pub const HOST_PROTOCOL_VERSION: &str = "acp-rust-2.0.0+jsonl-v1";

/// One request from the Node host.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestFrame {
    pub version: u32,
    pub id: u32,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

/// A rejected frame, distinguished from a rejected *call*: this means the
/// envelope itself could not be trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum FrameError {
    Malformed(String),
    UnsupportedVersion(u32),
    TooLarge { bytes: usize, limit: usize },
}

impl std::fmt::Display for FrameError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Malformed(detail) => write!(formatter, "malformed request frame: {detail}"),
            Self::UnsupportedVersion(version) => write!(
                formatter,
                "request frame version {version} is not supported; this host speaks version {WIRE_VERSION}"
            ),
            Self::TooLarge { bytes, limit } => write!(
                formatter,
                "request frame is {bytes} bytes, over the {limit} byte limit"
            ),
        }
    }
}

impl std::error::Error for FrameError {}

/// Parse one NDJSON line into a frame, enforcing the size and version ceilings
/// before any method dispatch sees it.
pub fn parse_request_frame(line: &str) -> Result<RequestFrame, FrameError> {
    if line.len() > MAX_REQUEST_BYTES {
        return Err(FrameError::TooLarge {
            bytes: line.len(),
            limit: MAX_REQUEST_BYTES,
        });
    }
    let frame: RequestFrame =
        serde_json::from_str(line).map_err(|error| FrameError::Malformed(error.to_string()))?;
    if frame.version != WIRE_VERSION {
        return Err(FrameError::UnsupportedVersion(frame.version));
    }
    Ok(frame)
}

/// A typed call, resolved from [`RequestFrame::method`] and `params`.
///
/// Method names are namespaced by subject rather than by ACP method, because
/// several of these have no ACP counterpart (`host.describe`, `shutdown`) and
/// others fan out to more than one ACP call (`session.create`).
#[derive(Debug, Clone, PartialEq)]
pub enum Call {
    /// Report host identity and capabilities without side effects.
    HostDescribe,
    /// Spawn an agent and complete the ACP handshake, or reuse a live connection.
    ConnectionOpen(ConnectionOpenParams),
    /// Drop a connection and reap its agent process.
    ConnectionClose(ConnectionCloseParams),
    /// Create a session on an open connection.
    SessionCreate(SessionCreateParams),
    /// Apply one session config option and verify the agent acknowledged it.
    SessionSetConfigOption(SessionSetConfigOptionParams),
    /// Send one prompt turn. A connection may serve many of these in sequence.
    SessionPrompt(SessionPromptParams),
    /// Ask the agent to cancel the in-flight turn.
    SessionCancel(SessionCancelParams),
    /// Resolve a pending `session/request_permission`.
    PermissionDecide(PermissionDecideParams),
    /// Close every connection and exit.
    Shutdown,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionOpenParams {
    /// Caller-chosen connection identity. Reopening with the same id reuses the
    /// live connection instead of spawning a second agent.
    pub connection_id: String,
    pub command: PathBuf,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Roots the agent may read and write through `fs/*`. Empty denies all
    /// filesystem access rather than defaulting to something permissive.
    #[serde(default)]
    pub allow_roots: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionCloseParams {
    pub connection_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCreateParams {
    pub connection_id: String,
    pub cwd: PathBuf,
}

#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionSetConfigOptionParams {
    pub connection_id: String,
    pub session_id: String,
    pub config_id: String,
    pub value: ConfigOptionValue,
}

/// ACP distinguishes boolean options from string options on the wire, so the
/// host must preserve which one the caller asked for.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(untagged)]
pub enum ConfigOptionValue {
    Boolean(bool),
    Text(String),
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionPromptParams {
    pub connection_id: String,
    pub session_id: String,
    pub prompt: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionCancelParams {
    pub connection_id: String,
    pub session_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionDecideParams {
    pub request_id: String,
    /// `None` cancels the request. A selected option must be one the agent
    /// offered; the host rejects anything else.
    #[serde(default)]
    pub option_id: Option<String>,
}

impl Call {
    /// Resolve a frame into a typed call.
    ///
    /// Unknown methods are rejected rather than ignored: a caller that asks for
    /// something this host does not implement has a version mismatch worth
    /// surfacing, not a no-op to absorb.
    pub fn from_frame(frame: &RequestFrame) -> Result<Self, CallError> {
        let method = frame.method.as_str();
        match method {
            "host.describe" => Ok(Self::HostDescribe),
            "shutdown" => Ok(Self::Shutdown),
            "connection.open" => Ok(Self::ConnectionOpen(typed_params(frame)?)),
            "connection.close" => Ok(Self::ConnectionClose(typed_params(frame)?)),
            "session.create" => Ok(Self::SessionCreate(typed_params(frame)?)),
            "session.setConfigOption" => Ok(Self::SessionSetConfigOption(typed_params(frame)?)),
            "session.prompt" => Ok(Self::SessionPrompt(typed_params(frame)?)),
            "session.cancel" => Ok(Self::SessionCancel(typed_params(frame)?)),
            "permission.decide" => Ok(Self::PermissionDecide(typed_params(frame)?)),
            other => Err(CallError::UnknownMethod(other.to_owned())),
        }
    }
}

/// Deserialize one call's params, naming the method in any failure so the caller
/// learns which request it got wrong rather than only that something was wrong.
fn typed_params<T: serde::de::DeserializeOwned>(frame: &RequestFrame) -> Result<T, CallError> {
    serde_json::from_value(frame.params.clone()).map_err(|error| CallError::InvalidParams {
        method: frame.method.clone(),
        detail: error.to_string(),
    })
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallError {
    UnknownMethod(String),
    InvalidParams { method: String, detail: String },
}

impl CallError {
    /// The stable error code Node matches on.
    pub fn code(&self) -> &'static str {
        match self {
            Self::UnknownMethod(_) => "unknown-method",
            Self::InvalidParams { .. } => "invalid-params",
        }
    }
}

impl std::fmt::Display for CallError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownMethod(method) => write!(formatter, "unknown method '{method}'"),
            Self::InvalidParams { method, detail } => {
                write!(formatter, "invalid params for '{method}': {detail}")
            }
        }
    }
}

impl std::error::Error for CallError {}

/// A reply to one [`RequestFrame`].
#[derive(Debug, Clone, Serialize)]
pub struct ResponseFrame {
    pub version: u32,
    pub id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<WireError>,
}

impl ResponseFrame {
    pub fn ok(id: u32, result: Value) -> Self {
        Self {
            version: WIRE_VERSION,
            id,
            result: Some(result),
            error: None,
        }
    }

    pub fn failed(id: u32, code: &str, message: impl Into<String>) -> Self {
        Self {
            version: WIRE_VERSION,
            id,
            result: None,
            error: Some(WireError {
                code: code.to_owned(),
                message: message.into(),
            }),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct WireError {
    pub code: String,
    pub message: String,
}

/// An unsolicited frame. Carries no `id`, which is how Node tells it apart from
/// a [`ResponseFrame`] without inspecting the payload.
#[derive(Debug, Clone, Serialize)]
pub struct EventFrame {
    pub version: u32,
    pub event: HostEvent,
}

impl EventFrame {
    pub fn new(event: HostEvent) -> Self {
        Self {
            version: WIRE_VERSION,
            event,
        }
    }
}

/// Host-emitted events.
///
/// Shaped after Zed's `AcpThreadEvent`: a minimal list-diff vocabulary
/// (`append` / `update` / `remove`) plus session-level notices. Keeping the
/// diff vocabulary this small is what lets the browser update one row instead
/// of rebuilding a transcript.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum HostEvent {
    /// A new entry was appended. Index is implied to be the current tail.
    EntryAppended {
        connection_id: String,
        session_id: String,
        index: usize,
        entry: Value,
    },
    /// An existing entry changed in place.
    EntryUpdated {
        connection_id: String,
        session_id: String,
        index: usize,
        entry: Value,
    },
    /// A half-open range of entries was dropped.
    EntriesRemoved {
        connection_id: String,
        session_id: String,
        start: usize,
        end: usize,
    },
    /// A turn changed phase.
    StatusChanged {
        connection_id: String,
        session_id: String,
        status: TurnStatus,
        #[serde(skip_serializing_if = "Option::is_none")]
        stop_reason: Option<String>,
    },
    /// The agent asked for permission and is blocked until `permission.decide`.
    PermissionRequested {
        connection_id: String,
        session_id: String,
        request_id: String,
        tool_call_id: String,
        title: String,
        options: Vec<PermissionOption>,
    },
    /// A permission request reached a terminal outcome, including outcomes the
    /// host decided on its own (agent cancellation, session teardown).
    PermissionResolved { request_id: String, outcome: String },
    /// One redacted ACP wire frame, retained for the evidence trace.
    ProtocolFrame {
        connection_id: String,
        direction: FrameDirection,
        method: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        rpc_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        session_id: Option<String>,
        payload: Value,
    },
    /// The agent process exited on its own.
    ConnectionLost {
        connection_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        detail: Option<String>,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TurnStatus {
    Running,
    Stopped,
    Failed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub enum FrameDirection {
    #[serde(rename = "Client → Agent")]
    ClientToAgent,
    #[serde(rename = "Agent → Client")]
    AgentToClient,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionOption {
    pub option_id: String,
    pub name: String,
    pub kind: String,
}

/// Serialize one outbound frame as an NDJSON line, enforcing the outbound ceiling.
pub fn encode_frame<T: Serialize>(frame: &T) -> Result<String, FrameError> {
    let mut line =
        serde_json::to_string(frame).map_err(|error| FrameError::Malformed(error.to_string()))?;
    if line.len() > MAX_FRAME_BYTES {
        return Err(FrameError::TooLarge {
            bytes: line.len(),
            limit: MAX_FRAME_BYTES,
        });
    }
    line.push('\n');
    Ok(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(method: &str, params: Value) -> RequestFrame {
        RequestFrame {
            version: WIRE_VERSION,
            id: 1,
            method: method.to_owned(),
            params,
        }
    }

    #[test]
    fn parses_a_well_formed_frame() {
        let parsed = parse_request_frame(r#"{"version":1,"id":7,"method":"host.describe"}"#)
            .expect("frame should parse");
        assert_eq!(parsed.id, 7);
        assert_eq!(parsed.method, "host.describe");
        assert_eq!(Call::from_frame(&parsed), Ok(Call::HostDescribe));
    }

    #[test]
    fn rejects_a_frame_from_a_different_envelope_generation() {
        let error = parse_request_frame(r#"{"version":2,"id":1,"method":"shutdown"}"#)
            .expect_err("a version mismatch must not be absorbed");
        assert_eq!(error, FrameError::UnsupportedVersion(2));
    }

    #[test]
    fn rejects_a_frame_over_the_request_ceiling() {
        let padding = "x".repeat(MAX_REQUEST_BYTES);
        let line = format!(r#"{{"version":1,"id":1,"method":"{padding}"}}"#);
        let error = parse_request_frame(&line).expect_err("an oversized frame must be rejected");
        assert!(matches!(
            error,
            FrameError::TooLarge {
                limit: MAX_REQUEST_BYTES,
                ..
            }
        ));
    }

    #[test]
    fn rejects_unknown_envelope_fields() {
        let error = parse_request_frame(r#"{"version":1,"id":1,"method":"shutdown","extra":true}"#)
            .expect_err("an unknown envelope field means the caller expects behavior we lack");
        assert!(matches!(error, FrameError::Malformed(_)));
    }

    #[test]
    fn reports_an_unknown_method_rather_than_ignoring_it() {
        let error = Call::from_frame(&frame("session.teleport", Value::Null))
            .expect_err("unknown methods must surface");
        assert_eq!(error.code(), "unknown-method");
    }

    #[test]
    fn resolves_connection_open_params() {
        let call = Call::from_frame(&frame(
            "connection.open",
            serde_json::json!({
                "connectionId": "c1",
                "command": "/usr/bin/agent",
                "args": ["--acp"],
                "env": { "TOKEN": "x" },
                "allowRoots": ["/tmp/workspace"],
            }),
        ))
        .expect("params should resolve");
        let Call::ConnectionOpen(params) = call else {
            panic!("expected a connection.open call");
        };
        assert_eq!(params.connection_id, "c1");
        assert_eq!(params.args, vec!["--acp".to_owned()]);
        assert_eq!(params.allow_roots, vec![PathBuf::from("/tmp/workspace")]);
    }

    #[test]
    fn defaults_connection_open_to_no_filesystem_access() {
        let call = Call::from_frame(&frame(
            "connection.open",
            serde_json::json!({ "connectionId": "c1", "command": "agent" }),
        ))
        .expect("params should resolve");
        let Call::ConnectionOpen(params) = call else {
            panic!("expected a connection.open call");
        };
        assert!(
            params.allow_roots.is_empty(),
            "an omitted allowRoots must deny filesystem access, never widen it"
        );
    }

    #[test]
    fn preserves_whether_a_config_option_was_boolean_or_text() {
        let boolean = Call::from_frame(&frame(
            "session.setConfigOption",
            serde_json::json!({
                "connectionId": "c1", "sessionId": "s1", "configId": "yolo", "value": true,
            }),
        ))
        .expect("boolean option should resolve");
        let Call::SessionSetConfigOption(params) = boolean else {
            panic!("expected a session.setConfigOption call");
        };
        assert_eq!(params.value, ConfigOptionValue::Boolean(true));

        let text = Call::from_frame(&frame(
            "session.setConfigOption",
            serde_json::json!({
                "connectionId": "c1", "sessionId": "s1", "configId": "model", "value": "sonnet",
            }),
        ))
        .expect("text option should resolve");
        let Call::SessionSetConfigOption(params) = text else {
            panic!("expected a session.setConfigOption call");
        };
        assert_eq!(params.value, ConfigOptionValue::Text("sonnet".to_owned()));
    }

    #[test]
    fn reports_invalid_params_with_the_offending_method() {
        let error = Call::from_frame(&frame(
            "session.prompt",
            serde_json::json!({ "connectionId": "c1" }),
        ))
        .expect_err("a missing required field must surface");
        assert_eq!(error.code(), "invalid-params");
        assert!(error.to_string().contains("session.prompt"));
    }

    #[test]
    fn treats_a_permission_decision_without_an_option_as_a_cancellation() {
        let call = Call::from_frame(&frame(
            "permission.decide",
            serde_json::json!({ "requestId": "7" }),
        ))
        .expect("params should resolve");
        assert_eq!(
            call,
            Call::PermissionDecide(PermissionDecideParams {
                request_id: "7".to_owned(),
                option_id: None,
            })
        );
    }

    #[test]
    fn encodes_a_response_as_one_newline_terminated_line() {
        let line = encode_frame(&ResponseFrame::ok(3, serde_json::json!({ "ok": true })))
            .expect("response should encode");
        assert!(line.ends_with('\n'));
        assert_eq!(line.matches('\n').count(), 1);
        let parsed: Value = serde_json::from_str(line.trim_end()).expect("line should be JSON");
        assert_eq!(parsed["id"], 3);
        assert_eq!(parsed["version"], WIRE_VERSION);
        assert!(parsed.get("error").is_none(), "a success must omit error");
    }

    #[test]
    fn encodes_an_error_response_without_a_result_field() {
        let line = encode_frame(&ResponseFrame::failed(4, "unknown-method", "nope"))
            .expect("response should encode");
        let parsed: Value = serde_json::from_str(line.trim_end()).expect("line should be JSON");
        assert!(parsed.get("result").is_none(), "a failure must omit result");
        assert_eq!(parsed["error"]["code"], "unknown-method");
    }

    #[test]
    fn distinguishes_an_event_frame_by_the_absence_of_an_id() {
        let line = encode_frame(&EventFrame::new(HostEvent::StatusChanged {
            connection_id: "c1".to_owned(),
            session_id: "s1".to_owned(),
            status: TurnStatus::Stopped,
            stop_reason: Some("end_turn".to_owned()),
        }))
        .expect("event should encode");
        let parsed: Value = serde_json::from_str(line.trim_end()).expect("line should be JSON");
        assert!(
            parsed.get("id").is_none(),
            "Node separates events from responses by the missing id"
        );
        assert_eq!(parsed["event"]["type"], "status-changed");
        assert_eq!(parsed["event"]["status"], "stopped");
    }

    #[test]
    fn encodes_protocol_frame_directions_as_the_studio_trace_spells_them() {
        let line = encode_frame(&EventFrame::new(HostEvent::ProtocolFrame {
            connection_id: "c1".to_owned(),
            direction: FrameDirection::AgentToClient,
            method: "session/update".to_owned(),
            rpc_id: None,
            session_id: Some("s1".to_owned()),
            payload: Value::Null,
        }))
        .expect("event should encode");
        let parsed: Value = serde_json::from_str(line.trim_end()).expect("line should be JSON");
        assert_eq!(
            parsed["event"]["direction"], "Agent → Client",
            "directions must match the existing HarnessProtocolEvent vocabulary verbatim"
        );
    }

    #[test]
    fn rejects_an_outbound_frame_over_the_frame_ceiling() {
        let payload = Value::String("y".repeat(MAX_FRAME_BYTES));
        let error = encode_frame(&ResponseFrame::ok(1, payload))
            .expect_err("an oversized outbound frame must be rejected");
        assert!(matches!(
            error,
            FrameError::TooLarge {
                limit: MAX_FRAME_BYTES,
                ..
            }
        ));
    }
}
