use super::{intervals, Coverage, Detail, Event, Finding, Metric, Span, Subagents, Summary, Turn};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;

fn label(value: &str) -> String {
    crate::model::evidence_excerpt(value)
        .chars()
        .take(160)
        .collect()
}
fn optional(value: &str) -> Option<String> {
    (!value.is_empty()).then(|| value.to_string())
}
fn id(e: &Event, kind: &str) -> String {
    let hash =
        Sha256::digest(format!("{}:{}:{kind}", e.evidence.source, e.evidence.line).as_bytes());
    format!("p-{:x}", hash)[..18].to_string()
}
fn range(s: &Span) -> Option<(i64, i64)> {
    s.start_ms.zip(s.end_ms).filter(|(a, b)| b >= a)
}
fn ranges(spans: &[Span]) -> Vec<(i64, i64)> {
    spans.iter().filter_map(range).collect()
}
fn failed(e: &Event) -> bool {
    e.data["success"] == false
        || e.data["allowed"] == false
        || e.data["aborted"] == true
        || e.data["is_error"] == true
        || matches!(e.text("status"), "error" | "failed")
        || e.data["exit_code"].as_i64().is_some_and(|v| v != 0)
}

fn span(start: Option<&Event>, end: Option<&Event>, kind: &str, name: &str, facts: Value) -> Span {
    let event = start.or(end).expect("one observed event");
    let duration = start.zip(end).map(|(a, b)| b.at - a.at).filter(|v| *v >= 0);
    Span {
        id: id(event, kind),
        kind: kind.into(),
        label: label(name),
        start_ms: start.map(|e| e.at),
        end_ms: end.map(|e| e.at),
        duration_ms: duration,
        basis: if duration.is_some() {
            "event-pair"
        } else {
            "unpaired"
        }
        .into(),
        status: if end.is_some_and(failed) {
            "failed"
        } else if duration.is_some() {
            "complete"
        } else {
            "incomplete"
        }
        .into(),
        turn_id: optional(&event.turn),
        parent_id: None,
        relationship: None,
        evidence: start
            .into_iter()
            .chain(end)
            .map(|e| e.evidence.clone())
            .collect(),
        facts,
        invocation: event.tool.clone(),
    }
}

fn reported(mut s: Span, end: &Event) -> Span {
    if let Some(duration) = end.duration().filter(|d| end.at >= *d) {
        s.facts["eventPairMs"] = s.duration_ms.map_or(Value::Null, Value::from);
        s.facts["reportedDurationMs"] = json!(duration);
        s.duration_ms = Some(duration);
        s.start_ms = Some(end.at - duration);
        s.end_ms = Some(end.at);
        s.basis = "reported-duration".into();
        s.status = if failed(end) { "failed" } else { "complete" }.into();
    }
    s
}

/// Return only a unique match. A retry may replace request_id; the fallback
/// still needs one matching turn/loop/index within the same source stream.
fn take_start(
    pending: &mut Vec<usize>,
    events: &[Event],
    end: &Event,
    mode: &str,
    coverage: &mut Coverage,
) -> Option<usize> {
    let candidates = |exact: bool| {
        pending
            .iter()
            .copied()
            .filter(|&i| {
                let a = &events[i];
                if a.at > end.at {
                    return false;
                }
                match mode {
                    "model" if exact => !end.request.is_empty() && a.request == end.request,
                    "model" => {
                        !end.turn.is_empty()
                            && !end.loop_id.is_empty()
                            && a.turn == end.turn
                            && a.loop_id == end.loop_id
                            && a.evidence.source == end.evidence.source
                            && a.data["request_index"].is_number()
                            && a.data["request_index"] == end.data["request_index"]
                    }
                    "tool" | "shell" | "permission" => !end.tool.is_empty() && a.tool == end.tool,
                    "turn" => {
                        !end.turn.is_empty()
                            && a.turn == end.turn
                            && a.evidence.source == end.evidence.source
                    }
                    "fork" => {
                        !end.text("prompt_id").is_empty()
                            && a.text("prompt_id") == end.text("prompt_id")
                            && a.evidence.source == end.evidence.source
                    }
                    "phase" => {
                        a.text("phase") == end.text("phase")
                            && a.turn == end.turn
                            && a.evidence.source == end.evidence.source
                    }
                    "hook" => {
                        a.text("hook_name") == end.text("hook_name")
                            && a.text("source") == end.text("source")
                            && a.tool == end.tool
                            && a.evidence.source == end.evidence.source
                    }
                    _ => false,
                }
            })
            .collect::<Vec<_>>()
    };
    let exact = candidates(true);
    let choices = if mode == "model" && exact.is_empty() {
        candidates(false)
    } else {
        exact
    };
    if mode == "hook" && end.duration().is_some() && !choices.is_empty() {
        // Consume one group observation for start/finish accounting, but do not
        // claim which script ran. Duration comes from the finish record itself.
        let consumed = choices[0];
        pending.retain(|&i| i != consumed);
        return None;
    }
    if choices.len() == 1 {
        let chosen = choices[0];
        pending.retain(|&i| i != chosen);
        return Some(chosen);
    }
    if choices.len() > 1 {
        coverage.ambiguous_pairs += 1;
    }
    None
}

fn kind_name(mode: &str, event: &Event) -> (&'static str, String) {
    match mode {
        "model" => ("model", label(event.text("model"))),
        "tool" if matches!(event.text("tool_name"), "Agent" | "Task") => {
            ("subagent", event.text("tool_name").into())
        }
        "tool" => ("tool", event.text("tool_name").into()),
        "hook" => (
            "hook",
            format!("{} · {}", event.text("hook_name"), event.text("source")),
        ),
        "permission" => ("permission", event.text("tool_name").into()),
        "fork" => ("subagent", event.text("fork_label").into()),
        "phase" => ("phase", event.text("phase").into()),
        // Qoder shell events name no tool; a reader that records one keeps it so
        // the breakdown groups by what ran rather than by one blanket label.
        _ => (
            "shell",
            match event.text("tool_name") {
                "" => "Bash".into(),
                name => name.into(),
            },
        ),
    }
}

pub fn analyze(session_id: &str, events: Vec<Event>, coverage: Coverage) -> Detail {
    analyze_provider(session_id, "qoder", events, coverage)
}

pub fn summarize(session_id: &str, events: Vec<Event>, coverage: Coverage) -> Summary {
    summarize_provider(session_id, "qoder", events, coverage)
}

/// Pairing and interval accounting are provider-agnostic: every reader
/// normalizes its transcript into the same event vocabulary before arriving
/// here, so only the recorded identity differs between platforms.
pub fn analyze_provider(
    session_id: &str,
    provider: &str,
    events: Vec<Event>,
    coverage: Coverage,
) -> Detail {
    analyze_with(session_id, provider, events, coverage, true)
}

/// Catalog rows need pairing for longest/elapsed ranking, not wait-phase
/// linking or a retained span list.
pub fn summarize_provider(
    session_id: &str,
    provider: &str,
    events: Vec<Event>,
    coverage: Coverage,
) -> Summary {
    let mut summary = analyze_with(session_id, provider, events, coverage, false).session;
    for segment in &mut summary.breakdown.segments {
        segment.parts.clear();
        segment.call_parts.clear();
    }
    summary
}

fn analyze_with(
    session_id: &str,
    provider: &str,
    events: Vec<Event>,
    mut coverage: Coverage,
    full: bool,
) -> Detail {
    let mut spans = Vec::new();
    let mut turns = Vec::new();
    let mut pending: HashMap<&str, Vec<usize>> = HashMap::new();
    for (index, event) in events.iter().enumerate() {
        let (mode, is_start) = match event.kind.as_str() {
            "model.request.started" => ("model", true),
            "model.response.completed" => ("model", false),
            "tool.requested" => ("tool", true),
            "tool.execution.finished" => ("tool", false),
            "tool.shell.started" => ("shell", true),
            "tool.shell.finished" => ("shell", false),
            "hook.started" => ("hook", true),
            "hook.finished" => ("hook", false),
            "permission.requested" => ("permission", true),
            "permission.resolved" => ("permission", false),
            "turn.started" => ("turn", true),
            "turn.finished" => ("turn", false),
            "fork.agent.started" => ("fork", true),
            "fork.agent.completed" => ("fork", false),
            "session.phase.started" => ("phase", true),
            "session.phase.finished" => ("phase", false),
            "model.request.attempt_failed" => {
                let mut s = span(
                    Some(event),
                    Some(event),
                    "retry",
                    event.text("error_name"),
                    json!({
                        "attempt": event.data["attempt"], "willRetry": event.data["will_retry"],
                        "errorCode": label(event.text("error_code")), "streamEventCount": event.data["stream_event_count"],
                    }),
                );
                s.evidence.truncate(1);
                s.status = "failed".into();
                s.basis = "event".into();
                spans.push(s);
                continue;
            }
            _ => continue,
        };
        if is_start {
            pending.entry(mode).or_default().push(index);
            continue;
        }
        let start_index = take_start(
            pending.entry(mode).or_default(),
            &events,
            event,
            mode,
            &mut coverage,
        );
        let start = start_index.map(|i| &events[i]);
        if mode == "turn" {
            if let Some(a) = start {
                turns.push(Turn {
                    id: id(a, "turn"),
                    label: a.turn.clone(),
                    start_ms: a.at,
                    end_ms: Some(event.at),
                    duration_ms: Some(event.at - a.at),
                    is_subagent: a.data["is_subagent"] == true,
                    parent_span_id: None,
                    evidence: vec![a.evidence.clone(), event.evidence.clone()],
                });
            } else {
                coverage.unpaired_events += 1;
            }
            continue;
        }
        // Policy may resolve without asking. Only user-facing decisions with a
        // recorded duration, or an actual permission pair, represent wait.
        if mode == "permission" && start.is_none() && event.duration().is_none() {
            continue;
        }
        if mode == "phase" && start.is_none() && event.duration().is_none() {
            continue;
        }
        let identity = start.unwrap_or(event);
        let (kind, name) = kind_name(mode, identity);
        let facts = match mode {
            "model" => {
                json!({ "model": label(event.text("model")), "requestIndex": event.data["request_index"],
                    "requestIdChanged": start.is_some_and(|s| s.request != event.request), "firstTokenMs": null, "streamingMs": null,
                    "outputTokens": event.data["output_tokens"], "stopReason": label(event.text("stop_reason")),
                    // Set when the start boundary is the record that preceded the
                    // request rather than a recorded dispatch.
                    "boundary": event.data["boundary"],
                    "includesUnobservedWork": event.data["boundary"].is_string(),
                })
            }
            "hook" => {
                json!({ "hookEvent": label(event.text("hook_event_name")), "source": label(event.text("source")),
                "attribution": if start.is_some() { "matched-start" } else { "source-group" } })
            }
            "permission" => {
                json!({ "source": label(event.text("source")), "allowed": event.data["allowed"] })
            }
            "fork" => {
                json!({ "subagentKind": "fork", "childTurnId": label(event.text("prompt_id")) })
            }
            "tool" if kind == "subagent" => json!({ "subagentKind": "tool" }),
            "shell" => {
                json!({ "exitCode": event.data["exit_code"], "aborted": event.data["aborted"] })
            }
            _ => json!({}),
        };
        let mut s = span(start, Some(event), kind, &name, facts);
        if matches!(mode, "hook" | "permission" | "fork" | "phase") {
            s = reported(s, event);
        }
        if start.is_some()
            && s.facts["eventPairMs"]
                .as_i64()
                .zip(s.duration_ms)
                .is_some_and(|(a, b)| (a - b).abs() > 1000)
        {
            coverage.clock_conflicts += 1;
        }
        if s.duration_ms.is_none() {
            coverage.unpaired_events += 1;
        }
        if mode == "permission" && event.text("source") != "user" && start.is_none() {
            // Keep policy overhead, but do not present it as human approval.
            s.kind = "policy".into();
        }
        spans.push(s);
    }
    for (mode, indices) in pending {
        for index in indices {
            let e = &events[index];
            coverage.unpaired_events += 1;
            if mode == "turn" {
                turns.push(Turn {
                    id: id(e, "turn"),
                    label: e.turn.clone(),
                    start_ms: e.at,
                    end_ms: None,
                    duration_ms: None,
                    is_subagent: e.data["is_subagent"] == true,
                    parent_span_id: None,
                    evidence: vec![e.evidence.clone()],
                });
            } else {
                let (kind, name) = kind_name(mode, e);
                let facts = if kind == "subagent" {
                    json!({ "subagentKind": mode, "childTurnId": label(e.text("prompt_id")) })
                } else {
                    json!({})
                };
                spans.push(span(Some(e), None, kind, &name, facts));
            }
        }
    }
    if full {
        add_tool_phases(&events, &mut spans);
        // Invocation ids, not display labels, connect wait phases to their call.
        let mut summaries = HashMap::new();
        for event in &events {
            if !event.tool.is_empty() && !event.text("callSummary").is_empty() {
                summaries
                    .entry(event.tool.as_str())
                    .or_insert(event.text("callSummary"));
            }
        }
        for span in &mut spans {
            if let Some(summary) = summaries.get(span.invocation.as_str()) {
                span.facts["callSummary"] = json!(summary);
            }
            // The recorded invocation id is what lets a reader line this interval up
            // with the same call in the retained conversation.
            if !span.invocation.is_empty() {
                span.facts["toolCallId"] = json!(span.invocation);
            }
        }
        link_subagents(&mut turns, &mut spans, &mut coverage);
    }
    spans.sort_by(|a, b| (a.start_ms.or(a.end_ms), &a.id).cmp(&(b.start_ms.or(b.end_ms), &b.id)));
    turns.sort_by_key(|t| t.start_ms);
    let metrics = metrics(&spans);
    let subagents = subagents(&spans);
    let turn_ranges: Vec<_> = turns
        .iter()
        .filter_map(|t| t.end_ms.map(|end| (t.start_ms, end)))
        .collect();
    let timed = ranges(&spans);
    let completed_turn_ms =
        (!turn_ranges.is_empty()).then(|| intervals::length(turn_ranges.clone()));
    let timed_union_ms = (!timed.is_empty()).then(|| intervals::length(timed.clone()));
    let unattributed_turn_ms =
        completed_turn_ms.map(|total| total - intervals::intersection(turn_ranges, timed));
    let first = events.first().map(|e| e.at);
    let last = events.last().map(|e| e.at);
    let last_activity = events
        .iter()
        .rev()
        .find(|e| {
            e.kind.starts_with("model.")
                || e.kind.starts_with("tool.")
                || e.kind.starts_with("turn.")
                || e.kind.starts_with("input.prompt.")
                || e.kind.starts_with("fork.")
        })
        .map(|e| e.at);
    let retry_count = spans.iter().filter(|s| s.kind == "retry").count();
    let findings = findings(&spans, &subagents, &coverage, retry_count);
    let longest = spans
        .iter()
        .filter(|s| !matches!(s.kind.as_str(), "permission" | "policy" | "phase"))
        .filter_map(|s| s.duration_ms)
        .max();
    // A recorded time-to-first-token is the only honest basis for the metric;
    // nothing here estimates one from stream boundaries.
    let first_token_ms = events
        .iter()
        .filter(|event| event.data["is_subagent"] != true)
        .find_map(|event| {
            event.data["time_to_first_token_ms"]
                .as_i64()
                .filter(|value| *value >= 0 && *value <= 30 * 86400 * 1000)
        });
    let summary = Summary {
        breakdown: super::breakdown::breakdown(&spans, &turns),
        id: session_id.into(),
        provider: provider.into(),
        label: events
            .iter()
            .find(|event| {
                matches!(
                    event.kind.as_str(),
                    "input.prompt.submitted" | "input.prompt.received"
                ) && !event.text("text_preview").trim().is_empty()
                    && event.data["is_subagent"] != true
                    && !turns
                        .iter()
                        .any(|turn| turn.label == event.turn && turn.is_subagent)
            })
            .map(|event| {
                label(&crate::privacy::redact_private_text(
                    event.text("text_preview"),
                ))
            })
            .unwrap_or_else(|| {
                let tail = session_id.rsplit(':').next().unwrap_or(session_id);
                let mut name = provider.chars();
                let display = name
                    .next()
                    .map(|first| first.to_uppercase().collect::<String>() + name.as_str())
                    .unwrap_or_default();
                format!("{display} · {}", &tail[..tail.len().min(8)])
            }),
        first_seen_ms: first,
        last_seen_ms: last,
        last_activity_ms: last_activity,
        wall_ms: first.zip(last).map(|(a, b)| b - a),
        completed_turn_ms,
        timed_union_ms,
        unattributed_turn_ms,
        longest_ms: longest,
        turn_count: turns.len(),
        tool_count: spans
            .iter()
            .filter(|s| {
                s.kind == "tool" || s.kind == "subagent" && s.facts["subagentKind"] == "tool"
            })
            .count(),
        retry_count,
        metrics,
        subagents,
        findings,
        status: if coverage.partial() { "partial" } else { "ok" },
        coverage,
        first_token_status: if first_token_ms.is_some() {
            "recorded"
        } else {
            "unrecorded"
        },
        first_token_ms,
    };
    let total_spans = spans.len();
    // Summaries use the full bounded input; a large detail retains the longest
    // intervals first and states how many rows are omitted from the response.
    if full && spans.len() > 4000 {
        spans.sort_by_key(|s| std::cmp::Reverse(s.duration_ms.unwrap_or(i64::MAX)));
        spans.truncate(4000);
        spans.sort_by_key(|s| s.start_ms.or(s.end_ms));
    }
    if !full {
        spans.clear();
        turns.clear();
    }
    Detail {
        schema_version: 1,
        engine: "rust",
        session: summary,
        omitted_spans: if full { total_spans - spans.len() } else { 0 },
        total_spans: if full { total_spans } else { 0 },
        turns,
        spans,
    }
}

fn add_tool_phases(events: &[Event], spans: &mut Vec<Span>) {
    let tools: Vec<_> = spans
        .iter()
        .filter(|s| s.kind == "tool" || s.kind == "subagent" && s.facts["subagentKind"] == "tool")
        .cloned()
        .collect();
    let mut by_tool: HashMap<&str, Vec<&Event>> = HashMap::new();
    for e in events {
        if !e.tool.is_empty() {
            by_tool.entry(&e.tool).or_default().push(e);
        }
    }
    for owner in tools {
        if owner.invocation.is_empty() {
            continue;
        }
        for child in spans
            .iter_mut()
            .filter(|s| s.id != owner.id && s.invocation == owner.invocation)
        {
            child.parent_id = Some(owner.id.clone());
            child.relationship = Some("tool-call-id".into());
            child.turn_id = owner.turn_id.clone();
        }
        let Some((start, end)) = range(&owner) else {
            continue;
        };
        let records = by_tool
            .get(owner.invocation.as_str())
            .cloned()
            .unwrap_or_default();
        let preparation = records
            .iter()
            .copied()
            .filter(|e| e.at >= start && e.at <= end)
            .filter(|e| {
                e.kind == "hook.started" && e.text("hook_event_name") == "PreToolUse"
                    || e.kind == "tool.shell.started"
            })
            .min_by_key(|e| e.at);
        if let Some(preparation) = preparation.filter(|e| e.at > start) {
            let mut s = Span {
                id: format!("{}-dispatch", owner.id),
                kind: "dispatch".into(),
                label: owner.label.clone(),
                start_ms: Some(start),
                end_ms: Some(preparation.at),
                duration_ms: Some(preparation.at - start),
                basis: "boundary-interval".into(),
                status: "complete".into(),
                turn_id: owner.turn_id.clone(),
                parent_id: Some(owner.id.clone()),
                relationship: Some("tool-call-id".into()),
                evidence: owner
                    .evidence
                    .first()
                    .cloned()
                    .into_iter()
                    .chain(Some(preparation.evidence.clone()))
                    .collect(),
                facts: json!({"until": "execution-preparation", "includesUnobservedWork": true}),
                invocation: owner.invocation.clone(),
            };
            // If an approval interval preceded the first execution marker,
            // this is preparation waiting, not a second queue duration.
            if spans.iter().any(|p| {
                p.parent_id.as_deref() == Some(&owner.id)
                    && p.kind == "permission"
                    && range(p).is_some_and(|(a, b)| a < preparation.at && b > start)
            }) {
                s.kind = "preparation".into();
            }
            spans.push(s);
        }
        if owner.kind == "subagent"
            || spans
                .iter()
                .any(|s| s.parent_id.as_deref() == Some(&owner.id) && s.kind == "shell")
        {
            continue;
        }
        let before = records
            .iter()
            .copied()
            .filter(|e| e.at >= start && e.at <= end)
            .filter(|e| {
                e.kind == "permission.resolved"
                    || e.kind == "hook.finished" && e.text("hook_event_name") == "PreToolUse"
            })
            .max_by_key(|e| e.at);
        let after = records
            .iter()
            .copied()
            .filter(|e| e.at >= start && e.at <= end)
            .filter(|e| {
                e.kind == "hook.started"
                    && matches!(
                        e.text("hook_event_name"),
                        "PostToolUse" | "PostToolUseFailure"
                    )
            })
            .min_by_key(|e| e.at);
        if let Some((a, b)) = before.zip(after).filter(|(a, b)| b.at >= a.at) {
            let mut s = span(
                Some(a),
                Some(b),
                "tool-execution",
                &owner.label,
                json!({"includesReturnWait": true}),
            );
            s.id = format!("{}-execution", owner.id);
            s.basis = "boundary-interval".into();
            s.parent_id = Some(owner.id.clone());
            s.relationship = Some("tool-call-id".into());
            s.turn_id = owner.turn_id.clone();
            spans.push(s);
        }
    }
}

fn link_subagents(turns: &mut [Turn], spans: &mut Vec<Span>, coverage: &mut Coverage) {
    for turn in turns.iter_mut() {
        let candidates: Vec<_> = spans
            .iter()
            .filter(|s| s.kind == "subagent" && s.turn_id.as_deref() != Some(&turn.label))
            .filter(|s| {
                s.facts["childTurnId"].as_str() == Some(&turn.label)
                    || turn.is_subagent
                        && s.start_ms.is_some_and(|a| a <= turn.start_ms)
                        && s.end_ms.zip(turn.end_ms).is_some_and(|(a, b)| a >= b)
            })
            .collect();
        let explicit: Vec<_> = candidates
            .iter()
            .filter(|s| s.facts["childTurnId"].as_str() == Some(&turn.label))
            .collect();
        let matched = if explicit.len() == 1 {
            Some((explicit[0].id.clone(), "explicit-child"))
        } else if candidates.len() == 1 {
            Some((candidates[0].id.clone(), "interval-containment"))
        } else {
            None
        };
        let ambiguous_parent = matched.is_none() && !candidates.is_empty();
        if let Some((parent, relationship)) = matched {
            turn.is_subagent = true;
            turn.parent_span_id = Some(parent.clone());
            if let Some(s) = spans.iter_mut().find(|s| s.id == parent) {
                s.facts["childTurnId"] = json!(turn.label);
                s.relationship = Some(relationship.into());
            }
        } else if turn.is_subagent {
            if ambiguous_parent {
                coverage.ambiguous_pairs += 1;
            }
            let s = Span {
                id: format!("{}-agent", turn.id),
                kind: if ambiguous_parent {
                    "subagent-turn"
                } else {
                    "subagent"
                }
                .into(),
                label: "Subagent".into(),
                start_ms: Some(turn.start_ms),
                end_ms: turn.end_ms,
                duration_ms: turn.duration_ms,
                basis: if turn.duration_ms.is_some() {
                    "event-pair"
                } else {
                    "unpaired"
                }
                .into(),
                status: if turn.duration_ms.is_some() {
                    "complete"
                } else {
                    "incomplete"
                }
                .into(),
                turn_id: Some(turn.label.clone()),
                parent_id: None,
                relationship: None,
                evidence: turn.evidence.clone(),
                facts: json!({ "subagentKind": "turn", "childTurnId": turn.label }),
                invocation: String::new(),
            };
            turn.parent_span_id = Some(s.id.clone());
            spans.push(s);
        }
    }
    // Child model/tool spans remain drillable beneath the subagent wrapper.
    let parents: HashMap<_, _> = turns
        .iter()
        .filter_map(|t| {
            t.parent_span_id
                .as_ref()
                .map(|id| (t.label.clone(), id.clone()))
        })
        .collect();
    for s in spans {
        if s.parent_id.is_none() {
            if let Some(parent) = s
                .turn_id
                .as_ref()
                .and_then(|t| parents.get(t))
                .filter(|p| **p != s.id)
            {
                s.parent_id = Some(parent.clone());
                if s.relationship.is_none() {
                    s.relationship = Some("turn-id".into());
                }
            }
        }
    }
}

fn metrics(spans: &[Span]) -> Vec<Metric> {
    [
        "model",
        "tool",
        "tool-execution",
        "shell",
        "dispatch",
        "preparation",
        "hook",
        "permission",
        "policy",
        "subagent",
        "phase",
    ]
    .iter()
    .filter_map(|kind| {
        let group: Vec<_> = spans.iter().filter(|s| s.kind == *kind).collect();
        if group.is_empty() {
            return None;
        }
        let mut durations: Vec<_> = group.iter().filter_map(|s| s.duration_ms).collect();
        durations.sort_unstable();
        Some(Metric {
            kind: (*kind).into(),
            count: group.len(),
            timed_count: durations.len(),
            duration_ms: (!durations.is_empty())
                .then(|| intervals::length(group.iter().filter_map(|s| range(s)).collect())),
            p95_ms: durations
                .get((durations.len() * 95).div_ceil(100).saturating_sub(1))
                .copied(),
            max_ms: durations.last().copied(),
        })
    })
    .collect()
}

fn subagents(spans: &[Span]) -> Subagents {
    let agents: Vec<_> = spans.iter().filter(|s| s.kind == "subagent").collect();
    let durations: Vec<_> = agents.iter().filter_map(|s| s.duration_ms).collect();
    let ranges: Vec<_> = agents.iter().filter_map(|s| range(s)).collect();
    Subagents {
        count: agents.len(),
        timed_count: durations.len(),
        cumulative_ms: (!durations.is_empty()).then(|| durations.iter().sum()),
        elapsed_ms: (!ranges.is_empty()).then(|| intervals::length(ranges.clone())),
        max_ms: durations.iter().max().copied(),
        peak_concurrency: intervals::peak(ranges),
        unlinked_turn_count: spans.iter().filter(|s| s.kind == "subagent-turn").count(),
        unlinked_count: agents
            .iter()
            .filter(|s| {
                s.facts["subagentKind"] == "turn"
                    || s.facts["childTurnId"].as_str().is_none_or(str::is_empty)
            })
            .count(),
    }
}

fn findings(
    spans: &[Span],
    subagents: &Subagents,
    coverage: &Coverage,
    retry_count: usize,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    for (kind, code, threshold) in [
        ("model", "long-model", 10_000),
        ("dispatch", "dispatch-wait", 1000),
        ("tool-execution", "tool-return-wait", 1000),
        ("shell", "shell-execution", 1000),
        ("permission", "approval-wait", 1000),
        ("hook", "hook-duration", 1000),
    ] {
        if let Some(s) = spans
            .iter()
            .filter(|s| s.kind == kind && s.duration_ms.is_some_and(|v| v >= threshold))
            .max_by_key(|s| s.duration_ms)
        {
            findings.push(Finding {
                code: code.into(),
                span_id: Some(s.id.clone()),
                duration_ms: s.duration_ms,
                count: 1,
                label: s.label.clone(),
            });
        }
    }
    findings.sort_by_key(|f| std::cmp::Reverse(f.duration_ms));
    if subagents.count > 0 {
        findings.push(Finding {
            code: "subagent-work".into(),
            span_id: spans
                .iter()
                .filter(|s| s.kind == "subagent")
                .max_by_key(|s| s.duration_ms)
                .map(|s| s.id.clone()),
            duration_ms: subagents.elapsed_ms,
            count: subagents.count,
            label: String::new(),
        });
    }
    if retry_count > 0 {
        findings.push(Finding {
            code: "retry-observed".into(),
            span_id: spans
                .iter()
                .find(|s| s.kind == "retry")
                .map(|s| s.id.clone()),
            duration_ms: None,
            count: retry_count,
            label: String::new(),
        });
    }
    if coverage.partial() {
        findings.push(Finding {
            code: "incomplete-evidence".into(),
            span_id: None,
            duration_ms: None,
            count: coverage.unpaired_events + coverage.ambiguous_pairs,
            label: String::new(),
        });
    }
    findings
}
