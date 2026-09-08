//! Node ↔ evidence-host JSONL contract (`evidence-rust-1.0.0+jsonl-v1`).

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const WIRE_VERSION: u32 = 1;
pub const MAX_REQUEST_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_FRAME_BYTES: usize = 16 * 1024 * 1024;
pub const HOST_PROTOCOL_VERSION: &str = "evidence-rust-1.0.0+jsonl-v1";

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

pub fn transport_proof(service_pid: u32, bridge_pid: i32) -> String {
    format!(
        "{{\"version\":1,\"event\":{{\"type\":\"transport\",\"transport\":\"nsxpc\",\"servicePid\":{service_pid},\"bridgePid\":{bridge_pid}}}}}\n"
    )
}
