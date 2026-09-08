use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};

use harness_evidence_host::paths::{claude_slug_variants, grok_group_name};
use harness_evidence_host::platforms::{claude, codex, copilot, cursor, grok};
use harness_evidence_host::wire::HOST_PROTOCOL_VERSION;
use serde_json::{Value, json};

fn unique_dir(prefix: &str) -> PathBuf {
    let stamp = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
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
    assert_eq!(sessions[0].tool_activity.as_ref().unwrap().calls[0].file_path.as_deref(), Some("README.md"));
}

#[test]
fn codex_fixture_is_discovered() {
    let workspace = unique_dir("evidence-codex-workspace");
    fs::write(workspace.join("src.rs"), "fn main() {}").unwrap();
    let workspace = fs::canonicalize(&workspace).unwrap();
    let home = unique_dir("evidence-codex-home");
    let session_dir = home.join("sessions").join("2026").join("09").join("08");
    fs::create_dir_all(&session_dir).unwrap();
    let file = session_dir.join("rollout-2026-09-08T01-00-00-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee.jsonl");
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
    assert_eq!(sessions[0].session_id, "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
    assert_eq!(sessions[0].prompts[0].text, "Fix the parser");
    assert_eq!(sessions[0].tool_activity.as_ref().unwrap().calls[0].file_path.as_deref(), Some("src.rs"));
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
    assert_eq!(sessions[0].tool_activity.as_ref().unwrap().calls[0].file_path.as_deref(), Some("lib.rs"));
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
    assert_eq!(sessions[0].tool_activity.as_ref().unwrap().calls[0].file_path.as_deref(), Some("main.rs"));
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
    stdin
        .write_all(b"{\"version\":1,\"id\":2,\"method\":\"shutdown\",\"params\":{}}\n")
        .unwrap();
    let _ = child.wait();
}
