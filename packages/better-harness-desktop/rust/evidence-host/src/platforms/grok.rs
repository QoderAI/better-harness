use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    tool_family, truncate_prompt, Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall,
};
use crate::paths::{grok_group_name, home_dir, repo_relative};
use crate::time::normalize_timestamp;

pub fn grok_home() -> PathBuf {
    std::env::var("GROK_HOME")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".grok"))
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&grok_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let group = home.join("sessions").join(grok_group_name(workspace));
    if !group.is_dir() {
        return Ok(vec![]);
    }
    let mut sessions = Vec::new();
    let entries = fs::read_dir(&group).map_err(|error| error.to_string())?;
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let id = entry.file_name().to_string_lossy().into_owned();
        if id.starts_with('.') {
            continue;
        }
        if let Some(session) = read_session(workspace, &entry.path(), &id) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, session_dir: &Path, session_id: &str) -> Option<SessionSummary> {
    let summary_raw = fs::read_to_string(session_dir.join("summary.json")).ok()?;
    let summary: Value = serde_json::from_str(&summary_raw).ok()?;
    let cwd = summary
        .pointer("/info/cwd")
        .and_then(Value::as_str)
        .or_else(|| summary.get("cwd").and_then(Value::as_str));
    if let Some(cwd) = cwd {
        let normalized = crate::paths::normalize_workspace(cwd);
        if normalized != workspace && !normalized.starts_with(workspace) {
            return None;
        }
    }
    let first_seen = normalize_timestamp(summary.get("created_at").unwrap_or(&Value::Null))
        .or_else(|| normalize_timestamp(summary.get("createdAt").unwrap_or(&Value::Null)));
    let last_seen = normalize_timestamp(summary.get("updated_at").unwrap_or(&Value::Null))
        .or_else(|| normalize_timestamp(summary.get("updatedAt").unwrap_or(&Value::Null)))
        .or_else(|| first_seen.clone());
    let updates_path = session_dir.join("updates.jsonl");
    let (prompts, assistant_count, calls, response) = parse_updates(workspace, &updates_path);
    Some(SessionSummary {
        session_id: session_id.to_string(),
        platform: "grok".into(),
        first_seen,
        last_seen,
        prompt_count: prompts.len() as u32,
        assistant_message_count: assistant_count,
        tool_call_count: calls.len() as u32,
        prompts,
        tool_activity: Some(ToolActivity { calls }),
        dialogue: response.map(|text| Dialogue {
            turns: vec![crate::model::Turn {
                timestamp: None,
                response: Some(text),
            }],
        }),
        ..SessionSummary::default()
    })
}

fn parse_updates(
    workspace: &Path,
    path: &Path,
) -> (Vec<Prompt>, u32, Vec<ToolCall>, Option<String>) {
    let Ok(text) = fs::read_to_string(path) else {
        return (Vec::new(), 0, Vec::new(), None);
    };
    let mut prompts = Vec::new();
    let mut user_chunks = String::new();
    let mut assistant_chunks = String::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut last_response = None;
    for line in text.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let timestamp = normalize_timestamp(record.get("timestamp").unwrap_or(&Value::Null));
        let update = record
            .pointer("/params/update")
            .cloned()
            .unwrap_or(Value::Null);
        let kind = update
            .get("sessionUpdate")
            .and_then(Value::as_str)
            .unwrap_or("");
        match kind {
            "user_message_chunk" => {
                if let Some(chunk) = update.pointer("/content/text").and_then(Value::as_str) {
                    user_chunks.push_str(chunk);
                }
            }
            "agent_message_chunk" => {
                if let Some(chunk) = update.pointer("/content/text").and_then(Value::as_str) {
                    assistant_chunks.push_str(chunk);
                }
            }
            "tool_call" => {
                flush_user_prompt(&mut user_chunks, &mut prompts, timestamp.clone());
                let id = update
                    .get("toolCallId")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string();
                if id.is_empty() {
                    continue;
                }
                let name = update
                    .pointer("/_meta/x.ai/tool/name")
                    .and_then(Value::as_str)
                    .or_else(|| update.get("title").and_then(Value::as_str))
                    .unwrap_or("unknown-tool");
                let paths = paths_from_input(workspace, update.get("rawInput"));
                calls.push(ToolCall {
                    id,
                    family: tool_family(name),
                    action_label: name.to_string(),
                    tool_name: name.to_string(),
                    status: "observed".into(),
                    file_path: paths.first().cloned(),
                    file_paths: paths,
                    started_at: timestamp,
                    ..ToolCall::default()
                });
            }
            "tool_call_update" => {
                if let Some(title) = update.get("title").and_then(Value::as_str) {
                    let id = update.get("toolCallId").and_then(Value::as_str);
                    if let Some(call) =
                        id.and_then(|id| calls.iter_mut().find(|call| call.id == id))
                    {
                        let extra = backtick_paths(workspace, title);
                        for path in extra {
                            if !call.file_paths.contains(&path) {
                                call.file_paths.push(path.clone());
                            }
                            if call.file_path.is_none() {
                                call.file_path = Some(path);
                            }
                        }
                    }
                }
            }
            "turn_completed" => {
                flush_user_prompt(&mut user_chunks, &mut prompts, timestamp);
                if !assistant_chunks.trim().is_empty() {
                    assistant_count += 1;
                    last_response = Some(truncate_prompt(&assistant_chunks));
                    assistant_chunks.clear();
                }
            }
            _ => {}
        }
    }
    flush_user_prompt(&mut user_chunks, &mut prompts, None);
    if !assistant_chunks.trim().is_empty() {
        assistant_count += 1;
        last_response = Some(truncate_prompt(&assistant_chunks));
    }
    (prompts, assistant_count, calls, last_response)
}

fn flush_user_prompt(buffer: &mut String, prompts: &mut Vec<Prompt>, timestamp: Option<String>) {
    if buffer.trim().is_empty() {
        return;
    }
    let text = truncate_prompt(buffer);
    buffer.clear();
    if prompts.iter().any(|prompt| prompt.text == text) || prompts.len() >= 8 {
        return;
    }
    prompts.push(Prompt { text, timestamp });
}

fn paths_from_input(workspace: &Path, input: Option<&Value>) -> Vec<String> {
    let Some(Value::Object(map)) = input else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    for key in ["target_file", "path", "file_path", "filePath", "file"] {
        if let Some(Value::String(value)) = map.get(key) {
            if let Some(relative) = repo_relative(workspace, value) {
                paths.push(relative);
            }
        }
    }
    paths
}

fn backtick_paths(workspace: &Path, title: &str) -> Vec<String> {
    let mut paths = Vec::new();
    for chunk in title.split('`').skip(1).step_by(2) {
        if let Some(relative) = repo_relative(workspace, chunk) {
            paths.push(relative);
        }
    }
    paths
}
