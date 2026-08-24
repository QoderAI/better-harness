import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import * as zlib from "node:zlib";

// Pinned contract at deepseek-harness commit
// 99f6f02fecdb7dff40c3fbc9470f5907c29f74ca:
// packages/core/session/src/{types,invariant,chunk-rows,known-event-types}.ts,
// packages/llm/llm/src/{message,types}.ts, and
// packages/session/session-persistence-jsonl/src/{format,zstd}.ts.
// RC8 compatibility fixtures additionally mirror deepseek-harness commit
// 141eb6fef83422698aef7a981029e843e8161534:
// packages/core/session/src/types.ts and
// packages/experimental/agent-team/src/{types,fold,task-graph}.ts.

export const DSH_FORMAT_VERSION = 0;
export const DSH_FIXTURE_SECRET = "sk-dsh_fixture_secret_NEVER_EXPOSE";
export const DSH_ZSTD_UNAVAILABLE = "DSH_ZSTD_UNAVAILABLE";
export const DSH_FIXTURE_MALFORMED_PACKED_ROW = "DSH_FIXTURE_MALFORMED_PACKED_ROW";
export const DSH_FIXTURE_UNSUPPORTED_PACKED_ROW = "DSH_FIXTURE_UNSUPPORTED_PACKED_ROW";

const DEFAULT_SESSION_ID = "dsh-fixture-session-0001";
const DEFAULT_WORKSPACE = "/synthetic/workspace/project";
const BASE_TIME = Date.parse("2026-08-18T00:00:00.000Z");
const PACKED_TAGS = new Set(["text-chunks", "reasoning-chunks", "tool-call-chunks"]);

function fresh(value) {
  return structuredClone(value);
}

function surfaceEvent(type, seq, time, data, extra = {}) {
  return { type, seq, time, data: fresh(data), ...fresh(extra) };
}

function userMessage(id, text, source) {
  return {
    id,
    role: "user",
    content: [{ type: "text", text }],
    source: fresh(source),
  };
}

function assistantMessage(id, text) {
  return {
    id,
    role: "assistant",
    content: [{ type: "text", text }],
    source: { kind: "model", provider: "fixture-provider", model: "fixture-model" },
  };
}

function toolResultMessage(id, callId, text, isError) {
  return {
    id,
    role: "user",
    content: [{
      type: "tool-result",
      toolCallId: callId,
      content: [{ type: "text", text }],
      isError,
    }],
    source: { kind: "tool", callId },
  };
}

export function makeDshHeader(options = {}) {
  const {
    workspace = DEFAULT_WORKSPACE,
    sessionId = DEFAULT_SESSION_ID,
    createdAt = BASE_TIME,
    delegationDepth = 1,
  } = options;
  const parentSession = Object.hasOwn(options, "parentSession")
    ? options.parentSession
    : "dsh-fixture-parent-0001";
  const seedLength = Object.hasOwn(options, "seedLength") ? options.seedLength : 2;
  const origin = Object.hasOwn(options, "origin") ? options.origin : "subagent";
  const agentPreset = Object.hasOwn(options, "agentPreset") ? options.agentPreset : "fixture-reviewer";
  return fresh({
    type: "session",
    version: DSH_FORMAT_VERSION,
    id: sessionId,
    cwd: workspace,
    createdAt,
    ...(parentSession !== undefined ? { parentSession } : {}),
    ...(seedLength !== undefined ? { seedLength } : {}),
    ...(origin !== undefined ? { origin } : {}),
    delegationDepth,
    ...(agentPreset !== undefined ? { agentPreset } : {}),
  });
}

export function makeDshEvent(type, data, {
  seq = 0,
  time = BASE_TIME + 1_000,
  ignorable,
  sourceEventSeqs,
  surfaceOp,
} = {}) {
  return fresh({
    type,
    seq,
    time,
    data,
    ...(ignorable === true ? { ignorable: true } : {}),
    ...(sourceEventSeqs !== undefined ? { sourceEventSeqs } : {}),
    ...(surfaceOp !== undefined ? { surfaceOp } : {}),
  });
}

export function makeSupportedDshSessionRows(options = {}) {
  const header = makeDshHeader(options);
  const eventTime = header.createdAt + 1_000;
  const successCallId = "fixture-call-success";
  const errorCallId = "fixture-call-error";
  const events = [
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: eventTime }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: eventTime + 10 }),
    surfaceEvent("user/message", 2, eventTime + 20,
      userMessage("fixture-user-direct", "Inspect the synthetic fixture.", { kind: "user" }),
      { surfaceOp: "append" }),
    surfaceEvent("user/message", 3, eventTime + 30,
      userMessage("fixture-user-injected", DSH_FIXTURE_SECRET, {
        kind: "plugin",
        plugin: "fixture-context",
        form: "notice",
        summary: "Synthetic context injection.",
      }),
      { surfaceOp: "append" }),
    surfaceEvent("assistant/message", 4, eventTime + 40, {
      turn: 1,
      step: 1,
      message: assistantMessage("fixture-assistant", "I will call both synthetic tools."),
      usage: {
        inputTokens: 12,
        outputTokens: 8,
        cacheReadTokens: 2,
        reasoningTokens: 1,
      },
    }, { sourceEventSeqs: [], surfaceOp: "append" }),
    makeDshEvent("tool/call", {
      turn: 1,
      step: 1,
      callId: successCallId,
      name: "fixture_read",
      arguments: "{\"path\":\"synthetic.txt\"}",
    }, { seq: 5, time: eventTime + 50 }),
    surfaceEvent("tool/result", 6, eventTime + 60, {
      turn: 1,
      step: 1,
      message: toolResultMessage("fixture-tool-success", successCallId, "synthetic result", false),
    }, { surfaceOp: "append" }),
    makeDshEvent("tool/call", {
      turn: 1,
      step: 1,
      callId: errorCallId,
      name: "fixture_fail",
      arguments: "{}",
    }, { seq: 7, time: eventTime + 70 }),
    surfaceEvent("tool/result", 8, eventTime + 80, {
      turn: 1,
      step: 1,
      message: toolResultMessage("fixture-tool-error", errorCallId, "synthetic failure", true),
      error: { name: "FixtureToolError", code: "FIXTURE_TOOL_FAILURE" },
    }, { surfaceOp: "append" }),
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 9, time: eventTime + 90 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, {
      seq: 10,
      time: eventTime + 100,
    }),
  ];
  return fresh([header, ...events]);
}

export function makeRc8InterruptedDshSessionRows(options = {}) {
  const header = makeDshHeader({
    ...options,
    parentSession: Object.hasOwn(options, "parentSession") ? options.parentSession : undefined,
    seedLength: Object.hasOwn(options, "seedLength") ? options.seedLength : undefined,
    origin: Object.hasOwn(options, "origin") ? options.origin : undefined,
    delegationDepth: options.delegationDepth ?? 0,
    agentPreset: Object.hasOwn(options, "agentPreset") ? options.agentPreset : undefined,
  });
  const time = header.createdAt + 1_000;
  return fresh([
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: time + 1 }),
    makeDshEvent("assistant/message", {
      turn: 1,
      step: 1,
      message: assistantMessage("fixture-rc8-interrupted", "Partial synthetic response."),
      interrupted: true,
    }, { seq: 2, time: time + 2, sourceEventSeqs: [], surfaceOp: "append" }),
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 3, time: time + 3 }),
    makeDshEvent("turn/end", {
      turn: 1,
      reason: { kind: "aborted", reason: { kind: "user" } },
    }, { seq: 4, time: time + 4 }),
  ]);
}

export function makeRc8TeamDshSessionRows(options = {}) {
  const header = makeDshHeader({
    ...options,
    parentSession: Object.hasOwn(options, "parentSession") ? options.parentSession : undefined,
    seedLength: Object.hasOwn(options, "seedLength") ? options.seedLength : undefined,
    origin: Object.hasOwn(options, "origin") ? options.origin : undefined,
    delegationDepth: options.delegationDepth ?? 0,
    agentPreset: Object.hasOwn(options, "agentPreset") ? options.agentPreset : undefined,
  });
  const time = header.createdAt + 1_000;
  const teamId = header.id;
  return fresh([
    header,
    makeDshEvent("team/member", {
      version: 1,
      teamId,
      member: {
        id: "fixture-team-member",
        name: "fixture-member",
        description: "Synthetic teammate.",
        provider: "fixture-provider",
        context: "fresh",
        phase: "provisioning",
      },
    }, { seq: 0, time }),
    makeDshEvent("team/task", {
      version: 1,
      teamId,
      task: {
        id: "task-1",
        revision: 1,
        subject: "Inspect synthetic evidence",
        description: "Validate the RC8 fixture.",
        status: "pending",
        blockedBy: [],
        writeScopes: [],
      },
    }, { seq: 1, time: time + 1 }),
    makeDshEvent("team/message/queued", {
      version: 1,
      teamId,
      message: {
        id: "fixture-team-message",
        senderId: teamId,
        senderName: "fixture-lead",
        targetId: "fixture-team-member",
        delivery: "quiet",
        content: [{ type: "text", text: "Synthetic peer message." }],
      },
    }, { seq: 2, time: time + 2 }),
    makeDshEvent("team/message/delivered", {
      version: 1,
      teamId,
      messageId: "fixture-team-message",
      targetId: "fixture-team-member",
    }, { seq: 3, time: time + 3 }),
  ]);
}

// Mirrors examples/headless-agent/tests/snapshots/headless-profile/session.expected.jsonl
// at the pinned DSH commit while keeping all values synthetic and machine-independent.
export function makeNativeSnapshotDshSessionRows(options = {}) {
  const header = makeDshHeader({
    ...options,
    parentSession: Object.hasOwn(options, "parentSession") ? options.parentSession : undefined,
    seedLength: Object.hasOwn(options, "seedLength") ? options.seedLength : undefined,
    origin: Object.hasOwn(options, "origin") ? options.origin : undefined,
    delegationDepth: options.delegationDepth ?? 0,
    agentPreset: Object.hasOwn(options, "agentPreset") ? options.agentPreset : undefined,
  });
  const time0 = header.createdAt + 1_000;
  const userText = options.userText ?? "Prove the synthetic headless profile path.";
  const privateText = options.privateText ?? "Synthetic private request metadata.";
  const direct = userMessage("fixture-native-human", userText, { kind: "user" });
  const injected = userMessage("fixture-native-context", "Synthetic runtime context.", {
    kind: "plugin",
    plugin: "@deepseek-ai/dsh-system-prompt",
    form: "snapshot",
    sections: [{ name: "sandbox:policy", text: "Synthetic policy context." }],
  });
  const config = { provider: "fixture-provider", model: "fixture-model", reasoningEffort: "high" };
  const tools = [{
    name: "fixture_read",
    description: `Synthetic tool. ${privateText}`,
    parameters: { type: "object", properties: { path: { type: "string" } } },
  }];
  const callId = "fixture-native-call";
  const events = [];
  const push = (type, data, extra = {}) => {
    events.push(makeDshEvent(type, data, { seq: events.length, time: time0 + events.length, ...extra }));
  };
  push("permission/preset", { preset: "danger-full-access" });
  push("sandbox/mode", { mode: "danger-full-access" });
  push("approval/policy", { policy: "never" });
  push("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [direct] });
  push("turn/start", { turn: 1 });
  push("agent/inbox/spliced", { target: "next-turn", start: 0, removedCount: 1, inserted: [] });
  push("step/start", { turn: 1, step: 1 });
  push("user/message", direct, { surfaceOp: "append" });
  push("user/message", injected, { surfaceOp: "append" });
  push("session/title", {
    title: "Prove the synthetic headless profile", messageSeqs: [7], source: { kind: "fallback" },
  });
  push("request/header", {
    header: {
      config,
      adapterDefaults: { reasoningEffort: true },
      system: privateText,
      tools,
    },
    reason: "initial",
  });
  push("request/context", { provider: config.provider, model: config.model, contextWindow: 32_768 });
  push("session/title-llm-request", {
    titleProvider: "session-title-first-prompt-llm",
    messageSeqs: [7],
    route: { provider: config.provider, model: config.model },
    system: `Synthetic title system. ${privateText}`,
    messages: [userMessage("fixture-title-request", `Synthetic title prompt. ${privateText}`, {
      kind: "plugin", plugin: "dsh-session-title-llm",
    })],
    maxTokens: 64,
  });
  push("assistant/chunk", { turn: 1, step: 1, chunk: { type: "block-start", index: 0, blockType: "tool-call" } });
  push("assistant/chunk", {
    turn: 1, step: 1, chunk: {
      type: "tool-call-delta", index: 0, id: callId, name: "fixture_read",
      argumentsDelta: "{\"path\":\"synthetic.txt\"}",
    },
  });
  push("assistant/chunk", {
    turn: 1, step: 1, chunk: {
      type: "block-end", index: 0,
      block: { type: "tool-call", id: callId, name: "fixture_read", arguments: "{\"path\":\"synthetic.txt\"}" },
    },
  });
  push("assistant/chunk", {
    turn: 1, step: 1, chunk: { type: "usage", usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 } },
  });
  push("assistant/chunk", { turn: 1, step: 1, chunk: { type: "finish", reason: { kind: "tool-calls" } } });
  push("assistant/message", {
    turn: 1,
    step: 1,
    message: {
      id: "fixture-native-assistant-tool",
      role: "assistant",
      content: [{ type: "tool-call", id: callId, name: "fixture_read", arguments: "{\"path\":\"synthetic.txt\"}" }],
      source: { kind: "model", provider: config.provider, model: config.model },
    },
    usage: { inputTokens: 11, outputTokens: 3, cacheReadTokens: 2 },
  }, { sourceEventSeqs: [13, 14, 15, 16, 17], surfaceOp: "append" });
  push("tool/call", {
    turn: 1, step: 1, callId, name: "fixture_read", arguments: "{\"path\":\"synthetic.txt\"}",
  });
  push("tool/result", {
    turn: 1,
    step: 1,
    message: toolResultMessage("fixture-native-result", callId, "synthetic native result", false),
  }, { sourceEventSeqs: [19], surfaceOp: "append" });
  push("step/end", { turn: 1, step: 1 });
  push("step/start", { turn: 1, step: 2 });
  push("request/header", {
    header: { config: { provider: config.provider, model: config.model, reasoningEffort: "off" }, system: privateText, tools },
    reason: "change",
  });
  push("assistant/chunk", { turn: 1, step: 2, chunk: { type: "block-start", index: 0, blockType: "text" } });
  push("assistant/chunk", { turn: 1, step: 2, chunk: { type: "text-delta", index: 0, text: "Synthetic complete." } });
  push("assistant/chunk", {
    turn: 1, step: 2, chunk: { type: "block-end", index: 0, block: { type: "text", text: "Synthetic complete." } },
  });
  push("assistant/chunk", { turn: 1, step: 2, chunk: { type: "usage", usage: { inputTokens: 7, outputTokens: 5 } } });
  push("assistant/chunk", { turn: 1, step: 2, chunk: { type: "finish", reason: { kind: "stop" } } });
  push("assistant/message", {
    turn: 1,
    step: 2,
    message: assistantMessage("fixture-native-assistant-final", "Synthetic complete."),
    usage: { inputTokens: 7, outputTokens: 5 },
  }, { sourceEventSeqs: [24, 25, 26, 27, 28], surfaceOp: "append" });
  push("step/end", { turn: 1, step: 2 });
  push("turn/end", { turn: 1, reason: { kind: "completed" } });
  return fresh([header, ...events]);
}

function terminalReason(kind) {
  switch (kind) {
    case "completed":
      return { kind: "completed" };
    case "aborted":
      return { kind: "aborted", reason: { kind: "hook", reason: "synthetic cancellation" } };
    case "blocked":
      return { kind: "blocked" };
    case "error":
      return {
        kind: "error",
        error: { message: "synthetic provider failure", code: "FIXTURE_PROVIDER_FAILURE", status: 503 },
      };
    case "max-tokens":
      return { kind: "max-tokens" };
    case "interrupted":
      return { kind: "interrupted" };
    default:
      throw new TypeError(`unsupported synthetic terminal reason: ${kind}`);
  }
}

export function makeTerminalDshSessionRows(kind, options = {}) {
  const sessionId = options.sessionId ?? `dsh-fixture-terminal-${kind}`;
  const header = makeDshHeader({ ...options, sessionId, parentSession: undefined, seedLength: undefined,
    origin: undefined, delegationDepth: 0, agentPreset: undefined });
  const time = header.createdAt + 1_000;
  const events = [makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time })];
  if (kind !== "blocked") {
    events.push(surfaceEvent("user/message", 1, time + 10,
      userMessage(`fixture-terminal-user-${kind}`, `Exercise ${kind}.`, { kind: "user" }),
      { surfaceOp: "append" }));
  }
  if (["completed", "error", "max-tokens"].includes(kind)) {
    const stepSeq = events.length;
    events.push(makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: stepSeq, time: time + 20 }));
    events.push(makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: stepSeq + 1, time: time + 30 }));
  }
  events.push(makeDshEvent("turn/end", { turn: 1, reason: terminalReason(kind) }, {
    seq: events.length,
    time: time + 40,
  }));
  return fresh([header, ...events]);
}

export function makeKnownUnsupportedDshEvent({ seq = 0, time = BASE_TIME + 1_000 } = {}) {
  return makeDshEvent("todo/write", {
    todos: [{ content: "Review the synthetic fixture", status: "in_progress" }],
  }, { seq, time });
}

export function makeKnownUnsupportedDshSessionRows(options = {}) {
  const header = makeDshHeader({ ...options, sessionId: options.sessionId ?? "dsh-fixture-known-unsupported" });
  const time = header.createdAt + 1_000;
  return fresh([
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time }),
    makeKnownUnsupportedDshEvent({ seq: 1, time: time + 10 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 2, time: time + 20 }),
  ]);
}

export function makeUnknownRequiredDshEvent({ seq = 0, time = BASE_TIME + 1_000 } = {}) {
  return makeDshEvent("fixture-future/required", { value: "synthetic" }, { seq, time });
}

export function makeUnknownIgnorableDshEvent({ seq = 0, time = BASE_TIME + 1_000 } = {}) {
  return makeDshEvent("fixture-future/ignorable", { value: "synthetic" }, { seq, time, ignorable: true });
}

export function makePackedDshStorageRows() {
  return fresh([
    {
      type: "text-chunks",
      seq0: 0,
      time0: BASE_TIME + 1_000,
      data: { turn: 1, step: 1, index: 0, dt: [2, 3], texts: ["one", " two", "."] },
    },
    {
      type: "reasoning-chunks",
      seq0: 3,
      time0: BASE_TIME + 1_010,
      data: { turn: 1, step: 1, index: 1, dt: [1, -1], texts: ["think", "ing", "."] },
    },
    {
      type: "tool-call-chunks",
      seq0: 6,
      time0: BASE_TIME + 1_020,
      data: {
        turn: 1,
        step: 1,
        index: 2,
        id: "fixture-packed-call",
        name: "fixture_tool",
        dt: [4, 5],
        args: ["{\"value\":", "1", "}"],
      },
    },
  ]);
}

export function makeMalformedPackedDshStorageRows() {
  const [text, reasoning, tool] = makePackedDshStorageRows();
  return fresh([
    { ...text, unexpected: true },
    { ...reasoning, data: { ...reasoning.data, dt: [] } },
    { ...tool, data: { ...tool.data, id: 42 } },
    { type: "future-chunks", seq0: 9, time0: BASE_TIME + 2_000,
      data: { turn: 1, step: 1, index: 3, dt: [], texts: ["future"] } },
  ]);
}

function packedError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object"
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key));
}

export function decodePackedDshStorageRecordForFixture(input) {
  const row = fresh(input);
  if (!PACKED_TAGS.has(row?.type)) {
    throw packedError(DSH_FIXTURE_UNSUPPORTED_PACKED_ROW, "unsupported packed DSH storage row");
  }
  if (!hasExactKeys(row, ["type", "seq0", "time0", "data"])) {
    throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed envelope has unexpected fields");
  }
  if (!Number.isSafeInteger(row.seq0) || row.seq0 < 0 || !Number.isSafeInteger(row.time0)) {
    throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed sequence/time anchor is invalid");
  }
  const data = row.data;
  const isTool = row.type === "tool-call-chunks";
  const toolKeys = Object.hasOwn(data ?? {}, "name")
    ? ["turn", "step", "index", "id", "name", "dt", "args"]
    : ["turn", "step", "index", "id", "dt", "args"];
  const expectedKeys = isTool ? toolKeys : ["turn", "step", "index", "dt", "texts"];
  if (!hasExactKeys(data, expectedKeys)
    || typeof data.turn !== "number"
    || typeof data.step !== "number"
    || typeof data.index !== "number") {
    throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed data shape is invalid");
  }
  if (isTool && (typeof data.id !== "string"
    || (Object.hasOwn(data, "name") && typeof data.name !== "string"))) {
    throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed tool identity is invalid");
  }
  const members = isTool ? data.args : data.texts;
  if (!Array.isArray(members) || members.length === 0 || members.some((item) => typeof item !== "string")
    || !Array.isArray(data.dt) || data.dt.some((gap) => !Number.isSafeInteger(gap))
    || data.dt.length !== members.length - 1
    || !Number.isSafeInteger(row.seq0 + members.length - 1)) {
    throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed member arity is invalid");
  }
  const events = [];
  let time = row.time0;
  for (let index = 0; index < members.length; index += 1) {
    if (index > 0) time += data.dt[index - 1];
    if (!Number.isSafeInteger(time)) {
      throw packedError(DSH_FIXTURE_MALFORMED_PACKED_ROW, "packed member time is invalid");
    }
    let chunk;
    if (row.type === "text-chunks") {
      chunk = { type: "text-delta", index: data.index, text: members[index] };
    } else if (row.type === "reasoning-chunks") {
      chunk = { type: "reasoning-delta", index: data.index, text: members[index] };
    } else {
      chunk = {
        type: "tool-call-delta",
        index: data.index,
        id: data.id,
        ...(Object.hasOwn(data, "name") ? { name: data.name } : {}),
        argumentsDelta: members[index],
      };
    }
    events.push({
      type: "assistant/chunk",
      seq: row.seq0 + index,
      time,
      data: { turn: data.turn, step: data.step, chunk },
    });
  }
  return fresh(events);
}

export function encodeDshRawJsonl(rows) {
  return Buffer.from(`${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function zstdUnavailable() {
  const error = new Error("public Node.js Zstandard compression API is unavailable");
  error.code = DSH_ZSTD_UNAVAILABLE;
  return error;
}

export function makeDshZstdArtifact(rowBatches, {
  compressor = zlib.zstdCompressSync,
  checksumFlag = zlib.constants?.ZSTD_c_checksumFlag,
} = {}) {
  if (typeof compressor !== "function" || !Number.isSafeInteger(checksumFlag)) {
    throw zstdUnavailable();
  }
  const frames = rowBatches.map((rows) => Buffer.from(compressor(encodeDshRawJsonl(rows), {
    params: { [checksumFlag]: 1 },
  })));
  return {
    frames: frames.map((frame) => Buffer.from(frame)),
    artifact: Buffer.concat(frames),
  };
}

export function decodeDshZstdFramesForFixture(frames, {
  decompressor = zlib.zstdDecompressSync,
} = {}) {
  if (typeof decompressor !== "function") throw zstdUnavailable();
  if (!Array.isArray(frames) || frames.length === 0 || frames.some((frame) => !Buffer.isBuffer(frame))) {
    throw new TypeError("frames must be a non-empty Buffer array");
  }
  return frames.map((frame) => Buffer.from(decompressor(Buffer.from(frame))));
}

export function encodeDshSessionIdSegment(raw) {
  if (typeof raw !== "string" || raw.length === 0) throw new TypeError("sessionId must be non-empty");
  if (raw === ".") return "~002E";
  if (raw === "..") return "~002E~002E";
  let encoded = "";
  for (let index = 0; index < raw.length; index += 1) {
    const code = raw.charCodeAt(index);
    const char = String.fromCharCode(code);
    encoded += char !== "~" && /^[A-Za-z0-9._-]$/u.test(char)
      ? char
      : `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
  }
  return encoded;
}

export function dshProjectKey(cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) throw new TypeError("cwd must be non-empty");
  let readable = "";
  let separatorRun = false;
  for (let index = 0; index < cwd.length; index += 1) {
    const code = cwd.charCodeAt(index);
    const char = String.fromCharCode(code);
    if (char === "/" || char === "\\" || char === ":") {
      if (!separatorRun) readable += "-";
      separatorRun = true;
    } else if (char !== "~" && /^[A-Za-z0-9._-]$/u.test(char)) {
      readable += char;
      separatorRun = false;
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, "0")}`;
      separatorRun = false;
    }
  }
  const slug = readable.replace(/^-+/u, "") || "root";
  return `--${slug.slice(0, 251)}--`;
}

export async function writeNestedDshArtifact({
  dshHome,
  rows,
  projectSegment,
  sessionId = rows?.[0]?.id ?? DEFAULT_SESSION_ID,
  compression = "raw",
  compressor = zlib.zstdCompressSync,
} = {}) {
  if (typeof dshHome !== "string" || !path.isAbsolute(dshHome)) {
    throw new TypeError("dshHome must be an absolute caller-owned temporary directory");
  }
  const resolvedProjectSegment = projectSegment ?? dshProjectKey(rows?.[0]?.cwd);
  if (typeof resolvedProjectSegment !== "string" || resolvedProjectSegment.length === 0
    || resolvedProjectSegment === "." || resolvedProjectSegment === ".."
    || path.basename(resolvedProjectSegment) !== resolvedProjectSegment) {
    throw new TypeError("projectSegment must be one safe path segment");
  }
  if (!Array.isArray(rows) || rows.length < 1) throw new TypeError("rows must include a header");
  const directory = path.join(
    dshHome,
    "sessions",
    resolvedProjectSegment,
    encodeDshSessionIdSegment(sessionId),
  );
  await mkdir(directory, { recursive: true });
  const compressed = compression === "zstd";
  if (!compressed && compression !== "raw") throw new TypeError(`unsupported fixture compression: ${compression}`);
  const filePath = path.join(directory, compressed ? "session.jsonl.zstd" : "session.jsonl");
  const bytes = compressed
    ? makeDshZstdArtifact([[rows[0]], rows.slice(1)], { compressor }).artifact
    : encodeDshRawJsonl(rows);
  await writeFile(filePath, bytes);
  return {
    dshHome,
    directory,
    filePath,
    sessionId,
    projectSegment: resolvedProjectSegment,
    compression,
    bytes: Buffer.from(bytes),
  };
}

export function makeForeignWorkspaceDshFixture({
  requestedWorkspace = "/synthetic/workspace/target",
  foreignWorkspace = "/synthetic/workspace/foreign",
  sessionId = "dsh-fixture-foreign-workspace",
} = {}) {
  return fresh({
    requestedWorkspace,
    rows: makeSupportedDshSessionRows({ workspace: foreignWorkspace, sessionId }),
  });
}

export function makeCrossPlatformDshWorkspaceFixtures() {
  const cases = [
    { platform: "posix", workspace: "/synthetic/Workspace/My Project" },
    { platform: "win32", workspace: "C:\\synthetic\\Workspace\\My Project" },
  ];
  return fresh(cases.map(({ platform, workspace }) => ({
    platform,
    workspace,
    rows: makeSupportedDshSessionRows({ workspace, sessionId: `dsh-fixture-${platform}-path` }),
  })));
}

export function makeCanonicalDedupeDshFixture({
  dshHome,
  workspace = DEFAULT_WORKSPACE,
  sessionId = "dsh-fixture-dedupe",
} = {}) {
  if (typeof dshHome !== "string" || !path.isAbsolute(dshHome)) {
    throw new TypeError("dshHome must be an absolute caller-owned temporary directory");
  }
  const rows = makeSupportedDshSessionRows({ workspace, sessionId });
  const encodedSessionId = encodeDshSessionIdSegment(sessionId);
  const directory = path.join(dshHome, "sessions", dshProjectKey(workspace), encodedSessionId);
  const canonicalPath = path.join(directory, "session.jsonl");
  const aliasPath = `${directory}${path.sep}..${path.sep}${encodedSessionId}${path.sep}session.jsonl`;
  return fresh({
    sessionId,
    canonicalPath,
    candidates: [
      { path: canonicalPath, rows },
      { path: aliasPath, rows: fresh(rows) },
    ],
  });
}

export function makeBadVersionDshRows(options = {}) {
  const rows = makeSupportedDshSessionRows(options);
  rows[0].version = DSH_FORMAT_VERSION + 1;
  return fresh(rows);
}

export function makeBadHeaderDshRows(options = {}) {
  const rows = makeSupportedDshSessionRows(options);
  delete rows[0].delegationDepth;
  return fresh(rows);
}

export function makeBadIdentityDshFixture(options = {}) {
  const artifactSessionId = options.artifactSessionId ?? "dsh-fixture-expected-id";
  const rows = makeSupportedDshSessionRows({ ...options, sessionId: "dsh-fixture-other-id" });
  return fresh({ artifactSessionId, rows });
}

export function makeBadSequenceDshRows(options = {}) {
  const rows = makeSupportedDshSessionRows(options);
  rows[4].seq += 1;
  return fresh(rows);
}

export function makeMalformedDshJsonlBytes(options = {}) {
  const header = makeDshHeader(options);
  return Buffer.from(`${JSON.stringify(header)}\n{\"type\":\n`, "utf8");
}

export function makeOpenTurnDshRows(options = {}) {
  const header = makeDshHeader(options);
  return fresh([
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: header.createdAt + 1_000 }),
    surfaceEvent("user/message", 1, header.createdAt + 1_010,
      userMessage("fixture-open-user", "Leave this synthetic turn open.", { kind: "user" }),
      { surfaceOp: "append" }),
  ]);
}
