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
    assert!(titled["session"]["label"]
        .as_str()
        .unwrap()
        .starts_with("Fix startup with"));
    assert!(!titled.to_string().contains("secret1234567890"));
    assert_eq!(
        detail["spans"][0]["evidence"][0]["source"],
        "1/segments/sample.jsonl"
    );
    assert!(analyze_params(
        &json!({"workspace":workspace,"qoderHome":home,"sessionId":"../sample"})
    )
    .is_err());
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
    // A huge tail must not change the cost of reading an early source window.
    use std::io::Write;
    let mut huge = fs::File::create(dir.join("huge.jsonl")).unwrap();
    huge.write_all(b"{}\n{}\n{}\n{}\n{}\n").unwrap();
    huge.set_len(128 * 1024 * 1024).unwrap();
    let early = analyze_params(&json!({"workspace":workspace,"qoderHome":home,"sessionId":"sample","source":{"source":"1/segments/huge.jsonl","line":2}})).unwrap();
    assert_eq!(early["scannedBytes"], 15);
    assert_eq!(early["truncated"], false);
    let source = analyze_params(&json!({"workspace":workspace,"qoderHome":home,"sessionId":"sample","source":{"source":"1/segments/sample.jsonl","line":2}})).unwrap();
    assert_eq!(source["startLine"], 1);
    assert_eq!(source["line"], 2);
    assert!(source["content"]
        .as_str()
        .unwrap()
        .contains("model.response.completed"));
    for source in [
        "../segments/sample.jsonl",
        "1/segments/../sample.jsonl",
        "1/segments/C:\\sample.jsonl",
        "1/segments/linked.jsonl",
    ] {
        assert!(analyze_params(&json!({"workspace":workspace,"qoderHome":home,"sessionId":"sample","source":{"source":source,"line":1}})).is_err());
    }
    let tool_rows = [
        json!({"type":"tool.requested","ts":"2026-09-01T01:00:00Z","tool_call_id":"one","data":{"tool_name":"Bash","args":{"command":"git status --short","password":"never-return"}}}),
        json!({"type":"tool.shell.started","ts":"2026-09-01T01:00:05Z","tool_call_id":"one","data":{}}),
        json!({"type":"tool.execution.finished","ts":"2026-09-01T01:00:06Z","tool_call_id":"one","data":{"tool_name":"Bash"}}),
    ];
    fs::write(
        dir.join("tool.jsonl"),
        tool_rows
            .iter()
            .map(serde_json::Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();
    let calls = analyze_params(&input).unwrap();
    let wait = calls["spans"]
        .as_array()
        .unwrap()
        .iter()
        .find(|s| s["kind"] == "dispatch")
        .unwrap();
    assert_eq!(wait["facts"]["callSummary"], "git status --short");
    assert!(!calls.to_string().contains("never-return"));
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
    assert!(ambiguous
        .spans
        .iter()
        .filter(|s| s.kind == "subagent")
        .all(|s| s.relationship.is_none()));
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
        event(
            "model.request.started",
            0,
            "main",
            "",
            json!({"text_preview":"MODEL INTERNAL"}),
        ),
        event("turn.started", 1, "child", "", json!({"is_subagent":true})),
        event(
            "input.prompt.received",
            2,
            "child",
            "",
            json!({"text_preview":"CHILD TASK"}),
        ),
        event(
            "input.prompt.submitted",
            3,
            "main",
            "",
            json!({"text_preview":"Fix the desktop startup"}),
        ),
        event(
            "input.prompt.received",
            4,
            "main",
            "",
            json!({"text_preview":"A later request"}),
        ),
    ]);
    assert_eq!(detail.session.label, "Fix the desktop startup");
    assert_eq!(analyze(vec![]).session.label, "Qoder · session-");
}

/// Claude and Codex transcripts must reach the same pairing rules Qoder uses,
/// keep their own evidence, and refuse to invent an interval across a pause.
#[test]
fn native_transcripts_are_measured_by_the_same_rules_and_stay_namespaced() {
    use std::fs;
    let suffix = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("perf-native-{}-{suffix}", std::process::id()));
    let workspace = root.join("project");
    fs::create_dir_all(&workspace).unwrap();
    let workspace = crate::paths::normalize_workspace(workspace.to_str().unwrap());
    let claude_home = root.join("claude");
    let slug = crate::paths::claude_slug_variants(&workspace).remove(0);
    let claude_dir = claude_home.join("projects").join(&slug);
    fs::create_dir_all(&claude_dir).unwrap();
    let rows = [
        json!({"type":"user","sessionId":"sid","promptId":"p1","timestamp":"2026-09-08T10:00:00.000Z",
            "message":{"role":"user","content":[{"type":"text","text":"Fix the startup"}]}}),
        json!({"type":"attachment","timestamp":"2026-09-08T10:00:00.500Z"}),
        json!({"type":"assistant","requestId":"req-1","timestamp":"2026-09-08T10:00:04.000Z",
            "message":{"model":"claude-opus-5","stop_reason":"tool_use","usage":{"output_tokens":12},
                "content":[{"type":"tool_use","id":"toolu_1","name":"Bash","input":{"command":"ls"}}]}}),
        json!({"type":"user","timestamp":"2026-09-08T10:00:06.000Z","message":{"role":"user",
            "content":[{"type":"tool_result","tool_use_id":"toolu_1","is_error":false}]}}),
        // A session bridge between the tool result and the reply to it: the
        // eight-hour gap is a pause, not a request.
        json!({"type":"bridge-session","timestamp":"2026-09-08T10:00:07.000Z"}),
        json!({"type":"assistant","requestId":"req-2","timestamp":"2026-09-08T18:00:00.000Z",
            "message":{"model":"claude-opus-5","stop_reason":"end_turn","content":[{"type":"text","text":"done"}]}}),
    ];
    fs::write(
        claude_dir.join("sid.jsonl"),
        rows.iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();

    let codex_home = root.join("codex");
    let codex_dir = codex_home
        .join("sessions")
        .join("2026")
        .join("09")
        .join("08");
    fs::create_dir_all(&codex_dir).unwrap();
    let codex_rows = [
        json!({"timestamp":"2026-09-08T10:00:00.000Z","type":"session_meta",
            "payload":{"id":"cx1","session_id":"other-thread","cwd": workspace.to_string_lossy()}}),
        json!({"timestamp":"2026-09-08T10:00:00.000Z","type":"event_msg",
            "payload":{"type":"task_started","turn_id":"t1"}}),
        json!({"timestamp":"2026-09-08T10:00:01.000Z","type":"event_msg","payload":{"type":"item_completed",
            "turn_id":"t1","started_at_ms":1788_000_000_000i64,"completed_at_ms":1788_000_000_000i64,
            "item":{"type":"UserMessage","id":"u1","content":[{"type":"text","text":
                "You are running under harness revision hr_test.\nFollow these harness policies:\n- [coder/workspace-grounding] Stay in the workspace.\n\nShip the release"}]}}}),
        json!({"timestamp":"2026-09-08T10:00:02.000Z","type":"response_item","payload":{"type":"custom_tool_call",
            "name":"exec","call_id":"call_exec","id":"ctc_exec","arguments":"cargo test"}}),
        json!({"timestamp":"2026-09-08T10:00:05.000Z","type":"response_item","payload":{"type":"custom_tool_call_output",
            "call_id":"call_exec"}}),
        json!({"timestamp":"2026-09-08T10:00:05.000Z","type":"event_msg","payload":{"type":"item_completed",
            "turn_id":"t1","started_at_ms":1788_000_000_000i64,"completed_at_ms":1788_000_003_000i64,
            "item":{"type":"CommandExecution","id":"exec-1","status":"completed",
                "command":"['/bin/zsh','-lc','cargo test']","parsed_cmd":[{"type":"test"}]}}}),
        json!({"timestamp":"2026-09-08T10:00:06.000Z","type":"response_item","payload":{"type":"function_call",
            "name":"wait","call_id":"call_wait","id":"fc_wait"}}),
        json!({"timestamp":"2026-09-08T10:00:08.000Z","type":"response_item","payload":{"type":"function_call_output",
            "call_id":"call_wait"}}),
        json!({"timestamp":"2026-09-08T10:00:20.000Z","type":"event_msg","payload":{"type":"task_complete",
            "turn_id":"t1","duration_ms":20000,"time_to_first_token_ms":640}}),
    ];
    fs::write(
        codex_dir.join("rollout-2026-09-08T10-00-00-cx1.jsonl"),
        codex_rows
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n"),
    )
    .unwrap();

    let base = json!({"workspace": workspace.to_string_lossy(), "qoderHome": root.join("qoder").to_string_lossy(),
        "claudeHome": claude_home.to_string_lossy(), "codexHome": codex_home.to_string_lossy()});
    let mut catalog_params = base.clone();
    catalog_params["maxSessions"] = json!(50);
    let catalog = analyze_params(&catalog_params).unwrap();
    let ids: Vec<_> = catalog["sessions"]
        .as_array()
        .unwrap()
        .iter()
        .map(|s| s["id"].as_str().unwrap().to_string())
        .collect();
    assert!(ids.contains(&"claude:sid".to_string()) && ids.contains(&"codex:cx1".to_string()));
    assert!(!ids.contains(&"codex:other-thread".to_string()));
    // Ranking is global: two native Sessions plus no Qoder still honour maxSessions.
    catalog_params["maxSessions"] = json!(1);
    let capped = analyze_params(&catalog_params).unwrap();
    assert_eq!(capped["sessions"].as_array().unwrap().len(), 1);
    assert_eq!(capped["coverage"]["discoveredSessions"], 2);
    assert_eq!(capped["coverage"]["omittedSessions"], 1);

    let mut claude_params = base.clone();
    claude_params["sessionId"] = json!("claude:sid");
    let claude = analyze_params(&claude_params).unwrap();
    assert_eq!(claude["session"]["provider"], "claude");
    assert_eq!(claude["session"]["label"], "Fix the startup");
    let spans = claude["spans"].as_array().unwrap();
    let tool = spans.iter().find(|s| s["kind"] == "tool").unwrap();
    assert_eq!(tool["durationMs"], 2000);
    assert_eq!(tool["facts"]["toolCallId"], "toolu_1");
    let model: Vec<_> = spans.iter().filter(|s| s["kind"] == "model").collect();
    // The first request is bounded by the prompt that triggered it; the second
    // spans a bridge record, so it is reported unpaired instead of as 8 hours.
    assert_eq!(model.iter().filter(|s| s["durationMs"] == 4000).count(), 1);
    assert_eq!(
        model.iter().filter(|s| s["durationMs"].is_null()).count(),
        1
    );
    assert!(
        claude["session"]["coverage"]["unpairedEvents"]
            .as_i64()
            .unwrap()
            >= 1
    );

    let mut codex_params = base.clone();
    codex_params["sessionId"] = json!("codex:cx1");
    let codex = analyze_params(&codex_params).unwrap();
    assert_eq!(codex["session"]["provider"], "codex");
    assert_eq!(codex["session"]["label"], "Ship the release");
    assert_eq!(codex["session"]["firstTokenStatus"], "recorded");
    assert_eq!(codex["session"]["firstTokenMs"], 640);
    assert_eq!(codex["turns"][0]["durationMs"], 20000);
    let spans = codex["spans"].as_array().unwrap();
    let shell = spans.iter().find(|s| s["kind"] == "shell").unwrap();
    assert_eq!(shell["durationMs"], 3000);
    assert_eq!(shell["label"], "test");
    assert_eq!(spans.iter().filter(|s| s["kind"] == "shell").count(), 1);
    assert_eq!(
        spans
            .iter()
            .filter(|s| s["kind"] == "tool" && s["label"] == "exec")
            .count(),
        0
    );
    assert_eq!(
        spans
            .iter()
            .filter(|s| s["kind"] == "tool" && s["label"] == "wait")
            .count(),
        1
    );
    assert_eq!(codex["session"]["id"], "codex:cx1");

    // Evidence resolves back to the transcript it was read from, and only to it.
    let line = claude["spans"].as_array().unwrap()[0]["evidence"][0]["line"].clone();
    let mut source_params = claude_params.clone();
    source_params["source"] = json!({"source":"1/transcript/sid.jsonl","line": line});
    assert!(analyze_params(&source_params).unwrap()["content"].is_string());
    for bad in [
        "1/segments/sid.jsonl",
        "2/transcript/sid.jsonl",
        "1/transcript/other.jsonl",
    ] {
        source_params["source"] = json!({"source": bad, "line": 1});
        assert!(analyze_params(&source_params).is_err());
    }
    for bad in ["claude:", ":sid", "claude:sid:extra", "claude:../sid"] {
        let mut params = base.clone();
        params["sessionId"] = json!(bad);
        assert!(analyze_params(&params).is_err(), "{bad} must be rejected");
    }
    fs::remove_dir_all(&root).ok();
}
