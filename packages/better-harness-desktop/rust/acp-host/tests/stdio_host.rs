//! End-to-end checks against the built `harness-acp-host` binary.
//!
//! These drive the real process over its real stdio contract, which is the only
//! place the concurrency requirement is observable: `session.prompt` does not
//! return until the agent's turn ends, and the agent blocks that turn on a
//! permission request whose answer arrives as a *later* line on the same stdin.
//! A host that handled requests one at a time would deadlock here, and no
//! in-process test of the library would notice.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

const STEP_TIMEOUT: Duration = Duration::from_secs(30);

fn repository_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(4)
        .expect("the crate is nested four levels below the repository root")
        .to_path_buf()
}

fn fixture_agent() -> PathBuf {
    let path = repository_root()
        .join("packages")
        .join("harness")
        .join("test")
        .join("fixtures")
        .join("acp-agent.mjs");
    assert!(
        path.is_file(),
        "the shared ACP fixture is missing at {}",
        path.display()
    );
    path
}

/// A running host process with framed access to its stdio.
struct Host {
    child: Child,
    stdin: ChildStdin,
    stdout: Lines<BufReader<ChildStdout>>,
    next_id: u32,
}

impl Host {
    fn start() -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_harness-acp-host"))
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .expect("the host binary should start");
        let stdin = child.stdin.take().expect("stdin was piped");
        let stdout = BufReader::new(child.stdout.take().expect("stdout was piped")).lines();
        Self {
            child,
            stdin,
            stdout,
            next_id: 0,
        }
    }

    /// Write one request without waiting for its reply.
    ///
    /// Separating the write from the read is the whole point: a caller must be
    /// able to have a prompt outstanding while sending the decision that
    /// unblocks it.
    async fn send(&mut self, method: &str, params: Value) -> u32 {
        self.next_id += 1;
        let id = self.next_id;
        let line = format!(
            "{}\n",
            json!({ "version": 1, "id": id, "method": method, "params": params })
        );
        self.stdin
            .write_all(line.as_bytes())
            .await
            .expect("the host should accept a request");
        self.stdin.flush().await.expect("the request should flush");
        id
    }

    /// Read frames until one is the reply to `id`, collecting events seen on the way.
    async fn reply(&mut self, id: u32, events: &mut Vec<Value>) -> Value {
        tokio::time::timeout(STEP_TIMEOUT, async {
            loop {
                let frame = self.frame().await;
                match frame.get("id").and_then(Value::as_u64) {
                    Some(seen) if seen == u64::from(id) => return frame,
                    // Replies to other outstanding requests are not this call's
                    // business, but events are worth handing back.
                    Some(_) => continue,
                    None => events.push(frame),
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for the reply to request {id}"))
    }

    /// Read frames until an event of the given type arrives.
    async fn event(&mut self, event_type: &str) -> Value {
        tokio::time::timeout(STEP_TIMEOUT, async {
            loop {
                let frame = self.frame().await;
                if frame.get("id").is_some() {
                    continue;
                }
                if frame["event"]["type"] == event_type {
                    return frame;
                }
            }
        })
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for a {event_type} event"))
    }

    async fn frame(&mut self) -> Value {
        let line = self
            .stdout
            .next_line()
            .await
            .expect("reading the host's stdout should succeed")
            .expect("the host closed stdout before answering");
        serde_json::from_str(&line)
            .unwrap_or_else(|error| panic!("the host emitted a non-JSON line {line:?}: {error}"))
    }

    async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.send(method, params).await;
        let mut ignored = Vec::new();
        self.reply(id, &mut ignored).await
    }

    async fn open_fixture(&mut self, connection_id: &str) -> String {
        let opened = self
            .call(
                "connection.open",
                json!({
                    "connectionId": connection_id,
                    "command": "node",
                    "args": [fixture_agent().to_string_lossy()],
                }),
            )
            .await;
        assert_eq!(
            opened["result"]["reused"], false,
            "a fresh id should spawn an agent, got {opened}"
        );
        let created = self
            .call(
                "session.create",
                json!({ "connectionId": connection_id, "cwd": repository_root() }),
            )
            .await;
        created["result"]["sessionId"]
            .as_str()
            .unwrap_or_else(|| panic!("session.create should return an id, got {created}"))
            .to_owned()
    }
}

impl Drop for Host {
    fn drop(&mut self) {
        let _ = self.child.start_kill();
    }
}

#[tokio::test(flavor = "multi_thread")]
async fn answers_a_permission_request_that_arrives_while_a_prompt_is_outstanding() {
    let mut host = Host::start();
    let session_id = host.open_fixture("c1").await;

    // Prompt stays outstanding on purpose. The fixture will not finish the turn
    // until the decision below is read, so a serial dispatcher deadlocks here.
    let prompt_id = host
        .send(
            "session.prompt",
            json!({ "connectionId": "c1", "sessionId": session_id, "prompt": "hello" }),
        )
        .await;

    let requested = host.event("permission-requested").await;
    let request_id = requested["event"]["requestId"]
        .as_str()
        .expect("the event should carry a request id")
        .to_owned();
    let decided = host
        .call(
            "permission.decide",
            json!({ "requestId": request_id, "optionId": "allow-once" }),
        )
        .await;
    assert_eq!(decided["result"]["decided"], true, "got {decided}");

    let mut events = Vec::new();
    let finished = host.reply(prompt_id, &mut events).await;
    assert_eq!(
        finished["result"]["stopReason"], "end_turn",
        "the turn should complete once the decision is delivered, got {finished}"
    );

    let shutdown = host.call("shutdown", Value::Null).await;
    assert_eq!(shutdown["result"]["status"], "shutting-down");
}

#[tokio::test(flavor = "multi_thread")]
async fn reuses_a_connection_id_instead_of_spawning_a_second_agent() {
    let mut host = Host::start();
    host.open_fixture("c1").await;
    let reopened = host
        .call(
            "connection.open",
            json!({
                "connectionId": "c1",
                "command": "node",
                "args": [fixture_agent().to_string_lossy()],
            }),
        )
        .await;
    assert_eq!(
        reopened["result"]["reused"], true,
        "a known id must be a stable handle, not a second process, got {reopened}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_host_identity_without_touching_an_agent() {
    let mut host = Host::start();
    let described = host.call("host.describe", Value::Null).await;
    assert_eq!(described["result"]["host"], "harness-acp-host");
    assert_eq!(
        described["result"]["protocol"], "acp-rust-2.0.0+jsonl-v1",
        "the version stamp is what a receipt records, got {described}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn grants_no_filesystem_root_unless_one_was_requested() {
    let mut host = Host::start();
    let opened = host
        .call(
            "connection.open",
            json!({
                "connectionId": "c1",
                "command": "node",
                "args": [fixture_agent().to_string_lossy()],
            }),
        )
        .await;
    assert_eq!(
        opened["result"]["allowRoots"],
        json!([]),
        "an omitted allowRoots must not widen access, got {opened}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn canonicalizes_the_roots_it_reports_back() {
    let mut host = Host::start();
    let root = repository_root();
    let opened = host
        .call(
            "connection.open",
            json!({
                "connectionId": "c1",
                "command": "node",
                "args": [fixture_agent().to_string_lossy()],
                "allowRoots": [root.join("packages").join("..")],
            }),
        )
        .await;
    let reported = opened["result"]["allowRoots"]
        .as_array()
        .expect("allowRoots should be an array");
    assert_eq!(reported.len(), 1, "got {opened}");
    assert_eq!(
        PathBuf::from(reported[0].as_str().expect("a path string")),
        std::fs::canonicalize(&root).expect("the repository root should canonicalize"),
        "a traversal in a granted root must be collapsed before it is recorded"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_an_unknown_method_without_exiting() {
    let mut host = Host::start();
    let refused = host.call("session.teleport", Value::Null).await;
    assert_eq!(refused["error"]["code"], "unknown-method", "got {refused}");
    // Still usable: an unknown method is the caller's mistake, not a fault that
    // should cost the whole host and every connection it holds.
    let described = host.call("host.describe", Value::Null).await;
    assert_eq!(described["result"]["host"], "harness-acp-host");
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_decision_for_an_unknown_request() {
    let mut host = Host::start();
    let refused = host
        .call(
            "permission.decide",
            json!({ "requestId": "never-issued", "optionId": "allow-once" }),
        )
        .await;
    assert_eq!(refused["error"]["code"], "call-failed", "got {refused}");
}

#[tokio::test(flavor = "multi_thread")]
async fn shutdown_reaps_the_agent_and_exits_without_an_external_kill() {
    let mut host = Host::start();
    host.open_fixture("c1").await;

    let shutdown = host.call("shutdown", Value::Null).await;
    assert_eq!(shutdown["result"]["status"], "shutting-down");
    // Stop holding stdin, exactly as the Node client does after receiving the
    // acknowledgement. The host must then drop its connection driver, reap the
    // agent process group, close the event queue, and let the writer finish.
    host.stdin.shutdown().await.expect("stdin should close");
    let status = tokio::time::timeout(STEP_TIMEOUT, host.child.wait())
        .await
        .expect("shutdown must not leave the host waiting on an EventSink clone")
        .expect("waiting on the host should succeed");
    assert!(
        status.success(),
        "graceful shutdown should exit 0, got {status}"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn exits_when_a_frame_from_another_envelope_generation_arrives() {
    let mut host = Host::start();
    host.stdin
        .write_all(b"{\"version\":2,\"id\":1,\"method\":\"shutdown\"}\n")
        .await
        .expect("the host should accept the bytes");
    host.stdin.flush().await.expect("the frame should flush");
    let status = tokio::time::timeout(STEP_TIMEOUT, host.child.wait())
        .await
        .expect("the host should exit rather than hang")
        .expect("waiting on the host should succeed");
    assert!(
        !status.success(),
        "an untrusted envelope must fail the process instead of being absorbed"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_the_agent_stderr_when_the_handshake_never_completes() {
    // The failure a misconfigured agent actually produces: it rejects its own
    // configuration, writes the reason to stderr, and exits before answering
    // `initialize`. Reporting only the closed transport would leave the reader
    // with a symptom and no cause.
    let mut host = Host::start();
    let refused = host
        .call(
            "connection.open",
            json!({
                "connectionId": "broken",
                "command": "node",
                "args": [
                    "-e",
                    "process.stderr.write('error loading config: config.toml:10:16: unknown variant `default`\\n'); process.exit(1);",
                ],
            }),
        )
        .await;
    assert_eq!(refused["error"]["code"], "call-failed", "got {refused}");
    let message = refused["error"]["message"]
        .as_str()
        .unwrap_or_else(|| panic!("a failed open should carry a message, got {refused}"));
    assert!(
        message.contains("unknown variant `default`"),
        "the agent's own stderr must reach the caller, got {message:?}"
    );
}
