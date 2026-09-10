//! Claude Code transcript timing.
//!
//! The transcript states when each record was written, not when a request was
//! dispatched. A model interval is therefore bounded by the record that
//! triggered it and the assistant record that answered, and says so: the start
//! boundary is marked `request-boundary`, and the span carries
//! `includesUnobservedWork` rather than presenting queue time as model time.
use super::{evidence_source, records, safe_text, stamp, EventBuilder, Record, Transcript};
use crate::paths::claude_slug_variants;
use crate::performance::{Coverage, Event};
use serde_json::{json, Value};
use std::{
    fs,
    io::{BufRead, BufReader},
    path::{Path, PathBuf},
};

pub const PROVIDER: &str = "claude";

pub fn home() -> PathBuf {
    crate::platforms::claude::claude_home()
}

/// Every retained transcript this workspace owns, newest first.
pub fn transcripts(home: &Path, workspace: &Path) -> Vec<Transcript> {
    let mut found: Vec<(Option<std::time::SystemTime>, Transcript)> = Vec::new();
    for slug in claude_slug_variants(workspace) {
        let root = home.join("projects").join(slug);
        if !root.is_dir() {
            continue;
        }
        let Ok(entries) = fs::read_dir(&root) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|ext| ext.to_str()) != Some("jsonl")
                || !entry.file_type().is_ok_and(|kind| kind.is_file())
            {
                continue;
            }
            let Some(id) = session_id(&path) else {
                continue;
            };
            if found.iter().any(|(_, existing)| existing.id == id) {
                continue;
            }
            let modified = fs::metadata(&path).ok().and_then(|m| m.modified().ok());
            found.push((modified, Transcript { id, path, modified }));
        }
    }
    found.sort_by(|left, right| right.0.cmp(&left.0));
    found
        .into_iter()
        .map(|(_, transcript)| transcript)
        .collect()
}

/// The Session identity the transcript states, falling back to the file name
/// Claude Code derives it from.
fn session_id(path: &Path) -> Option<String> {
    let stem = path.file_stem()?.to_str()?.to_string();
    let file = fs::File::open(path).ok()?;
    let mut reader = BufReader::new(file);
    let mut first = String::new();
    if reader.read_line(&mut first).is_ok() {
        if let Ok(value) = serde_json::from_str::<Value>(first.trim()) {
            if let Some(id) = value.get("sessionId").and_then(Value::as_str) {
                if !id.is_empty() {
                    return Some(id.to_string());
                }
            }
        }
    }
    (!stem.is_empty()).then_some(stem)
}

pub fn events(index: usize, path: &Path, root: &Path, coverage: &mut Coverage) -> Vec<Event> {
    let source = evidence_source(index, path);
    let parsed = records(path, root, coverage);
    // Only conversation records bound an interval. Attachments, queue
    // operations, hook summaries and file-history entries are written around a
    // Session rather than in it: letting one open or close an interval would
    // present a reader's idle days between two resumed turns as model work.
    let timed: Vec<Timed> = parsed
        .iter()
        .enumerate()
        .filter(|(_, record)| matches!(record.value["type"].as_str(), Some("user" | "assistant")))
        .filter_map(|(position, record)| {
            stamp(&record.value["timestamp"]).map(|at| Timed {
                at,
                line: record.line,
                position,
                record,
            })
        })
        .collect();
    // Bookkeeping records legitimately carry no timestamp. Only a record that
    // claims one and cannot state it is missing evidence.
    coverage.invalid_timestamps += parsed
        .iter()
        .filter(|record| matches!(record.value["type"].as_str(), Some("user" | "assistant")))
        .filter(|record| stamp(&record.value["timestamp"]).is_none())
        .count();
    let turns = turn_assignment(&timed);
    let mut events = Vec::new();
    let mut group: Option<Group> = None;
    for (position, entry) in timed.iter().enumerate() {
        let kind = entry.record.value["type"].as_str().unwrap_or("");
        let turn = &turns[position];
        if kind != "assistant" {
            flush(&mut group, &parsed, &timed, &turns, &source, &mut events);
        }
        match kind {
            "user" => user_events(entry, turn, position, &timed, &turns, &source, &mut events),
            "assistant" => {
                let request = entry.record.value["requestId"].as_str().unwrap_or("");
                match &mut group {
                    Some(open) if open.request == request => open.last = position,
                    _ => {
                        flush(&mut group, &parsed, &timed, &turns, &source, &mut events);
                        group = Some(Group {
                            request: request.to_string(),
                            first: position,
                            last: position,
                        });
                    }
                }
                tool_requests(entry, turn, &source, &mut events);
            }
            _ => {}
        }
    }
    flush(&mut group, &parsed, &timed, &turns, &source, &mut events);
    close_turns(&timed, &turns, &source, &mut events);
    system_events(&parsed, &timed, &turns, &source, &mut events);
    events
}

/// Claude Code writes hook runs and request retries as `system` records rather
/// than as conversation. They state their own durations, so they are read here
/// even though they never bound a model interval.
fn system_events(
    parsed: &[Record],
    timed: &[Timed],
    turns: &[TurnRef],
    source: &str,
    events: &mut Vec<Event>,
) {
    for (position, record) in parsed.iter().enumerate() {
        if record.value["type"] != "system" {
            continue;
        }
        let Some(at) = stamp(&record.value["timestamp"]) else {
            continue;
        };
        // A system record belongs to whatever turn was open when it was written.
        let turn = timed
            .iter()
            .rposition(|entry| entry.position < position)
            .map(|index| turns[index].id.clone())
            .unwrap_or_default();
        match record.value["subtype"].as_str().unwrap_or("") {
            "stop_hook_summary" => {
                let Some(hooks) = record.value["hookInfos"].as_array() else {
                    continue;
                };
                for hook in hooks {
                    // A hook without a stated duration ran, but for how long is
                    // not recorded; it is left out rather than counted as zero.
                    let Some(duration) = hook["durationMs"]
                        .as_i64()
                        .filter(|value| *value >= 0 && *value <= 30 * 86400 * 1000)
                    else {
                        continue;
                    };
                    events.push(
                        EventBuilder::new("hook.finished", "stop_hook_summary", at, record.line)
                            .turn(turn.clone())
                            .tool(text(&record.value["toolUseID"]))
                            .fact("hook_name", json!(hook_name(&hook["command"])))
                            .fact("source", json!("Stop"))
                            .fact("hook_event_name", json!("Stop"))
                            .fact("duration_ms", json!(duration))
                            .build(source),
                    );
                }
            }
            "api_error" => {
                let error = &record.value["error"];
                events.push(
                    EventBuilder::new(
                        "model.request.attempt_failed",
                        "api_error",
                        at,
                        record.line,
                    )
                    .turn(turn)
                    .fact(
                        "error_name",
                        json!(safe_text(
                            error["formatted"]
                                .as_str()
                                .or_else(|| error["message"].as_str())
                                .unwrap_or("API error"),
                            120
                        )),
                    )
                    .fact("error_code", error["connection"]["code"].clone())
                    .fact("attempt", record.value["retryAttempt"].clone())
                    .fact(
                        "will_retry",
                        json!(
                            record.value["retryAttempt"].as_i64().unwrap_or(0)
                                < record.value["maxRetries"].as_i64().unwrap_or(0)
                        ),
                    )
                    .build(source),
                );
            }
            _ => {}
        }
    }
}

/// Hooks are named by the script that ran, not by the reader's own path.
fn hook_name(command: &Value) -> String {
    let text = command.as_str().unwrap_or("hook");
    let program = text.split_whitespace().next().unwrap_or(text);
    let name = program.rsplit('/').next().unwrap_or(program);
    if name.is_empty() {
        "hook".to_string()
    } else {
        name.chars().take(60).collect()
    }
}

fn text(value: &Value) -> String {
    value.as_str().unwrap_or("").chars().take(256).collect()
}

struct Timed<'a> {
    at: i64,
    line: usize,
    /// Index into the full transcript, so the records written between two
    /// messages can be consulted before an interval is claimed.
    position: usize,
    record: &'a Record,
}

/// Records Claude Code writes when a Session is re-opened, re-queued or
/// re-configured. One of these between a message and the reply to it means the
/// Session was not continuously in flight, so the elapsed time between them is
/// not evidence of a request duration.
const INTERRUPTIONS: [&str; 3] = ["bridge-session", "mode", "queue-operation"];

fn interrupted(parsed: &[Record], from: usize, to: usize) -> bool {
    parsed
        .get(from + 1..to)
        .unwrap_or_default()
        .iter()
        .any(|record| {
            record.value["type"]
                .as_str()
                .is_some_and(|kind| INTERRUPTIONS.contains(&kind))
        })
}

struct Group {
    request: String,
    first: usize,
    last: usize,
}

#[derive(Clone)]
struct TurnRef {
    id: String,
    is_subagent: bool,
}

/// A prompt opens a turn; every record until the next prompt belongs to it.
/// Sidechain records are the Agent's own turns and are never allowed to supply
/// the Session title.
fn turn_assignment(timed: &[Timed]) -> Vec<TurnRef> {
    let mut assigned = Vec::with_capacity(timed.len());
    let mut current = TurnRef {
        id: String::new(),
        is_subagent: false,
    };
    for entry in timed {
        if is_prompt(entry.record) {
            current = TurnRef {
                id: entry
                    .record
                    .value
                    .get("promptId")
                    .and_then(Value::as_str)
                    .or_else(|| entry.record.value.get("uuid").and_then(Value::as_str))
                    .unwrap_or("")
                    .to_string(),
                is_subagent: entry.record.value["isSidechain"] == true,
            };
        }
        assigned.push(current.clone());
    }
    assigned
}

/// A prompt is a user record that carries text of its own, never a returned
/// tool result wearing the user role.
fn is_prompt(record: &Record) -> bool {
    record.value["type"] == "user"
        && tool_results(record).is_empty()
        && !message_text(&record.value["message"]).trim().is_empty()
}

fn tool_results(record: &Record) -> Vec<&Value> {
    match record.value.pointer("/message/content") {
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part["type"] == "tool_result")
            .collect(),
        _ => Vec::new(),
    }
}

fn message_text(message: &Value) -> String {
    match message.get("content") {
        Some(Value::String(text)) => text.clone(),
        Some(Value::Array(parts)) => parts
            .iter()
            .filter(|part| part["type"] == "text")
            .filter_map(|part| part["text"].as_str())
            .collect::<Vec<_>>()
            .join(""),
        _ => String::new(),
    }
}

fn user_events(
    entry: &Timed,
    turn: &TurnRef,
    position: usize,
    timed: &[Timed],
    turns: &[TurnRef],
    source: &str,
    events: &mut Vec<Event>,
) {
    let results = tool_results(entry.record);
    if !results.is_empty() {
        for result in results {
            let Some(id) = result["tool_use_id"].as_str().filter(|id| !id.is_empty()) else {
                continue;
            };
            events.push(
                EventBuilder::new(
                    "tool.execution.finished",
                    "tool_result",
                    entry.at,
                    entry.line,
                )
                .turn(turn.id.clone())
                .tool(id)
                .fact("is_error", json!(result["is_error"] == true))
                .fact("is_subagent", json!(turn.is_subagent))
                .build(source),
            );
        }
        return;
    }
    if !is_prompt(entry.record) {
        return;
    }
    // The turn the previous record belonged to ends where this prompt begins.
    if let Some(previous) = position
        .checked_sub(1)
        .filter(|index| !turns[*index].id.is_empty())
    {
        events.push(
            EventBuilder::new(
                "turn.finished",
                "turn-boundary",
                timed[previous].at,
                timed[previous].line,
            )
            .turn(turns[previous].id.clone())
            .build(source),
        );
    }
    events.push(
        EventBuilder::new("input.prompt.submitted", "user", entry.at, entry.line)
            .turn(turn.id.clone())
            .fact(
                "text_preview",
                json!(safe_text(
                    &message_text(&entry.record.value["message"]),
                    160
                )),
            )
            .fact("is_subagent", json!(turn.is_subagent))
            .build(source),
    );
    events.push(
        EventBuilder::new("turn.started", "user", entry.at, entry.line)
            .turn(turn.id.clone())
            .fact("is_subagent", json!(turn.is_subagent))
            .build(source),
    );
}

fn tool_requests(entry: &Timed, turn: &TurnRef, source: &str, events: &mut Vec<Event>) {
    let Some(Value::Array(parts)) = entry.record.value.pointer("/message/content") else {
        return;
    };
    for part in parts {
        if part["type"] != "tool_use" {
            continue;
        }
        let Some(id) = part["id"].as_str().filter(|id| !id.is_empty()) else {
            continue;
        };
        let name = part["name"].as_str().unwrap_or("tool");
        let summary = crate::performance::source::call_summary(&json!({ "args": part["input"] }));
        events.push(
            EventBuilder::new("tool.requested", "tool_use", entry.at, entry.line)
                .turn(turn.id.clone())
                .tool(id)
                .fact("tool_name", json!(name))
                .fact("is_subagent", json!(turn.is_subagent))
                .fact("callSummary", summary.map_or(Value::Null, Value::from))
                .build(source),
        );
    }
}

/// One request is every assistant record that shares a `requestId`. It is
/// bounded below by whatever record preceded it, because that is the last
/// moment the transcript proves the request had not yet been answered.
fn flush(
    group: &mut Option<Group>,
    parsed: &[Record],
    timed: &[Timed],
    turns: &[TurnRef],
    source: &str,
    events: &mut Vec<Event>,
) {
    let Some(open) = group.take() else {
        return;
    };
    let end = &timed[open.last];
    let turn = &turns[open.first];
    let request = if open.request.is_empty() {
        format!("block-{}", timed[open.first].line)
    } else {
        open.request.clone()
    };
    // No start boundary is better than a start boundary that spans a pause: the
    // request is reported as unpaired and counted in coverage instead.
    let continuous = open.first > 0
        && !interrupted(
            parsed,
            timed[open.first - 1].position,
            timed[open.first].position,
        );
    if continuous {
        let start = &timed[open.first - 1];
        events.push(
            EventBuilder::new(
                "model.request.started",
                "request-boundary",
                start.at,
                start.line,
            )
            .turn(turn.id.clone())
            .request(request.clone())
            .fact("is_subagent", json!(turn.is_subagent))
            .build(source),
        );
    }
    let message = &end.record.value["message"];
    events.push(
        EventBuilder::new("model.response.completed", "assistant", end.at, end.line)
            .turn(turn.id.clone())
            .request(request)
            .fact("model", message["model"].clone())
            .fact("stop_reason", message["stop_reason"].clone())
            .fact("output_tokens", message["usage"]["output_tokens"].clone())
            .fact("input_tokens", message["usage"]["input_tokens"].clone())
            .fact(
                "cache_read_input_tokens",
                message["usage"]["cache_read_input_tokens"].clone(),
            )
            .fact(
                "cache_creation_input_tokens",
                message["usage"]["cache_creation_input_tokens"].clone(),
            )
            .fact(
                "reasoning_output_tokens",
                message["usage"]["output_tokens_details"]["thinking_tokens"].clone(),
            )
            .fact("boundary", json!("preceding-message"))
            .fact("is_subagent", json!(turn.is_subagent))
            .build(source),
    );
}

/// Close whatever turn the transcript ended inside, at its last observed
/// record. An open turn is reported as unpaired rather than given an end.
fn close_turns(timed: &[Timed], turns: &[TurnRef], source: &str, events: &mut Vec<Event>) {
    let (Some(last), Some(turn)) = (timed.last(), turns.last()) else {
        return;
    };
    if turn.id.is_empty() {
        return;
    }
    events.push(
        EventBuilder::new("turn.finished", "turn-boundary", last.at, last.line)
            .turn(turn.id.clone())
            .build(source),
    );
}
