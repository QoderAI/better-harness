use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, expand_home, pi_session_dir_variants, walk_jsonl};
use crate::platforms::snapshot::{read_jsonl, stamp_of, text_of, Snapshot};
use crate::time::millis;

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
    let files = session_files(home, workspace);
    let mut probes = Vec::new();
    for path in files {
        if let Some(probe) = probe_session(workspace, &path) {
            probes.push(probe);
        }
    }
    let discovered: HashSet<String> = probes.iter().map(|probe| probe.id.clone()).collect();
    let mut sessions = Vec::new();
    for probe in probes {
        let cutoff = probe
            .parent
            .as_ref()
            .filter(|parent| discovered.contains(*parent))
            .and_then(|_| probe.fork_millis);
        if let Some(session) = read_session(workspace, &probe.path, cutoff) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

struct Probe {
    path: PathBuf,
    id: String,
    parent: Option<String>,
    fork_millis: Option<i64>,
}

fn session_files(home: &Path, workspace: &Path) -> Vec<PathBuf> {
    if let Some(custom) = resolve_custom_session_dir(home, workspace) {
        return if custom.is_dir() {
            walk_jsonl(&custom, 1, 20_000)
        } else {
            Vec::new()
        };
    }
    let root = home.join("sessions");
    if !root.is_dir() {
        return Vec::new();
    }
    let variants = pi_session_dir_variants(workspace);
    let mut files = Vec::new();
    let Ok(entries) = fs::read_dir(&root) else {
        return files;
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
        files.extend(walk_jsonl(&entry.path(), 1, 20_000));
    }
    files
}

fn resolve_custom_session_dir(home: &Path, workspace: &Path) -> Option<PathBuf> {
    if let Ok(value) = std::env::var("PI_CODING_AGENT_SESSION_DIR") {
        if !value.trim().is_empty() {
            return Some(resolve_session_dir(&value, workspace));
        }
    }
    for candidate in [
        workspace.join(".pi").join("settings.json"),
        home.join("settings.json"),
    ] {
        if let Some(value) = read_settings_session_dir(&candidate) {
            return Some(resolve_session_dir(&value, workspace));
        }
    }
    None
}

fn read_settings_session_dir(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    let value: Value = serde_json::from_str(&text).ok()?;
    value
        .get("sessionDir")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn resolve_session_dir(value: &str, workspace: &Path) -> PathBuf {
    let expanded = expand_home(value);
    if expanded.is_absolute() {
        expanded
    } else {
        workspace.join(expanded)
    }
}

fn probe_session(workspace: &Path, path: &Path) -> Option<Probe> {
    let records = read_jsonl(path);
    for record in records {
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "title" {
            continue;
        }
        if kind != "session" {
            return None;
        }
        let id = record.get("id").and_then(Value::as_str)?;
        let cwd = record.get("cwd").and_then(Value::as_str)?;
        if !cwd_matches(workspace, cwd) {
            return None;
        }
        let parent = record
            .get("parentSession")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        return Some(Probe {
            path: path.to_path_buf(),
            id: id.to_string(),
            fork_millis: parent.as_ref().and_then(|_| millis_of(&record)),
            parent,
        });
    }
    None
}

fn read_session(workspace: &Path, path: &Path, fork_cutoff: Option<i64>) -> Option<SessionSummary> {
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
            snap.session_id = id.to_string();
            snap.matched = true;
            snap.stamp(stamp_of(&record, &["timestamp"]));
            continue;
        }
        if kind == "session" {
            return None;
        }
        if let Some(cutoff) = fork_cutoff {
            if millis_of(&record).is_some_and(|stamp| stamp < cutoff) {
                continue;
            }
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
            if let Some(model) = record.pointer("/message/model").and_then(Value::as_str) {
                snap.observe_model(model);
            }
            if let Some(usage) = record
                .get("message")
                .and_then(|message| message.get("usage"))
            {
                snap.observe_usage(usage);
            }
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
        } else if role == "toolResult" {
            let id = record
                .pointer("/message/toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let failed = record.pointer("/message/isError").and_then(Value::as_bool) == Some(true);
            snap.tool_result(id, &text_of(content), failed);
        }
    }
    if !header_seen {
        return None;
    }
    snap.finish()
}

fn millis_of(record: &Value) -> Option<i64> {
    record
        .get("timestamp")
        .and_then(millis)
        .or_else(|| record.pointer("/message/timestamp").and_then(millis))
}
