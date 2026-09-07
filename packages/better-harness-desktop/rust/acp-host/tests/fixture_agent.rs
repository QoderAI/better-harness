//! Cross-implementation checks against the shared ACP fixture agent.
//!
//! These run this Rust client against `packages/harness/test/fixtures/acp-agent.mjs`,
//! the same TypeScript fixture the Node executor's tests use. That is deliberate:
//! a fixture written in Rust would only confirm this crate agrees with itself,
//! while the actual risk is that our client and an independent agent
//! implementation disagree about the handshake or the update stream.
//!
//! The fixture blocks every prompt on `session/request_permission`, so each test
//! also exercises the permission round trip whether or not that is its subject.

use std::path::PathBuf;
use std::time::Duration;

use harness_acp_host::connection::{AgentConnection, EVENT_CHANNEL_CAPACITY, EventSink};
use harness_acp_host::thread::Entry;
use harness_acp_host::wire::{ConnectionOpenParams, HostEvent, TurnStatus};
use tokio::sync::mpsc::Receiver;

/// Bound every wait so a hung agent fails the test instead of the whole suite.
const STEP_TIMEOUT: Duration = Duration::from_secs(30);

fn repository_root() -> PathBuf {
    // The crate sits at packages/better-harness-desktop/rust/acp-host.
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
        "the shared ACP fixture is missing at {}; these tests exist to check cross-implementation \
         agreement and must not quietly pass without it",
        path.display()
    );
    path
}

fn open_params(connection_id: &str, extra_args: &[&str]) -> ConnectionOpenParams {
    let mut args = vec![fixture_agent().to_string_lossy().into_owned()];
    args.extend(extra_args.iter().map(|arg| (*arg).to_owned()));
    ConnectionOpenParams {
        connection_id: connection_id.to_owned(),
        command: PathBuf::from("node"),
        args,
        env: Default::default(),
        // fs/* stays closed here. Declaring roots this slice cannot serve would
        // be a capability claim without a handler behind it.
        allow_roots: Vec::new(),
    }
}

/// Drain events until one matches, failing on timeout rather than hanging.
async fn wait_for_event(
    events: &mut Receiver<HostEvent>,
    mut matches: impl FnMut(&HostEvent) -> bool,
    what: &str,
) -> HostEvent {
    let deadline = tokio::time::timeout(STEP_TIMEOUT, async {
        loop {
            let event = events.recv().await.expect("the event channel closed early");
            if matches(&event) {
                return event;
            }
        }
    });
    deadline
        .await
        .unwrap_or_else(|_| panic!("timed out waiting for {what}"))
}

/// Answer the fixture's permission request with the given option.
async fn approve_next_permission(
    connection: &AgentConnection,
    events: &mut Receiver<HostEvent>,
    option_id: &str,
) -> String {
    let event = wait_for_event(
        events,
        |event| matches!(event, HostEvent::PermissionRequested { .. }),
        "a permission request",
    )
    .await;
    let HostEvent::PermissionRequested {
        request_id,
        options,
        ..
    } = event
    else {
        unreachable!("matched above");
    };
    assert!(
        options.iter().any(|option| option.option_id == option_id),
        "the fixture should offer {option_id}, got {options:?}"
    );
    connection
        .permissions()
        .decide(&request_id, Some(option_id))
        .expect("the decision should be accepted");
    request_id
}

fn assistant_text(entries: &[Entry]) -> String {
    entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::AssistantMessage { chunks } => Some(
                chunks
                    .iter()
                    .map(|chunk| chunk.text.as_str())
                    .collect::<String>(),
            ),
            _ => None,
        })
        .collect::<Vec<_>>()
        .join("|")
}

#[tokio::test(flavor = "multi_thread")]
async fn serves_two_prompt_turns_over_one_agent_process() {
    let (sink, mut events) = EventSink::new(EVENT_CHANNEL_CAPACITY);
    let connection = AgentConnection::open(&open_params("c1", &[]), sink.clone())
        .await
        .expect("the fixture agent should connect");
    let session_id = connection
        .create_session(&repository_root())
        .await
        .expect("session/new should succeed");

    for turn in 0..2 {
        let prompt = format!("turn {turn}");
        // The prompt cannot be awaited straight through: the fixture blocks it on
        // a permission request that this test has to answer.
        let prompting = connection.prompt(&session_id, &prompt, &sink);
        let answering = approve_next_permission(&connection, &mut events, "allow-once");
        let (stop_reason, _) = tokio::join!(prompting, answering);
        assert_eq!(
            stop_reason.expect("session/prompt should succeed"),
            "end_turn",
            "turn {turn} should reach a normal stop"
        );
    }

    // The point of the host: one agent process, one session, two turns. The
    // previous Node executor tore the process down after the first.
    let entries = connection
        .entries(&session_id)
        .expect("the session transcript should exist");
    let prompts: Vec<&str> = entries
        .iter()
        .filter_map(|entry| match entry {
            Entry::UserMessage { text } => Some(text.as_str()),
            _ => None,
        })
        .collect();
    assert_eq!(
        prompts,
        vec!["turn 0", "turn 1"],
        "both prompts should share one transcript"
    );
    assert_eq!(
        assistant_text(&entries),
        "fixture:allow-once|fixture:allow-once",
        "each turn should contribute its own assistant row"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn reports_a_rejected_permission_without_failing_the_turn() {
    let (sink, mut events) = EventSink::new(EVENT_CHANNEL_CAPACITY);
    let connection = AgentConnection::open(&open_params("c2", &[]), sink.clone())
        .await
        .expect("the fixture agent should connect");
    let session_id = connection
        .create_session(&repository_root())
        .await
        .expect("session/new should succeed");

    let prompting = connection.prompt(&session_id, "ask", &sink);
    let answering = approve_next_permission(&connection, &mut events, "reject-once");
    let (stop_reason, _) = tokio::join!(prompting, answering);
    assert_eq!(
        stop_reason.expect("the turn should still complete"),
        "end_turn",
        "a declined action is a normal outcome, not a transport failure"
    );
    assert_eq!(
        assistant_text(&connection.entries(&session_id).expect("transcript")),
        "fixture:reject-once"
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_a_decision_naming_an_option_the_agent_did_not_offer() {
    let (sink, mut events) = EventSink::new(EVENT_CHANNEL_CAPACITY);
    let connection = AgentConnection::open(&open_params("c3", &[]), sink.clone())
        .await
        .expect("the fixture agent should connect");
    let session_id = connection
        .create_session(&repository_root())
        .await
        .expect("session/new should succeed");

    let prompting = async {
        connection
            .prompt(&session_id, "ask", &sink)
            .await
            .expect("session/prompt should succeed")
    };
    let answering = async {
        let event = wait_for_event(
            &mut events,
            |event| matches!(event, HostEvent::PermissionRequested { .. }),
            "a permission request",
        )
        .await;
        let HostEvent::PermissionRequested { request_id, .. } = event else {
            unreachable!("matched above");
        };
        let refused = connection
            .permissions()
            .decide(&request_id, Some("invented-option"))
            .expect_err("an unoffered option must be refused");
        assert!(
            refused.to_string().contains("optionId"),
            "the refusal should name the offending field, got {refused}"
        );

        // Still pending, so the legitimate decision must still work.
        connection
            .permissions()
            .decide(&request_id, Some("allow-once"))
            .expect("the first refusal must not consume the request");

        // And the request is single-use once answered.
        let exhausted = connection
            .permissions()
            .decide(&request_id, Some("allow-once"))
            .expect_err("a second decision must be refused");
        assert!(exhausted.to_string().contains("no permission request"));
    };
    let (stop_reason, _) = tokio::join!(prompting, answering);
    assert_eq!(stop_reason, "end_turn");
}

#[tokio::test(flavor = "multi_thread")]
async fn keeps_the_transcript_addressable_by_a_stable_index() {
    let (sink, mut events) = EventSink::new(EVENT_CHANNEL_CAPACITY);
    let connection = AgentConnection::open(&open_params("c4", &[]), sink.clone())
        .await
        .expect("the fixture agent should connect");
    let session_id = connection
        .create_session(&repository_root())
        .await
        .expect("session/new should succeed");

    let mut appended = Vec::new();
    let prompting = async {
        connection
            .prompt(&session_id, "ask", &sink)
            .await
            .expect("session/prompt should succeed")
    };
    let collecting = async {
        // The user row is appended before the prompt goes out, and the agent's
        // reply appends a second. Indices must be dense and ascending so the
        // browser can address one row without rebuilding the list.
        let first = wait_for_event(
            &mut events,
            |event| matches!(event, HostEvent::EntryAppended { .. }),
            "the user row",
        )
        .await;
        appended.push(first);
        approve_next_permission(&connection, &mut events, "allow-once").await;
        let second = wait_for_event(
            &mut events,
            |event| matches!(event, HostEvent::EntryAppended { .. }),
            "the assistant row",
        )
        .await;
        appended.push(second);
    };
    let (stop_reason, ()) = tokio::join!(prompting, collecting);
    assert_eq!(stop_reason, "end_turn");

    let indices: Vec<usize> = appended
        .iter()
        .map(|event| match event {
            HostEvent::EntryAppended { index, .. } => *index,
            other => panic!("expected an append, got {other:?}"),
        })
        .collect();
    assert_eq!(indices, vec![0, 1], "appends must report dense indices");
    let _ = TurnStatus::Failed;
}
