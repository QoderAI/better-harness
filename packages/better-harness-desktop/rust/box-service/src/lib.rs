//! microVM capability service for Better Harness Desktop.
//!
//! Fourth in the same family as `oxc-service`, `acp-host` and `evidence-host`:
//! a stdio JSONL driver, an NSXPC service, and a bridge Studio spawns in the
//! driver's place on macOS.
//!
//! What it adds is a place to put an agent that is not this machine.
//!
//! It differs from its three siblings in one structural way: they run a driver
//! per connection, and this one cannot. BoxLite locks its home directory to a
//! single runtime, so there is exactly one driver and every connection shares
//! it. Requests carry a `connectionId` so replies and events find their way
//! back, and `connection.close` reaps one caller's commands without touching
//! anyone else's. See `xpc.rs`.

pub mod runtime;
pub mod wire;

#[cfg(target_os = "macos")]
pub mod xpc;

use std::path::Path;
use std::sync::Arc;

use serde_json::json;

/// Make `mke2fs` reachable before the runtime needs it.
///
/// BoxLite shells out to `mke2fs` to build a guest rootfs and finds it on
/// `PATH`. Two things conspire against that here: a process launched by the
/// desktop app inherits launchd's `PATH`, not a shell's, and Homebrew keeps
/// e2fsprogs keg-only so its binaries are not on `PATH` even in a terminal.
///
/// Worse than absent is wrong: `android-platform-tools` installs a *different*
/// `mke2fs` under the same name, and BoxLite dies on it with
/// `mke2fs failed with exit code None` — an empty diagnostic, because the
/// process never got far enough to have an exit code. The known-good locations
/// are therefore **prepended**, so a real e2fsprogs wins over a shadowing one.
pub fn ensure_tooling_path() {
    const CANDIDATES: [&str; 4] = [
        "/opt/homebrew/opt/e2fsprogs/sbin",
        "/usr/local/opt/e2fsprogs/sbin",
        "/opt/homebrew/sbin",
        "/sbin",
    ];
    let current = std::env::var("PATH").unwrap_or_default();
    // Prepended unconditionally, even when already present: a directory that
    // sits *after* the shadowing one would otherwise still lose.
    let mut prefix: Vec<String> = CANDIDATES
        .into_iter()
        .filter(|candidate| Path::new(candidate).join("mke2fs").is_file())
        .map(str::to_string)
        .collect();
    if prefix.is_empty() {
        return;
    }
    prefix.push(current);
    // SAFETY: called once at startup, before any thread that reads the
    // environment is spawned.
    unsafe { std::env::set_var("PATH", prefix.join(":")) };
}

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
    let at = frame.connection_id;
    match frame.method.as_str() {
        "host.describe" => encode_ok(id, at, host.describe()),
        "box.create" => match parse::<BoxCreateParams>(&frame) {
            Ok(params) => reply(id, at, "create-failed", host.create(params).await),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "box.start" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(id, at, "start-failed", host.start(&params.name, at).await),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "box.exec" => match parse::<ExecParams>(&frame) {
            Ok(params) => reply(id, at, "exec-failed", host.exec(params, at).await),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "exec.stdin" => match parse::<ExecStdinParams>(&frame) {
            Ok(params) => reply(id, at, "stdin-failed", host.stdin(params).await),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "exec.kill" => match parse::<ExecRefParams>(&frame) {
            Ok(params) => reply(
                id,
                at,
                "kill-failed",
                host.kill(&params.exec_id, params.signal).await,
            ),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "box.stop" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(id, at, "stop-failed", host.stop(&params.name, at).await),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "box.remove" => match parse::<BoxRefParams>(&frame) {
            Ok(params) => reply(
                id,
                at,
                "remove-failed",
                host.remove(&params.name, params.force).await,
            ),
            Err(message) => encode_error(id, at, "bad-params", message),
        },
        "box.list" => reply(id, at, "list-failed", host.list().await),
        // Sent by the XPC service when a connection goes away.
        "connection.close" => match at {
            Some(connection) => reply(
                id,
                at,
                "close-failed",
                host.close_connection(connection).await,
            ),
            None => encode_error(
                id,
                at,
                "bad-params",
                "connection.close needs a connectionId".into(),
            ),
        },
        "shutdown" => match at {
            // One driver serves every connection, so a caller may only end its
            // own work. Tearing down shared boxes on one caller's say-so would
            // stop another session's agent mid-turn.
            Some(connection) => reply(
                id,
                at,
                "close-failed",
                host.close_connection(connection).await,
            ),
            None => {
                host.shutdown().await;
                encode_ok(id, at, json!({ "status": "shutting-down" }))
            }
        },
        other => encode_error(id, at, "unknown-method", format!("unknown method {other}")),
    }
}

fn parse<T: serde::de::DeserializeOwned>(frame: &RequestFrame) -> Result<T, String> {
    serde_json::from_value(frame.params.clone()).map_err(|error| error.to_string())
}

fn reply(
    id: u32,
    connection: Option<u64>,
    code: &str,
    outcome: anyhow::Result<serde_json::Value>,
) -> Result<String, String> {
    match outcome {
        Ok(value) => encode_ok(id, connection, value),
        Err(error) => encode_error(id, connection, code, error.to_string()),
    }
}
