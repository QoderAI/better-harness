use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::walk_named;
use crate::platforms::snapshot::{read_jsonl, stamp_of, Snapshot};

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(
        &workspace.join(".better-harness").join("harness-runs"),
        workspace,
        max_sessions,
    )
}

pub fn discover_from(
    root: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    if !root.is_dir() {
        return Ok(vec![]);
    }
    let mut sessions = Vec::new();
    for trace in walk_named(root, 6, 1_000, "trace.jsonl") {
        if let Some(session) = read_session(workspace, &trace) {
            sessions.push(session);
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(workspace: &Path, trace: &Path) -> Option<SessionSummary> {
    let trial = trace.parent()?;
    let variant = trial.parent()?;
    let revision: Value =
        serde_json::from_str(&fs::read_to_string(variant.join("revision.json")).ok()?).ok()?;
    let revision_id = revision.get("revisionId").and_then(Value::as_str)?;
    let session_id = format!(
        "{}:{}:{}",
        revision_id,
        variant.file_name()?.to_string_lossy(),
        trial.file_name()?.to_string_lossy()
    );
    let mut snap = Snapshot::new(session_id, "harness-run");
    snap.matched = true;
    if let Ok(meta) = fs::metadata(trace) {
        if let Ok(modified) = meta.modified() {
            if let Ok(duration) = modified.duration_since(std::time::UNIX_EPOCH) {
                snap.stamp(crate::time::normalize_timestamp(&Value::Number(
                    (duration.as_millis() as i64).into(),
                )));
            }
        }
    }
    for record in read_jsonl(trace) {
        snap.stamp(stamp_of(&record, &["timestamp"]));
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        if kind == "tool-call-started" {
            let name = record
                .get("toolName")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let id = record
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let input = record.get("input").cloned().unwrap_or(Value::Null);
            snap.tool(
                workspace,
                id,
                name,
                &input,
                stamp_of(&record, &["timestamp"]),
            );
        } else if kind == "tool-call-result" {
            let id = record
                .get("toolCallId")
                .and_then(Value::as_str)
                .unwrap_or("");
            let failed = record.get("isError").and_then(Value::as_bool) == Some(true);
            let output = record.get("content").and_then(Value::as_str).unwrap_or("");
            snap.tool_result(id, output, failed);
        }
    }
    snap.finish()
}
