use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, pi_session_dir_variants, walk_jsonl};
use crate::platforms::snapshot::{read_jsonl, stamp_of, text_of, Snapshot};

pub fn pi_home() -> PathBuf {
    env_home("PI_CODING_AGENT_DIR", ".pi/agent")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&pi_home(), workspace, max_sessions)
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
    let variants = pi_session_dir_variants(workspace);
    let mut sessions = Vec::new();
    let Ok(entries) = std::fs::read_dir(&root) else {
        return Ok(vec![]);
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let hit = variants.iter().any(|variant| {
            name == *variant || name.starts_with(&(variant.trim_end_matches('-').to_string() + "-"))
        });
        if !hit {
            continue;
        }
        for path in walk_jsonl(&entry.path(), 1, 20_000) {
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
    let records = read_jsonl(path);
    let mut header_seen = false;
    let fallback = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session");
    let mut snap = Snapshot::new(fallback, "pi");
    for record in records {
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        if !header_seen {
            if kind == "title" {
                continue;
            }
            if kind != "session" {
                return None;
            }
            header_seen = true;
            let Some(id) = record.get("id").and_then(Value::as_str) else {
                return None;
            };
            let Some(cwd) = record.get("cwd").and_then(Value::as_str) else {
                return None;
            };
            if !cwd_matches(workspace, cwd) {
                return None;
            }
            snap.session_id = id.to_string();
            snap.matched = true;
            snap.stamp(stamp_of(&record, &["timestamp"]));
            continue;
        }
        if kind == "session" {
            return None;
        }
        let stamp = stamp_of(&record, &["timestamp"]).or_else(|| {
            record
                .pointer("/message/timestamp")
                .and_then(|value| crate::time::normalize_timestamp(value))
        });
        snap.stamp(stamp.clone());
        if kind != "message" {
            continue;
        }
        let role = record
            .pointer("/message/role")
            .and_then(Value::as_str)
            .unwrap_or("");
        let content = record.pointer("/message/content");
        if role == "user" {
            snap.prompt(&text_of(content), stamp);
        } else if role == "assistant" {
            snap.assistant(&text_of(content));
            if let Some(Value::Array(blocks)) = content {
                for block in blocks {
                    if block.get("type").and_then(Value::as_str) != Some("toolCall") {
                        continue;
                    }
                    let name = block.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let id = block.get("id").and_then(Value::as_str).unwrap_or("");
                    let input = block.get("arguments").cloned().unwrap_or(Value::Null);
                    snap.tool(workspace, id, name, &input, stamp.clone());
                }
            }
        }
    }
    if !header_seen {
        return None;
    }
    snap.finish()
}
