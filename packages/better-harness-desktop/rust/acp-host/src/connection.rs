//! Persistent ACP connections.
//!
//! One [`AgentConnection`] owns one agent subprocess and lives across many
//! prompt turns, which is the whole point of this host: the previous Node
//! executor tore the agent down after a single `session/prompt`.
//!
//! # Process lifetime
//!
//! Reaping is **not** implemented here. `AcpAgent` already spawns the child into
//! its own process group and kills that group when its guard drops, so holding
//! the driver task is what keeps the agent alive and dropping it is what
//! collects the agent and any grandchildren it left behind.
//!
//! # Where work runs
//!
//! Registered handlers execute on the connection's event loop, so the loop
//! cannot read the next message while a handler is awaiting. That is fine for
//! the notification handler, which only folds an update into memory, but wrong
//! for permission: it waits on a human. Permission therefore hands off to a
//! detached task and answers from there, leaving the loop free.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};

use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::schema::v1::{
    CancelNotification, ClientCapabilities, ContentBlock, CreateTerminalRequest,
    FileSystemCapabilities, Implementation, InitializeRequest, KillTerminalRequest,
    NewSessionRequest, PromptRequest, ReadTextFileRequest, ReleaseTerminalRequest,
    RequestPermissionOutcome, RequestPermissionRequest, RequestPermissionResponse,
    SelectedPermissionOutcome, SessionConfigKind, SessionConfigOptionValue, SessionNotification,
    SessionUpdate, SetSessionConfigOptionRequest, TerminalOutputRequest, TextContent,
    WaitForTerminalExitRequest, WriteTextFileRequest,
};
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo, LineDirection};
use anyhow::{Context, Result, anyhow};
use tokio::sync::{mpsc, oneshot};

use crate::fence::Fence;
use crate::redact::redact;
use crate::services::ClientServices;
use crate::thread::{self, Change, ChunkKind, Thread};
use crate::wire::{
    ConfigOptionValue, ConnectionOpenParams, FrameDirection, HostEvent, PermissionOption,
    TurnStatus,
};

/// Client identity reported in `initialize`.
const CLIENT_NAME: &str = "better-harness-acp-host";

/// Bound on buffered host events.
///
/// Deliberately finite, unlike Zed's foreground dispatch queue whose own
/// comments note the missing backpressure. When this fills, the notification
/// handler stops draining the agent's stdout, which throttles the agent instead
/// of letting the host grow without limit.
pub const EVENT_CHANNEL_CAPACITY: usize = 4096;

/// Anything the host writes to stdout.
///
/// Events and replies share one queue on purpose. An event is caused by an agent
/// notification that arrived *before* the response completing a call, so the
/// event must reach stdout first. Routing them through separate queues let a
/// reply overtake the event that preceded it: `session.prompt` answered
/// `end_turn` while the assistant text was still one hop behind, and the caller
/// closed the run with an empty output. One queue makes the ordering structural
/// instead of a race the writer happens to win.
#[derive(Debug)]
pub enum Outbound {
    Event(HostEvent),
    /// An already encoded reply line, including its trailing newline.
    Reply(String),
}

/// Bounded outlet for host events.
#[derive(Clone)]
pub struct EventSink {
    sender: mpsc::Sender<Outbound>,
}

impl EventSink {
    pub fn new(capacity: usize) -> (Self, mpsc::Receiver<Outbound>) {
        let (sender, receiver) = mpsc::channel(capacity);
        (Self { sender }, receiver)
    }

    /// The shared queue, so replies can be ordered against events.
    pub fn outbound(&self) -> mpsc::Sender<Outbound> {
        self.sender.clone()
    }

    /// Queue one event, waiting for room if the channel is full.
    ///
    /// A closed channel means the writer is gone and the host is shutting down,
    /// so the event is dropped rather than treated as a failure.
    pub async fn send(&self, event: HostEvent) {
        let _ = self.sender.send(Outbound::Event(event)).await;
    }

    /// Queue one event from a synchronous context, dropping it if there is no room.
    ///
    /// The transport tap is a plain `Fn` callback on the crate's read path, so it
    /// cannot await. Blocking there would stall the agent's stdout. Evidence
    /// frames are already capped downstream, so shedding them under pressure is
    /// the established contract; the transcript never travels this way.
    pub fn try_send(&self, event: HostEvent) -> bool {
        self.sender.try_send(Outbound::Event(event)).is_ok()
    }
}

/// A permission request the agent is blocked on.
struct PendingPermission {
    /// Options the agent offered. A decision naming anything else is refused,
    /// because the host must not invent an outcome the agent cannot interpret.
    option_ids: HashSet<String>,
    responder: oneshot::Sender<Option<String>>,
}

/// Outstanding permission requests across one connection's sessions.
#[derive(Clone, Default)]
pub struct PermissionStore {
    pending: Arc<Mutex<HashMap<String, PendingPermission>>>,
}

impl PermissionStore {
    fn register(
        &self,
        request_id: String,
        option_ids: HashSet<String>,
    ) -> oneshot::Receiver<Option<String>> {
        let (responder, receiver) = oneshot::channel();
        self.pending.lock().expect("permission store").insert(
            request_id,
            PendingPermission {
                option_ids,
                responder,
            },
        );
        receiver
    }

    /// Answer a pending request.
    ///
    /// Removing the entry is what makes a decision single-use: a second call for
    /// the same id finds nothing and reports it, rather than racing the first.
    pub fn decide(&self, request_id: &str, option_id: Option<&str>) -> Result<()> {
        let mut pending = self.pending.lock().expect("permission store");
        let entry = pending
            .get(request_id)
            .ok_or_else(|| anyhow!("no permission request is pending for this id"))?;
        if let Some(option_id) = option_id
            && !entry.option_ids.contains(option_id)
        {
            return Err(anyhow!(
                "optionId must name one of the options the agent offered"
            ));
        }
        let entry = pending
            .remove(request_id)
            .expect("entry was present under this lock");
        drop(pending);
        // A dropped receiver means the turn already ended; the decision is moot
        // rather than an error worth surfacing to the caller.
        let _ = entry.responder.send(option_id.map(str::to_owned));
        Ok(())
    }

    /// Cancel everything still pending, used when a connection goes away.
    fn cancel_all(&self) -> Vec<String> {
        let mut pending = self.pending.lock().expect("permission store");
        pending
            .drain()
            .map(|(request_id, entry)| {
                let _ = entry.responder.send(None);
                request_id
            })
            .collect()
    }
}

/// Per-session transcripts for one connection.
type SharedThreads = Arc<Mutex<HashMap<String, Thread>>>;

/// One live ACP connection.
pub struct AgentConnection {
    id: String,
    connection: ConnectionTo<Agent>,
    services: ClientServices,
    permissions: PermissionStore,
    threads: SharedThreads,
    /// Holding this task holds the agent process. `Drop` explicitly aborts it;
    /// dropping a Tokio JoinHandle alone only detaches and would leak both the
    /// Agent and the EventSink clone that keeps the stdout writer alive.
    driver: tokio::task::JoinHandle<()>,
}

impl AgentConnection {
    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn fence(&self) -> &Fence {
        self.services.fence()
    }

    pub fn permissions(&self) -> &PermissionStore {
        &self.permissions
    }

    /// Spawn an agent and complete the ACP handshake.
    pub async fn open(params: &ConnectionOpenParams, events: EventSink) -> Result<Self> {
        let id = params.connection_id.clone();
        let services = ClientServices::new(Fence::new(&params.allow_roots));
        let permissions = PermissionStore::default();
        let threads: SharedThreads = Arc::new(Mutex::new(HashMap::new()));

        let agent = AcpAgent::new(
            AcpAgentConfig::new(params.command.clone())
                .args(params.args.clone())
                .envs(params.env.clone()),
        )
        .with_debug({
            // The crate hands every transport line to this callback, which is the
            // only place raw JSON-RPC is observable. Retaining it here keeps the
            // evidence trace identical in shape to the Node executor's.
            let tap = events.clone();
            let tapped_connection = id.clone();
            move |line: &str, direction: LineDirection| {
                if let Some(event) = protocol_frame(&tapped_connection, line, direction) {
                    tap.try_send(event);
                }
            }
        });

        let (connection_tx, connection_rx) = oneshot::channel();
        let notification_state = (id.clone(), threads.clone(), events.clone());
        let permission_state = (id.clone(), permissions.clone(), events.clone());
        let read_services = services.clone();
        let write_services = services.clone();
        let create_terminal_services = services.clone();
        let output_services = services.clone();
        let kill_terminal_services = services.clone();
        let release_terminal_services = services.clone();
        let wait_terminal_services = services.clone();
        let lost_state = (id.clone(), permissions.clone(), events.clone());

        let driver = tokio::spawn(async move {
            let (notification_id, notification_threads, notification_events) = notification_state;
            let (permission_id, permission_store, permission_events) = permission_state;
            let outcome = Client
                .builder()
                .on_receive_request(
                    async move |request: ReadTextFileRequest, responder, _connection| {
                        let services = read_services.clone();
                        tokio::spawn(async move {
                            match services.read_text_file(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: WriteTextFileRequest, responder, _connection| {
                        let services = write_services.clone();
                        tokio::spawn(async move {
                            match services.write_text_file(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: CreateTerminalRequest, responder, _connection| {
                        let services = create_terminal_services.clone();
                        tokio::spawn(async move {
                            match services.create_terminal(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: TerminalOutputRequest, responder, _connection| {
                        let services = output_services.clone();
                        tokio::spawn(async move {
                            match services.terminal_output(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: KillTerminalRequest, responder, _connection| {
                        let services = kill_terminal_services.clone();
                        tokio::spawn(async move {
                            match services.kill_terminal(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: ReleaseTerminalRequest, responder, _connection| {
                        let services = release_terminal_services.clone();
                        tokio::spawn(async move {
                            match services.release_terminal(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_request(
                    async move |request: WaitForTerminalExitRequest, responder, _connection| {
                        let services = wait_terminal_services.clone();
                        tokio::spawn(async move {
                            match services.wait_for_terminal_exit(request).await {
                                Ok(response) => {
                                    let _ = responder.respond(response);
                                }
                                Err(error) => {
                                    let _ = responder.respond_with_error(error);
                                }
                            }
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .on_receive_notification(
                    async move |notification: SessionNotification, _connection| {
                        apply_session_notification(
                            &notification_id,
                            &notification_threads,
                            &notification_events,
                            notification,
                        )
                        .await;
                        Ok(())
                    },
                    agent_client_protocol::on_receive_notification!(),
                )
                .on_receive_request(
                    async move |request: RequestPermissionRequest, responder, _connection| {
                        // Detached because this waits on a person. Answering
                        // inline would hold the event loop for the whole wait.
                        let connection_id = permission_id.clone();
                        let store = permission_store.clone();
                        let events = permission_events.clone();
                        tokio::spawn(async move {
                            let outcome =
                                await_permission(&connection_id, &store, &events, &request).await;
                            let _ = responder.respond(RequestPermissionResponse::new(outcome));
                        });
                        Ok(())
                    },
                    agent_client_protocol::on_receive_request!(),
                )
                .connect_with(agent, move |connection: ConnectionTo<Agent>| async move {
                    // Hand the connection out, then never return: returning here
                    // is what would close the transport, and this host exists to
                    // keep it open across turns.
                    let _ = connection_tx.send(connection);
                    futures::future::pending::<Result<(), agent_client_protocol::Error>>().await
                })
                .await;

            let (lost_id, lost_permissions, lost_events) = lost_state;
            // The agent is gone, so anything still waiting on it never will be
            // answered. Release those waiters before announcing the loss.
            for request_id in lost_permissions.cancel_all() {
                lost_events
                    .send(HostEvent::PermissionResolved {
                        request_id,
                        outcome: "cancelled".to_owned(),
                    })
                    .await;
            }
            lost_events
                .send(HostEvent::ConnectionLost {
                    connection_id: lost_id,
                    detail: outcome.err().map(|error| error.to_string()),
                })
                .await;
        });

        let connection = connection_rx
            .await
            .context("the ACP transport closed before it produced a connection")?;

        connection
            .send_request(
                InitializeRequest::new(ProtocolVersion::V1)
                    .client_capabilities(
                        ClientCapabilities::new()
                            .fs(FileSystemCapabilities::new()
                                .read_text_file(true)
                                .write_text_file(true))
                            .terminal(true),
                    )
                    .client_info(Implementation::new(CLIENT_NAME, env!("CARGO_PKG_VERSION"))),
            )
            .block_task()
            .await
            .map_err(|error| anyhow!("ACP initialize failed: {error}"))?;

        Ok(Self {
            id,
            connection,
            services,
            permissions,
            threads,
            driver,
        })
    }

    /// Create a session and start tracking its transcript.
    pub async fn create_session(&self, cwd: &std::path::Path) -> Result<String> {
        let response = self
            .connection
            .send_request(NewSessionRequest::new(cwd.to_path_buf()))
            .block_task()
            .await
            .map_err(|error| anyhow!("ACP session/new failed: {error}"))?;
        let session_id = response.session_id.0.to_string();
        self.threads
            .lock()
            .expect("threads")
            .insert(session_id.clone(), Thread::new());
        Ok(session_id)
    }

    /// Run one prompt turn. A connection serves any number of these.
    pub async fn prompt(
        &self,
        session_id: &str,
        prompt: &str,
        events: &EventSink,
    ) -> Result<String> {
        // Scoped so the guard is released before the first await below. A
        // std::sync guard held across an await would make this future non-Send
        // and could deadlock a task that re-enters the same lock.
        let known = {
            let threads = self.threads.lock().expect("threads");
            threads.contains_key(session_id)
        };
        if !known {
            return Err(anyhow!("unknown session"));
        }
        let change = self.with_thread(session_id, |thread| thread.push_user_message(prompt));
        self.announce(session_id, change, events).await;
        events
            .send(HostEvent::StatusChanged {
                connection_id: self.id.clone(),
                session_id: session_id.to_owned(),
                status: TurnStatus::Running,
                stop_reason: None,
            })
            .await;

        let response = self
            .connection
            .send_request(PromptRequest::new(
                session_id.to_owned(),
                vec![ContentBlock::Text(TextContent::new(prompt.to_owned()))],
            ))
            .block_task()
            .await;

        match response {
            Ok(response) => {
                let stop_reason = wire_name(&response.stop_reason);
                // The agent owes no final update for calls it abandoned, so
                // settle them here or the UI spins forever.
                let terminal = if stop_reason == "end_turn" {
                    thread::ToolCallStatus::Failed
                } else {
                    thread::ToolCallStatus::Canceled
                };
                // Collected under the lock, then awaited after releasing it: the
                // guard must not survive into the announce loop below.
                let settled = {
                    let mut threads = self.threads.lock().expect("threads");
                    threads
                        .get_mut(session_id)
                        .map(|thread| thread.settle_unfinished_tool_calls(terminal))
                        .unwrap_or_default()
                };
                for index in settled {
                    self.announce(session_id, Some(Change::Updated(index)), events)
                        .await;
                }
                events
                    .send(HostEvent::StatusChanged {
                        connection_id: self.id.clone(),
                        session_id: session_id.to_owned(),
                        status: TurnStatus::Stopped,
                        stop_reason: Some(stop_reason.clone()),
                    })
                    .await;
                Ok(stop_reason)
            }
            Err(error) => {
                events
                    .send(HostEvent::StatusChanged {
                        connection_id: self.id.clone(),
                        session_id: session_id.to_owned(),
                        status: TurnStatus::Failed,
                        stop_reason: None,
                    })
                    .await;
                Err(anyhow!("ACP session/prompt failed: {error}"))
            }
        }
    }

    /// Apply one session config option and confirm the agent took it.
    ///
    /// Acknowledgement is verified rather than assumed, preserving the contract
    /// the Node executor already enforced: an agent that silently ignores a
    /// requested model would otherwise produce a run whose receipt claims a
    /// setting the agent never honoured.
    pub async fn set_config_option(
        &self,
        session_id: &str,
        config_id: &str,
        value: &ConfigOptionValue,
    ) -> Result<()> {
        let requested = match value {
            ConfigOptionValue::Boolean(flag) => SessionConfigOptionValue::boolean(*flag),
            ConfigOptionValue::Text(text) => SessionConfigOptionValue::value_id(text.clone()),
        };
        let response = self
            .connection
            .send_request(SetSessionConfigOptionRequest::new(
                session_id.to_owned(),
                config_id.to_owned(),
                requested,
            ))
            .block_task()
            .await
            .map_err(|error| anyhow!("ACP session/set_config_option failed: {error}"))?;

        let reported = response
            .config_options
            .iter()
            .find(|option| option.id.0.as_ref() == config_id)
            .ok_or_else(|| anyhow!("the agent did not acknowledge session option '{config_id}'"))?;
        // The wire enum is non-exhaustive. A kind this host cannot read is not the
        // same failure as a refused option, and saying so keeps the caller from
        // chasing an agent bug that is really a schema gap here.
        let observed = match &reported.kind {
            SessionConfigKind::Boolean(boolean) => {
                ConfigOptionValue::Boolean(boolean.current_value)
            }
            SessionConfigKind::Select(select) => {
                ConfigOptionValue::Text(select.current_value.0.to_string())
            }
            _ => {
                return Err(anyhow!(
                    "the agent reported session option '{config_id}' in a form this host cannot verify"
                ));
            }
        };
        if observed == *value {
            Ok(())
        } else {
            Err(anyhow!(
                "the agent did not acknowledge session option '{config_id}'"
            ))
        }
    }

    /// Ask the agent to abandon the in-flight turn.
    ///
    /// Notifications are fire-and-forget by protocol, so this returns as soon as
    /// the frame is queued; the turn ends when the agent's prompt response lands.
    pub fn cancel(&self, session_id: &str) -> Result<()> {
        self.connection
            .send_notification(CancelNotification::new(session_id.to_owned()))
            .map_err(|error| anyhow!("ACP session/cancel failed: {error}"))
    }

    /// Snapshot one session's transcript.
    pub fn entries(&self, session_id: &str) -> Option<Vec<thread::Entry>> {
        self.threads
            .lock()
            .expect("threads")
            .get(session_id)
            .map(|thread| thread.entries().to_vec())
    }

    fn with_thread<T>(&self, session_id: &str, apply: impl FnOnce(&mut Thread) -> T) -> Option<T> {
        self.threads
            .lock()
            .expect("threads")
            .get_mut(session_id)
            .map(apply)
    }

    async fn announce(&self, session_id: &str, change: Option<Change>, events: &EventSink) {
        let Some(change) = change else { return };
        announce_change(&self.id, session_id, &self.threads, change, events).await;
    }
}

impl Drop for AgentConnection {
    fn drop(&mut self) {
        // Tokio JoinHandle::drop detaches — it does not cancel. Detaching here
        // leaks the connection future, the agent process, and the EventSink
        // clone that keeps the stdout writer waiting forever on shutdown.
        self.driver.abort();
        self.permissions.cancel_all();
    }
}

/// Turn one transcript change into the matching host event.
async fn announce_change(
    connection_id: &str,
    session_id: &str,
    threads: &SharedThreads,
    change: Change,
    events: &EventSink,
) {
    let index = match change {
        Change::Appended(index) | Change::Updated(index) => index,
        Change::None => return,
    };
    let entry = threads
        .lock()
        .expect("threads")
        .get(session_id)
        .and_then(|thread| thread.entry(index).cloned());
    let Some(entry) = entry else { return };
    let payload = match serde_json::to_value(&entry) {
        Ok(payload) => payload,
        Err(_) => return,
    };
    let event = match change {
        Change::Appended(index) => HostEvent::EntryAppended {
            connection_id: connection_id.to_owned(),
            session_id: session_id.to_owned(),
            index,
            entry: payload,
        },
        Change::Updated(index) => HostEvent::EntryUpdated {
            connection_id: connection_id.to_owned(),
            session_id: session_id.to_owned(),
            index,
            entry: payload,
        },
        Change::None => return,
    };
    events.send(event).await;
}

/// Fold one `session/update` into the session's transcript.
async fn apply_session_notification(
    connection_id: &str,
    threads: &SharedThreads,
    events: &EventSink,
    notification: SessionNotification,
) {
    let session_id = notification.session_id.0.to_string();
    let change = {
        let mut guard = threads.lock().expect("threads");
        let Some(thread) = guard.get_mut(&session_id) else {
            // An update for a session this host never created has nowhere to go.
            return;
        };
        match notification.update {
            SessionUpdate::AgentMessageChunk(chunk) => {
                let Some(text) = block_text(&chunk.content) else {
                    return;
                };
                thread.push_agent_text(
                    ChunkKind::Message,
                    chunk.message_id.as_ref().map(|id| id.0.as_ref()),
                    text,
                )
            }
            SessionUpdate::AgentThoughtChunk(chunk) => {
                let Some(text) = block_text(&chunk.content) else {
                    return;
                };
                thread.push_agent_text(
                    ChunkKind::Thought,
                    chunk.message_id.as_ref().map(|id| id.0.as_ref()),
                    text,
                )
            }
            SessionUpdate::ToolCall(call) => thread.upsert_tool_call(thread::ToolCallUpdate {
                tool_call_id: call.tool_call_id.0.as_ref(),
                title: Some(call.title.as_str()),
                status: Some(map_tool_status(&call.status)),
                raw_input: call.raw_input.clone(),
                raw_output: call.raw_output.clone(),
            }),
            SessionUpdate::ToolCallUpdate(update) => {
                let title = update.fields.title.clone();
                thread.upsert_tool_call(thread::ToolCallUpdate {
                    tool_call_id: update.tool_call_id.0.as_ref(),
                    title: title.as_deref(),
                    status: update.fields.status.as_ref().map(map_tool_status),
                    raw_input: update.fields.raw_input.clone(),
                    raw_output: update.fields.raw_output.clone(),
                })
            }
            // Plan, usage, mode, and config updates are session-level rather
            // than transcript rows; they are reported once their owners exist.
            _ => Change::None,
        }
    };
    announce_change(connection_id, &session_id, threads, change, events).await;
}

/// Turn one raw transport line into a redacted protocol frame event.
///
/// Returns `None` for stderr and for anything that is not a JSON-RPC object, so
/// agent logging never enters the evidence trace as if it were protocol.
fn protocol_frame(connection_id: &str, line: &str, direction: LineDirection) -> Option<HostEvent> {
    let direction = match direction {
        LineDirection::Stdin => FrameDirection::ClientToAgent,
        LineDirection::Stdout => FrameDirection::AgentToClient,
        // Stderr is diagnostics, not protocol.
        _ => return None,
    };
    let parsed: serde_json::Value = serde_json::from_str(line.trim()).ok()?;
    let object = parsed.as_object()?;
    let rpc_id = object.get("id").map(|id| match id {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    });
    // A frame with no method is a response. Naming it after the request it
    // answers would need correlation state on the read path, so it is reported
    // plainly and the rpc id is what pairs the two.
    let method = object
        .get("method")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("response")
        .to_owned();
    let session_id = object
        .get("params")
        .and_then(serde_json::Value::as_object)
        .and_then(|params| params.get("sessionId"))
        .and_then(serde_json::Value::as_str)
        .map(str::to_owned);
    Some(HostEvent::ProtocolFrame {
        connection_id: connection_id.to_owned(),
        direction,
        method,
        rpc_id,
        session_id,
        // Redacted before it leaves this function, so no caller can forget.
        payload: redact(parsed),
    })
}

/// Render a protocol enum using its own wire spelling.
///
/// `Debug` is not a substitute: it would turn `EndTurn` into `endturn` while the
/// protocol, and therefore every consumer downstream of this host, says
/// `end_turn`. Serializing asks the schema what the value is called.
fn wire_name<T: serde::Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(serde_json::Value::String(name)) => name,
        // Non-string variants carry data; fall back to a compact rendering
        // rather than inventing a name for them.
        Ok(other) => other.to_string(),
        Err(_) => String::new(),
    }
}

/// Extract renderable text, if this block carries any.
fn block_text(block: &ContentBlock) -> Option<&str> {
    match block {
        ContentBlock::Text(text) => Some(text.text.as_str()),
        _ => None,
    }
}

fn map_tool_status(
    status: &agent_client_protocol::schema::v1::ToolCallStatus,
) -> thread::ToolCallStatus {
    use agent_client_protocol::schema::v1::ToolCallStatus as Wire;
    match status {
        Wire::Pending => thread::ToolCallStatus::Pending,
        Wire::InProgress => thread::ToolCallStatus::InProgress,
        Wire::Completed => thread::ToolCallStatus::Completed,
        Wire::Failed => thread::ToolCallStatus::Failed,
        // The wire enum may grow; an unrecognised status is still in flight
        // rather than silently terminal.
        _ => thread::ToolCallStatus::InProgress,
    }
}

/// Publish a permission request and wait for the host runtime to answer it.
async fn await_permission(
    connection_id: &str,
    store: &PermissionStore,
    events: &EventSink,
    request: &RequestPermissionRequest,
) -> RequestPermissionOutcome {
    let request_id = uuid::Uuid::new_v4().to_string();
    let option_ids: HashSet<String> = request
        .options
        .iter()
        .map(|option| option.option_id.0.to_string())
        .collect();
    let receiver = store.register(request_id.clone(), option_ids);
    let session_id = request.session_id.0.to_string();
    let tool_call_id = request.tool_call.tool_call_id.0.to_string();
    events
        .send(HostEvent::PermissionRequested {
            connection_id: connection_id.to_owned(),
            session_id: session_id.clone(),
            request_id: request_id.clone(),
            tool_call_id,
            title: request
                .tool_call
                .fields
                .title
                .clone()
                .unwrap_or_else(|| "Agent action".to_owned()),
            options: request
                .options
                .iter()
                .map(|option| PermissionOption {
                    option_id: option.option_id.0.to_string(),
                    name: option.name.clone(),
                    kind: wire_name(&option.kind),
                })
                .collect(),
        })
        .await;

    // No timeout: a permission prompt waits for a person. Timing out would let
    // an agent silently proceed differently than the user intended.
    let decision = receiver.await.unwrap_or(None);
    let outcome = match &decision {
        Some(option_id) => {
            RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(option_id.clone()))
        }
        None => RequestPermissionOutcome::Cancelled,
    };
    events
        .send(HostEvent::PermissionResolved {
            request_id,
            outcome: decision.unwrap_or_else(|| "cancelled".to_owned()),
        })
        .await;
    outcome
}
