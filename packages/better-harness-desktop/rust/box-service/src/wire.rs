//! Node ↔ box-host JSONL contract (`box-rust-0.1.0+jsonl-v1`).
//!
//! Shaped like `evidence-host`'s frames so one reader understands both, but
//! duplex like `acp-host`: a box outlives the call that made it and a command
//! inside it streams, so the host emits unsolicited event frames between
//! replies. Events carry no `id` — that is what distinguishes them.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WIRE_VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub const HOST_PROTOCOL_VERSION: &str = "box-rust-0.1.0+jsonl-v1";

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequestFrame {
    pub version: u32,
    pub id: u32,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

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
    if frame.id == 0 {
        return Err(FrameError::Malformed("id must be a positive u32".into()));
    }
    Ok(frame)
}

#[derive(Debug, Serialize)]
pub struct ResponseFrame {
    pub version: u32,
    pub id: u32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<Value>,
}

pub fn encode_ok(id: u32, result: Value) -> Result<String, String> {
    encode(&ResponseFrame {
        version: WIRE_VERSION,
        id,
        result: Some(result),
        error: None,
    })
}

pub fn encode_error(id: u32, code: &str, message: String) -> Result<String, String> {
    encode(&ResponseFrame {
        version: WIRE_VERSION,
        id,
        result: None,
        error: Some(serde_json::json!({ "code": code, "message": message })),
    })
}

fn encode(frame: &ResponseFrame) -> Result<String, String> {
    let mut line = serde_json::to_string(frame).map_err(|error| error.to_string())?;
    if line.len() > MAX_FRAME_BYTES {
        return Err("response-limit".into());
    }
    line.push('\n');
    Ok(line)
}

/// Unsolicited frames. A box boots, prints, and exits on its own schedule; the
/// caller is told about it rather than polling for it.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum HostEvent {
    /// stdout/stderr from one command, one line per frame.
    #[serde(rename_all = "camelCase")]
    Output {
        exec_id: String,
        stream: OutputStream,
        data: String,
    },
    /// The command ended. `exitCode` is the guest's, not the host's.
    #[serde(rename_all = "camelCase")]
    Exit {
        exec_id: String,
        exit_code: i32,
        #[serde(skip_serializing_if = "Option::is_none")]
        error_message: Option<String>,
    },
    /// A box changed lifecycle state, including boot timings worth charting.
    #[serde(rename_all = "camelCase")]
    BoxState {
        box_id: String,
        state: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        elapsed_ms: Option<u64>,
    },
}

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum OutputStream {
    Stdout,
    Stderr,
}

pub fn encode_event(event: &HostEvent) -> Result<String, String> {
    let mut line = serde_json::to_string(&serde_json::json!({
        "version": WIRE_VERSION,
        "event": event,
    }))
    .map_err(|error| error.to_string())?;
    if line.len() > MAX_FRAME_BYTES {
        return Err("event-limit".into());
    }
    line.push('\n');
    Ok(line)
}

/// `box.create`. Mirrors `BoxOptions` but stays a wire type: the caller is Node,
/// which should not have to know the crate's enum shapes.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxCreateParams {
    /// Caller-chosen identity. Reusing a name reuses the box, which is what
    /// makes a Debugger session resumable across restarts.
    pub name: String,
    #[serde(default = "default_image")]
    pub image: String,
    #[serde(default)]
    pub cpus: Option<u8>,
    #[serde(default)]
    pub memory_mib: Option<u32>,
    #[serde(default)]
    pub disk_size_gb: Option<u64>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    /// Host directories the guest may see. This is the seam that lets an agent
    /// edit the real project while its commands stay inside the VM.
    #[serde(default)]
    pub mounts: Vec<MountSpec>,
    /// Egress allow-list. Empty means unrestricted, matching the crate default;
    /// `Some(vec![])` is not expressible here on purpose.
    #[serde(default)]
    pub allow_net: Vec<String>,
    #[serde(default)]
    pub network_disabled: bool,
}

fn default_image() -> String {
    "alpine:latest".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MountSpec {
    pub host_path: PathBuf,
    pub guest_path: String,
    #[serde(default)]
    pub read_only: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoxRefParams {
    pub name: String,
    #[serde(default)]
    pub force: bool,
}

/// `box.exec`. `interactive` is the Debugger's case: it keeps stdin open so a
/// long-lived agent can be spoken to over many turns.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecParams {
    pub name: String,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub working_dir: Option<String>,
    #[serde(default)]
    pub user: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub interactive: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecStdinParams {
    pub exec_id: String,
    /// A whole line, without its terminator; the host appends one. Framing is
    /// the host's job so callers cannot half-write a JSON-RPC message.
    pub data: String,
    #[serde(default)]
    pub close: bool,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExecRefParams {
    pub exec_id: String,
    #[serde(default)]
    pub signal: Option<i32>,
}

pub fn transport_proof(service_pid: u32, bridge_pid: i32) -> String {
    format!(
        "{{\"version\":1,\"event\":{{\"type\":\"transport\",\"transport\":\"nsxpc\",\"servicePid\":{service_pid},\"bridgePid\":{bridge_pid}}}}}\n"
    )
}
