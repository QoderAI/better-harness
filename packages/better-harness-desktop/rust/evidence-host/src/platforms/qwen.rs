use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, env_home, qwen_slug_variants, walk_jsonl};
use crate::platforms::snapshot::{read_jsonl, stamp_of, text_of, Snapshot};

pub fn qwen_home() -> PathBuf {
    std::env::var("QWEN_RUNTIME_DIR")
        .ok()
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| env_home("QWEN_HOME", ".qwen"))
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&qwen_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let mut sessions = Vec::new();
    let mut seen = HashSet::new();
    for slug in qwen_slug_variants(workspace) {
        let root = home.join("projects").join(slug).join("chats");
        let Ok(real) = fs::canonicalize(&root) else {
            continue;
        };
        if !seen.insert(real) {
            continue;
        }
        for path in walk_jsonl(&root, 2, 20_000) {
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
    let fallback = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session");
    let mut snap = Snapshot::new(fallback, "qwen");
    for record in read_jsonl(path) {
        if let Some(id) = record
            .get("sessionId")
            .or_else(|| record.get("session_id"))
            .and_then(Value::as_str)
        {
            snap.session_id = id.to_string();
        }
        if let Some(cwd) = record.get("cwd").and_then(Value::as_str) {
            if cwd_matches(workspace, cwd) {
                snap.matched = true;
            }
        }
        let stamp = stamp_of(&record, &["timestamp", "ts", "_timestamp"]);
        snap.stamp(stamp.clone());
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        let parts = record
            .pointer("/message/parts")
            .or_else(|| record.pointer("/message/content"))
            .or_else(|| record.get("parts"));
        if kind == "user" {
            snap.prompt(&text_of(parts), stamp);
        } else if kind == "assistant" {
            snap.assistant(&text_of(parts));
            if let Some(model) = record
                .get("model")
                .or_else(|| record.pointer("/message/model"))
                .and_then(Value::as_str)
            {
                snap.observe_model(model);
            }
            if let Some(usage) = record
                .get("usageMetadata")
                .or_else(|| record.pointer("/message/usageMetadata"))
                .or_else(|| record.get("usage"))
            {
                snap.observe_usage(usage);
            }
            if let Some(Value::Array(items)) = parts {
                for part in items {
                    let Some(call) = part.get("functionCall") else {
                        continue;
                    };
                    let name = call.get("name").and_then(Value::as_str).unwrap_or("tool");
                    let id = call.get("id").and_then(Value::as_str).unwrap_or("");
                    let input = call.get("args").cloned().unwrap_or(Value::Null);
                    snap.tool(workspace, id, name, &input, stamp.clone());
                }
            }
        } else if kind == "tool_result" {
            let tcr = record.get("toolCallResult").unwrap_or(&Value::Null);
            let fr = parts.and_then(|value| {
                value
                    .as_array()?
                    .iter()
                    .find_map(|part| part.get("functionResponse"))
            });
            let id = tcr
                .get("callId")
                .or_else(|| fr.and_then(|value| value.get("id")))
                .and_then(Value::as_str)
                .unwrap_or("");
            let failed = tcr.get("errorType").is_some()
                || tcr
                    .get("status")
                    .and_then(Value::as_str)
                    .is_some_and(|status| matches!(status, "error" | "failed" | "cancelled"));
            let output = tcr
                .get("resultDisplay")
                .and_then(Value::as_str)
                .unwrap_or("");
            snap.tool_result(id, output, failed);
        }
    }
    snap.finish()
}
