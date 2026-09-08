use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use harness_evidence_host::paths::{
    claude_slug_variants, dsh_project_key, encode_dsh_session_id, grok_group_name,
    pi_session_dir_variants, qwen_slug_variants, workbuddy_slug_variants,
};
use harness_evidence_host::platforms::{
    augment, claude, codex, copilot, cursor, dsh, grok, harness_run, kimi, pi, qwen, workbuddy,
};
use harness_evidence_host::wire::HOST_PROTOCOL_VERSION;
use serde_json::{json, Value};

fn unique_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("{prefix}-{stamp}"));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn grok_fixture_is_discovered() {
    let workspace = unique_dir("evidence-workspace");
    fs::write(workspace.join("README.md"), "hello").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-grok-home");
    let session = home
        .join("sessions")
        .join(grok_group_name(&workspace))
        .join("session-fixture");
    fs::create_dir_all(&session).unwrap();
    fs::write(
        session.join("summary.json"),
        json!({
            "info": { "id": "session-fixture", "cwd": workspace.to_string_lossy() },
            "created_at": "2026-09-08T05:38:19.958Z",
            "updated_at": "2026-09-08T05:41:57.519Z"
        })
        .to_string(),
    )
    .unwrap();
    fs::write(
        session.join("updates.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"timestamp":1788845921,"method":"session/update","params":{"update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"Inspect the workspace"}}}}),
            json!({"timestamp":1788845922,"method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"c1","title":"read_file","rawInput":{"target_file": workspace.join("README.md").to_string_lossy()},"_meta":{"x.ai/tool":{"name":"read_file"}}}}})
        ),
    )
    .unwrap();

    let sessions = grok::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "grok");
    assert_eq!(sessions[0].prompts[0].text, "Inspect the workspace");
    assert_eq!(sessions[0].tool_call_count, 1);
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("README.md")
    );
}

#[test]
fn codex_fixture_is_discovered() {
    let workspace = unique_dir("evidence-codex-workspace");
    fs::write(workspace.join("src.rs"), "fn main() {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-codex-home");
    let session_dir = home.join("sessions").join("2026").join("09").join("08");
    fs::create_dir_all(&session_dir).unwrap();
    let file =
        session_dir.join("rollout-2026-09-08T01-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
    fs::write(
        &file,
        format!(
            "{}\n{}\n{}\n",
            json!({"timestamp":"2026-09-08T01:00:00.000Z","type":"session_meta","payload":{"id":"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee","cwd": workspace.to_string_lossy()}}),
            json!({"timestamp":"2026-09-08T01:00:01.000Z","type":"event_msg","payload":{"type":"user_message","message":"Fix the parser"}}),
            json!({"timestamp":"2026-09-08T01:00:02.000Z","type":"response_item","payload":{"type":"function_call","call_id":"c1","name":"Read","input": workspace.join("src.rs").to_string_lossy()}})
        ),
    )
    .unwrap();
    let sessions = codex::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "codex");
    assert_eq!(
        sessions[0].session_id,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
    );
    assert_eq!(sessions[0].prompts[0].text, "Fix the parser");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("src.rs")
    );
}

#[test]
fn claude_fixture_is_discovered() {
    let workspace = unique_dir("evidence-claude-workspace");
    fs::write(workspace.join("lib.rs"), "ok").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-claude-home");
    let slug = claude_slug_variants(&workspace)[0].clone();
    let project = home.join("projects").join(slug);
    fs::create_dir_all(&project).unwrap();
    fs::write(
        project.join("session-claude.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"user","cwd": workspace.to_string_lossy(),"timestamp":"2026-09-08T02:00:00.000Z","sessionId":"session-claude","message":{"role":"user","content":"Review lib.rs"}}),
            json!({"type":"assistant","timestamp":"2026-09-08T02:00:01.000Z","sessionId":"session-claude","message":{"role":"assistant","content":[{"type":"tool_use","id":"t1","name":"Read","input":{"file_path": workspace.join("lib.rs").to_string_lossy()}}]}})
        ),
    )
    .unwrap();
    let sessions = claude::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "claude");
    assert_eq!(sessions[0].prompts[0].text, "Review lib.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("lib.rs")
    );
}

#[test]
fn cursor_fixture_is_discovered() {
    let workspace = unique_dir("evidence-cursor-workspace");
    fs::write(workspace.join("main.rs"), "fn main() {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-cursor-home");
    let slug = cursor::cursor_slug_variants(&workspace)[0].clone();
    let dir = home
        .join("projects")
        .join(&slug)
        .join("agent-transcripts")
        .join("cursor-session");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("cursor-session.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"role":"user","message":{"content":[{"type":"text","text":"<user_query>Review main.rs</user_query>"}]}}),
            json!({"role":"assistant","message":{"content":[{"type":"text","text":"Looking."},{"type":"tool_use","name":"Read","input":{"path": workspace.join("main.rs").to_string_lossy()}}]}})
        ),
    )
    .unwrap();
    let sessions = cursor::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "cursor");
    assert_eq!(sessions[0].prompts[0].text, "Review main.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("main.rs")
    );
}

#[test]
fn copilot_fixture_is_discovered() {
    let workspace = unique_dir("evidence-copilot-workspace");
    fs::write(workspace.join("app.ts"), "export {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-copilot-home");
    let dir = home.join("session-state").join("copilot-session");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("workspace.yaml"),
        format!("id: copilot-session\ncwd: {}\n", workspace.display()),
    )
    .unwrap();
    fs::write(
        dir.join("events.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"session.start","timestamp":"2026-09-08T03:00:00.000Z","data":{"sessionId":"copilot-session","context":{"cwd": workspace.to_string_lossy()}}}),
            json!({"type":"user.message","timestamp":"2026-09-08T03:00:01.000Z","data":{"content":"Ship the app"}})
        ),
    )
    .unwrap();
    let sessions = copilot::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "copilot");
    assert_eq!(sessions[0].prompts[0].text, "Ship the app");
}

#[test]
fn qwen_fixture_is_discovered() {
    let workspace = unique_dir("evidence-qwen-workspace");
    fs::write(workspace.join("app.ts"), "export {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-qwen-home");
    let slug = qwen_slug_variants(&workspace)[0].clone();
    let chats = home.join("projects").join(&slug).join("chats");
    fs::create_dir_all(&chats).unwrap();
    fs::write(
        chats.join("session-qwen.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"user","sessionId":"session-qwen","cwd": workspace.to_string_lossy(),"timestamp":"2026-09-08T04:00:00.000Z","message":{"parts":[{"text":"Review app.ts"}]}}),
            json!({"type":"assistant","timestamp":"2026-09-08T04:00:01.000Z","message":{"parts":[{"functionCall":{"id":"c1","name":"Read","args":{"file_path": workspace.join("app.ts").to_string_lossy()}}}]}})
        ),
    )
    .unwrap();
    let sessions = qwen::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "qwen");
    assert_eq!(sessions[0].prompts[0].text, "Review app.ts");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("app.ts")
    );
}

#[test]
fn pi_fixture_is_discovered() {
    let workspace = unique_dir("evidence-pi-workspace");
    fs::write(workspace.join("main.rs"), "fn main() {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-pi-home");
    let slug = pi_session_dir_variants(&workspace)[0].clone();
    let dir = home.join("sessions").join(&slug);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("1_pi-session.jsonl"),
        format!(
            "{}\n{}\n{}\n",
            json!({"type":"session","id":"pi-session","cwd": workspace.to_string_lossy(),"timestamp":"2026-09-08T04:10:00.000Z"}),
            json!({"type":"message","timestamp":"2026-09-08T04:10:01.000Z","message":{"role":"user","content":[{"type":"text","text":"Review main.rs"}]}}),
            json!({"type":"message","timestamp":"2026-09-08T04:10:02.000Z","message":{"role":"assistant","content":[{"type":"toolCall","id":"t1","name":"Read","arguments":{"file_path": workspace.join("main.rs").to_string_lossy()}}]}})
        ),
    )
    .unwrap();
    let sessions = pi::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].session_id, "pi-session");
    assert_eq!(sessions[0].prompts[0].text, "Review main.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("main.rs")
    );
}

#[test]
fn workbuddy_fixture_is_discovered() {
    let workspace = unique_dir("evidence-wb-workspace");
    fs::write(workspace.join("lib.rs"), "ok").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-wb-home");
    let slug = workbuddy_slug_variants(&workspace)[0].clone();
    let dir = home.join("projects").join(&slug);
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("wb-session.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"message","role":"user","sessionId":"wb-session","cwd": workspace.to_string_lossy(),"timestamp":"2026-09-08T04:20:00.000Z","content":[{"type":"text","text":"Ship lib.rs"}]}),
            json!({"type":"function_call","callId":"c1","name":"Read","timestamp":"2026-09-08T04:20:01.000Z","arguments":{"file_path": workspace.join("lib.rs").to_string_lossy()}})
        ),
    )
    .unwrap();
    let sessions = workbuddy::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "workbuddy");
    assert_eq!(sessions[0].prompts[0].text, "Ship lib.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("lib.rs")
    );
}

#[test]
fn augment_fixture_is_discovered() {
    let workspace = unique_dir("evidence-aug-workspace");
    fs::write(workspace.join("src.rs"), "fn main() {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-aug-home");
    let dir = home.join("sessions");
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("aug-session.json"),
        json!({
            "sessionId": "aug-session",
            "created": "2026-09-08T04:30:00.000Z",
            "chatHistory": [{
                "exchange": {
                    "request_nodes": [
                        {"ide_state_node": {"workspace_folders": [{"folder_root": workspace.to_string_lossy()}]}},
                        {"text_node": {"content": "Inspect src.rs"}}
                    ],
                    "response_nodes": [
                        {"type": 0, "content": "Looking."},
                        {"tool_use": {"tool_use_id": "t1", "tool_name": "Read", "input_json": {"file_path": workspace.join("src.rs").to_string_lossy()}}}
                    ]
                }
            }]
        })
        .to_string(),
    )
    .unwrap();
    let sessions = augment::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "augment");
    assert_eq!(sessions[0].prompts[0].text, "Inspect src.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("src.rs")
    );
}

#[test]
fn kimi_fixture_is_discovered() {
    let workspace = unique_dir("evidence-kimi-workspace");
    fs::write(workspace.join("cli.ts"), "export {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-kimi-home");
    let session_dir = home.join("sessions").join("wd_cli_abc").join("ses_kimi");
    fs::create_dir_all(session_dir.join("agents").join("main")).unwrap();
    fs::write(
        home.join("workspaces.json"),
        json!({"workspaces": {"wd_cli_abc": {"root": workspace.to_string_lossy()}}}).to_string(),
    )
    .unwrap();
    fs::write(
        session_dir.join("state.json"),
        json!({"title": "Inspect cli.ts", "createdAt": "2026-09-08T04:40:00.000Z"}).to_string(),
    )
    .unwrap();
    fs::write(
        session_dir.join("agents").join("main").join("wire.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"turn.prompt","time":"2026-09-08T04:40:01.000Z","input":[{"type":"text","text":"Inspect cli.ts"}]}),
            json!({"type":"context.append_loop_event","time":"2026-09-08T04:40:02.000Z","event":{"type":"tool.call","name":"Read","toolCallId":"c1","args":{"file_path": workspace.join("cli.ts").to_string_lossy()}}})
        ),
    )
    .unwrap();
    let sessions = kimi::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "kimi");
    assert_eq!(sessions[0].prompts[0].text, "Inspect cli.ts");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("cli.ts")
    );
}

#[test]
fn dsh_fixture_is_discovered() {
    let workspace = unique_dir("evidence-dsh-workspace");
    fs::write(workspace.join("mod.rs"), "ok").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-dsh-home");
    let cwd = workspace.to_string_lossy().into_owned();
    let dir = home
        .join("sessions")
        .join(dsh_project_key(&cwd))
        .join(encode_dsh_session_id("dsh-session"));
    fs::create_dir_all(&dir).unwrap();
    fs::write(
        dir.join("session.jsonl"),
        format!(
            "{}\n{}\n{}\n",
            json!({"type":"session","version":0,"id":"dsh-session","cwd": cwd, "createdAt": 1757300000000i64, "delegationDepth": 0}),
            json!({"type":"user/message","seq":1,"time":1757300001000i64,"data":{"id":"m1","role":"user","content":[{"type":"text","text":"Review mod.rs"}],"source":{"kind":"user"}},"surfaceOp":"append"}),
            json!({"type":"tool/call","seq":2,"time":1757300002000i64,"data":{"turn":1,"step":1,"callId":"c1","name":"Read","arguments": json!({"file_path": workspace.join("mod.rs").to_string_lossy()}).to_string()}})
        ),
    )
    .unwrap();
    let sessions = dsh::discover_from(&home, &workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "dsh");
    assert_eq!(sessions[0].prompts[0].text, "Review mod.rs");
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("mod.rs")
    );
}

#[test]
fn harness_run_fixture_is_discovered() {
    let workspace = unique_dir("evidence-hr-workspace");
    fs::write(workspace.join("README.md"), "hello").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let trial = workspace
        .join(".better-harness")
        .join("harness-runs")
        .join("compare-1")
        .join("H1")
        .join("trial-001");
    fs::create_dir_all(&trial).unwrap();
    fs::write(
        trial.parent().unwrap().join("revision.json"),
        json!({"revisionId": "hr_0123456789abcdef0123456789abcdef"}).to_string(),
    )
    .unwrap();
    fs::write(
        trial.join("trace.jsonl"),
        format!(
            "{}\n{}\n",
            json!({"type":"run-started"}),
            json!({"type":"tool-call-started","toolCallId":"call_1","toolName":"Read","input":{"file_path": workspace.join("README.md").to_string_lossy()}})
        ),
    )
    .unwrap();
    let sessions = harness_run::discover(&workspace, 10).unwrap();
    fs::remove_dir_all(&workspace).ok();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].platform, "harness-run");
    assert_eq!(
        sessions[0].session_id,
        "hr_0123456789abcdef0123456789abcdef:H1:trial-001"
    );
    assert_eq!(
        sessions[0].tool_activity.as_ref().unwrap().calls[0]
            .file_path
            .as_deref(),
        Some("README.md")
    );
}

#[test]
fn empty_home_is_no_evidence_not_error() {
    let workspace = unique_dir("evidence-empty-workspace");
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-empty-home");
    assert!(qwen::discover_from(&home, &workspace, 10)
        .unwrap()
        .is_empty());
    assert!(pi::discover_from(&home, &workspace, 10).unwrap().is_empty());
    assert!(workbuddy::discover_from(&home, &workspace, 10)
        .unwrap()
        .is_empty());
    assert!(augment::discover_from(&home, &workspace, 10)
        .unwrap()
        .is_empty());
    assert!(kimi::discover_from(&home, &workspace, 10)
        .unwrap()
        .is_empty());
    assert!(dsh::discover_from(&home, &workspace, 10)
        .unwrap()
        .is_empty());
    assert!(harness_run::discover(&workspace, 10).unwrap().is_empty());
    fs::remove_dir_all(&workspace).ok();
    fs::remove_dir_all(&home).ok();
}

#[test]
fn stdio_driver_describes_and_discovers() {
    let exe = env!("CARGO_BIN_EXE_harness-evidence-host");
    let mut child = Command::new(exe)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    stdin
        .write_all(b"{\"version\":1,\"id\":1,\"method\":\"host.describe\",\"params\":{}}\n")
        .unwrap();
    stdin.flush().unwrap();
    let mut line = String::new();
    stdout.read_line(&mut line).unwrap();
    let reply: Value = serde_json::from_str(&line).unwrap();
    assert_eq!(reply["result"]["protocol"], HOST_PROTOCOL_VERSION);
    let platforms = reply["result"]["platforms"].as_array().unwrap();
    for host in [
        "augment",
        "qwen",
        "pi",
        "kimi",
        "workbuddy",
        "dsh",
        "harness-run",
    ] {
        assert!(
            platforms.iter().any(|value| value == host),
            "missing {host}"
        );
    }
    stdin
        .write_all(b"{\"version\":1,\"id\":2,\"method\":\"shutdown\",\"params\":{}}\n")
        .unwrap();
    let _ = child.wait();
}
