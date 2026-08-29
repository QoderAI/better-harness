import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { summarizeSessionEvents } from "../../scripts/commit-session-link/session-source.mjs";
import { AugmentSessionAnalyzer } from "../../scripts/session-analysis/platforms/augment.mjs";

async function fixtureRoot(prefix = "augment-session-provider-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSession(home, record, filename = `${record.sessionId}.json`) {
  const sessionsDir = path.join(home, "sessions");
  await mkdir(sessionsDir, { recursive: true });
  const filePath = path.join(sessionsDir, filename);
  await writeFile(filePath, `${JSON.stringify(record, null, 2)}\n`);
  return filePath;
}

function ideStateNode(workspaceRoots, cwd = workspaceRoots[0]) {
  return {
    id: 2,
    type: 4,
    ide_state_node: {
      current_terminal: {
        terminal_id: "terminal-fixture",
        current_working_directory: cwd,
      },
      workspace_folders: workspaceRoots.map((workspace) => ({
        folder_root: workspace,
        repository_root: workspace,
      })),
      workspace_folders_unchanged: false,
    },
  };
}

function usageNode(id, timestamp, usage) {
  return {
    id,
    type: 10,
    token_usage: usage,
    context_usage: null,
    timestamp_ms: new Date(timestamp).getTime(),
  };
}

function augmentSession({ sessionId, workspaceRoots, cwd = workspaceRoots[0] }) {
  const first = "2026-08-29T01:00:00.000Z";
  const second = "2026-08-29T01:01:00.000Z";
  return {
    sessionId,
    created: first,
    modified: "2026-08-29T01:01:05.000Z",
    rootTaskUuid: "task-identity-is-not-session-ownership",
    subAgentCreditsUsed: 0,
    agentState: { modelId: "session-current-model-not-response-attribution" },
    chatHistory: [
      {
        finishedAt: "2026-08-29T01:00:05.000Z",
        exchange: {
          request_id: "request-1",
          request_message: "fallback prompt must not duplicate request nodes",
          request_nodes: [
            { id: 1, type: 0, text_node: { content: "private user prompt" } },
            ideStateNode(workspaceRoots, cwd),
          ],
          response_text: "fallback response must not duplicate response nodes",
          response_nodes: [
            { id: 1, type: 0, content: "private assistant response", timestamp_ms: new Date(first).getTime() + 1_000 },
            { id: 2, type: 8, thinking: { content: "private thinking", summary: "private thought summary" } },
            {
              id: 3,
              type: 5,
              tool_use: {
                tool_use_id: "tool-1",
                tool_name: "Read",
                input_json: JSON.stringify({ file_path: path.join(workspaceRoots[0], "src", "index.mjs") }),
                is_partial: false,
                started_at_ms: new Date(first).getTime() + 2_000,
                completed_at_ms: new Date(first).getTime() + 3_000,
              },
            },
            usageNode(4, "2026-08-29T01:00:04.000Z", {
              input_tokens: 10,
              output_tokens: 5,
              cache_read_input_tokens: 20_000,
              cache_creation_input_tokens: 39_990,
              max_context_tokens: 200_000,
            }),
          ],
        },
      },
      {
        finishedAt: "2026-08-29T01:01:05.000Z",
        exchange: {
          request_id: "request-2",
          request_nodes: [
            {
              id: 5,
              type: 10,
              history_summary_node: {
                summarization_request_id: "summary-1",
                history_beginning_dropped_num_exchanges: 1,
                history_middle_abridged_text: "private abridged history",
                history_end: [],
                message_template: "private summary template",
              },
            },
            {
              id: 1,
              type: 1,
              tool_result_node: {
                tool_use_id: "tool-1",
                content: "3 tests passed; private tool output",
                is_error: false,
              },
            },
            { id: 2, type: 0, text_node: { content: "private follow-up prompt" } },
            ideStateNode(workspaceRoots, cwd),
          ],
          response_nodes: [
            { id: 1, type: 0, content: "private follow-up response", timestamp_ms: new Date(second).getTime() + 1_000 },
            usageNode(4, "2026-08-29T01:01:04.000Z", {
              input_tokens: 2,
              output_tokens: 4,
              cache_read_input_tokens: 10_000,
              cache_creation_input_tokens: 1_998,
              max_context_tokens: 200_000,
            }),
          ],
        },
      },
    ],
  };
}

test("Augment provider qualifies one workspace and excludes foreign or mixed workspace sessions (AC-1)", async () => {
  const root = await fixtureRoot();
  const home = path.join(root, ".augment");
  const workspace = path.join(root, "workspace");
  const foreign = path.join(root, "foreign");
  await writeSession(home, augmentSession({ sessionId: "direct", workspaceRoots: [workspace] }));
  await writeSession(home, augmentSession({ sessionId: "foreign", workspaceRoots: [foreign] }));
  await writeSession(home, augmentSession({ sessionId: "mixed", workspaceRoots: [workspace, foreign] }));

  const result = await new AugmentSessionAnalyzer().analyze({
    command: "sources",
    workspace,
    "augment-home": home,
  });

  assert.equal(result.scope.platform, "augment");
  assert.equal(result.scope.home, home);
  assert.equal(result.sources[0].kind, "augment-session-json");
  assert.equal(result.sources[0].exists, true);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["direct"]);
});

test("Augment provider preserves Windows workspace semantics on a non-Windows host (AC-1)", async () => {
  const root = await fixtureRoot("augment-session-windows-");
  const home = path.join(root, ".augment");
  const workspace = "C:\\work\\Project";
  await writeSession(home, augmentSession({
    sessionId: "windows-session",
    workspaceRoots: ["c:\\work\\project"],
    cwd: "C:\\work\\PROJECT\\src",
  }));

  const result = await new AugmentSessionAnalyzer().analyze({
    command: "sessions",
    workspace,
    augmentHome: home,
  });

  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "windows-session");
  assert.equal(result.scope.workspace, path.win32.normalize(workspace));
});

test("Augment provider revalidates workspace identity before selected-session hydration (AC-1)", async () => {
  const root = await fixtureRoot("augment-session-revalidation-");
  const home = path.join(root, ".augment");
  const workspace = path.join(root, "workspace");
  const foreign = path.join(root, "foreign");
  const filePath = await writeSession(home, augmentSession({ sessionId: "moving-session", workspaceRoots: [workspace] }));
  const analyzer = new AugmentSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const [session] = await analyzer.discoverSessions(scope, roots);

  await writeFile(filePath, `${JSON.stringify(augmentSession({
    sessionId: "moving-session",
    workspaceRoots: [foreign],
  }), null, 2)}\n`);

  const events = await analyzer.readSession(session, scope);
  assert.equal(events.length, 0);
});

test("Augment provider normalizes prompts, tools, usage, context, and explicit compaction (AC-2 through AC-5)", async () => {
  const root = await fixtureRoot();
  const home = path.join(root, ".augment");
  const workspace = path.join(root, "workspace");
  await writeSession(home, augmentSession({ sessionId: "usage-session", workspaceRoots: [workspace] }));
  const analyzer = new AugmentSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  const events = await analyzer.readSession(sessions[0], scope, {});

  assert.equal(events.filter((event) => event.type === "user").length, 2);
  assert.equal(events.filter((event) => event.type === "assistant").length, 2);
  assert.equal(events.filter((event) => event.type === "tool.call").length, 1);
  assert.equal(events.filter((event) => event.type === "tool.result").length, 1);
  assert.equal(events.filter((event) => event.type === "model.response.completed").length, 2);
  assert.equal(events.filter((event) => event.compactionBoundary === true).length, 1);
  assert.equal(events.find((event) => event.type === "tool.result")?.toolInvocationId, "tool-1");
  assert.equal(events.find((event) => event.type === "tool.result")?.success, true);

  const usage = events.find((event) => event.responseId === "request-1:usage-4");
  assert.deepEqual(usage.modelInvocationUsage, {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadInputTokens: 20_000,
    cacheCreationInputTokens: 39_990,
  });
  assert.deepEqual(usage.currentContextUsage, {
    usedTokens: 60_000,
    windowTokens: 200_000,
    basis: "prompt-tokens",
    source: "augment-session-json",
    rawTextOmitted: true,
  });
  assert.equal(usage.processedTokens, 60_005);
  assert.equal(Object.hasOwn(usage, "model"), false);

  const serialized = JSON.stringify(events);
  for (const privateText of [
    "private user prompt",
    "private assistant response",
    "private thinking",
    "private abridged history",
    "private summary template",
    "private tool output",
  ]) {
    assert.equal(serialized.includes(privateText), false, privateText);
  }

  const summary = summarizeSessionEvents(sessions[0], events, {
    repoRoot: workspace,
    platform: "augment",
    includeDialogue: true,
  });
  assert.equal(summary.usageReport.actualModelCalls, 2);
  assert.equal(summary.usageReport.currentContextTokens, 12_000);
  assert.equal(summary.usageReport.progression.at(-1).windowTokens, 200_000);
  assert.equal(summary.usageReport.progression.at(-1).percentFull, 6);
  assert.equal(summary.usageReport.contextResetCount, 1);
  assert.equal(summary.contextManifest.compactionCount, 1);
});

test("Augment content flags expose dialogue and commands without exposing thinking or history summaries (AC-5)", async () => {
  const root = await fixtureRoot();
  const home = path.join(root, ".augment");
  const workspace = path.join(root, "workspace");
  await writeSession(home, augmentSession({ sessionId: "content-session", workspaceRoots: [workspace] }));
  const analyzer = new AugmentSessionAnalyzer();
  const scope = await analyzer.resolveScope({ workspace, home });
  const roots = await analyzer.discoverSourceRoots(scope);
  const [session] = await analyzer.discoverSessions(scope, roots);
  const events = await analyzer.readSession(session, scope, {
    includeUserText: true,
    includeContent: true,
    includeCommandText: true,
  });

  assert.equal(events.find((event) => event.type === "user")?.userText, "private user prompt");
  assert.equal(events.find((event) => event.type === "assistant")?.content, "private assistant response");
  assert.equal(events.find((event) => event.type === "tool.call")?.filePath, path.join(workspace, "src", "index.mjs"));
  const serialized = JSON.stringify(events);
  assert.equal(serialized.includes("private thinking"), false);
  assert.equal(serialized.includes("private abridged history"), false);
  assert.equal(serialized.includes("private summary template"), false);
  assert.equal(serialized.includes("private tool output"), false);
});

test("Augment provider keeps missing usage unobserved and reports malformed local files (AC-3, AC-7)", async () => {
  const root = await fixtureRoot();
  const home = path.join(root, ".augment");
  const workspace = path.join(root, "workspace");
  const record = augmentSession({ sessionId: "partial-session", workspaceRoots: [workspace] });
  record.chatHistory[0].exchange.response_nodes[3] = {
    id: 4,
    type: 10,
    token_usage: null,
    context_usage: null,
  };
  await writeSession(home, record);
  await writeFile(path.join(home, "sessions", "malformed.json"), "{not-json\n");

  const analyzer = new AugmentSessionAnalyzer();
  const result = await analyzer.analyze({ command: "facets", workspace, home, limit: 5 });
  assert.equal(result.sessions.length, 1);
  assert.equal(result.facets.topEventTypes.some((item) => item.name === "model.response.completed"), true);
  assert.ok(result.warnings.some((warning) => warning.code === "augment-session-malformed-json"));
  const eventsResult = await analyzer.analyze({ command: "facets", workspace, home, limit: 5 });
  assert.equal(eventsResult.insights, undefined);
});
