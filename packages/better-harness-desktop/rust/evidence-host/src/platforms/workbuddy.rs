use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, walk_jsonl, workbuddy_slug_variants};
use crate::platforms::snapshot::{read_jsonl, stamp_of, text_of, Snapshot};

pub fn workbuddy_home() -> PathBuf {
    env_home("WORKBUDDY_DIR", ".workbuddy")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&workbuddy_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let projects = home.join("projects");
    if !projects.is_dir() {
        return Ok(vec![]);
    }
    let variants = workbuddy_slug_variants(workspace);
    let mut sessions = Vec::new();
    let Ok(entries) = std::fs::read_dir(&projects) else {
        return Ok(vec![]);
    };
    for entry in entries.flatten() {
        if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        let matched = variants
            .iter()
            .any(|exact| name == *exact || name.starts_with(&format!("{exact}-")));
        if !matched {
            continue;
        }
        for path in walk_jsonl(&entry.path(), 1, 20_000) {
            if let Some(session) = read_session(workspace, &path, name == variants[0]) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, path: &Path, exact_dir: bool) -> Option<SessionSummary> {
    let fallback = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session");
    let mut snap = Snapshot::new(fallback, "workbuddy");
    let mut cwd_observed = false;
    let mut foreign = false;
    for record in read_jsonl(path) {
        if let Some(id) = record.get("sessionId").and_then(Value::as_str) {
            snap.session_id = id.to_string();
        }
        if let Some(cwd) = record.get("cwd").and_then(Value::as_str) {
            cwd_observed = true;
            if cwd_matches(workspace, cwd) {
                snap.matched = true;
            } else {
                foreign = true;
            }
        }
        let stamp = stamp_of(&record, &["timestamp"]);
        snap.stamp(stamp.clone());
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        let role = record.get("role").and_then(Value::as_str).unwrap_or("");
        if let Some(model) = record
            .pointer("/providerData/model")
            .or_else(|| record.pointer("/providerData/requestModelId"))
            .and_then(Value::as_str)
        {
            snap.observe_model(model);
        }
        if let Some(usage) = record
            .pointer("/providerData/usage")
            .or_else(|| record.pointer("/message/usage"))
        {
            snap.observe_usage(usage);
        }
        if kind == "message" && role == "user" {
            snap.prompt(&text_of(record.get("content")), stamp);
        } else if kind == "message" && role == "assistant" {
            snap.assistant(&text_of(record.get("content")));
        } else if kind == "function_call" {
            let name = record.get("name").and_then(Value::as_str).unwrap_or("tool");
            let id = record.get("callId").and_then(Value::as_str).unwrap_or("");
            let input = parse_args(record.get("arguments"));
            snap.tool(workspace, id, name, &input, stamp);
        } else if kind == "function_call_result" {
            let id = record.get("callId").and_then(Value::as_str).unwrap_or("");
            let failed = record
                .get("status")
                .and_then(Value::as_str)
                .is_some_and(|status| status != "completed");
            let output = match record.get("output") {
                Some(Value::String(text)) => text.clone(),
                other => text_of(other),
            };
            snap.tool_result(id, &output, failed);
        }
    }
    if cwd_observed {
        if foreign || !snap.matched {
            return None;
        }
    } else if exact_dir {
        snap.matched = true;
    } else {
        return None;
    }
    snap.finish()
}

fn parse_args(value: Option<&Value>) -> Value {
    match value {
        Some(Value::Object(_)) => value.cloned().unwrap_or(Value::Null),
        Some(Value::String(text)) => serde_json::from_str(text).unwrap_or(Value::Null),
        _ => Value::Null,
    }
}
