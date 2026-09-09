use super::*;
use serde_json::json;

fn event(kind: &str, at: i64, turn: &str, tool: &str, data: serde_json::Value) -> Event {
    Event {
        kind: kind.into(),
        at: at + 1_700_000_000_000,
        seq: at as u64,
        turn: turn.into(),
        tool: tool.into(),
        request: String::new(),
        loop_id: "loop".into(),
        data,
        evidence: Evidence {
            source: "1/segments/example.jsonl".into(),
            line: at as usize + 1,
            event_type: kind.into(),
            timestamp_ms: at + 1_700_000_000_000,
        },
    }
}
fn analyze(mut events: Vec<Event>) -> Detail {
    events.sort_by_key(|e| e.at);
    super::analyze::analyze("session-test", events, Coverage::default())
}
#[test]
fn dispatch_is_distinct_from_shell_and_nested_hooks_are_not_added_to_wall_time() {
    let detail = analyze(vec![
        event("turn.started", 0, "main", "", json!({})),
        event(
            "tool.requested",
            0,
            "main",
            "bash",
            json!({"tool_name":"Bash"}),
        ),
        event(
            "hook.started",
            344992,
            "main",
            "bash",
            json!({"hook_event_name":"PreToolUse", "hook_name":"PreToolUse","source":"config"}),
        ),
        event(
            "hook.finished",
            346128,
            "main",
            "bash",
            json!({"hook_event_name":"PreToolUse", "hook_name":"PreToolUse","source":"config","duration_ms":1136}),
        ),
        event("tool.shell.started", 348149, "main", "bash", json!({})),
        event(
            "tool.shell.finished",
            348257,
            "main",
            "bash",
            json!({"exit_code":0}),
        ),
        event(
            "tool.execution.finished",
            349182,
            "main",
            "bash",
            json!({"tool_name":"Bash"}),
        ),
        event("turn.finished", 350000, "main", "", json!({})),
    ]);
    let duration = |kind| {
        detail
            .spans
            .iter()
            .find(|s| s.kind == kind)
            .unwrap()
            .duration_ms
    };
    assert_eq!(duration("tool"), Some(349182));
    assert_eq!(duration("shell"), Some(108));
    assert_eq!(duration("dispatch"), Some(344992));
    assert_eq!(detail.session.timed_union_ms, Some(349182));
    assert_eq!(detail.session.unattributed_turn_ms, Some(818));
}
#[test]
fn explicit_approval_duration_survives_coemitted_timestamps() {
    let detail = analyze(vec![
        event(
            "permission.requested",
            40000000,
            "main",
            "ask",
            json!({"tool_name":"AskUserQuestion"}),
        ),
        event(
            "permission.resolved",
            40000005,
            "main",
            "ask",
            json!({"duration_ms":35308824,"source":"user","allowed":true}),
        ),
    ]);
    assert_eq!(detail.spans[0].duration_ms, Some(35308824));
    assert_eq!(detail.spans[0].facts["eventPairMs"], 5);
    assert_eq!(detail.spans[0].basis, "reported-duration");
    assert_eq!(detail.session.coverage.clock_conflicts, 1);
}
#[test]
fn retry_fallback_is_unique_and_never_invents_ttft() {
    let mut start = event(
        "model.request.started",
        0,
        "main",
        "",
        json!({"request_index":1,"model":"test"}),
    );
    start.request = "old".into();
    let mut end = event(
        "model.response.completed",
        11000,
        "main",
        "",
        json!({"request_index":1}),
    );
    end.request = "new".into();
    let detail = analyze(vec![
        start.clone(),
        event(
            "model.request.attempt_failed",
            10000,
            "main",
            "",
            json!({"will_retry":true,"error_name":"NetworkAttemptError"}),
        ),
        end.clone(),
    ]);
    assert_eq!(detail.session.retry_count, 1);
    assert_eq!(detail.session.first_token_status, "unrecorded");
    assert_eq!(
        detail
            .spans
            .iter()
            .find(|s| s.kind == "model")
            .unwrap()
            .duration_ms,
        Some(11000)
    );
    start.request = "another".into();
    start.evidence.line = 3;
    let ambiguous = analyze(vec![
        start.clone(),
        {
            let mut s = start;
            s.request = "old".into();
            s
        },
        end,
    ]);
    assert_eq!(ambiguous.session.coverage.ambiguous_pairs, 1);
    assert!(ambiguous.spans.iter().all(|s| s.duration_ms.is_none()));
}
#[test]
fn subagent_wrappers_link_flagged_children_without_double_counting() {
    let detail = analyze(vec![
        event(
            "tool.requested",
            0,
            "main",
            "a",
            json!({"tool_name":"Agent"}),
        ),
        event("turn.started", 1, "child", "", json!({"is_subagent":true})),
        event("turn.finished", 9, "child", "", json!({})),
        event(
            "tool.execution.finished",
            10,
            "main",
            "a",
            json!({"tool_name":"Agent"}),
        ),
        event(
            "tool.requested",
            5,
            "main",
            "b",
            json!({"tool_name":"Agent"}),
        ),
        event(
            "tool.execution.finished",
            15,
            "main",
            "b",
            json!({"tool_name":"Agent"}),
        ),
    ]);
    assert_eq!(detail.session.subagents.count, 2);
    assert_eq!(detail.session.subagents.cumulative_ms, Some(20));
    assert_eq!(detail.session.subagents.elapsed_ms, Some(15));
    assert_eq!(detail.session.subagents.peak_concurrency, 2);
    assert!(detail.turns[0].parent_span_id.is_some());
}
#[test]
fn ambiguous_children_remain_unlinked_and_incomplete_agents_have_no_duration() {
    let detail = analyze(vec![event(
        "turn.started",
        0,
        "child",
        "",
        json!({"is_subagent":true}),
    )]);
    assert_eq!(detail.session.subagents.count, 1);
    assert_eq!(detail.session.subagents.timed_count, 0);
    assert_eq!(detail.session.subagents.cumulative_ms, None);
    assert_eq!(detail.session.subagents.unlinked_count, 1);
    assert_eq!(detail.session.status, "partial");
}
#[test]
fn union_and_peak_handle_touching_intervals() {
    assert_eq!(intervals::length(vec![(0, 10), (5, 15), (15, 20)]), 20);
    assert_eq!(intervals::peak(vec![(0, 10), (10, 20)]), 1);
    assert_eq!(
        intervals::intersection(vec![(0, 10), (5, 15)], vec![(10, 20)]),
        5
    );
}

#[test]
fn reader_scopes_paths_redacts_labels_and_marks_corrupt_evidence() {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };
    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("performance-{}-{suffix}", std::process::id()));
    let workspace = root.join("project");
    fs::create_dir_all(&workspace).unwrap();
    let workspace = crate::paths::normalize_workspace(workspace.to_str().unwrap());
    let home = root.join("qoder");
    let dir = home
        .join("logs")
        .join("sessions")
        .join(&crate::paths::qoder_slug_variants(&workspace)[0])
        .join("sample")
        .join("segments");
    fs::create_dir_all(&dir).unwrap();
    let rows = [
        json!({"type":"model.request.started","ts":"2026-09-01T01:00:00Z","turn_id":"main","request_id":"r","data":{"model":"test","prompt":"DO-NOT-EXPOSE"}}),
        json!({"type":"model.response.completed","ts":"2026-09-01T01:00:10Z","turn_id":"main","request_id":"r","data":{"output":"DO-NOT-EXPOSE","model":"test"}}),
    ];
    let content = format!(
        "{}\n{}\ncorrupt\n{}\n",
        rows[0],
        rows[1],
        json!({"type":"tool.requested","ts":"invalid"})
    );
    fs::write(dir.join("sample.jsonl"), content).unwrap();
    let input = json!({"workspace":workspace,"qoderHome":home,"sessionId":"sample"});
    let detail = analyze_params(&input).unwrap();
    assert_eq!(detail["session"]["coverage"]["invalidLines"], 1);
    assert_eq!(detail["session"]["coverage"]["invalidTimestamps"], 1);
    assert_eq!(detail["spans"][0]["durationMs"], 10000);
    assert_eq!(detail["session"]["status"], "partial");
    assert!(!detail.to_string().contains("DO-NOT-EXPOSE"));
    assert_eq!(detail["session"]["label"], "Qoder · sample");
    let prompt = json!({"type":"input.prompt.submitted","ts":"2026-09-01T00:59:59Z","turn_id":"main","data":{"text_preview":"Fix startup\n  with api_key=secret1234567890"}});
    fs::write(dir.join("prompt.jsonl"), format!("{prompt}\n")).unwrap();
    let titled = analyze_params(&input).unwrap();
    assert!(titled["session"]["label"].as_str().unwrap().starts_with("Fix startup with"));
    assert!(!titled.to_string().contains("secret1234567890"));
    assert_eq!(
        detail["spans"][0]["evidence"][0]["source"],
        "1/segments/sample.jsonl"
    );
    assert!(
        analyze_params(&json!({"workspace":workspace,"qoderHome":home,"sessionId":"../sample"}))
            .is_err()
    );
    assert!(analyze_params(&json!({"workspace":workspace,"qoderHome":home,"unknown":1})).is_err());
    #[cfg(unix)]
    {
        let external = root.join("external.jsonl");
        fs::write(&external, "{}\n").unwrap();
        std::os::unix::fs::symlink(&external, dir.join("linked.jsonl")).unwrap();
        let linked = analyze_params(&input).unwrap();
        assert_eq!(linked["session"]["coverage"]["unreadableFiles"], 1);
    }
    let large = fs::File::create(dir.join("large.jsonl")).unwrap();
    large.set_len(9 * 1024 * 1024).unwrap();
    let bounded = analyze_params(&input).unwrap();
    assert_eq!(bounded["session"]["coverage"]["truncated"], true);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn fork_identity_links_child_and_ambiguous_containment_does_not_guess() {
    let detail = analyze(vec![
        event(
            "fork.agent.started",
            0,
            "parent",
            "",
            json!({"prompt_id":"child","fork_label":"worker"}),
        ),
        event("turn.started", 1, "child", "", json!({})),
        event("turn.finished", 9, "child", "", json!({})),
        event(
            "fork.agent.completed",
            10,
            "parent",
            "",
            json!({"prompt_id":"child","fork_label":"worker","duration_ms":10}),
        ),
    ]);
    assert_eq!(detail.session.subagents.count, 1);
    assert_eq!(
        detail.spans[0].relationship.as_deref(),
        Some("explicit-child")
    );
    assert!(detail.turns[0].is_subagent);
    let ambiguous = analyze(vec![
        event(
            "tool.requested",
            0,
            "parent",
            "a",
            json!({"tool_name":"Agent"}),
        ),
        event(
            "tool.requested",
            0,
            "parent",
            "b",
            json!({"tool_name":"Agent"}),
        ),
        event("turn.started", 1, "child", "", json!({"is_subagent":true})),
        event("turn.finished", 9, "child", "", json!({})),
        event(
            "tool.execution.finished",
            10,
            "parent",
            "a",
            json!({"tool_name":"Agent"}),
        ),
        event(
            "tool.execution.finished",
            10,
            "parent",
            "b",
            json!({"tool_name":"Agent"}),
        ),
    ]);
    assert!(
        ambiguous
            .spans
            .iter()
            .filter(|s| s.kind == "subagent")
            .all(|s| s.relationship.is_none())
    );
    assert_eq!(ambiguous.session.subagents.count, 2);
    assert_eq!(ambiguous.session.subagents.unlinked_count, 2);
    assert_eq!(ambiguous.session.subagents.unlinked_turn_count, 1);
    assert_eq!(ambiguous.session.subagents.cumulative_ms, Some(20));
    assert_eq!(ambiguous.session.coverage.ambiguous_pairs, 1);
}
#[test]
fn overlapping_hooks_use_finish_durations_without_inventing_script_pairs() {
    let detail = analyze(vec![
        event(
            "hook.started",
            0,
            "main",
            "a",
            json!({"hook_name":"PreToolUse","source":"user"}),
        ),
        event(
            "hook.started",
            1,
            "main",
            "a",
            json!({"hook_name":"PreToolUse","source":"user"}),
        ),
        event(
            "hook.finished",
            10,
            "main",
            "a",
            json!({"hook_name":"PreToolUse","source":"user","duration_ms":10}),
        ),
        event(
            "hook.finished",
            11,
            "main",
            "a",
            json!({"hook_name":"PreToolUse","source":"user","duration_ms":10}),
        ),
    ]);
    assert_eq!(detail.session.metrics[0].duration_ms, Some(11));
    assert!(detail.spans.iter().all(|s| s.basis == "reported-duration"
        && s.evidence.len() == 1
        && s.facts["attribution"] == "source-group"));
}
#[test]
fn large_details_keep_full_summary_and_state_omitted_rows() {
    let mut events = Vec::new();
    for i in 0..4100 {
        let mut a = event("model.request.started", i * 2, "main", "", json!({}));
        a.request = format!("r-{i}");
        let mut b = event("model.response.completed", i * 2 + 1, "main", "", json!({}));
        b.request = a.request.clone();
        events.extend([a, b]);
    }
    let detail = analyze(events);
    assert_eq!(detail.total_spans, 4100);
    assert_eq!(detail.spans.len(), 4000);
    assert_eq!(detail.omitted_spans, 100);
    assert_eq!(detail.session.metrics[0].count, 4100);
    assert_eq!(detail.session.metrics[0].duration_ms, Some(4100));
}

#[test]
fn storage_partition_and_each_drilldown_sum_exactly_without_overlap() {
    let detail = analyze(vec![
        event("turn.started", 0, "main", "", json!({})),
        event(
            "tool.requested",
            0,
            "main",
            "a",
            json!({"tool_name":"Bash"}),
        ),
        event("tool.shell.started", 10, "main", "a", json!({})),
        event("tool.shell.finished", 20, "main", "a", json!({})),
        event(
            "tool.execution.finished",
            20,
            "main",
            "a",
            json!({"tool_name":"Bash"}),
        ),
        event(
            "tool.requested",
            5,
            "main",
            "agent",
            json!({"tool_name":"Agent"}),
        ),
        event(
            "tool.execution.finished",
            15,
            "main",
            "agent",
            json!({"tool_name":"Agent"}),
        ),
        event("turn.finished", 30, "main", "", json!({})),
    ]);
    let b = &detail.session.breakdown;
    assert_eq!(b.total_ms, 30);
    assert_eq!(b.activity_total_ms, 40);
    assert_eq!(
        b.segments
            .iter()
            .find(|s| s.kind == "subagent")
            .unwrap()
            .activity_ms,
        10
    );
    assert_eq!(b.segments.iter().map(|s| s.duration_ms).sum::<i64>(), 30);
    assert_eq!(
        b.segments
            .iter()
            .find(|s| s.kind == "parallel")
            .unwrap()
            .duration_ms,
        10
    );
    assert_eq!(
        b.segments
            .iter()
            .find(|s| s.kind == "unknown")
            .unwrap()
            .duration_ms,
        10
    );
    for segment in &b.segments {
        assert_eq!(
            segment.parts.iter().map(|p| p.duration_ms).sum::<i64>(),
            segment.duration_ms
        );
        for part in &segment.parts {
            assert_eq!(
                part.calls.iter().map(|c| c.duration_ms).sum::<i64>(),
                part.cumulative_ms
            );
        }
    }
}

#[test]
fn session_title_uses_first_main_user_prompt_and_falls_back_without_one() {
    let detail = analyze(vec![
        event("model.request.started", 0, "main", "", json!({"text_preview":"MODEL INTERNAL"})),
        event("turn.started", 1, "child", "", json!({"is_subagent":true})),
        event("input.prompt.received", 2, "child", "", json!({"text_preview":"CHILD TASK"})),
        event("input.prompt.submitted", 3, "main", "", json!({"text_preview":"Fix the desktop startup"})),
        event("input.prompt.received", 4, "main", "", json!({"text_preview":"A later request"})),
    ]);
    assert_eq!(detail.session.label, "Fix the desktop startup");
    assert_eq!(analyze(vec![]).session.label, "Qoder · session-");
}
