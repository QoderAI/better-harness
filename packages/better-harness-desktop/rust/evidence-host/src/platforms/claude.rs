use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall, truncate_prompt, tool_family,
};
use crate::paths::{claude_slug_variants, cwd_matches, home_dir, paths_from_value};
use crate::time::normalize_timestamp;

pub fn claude_home() -> PathBuf {
    home_dir().join(".claude")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&claude_home(), workspace, max_sessions)
}

pub fn discover_from(home: &Path, workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    let mut sessions = Vec::new();
    for slug in claude_slug_variants(workspace) {
        let root = home.join("projects").join(slug);
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
                continue;
            }
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
    let fallback_id = path.file_stem().and_then(|name| name.to_str()).unwrap_or("session");
    let mut session_id = fallback_id.to_string();
    let mut first_seen = None;
    let mut last_seen = None;
    let mut prompts: Vec<Prompt> = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut last_response = None;
    let mut matched = false;
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
            session_id = id.to_string();
        }
        if let Some(cwd) = record.get("cwd").and_then(Value::as_str) {
            if cwd_matches(workspace, cwd) {
                matched = true;
            }
        }
        let stamp = normalize_timestamp(record.get("timestamp").unwrap_or(&Value::Null));
        if first_seen.is_none() {
            first_seen = stamp.clone();
        }
        if stamp.is_some() {
            last_seen = stamp.clone();
        }
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "user" {
            let text = message_text(record.get("message"));
            if !text.is_empty() {
                let prompt = truncate_prompt(&text);
                if prompts.len() < 8 && !prompts.iter().any(|item| item.text == prompt) {
                    prompts.push(Prompt {
                        text: prompt,
                        timestamp: stamp,
                    });
                }
            }
        } else if kind == "assistant" {
            let message = record.get("message");
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
                    let id = part.get("id").and_then(Value::as_str).unwrap_or("").to_string();
                    let input = part.get("input").cloned().unwrap_or(Value::Null);
                    let paths = paths_from_value(workspace, &input);
                    calls.push(ToolCall {
                        id: if id.is_empty() {
                            format!("claude-{}-{}", session_id, calls.len() + 1)
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
                    });
                }
            }
        }
    }
    if !matched && prompts.is_empty() {
        return None;
    }
    Some(SessionSummary {
        session_id,
        platform: "claude".into(),
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
    })
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
