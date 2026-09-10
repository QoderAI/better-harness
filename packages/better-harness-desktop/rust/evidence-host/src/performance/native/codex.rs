//! Codex rollout timing.
//!
//! Codex records both boundaries of most work itself: turns state
//! `started_at`/`completed_at`, and completed items state
//! `started_at_ms`/`completed_at_ms`. Those recorded boundaries are used as
//! given; nothing here reconstructs an interval Codex did not write down.
use super::{evidence_source, records, safe_text, stamp, EventBuilder, Transcript};
use crate::paths::{cwd_matches, walk_jsonl};
use crate::performance::{Coverage, Event};
use crate::platforms::codex::session_id_from_record;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

pub const PROVIDER: &str = "codex";
const MAX_TRANSCRIPTS: usize = 20_000;

pub fn home() -> PathBuf {
    crate::platforms::codex::codex_home()
}

/// Every rollout whose first record claims this workspace, newest first.
pub fn transcripts(home: &Path, workspace: &Path) -> Vec<Transcript> {
    let root = home.join("sessions");
    if !root.is_dir() {
        return Vec::new();
    }
    let mut found: Vec<(Option<std::time::SystemTime>, Transcript)> = Vec::new();
    for path in walk_jsonl(&root, 4, MAX_TRANSCRIPTS) {
        let Some(id) = probe(workspace, &path) else {
            continue;
        };
        if found.iter().any(|(_, existing)| existing.id == id) {
            continue;
        }
        let modified = fs::metadata(&path).ok().and_then(|m| m.modified().ok());
        found.push((modified, Transcript { id, path, modified }));
    }
    found.sort_by(|left, right| right.0.cmp(&left.0));
    found
        .into_iter()
        .map(|(_, transcript)| transcript)
        .collect()
}

/// Only the first record is read here: a rollout states its workspace and
/// identity up front, so a non-matching file is never opened any further.
fn probe(workspace: &Path, path: &Path) -> Option<String> {
    let file = fs::File::open(path).ok()?;
    let mut first = String::new();
    BufReader::new(file).read_line(&mut first).ok()?;
    let record: Value = serde_json::from_str(first.trim()).ok()?;
    let cwd = record
        .pointer("/payload/cwd")
        .and_then(Value::as_str)
        .or_else(|| record.get("cwd").and_then(Value::as_str))?;
    if !cwd_matches(workspace, cwd) {
        return None;
    }
    Some(session_id_from_record(&record, path)).filter(|id| !id.is_empty())
}

pub fn events(index: usize, path: &Path, root: &Path, coverage: &mut Coverage) -> Vec<Event> {
    let source = evidence_source(index, path);
    let parsed = records(path, root, coverage);
    // Newer rollouts state each conversation item once, with boundaries. Older
    // ones only carry the raw response stream; read the prompts from there
    // rather than counting the same request twice when both are present.
    let has_items = parsed.iter().any(|record| {
        record.value["payload"]["type"] == "item_completed"
            && record.value["payload"]["item"]["type"] == "UserMessage"
    });
    // CommandExecution items already bound shell work. The matching `exec`
    // stream records use different ids, so keeping both would double-count.
    let has_command_items = parsed.iter().any(|record| {
        record.value["payload"]["type"] == "item_completed"
            && record.value["payload"]["item"]["type"] == "CommandExecution"
    });
    let mut events = Vec::new();
    let mut skipped_calls = HashSet::new();
    for record in &parsed {
        let value = &record.value;
        let Some(at) = stamp(&value["timestamp"]) else {
            if value.get("timestamp").is_some() {
                coverage.invalid_timestamps += 1;
            }
            continue;
        };
        let outer = value["type"].as_str().unwrap_or("");
        let payload = &value["payload"];
        let inner = payload["type"].as_str().unwrap_or("");
        match (outer, inner) {
            ("event_msg", "task_started") => events.push(
                EventBuilder::new("turn.started", "task_started", at, record.line)
                    .turn(text(&payload["turn_id"]))
                    .build(&source),
            ),
            ("event_msg", "task_complete") => events.push(
                EventBuilder::new("turn.finished", "task_complete", at, record.line)
                    .turn(text(&payload["turn_id"]))
                    .fact(
                        "time_to_first_token_ms",
                        payload["time_to_first_token_ms"].clone(),
                    )
                    .fact("duration_ms", payload["duration_ms"].clone())
                    .build(&source),
            ),
            ("event_msg", "item_completed") => {
                item_events(&payload["item"], payload, record.line, &source, &mut events);
            }
            ("response_item", "function_call" | "custom_tool_call") => {
                if has_command_items
                    && (inner == "custom_tool_call" || stream_duplicates_command(payload))
                {
                    if let Some(id) = call_id(payload) {
                        skipped_calls.insert(id);
                    }
                    continue;
                }
                let Some(id) = call_id(payload) else { continue };
                let name = payload["name"].as_str().unwrap_or("tool");
                let arguments = payload
                    .get("arguments")
                    .or_else(|| payload.get("input"))
                    .cloned()
                    .unwrap_or(Value::Null);
                events.push(
                    EventBuilder::new("tool.requested", inner_marker(inner), at, record.line)
                        .turn(passthrough_turn(payload))
                        .tool(id)
                        .fact("tool_name", json!(name))
                        .fact(
                            "callSummary",
                            crate::performance::source::call_summary(&json!({
                                "args": arguments, "command": arguments,
                            }))
                            .map_or(Value::Null, Value::from),
                        )
                        .build(&source),
                );
            }
            ("response_item", "function_call_output" | "custom_tool_call_output") => {
                let Some(id) = call_id(payload) else { continue };
                if skipped_calls.contains(&id)
                    || (has_command_items && inner == "custom_tool_call_output")
                {
                    continue;
                }
                events.push(
                    EventBuilder::new(
                        "tool.execution.finished",
                        inner_marker(inner),
                        at,
                        record.line,
                    )
                    .turn(passthrough_turn(payload))
                    .tool(id)
                    .fact("is_error", json!(payload["is_error"] == true))
                    .build(&source),
                );
            }
            ("response_item", "message") if payload["role"] == "user" && !has_items => {
                let text = strip_injected(&message_text(payload));
                if !text.trim().is_empty() {
                    events.push(
                        EventBuilder::new("input.prompt.submitted", "message", at, record.line)
                            .turn(passthrough_turn(payload))
                            .fact("text_preview", json!(safe_text(&text, 160)))
                            .build(&source),
                    );
                }
            }
            ("event_msg", "user_message") if !has_items => {
                let text = strip_injected(payload["message"].as_str().unwrap_or(""));
                if !text.trim().is_empty() {
                    events.push(
                        EventBuilder::new(
                            "input.prompt.submitted",
                            "user_message",
                            at,
                            record.line,
                        )
                        .fact("text_preview", json!(safe_text(&text, 160)))
                        .build(&source),
                    );
                }
            }
            _ => {}
        }
    }
    events
}

/// A completed item states both of its own boundaries, so the pair of events it
/// produces names which boundary each one came from.
fn item_events(item: &Value, payload: &Value, line: usize, source: &str, events: &mut Vec<Event>) {
    let (Some(start), Some(end)) = (
        stamp(&payload["started_at_ms"]),
        stamp(&payload["completed_at_ms"]),
    ) else {
        return;
    };
    let turn = text(&payload["turn_id"]);
    let id = text(&item["id"]);
    let kind = item["type"].as_str().unwrap_or("");
    let marker = |suffix: &str| format!("item_completed:{kind}:{suffix}");
    match kind {
        "UserMessage" => {
            let content = strip_injected(&message_text(item));
            if !content.trim().is_empty() {
                events.push(
                    EventBuilder::new("input.prompt.submitted", marker("started"), start, line)
                        .turn(turn)
                        .fact("text_preview", json!(safe_text(&content, 160)))
                        .build(source),
                );
            }
        }
        "AgentMessage" | "Reasoning" => {
            if id.is_empty() {
                return;
            }
            events.push(
                EventBuilder::new("model.request.started", marker("started"), start, line)
                    .turn(turn.clone())
                    .request(id.clone())
                    .build(source),
            );
            events.push(
                EventBuilder::new("model.response.completed", marker("completed"), end, line)
                    .turn(turn)
                    .request(id)
                    .fact(
                        "model",
                        json!(if kind == "Reasoning" {
                            "reasoning"
                        } else {
                            "response"
                        }),
                    )
                    .build(source),
            );
        }
        "CommandExecution" => {
            if id.is_empty() {
                return;
            }
            let command = text(&item["command"]);
            events.push(
                EventBuilder::new("tool.shell.started", marker("started"), start, line)
                    .turn(turn.clone())
                    .tool(id.clone())
                    .fact("tool_name", json!(shell_label(item)))
                    .fact(
                        "callSummary",
                        crate::performance::source::call_summary(&json!({ "command": command }))
                            .map_or(Value::Null, Value::from),
                    )
                    .build(source),
            );
            events.push(
                EventBuilder::new("tool.shell.finished", marker("completed"), end, line)
                    .turn(turn)
                    .tool(id)
                    .fact("tool_name", json!(shell_label(item)))
                    .fact("status", item["status"].clone())
                    .fact("exit_code", item["exit_code"].clone())
                    .build(source),
            );
        }
        "McpToolCall" | "FileChange" | "WebSearch" => {
            if id.is_empty() {
                return;
            }
            let name = if kind == "McpToolCall" {
                format!("{}·{}", text(&item["server"]), text(&item["tool"]))
            } else {
                kind.to_string()
            };
            events.push(
                EventBuilder::new("tool.requested", marker("started"), start, line)
                    .turn(turn.clone())
                    .tool(id.clone())
                    .fact("tool_name", json!(name))
                    .build(source),
            );
            events.push(
                EventBuilder::new("tool.execution.finished", marker("completed"), end, line)
                    .turn(turn)
                    .tool(id)
                    .fact("tool_name", json!(name))
                    .fact("status", item["status"].clone())
                    .build(source),
            );
        }
        _ => {}
    }
}

/// The parsed intent Codex already recorded, so the breakdown groups a shell
/// call by what it did rather than by the whole command line. Codex writes
/// `unknown` for anything it does not classify, which names nothing to a
/// reader; the program being run does, so fall back to that.
fn shell_label(item: &Value) -> String {
    let parsed = item["parsed_cmd"]
        .as_array()
        .and_then(|entries| entries.first());
    match parsed.and_then(|entry| entry["type"].as_str()) {
        Some(kind) if !kind.is_empty() && kind != "unknown" => return kind.to_string(),
        _ => {}
    }
    let command = parsed
        .and_then(|entry| entry["cmd"].as_str())
        .map(str::to_string)
        .unwrap_or_else(|| text(&item["command"]));
    command
        .split(|c: char| c.is_whitespace() || matches!(c, '\'' | '"' | '[' | ']' | ','))
        .filter(|token| !token.is_empty())
        .find(|token| !token.contains('/') && !token.contains('=') && !token.starts_with('-'))
        .map(|token| token.chars().take(40).collect())
        .unwrap_or_else(|| "shell".to_string())
}

fn inner_marker(inner: &str) -> String {
    inner.to_string()
}

fn call_id(payload: &Value) -> Option<String> {
    payload["call_id"]
        .as_str()
        .or_else(|| payload["id"].as_str())
        .filter(|id| !id.is_empty())
        .map(str::to_string)
}

fn passthrough_turn(payload: &Value) -> String {
    text(&payload["internal_chat_message_metadata_passthrough"]["turn_id"])
}

fn text(value: &Value) -> String {
    value
        .as_str()
        .unwrap_or("")
        .chars()
        .take(256)
        .collect::<String>()
}

/// Stream `exec` calls duplicate CommandExecution items. `wait` and other
/// function calls have no item and must still be timed.
fn stream_duplicates_command(payload: &Value) -> bool {
    matches!(payload["name"].as_str(), Some("exec" | "shell" | "bash"))
}

/// Codex prepends harness context to the first user message of a turn. That
/// text is the harness talking, not the reader, so it never becomes a title.
fn strip_injected(message: &str) -> String {
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
    strip_harness_policies(&text)
}

/// Desktop harness wraps the real prompt in a revision/policy block. Keep only
/// the text after that block; a message that is only the block is not a title.
fn strip_harness_policies(text: &str) -> String {
    let mut lines = text.lines();
    let Some(first) = lines.next() else {
        return String::new();
    };
    if !first
        .trim_start()
        .starts_with("You are running under harness revision")
    {
        return text.to_string();
    }
    for line in lines.by_ref() {
        if line.trim().is_empty() {
            return lines.collect::<Vec<_>>().join("\n");
        }
    }
    String::new()
}

fn message_text(payload: &Value) -> String {
    match payload.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter_map(|part| {
                part["text"]
                    .as_str()
                    .or_else(|| part["input_text"].as_str())
            })
            .collect::<Vec<_>>()
            .join("\n"),
        _ => payload["text"].as_str().unwrap_or("").to_string(),
    }
}
