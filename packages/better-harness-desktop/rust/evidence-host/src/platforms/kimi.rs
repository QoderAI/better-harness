use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, walk_named};
use crate::platforms::snapshot::{read_jsonl, stamp_of, text_of, Snapshot};
use crate::time::normalize_timestamp;

pub fn kimi_home() -> PathBuf {
    env_home("KIMI_HOME", ".kimi-code")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&kimi_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let sessions_root = home.join("sessions");
    if !sessions_root.is_dir() {
        return Ok(vec![]);
    }
    let index_roots = load_workspace_index(home);
    let session_dirs = load_session_index(home);
    let fallback = format!(
        "wd_{}_",
        workspace
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("")
            .to_ascii_lowercase()
    );
    let indexes_empty = index_roots.is_empty() && session_dirs.is_empty();
    let mut sessions = Vec::new();
    let Ok(workspace_dirs) = fs::read_dir(&sessions_root) else {
        return Ok(vec![]);
    };
    for entry in workspace_dirs.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let workspace_id = entry.file_name().to_string_lossy().into_owned();
        if !workspace_id.starts_with("wd_") {
            continue;
        }
        let qualified = if let Some(root) = index_roots.get(&workspace_id) {
            cwd_matches(workspace, root)
        } else if indexes_empty {
            workspace_id.to_ascii_lowercase().starts_with(&fallback)
        } else {
            true
        };
        if !qualified {
            continue;
        }
        let Ok(session_entries) = fs::read_dir(entry.path()) else {
            continue;
        };
        for session_entry in session_entries.flatten() {
            if !session_entry
                .file_type()
                .map(|kind| kind.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let session_id = session_entry.file_name().to_string_lossy().into_owned();
            if !session_id.to_ascii_lowercase().starts_with("ses") {
                continue;
            }
            if let Some(work_dir) = session_dirs.get(&session_entry.path()) {
                if !cwd_matches(workspace, work_dir) {
                    continue;
                }
            }
            if let Some(session) = read_session(workspace, &session_entry.path(), &session_id) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn load_workspace_index(home: &Path) -> std::collections::HashMap<String, String> {
    let mut roots = std::collections::HashMap::new();
    let Ok(text) = fs::read_to_string(home.join("workspaces.json")) else {
        return roots;
    };
    let Ok(Value::Object(data)) = serde_json::from_str::<Value>(&text) else {
        return roots;
    };
    let Some(Value::Object(workspaces)) = data.get("workspaces") else {
        return roots;
    };
    for (id, record) in workspaces {
        if let Some(root) = record.get("root").and_then(Value::as_str) {
            roots.insert(id.clone(), root.to_string());
        }
    }
    roots
}

fn load_session_index(home: &Path) -> std::collections::HashMap<PathBuf, String> {
    let mut dirs = std::collections::HashMap::new();
    for record in read_jsonl(&home.join("session_index.jsonl")) {
        let Some(session_dir) = record.get("sessionDir").and_then(Value::as_str) else {
            continue;
        };
        let Some(work_dir) = record.get("workDir").and_then(Value::as_str) else {
            continue;
        };
        dirs.insert(PathBuf::from(session_dir), work_dir.to_string());
    }
    dirs
}

fn read_session(workspace: &Path, session_dir: &Path, session_id: &str) -> Option<SessionSummary> {
    let wires = walk_named(&session_dir.join("agents"), 2, 200, "wire.jsonl");
    if wires.is_empty() {
        return None;
    }
    let state: Value = fs::read_to_string(session_dir.join("state.json"))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or(Value::Null);
    let mut snap = Snapshot::new(session_id, "kimi");
    snap.matched = true;
    snap.stamp(stamp_of(&state, &["createdAt", "updatedAt"]));
    if let Some(title) = state.get("title").and_then(Value::as_str) {
        snap.prompt(title, snap.first_seen.clone());
    }
    for wire in &wires {
        for record in read_jsonl(&wire) {
            let stamp = stamp_of(&record, &["time", "timestamp", "created_at"]);
            snap.stamp(stamp.clone());
            let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
            if kind == "turn.prompt" || kind == "turn.steer" {
                snap.prompt(&text_of(record.get("input")), stamp);
            } else if kind == "context.append_message" {
                let message = record.get("message").unwrap_or(&Value::Null);
                let role = message.get("role").and_then(Value::as_str).unwrap_or("");
                let text = text_of(message.get("content"));
                if role == "user" {
                    snap.prompt(&text, stamp.clone());
                } else if role == "assistant" {
                    snap.assistant(&text);
                }
                if let Some(Value::Array(calls)) = message.get("toolCalls") {
                    for call in calls {
                        let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
                        let id = call
                            .get("id")
                            .or_else(|| call.get("toolCallId"))
                            .and_then(Value::as_str)
                            .unwrap_or("");
                        let input = call
                            .get("args")
                            .or_else(|| call.get("input"))
                            .cloned()
                            .unwrap_or(Value::Null);
                        snap.tool(workspace, id, name, &input, stamp.clone());
                    }
                }
            } else if kind == "context.append_loop_event" {
                let event = record.get("event").unwrap_or(&Value::Null);
                if event.get("type").and_then(Value::as_str) == Some("tool.call") {
                    let name = event.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let id = event
                        .get("toolCallId")
                        .or_else(|| event.get("uuid"))
                        .and_then(Value::as_str)
                        .unwrap_or("");
                    let input = event.get("args").cloned().unwrap_or(Value::Null);
                    snap.tool(workspace, id, name, &input, stamp);
                } else if event.get("type").and_then(Value::as_str) == Some("content.part") {
                    let part = event.get("part").unwrap_or(&Value::Null);
                    if part.get("type").and_then(Value::as_str) == Some("text") {
                        snap.assistant(&text_of(part.get("text")));
                    }
                }
            }
        }
    }
    if snap.first_seen.is_none() {
        if let Some(mtime) = wires
            .iter()
            .filter_map(|path| fs::metadata(path).and_then(|meta| meta.modified()).ok())
            .max()
        {
            let millis = mtime
                .duration_since(std::time::UNIX_EPOCH)
                .ok()
                .map(|duration| duration.as_millis() as i64)?;
            snap.stamp(normalize_timestamp(&Value::Number(millis.into())));
        }
    }
    snap.finish()
}
