//! Newline-delimited JSON driver for the persistent ACP host.
//!
//! Reads [`wire::RequestFrame`] lines from stdin and writes replies and
//! unsolicited events to stdout, one JSON object per line.
//!
//! # Why requests are dispatched concurrently
//!
//! `session.prompt` does not resolve until the agent finishes its turn, and the
//! agent may block that turn on `session/request_permission`. The answer to that
//! arrives as a *later* `permission.decide` request on the same stdin. Handling
//! requests one at a time would therefore deadlock on the first permission
//! prompt: the host would be waiting for a decision it refuses to read.
//!
//! # Why one writer owns stdout
//!
//! Replies and events share stdout *and* the queue that feeds it. Sharing the
//! queue is what orders them: an event caused by an agent notification that
//! preceded a call's response must reach the caller first, and separate queues
//! let the reply overtake it. Encoding each frame fully before it is queued is
//! what keeps two concurrent tasks from interleaving halves of two JSON objects.

use std::collections::HashMap;
use std::process::ExitCode;
use std::sync::Arc;

use harness_acp_host::connection::{AgentConnection, EVENT_CHANNEL_CAPACITY, EventSink, Outbound};
use harness_acp_host::wire::{
    Call, EventFrame, HOST_PROTOCOL_VERSION, ResponseFrame, encode_frame,
};
use serde_json::json;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::sync::{Mutex, mpsc};

/// Live connections, keyed by the id the caller chose.
type Registry = Arc<Mutex<HashMap<String, Arc<AgentConnection>>>>;

#[tokio::main]
async fn main() -> ExitCode {
    let (events, outbound) = EventSink::new(EVENT_CHANNEL_CAPACITY);
    let mut writer_task = tokio::spawn(write_outbound(outbound));
    let registry: Registry = Arc::new(Mutex::new(HashMap::new()));

    let exit = read_requests(registry.clone(), events.clone()).await;

    // Drop every connection before returning so each agent's process group is
    // collected while this process is still alive to do it.
    registry.lock().await.clear();
    drop(events);
    let _ = (&mut writer_task).await;
    exit
}

/// Own stdout on one task, encoding events and forwarding already encoded replies.
async fn write_outbound(mut outbound: mpsc::Receiver<Outbound>) {
    let mut stdout = tokio::io::stdout();
    while let Some(item) = outbound.recv().await {
        let line = match item {
            Outbound::Reply(line) => line,
            Outbound::Event(event) => match encode_frame(&EventFrame::new(event)) {
                Ok(line) => line,
                Err(error) => {
                    // An event too large to encode is dropped rather than killing
                    // a healthy run: the caller loses one frame, not the session.
                    eprintln!("[acp-host] dropped an unencodable event: {error}");
                    continue;
                }
            },
        };
        if stdout.write_all(line.as_bytes()).await.is_err() {
            // The caller closed the pipe; further frames have nowhere to go.
            break;
        }
        let _ = stdout.flush().await;
    }
}

/// Read and dispatch request frames until stdin ends or `shutdown` arrives.
async fn read_requests(registry: Registry, events: EventSink) -> ExitCode {
    let lines = events.outbound();
    let mut stdin = BufReader::new(tokio::io::stdin()).lines();
    loop {
        let line = match stdin.next_line().await {
            Ok(Some(line)) => line,
            Ok(None) => return ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("[acp-host] stdin read failed: {error}");
                return ExitCode::FAILURE;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        let frame = match harness_acp_host::wire::parse_request_frame(&line) {
            Ok(frame) => frame,
            Err(error) => {
                // The envelope itself could not be trusted, so there is no
                // reliable id to answer and no way to know where the caller's
                // intent was truncated. Stop rather than guess.
                eprintln!("[acp-host] {error}");
                return ExitCode::FAILURE;
            }
        };
        let call = match Call::from_frame(&frame) {
            Ok(call) => call,
            Err(error) => {
                let _ = lines
                    .send(Outbound::Reply(fail(
                        frame.id,
                        error.code(),
                        error.to_string(),
                    )))
                    .await;
                continue;
            }
        };
        if matches!(call, Call::Shutdown) {
            let _ = lines
                .send(Outbound::Reply(ok(
                    frame.id,
                    json!({ "status": "shutting-down" }),
                )))
                .await;
            return ExitCode::SUCCESS;
        }
        // Concurrent by necessity: see the module note on deadlock.
        tokio::spawn(dispatch(frame.id, call, registry.clone(), events.clone()));
    }
}

async fn dispatch(id: u32, call: Call, registry: Registry, events: EventSink) {
    let lines = events.outbound();
    let reply = match run_call(call, &registry, &events).await {
        Ok(result) => ok(id, result),
        Err(error) => fail(id, "call-failed", error.to_string()),
    };
    let _ = lines.send(Outbound::Reply(reply)).await;
}

async fn run_call(
    call: Call,
    registry: &Registry,
    events: &EventSink,
) -> anyhow::Result<serde_json::Value> {
    match call {
        Call::HostDescribe => Ok(json!({
            "host": env!("CARGO_PKG_NAME"),
            "version": env!("CARGO_PKG_VERSION"),
            "protocol": HOST_PROTOCOL_VERSION,
        })),
        Call::ConnectionOpen(params) => {
            // Reopening an id reuses the live agent instead of spawning a
            // second one, which is what makes the id a stable handle.
            if let Some(existing) = registry.lock().await.get(&params.connection_id) {
                return Ok(json!({
                    "connectionId": existing.id(),
                    "reused": true,
                    "agentCapabilities": existing.initialization()["agentCapabilities"],
                    "authMethods": existing.initialization()["authMethods"],
                    "allowRoots": existing.fence().roots(),
                }));
            }
            let connection = Arc::new(AgentConnection::open(&params, events.clone()).await?);
            let roots = connection.fence().roots().to_vec();
            let initialized = connection.initialization();
            registry
                .lock()
                .await
                .insert(params.connection_id.clone(), connection);
            Ok(json!({
                "connectionId": params.connection_id,
                "reused": false,
                "agentCapabilities": initialized["agentCapabilities"],
                "authMethods": initialized["authMethods"],
                "allowRoots": roots,
            }))
        }
        Call::ConnectionClose(params) => {
            // Removing the last handle drops the driver task, which closes the
            // transport and lets AcpAgent reap the child's process group.
            let removed = registry.lock().await.remove(&params.connection_id);
            Ok(json!({ "closed": removed.is_some() }))
        }
        Call::SessionList(params) => {
            connection_for(registry, &params.connection_id).await?.list_sessions(params.cwd, params.cursor).await
        }
        Call::ConnectionAuthenticate(params) => {
            connection_for(registry, &params.connection_id).await?.authenticate(&params.method_id).await
        }
        Call::SessionCreate(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            let session_id = match &params.recovery { Some(recovery) => connection.recover_session(&params.cwd, recovery).await?, None => connection.create_session(&params.cwd).await? };
            Ok(json!({ "sessionId": session_id }))
        }
        Call::SessionClose(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            connection.close_session(&params.session_id).await?;
            Ok(json!({ "closed": true }))
        }
        Call::SessionSetConfigOption(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            let mut result = connection
                .set_config_option(&params.session_id, &params.config_id, &params.value)
                .await?;
            result["configId"] = json!(params.config_id);
            result["acknowledged"] = json!(true);
            Ok(result)
        }
        Call::SessionSetMode(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            connection.set_mode(&params.session_id, &params.mode_id).await
        }
        Call::SessionPrompt(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            let stop_reason = if let Some(content) = params.content {
                connection.prompt_content(&params.session_id, serde_json::from_value(content)?, events).await?
            } else {
                connection.prompt(&params.session_id, &params.prompt, events).await?
            };
            Ok(json!({ "stopReason": stop_reason }))
        }
        Call::SessionCancel(params) => {
            let connection = connection_for(registry, &params.connection_id).await?;
            connection.cancel(&params.session_id)?;
            Ok(json!({ "status": "cancelling" }))
        }
        Call::PermissionDecide(params) => {
            // The request id is unique across connections, so the decision is
            // routed by searching for its owner rather than making the caller
            // repeat which connection raised it.
            let connections: Vec<Arc<AgentConnection>> =
                registry.lock().await.values().cloned().collect();
            for connection in connections {
                if connection
                    .permissions()
                    .decide(&params.request_id, params.option_id.as_deref())
                    .is_ok()
                {
                    return Ok(json!({ "requestId": params.request_id, "decided": true }));
                }
            }
            Err(anyhow::anyhow!(
                "no permission request is pending for this id"
            ))
        }
        Call::Shutdown => Ok(json!({ "status": "shutting-down" })),
    }
}

async fn connection_for(
    registry: &Registry,
    connection_id: &str,
) -> anyhow::Result<Arc<AgentConnection>> {
    registry
        .lock()
        .await
        .get(connection_id)
        .cloned()
        .ok_or_else(|| anyhow::anyhow!("unknown connection"))
}

/// Encode a success reply, degrading to an error frame if encoding fails.
fn ok(id: u32, result: serde_json::Value) -> String {
    encode_frame(&ResponseFrame::ok(id, result)).unwrap_or_else(|error| {
        // A result over the frame ceiling still owes the caller an answer, or it
        // would wait on a reply that can never arrive.
        encode_frame(&ResponseFrame::failed(
            id,
            "frame-too-large",
            error.to_string(),
        ))
        .unwrap_or_else(|_| format!("{{\"version\":1,\"id\":{id}}}\n"))
    })
}

fn fail(id: u32, code: &str, message: String) -> String {
    encode_frame(&ResponseFrame::failed(id, code, message))
        .unwrap_or_else(|_| format!("{{\"version\":1,\"id\":{id}}}\n"))
}
