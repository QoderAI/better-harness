//! microVM capability service for Better Harness Desktop.
//!
//! Fourth in the same family as `oxc-service`, `acp-host` and `evidence-host`:
//! a stdio JSONL driver, an NSXPC service that runs one driver per connection,
//! and a bridge Studio spawns in the driver's place on macOS.
//!
//! What it adds is a place to put an agent that is not this machine.

pub mod runtime;
pub mod wire;

#[cfg(target_os = "macos")]
pub mod xpc;

use std::sync::Arc;

use serde_json::json;

use crate::runtime::BoxHost;
use crate::wire::{
    BoxCreateParams, BoxRefParams, ExecParams, ExecRefParams, ExecStdinParams, RequestFrame,
    encode_error, encode_ok,
};

/// Dispatch one parsed frame. Errors are replies, not process failures: a bad
/// `box.exec` should cost the caller one request, not the whole runtime and
/// every VM it is holding.
pub async fn dispatch(host: &Arc<BoxHost>, frame: RequestFrame) -> Result<String, String> {
    let id = frame.id;
    match frame.method.as_str() {
        "host.describe" => encode_ok(id, host.describe()),
        "box.create" => match parse::<BoxCreateParams>(&frame) {
            Ok(params) => reply(id, "create-failed", host.create(params).await),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "box.start" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(id, "start-failed", host.start(&params.name).await),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "box.exec" => match parse::<ExecParams>(&frame) {
            Ok(params) => reply(id, "exec-failed", host.exec(params).await),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "exec.stdin" => match parse::<ExecStdinParams>(&frame) {
            Ok(params) => reply(id, "stdin-failed", host.stdin(params).await),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "exec.kill" => match parse::<ExecRefParams>(&frame) {
            Ok(params) => reply(
                id,
                "kill-failed",
                host.kill(&params.exec_id, params.signal).await,
            ),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "box.stop" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(id, "stop-failed", host.stop(&params.name).await),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "box.remove" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(
                id,
                "remove-failed",
                host.remove(&params.name, params.force).await,
            ),
            Err(message) => encode_error(id, "bad-params", message),
        },
        "box.list" => reply(id, "list-failed", host.list().await),
        "shutdown" => {
            host.shutdown().await;
            encode_ok(id, json!({ "status": "shutting-down" }))
        }
        other => encode_error(id, "unknown-method", format!("unknown method {other}")),
    }
}

fn parse<T: serde::de::DeserializeOwned>(frame: &RequestFrame) -> Result<T, String> {
    serde_json::from_value(frame.params.clone()).map_err(|error| error.to_string())
}

fn reply(
    id: u32,
    code: &str,
    outcome: anyhow::Result<serde_json::Value>,
) -> Result<String, String> {
    match outcome {
        Ok(value) => encode_ok(id, value),
        Err(error) => encode_error(id, code, error.to_string()),
    }
}
