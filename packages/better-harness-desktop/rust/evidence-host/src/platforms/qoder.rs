use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{Prompt, SessionSummary, ToolActivity, ToolCall, truncate_prompt, tool_family};
use crate::paths::{home_dir, qoder_slug_variants, repo_relative};
use crate::time::normalize_timestamp;

pub fn qoder_home() -> PathBuf {
    home_dir().join(".qoder")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&qoder_home(), workspace, max_sessions)
}

pub fn discover_from(home: &Path, workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    let mut dirs = Vec::new();
    for slug in qoder_slug_variants(workspace) {
        let root = home.join("logs").join("sessions").join(&slug);
        if !root.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&root).map_err(|error| error.to_string())?.flatten() {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok();
            dirs.push((modified, path, entry.file_name().to_string_lossy().into_owned()));
        }
    }
    dirs.sort_by(|left, right| right.0.cmp(&left.0));
    dirs.truncate(max_sessions);
    let mut sessions = Vec::new();
    for (_, path, id) in dirs {
        if let Some(session) = read_session(workspace, &path, &id) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    Ok(sessions)
}

fn read_session(workspace: &Path, session_dir: &Path, session_id: &str) -> Option<SessionSummary> {
    let segments = session_dir.join("segments");
    let mut first_seen = None;
    let mut last_seen = None;
    let mut prompts: Vec<Prompt> = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let Ok(entries) = fs::read_dir(&segments) else {
        return None;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl") {
            continue;
        }
        let Ok(text) = fs::read_to_string(&path) else {
            continue;
        };
        for line in text.lines() {
            let Ok(record) = serde_json::from_str::<Value>(line) else {
                continue;
            };
            let stamp = normalize_timestamp(record.get("ts").unwrap_or(&Value::Null));
            if first_seen.is_none() {
                first_seen = stamp.clone();
            }
            if stamp.is_some() {
                last_seen = stamp.clone();
            }
            let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
            if kind == "input.prompt.received" || kind == "input.prompt.submitted" {
                if let Some(preview) = record.pointer("/data/text_preview").and_then(Value::as_str) {
                    let prompt_text = truncate_prompt(preview);
                    if !prompt_text.is_empty()
                        && prompts.len() < 8
                        && !prompts.iter().any(|prompt| prompt.text == prompt_text)
                    {
                        prompts.push(Prompt {
                            text: prompt_text,
                            timestamp: stamp.clone(),
                        });
                    }
                }
            }
            if kind == "model.response.completed" {
                assistant_count += 1;
            }
            if kind.contains("tool") {
                let name = record
                    .pointer("/data/tool")
                    .and_then(Value::as_str)
                    .or_else(|| record.pointer("/data/name").and_then(Value::as_str))
                    .unwrap_or("tool");
                let mut paths = Vec::new();
                for key in ["/data/path", "/data/file", "/data/file_path"] {
                    if let Some(value) = record.pointer(key).and_then(Value::as_str) {
                        if let Some(relative) = repo_relative(workspace, value) {
                            paths.push(relative);
                        }
                    }
                }
                calls.push(ToolCall {
                    id: format!("qoder-{}-{}", session_id, calls.len() + 1),
                    family: tool_family(name),
                    action_label: name.to_string(),
                    tool_name: name.to_string(),
                    status: "observed".into(),
                    file_path: paths.first().cloned(),
                    file_paths: paths,
                    started_at: stamp,
                });
            }
        }
    }
    if first_seen.is_none() {
        if let Ok(modified) = fs::metadata(session_dir).and_then(|meta| meta.modified()) {
            if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                let stamp = crate::time::normalize_timestamp(&serde_json::json!(elapsed.as_millis() as u64));
                first_seen = stamp.clone();
                last_seen = last_seen.or(stamp);
            }
        }
    }
    Some(SessionSummary {
        session_id: session_id.to_string(),
        platform: "qoder".into(),
        last_seen: last_seen.clone().or(first_seen.clone()),
        first_seen,
        prompt_count: prompts.len() as u32,
        assistant_message_count: assistant_count,
        tool_call_count: calls.len() as u32,
        prompts,
        tool_activity: Some(ToolActivity { calls }),
        dialogue: None,
    })
}
