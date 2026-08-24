import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { test } from "vitest";

import {
  DSH_ADAPTER_VERSION,
  DshSessionAnalyzer,
} from "../../scripts/session-analysis/platforms/dsh.mjs";
import { deduplicateLifecycleEvents } from "../../scripts/session-analysis/episode-contract.mjs";
import { runProviderCommand } from "../../scripts/session-analysis/provider-runner.mjs";
import { buildToolCallTrace } from "../../scripts/session-analysis/tool-call-trace.mjs";
import {
  DSH_FIXTURE_SECRET,
  dshProjectKey,
  encodeDshSessionIdSegment,
  makeDshHeader,
  makeDshEvent,
  makeOpenTurnDshRows,
  makeRc8InterruptedDshSessionRows,
  makeRc8TeamDshSessionRows,
  makeSupportedDshSessionRows,
  makeTerminalDshSessionRows,
  makeUnknownIgnorableDshEvent,
  makeKnownUnsupportedDshEvent,
  makeNativeSnapshotDshSessionRows,
  writeNestedDshArtifact,
} from "./dsh-fixtures.mjs";

const UNTIL = "2026-08-20T00:00:00.000Z";

async function fixtureContext(prefix = "better-harness-dsh-provider-") {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  const dshHome = path.join(root, "dsh-home");
  await mkdir(workspace, { recursive: true });
  return { root, workspace, dshHome };
}

async function discover(analyzer, context, options = {}) {
  const input = { workspace: context.workspace, dshHome: context.dshHome, until: UNTIL, ...options };
  const scope = await analyzer.resolveScope(input);
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  return { input, scope, roots, sessions };
}

async function writeRows(context, rows, options = {}) {
  return writeNestedDshArtifact({ dshHome: context.dshHome, rows, ...options });
}

function insertAccountedEvents(rows) {
  const stepEndIndex = rows.findIndex((row) => row.type === "step/end");
  const stepEnd = rows[stepEndIndex];
  const turnEnd = rows[stepEndIndex + 1];
  const secretUnknownType = `future/${DSH_FIXTURE_SECRET}`;
  rows.splice(
    stepEndIndex,
    0,
    makeKnownUnsupportedDshEvent({ seq: stepEnd.seq, time: stepEnd.time - 2 }),
    makeUnknownIgnorableDshEvent({ seq: stepEnd.seq + 1, time: stepEnd.time - 1 }),
    makeDshEvent(secretUnknownType, {}, { seq: stepEnd.seq + 2, time: stepEnd.time - 1, ignorable: true }),
    makeDshEvent(secretUnknownType, {}, { seq: stepEnd.seq + 3, time: stepEnd.time - 1, ignorable: true }),
    makeDshEvent(`future/${"x".repeat(4_000)}`, {}, {
      seq: stepEnd.seq + 4, time: stepEnd.time - 1, ignorable: true,
    }),
  );
  stepEnd.seq += 5;
  turnEnd.seq += 5;
  return rows;
}

function insertProviderRequestHeader(rows) {
  const output = structuredClone(rows);
  const assistantIndex = output.findIndex((row) => row.type === "assistant/message");
  output.splice(assistantIndex, 0, makeDshEvent("request/header", {
    header: {
      config: {
        provider: "fixture-provider", model: "fixture-model", reasoningEffort: "high",
        temperature: 0.2, maxTokens: 4_096, stop: ["STOP"],
      },
      adapterDefaults: { reasoningEffort: true, maxTokens: true },
      system: `System metadata ${DSH_FIXTURE_SECRET}`,
      tools: [{
        name: "read_file",
        description: `Tool metadata ${DSH_FIXTURE_SECRET}`,
        parameters: { type: "object", properties: { path: { type: "string" } } },
      }],
    },
    reason: "initial",
  }));
  output.slice(1).forEach((row, index) => { row.seq = index; });
  return output;
}

function privacyRows(context, sessionId = "dsh-provider-privacy") {
  const rows = insertAccountedEvents(makeSupportedDshSessionRows({
    workspace: context.workspace,
    sessionId,
    parentSession: DSH_FIXTURE_SECRET,
    seedLength: undefined,
    agentPreset: DSH_FIXTURE_SECRET,
  }));
  rows[3].data.content[0].text = `Run synthetic validation with ${DSH_FIXTURE_SECRET}`;
  rows[4].data.content[0].text = `Injected continuation ${DSH_FIXTURE_SECRET}`;
  rows[5].data.message.content.push({
    type: "tool-call",
    id: "assistant-only-call",
    name: "assistant_only",
    arguments: "{}",
  });
  rows[5].data.message.source.replayState = { opaque: DSH_FIXTURE_SECRET };
  rows[6].data.name = "shell_exec";
  rows[6].data.arguments = JSON.stringify({ command: `echo ${DSH_FIXTURE_SECRET}` });
  rows[7].data.meta = { private: DSH_FIXTURE_SECRET };
  rows[7].data.message.content[0].content[0].text = `result ${DSH_FIXTURE_SECRET}`;
  rows[8].data.name = "read_file";
  rows[8].data.arguments = JSON.stringify({
    file_path: `C:/work/${DSH_FIXTURE_SECRET}.txt`,
    paths: [
      `C:/work/${DSH_FIXTURE_SECRET}.txt`,
      "synthetic.txt",
      "synthetic.txt",
      `${"x".repeat(260)}.txt`,
      42,
      ...Array.from({ length: 12 }, (_value, index) => `safe-${index}.txt`),
    ],
  });
  return insertProviderRequestHeader(rows);
}

function seedOwnershipRows({ workspace, sessionId, includeChild }) {
  const rows = makeSupportedDshSessionRows({
    workspace,
    sessionId,
    parentSession: "fixture-parent",
    seedLength: undefined,
    origin: "subagent",
    delegationDepth: 1,
    agentPreset: undefined,
  });
  const inherited = rows.slice(1);
  rows[0].seedLength = inherited.length;
  if (!includeChild) return rows;

  const child = structuredClone(inherited);
  for (const event of child) {
    event.seq += inherited.length;
    event.time += 1_000;
    if (Object.hasOwn(event.data, "turn")) event.data.turn = 2;
    if (event.type === "user/message") event.data.id = `child-${event.data.id}`;
    if (event.type === "assistant/message") event.data.message.id = `child-${event.data.message.id}`;
    if (event.type === "tool/call") event.data.callId = `child-${event.data.callId}`;
    if (event.type === "tool/result") {
      event.data.message.id = `child-${event.data.message.id}`;
      event.data.message.source.callId = `child-${event.data.message.source.callId}`;
      event.data.message.content[0].toolCallId = `child-${event.data.message.content[0].toolCallId}`;
    }
  }
  return [rows[0], ...inherited, ...child];
}

function crossSeedToolLifecycleRows(workspace) {
  const rows = makeSupportedDshSessionRows({
    workspace,
    sessionId: "dsh-cross-seed-tool",
    parentSession: "fixture-parent",
    seedLength: 6,
    origin: "subagent",
    delegationDepth: 1,
    agentPreset: undefined,
  });
  const call = rows.find((event) => event.type === "tool/call"
    && event.data.callId === "fixture-call-success");
  const result = rows.find((event) => event.type === "tool/result"
    && event.data.message.source.callId === "fixture-call-success");
  call.data.callId = "cross-seed-call";
  result.data.message.source.callId = "cross-seed-call";
  result.data.message.content[0].toolCallId = "cross-seed-call";
  const filtered = rows.filter((event) => !(event.type === "tool/call"
    && event.data.callId === "fixture-call-error") && !(event.type === "tool/result"
    && event.data.message.source.callId === "fixture-call-error"));
  filtered.slice(1).forEach((event, index) => { event.seq = index; });
  return filtered;
}

test("DSH provider reads the pinned headless snapshot-like base flow without widening normalization", async () => {
  const context = await fixtureContext("better-harness-dsh-native-snapshot-");
  const rows = makeNativeSnapshotDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-native-snapshot",
    privateText: `Private writer metadata ${DSH_FIXTURE_SECRET}`,
  });
  const turnEndIndex = rows.findIndex((row) => row.type === "turn/end");
  rows.splice(turnEndIndex, 0,
    makeDshEvent("schedule/change", {
      version: 1, operation: "create", schedule: {
        id: "schedule-private", kind: "after", prompt: DSH_FIXTURE_SECRET, afterSeconds: 60,
        scheduledAt: "2026-08-19T00:00:00.000Z",
      },
    }),
    makeDshEvent("web/deepseek-search-llm-request", {
      endpoint: `https://example.invalid/${DSH_FIXTURE_SECRET}`,
      apiVersion: "2023-06-01",
      body: {
        model: "deepseek-v4-flash", max_tokens: 64,
        messages: [{ role: "user", content: [{ type: "text", text: DSH_FIXTURE_SECRET }] }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
      },
    }));
  rows.slice(1).forEach((event, index) => { event.seq = index; });
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { input, scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].incomplete, false);
  const gates = [
    {},
    { includeUserText: true },
    { includeCommandText: true },
    { includeContent: true },
    { includeUserText: true, includeCommandText: true, includeContent: true },
  ];
  let events;
  for (const gate of gates) {
    const projected = await analyzer.readSession(sessions[0], scope, gate);
    assert.equal(JSON.stringify(projected).includes(DSH_FIXTURE_SECRET), false);
    events ??= projected;
  }
  assert.deepEqual([...new Set(events.map((event) => event.nativeType))].sort(), [
    "assistant/message", "tool/call", "tool/result", "turn/end", "turn/start", "user/message",
  ]);
  assert.equal(events.some((event) => event.nativeType === "request/header"), false);
  assert.equal(events.some((event) => event.nativeType === "schedule/change"), false);
  assert.equal(events.some((event) => event.nativeType === "web/deepseek-search-llm-request"), false);
  for (const gate of gates) {
    const facts = await analyzer.analyze({ ...input, command: "facts", limit: 1, ...gate });
    const publicJson = JSON.stringify(facts);
    assert.equal(publicJson.includes(DSH_FIXTURE_SECRET), false);
    assert.equal(publicJson.includes(rows[0].id), false);
    assert.equal(publicJson.includes(context.dshHome), false);
  }
});

test("DSH provider accounts private subagent descriptors without exposing composition", async () => {
  const context = await fixtureContext("better-harness-dsh-subagent-private-");
  const header = makeDshHeader({
    workspace: context.workspace, sessionId: "dsh-subagent-private", parentSession: "fixture-parent",
    seedLength: undefined, origin: "subagent", delegationDepth: 1,
  });
  const rows = [
    header,
    makeDshEvent("session/end-seed", {}, { seq: 0, time: header.createdAt + 1 }),
    makeDshEvent("subagent/descriptor", {
      version: 2, mode: "continuable", provider: "fixture-provider", label: DSH_FIXTURE_SECRET,
      agentProvider: "fixture-agent", agentModel: "fixture-model", persona: DSH_FIXTURE_SECRET,
      toolFilter: { allow: [DSH_FIXTURE_SECRET], deny: ["shell_exec"] },
    }, { seq: 1, time: header.createdAt + 2 }),
    makeDshEvent("turn/start", { turn: 1 }, { seq: 2, time: header.createdAt + 3 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 3, time: header.createdAt + 4 }),
  ];
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { input, scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].diagnostics.knownUnsupportedTypes.includes("subagent/descriptor"), true);
  for (const gate of [{}, { includeUserText: true }, { includeCommandText: true }, { includeContent: true },
    { includeUserText: true, includeCommandText: true, includeContent: true }]) {
    const events = await analyzer.readSession(sessions[0], scope, gate);
    const facts = await analyzer.analyze({ ...input, command: "facts", limit: 1, ...gate });
    assert.equal(JSON.stringify({ sessions, events, facts }).includes(DSH_FIXTURE_SECRET), false);
  }
});

test("DSH child projection excludes inherited seed activity while preserving lineage and validation", async () => {
  const context = await fixtureContext("better-harness-dsh-seed-ownership-");
  const allSeed = seedOwnershipRows({
    workspace: context.workspace,
    sessionId: "dsh-seed-only",
    includeChild: false,
  });
  const mixed = seedOwnershipRows({
    workspace: context.workspace,
    sessionId: "dsh-seed-mixed",
    includeChild: true,
  });
  const malformedSeed = seedOwnershipRows({
    workspace: context.workspace,
    sessionId: "dsh-seed-malformed",
    includeChild: true,
  });
  malformedSeed[3].data.role = "assistant";
  await writeRows(context, allSeed);
  await writeRows(context, mixed);
  await writeRows(context, malformedSeed);

  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  assert.equal(byId.has("dsh-seed-malformed"), false);
  assert.equal(analyzer.analysisWarnings.some((warning) => warning.reason === "DSH_EVENT_SHAPE_DRIFT"), true);

  const seedOnlySession = byId.get("dsh-seed-only");
  assert.deepEqual(seedOnlySession.dshProvenance, {
    delegationDepth: 1,
    parentSession: "fixture-parent",
    seedLength: allSeed.length - 1,
    origin: "subagent",
  });
  assert.deepEqual(await analyzer.readSession(seedOnlySession, scope), []);

  const mixedSession = byId.get("dsh-seed-mixed");
  const events = await analyzer.readSession(mixedSession, scope);
  assert.equal(events.every((event) => event.nativeSeq >= mixed[0].seedLength), true);
  assert.equal(events.filter((event) => event.userPrompt === true).length, 1);
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.deepEqual(events.filter((event) => event.type === "tool.result").map((event) => event.success), [true, false]);
  assert.equal(events.filter((event) => event.type === "model.response.completed").length, 1);
  assert.equal(events.filter((event) => event.type === "turn.end" && event.success === true).length, 1);
});

test("DSH seed ownership validates inherited calls before projecting child-owned results", async () => {
  const context = await fixtureContext("better-harness-dsh-cross-seed-tool-");
  const rows = crossSeedToolLifecycleRows(context.workspace);
  await writeRows(context, rows);

  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].incomplete, false);
  assert.equal(Object.hasOwn(sessions[0].diagnostics, "incompleteReason"), false);
  assert.deepEqual(analyzer.analysisWarnings, []);

  const events = await analyzer.readSession(sessions[0], scope);
  assert.equal(events.every((event) => event.nativeSeq >= rows[0].seedLength), true);
  assert.equal(events.filter((event) => event.type === "tool.call").length, 0);
  const results = events.filter((event) => event.type === "tool.result");
  assert.equal(results.length, 1);
  assert.equal(results[0].toolInvocationId, "cross-seed-call");
});

test("DSH provider projects only the six approved native event types and publishes dsh-v1 evidence", async () => {
  const context = await fixtureContext();
  const rows = privacyRows(context);
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { input, scope, roots, sessions } = await discover(analyzer, context);

  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].diagnostics.unknownIgnorableCount, 4);
  assert.equal(sessions[0].diagnostics.unknownIgnorableTypes.length, 3);
  assert.equal(sessions[0].diagnostics.knownUnsupportedTypes.includes("request/header"), true);
  assert.equal(JSON.stringify(sessions[0]).includes(DSH_FIXTURE_SECRET), false);
  assert.equal(JSON.stringify(roots).includes(DSH_FIXTURE_SECRET), false);
  assert.equal(JSON.stringify(sessions[0]).includes("x".repeat(100)), false);
  const events = await analyzer.readSession(sessions[0], scope, {
    includeUserText: true,
    includeCommandText: true,
    includeContent: true,
  });
  assert.deepEqual(
    [...new Set(events.map((event) => event.nativeType))].sort(),
    ["assistant/message", "tool/call", "tool/result", "turn/end", "turn/start", "user/message"],
  );
  assert.equal(events.some((event) => ["step/start", "step/end", "assistant/chunk", "todo/write",
    "fixture-future/ignorable"].includes(event.nativeType)), false);
  assert.equal(events.filter((event) => event.type === "tool.call").length, 2);
  assert.equal(events.some((event) => event.toolInvocationId === "assistant-only-call"), false);

  const sources = await analyzer.analyze({ ...input, command: "sources" });
  const listed = await analyzer.analyze({ ...input, command: "sessions" });
  const eventResult = await runProviderCommand(analyzer, "events", { ...input, "session-id": rows[0].id });
  const insights = await analyzer.analyze({ ...input, command: "insights", selection: "all-eligible" });
  const facts = await analyzer.analyze({ ...input, command: "facts", limit: 1 });

  assert.equal(sources.scope.platform, "dsh");
  assert.equal(sources.sources[0].coverage, "partial");
  assert.equal(listed.sessions.length, 1);
  assert.equal(eventResult.sessions[0].events.length, events.length);
  assert.deepEqual(insights.insights.manifest.adapter, { id: "dsh", version: DSH_ADAPTER_VERSION });
  assert.equal(facts.kind, "session-core-facts");
  assert.equal(facts.scope.platform, "dsh");
  const factsText = JSON.stringify(facts);
  assert.doesNotMatch(factsText, new RegExp(rows[0].id, "u"));
  assert.equal(factsText.includes(context.dshHome), false);
  assert.equal(factsText.includes(DSH_FIXTURE_SECRET), false);
});

test("DSH privacy gates preserve bounded user source distinctions without raw plugin payloads", async () => {
  const context = await fixtureContext();
  const rows = privacyRows(context);
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);

  const closed = await analyzer.readSession(sessions[0], scope);
  assert.equal(closed.some((event) => Object.hasOwn(event, "userText")), false);
  assert.equal(closed.some((event) => Object.hasOwn(event, "commandText")), false);
  assert.equal(closed.some((event) => Object.hasOwn(event, "content")), false);

  const open = await analyzer.readSession(sessions[0], scope, {
    includeUserText: true,
    includeCommandText: true,
    includeContent: true,
  });
  const direct = open.find((event) => event.type === "user");
  const continuation = open.find((event) => event.type === "context");
  const call = open.find((event) => event.type === "tool.call" && event.toolName === "shell_exec");
  assert.equal(direct.userSourceKind, "human");
  assert.equal(direct.userPrompt, true);
  assert.equal(continuation.contextSourceKind, "plugin");
  assert.equal(continuation.contextForm, "notice");
  assert.equal(Object.hasOwn(continuation, "plugin"), false);
  assert.equal(Object.hasOwn(continuation, "source"), false);
  assert.match(direct.userText, /<secret>/u);
  assert.match(call.commandText, /<secret>/u);
  const serialized = JSON.stringify(open);
  assert.equal(serialized.includes(DSH_FIXTURE_SECRET), false);
  assert.equal(serialized.includes("opaque"), false);
  assert.equal(serialized.includes("fixture-context"), false);
  assert.equal(serialized.includes("private"), false);
  assert.match(serialized, /<secret>/u);

  const userTextOnly = await analyzer.readSession(sessions[0], scope, { includeUserText: true });
  const contextOnly = userTextOnly.find((event) => event.type === "context");
  assert.equal(Object.hasOwn(contextOnly, "userText"), false);
  assert.equal(Object.hasOwn(contextOnly, "content"), false);
  assert.equal(JSON.stringify(contextOnly).includes("Injected continuation"), false);
  const contentOnly = await analyzer.readSession(sessions[0], scope, { includeContent: true });
  assert.match(contentOnly.find((event) => event.type === "context").content, /Injected continuation/u);
  assert.equal(JSON.stringify(contentOnly).includes(DSH_FIXTURE_SECRET), false);
});

test("DSH assistant usage remains observed only when the native assembled message supplies it", async () => {
  const context = await fixtureContext();
  const withUsage = makeSupportedDshSessionRows({ workspace: context.workspace, sessionId: "dsh-usage-present" });
  const withoutUsage = makeSupportedDshSessionRows({ workspace: context.workspace, sessionId: "dsh-usage-absent" });
  delete withoutUsage.find((row) => row.type === "assistant/message").data.usage;
  await writeRows(context, withUsage);
  await writeRows(context, withoutUsage);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);

  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  const observed = await analyzer.readSession(byId.get("dsh-usage-present"), scope);
  const unobserved = await analyzer.readSession(byId.get("dsh-usage-absent"), scope);
  const usage = observed.find((event) => event.type === "model.response.completed");
  assert.deepEqual(usage.modelUsage, {
    inputTokens: 12,
    outputTokens: 8,
    cacheReadInputTokens: 2,
    reasoningTokens: 1,
  });
  assert.equal(usage.usageFieldsObserved, true);
  assert.equal(Object.hasOwn(observed.find((event) => event.type === "assistant"), "interrupted"), false);
  assert.equal(Object.hasOwn(usage, "interrupted"), false);
  assert.equal(unobserved.some((event) => event.type === "model.response.completed"), false);
  assert.equal(unobserved.some((event) => Object.hasOwn(event, "modelUsage")), false);
  assert.equal(unobserved.some((event) => Object.hasOwn(event, "usageFieldsObserved")), false);
});

test("DSH preserves RC8 assistant interruption as bounded structural evidence", async () => {
  const context = await fixtureContext();
  const rows = makeRc8InterruptedDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-rc8-interrupted",
  });
  rows.find((event) => event.type === "assistant/message").data.usage = {
    inputTokens: 5,
    outputTokens: 2,
  };
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);

  const events = await analyzer.readSession(sessions[0], scope);
  const assistant = events.find((event) => event.type === "assistant");
  assert.equal(assistant.interrupted, true);
  assert.equal(assistant.incomplete, true);
  assert.equal(Object.hasOwn(assistant, "content"), false);
  assert.equal(events.filter((event) => event.type === "assistant").length, 1);
  assert.equal(JSON.stringify(events).includes("Partial synthetic response."), false);
  const usage = events.find((event) => event.type === "model.response.completed");
  assert.equal(usage.interrupted, true);
  assert.equal(usage.incomplete, true);
  assert.equal(usage.usageFieldsObserved, true);

  const gated = await analyzer.readSession(sessions[0], scope, { includeContent: true });
  assert.equal(gated.find((event) => event.type === "assistant").content, "Partial synthetic response.");
});

test("DSH accounts RC8 team vocabulary without fabricating team analytics or user/tool activity", async () => {
  const context = await fixtureContext();
  const rows = makeRc8TeamDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-rc8-team",
  });
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);
  assert.deepEqual(sessions[0].diagnostics.knownUnsupportedTypes, [
    "team/member", "team/message/delivered", "team/message/queued", "team/task",
  ]);
  assert.equal(sessions[0].diagnostics.knownUnsupportedCount, 4);
  assert.deepEqual(await analyzer.readSession(sessions[0], scope), []);
});

test("DSH tool result outcomes remain unobserved when native isError is omitted", async () => {
  const context = await fixtureContext();
  const rows = makeSupportedDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-tool-outcome-unobserved",
  });
  const nativeResult = rows.find((row) => row.type === "tool/result" && row.data.message.content[0].isError === false);
  delete nativeResult.data.message.content[0].isError;
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  const events = await analyzer.readSession(sessions[0], scope);
  const call = events.find((event) => event.type === "tool.call");
  const result = events.find((event) => event.type === "tool.result");

  assert.equal(result.toolInvocationId, call.toolInvocationId);
  assert.equal(Object.hasOwn(result, "success"), false);
  assert.equal(Object.hasOwn(result, "hasError"), false);
  assert.equal(Object.hasOwn(result, "internalError"), false);
});

test("DSH tool requests and results correlate while content, arguments, meta, and internal errors stay bounded", async () => {
  const context = await fixtureContext();
  const rows = privacyRows(context, "dsh-tool-correlation");
  await writeRows(context, rows);
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  const events = await analyzer.readSession(sessions[0], scope, {
    includeCommandText: true,
    includeContent: true,
  });
  const calls = events.filter((event) => event.type === "tool.call");
  const results = events.filter((event) => event.type === "tool.result");
  assert.deepEqual(calls.map((event) => event.toolInvocationId), results.map((event) => event.toolInvocationId));
  assert.deepEqual(results.map((event) => event.success), [true, false]);
  assert.deepEqual(results.map((event) => event.hasError), [false, true]);
  assert.equal(results[0].internalError, false);
  assert.equal(results[1].internalError, true);
  assert.equal(results[1].internalErrorCode, "FIXTURE_TOOL_FAILURE");
  assert.equal(Object.hasOwn(calls[0], "arguments"), false);
  assert.equal(Object.hasOwn(results[0], "meta"), false);
  assert.equal(calls[1].filePath.includes(DSH_FIXTURE_SECRET), false);
  assert.equal(calls[1].targetPaths.includes("synthetic.txt"), true);
  assert.equal(calls[1].targetPaths.length, 8);
  assert.equal(new Set(calls[1].targetPaths).size, calls[1].targetPaths.length);
  assert.equal(calls[1].targetPaths.every((value) => [...value].length <= 240), true);
  assert.equal(JSON.stringify(events).includes(DSH_FIXTURE_SECRET), false);
});

test("DSH tool path facts are redacted, bounded, deduplicated, and gate independent", async () => {
  const analyzer = new DshSessionAnalyzer();
  const sourceRef = {
    kind: "dsh-session-jsonl",
    role: "session-transcript",
    path: path.join(os.tmpdir(), "synthetic-session.jsonl"),
    sessionId: "dsh-path-privacy",
    cwd: path.resolve(os.tmpdir(), "synthetic-workspace"),
    dshProvenance: { delegationDepth: 0 },
  };
  const longPath = `${"long".repeat(80)}.txt`;
  const rawSecretPath = `C:/work/${DSH_FIXTURE_SECRET}.txt`;
  const event = makeDshEvent("tool/call", {
    turn: 1,
    step: 1,
    callId: "fixture-path-call",
    name: "read_file",
    arguments: JSON.stringify({
      file_path: rawSecretPath,
      paths: [rawSecretPath, "safe-relative.txt", "safe-relative.txt", longPath, null, 17,
        ...Array.from({ length: 12 }, (_value, index) => `bounded-${index}.txt`)],
      targetPaths: ["safe-target.txt", rawSecretPath],
      affectedPaths: ["safe-affected.txt"],
    }),
  }, { seq: 0 });

  for (const options of [
    {},
    { includeUserText: true },
    { includeCommandText: true },
    { includeContent: true },
    { includeUserText: true, includeCommandText: true, includeContent: true },
  ]) {
    const normalized = analyzer.normalizeEvents(event, sourceRef, options);
    const serialized = JSON.stringify(normalized);
    assert.equal(serialized.includes(DSH_FIXTURE_SECRET), false);
    assert.equal(serialized.includes(rawSecretPath), false);
    assert.ok(normalized[0].filePath);
    assert.equal([...normalized[0].filePath].length <= 240, true);
    assert.equal(normalized[0].targetPaths.length, 8);
    assert.deepEqual(normalized[0].targetPaths.slice(0, 2), [normalized[0].filePath, "safe-relative.txt"]);
    assert.equal(new Set(normalized[0].targetPaths).size, normalized[0].targetPaths.length);
    assert.equal(normalized[0].targetPaths.every((value) => [...value].length <= 240), true);
  }

  const context = await fixtureContext("better-harness-dsh-path-privacy-");
  const rows = privacyRows(context, "dsh-provider-path-privacy");
  await writeRows(context, rows);
  const input = { workspace: context.workspace, dshHome: context.dshHome, until: UNTIL };
  const eventsResult = await runProviderCommand(analyzer, "events", {
    ...input,
    "session-id": rows[0].id,
    includeUserText: true,
    includeCommandText: true,
    includeContent: true,
  });
  const publicEvents = eventsResult.sessions.flatMap((session) => session.events ?? []);
  const facts = await analyzer.analyze({ ...input, command: "facts", limit: 1 });
  assert.equal(JSON.stringify(publicEvents).includes(DSH_FIXTURE_SECRET), false);
  assert.equal(publicEvents.some((item) => item.type === "tool.call"
    && item.toolInvocationId === "fixture-call-error"
    && item.targetPaths.includes("synthetic.txt")), true);
  const factsText = JSON.stringify(facts);
  assert.equal(factsText.includes(DSH_FIXTURE_SECRET), false);
  assert.equal(factsText.includes(rows[0].id), false);
  assert.equal(factsText.includes(context.dshHome), false);
});

test("DSH source unions keep only human input user-facing and never expose private source metadata", async () => {
  const analyzer = new DshSessionAnalyzer();
  const sourceRef = {
    kind: "dsh-session-jsonl", role: "session-transcript",
    path: path.join(os.tmpdir(), "source-union-session.jsonl"), sessionId: "dsh-source-union",
    cwd: path.resolve(os.tmpdir(), "source-union-workspace"), dshProvenance: { delegationDepth: 0 },
  };
  const secret = DSH_FIXTURE_SECRET;
  const sources = [
    { kind: "plugin", plugin: secret, form: "notice", summary: secret },
    { kind: "plugin", plugin: "compact", compactionId: secret, sourceCommandId: secret },
    { kind: "goal", goalId: secret, revision: 1, round: 1 },
    { kind: "agent-instructions", form: "instructions", baselineIdentity: secret,
      changes: [{ action: "set", scope: secret, path: secret, digest: secret }] },
    { kind: "session-reference", form: "recall", version: 1, references: [{
      sessionId: secret, label: secret, capturedThroughSeq: null, compacted: false,
      originalMessages: 1, retainedMessages: 1, omittedMessages: 0, omittedBytes: 0,
      truncated: false, inputIndex: 0,
    }] },
    { kind: "coordinator", form: "relay", senderSessionId: secret },
    { kind: "subagent-report", form: "relay", senderSessionId: secret },
    { kind: "subagent-settled", form: "notice", summary: secret, senderSessionId: secret },
    { kind: "skill-catalog", form: "catalog", entries: [{ name: secret, description: secret }] },
    { kind: "skill-invocation", form: "instructions", name: secret },
  ];
  for (const source of sources) {
    const event = makeDshEvent("user/message", {
      id: "private-context", role: "user", content: [{ type: "text", text: `private ${secret}` }], source,
    }, { seq: 0, surfaceOp: "append" });
    const userOnly = analyzer.normalizeEvents(event, sourceRef, { includeUserText: true })[0];
    assert.equal(userOnly.type, "context");
    assert.equal(Object.hasOwn(userOnly, "userText"), false);
    assert.equal(Object.hasOwn(userOnly, "content"), false);
    const withContent = analyzer.normalizeEvents(event, sourceRef, { includeContent: true })[0];
    assert.equal(withContent.contextSourceKind, source.kind);
    assert.equal(Object.hasOwn(withContent, "content"), true);
    assert.equal(JSON.stringify({ userOnly, withContent }).includes(secret), false);
  }
  const direct = makeDshEvent("user/message", {
    id: "api-human", role: "user", content: [{ type: "text", text: "safe prompt" }],
    source: { kind: "user", rpcId: secret, clientTimeZone: secret },
  }, { seq: 0, surfaceOp: "append" });
  const projected = analyzer.normalizeEvents(direct, sourceRef, { includeUserText: true })[0];
  assert.equal(projected.type, "user");
  assert.equal(projected.userText, "safe prompt");
  assert.equal(JSON.stringify(projected).includes(secret), false);

  const context = await fixtureContext("better-harness-dsh-source-union-");
  const rows = makeSupportedDshSessionRows({ workspace: context.workspace, sessionId: "source-union-e2e" });
  rows[4].data.source = sources[4];
  rows[4].data.content[0].text = `private ${secret}`;
  await writeRows(context, rows);
  const { input, scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1);
  for (const gate of [{}, { includeUserText: true }, { includeContent: true },
    { includeUserText: true, includeCommandText: true, includeContent: true }]) {
    const events = await analyzer.readSession(sessions[0], scope, gate);
    const facts = await analyzer.analyze({ ...input, command: "facts", limit: 1, ...gate });
    assert.equal(JSON.stringify({ sessions, events, facts }).includes(secret), false);
  }
});

test("DSH maps all six terminal outcomes and leaves open turns explicitly incomplete", async () => {
  const context = await fixtureContext();
  const kinds = ["completed", "aborted", "blocked", "error", "max-tokens", "interrupted"];
  for (const kind of kinds) {
    await writeRows(context, makeTerminalDshSessionRows(kind, { workspace: context.workspace }));
  }
  await writeRows(context, makeOpenTurnDshRows({
    workspace: context.workspace,
    sessionId: "dsh-provider-open-turn",
  }));
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));

  const ends = new Map();
  for (const kind of kinds) {
    const events = await analyzer.readSession(byId.get(`dsh-fixture-terminal-${kind}`), scope);
    ends.set(kind, events.find((event) => event.type === "turn.end"));
  }
  assert.equal(ends.get("completed").success, true);
  assert.equal(ends.get("aborted").cancelled, true);
  assert.equal(ends.get("aborted").cancelCause, "hook");
  assert.equal(ends.get("blocked").blocked, true);
  assert.equal(ends.get("error").hasError, true);
  assert.equal(ends.get("error").errorCode, "FIXTURE_PROVIDER_FAILURE");
  assert.equal(ends.get("max-tokens").maxTokensReached, true);
  assert.equal(ends.get("interrupted").incomplete, true);
  assert.equal(ends.get("interrupted").success, null);

  const openSession = byId.get("dsh-provider-open-turn");
  const openEvents = await analyzer.readSession(openSession, scope);
  assert.equal(openSession.incomplete, true);
  assert.equal(openEvents.some((event) => event.type === "turn.end"), false);
  assert.equal(openEvents.some((event) => event.success === true), false);
});

test("DSH provider admits open-step and pending-call crash prefixes without synthetic outcomes", async () => {
  const context = await fixtureContext();
  const time = Date.parse("2026-08-18T00:00:00.000Z");
  const openStepRows = [
    makeDshHeader({ workspace: context.workspace, sessionId: "dsh-open-step", createdAt: time,
      parentSession: undefined, seedLength: undefined, origin: undefined, delegationDepth: 0, agentPreset: undefined }),
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: time + 1 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: time + 2 }),
  ];
  const pendingRows = structuredClone(openStepRows);
  pendingRows[0].id = "dsh-pending-call";
  pendingRows.push(makeDshEvent("tool/call", {
    turn: 1, step: 1, callId: "pending-call", name: "read_file", arguments: "{}",
  }, { seq: 2, time: time + 3 }));
  await writeRows(context, openStepRows);
  await writeRows(context, pendingRows);

  const analyzer = new DshSessionAnalyzer();
  const { input, scope, sessions } = await discover(analyzer, context);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  assert.equal(byId.get("dsh-open-step").diagnostics.incompleteReason, "open-step");
  assert.equal(byId.get("dsh-pending-call").diagnostics.incompleteReason, "pending-tool-result");
  assert.equal(byId.get("dsh-pending-call").diagnostics.pendingToolCallCount, 1);

  const openEvents = await analyzer.readSession(byId.get("dsh-open-step"), scope);
  const pendingEvents = await analyzer.readSession(byId.get("dsh-pending-call"), scope);
  assert.deepEqual(openEvents.map((event) => event.type), ["turn.start"]);
  assert.deepEqual(pendingEvents.map((event) => event.type), ["turn.start", "tool.call"]);
  assert.equal(pendingEvents.some((event) => event.type === "tool.result" || event.type === "turn.end"), false);
  assert.equal(pendingEvents.some((event) => event.success === true), false);
  const facts = await analyzer.analyze({ ...input, command: "facts", limit: 10 });
  const factsText = JSON.stringify(facts);
  assert.equal(factsText.includes("tool result"), false);
  assert.equal(factsText.includes("turn ended: completed"), false);
});

test("DSH provider preserves epoch-ms observations while native seq controls event order", async () => {
  const context = await fixtureContext();
  const rows = makeSupportedDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-epoch-ms-order",
    createdAt: 0,
  });
  rows.slice(1).forEach((event) => { event.time = 1_000 + event.seq; });
  rows.find((event) => event.type === "tool/result").time = 500;
  await writeRows(context, rows);

  const analyzer = new DshSessionAnalyzer();
  const { sessions } = await discover(analyzer, context);
  const session = sessions[0];
  assert.equal(session.firstSeen, "1970-01-01T00:00:00.000Z");
  assert.equal(session.lastSeen, "1970-01-01T00:00:01.010Z");

  const rangedScope = await analyzer.resolveScope({
    workspace: context.workspace,
    dshHome: context.dshHome,
    since: "1970-01-01T00:00:00.400Z",
    until: "1970-01-01T00:00:01.010Z",
  });
  const events = await analyzer.readSession(session, rangedScope);
  assert.deepEqual(events.map((event) => event.nativeSeq), [...events.map((event) => event.nativeSeq)].sort((a, b) => a - b));
  const callIndex = events.findIndex((event) => event.type === "tool.call" && event.nativeSeq === 5);
  const resultIndex = events.findIndex((event) => event.type === "tool.result" && event.nativeSeq === 6);
  assert.equal(callIndex < resultIndex, true);
  assert.equal(events[resultIndex].timestamp, "1970-01-01T00:00:00.500Z");
  const assistantIndex = events.findIndex((event) => event.type === "assistant" && event.nativeSeq === 4);
  assert.deepEqual(events.slice(assistantIndex, assistantIndex + 2).map((event) => event.type),
    ["assistant", "model.response.completed"]);

  const narrowScope = await analyzer.resolveScope({
    workspace: context.workspace,
    dshHome: context.dshHome,
    since: "1970-01-01T00:00:01.002Z",
    until: "1970-01-01T00:00:01.004Z",
  });
  const narrow = await analyzer.readSession(session, narrowScope);
  assert.equal(narrow.some((event) => event.nativeSeq === 0), false);
  assert.equal(narrow.some((event) => event.nativeSeq === 2), true);
  assert.equal(narrow.some((event) => event.nativeSeq === 4), true);
});

function surfaceReplacementRows(workspace) {
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "dsh-provider-surface" });
  const stepEndIndex = rows.findIndex((row) => row.type === "step/end");
  const stepEnd = rows[stepEndIndex];
  const turnEnd = rows[stepEndIndex + 1];
  const user = structuredClone(rows.find((row) => row.type === "user/message"));
  user.seq = stepEnd.seq;
  user.time = stepEnd.time - 3;
  user.data.id = "fixture-user-replacement";
  user.data.content[0].text = "Replacement user surface.";
  user.sourceEventSeqs = [2];
  user.surfaceOp = { op: "replace", start: 2, end: 2 };
  const assistant = structuredClone(rows.find((row) => row.type === "assistant/message"));
  assistant.seq = stepEnd.seq + 1;
  assistant.time = stepEnd.time - 2;
  assistant.data.message.id = "fixture-assistant-replacement";
  assistant.data.message.content[0].text = "Replacement assistant surface.";
  assistant.sourceEventSeqs = [4];
  assistant.surfaceOp = { op: "replace", start: 4, end: 4 };
  const result = structuredClone(rows.find((row) => row.type === "tool/result"));
  result.seq = stepEnd.seq + 2;
  result.time = stepEnd.time - 1;
  result.data.message.content[0].content[0].text = "replacement tool content";
  result.sourceEventSeqs = [6];
  result.surfaceOp = { op: "replace", start: 6, end: 6 };
  rows.splice(stepEndIndex, 0, user, assistant, result);
  stepEnd.seq += 3;
  turnEnd.seq += 3;
  return rows;
}

function reusedCallAcrossTurnsRows(workspace) {
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "dsh-provider-reused-call" });
  const firstCall = rows.find((row) => row.type === "tool/call");
  const firstResult = rows.find((row) => row.type === "tool/result");
  const last = rows.at(-1);
  const seq0 = last.seq + 1;
  const time0 = last.time + 10;
  const call = structuredClone(firstCall);
  call.seq = seq0 + 2;
  call.time = time0 + 20;
  call.data.turn = 2;
  call.data.step = 1;
  const result = structuredClone(firstResult);
  result.seq = seq0 + 3;
  result.time = time0 + 30;
  result.data.turn = 2;
  result.data.step = 1;
  result.data.message.id = "fixture-tool-reused-call";
  result.surfaceOp = "append";
  rows.push(
    makeDshEvent("turn/start", { turn: 2 }, { seq: seq0, time: time0 }),
    makeDshEvent("step/start", { turn: 2, step: 1 }, { seq: seq0 + 1, time: time0 + 10 }),
    call,
    result,
    makeDshEvent("step/end", { turn: 2, step: 1 }, { seq: seq0 + 4, time: time0 + 40 }),
    makeDshEvent("turn/end", { turn: 2, reason: { kind: "completed" } }, {
      seq: seq0 + 5,
      time: time0 + 50,
    }),
  );
  return rows;
}

function reusedCallAcrossStepsRows(workspace) {
  const source = makeSupportedDshSessionRows({ workspace });
  const header = makeDshHeader({
    workspace,
    sessionId: "dsh-provider-reused-call-steps",
    parentSession: undefined,
    seedLength: undefined,
    origin: undefined,
    delegationDepth: 0,
    agentPreset: undefined,
  });
  const firstCall = structuredClone(source.find((row) => row.type === "tool/call"));
  const firstResult = structuredClone(source.find((row) => row.type === "tool/result"));
  const eventTime = header.createdAt + 1_000;
  firstCall.seq = 2;
  firstCall.time = eventTime + 20;
  firstResult.seq = 3;
  firstResult.time = eventTime + 40;
  const secondCall = structuredClone(firstCall);
  secondCall.seq = 6;
  secondCall.time = eventTime + 30;
  secondCall.data.step = 2;
  const secondResult = structuredClone(firstResult);
  secondResult.seq = 7;
  secondResult.time = eventTime + 50;
  secondResult.data.step = 2;
  secondResult.data.message.id = "fixture-tool-reused-step-result";
  const rows = [
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: eventTime }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: eventTime + 10 }),
    firstCall,
    firstResult,
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 4, time: eventTime + 40 }),
    makeDshEvent("step/start", { turn: 1, step: 2 }, { seq: 5, time: eventTime + 50 }),
    secondCall,
    secondResult,
    makeDshEvent("step/end", { turn: 1, step: 2 }, { seq: 8, time: eventTime + 80 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 9, time: eventTime + 90 }),
  ];
  return rows;
}

test("DSH normalization projects final canonical surface nodes and preserves callId reuse across turns", async () => {
  const context = await fixtureContext();
  await writeRows(context, surfaceReplacementRows(context.workspace));
  await writeRows(context, reusedCallAcrossTurnsRows(context.workspace));
  const analyzer = new DshSessionAnalyzer();
  const { scope, roots, sessions } = await discover(analyzer, context);
  const byId = new Map(sessions.map((session) => [session.sessionId, session]));
  assert.ok(byId.has("dsh-provider-surface"), JSON.stringify(roots[0].warnings));
  assert.ok(byId.has("dsh-provider-reused-call"), JSON.stringify(roots[0].warnings));

  const surface = await analyzer.readSession(byId.get("dsh-provider-surface"), scope, {
    includeUserText: true,
    includeContent: true,
  });
  assert.equal(surface.some((event) => event.nativeSeq === 2), false);
  assert.equal(surface.some((event) => event.nativeSeq === 4), false);
  assert.equal(surface.some((event) => event.nativeSeq === 6), false);
  assert.match(surface.find((event) => event.type === "user")?.userText, /Replacement user/u);
  assert.match(surface.find((event) => event.type === "assistant")?.content, /Replacement assistant/u);
  assert.match(surface.find((event) => event.type === "tool.result"
    && event.toolInvocationId === "fixture-call-success")?.content, /replacement tool/u);

  const reused = await analyzer.readSession(byId.get("dsh-provider-reused-call"), scope);
  assert.equal(reused.filter((event) => event.type === "tool.call"
    && event.toolInvocationId === "fixture-call-success").length, 2);
  assert.equal(reused.filter((event) => event.type === "tool.result"
    && event.toolInvocationId === "fixture-call-success").length, 2);
});

test("DSH repeated callId occurrences survive timestamp drift through lifecycle deduplication and tool tracing", async () => {
  const context = await fixtureContext();
  await writeRows(context, reusedCallAcrossStepsRows(context.workspace));
  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  const session = sessions.find((candidate) => candidate.sessionId === "dsh-provider-reused-call-steps");
  const events = await analyzer.readSession(session, scope);
  const calls = events.filter((event) => event.type === "tool.call");
  const results = events.filter((event) => event.type === "tool.result");
  const canonical = deduplicateLifecycleEvents(events);
  const occurrences = canonical.filter((event) => event.category === "tool"
    && event.toolInvocationId === "fixture-call-success");
  assert.equal(calls.length, 2);
  assert.equal(results.length, 2);
  assert.deepEqual(calls.map((event) => [event.step, event.toolInvocationId]),
    results.map((event) => [event.step, event.toolInvocationId]));
  assert.equal(occurrences.length, 2);
  assert.deepEqual(occurrences.map((event) => event.step), [1, 2]);
  assert.equal(buildToolCallTrace(events).totalCalls, 2);
});

test("DSH provider reads concatenated Zstd evidence and reports unavailable compression without hiding raw sessions", async () => {
  const context = await fixtureContext();
  const rawRows = makeSupportedDshSessionRows({ workspace: context.workspace, sessionId: "dsh-provider-raw" });
  await writeRows(context, rawRows);

  if (typeof zlib.zstdCompressSync === "function" && Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) {
    const compressedRows = makeSupportedDshSessionRows({
      workspace: context.workspace,
      sessionId: "dsh-provider-zstd",
    });
    await writeRows(context, compressedRows, { compression: "zstd" });
    const analyzer = new DshSessionAnalyzer();
    const { scope, sessions } = await discover(analyzer, context);
    const compressed = sessions.find((session) => session.sessionId === "dsh-provider-zstd");
    const events = await analyzer.readSession(compressed, scope);
    assert.equal(events.some((event) => event.type === "assistant"), true);
  }

  const compressedId = "dsh-provider-unavailable";
  const directory = path.join(
    context.dshHome,
    "sessions",
    dshProjectKey(context.workspace),
    encodeDshSessionIdSegment(compressedId),
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "session.jsonl.zstd"), Buffer.from([0x28, 0xb5, 0x2f, 0xfd]));
  const unavailableAnalyzer = new DshSessionAnalyzer({ decompressor: null });
  const { roots, sessions } = await discover(unavailableAnalyzer, context);
  assert.equal(sessions.some((session) => session.sessionId === "dsh-provider-raw"), true);
  assert.equal(roots[0].warnings.some((warning) => warning.code === "dsh-zstd-unavailable"), true);
  assert.equal(JSON.stringify(roots[0].warnings).includes(DSH_FIXTURE_SECRET), false);
});

test("DSH discovery accepts the pinned rc1 permission preset origin", async () => {
  const context = await fixtureContext("better-harness-dsh-rc1-origin-");
  const rows = makeNativeSnapshotDshSessionRows({
    workspace: context.workspace,
    sessionId: "dsh-rc1-origin-default",
  });
  const preset = rows.find((row) => row.type === "permission/preset");
  assert.ok(preset);
  preset.data = { preset: "danger-full-access", origin: "default" };
  await writeRows(context, rows);

  const analyzer = new DshSessionAnalyzer();
  const { scope, sessions } = await discover(analyzer, context);
  assert.equal(sessions.length, 1, JSON.stringify(analyzer.analysisWarnings));
  const events = await analyzer.readSession(sessions[0], scope);
  assert.equal(events.length > 0, true);
  assert.equal(JSON.stringify(events).includes('"origin"'), false);
});

test("DSH permission preset origin contract stays closed and validation-only", () => {
  const analyzer = new DshSessionAnalyzer();
  const ref = {
    kind: "dsh-session-jsonl",
    role: "session-transcript",
    path: path.join(os.tmpdir(), "synthetic-session.jsonl"),
    sessionId: "dsh-rc1-origin-contract",
    cwd: path.resolve(os.tmpdir(), "synthetic-workspace"),
    dshProvenance: { delegationDepth: 0 },
  };
  const event = (data) => makeDshEvent("permission/preset", data, { seq: 0 });

  for (const origin of [undefined, "default", "selection", "inferred"]) {
    const data = { preset: "danger-full-access", ...(origin === undefined ? {} : { origin }) };
    assert.equal(analyzer.normalizeEvent(event(data), ref), null);
  }

  for (const origin of [null, "", "other", 1, true, {}, []]) {
    assert.throws(
      () => analyzer.normalizeEvent(event({ preset: "danger-full-access", origin }), ref),
      (error) => error?.code === "DSH_EVENT_SHAPE_DRIFT",
    );
  }
  assert.throws(
    () => analyzer.normalizeEvent(event({
      preset: "danger-full-access",
      origin: "default",
      futureField: "synthetic",
    }), ref),
    (error) => error?.code === "DSH_EVENT_SHAPE_DRIFT",
  );
  assert.throws(
    () => analyzer.normalizeEvent(event({ preset: 1 }), ref),
    (error) => error?.code === "DSH_EVENT_SHAPE_DRIFT",
  );
});

test("DSH public normalization entry validates event shape and re-sanitizes provenance", () => {
  const analyzer = new DshSessionAnalyzer();
  const event = makeDshEvent("turn/start", { turn: 1 }, { seq: 0 });
  const ref = {
    kind: "dsh-session-jsonl",
    role: "session-transcript",
    path: path.join(os.tmpdir(), "synthetic-session.jsonl"),
    sessionId: "dsh-public-normalization",
    cwd: path.resolve(os.tmpdir(), "synthetic-workspace"),
    dshProvenance: { delegationDepth: 1, origin: "subagent", parentSession: DSH_FIXTURE_SECRET },
  };
  const normalized = analyzer.normalizeEvent(event, ref);
  assert.equal(normalized.type, "turn.start");
  assert.equal(JSON.stringify(normalized).includes(DSH_FIXTURE_SECRET), false);
  assert.throws(
    () => analyzer.normalizeEvent({ ...event, data: { turn: 0 } }, ref),
    (error) => error?.code === "DSH_EVENT_SHAPE_DRIFT",
  );
  assert.equal(analyzer.normalizeEvent(makeKnownUnsupportedDshEvent({ seq: 0 }), ref), null);
});
