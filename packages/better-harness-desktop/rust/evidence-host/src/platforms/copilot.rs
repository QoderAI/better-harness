use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    tool_family, truncate_prompt, Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall,
};
use crate::paths::{cwd_matches, home_dir, paths_from_value};
use crate::time::normalize_timestamp;

pub fn copilot_home() -> PathBuf {
    std::env::var("COPILOT_HOME")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| home_dir().join(".copilot"))
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&copilot_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let root = home.join("session-state");
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut sessions = Vec::new();
    for entry in fs::read_dir(&root)
        .map_err(|error| error.to_string())?
        .flatten()
    {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let dir = entry.path();
        if let Some(session) = read_session(workspace, &dir) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, dir: &Path) -> Option<SessionSummary> {
    let yaml = fs::read_to_string(dir.join("workspace.yaml")).ok();
    let yaml_cwd = yaml.as_deref().and_then(yaml_field_cwd);
    let yaml_id = yaml.as_deref().and_then(yaml_field_id);
    let events_path = dir.join("events.jsonl");
    if !events_path.is_file() {
        return None;
    }
    let text = fs::read_to_string(&events_path).ok()?;
    let mut session_id = yaml_id.unwrap_or_else(|| {
        dir.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("session")
            .to_string()
    });
    let mut first_seen = None;
    let mut last_seen = None;
    let mut prompts: Vec<Prompt> = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut last_response = None;
    let mut matched = yaml_cwd
        .as_deref()
        .is_some_and(|cwd| cwd_matches(workspace, cwd));
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
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        let data = record.get("data").cloned().unwrap_or(Value::Null);
        if kind == "session.start" {
            if let Some(id) = data.get("sessionId").and_then(Value::as_str) {
                session_id = id.to_string();
            }
            if let Some(cwd) = data.pointer("/context/cwd").and_then(Value::as_str) {
                if cwd_matches(workspace, cwd) {
                    matched = true;
                }
            }
        }
        if kind == "user.message" {
            if let Some(content) = data.get("content").and_then(Value::as_str) {
                let prompt = truncate_prompt(content);
                if !prompt.is_empty()
                    && prompts.len() < 8
                    && !prompts.iter().any(|item| item.text == prompt)
                {
                    prompts.push(Prompt {
                        text: prompt,
                        timestamp: stamp.clone(),
                    });
                }
            }
        }
        if kind == "assistant.message" {
            if let Some(content) = data.get("content").and_then(Value::as_str) {
                assistant_count += 1;
                last_response = Some(truncate_prompt(content));
            }
        }
        if kind.starts_with("tool.") || kind.contains("tool_call") {
            let name = data
                .get("toolName")
                .and_then(Value::as_str)
                .or_else(|| data.get("name").and_then(Value::as_str))
                .unwrap_or("tool");
            let paths = paths_from_value(workspace, &data);
            calls.push(ToolCall {
                id: format!("copilot-{}-{}", session_id, calls.len() + 1),
                family: tool_family(name),
                action_label: name.to_string(),
                tool_name: name.to_string(),
                status: "observed".into(),
                file_path: paths.first().cloned(),
                file_paths: paths,
                started_at: stamp,
                ..ToolCall::default()
            });
        }
    }
    if !matched {
        return None;
    }
    Some(SessionSummary {
        session_id,
        platform: "copilot".into(),
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

fn yaml_field_cwd(text: &str) -> Option<String> {
    yaml_field(text, "cwd")
}

fn yaml_field_id(text: &str) -> Option<String> {
    yaml_field(text, "id")
}

fn yaml_field(text: &str, key: &str) -> Option<String> {
    for line in text.lines() {
        let line = line.trim();
        let prefix = format!("{key}:");
        if let Some(rest) = line.strip_prefix(&prefix) {
            let value = rest.trim().trim_matches('"');
            if !value.is_empty() {
                return Some(value.to_string());
            }
        }
    }
    None
}
