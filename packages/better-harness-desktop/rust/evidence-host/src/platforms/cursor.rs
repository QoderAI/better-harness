use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    tool_family, truncate_prompt, Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall,
};
use crate::paths::{home_dir, paths_from_value, qoder_slug_variants, walk_jsonl};
use crate::time::normalize_timestamp;

pub fn cursor_home() -> PathBuf {
    home_dir().join(".cursor")
}

pub fn cursor_slug_variants(workspace: &Path) -> Vec<String> {
    let mut values = qoder_slug_variants(workspace);
    let stripped: Vec<String> = values
        .iter()
        .map(|value| value.trim_start_matches('-').to_string())
        .collect();
    values.extend(stripped);
    values.sort();
    values.dedup();
    values
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&cursor_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let mut sessions = Vec::new();
    for slug in cursor_slug_variants(workspace) {
        let root = home.join("projects").join(slug).join("agent-transcripts");
        if !root.is_dir() {
            continue;
        }
        let mut files = walk_jsonl(&root, 2, 20_000);
        files.sort_by(|left, right| {
            let lm = fs::metadata(left).and_then(|meta| meta.modified()).ok();
            let rm = fs::metadata(right).and_then(|meta| meta.modified()).ok();
            rm.cmp(&lm)
        });
        files.truncate(max_sessions);
        for path in files {
            if let Some(session) = read_session(workspace, &path) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, path: &Path) -> Option<SessionSummary> {
    let text = fs::read_to_string(path).ok()?;
    let session_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session")
        .to_string();
    let file_stamp = fs::metadata(path)
        .and_then(|meta| meta.modified())
        .ok()
        .and_then(|modified| modified.duration_since(std::time::UNIX_EPOCH).ok())
        .and_then(|elapsed| {
            crate::time::normalize_timestamp(&serde_json::json!(elapsed.as_millis() as u64))
        });
    let mut first_seen = file_stamp.clone();
    let mut last_seen = file_stamp;
    let mut prompts: Vec<Prompt> = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut last_response = None;
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let stamp = normalize_timestamp(record.get("timestamp").unwrap_or(&Value::Null));
        if stamp.is_some() {
            if first_seen.is_none() {
                first_seen = stamp.clone();
            }
            last_seen = stamp.clone();
        }
        let role = record.get("role").and_then(Value::as_str).unwrap_or("");
        let message = record.get("message");
        if role == "user" {
            let raw = message_text(message);
            let text = extract_user_query(&raw);
            if !text.is_empty() {
                let prompt = truncate_prompt(&text);
                if prompts.len() < 8 && !prompts.iter().any(|item| item.text == prompt) {
                    prompts.push(Prompt {
                        text: prompt,
                        timestamp: stamp.clone(),
                    });
                }
            }
        } else if role == "assistant" {
            let text = message_text(message);
            if !text.is_empty() {
                assistant_count += 1;
                last_response = Some(truncate_prompt(&text));
            }
            if let Some(Value::Array(parts)) = message.and_then(|value| value.get("content")) {
                for part in parts {
                    if part.get("type").and_then(Value::as_str) != Some("tool_use") {
                        continue;
                    }
                    let name = part.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let id = part
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let input = part.get("input").cloned().unwrap_or(Value::Null);
                    let paths = paths_from_value(workspace, &input);
                    calls.push(ToolCall {
                        id: if id.is_empty() {
                            format!("cursor-{}-{}", session_id, calls.len() + 1)
                        } else {
                            id
                        },
                        family: tool_family(name),
                        action_label: name.to_string(),
                        tool_name: name.to_string(),
                        status: "observed".into(),
                        file_path: paths.first().cloned(),
                        file_paths: paths,
                        started_at: stamp.clone(),
                        ..ToolCall::default()
                    });
                }
            }
        }
    }
    Some(SessionSummary {
        session_id,
        platform: "cursor".into(),
        last_seen: last_seen.or(first_seen.clone()),
        first_seen,
        prompt_count: prompts.len() as u32,
        assistant_message_count: assistant_count,
        tool_call_count: calls.len() as u32,
        prompts,
        tool_activity: Some(ToolActivity { calls }),
        dialogue: last_response.map(|response| Dialogue {
            turns: vec![crate::model::Turn {
                timestamp: None,
                response: Some(response),
            }],
        }),
        ..SessionSummary::default()
    })
}

fn extract_user_query(text: &str) -> String {
    if let Some(start) = text.find("<user_query>") {
        let rest = &text[start + "<user_query>".len()..];
        if let Some(end) = rest.find("</user_query>") {
            return rest[..end].trim().to_string();
        }
    }
    text.trim().to_string()
}

fn message_text(message: Option<&Value>) -> String {
    let Some(message) = message else {
        return String::new();
    };
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                if part.get("type").and_then(Value::as_str) == Some("text") {
                    part.get("text").and_then(Value::as_str)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}
