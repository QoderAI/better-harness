use std::fs;
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{evidence_excerpt, tool_family, Prompt, SessionSummary, ToolActivity, ToolCall};
use crate::paths::{home_dir, qoder_slug_variants, tool_paths};
use crate::time::{millis, normalize_timestamp};

pub fn qoder_home() -> PathBuf {
    home_dir().join(".qoder")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&qoder_home(), workspace, max_sessions)
}

pub fn discover_from(
    home: &Path,
    workspace: &Path,
    max_sessions: usize,
) -> Result<Vec<SessionSummary>, String> {
    let mut dirs = Vec::new();
    for slug in qoder_slug_variants(workspace) {
        let root = home.join("logs").join("sessions").join(&slug);
        if !root.is_dir() {
            continue;
        }
        for entry in fs::read_dir(&root)
            .map_err(|error| error.to_string())?
            .flatten()
        {
            if !entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false) {
                continue;
            }
            let path = entry.path();
            let modified = fs::metadata(&path).and_then(|meta| meta.modified()).ok();
            dirs.push((
                modified,
                path,
                entry.file_name().to_string_lossy().into_owned(),
            ));
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
    let mut models = Vec::new();
    let mut usage = serde_json::Map::new();
    let Ok(entries) = fs::read_dir(&segments) else {
        return None;
    };
    let mut paths: Vec<_> = entries.flatten().map(|entry| entry.path()).collect();
    paths.sort();
    let mut records: Vec<Value> = paths
        .iter()
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("jsonl"))
        .filter_map(|path| fs::read_to_string(path).ok())
        .flat_map(|text| {
            text.lines()
                .filter_map(|line| serde_json::from_str::<Value>(line).ok())
                .collect::<Vec<_>>()
        })
        .collect();
    records.sort_by_key(|record| (millis(&record["ts"]), record["seq"].as_u64()));
    let has_submitted = records
        .iter()
        .any(|record| record["type"] == "input.prompt.submitted");
    let mut call_indices = std::collections::HashMap::<String, usize>::new();
    for record in records {
        let stamp = normalize_timestamp(&record["ts"]);
        if first_seen.is_none() {
            first_seen = stamp.clone();
        }
        if stamp.is_some() {
            last_seen = stamp.clone();
        }
        let kind = record["type"].as_str().unwrap_or("");
        if kind == "input.prompt.submitted" || (!has_submitted && kind == "input.prompt.received") {
            if let Some(text) = record["data"]["text_preview"].as_str() {
                if !text.trim().is_empty() {
                    prompts.push(Prompt {
                        text: evidence_excerpt(text),
                        timestamp: stamp.clone(),
                    });
                }
            }
        }
        if kind == "model.response.completed" {
            assistant_count += 1;
            if let Some(model) = record["data"]["model"].as_str() {
                if !models.contains(&model.to_string()) {
                    models.push(model.into());
                }
            }
            for (source, target) in [
                ("input_tokens", "inputTokens"),
                ("output_tokens", "outputTokens"),
                ("cache_read_input_tokens", "cacheReadInputTokens"),
                ("cache_creation_input_tokens", "cacheCreationInputTokens"),
            ] {
                if let Some(value) = record["data"][source].as_u64() {
                    let previous = usage.get(target).and_then(Value::as_u64).unwrap_or(0);
                    usage.insert(target.into(), previous.saturating_add(value).into());
                }
            }
        }
        let id = record["tool_call_id"].as_str().unwrap_or("");
        if kind == "tool.requested" && (id.is_empty() || !call_indices.contains_key(id)) {
            let name = record["data"]["tool_name"].as_str().unwrap_or("tool");
            let args = &record["data"]["args"];
            let paths = tool_paths(workspace, args);
            if !id.is_empty() {
                call_indices.insert(id.to_string(), calls.len());
            }
            calls.push(ToolCall {
                id: if id.is_empty() {
                    format!("qoder-{session_id}-{}", calls.len())
                } else {
                    id.to_string()
                },
                family: tool_family(name),
                action_label: name.into(),
                tool_name: name.into(),
                status: "observed".into(),
                file_path: paths.first().cloned(),
                file_paths: paths,
                detail: (!args.is_null()).then(|| evidence_excerpt(&args.to_string())),
                started_at: stamp.clone(),
                ..ToolCall::default()
            });
        } else if kind == "tool.shell.finished" {
            if let Some(index) = call_indices.get(id) {
                let call = &mut calls[*index];
                let data = &record["data"];
                let mut observation = serde_json::Map::new();
                for key in ["exit_code", "aborted", "binary_output", "output_length"] {
                    if let Some(value) = data
                        .get(key)
                        .filter(|value| value.is_number() || value.is_boolean())
                    {
                        observation.insert(key.into(), value.clone());
                    }
                }
                if !observation.is_empty() {
                    observation.insert("text_retained".into(), false.into());
                    call.output = Some(Value::Object(observation).to_string());
                }
                if data["aborted"] == true {
                    call.status = "interrupted".into();
                } else if data["exit_code"].as_i64().is_some_and(|code| code != 0) {
                    call.status = "failed".into();
                }
            }
        } else if kind == "tool.execution.finished" {
            if let Some(index) = call_indices.get(id) {
                let call = &mut calls[*index];
                call.status = match record["data"]["status"].as_str() {
                    Some("success" | "completed") => "completed",
                    Some("failed" | "error") => "failed",
                    _ => "observed",
                }
                .into();
                if let Some(text) = record["data"]["text_preview"].as_str() {
                    call.output = Some(evidence_excerpt(text));
                }
                call.duration_ms = call
                    .started_at
                    .as_ref()
                    .and_then(|start| millis(&Value::String(start.clone())))
                    .zip(millis(&record["ts"]))
                    .and_then(|(start, end)| (end >= start).then_some(end - start));
            }
        }
    }
    if first_seen.is_none() {
        if let Ok(modified) = fs::metadata(session_dir).and_then(|meta| meta.modified()) {
            if let Ok(elapsed) = modified.duration_since(std::time::UNIX_EPOCH) {
                let stamp = crate::time::normalize_timestamp(&serde_json::json!(
                    elapsed.as_millis() as u64
                ));
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
        models,
        token_usage: (!usage.is_empty()).then_some(Value::Object(usage)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn correlates_segmented_request_lifecycle_without_counting_shell_events() {
        let root = std::env::temp_dir().join(format!("qoder-evidence-{}", std::process::id()));
        let segments = root.join("segments");
        fs::create_dir_all(&segments).unwrap();
        let record = |seq: u64, kind: &str, data: Value| {
            json!({"seq":seq,"ts":1788845900000u64 + seq * 1000,"type":kind,"tool_call_id":"c1","data":data}).to_string()
        };
        fs::write(segments.join("z.jsonl"), [
            record(1, "input.prompt.received", json!({"text_preview":"Review changes"})),
            record(2, "input.prompt.submitted", json!({"text_preview":"Review changes"})),
            record(3, "tool.requested", json!({"tool_name":"Bash","args":{"command":"git status", "file_path":"src/main.rs"}})),
        ].join("\n")).unwrap();
        fs::write(
            segments.join("a.jsonl"),
            [
                record(4, "tool.shell.started", json!({})),
                record(5, "tool.shell.finished", json!({"exit_code":0})),
                record(6, "tool.execution.finished", json!({"status":"success"})),
                record(
                    7,
                    "model.response.completed",
                    json!({"model":"fixture","input_tokens":20,"output_tokens":4}),
                ),
            ]
            .join("\n"),
        )
        .unwrap();
        let parsed = read_session(&root, &root, "session").unwrap();
        fs::remove_dir_all(&root).unwrap();
        assert_eq!(parsed.prompt_count, 1);
        assert_eq!(parsed.tool_call_count, 1);
        let call = &parsed.tool_activity.unwrap().calls[0];
        assert_eq!(call.id, "c1");
        assert_eq!(call.tool_name, "Bash");
        assert_eq!(call.status, "completed");
        assert_eq!(call.duration_ms, Some(3000));
        assert_eq!(
            serde_json::from_str::<Value>(call.output.as_ref().unwrap()).unwrap()["exit_code"],
            0
        );
        assert_eq!(call.file_paths, vec!["src/main.rs"]);
        assert_eq!(
            serde_json::from_str::<Value>(call.detail.as_ref().unwrap()).unwrap()["command"],
            "git status"
        );
        assert_eq!(parsed.models, vec!["fixture"]);
        assert_eq!(parsed.token_usage.unwrap()["inputTokens"], 20);
    }
}
