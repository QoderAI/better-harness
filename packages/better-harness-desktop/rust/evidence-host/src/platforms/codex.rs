use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall, truncate_prompt, tool_family,
};
use crate::paths::{cwd_matches, home_dir, paths_from_text, paths_from_value, walk_jsonl};
use crate::time::normalize_timestamp;

pub fn codex_home() -> PathBuf {
    home_dir().join(".codex")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&codex_home(), workspace, max_sessions)
}

pub fn discover_from(home: &Path, workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    let root = home.join("sessions");
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut candidates = Vec::new();
    for path in walk_jsonl(&root, 4, 20_000) {
        if let Some(candidate) = probe(workspace, &path) {
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    candidates.truncate(max_sessions);
    let mut sessions = Vec::new();
    for candidate in candidates {
        if let Some(session) = read_session(workspace, &candidate) {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

struct Candidate {
    path: PathBuf,
    session_id: String,
    timestamp: Option<String>,
    first: Value,
}

fn probe(workspace: &Path, path: &Path) -> Option<Candidate> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first = String::new();
    reader.read_line(&mut first).ok()?;
    let first_record: Value = serde_json::from_str(first.trim()).ok()?;
    let cwd = first_record
        .pointer("/payload/cwd")
        .and_then(Value::as_str)
        .or_else(|| first_record.get("cwd").and_then(Value::as_str))?;
    if !cwd_matches(workspace, cwd) {
        return None;
    }
    let session_id = first_record
        .pointer("/payload/id")
        .and_then(Value::as_str)
        .or_else(|| first_record.get("session_id").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| fallback_id(path));
    Some(Candidate {
        path: path.to_path_buf(),
        session_id,
        timestamp: normalize_timestamp(first_record.get("timestamp").unwrap_or(&Value::Null)),
        first: first_record,
    })
}

fn read_session(workspace: &Path, candidate: &Candidate) -> Option<SessionSummary> {
    let rest = fs::read_to_string(&candidate.path).ok()?;
    Some(parse_transcript(workspace, &candidate.session_id, &rest, &candidate.first))
}

fn fallback_id(path: &Path) -> String {
    let stem = path.file_stem().and_then(|name| name.to_str()).unwrap_or("session");
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() >= 5 {
        let uuid = parts[parts.len() - 5..].join("-");
        if uuid.len() >= 32 {
            return uuid;
        }
    }
    stem.to_string()
}

fn parse_transcript(workspace: &Path, session_id: &str, text: &str, first: &Value) -> SessionSummary {
    let mut first_seen = normalize_timestamp(first.get("timestamp").unwrap_or(&Value::Null));
    let mut last_seen = first_seen.clone();
    let mut prompts = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut last_response = None;
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let stamp = normalize_timestamp(record.get("timestamp").unwrap_or(&Value::Null));
        if first_seen.is_none() {
            first_seen = stamp.clone();
        }
        if stamp.is_some() {
            last_seen = stamp.clone();
        }
        let outer = record.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = record.get("payload").cloned().unwrap_or(Value::Null);
        let inner = payload.get("type").and_then(Value::as_str).unwrap_or("");
        if outer == "event_msg" && inner == "user_message" {
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                push_prompt(&mut prompts, message, stamp);
            }
        } else if outer == "response_item" && inner == "message" {
            let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
            let text = message_text(&payload);
            if role == "assistant" && !text.is_empty() {
                assistant_count += 1;
                last_response = Some(truncate_prompt(&text));
            }
        } else if outer == "response_item" && (inner == "function_call" || inner == "custom_tool_call") {
            let name = payload.get("name").and_then(Value::as_str).unwrap_or("tool");
            let id = payload
                .get("call_id")
                .and_then(Value::as_str)
                .or_else(|| payload.get("id").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            let mut paths = paths_from_value(workspace, &payload);
            if let Some(input) = payload.get("input").and_then(Value::as_str) {
                for path in paths_from_text(workspace, input) {
                    if !paths.contains(&path) {
                        paths.push(path);
                    }
                }
            }
            calls.push(ToolCall {
                id: if id.is_empty() {
                    format!("codex-{}-{}", session_id, calls.len() + 1)
                } else {
                    id
                },
                family: tool_family(name),
                action_label: name.to_string(),
                tool_name: name.to_string(),
                status: "observed".into(),
                file_path: paths.first().cloned(),
                file_paths: paths,
                started_at: stamp,
            });
        } else if outer == "event_msg" && inner == "agent_message" {
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                assistant_count += 1;
                last_response = Some(truncate_prompt(message));
            }
        }
    }
    SessionSummary {
        session_id: session_id.to_string(),
        platform: "codex".into(),
        last_seen: last_seen.or(first_seen.clone()),
        first_seen,
        prompt_count: prompts.len() as u32,
        assistant_message_count: assistant_count,
        tool_call_count: calls.len() as u32,
        prompts,
        tool_activity: Some(ToolActivity { calls }),
        dialogue: last_response.map(|response| Dialogue {
            turns: vec![crate::model::Turn {
                response: Some(response),
            }],
        }),
    }
}

fn push_prompt(prompts: &mut Vec<Prompt>, message: &str, timestamp: Option<String>) {
    let text = truncate_prompt(message);
    if text.is_empty() || prompts.len() >= 8 || prompts.iter().any(|prompt| prompt.text == text) {
        return;
    }
    prompts.push(Prompt { text, timestamp });
}

fn message_text(payload: &Value) -> String {
    match payload.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("input_text").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => payload.get("text").and_then(Value::as_str).unwrap_or("").to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_rollout_prefix() {
        assert_eq!(
            fallback_id(Path::new(
                "rollout-2026-04-27T11-42-51-019dcd08-5fe3-7fa1-9e74-94929d8ed50d.jsonl"
            )),
            "019dcd08-5fe3-7fa1-9e74-94929d8ed50d"
        );
    }
}
