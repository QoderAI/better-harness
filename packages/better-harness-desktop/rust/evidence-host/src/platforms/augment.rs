use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, walk_json};
use crate::platforms::snapshot::{stamp_of, text_of, Snapshot};
use crate::time::normalize_timestamp;

pub fn augment_home() -> PathBuf {
    env_home("AUGMENT_HOME", ".augment")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&augment_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let root = home.join("sessions");
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut sessions = Vec::new();
    for path in walk_json(&root, 0, 20_000) {
        if let Some(session) = read_session(workspace, &path) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, path: &Path) -> Option<SessionSummary> {
    let record: Value = serde_json::from_str(&fs::read_to_string(path).ok()?).ok()?;
    if !record.is_object() {
        return None;
    }
    let filename_id = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session");
    let session_id = record
        .get("sessionId")
        .and_then(Value::as_str)
        .unwrap_or(filename_id);
    if !workspace_qualified(&record, workspace) {
        return None;
    }
    let mut snap = Snapshot::new(session_id, "augment");
    snap.matched = true;
    snap.stamp(stamp_of(&record, &["created", "modified"]));
    let history = record.get("chatHistory").and_then(Value::as_array)?;
    for entry in history {
        let exchange = entry.get("exchange").unwrap_or(entry);
        snap.stamp(exchange_stamp(entry, false));
        snap.stamp(exchange_stamp(entry, true));
        let request = exchange.get("request_nodes").and_then(Value::as_array);
        let response = exchange.get("response_nodes").and_then(Value::as_array);
        let request_text = request_text(exchange, request);
        if !request_text.is_empty() {
            snap.prompt(&request_text, exchange_stamp(entry, false));
        }
        let response_text = response_text(exchange, response);
        if !response_text.is_empty() {
            snap.assistant(&response_text);
        }
        if let Some(nodes) = response {
            for node in nodes {
                if let Some(tool) = node.get("tool_use") {
                    let name = tool
                        .get("tool_name")
                        .and_then(Value::as_str)
                        .unwrap_or("tool");
                    let id = tool
                        .get("tool_use_id")
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let input = parse_tool_input(tool.get("input_json"));
                    let started = tool
                        .get("started_at_ms")
                        .and_then(|value| normalize_timestamp(value));
                    snap.tool(workspace, id, name, &input, started);
                }
            }
        }
    }
    snap.finish()
}

fn workspace_qualified(record: &Value, workspace: &Path) -> bool {
    let mut roots = Vec::new();
    let mut cwds = Vec::new();
    let Some(history) = record.get("chatHistory").and_then(Value::as_array) else {
        return false;
    };
    for entry in history {
        let Some(nodes) = entry
            .pointer("/exchange/request_nodes")
            .and_then(Value::as_array)
        else {
            continue;
        };
        for node in nodes {
            let Some(ide) = node.get("ide_state_node") else {
                continue;
            };
            if let Some(Value::Array(folders)) = ide.get("workspace_folders") {
                for folder in folders {
                    for key in ["folder_root", "repository_root"] {
                        if let Some(candidate) = folder.get(key).and_then(Value::as_str) {
                            roots.push(candidate.to_string());
                        }
                    }
                }
            }
            if let Some(cwd) = ide
                .pointer("/current_terminal/current_working_directory")
                .and_then(Value::as_str)
            {
                cwds.push(cwd.to_string());
            }
        }
    }
    let candidates = if roots.is_empty() { cwds } else { roots };
    !candidates.is_empty()
        && candidates
            .iter()
            .all(|candidate| cwd_matches(workspace, candidate))
}

fn request_text(exchange: &Value, nodes: Option<&Vec<Value>>) -> String {
    let mut parts = Vec::new();
    if let Some(nodes) = nodes {
        for node in nodes {
            if let Some(text) = node.pointer("/text_node/content").and_then(Value::as_str) {
                parts.push(text.to_string());
            }
        }
    }
    if !parts.is_empty() {
        return parts.join("\n");
    }
    text_of(exchange.get("request_message"))
}

fn response_text(exchange: &Value, nodes: Option<&Vec<Value>>) -> String {
    let mut parts = Vec::new();
    if let Some(nodes) = nodes {
        for node in nodes {
            if node.get("type").and_then(Value::as_i64) == Some(0) {
                if let Some(text) = node.get("content").and_then(Value::as_str) {
                    parts.push(text.to_string());
                }
            }
        }
    }
    if !parts.is_empty() {
        return parts.join("\n");
    }
    text_of(exchange.get("response_text"))
}

fn exchange_stamp(entry: &Value, end: bool) -> Option<String> {
    let exchange = entry.get("exchange").unwrap_or(entry);
    let mut times = Vec::new();
    for key in ["request_nodes", "response_nodes"] {
        if let Some(Value::Array(nodes)) = exchange.get(key) {
            for node in nodes {
                if let Some(stamp) = stamp_of(node, &["timestamp_ms"]).or_else(|| {
                    node.pointer("/tool_use/started_at_ms")
                        .and_then(|value| normalize_timestamp(value))
                }) {
                    times.push(stamp);
                }
            }
        }
    }
    if times.is_empty() {
        return stamp_of(entry, &["finishedAt", "finished_at"]);
    }
    times.sort();
    if end {
        times.pop()
    } else {
        times.into_iter().next()
    }
}

fn parse_tool_input(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Object(_)) => value.cloned().unwrap_or(Value::Null),
        Some(Value::String(text)) => serde_json::from_str(text).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}
