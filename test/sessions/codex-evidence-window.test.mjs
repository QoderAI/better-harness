import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";
import { CodexSessionAnalyzer } from "../../scripts/session-analysis/platforms/codex.mjs";
import { buildTaskEpisodes } from "../../scripts/session-analysis/episode-contract.mjs";
import { privacySafeUserInputText } from "../../scripts/session-analysis/privacy-safe-text.mjs";

const since = "2026-10-10T08:00:00.000Z";
const until = "2026-10-10T08:35:00.000Z";
const pageContext = '<external_codex_apps_open_page>{"page_id":null}</external_codex_apps_open_page>';
const browserContext = '<in-app-browser-context source="ambient-ui-state">Current URL: https://example.invalid</in-app-browser-context>';

test("Codex discovery includes cross-day activity and hydrates only the inclusive window", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-codex-window-"));
  try {
    const workspace = path.join(root, "project");
    const home = path.join(root, "codex-home");
    const sessionDir = path.join(home, "sessions", "2026", "10", "09");
    await mkdir(sessionDir, { recursive: true });
    const writeSession = async (id, cwd, timestamps) => {
      const rows = [
        { type: "session_meta", timestamp: "2026-10-09T10:00:00.000Z", payload: { id, cwd } },
        ...timestamps.map((timestamp) => ({ type: "event_msg", timestamp,
          payload: { type: "user_message", message: "Continue the accepted task" } })),
      ];
      await writeFile(path.join(sessionDir, `${id}.jsonl`), rows.map(JSON.stringify).join("\n"));
    };
    await writeSession("cross-day", workspace, ["2026-10-10T07:59:59.999Z", since, until, "2026-10-10T08:35:00.001Z"]);
    await writeSession("inactive", workspace, ["2026-10-10T07:59:59.999Z"]);
    await writeSession("future", workspace, ["2026-10-10T08:35:00.001Z"]);
    await writeSession("other-workspace", path.join(root, "other"), [since]);
    await writeSession("other-session", workspace, [since]);

    const analyzer = new CodexSessionAnalyzer();
    const options = { home, workspace, since, until, command: "sessions" };
    const index = await analyzer.analyze(options);
    assert.deepEqual(index.sessions.map((session) => session.sessionId).sort(), ["cross-day", "other-session"]);
    const targeted = await analyzer.analyze({ ...options, "session-id": "cross-day" });
    assert.equal(targeted.sessions.length, 1);
    const scope = await analyzer.resolveScope({ ...options, "session-id": "cross-day" });
    const events = await analyzer.readSession(targeted.sessions[0], scope, { includeUserText: true });
    assert.deepEqual(events.map((event) => event.timestamp), [since, until]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host UI context is not a request, while accompanying user text is preserved", () => {
  assert.equal(privacySafeUserInputText(pageContext), null);
  assert.equal(privacySafeUserInputText(browserContext), null);
  assert.equal(privacySafeUserInputText(`${browserContext}\n\n## My request:\nShip the accepted change`), "Ship the accepted change");
  assert.equal(privacySafeUserInputText(`${pageContext}\nInvestigate the failure`), "Investigate the failure");

  const analyzer = new CodexSessionAnalyzer();
  const normalize = (sessionId, offset, message, type = "user", extra = {}) => analyzer.normalizeEvent({
    timestamp: new Date(Date.parse(since) + offset * 1000).toISOString(),
    type: "response_item", payload: type === "user"
      ? { type: "message", role: "user", content: [{ type: "input_text", text: message }] }
      : { type: "function_call", name: "exec_command", call_id: `${sessionId}-${offset}`, arguments: JSON.stringify({ cmd: "npm test" }) },
  }, { kind: "codex-session-jsonl", sessionId, line: offset + 1 }, { includeUserText: true, includeCommandText: true, ...extra });

  const events = [
    normalize("task-a", 0, pageContext),
    normalize("task-a", 1, "Repair alpha behavior"),
    normalize("task-a", 2, null, "tool"),
    normalize("task-a", 3, browserContext),
    normalize("task-a", 4, null, "tool"),
    normalize("task-b", 0, pageContext),
    normalize("task-b", 1, "Repair beta behavior"),
    normalize("task-b", 2, null, "tool"),
  ];
  assert.equal(events[0].type, "context.user-input");
  assert.equal(events[3].type, "context.user-input");
  const result = buildTaskEpisodes(events, { platform: "codex", includeEpisodeFacts: true });
  assert.equal(result.episodes.length, 2);
  assert.deepEqual(result.episodeFacts.entries.map((entry) => entry.request.summary).sort(), ["Repair alpha behavior", "Repair beta behavior"]);
  assert.ok(result.episodeFacts.entries.every((entry) => entry.request.occurrences === 1));
});

test("Codex exec wrappers retain observed activity without inventing nested success", () => {
  const analyzer = new CodexSessionAnalyzer();
  const source = { kind: "codex-session-jsonl", sessionId: "wrapper-task", line: 1 };
  const rows = [
    { type: "event_msg", timestamp: since, payload: { type: "user_message", message: "Review the accepted release" } },
    { type: "response_item", timestamp: "2026-10-10T08:00:01.000Z", payload: {
      type: "custom_tool_call", name: "exec", call_id: "wrapper-call",
      input: 'text(await tools.exec_command({cmd:"git status --short"}));',
    } },
    { type: "response_item", timestamp: "2026-10-10T08:00:02.000Z", payload: {
      type: "custom_tool_call_output", call_id: "wrapper-call", output: "Script completed\nOutput: working tree clean",
    } },
    { type: "response_item", timestamp: "2026-10-10T08:00:03.000Z", payload: {
      type: "message", role: "assistant", content: [{ type: "output_text", text: "The observed state is ready for review." }],
    } },
  ];
  const events = rows.map((row, index) => analyzer.normalizeEvent(row, { ...source, line: index + 1 }, {
    includeUserText: true, includeCommandText: true,
  }));
  const facts = buildTaskEpisodes(events, { platform: "codex", includeEpisodeFacts: true }).episodeFacts;
  assert.equal(facts.entries.length, 1);
  const candidate = facts.entries[0];
  assert.deepEqual(candidate.activity, { toolCalls: 1 });
  assert.deepEqual(candidate.workTrace, { steps: ["execute", "handoff"] });
  assert.deepEqual(candidate.changes, { edits: 0, files: 0 });
  assert.deepEqual(candidate.checks, []);
  assert.equal(candidate.closure, "no-change-observed");
  assert.equal(candidate.result.structuredCompletionObserved, undefined);
});

test("image-only user requests preserve task boundaries after privacy sanitization", () => {
  const analyzer = new CodexSessionAnalyzer();
  const source = { kind: "codex-session-jsonl", sessionId: "image-task" };
  for (const image of [
    "![New design to implement](https://example.invalid/new-design.png)",
    '<image src="https://example.invalid/new-design.png"></image>',
  ]) {
    assert.equal(privacySafeUserInputText(image), null);
    const user = (message) => ({ type: "message", role: "user", content: [{ type: "input_text", text: message }] });
    const edit = (id) => ({ type: "custom_tool_call", name: "apply_patch", call_id: id,
      input: "*** Begin Patch\n*** Update File: src/app.mjs\n@@\n-old\n+new\n*** End Patch" });
    const events = [user("Repair alpha behavior"), edit("first-edit"), user(image), edit("second-edit")]
      .map((payload, index) => analyzer.normalizeEvent({ type: "response_item", payload,
        timestamp: new Date(Date.parse(since) + index * 1000).toISOString(),
      }, { ...source, line: index + 1 }, { includeUserText: true, includeCommandText: true }));

    assert.equal(events[2].type, "user");
    const result = buildTaskEpisodes(events, { platform: "codex", includeEpisodeFacts: true });
    assert.equal(result.episodes.length, 2);
    assert.equal(result.episodeFacts.entries.find((entry) => entry.request.summary === "Repair alpha behavior").changes.edits, 1);
  }
});
