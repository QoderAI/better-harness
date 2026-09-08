use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::model::{
    evidence_excerpt, tool_family, Dialogue, Prompt, SessionSummary, ToolActivity, ToolCall,
};
use crate::paths::{cwd_matches, home_dir, paths_from_text, tool_paths, walk_jsonl};
use crate::time::normalize_timestamp;

pub fn codex_home() -> PathBuf {
    home_dir().join(".codex")
}

pub fn discover(workspace: &Path, max_sessions: usize) -> Result<Vec<SessionSummary>, String> {
    discover_from(&codex_home(), workspace, max_sessions)
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
    let mut candidates = Vec::new();
    for path in walk_jsonl(&root, 4, 20_000) {
        if let Some(candidate) = probe(workspace, &path) {
            candidates.push(candidate);
        }
    }
    candidates.sort_by(|left, right| right.timestamp.cmp(&left.timestamp));
    candidates.truncate(max_sessions);
    let mut sessions = Vec::new();
    for candidate in candidates {
        if let Some(session) = read_session(workspace, &candidate) {
            sessions.push(session);
        }
    }
    Ok(sessions)
}

struct Candidate {
    path: PathBuf,
    session_id: String,
    timestamp: Option<String>,
    first: Value,
}

fn probe(workspace: &Path, path: &Path) -> Option<Candidate> {
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first = String::new();
    reader.read_line(&mut first).ok()?;
    let first_record: Value = serde_json::from_str(first.trim()).ok()?;
    let cwd = first_record
        .pointer("/payload/cwd")
        .and_then(Value::as_str)
        .or_else(|| first_record.get("cwd").and_then(Value::as_str))?;
    if !cwd_matches(workspace, cwd) {
        return None;
    }
    let session_id = first_record
        .pointer("/payload/id")
        .and_then(Value::as_str)
        .or_else(|| first_record.get("session_id").and_then(Value::as_str))
        .map(str::to_string)
        .unwrap_or_else(|| fallback_id(path));
    Some(Candidate {
        path: path.to_path_buf(),
        session_id,
        timestamp: normalize_timestamp(first_record.get("timestamp").unwrap_or(&Value::Null)),
        first: first_record,
    })
}

fn read_session(workspace: &Path, candidate: &Candidate) -> Option<SessionSummary> {
    let rest = fs::read_to_string(&candidate.path).ok()?;
    Some(parse_transcript(
        workspace,
        &candidate.session_id,
        &rest,
        &candidate.first,
    ))
}

fn fallback_id(path: &Path) -> String {
    let stem = path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("session");
    let parts: Vec<&str> = stem.split('-').collect();
    if parts.len() >= 5 {
        let uuid = parts[parts.len() - 5..].join("-");
        if uuid.len() >= 32 {
            return uuid;
        }
    }
    stem.to_string()
}

fn parse_transcript(
    workspace: &Path,
    session_id: &str,
    text: &str,
    first: &Value,
) -> SessionSummary {
    let mut first_seen = normalize_timestamp(first.get("timestamp").unwrap_or(&Value::Null));
    let mut last_seen = first_seen.clone();
    let mut prompts = Vec::new();
    let mut assistant_count = 0u32;
    let mut calls = Vec::new();
    let mut responses = Vec::new();
    let mut models = Vec::new();
    let mut token_usage = None;
    // Detect the canonical message channel without retaining a second copy of
    // large tool outputs and encrypted records in memory.
    let (mut has_users, mut has_assistants) = (false, false);
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if record["type"] == "response_item" && record["payload"]["type"] == "message" {
            has_users |= record["payload"]["role"] == "user"
                && !user_text(&message_text(&record["payload"])).is_empty();
            has_assistants |= record["payload"]["role"] == "assistant";
            if has_users && has_assistants {
                break;
            }
        }
    }
    for line in text.lines() {
        let Ok(record) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        let stamp = normalize_timestamp(record.get("timestamp").unwrap_or(&Value::Null));
        if first_seen.is_none() {
            first_seen = stamp.clone();
        }
        if stamp.is_some() {
            last_seen = stamp.clone();
        }
        let outer = record.get("type").and_then(Value::as_str).unwrap_or("");
        let payload = record.get("payload").unwrap_or(&Value::Null);
        let inner = payload.get("type").and_then(Value::as_str).unwrap_or("");
        if outer == "turn_context" {
            if let Some(model) = payload["model"].as_str() {
                if !models.contains(&model.to_string()) {
                    models.push(model.to_string());
                }
            }
        }
        if outer == "event_msg" && inner == "token_count" {
            if let Some(usage) = payload
                .pointer("/info/total_token_usage")
                .filter(|v| v.is_object())
            {
                let mut fields = serde_json::Map::new();
                for (source, target) in [
                    ("input_tokens", "inputTokens"),
                    ("output_tokens", "outputTokens"),
                    ("cached_input_tokens", "cacheReadInputTokens"),
                    ("reasoning_output_tokens", "reasoningOutputTokens"),
                    ("total_tokens", "totalTokens"),
                ] {
                    if let Some(value) = usage[source].as_u64() {
                        fields.insert(target.into(), value.into());
                    }
                }
                if !fields.is_empty() {
                    token_usage = Some(Value::Object(fields));
                }
            }
        }
        if outer == "event_msg" && inner == "user_message" && !has_users {
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                push_prompt(&mut prompts, message, stamp);
            }
        } else if outer == "response_item" && inner == "message" {
            let role = payload.get("role").and_then(Value::as_str).unwrap_or("");
            let text = message_text(&payload);
            if role == "user" {
                push_prompt(&mut prompts, &text, stamp.clone());
            }
            if role == "assistant" && !text.is_empty() {
                assistant_count += 1;
                responses.push(crate::model::Turn {
                    timestamp: stamp.clone(),
                    response: Some(evidence_excerpt(&text)),
                });
            }
        } else if outer == "response_item"
            && (inner == "function_call" || inner == "custom_tool_call")
        {
            let name = payload
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("tool");
            let id = payload
                .get("call_id")
                .and_then(Value::as_str)
                .or_else(|| payload.get("id").and_then(Value::as_str))
                .unwrap_or("")
                .to_string();
            let mut paths = tool_paths(workspace, &payload);
            if let Some(input) = payload.get("input").and_then(Value::as_str) {
                for path in paths_from_text(workspace, input) {
                    if !paths.contains(&path) {
                        paths.push(path);
                    }
                }
            }
            if !id.is_empty() && calls.iter().any(|call: &ToolCall| call.id == id) {
                continue;
            }
            let input = payload.get("arguments").or_else(|| payload.get("input"));
            calls.push(ToolCall {
                id: if id.is_empty() {
                    format!("codex-{}-{}", session_id, calls.len() + 1)
                } else {
                    id
                },
                family: tool_family(name),
                action_label: name.to_string(),
                tool_name: name.to_string(),
                status: "observed".into(),
                file_path: paths.first().cloned(),
                file_paths: paths,
                detail: input.map(|value| {
                    evidence_excerpt(
                        &value
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| value.to_string()),
                    )
                }),
                started_at: stamp,
                ..ToolCall::default()
            });
        } else if outer == "response_item"
            && matches!(inner, "function_call_output" | "custom_tool_call_output")
        {
            if let Some(call) = calls
                .iter_mut()
                .find(|call| Some(call.id.as_str()) == payload["call_id"].as_str())
            {
                let output = &payload["output"];
                call.output = (!output.is_null()).then(|| {
                    evidence_excerpt(
                        &output
                            .as_str()
                            .map(str::to_string)
                            .unwrap_or_else(|| output.to_string()),
                    )
                });
                // A returned payload proves completion, not that the command succeeded.
                call.status = if payload["is_error"] == true {
                    "failed"
                } else {
                    "returned"
                }
                .into();
                call.duration_ms = call
                    .started_at
                    .as_ref()
                    .and_then(|start| crate::time::millis(&Value::String(start.clone())))
                    .zip(crate::time::millis(&record["timestamp"]))
                    .and_then(|(start, end)| (end >= start).then_some(end - start));
            }
        } else if outer == "event_msg" && inner == "agent_message" && !has_assistants {
            if let Some(message) = payload.get("message").and_then(Value::as_str) {
                assistant_count += 1;
                responses.push(crate::model::Turn {
                    timestamp: stamp.clone(),
                    response: Some(evidence_excerpt(message)),
                });
            }
        }
    }
    SessionSummary {
        session_id: session_id.to_string(),
        platform: "codex".into(),
        last_seen: last_seen.or(first_seen.clone()),
        first_seen,
        prompt_count: prompts.len() as u32,
        assistant_message_count: assistant_count,
        tool_call_count: calls.len() as u32,
        prompts,
        tool_activity: Some(ToolActivity { calls }),
        dialogue: Some(Dialogue { turns: responses }),
        models,
        token_usage,
    }
}

fn push_prompt(prompts: &mut Vec<Prompt>, message: &str, timestamp: Option<String>) {
    let text = user_text(message);
    if text.is_empty() {
        return;
    }
    prompts.push(Prompt { text, timestamp });
}

fn user_text(message: &str) -> String {
    let mut text = message.to_string();
    for tag in [
        "environment_context",
        "recommended_plugins",
        "skill",
        "in-app-browser-context",
        "codex_internal_context",
    ] {
        while let Some(start) = text.find(&format!("<{tag}")) {
            let close = format!("</{tag}>");
            let Some(end) = text[start..].find(&close) else {
                text.truncate(start);
                break;
            };
            text.replace_range(start..start + end + close.len(), "");
        }
    }
    for marker in ["# My request:", "# My request for Codex:"] {
        if let Some(start) = text.find(marker) {
            text = text[start + marker.len()..].to_string();
            break;
        }
    }
    if text.trim_start().starts_with("# AGENTS.md instructions") {
        return String::new();
    }
    evidence_excerpt(&text)
}

fn message_text(payload: &Value) -> String {
    match payload.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part.get("text")
                    .and_then(Value::as_str)
                    .or_else(|| part.get("input_text").and_then(Value::as_str))
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => payload
            .get("text")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn retains_native_messages_and_pairs_outputs_without_echo_inflation() {
        use serde_json::json;
        let rows = vec![
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"<recommended_plugins>injected</recommended_plugins># AGENTS.md instructions for fixture"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"Research a viewer"}]}}),
            json!({"type":"event_msg","payload":{"type":"user_message","message":"Research a viewer"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"Continue"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"Continue"}]}}),
            json!({"type":"response_item","payload":{"type":"message","role":"user","content":[{"text":"<in-app-browser-context source=\"ambient-ui-state\">page</in-app-browser-context>"}]}}),
            json!({"timestamp":"2026-09-08T10:00:00Z","type":"response_item","payload":{"type":"custom_tool_call","call_id":"c1","name":"exec","input":"text(await tools.read({path: 'src/main.rs'}));"}}),
            json!({"timestamp":"2026-09-08T10:00:02Z","type":"response_item","payload":{"type":"custom_tool_call_output","call_id":"c1","output":"done"}}),
            json!({"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"text":"A complete response"}]}}),
            json!({"type":"event_msg","payload":{"type":"agent_message","message":"A complete response"}}),
            json!({"type":"turn_context","payload":{"model":"fixture-model"}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}}}),
            json!({"type":"event_msg","payload":{"type":"token_count","info":{"total_token_usage":{"input_tokens":100,"output_tokens":10,"total_tokens":110}}}}),
        ];
        let text = rows
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let parsed = parse_transcript(&std::env::temp_dir(), "session", &text, &Value::Null);
        assert_eq!(
            parsed
                .prompts
                .iter()
                .map(|p| p.text.as_str())
                .collect::<Vec<_>>(),
            vec!["Research a viewer", "Continue", "Continue"]
        );
        assert_eq!(parsed.assistant_message_count, 1);
        assert_eq!(
            parsed.dialogue.unwrap().turns[0].response.as_deref(),
            Some("A complete response")
        );
        assert_eq!(parsed.tool_call_count, 1);
        let call = &parsed.tool_activity.unwrap().calls[0];
        assert_eq!(call.tool_name, "exec");
        assert_eq!(
            call.detail.as_deref(),
            Some("text(await tools.read({path: 'src/main.rs'}));")
        );
        assert_eq!(call.output.as_deref(), Some("done"));
        assert_eq!(call.status, "returned");
        assert_eq!(call.duration_ms, Some(2000));
        assert_eq!(parsed.models, vec!["fixture-model"]);
        assert_eq!(parsed.token_usage.unwrap()["totalTokens"], 110);
    }

    #[test]
    fn injected_native_context_does_not_disable_legacy_user_events() {
        let text = [
            serde_json::json!({"type":"response_item","payload":{"type":"message","role":"user","content":"<environment_context>fixture</environment_context>"}}),
            serde_json::json!({"type":"event_msg","payload":{"type":"user_message","message":"Keep the actual request"}}),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n");
        let parsed = parse_transcript(&std::env::temp_dir(), "session", &text, &Value::Null);
        assert_eq!(parsed.prompt_count, 1);
        assert_eq!(parsed.prompts[0].text, "Keep the actual request");
        assert_eq!(
            user_text(
                "# AGENTS.md instructions for fixture\n<context>fixture</context>\n## My request:\nDo the task"
            ),
            "Do the task"
        );
    }

    #[test]
    fn strips_rollout_prefix() {
        assert_eq!(
            fallback_id(Path::new(
                "rollout-2026-04-27T11-42-51-019dcd08-5fe3-7fa1-9e74-94929d8ed50d.jsonl"
            )),
            "019dcd08-5fe3-7fa1-9e74-94929d8ed50d"
        );
    }
}
