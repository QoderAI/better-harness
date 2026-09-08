use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::SessionSummary;
use crate::paths::{cwd_matches, dsh_project_key, encode_dsh_session_id, env_home};
use crate::platforms::snapshot::{read_jsonl, read_zstd_jsonl, text_of, Snapshot};
use crate::time::normalize_timestamp;

pub fn dsh_home() -> PathBuf {
    env_home("DSH_HOME", ".dsh")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&dsh_home(), workspace, max_sessions)
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
    let expected_key = dsh_project_key(&workspace.to_string_lossy());
    let mut sessions = Vec::new();
    let Ok(projects) = fs::read_dir(&root) else {
        return Ok(vec![]);
    };
    for project in projects.flatten() {
        if !project
            .file_type()
            .map(|kind| kind.is_dir())
            .unwrap_or(false)
        {
            continue;
        }
        let project_name = project.file_name().to_string_lossy().into_owned();
        if project_name != expected_key {
            continue;
        }
        let Ok(session_dirs) = fs::read_dir(project.path()) else {
            continue;
        };
        for session_dir in session_dirs.flatten() {
            if !session_dir
                .file_type()
                .map(|kind| kind.is_dir())
                .unwrap_or(false)
            {
                continue;
            }
            let jsonl = session_dir.path().join("session.jsonl");
            let zstd = session_dir.path().join("session.jsonl.zstd");
            let artifact = match (jsonl.is_file(), zstd.is_file()) {
                (true, false) => jsonl,
                (false, true) => zstd,
                _ => continue,
            };
            if let Some(session) = read_session(
                workspace,
                &artifact,
                &project_name,
                &session_dir.file_name().to_string_lossy(),
            ) {
                sessions.push(session);
            }
        }
    }
    sessions.sort_by(|left, right| right.last_seen.cmp(&left.last_seen));
    sessions.truncate(max_sessions);
    Ok(sessions)
}

fn read_session(
    workspace: &Path,
    path: &Path,
    project_segment: &str,
    session_segment: &str,
) -> Option<SessionSummary> {
    let records = if path.extension().and_then(|ext| ext.to_str()) == Some("zstd") {
        read_zstd_jsonl(path)
    } else {
        read_jsonl(path)
    };
    let header = records.first()?;
    if header.get("type").and_then(Value::as_str) != Some("session") {
        return None;
    }
    let id = header.get("id").and_then(Value::as_str)?;
    let cwd = header.get("cwd").and_then(Value::as_str)?;
    if encode_dsh_session_id(id) != session_segment {
        return None;
    }
    if dsh_project_key(cwd) != project_segment {
        return None;
    }
    if !cwd_matches(workspace, cwd) {
        return None;
    }
    let mut snap = Snapshot::new(id, "dsh");
    snap.matched = true;
    snap.stamp(
        header
            .get("createdAt")
            .and_then(|value| normalize_timestamp(value)),
    );
    for record in records.iter().skip(1) {
        let kind = record.get("type").and_then(Value::as_str).unwrap_or("");
        let stamp = record
            .get("time")
            .and_then(|value| normalize_timestamp(value));
        snap.stamp(stamp.clone());
        match kind {
            "user/message" => {
                let source = record.pointer("/data/source/kind").and_then(Value::as_str);
                if source != Some("user") {
                    continue;
                }
                snap.prompt(&text_of(record.pointer("/data/content")), stamp);
            }
            "assistant/message" => {
                snap.assistant(&text_of(record.pointer("/data/message/content")));
                if let Some(model) = record
                    .pointer("/data/message/source/model")
                    .and_then(Value::as_str)
                {
                    snap.observe_model(model);
                }
                if let Some(usage) = record.get("data").and_then(|data| data.get("usage")) {
                    snap.observe_usage(usage);
                }
            }
            "tool/call" => {
                let name = record
                    .pointer("/data/name")
                    .and_then(Value::as_str)
                    .unwrap_or("tool");
                let id = record
                    .pointer("/data/callId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let input = record
                    .pointer("/data/arguments")
                    .and_then(Value::as_str)
                    .and_then(|text| serde_json::from_str(text).ok())
                    .unwrap_or(Value::Null);
                snap.tool(workspace, id, name, &input, stamp);
            }
            "tool/result" => {
                let id = record
                    .pointer("/data/message/source/callId")
                    .and_then(Value::as_str)
                    .unwrap_or("");
                let failed = record
                    .pointer("/data/message/content/0/isError")
                    .and_then(Value::as_bool)
                    == Some(true);
                let output = text_of(record.pointer("/data/message/content/0/content"));
                snap.tool_result(id, &output, failed);
            }
            _ => {}
        }
    }
    snap.finish()
}
