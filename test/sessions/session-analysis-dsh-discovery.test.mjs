import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { test } from "vitest";

import {
  DSH_ADAPTER_VERSION,
  DSH_SESSION_FORMAT_VERSION,
  DshSessionAnalyzer,
  decodeDshArtifact,
  decodeDshJsonl,
  decodeDshZstdArtifact,
  dedupeDshArtifactCandidates,
  dshProjectKey,
  encodeDshSessionId,
  isDshJsonValue,
  normalizeDshEpochMillis,
  readDshSessionArtifact,
  splitDshZstdFrames,
} from "../../scripts/session-analysis/platforms/dsh.mjs";
import {
  DSH_FIXTURE_SECRET,
  decodePackedDshStorageRecordForFixture,
  dshProjectKey as fixtureProjectKey,
  encodeDshRawJsonl,
  encodeDshSessionIdSegment,
  makeBadHeaderDshRows,
  makeBadIdentityDshFixture,
  makeBadSequenceDshRows,
  makeBadVersionDshRows,
  makeCrossPlatformDshWorkspaceFixtures,
  makeDshHeader,
  makeDshEvent,
  makeDshZstdArtifact,
  makeKnownUnsupportedDshSessionRows,
  makeMalformedDshJsonlBytes,
  makeMalformedPackedDshStorageRows,
  makeNativeSnapshotDshSessionRows,
  makeOpenTurnDshRows,
  makePackedDshStorageRows,
  makeRc8InterruptedDshSessionRows,
  makeRc8TeamDshSessionRows,
  makeSupportedDshSessionRows,
  makeTerminalDshSessionRows,
  makeUnknownIgnorableDshEvent,
  makeUnknownRequiredDshEvent,
  writeNestedDshArtifact,
} from "./dsh-fixtures.mjs";

const SYMLINK_TYPE = process.platform === "win32" ? "junction" : "dir";

async function tempRoot(prefix = "dsh-discovery-") {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

async function inventory(home, workspace, dependencies = {}) {
  const analyzer = new DshSessionAnalyzer(dependencies);
  const scope = await analyzer.resolveScope({ dshHome: home, workspace });
  const roots = await analyzer.discoverSourceRoots(scope);
  const sessions = await analyzer.discoverSessions(scope, roots);
  return { analyzer, scope, roots, sessions, warnings: analyzer.analysisWarnings };
}

function stableError(code) {
  return (error) => error?.code === code && !String(error?.message).includes(DSH_FIXTURE_SECRET);
}

function appendEvent(rows, event) {
  const result = structuredClone(rows);
  result.splice(result.length - 1, 0, event);
  result.at(-1).seq += 1;
  return result;
}

function rowsWithChunks(chunks) {
  const header = makeDshHeader({ parentSession: undefined, seedLength: undefined, origin: undefined,
    delegationDepth: 0, agentPreset: undefined });
  const time = header.createdAt + 1_000;
  const events = [
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: time + 1 }),
    ...chunks.map((chunk, index) => makeDshEvent("assistant/chunk", { turn: 1, step: 1, chunk },
      { seq: index + 2, time: time + index + 2 })),
  ];
  events.push(makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: events.length, time: time + events.length }));
  events.push(makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } },
    { seq: events.length, time: time + events.length }));
  return [header, ...events];
}

function insertBeforeTurnEnd(rows, events) {
  const output = structuredClone(rows);
  output.splice(output.length - 1, 0, ...events);
  output.slice(1).forEach((event, index) => { event.seq = index; });
  return output;
}

function makeAlpha1PackedRangeRows() {
  const header = makeDshHeader({ parentSession: undefined, seedLength: undefined, origin: undefined,
    delegationDepth: 0, agentPreset: undefined });
  const storage = makePackedDshStorageRows().map((row) => ({ ...row, seq0: row.seq0 + 2 }));
  const assistant = structuredClone(makeSupportedDshSessionRows()
    .find((row) => row.type === "assistant/message"));
  assistant.seq = 11;
  assistant.time = header.createdAt + 2_000;
  assistant.sourceEventSeqs = [[2, 10]];
  return [
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: header.createdAt + 900 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: header.createdAt + 950 }),
    ...storage,
    assistant,
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 12, time: header.createdAt + 2_010 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, {
      seq: 13, time: header.createdAt + 2_020,
    }),
  ];
}

function makeAlpha1MetadataEvent(type, header, seq, time) {
  const data = type === "model/selection"
    ? { provider: "fixture-provider", model: "fixture-model", reasoningEffort: "high" }
    : type === "session-log-deepseek/delivery-accepted"
      ? { sessionId: header.id, throughSeq: seq - 1 }
      : { allowedModels: [{ provider: "fixture-provider", model: "fixture-model" }] };
  return makeDshEvent(type, data, { seq, time });
}

function requestHeaderEvent({
  reason = "initial",
  config = { provider: "fixture-provider", model: "fixture-model" },
  adapterDefaults,
  system,
  tools,
} = {}) {
  return makeDshEvent("request/header", {
    header: {
      config,
      ...(adapterDefaults !== undefined ? { adapterDefaults } : {}),
      ...(system !== undefined ? { system } : {}),
      ...(tools !== undefined ? { tools } : {}),
    },
    reason,
  });
}

function insertRequestHeader(rows, event = requestHeaderEvent()) {
  const output = structuredClone(rows);
  const assistantIndex = output.findIndex((row) => row.type === "assistant/message");
  output.splice(assistantIndex, 0, event);
  output.slice(1).forEach((row, index) => { row.seq = index; });
  return output;
}

const PINNED_KNOWN_EVENT_TYPES = [
  "agent-preset/selected", "agent/inbox/spliced", "approval/asked", "approval/decided",
  "approval/policy", "assistant/chunk", "assistant/message", "command/done", "command/run",
  "compaction/end", "compaction/prune", "compaction/start", "compaction/summary",
  "feedback/record", "goal/change", "hook/invoked", "hook/result", "llm/retry",
  "llm/retry-started", "model/selection", "permission/preset", "plan/mode", "request/context", "request/header",
  "sandbox/mode", "schedule/change", "session/end-seed", "session/title",
  "session/title-llm-request", "session-log-deepseek/delivery-accepted", "step/end", "step/start",
  "subagent/descriptor", "subagent/model-selection-policy", "todo/write",
  "team/member", "team/message/delivered", "team/message/queued", "team/task",
  "tool-workflow/agent-end", "tool-workflow/agent-start", "tool-workflow/run-end",
  "tool-workflow/run-start", "tool/call", "tool/code-dispatch", "tool/code-dispatch-start",
  "tool/result", "turn/end", "turn/start", "user/message", "web/deepseek-search-llm-request",
];

test("DSH scope resolution has strict explicit, environment, and default precedence", async () => {
  const analyzer = new DshSessionAnalyzer();
  const workspace = path.resolve("synthetic-workspace");
  const explicit = path.resolve("explicit-dsh-home");
  const envHome = path.resolve("env-dsh-home");
  const scope = await analyzer.resolveScope({ home: explicit, dshHome: path.resolve("ignored"),
    env: { DSH_HOME: envHome }, workspace });
  assert.equal(scope.dshHome, explicit);
  assert.equal(scope.sessionRoot, path.join(explicit, "sessions"));
  assert.equal((await analyzer.discoverSourceRoots(scope)).length, 1);
  assert.equal((await analyzer.resolveScope({ env: { DSH_HOME: envHome }, workspace })).dshHome, envHome);
  const prior = process.env.DSH_HOME;
  delete process.env.DSH_HOME;
  try {
    assert.equal((await analyzer.resolveScope({ env: {}, workspace })).dshHome, path.join(os.homedir(), ".dsh"));
  } finally {
    if (prior === undefined) delete process.env.DSH_HOME;
    else process.env.DSH_HOME = prior;
  }
  for (const value of ["", "relative", "bad\0home", 42]) {
    await assert.rejects(() => analyzer.resolveScope({ dshHome: value, workspace }), stableError("DSH_INVALID_HOME"));
  }
});

test("DSH scope treats blank environment homes as unset", async () => {
  const analyzer = new DshSessionAnalyzer();
  const workspace = path.resolve("synthetic-workspace");
  const expected = path.join(os.homedir(), ".dsh");

  for (const value of ["", " ", "\t"]) {
    const scope = await analyzer.resolveScope({ env: { DSH_HOME: value }, workspace });
    assert.equal(scope.dshHome, expected);
  }
});

test("production identity encoders independently match the pinned fixture oracle", () => {
  for (const value of ["session", ".", "..", "with spaces/~and-unicode-\u03bb", "nul\0unit"]) {
    assert.equal(encodeDshSessionId(value), encodeDshSessionIdSegment(value));
  }
  assert.notEqual(encodeDshSessionId("nul\0unit"), encodeDshSessionId("nul~0000unit"));
  assert.equal(path.basename(encodeDshSessionId("nul\0unit")), encodeDshSessionId("nul\0unit"));
  assert.throws(() => encodeDshSessionId(""), stableError("DSH_INVALID_SESSION_ID"));
  for (const cwd of ["/synthetic/workspace/project", "C:\\Synthetic\\Workspace\\Project"]) {
    assert.equal(dshProjectKey(cwd), fixtureProjectKey(cwd));
  }
  assert.equal(DSH_ADAPTER_VERSION, "dsh-v1");
  assert.equal(DSH_SESSION_FORMAT_VERSION, 0);
});

test("canonical path aliases are deterministically counted once before artifact reading", () => {
  const canonical = path.resolve("synthetic", "artifact", "session.jsonl");
  const aliases = [
    { path: canonical, canonicalPath: canonical },
    { path: path.join(path.dirname(canonical), "..", "artifact", "session.jsonl"), canonicalPath: canonical },
  ];
  assert.deepEqual(dedupeDshArtifactCandidates(aliases), [aliases[0]]);
});

test("valid nested raw evidence binds header identity, workspace, time, source, and stays read-only", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "raw-valid" });
  const written = await writeNestedDshArtifact({ dshHome: home, rows });
  const beforeBytes = await readFile(written.filePath);
  const beforeStat = await stat(written.filePath);
  const result = await inventory(home, workspace);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sessionId, "raw-valid");
  assert.equal(result.sessions[0].cwd, workspace);
  assert.equal(result.sessions[0].sourceRefs[0].path, written.filePath);
  assert.equal(result.sessions[0].sourceRefs[0].encoding, "jsonl");
  assert.equal(result.sessions[0].incomplete, false);
  assert.equal(result.sessions[0].dshProvenance.parentSession, rows[0].parentSession);
  assert.equal(result.sessions[0].dshProvenance.agentPreset, rows[0].agentPreset);
  assert.equal(result.sessions[0].firstSeen, new Date(rows[0].createdAt).toISOString());
  assert.equal(result.sessions[0].lastSeen, new Date(rows.at(-1).time).toISOString());
  assert.deepEqual(await readFile(written.filePath), beforeBytes);
  const afterStat = await stat(written.filePath);
  assert.equal(afterStat.size, beforeStat.size);
  assert.equal(afterStat.mtimeMs, beforeStat.mtimeMs);
  const direct = await readDshSessionArtifact({ path: written.filePath, compressed: false });
  assert.equal(direct.unchanged, true);
});

test("concatenated Zstd is boundary-scanned and decompressed one complete frame at a time", () => {
  if (typeof zlib.zstdCompressSync !== "function" || typeof zlib.zstdDecompressSync !== "function"
    || !Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) return;
  const rows = makeSupportedDshSessionRows();
  const batches = [[rows[0]], rows.slice(1, 6), rows.slice(6)];
  const fixture = makeDshZstdArtifact(batches);
  const frames = splitDshZstdFrames(fixture.artifact);
  assert.equal(frames.length, 3);
  assert.deepEqual(frames, fixture.frames);
  const calls = [];
  const decoded = decodeDshZstdArtifact(fixture.artifact, { decompressor(frame) {
    calls.push(Buffer.from(frame));
    assert.equal(frame.equals(fixture.artifact), false);
    return zlib.zstdDecompressSync(frame);
  } });
  assert.deepEqual(calls, fixture.frames);
  assert.deepEqual(decoded.bytes, Buffer.concat(batches.map(encodeDshRawJsonl)));
  assert.deepEqual(decodeDshArtifact(fixture.artifact, { compressed: true }).events,
    decodeDshJsonl(encodeDshRawJsonl(rows)).events);
  const badFirst = makeDshZstdArtifact([[rows[0], rows[1]], rows.slice(2)]);
  assert.throws(() => decodeDshZstdArtifact(badFirst.artifact), stableError("DSH_ZSTD_FIRST_FRAME_NOT_HEADER_ONLY"));
  const crossBoundary = makeDshZstdArtifact([[rows[0]], rows.slice(1)]);
  const brokenFrame = Buffer.from(zlib.zstdCompressSync(Buffer.from(JSON.stringify(rows[1]), "utf8"), {
    params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 },
  }));
  assert.throws(() => decodeDshZstdArtifact(Buffer.concat([crossBoundary.frames[0], brokenFrame])),
    stableError("DSH_ZSTD_FRAME_NOT_JSONL_BATCH"));
});

test("valid compressed nested evidence participates in discovery when the public API exists", async () => {
  if (typeof zlib.zstdCompressSync !== "function" || typeof zlib.zstdDecompressSync !== "function"
    || !Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) return;
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "compressed-valid" });
  const written = await writeNestedDshArtifact({ dshHome: home, rows, compression: "zstd" });
  const result = await inventory(home, workspace);
  assert.equal(result.sessions.length, 1);
  assert.equal(result.sessions[0].sourceRefs[0].encoding, "zstd");
  assert.deepEqual(await readFile(written.filePath), written.bytes);
});

test("missing public decompressor marks compressed unavailable while independent raw remains readable", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace, sessionId: "raw-survives" }) });
  const compressedRows = makeSupportedDshSessionRows({ workspace, sessionId: "compressed-unavailable" });
  const compressedDir = path.join(home, "sessions", fixtureProjectKey(workspace),
    encodeDshSessionIdSegment(compressedRows[0].id));
  await mkdir(compressedDir, { recursive: true });
  await writeFile(path.join(compressedDir, "session.jsonl.zstd"), Buffer.from("not inspected without API"));
  const result = await inventory(home, workspace, { decompressor: null });
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["raw-survives"]);
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-zstd-unavailable"), true);
  assert.equal(JSON.stringify({ sessions: result.sessions, warnings: result.warnings }).includes("not inspected"), false);
});

test("Zstd frame scanner rejects malformed boundaries with stable privacy-safe codes", () => {
  const header = Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x24, 0x00]);
  const cases = [
    [Buffer.from([0x50, 0x2A, 0x4D, 0x18]), "DSH_ZSTD_BAD_MAGIC"],
    [Buffer.from([0x00, 0x00, 0x00, 0x00, 0x24]), "DSH_ZSTD_BAD_MAGIC"],
    [Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x2C, 0x00]), "DSH_ZSTD_RESERVED_DESCRIPTOR"],
    [Buffer.from([0x28, 0xB5, 0x2F, 0xFD, 0x20, 0x00]), "DSH_ZSTD_CHECKSUM_REQUIRED"],
    [header, "DSH_ZSTD_TRUNCATED_BLOCK"],
    [Buffer.concat([header, Buffer.from([0x07, 0x00, 0x00])]), "DSH_ZSTD_RESERVED_BLOCK"],
    [Buffer.concat([header, Buffer.from([0x09, 0x00, 0x00])]), "DSH_ZSTD_TRUNCATED_BLOCK"],
    [Buffer.concat([header, Buffer.from([0x01, 0x00, 0x00])]), "DSH_ZSTD_TRUNCATED_CHECKSUM"],
  ];
  for (const [bytes, code] of cases) assert.throws(() => splitDshZstdFrames(bytes), stableError(code));
  const syntacticallyComplete = Buffer.concat([header, Buffer.from([0x01, 0, 0]), Buffer.alloc(4)]);
  assert.throws(() => decodeDshZstdArtifact(syntacticallyComplete, { decompressor() { throw new Error(DSH_FIXTURE_SECRET); } }),
    stableError("DSH_ZSTD_DECOMPRESSION_FAILED"));
  assert.deepEqual(splitDshZstdFrames(Buffer.concat([syntacticallyComplete, Buffer.from([1])])),
    [syntacticallyComplete]);
});

test("crash tails preserve only the committed raw and Zstd event prefix", () => {
  const rows = makeSupportedDshSessionRows({ sessionId: "crash-tail-prefix" });
  const committedRows = rows.slice(0, -1);
  const committedEvents = committedRows.slice(1);
  const finalRow = Buffer.from(JSON.stringify(rows.at(-1)), "utf8");

  const partialRaw = decodeDshJsonl(Buffer.concat([
    encodeDshRawJsonl(committedRows),
    finalRow.subarray(0, Math.max(1, Math.floor(finalRow.length / 2))),
  ]));
  assert.deepEqual(partialRaw.events, committedEvents);
  assert.equal(partialRaw.incomplete, true);
  assert.equal(partialRaw.diagnostics.incompleteReason, "open-turn");

  const malformedLogicalRow = {
    ...makeDshEvent("step/start", { turn: 1, step: 2 }),
    seq: committedEvents.length + 1,
  };
  const malformedTail = decodeDshJsonl(encodeDshRawJsonl([...committedRows, malformedLogicalRow]));
  assert.deepEqual(malformedTail.events, committedEvents);
  assert.equal(malformedTail.incomplete, true);
  assert.equal(malformedTail.diagnostics.incompleteReason, "open-turn");
  assert.throws(() => decodeDshJsonl(Buffer.concat([
    encodeDshRawJsonl([...committedRows, malformedLogicalRow]),
    Buffer.from(`${JSON.stringify(rows.at(-1))}\n`, "utf8"),
  ])), stableError("DSH_INVALID_EVENT"));

  if (typeof zlib.zstdCompressSync !== "function" || typeof zlib.zstdDecompressSync !== "function"
    || !Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) return;
  const fixture = makeDshZstdArtifact([[rows[0]], rows.slice(1, -1), [rows.at(-1)]]);
  const committedArtifact = Buffer.concat(fixture.frames.slice(0, -1));
  const finalFrame = fixture.frames.at(-1);
  for (let length = 1; length < finalFrame.length; length += 1) {
    const decoded = decodeDshArtifact(Buffer.concat([committedArtifact, finalFrame.subarray(0, length)]), {
      compressed: true,
    });
    assert.deepEqual(decoded.events, committedEvents, `proper final-frame prefix length ${length}`);
    assert.equal(decoded.incomplete, true, `proper final-frame prefix length ${length}`);
    assert.equal(decoded.diagnostics.incompleteReason, "open-turn", `proper final-frame prefix length ${length}`);
  }
  assert.throws(() => decodeDshArtifact(Buffer.concat([committedArtifact, Buffer.alloc(4)]), { compressed: true }),
    stableError("DSH_ZSTD_BAD_MAGIC"));
  const checksumCorrupt = Buffer.from(finalFrame);
  checksumCorrupt[checksumCorrupt.length - 1] ^= 0xFF;
  assert.throws(() => decodeDshArtifact(Buffer.concat([committedArtifact, checksumCorrupt]), { compressed: true }),
    stableError("DSH_ZSTD_DECOMPRESSION_FAILED"));
});

test("all three pinned packed rows expand losslessly and malformed packed shapes fail closed", () => {
  const header = makeDshHeader({ parentSession: undefined, seedLength: undefined, origin: undefined,
    delegationDepth: 0, agentPreset: undefined });
  const storage = makePackedDshStorageRows().map((row) => ({ ...row, seq0: row.seq0 + 2 }));
  const logical = storage.flatMap(decodePackedDshStorageRecordForFixture);
  const decoded = decodeDshJsonl(encodeDshRawJsonl([
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: header.createdAt + 900 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: header.createdAt + 950 }),
    ...storage,
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 11, time: logical.at(-1).time + 1 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 12, time: logical.at(-1).time + 2 }),
  ]));
  const oracle = [decoded.events[0], decoded.events[1], ...logical, decoded.events.at(-2), decoded.events.at(-1)];
  assert.deepEqual(decoded.events, oracle);
  assert.equal(decoded.diagnostics.knownUnsupportedCount, 9);
  assert.deepEqual(decoded.diagnostics.knownUnsupportedTypes, ["assistant/chunk"]);
  assert.deepEqual(decoded.events.map((event) => event.seq), decoded.events.map((_, index) => index));
  for (const row of makeMalformedPackedDshStorageRows()) {
    const committedBoundary = makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 0 });
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([header, row, committedBoundary])),
      (error) => ["DSH_MALFORMED_PACKED_ROW", "DSH_UNSUPPORTED_PACKED_ROW"].includes(error?.code));
  }
});

test("alpha.1 storage provenance ranges expand before raw and zstd Session validation", () => {
  const rows = makeAlpha1PackedRangeRows();
  const raw = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.deepEqual(raw.events[11].sourceEventSeqs, [2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(raw.events.map((event) => event.seq), raw.events.map((_, index) => index));

  if (typeof zlib.zstdCompressSync !== "function" || typeof zlib.zstdDecompressSync !== "function"
    || !Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) return;
  const compressed = makeDshZstdArtifact([[rows[0]], rows.slice(1)]);
  const zstd = decodeDshArtifact(compressed.artifact, { compressed: true });
  assert.deepEqual(zstd.events, raw.events);
});

test("alpha.1 storage provenance accepts native mixed form while preserving scalar rc.2 order", () => {
  const ranged = makeSupportedDshSessionRows();
  ranged[5].sourceEventSeqs = [0, [1, 2]];
  assert.deepEqual(decodeDshJsonl(encodeDshRawJsonl(ranged)).events[4].sourceEventSeqs, [0, 1, 2]);

  const scalar = makeSupportedDshSessionRows();
  scalar[5].sourceEventSeqs = [2, 0];
  assert.deepEqual(decodeDshJsonl(encodeDshRawJsonl(scalar)).events[4].sourceEventSeqs, [2, 0]);
});

test("alpha.1 storage provenance ranges reject malformed or unsafe expansion", () => {
  const invalid = [
    [[2, 1]],
    [[1]],
    [[0, 1, 2]],
    [["0", 2]],
    [[0.5, 2]],
    [[[0, 1], 2]],
    [[0, 2], [2, 3]],
    [[2, 3], 0],
    [[0, 4]],
    [[0, Number.MAX_SAFE_INTEGER]],
  ];
  for (const sourceEventSeqs of invalid) {
    const rows = makeSupportedDshSessionRows();
    rows[5].sourceEventSeqs = sourceEventSeqs;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("pinned types.ts accepts all seven raw StreamChunk variants and accounts them as unsupported evidence", () => {
  const chunks = [
    { type: "block-start", index: 0, blockType: "text" },
    { type: "text-delta", index: 0, text: "visible" },
    { type: "reasoning-delta", index: 1, text: "reasoning" },
    { type: "tool-call-delta", index: 2, id: "raw-call", name: "fixture", argumentsDelta: "{}" },
    { type: "block-end", index: 2, block: { type: "tool-call", id: "raw-call", name: "fixture", arguments: "{}" } },
    { type: "usage", usage: { inputTokens: 3, outputTokens: 2, cacheWriteTokens: 1 } },
    { type: "finish", reason: { kind: "stop" }, replayState: { response: { id: "synthetic" }, blocks: [null] } },
  ];
  const decoded = decodeDshJsonl(encodeDshRawJsonl(rowsWithChunks(chunks)));
  assert.deepEqual(decoded.events.filter((event) => event.type === "assistant/chunk")
    .map((event) => event.data.chunk.type), chunks.map((chunk) => chunk.type));
  assert.equal(decoded.diagnostics.knownUnsupportedCount, chunks.length);
  assert.deepEqual(decoded.diagnostics.knownUnsupportedTypes, ["assistant/chunk"]);
});

test("pinned types.ts rejects extra, missing, and wrong-typed fields on every StreamChunk variant", () => {
  const cases = [
    [{ type: "block-start", index: 0, blockType: "text" }, "blockType", "index"],
    [{ type: "text-delta", index: 0, text: "x" }, "text", "index"],
    [{ type: "reasoning-delta", index: 0, text: "x" }, "text", "index"],
    [{ type: "tool-call-delta", index: 0, id: "c", argumentsDelta: "{}" }, "id", "index"],
    [{ type: "block-end", index: 0, block: { type: "text", text: "x" } }, "block", "index"],
    [{ type: "usage", usage: { inputTokens: 1, outputTokens: 1 } }, "usage", "usage"],
    [{ type: "finish", reason: { kind: "stop" } }, "reason", "reason"],
  ];
  for (const [chunk, required, typed] of cases) {
    const extra = { ...structuredClone(chunk), extra: true };
    const missing = structuredClone(chunk);
    delete missing[required];
    const wrong = structuredClone(chunk);
    wrong[typed] = null;
    for (const candidate of [extra, missing, wrong]) {
      assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rowsWithChunks([candidate]))),
        stableError("DSH_EVENT_SHAPE_DRIFT"));
    }
  }
});

test("pinned message.ts accepts every ContextFormed variant, model replayState, and all five content blocks", () => {
  const pluginSources = [
    { kind: "plugin", plugin: "fixture" },
    { kind: "plugin", plugin: "fixture", form: "instructions" },
    { kind: "plugin", plugin: "fixture", form: "catalog" },
    { kind: "plugin", plugin: "fixture", form: "snapshot", sections: [{ name: "state", text: "synthetic" }] },
    { kind: "plugin", plugin: "fixture", form: "notice", summary: "synthetic notice" },
    { kind: "plugin", plugin: "fixture", form: "relay" },
    { kind: "plugin", plugin: "fixture", form: "recall" },
  ];
  const header = makeDshHeader();
  const userEvents = pluginSources.map((source, seq) => makeDshEvent("user/message", {
    id: `context-${seq}`, role: "user", content: [{ type: "text", text: "synthetic" }], source,
  }, { seq, time: header.createdAt + seq + 1, surfaceOp: "append" }));
  assert.equal(decodeDshJsonl(encodeDshRawJsonl([header, ...userEvents])).events.length, pluginSources.length);

  const blocks = [
    { type: "text", text: "visible" },
    { type: "reasoning", text: "thought" },
    { type: "image", attachment: { attachmentId: "image-1", mediaType: "image/png", bytes: 10, width: 2, height: 3,
      name: "fixture.png" } },
    { type: "tool-call", id: "call-1", name: "fixture", arguments: "{}" },
    { type: "tool-result", toolCallId: "call-1", content: [{ type: "text", text: "done" }], isError: false },
  ];
  const rows = makeSupportedDshSessionRows();
  rows[5].data.message.content = blocks;
  rows[5].data.message.source.replayState = { response: { providerId: "synthetic" }, blocks: [null, null] };
  const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.deepEqual(decoded.events[4].data.message.content.map((block) => block.type),
    ["text", "reasoning", "image", "tool-call", "tool-result"]);
});

test("pinned message/content unions reject extra, missing, and wrong-typed fields for every variant", () => {
  const header = makeDshHeader();
  const sourceVariants = [
    { kind: "plugin", plugin: "fixture" },
    { kind: "plugin", plugin: "fixture", form: "instructions" },
    { kind: "plugin", plugin: "fixture", form: "catalog" },
    { kind: "plugin", plugin: "fixture", form: "snapshot", sections: [] },
    { kind: "plugin", plugin: "fixture", form: "notice", summary: "notice" },
    { kind: "plugin", plugin: "fixture", form: "relay" },
    { kind: "plugin", plugin: "fixture", form: "recall" },
  ];
  const decodeSource = (source) => decodeDshJsonl(encodeDshRawJsonl([header,
    makeDshEvent("user/message", { id: "source", role: "user", content: [], source },
      { seq: 0, time: header.createdAt + 1, surfaceOp: "append" })]));
  for (const source of sourceVariants) {
    const extra = { ...structuredClone(source), extra: true };
    const missing = structuredClone(source);
    delete missing.plugin;
    const wrong = { ...structuredClone(source), form: 42 };
    for (const candidate of [extra, missing, wrong]) {
      assert.throws(() => decodeSource(candidate), stableError("DSH_EVENT_SHAPE_DRIFT"));
    }
  }
  const invalidCoreSources = [
    { kind: "user", extra: true },
    { kind: "model", provider: "fixture", model: "model", extra: true },
    { kind: "model", provider: "fixture", replayState: {} },
    { kind: "tool", callId: "call", extra: true },
  ];
  assert.throws(() => decodeSource(invalidCoreSources[0]), stableError("DSH_EVENT_SHAPE_DRIFT"));
  for (const source of invalidCoreSources.slice(1, 3)) {
    const rows = makeSupportedDshSessionRows();
    rows[5].data.message.source = source;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
  const invalidTool = makeSupportedDshSessionRows();
  invalidTool[7].data.message.source = invalidCoreSources[3];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(invalidTool)), stableError("DSH_EVENT_SHAPE_DRIFT"));

  const blocks = [
    [{ type: "text", text: "x" }, "text", "text"],
    [{ type: "reasoning", text: "x" }, "text", "text"],
    [{ type: "image", attachment: { attachmentId: "i", mediaType: "image/webp", bytes: 1, width: 1, height: 1 } },
      "attachment", "attachment"],
    [{ type: "tool-call", id: "c", name: "t", arguments: "{}" }, "id", "arguments"],
    [{ type: "tool-result", toolCallId: "c", content: [] }, "toolCallId", "content"],
  ];
  const decodeBlock = (block) => decodeDshJsonl(encodeDshRawJsonl([header,
    makeDshEvent("user/message", { id: "block", role: "user", content: [block], source: { kind: "user" } },
      { seq: 0, time: header.createdAt + 1, surfaceOp: "append" })]));
  for (const [block, required, typed] of blocks) {
    const extra = { ...structuredClone(block), extra: true };
    const missing = structuredClone(block);
    delete missing[required];
    const wrong = structuredClone(block);
    wrong[typed] = null;
    for (const candidate of [extra, missing, wrong]) {
      assert.throws(() => decodeBlock(candidate), stableError("DSH_EVENT_SHAPE_DRIFT"));
    }
  }
});

test("pinned tool-result meta and internal error remain independent from model-facing isError", () => {
  const withMeta = makeSupportedDshSessionRows();
  withMeta[7].data.meta = { presentation: ["synthetic", 1, true, null] };
  assert.deepEqual(decodeDshJsonl(encodeDshRawJsonl(withMeta)).events[6].data.meta,
    { presentation: ["synthetic", 1, true, null] });

  const toolDeclaredOnly = makeSupportedDshSessionRows();
  delete toolDeclaredOnly[9].data.error;
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(toolDeclaredOnly)).events[8].data.message.content[0].isError, true);

  const internalOnly = makeSupportedDshSessionRows();
  internalOnly[7].data.error = { name: "InternalFailure", code: "INTERNAL_ONLY" };
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(internalOnly)).events[6].data.message.content[0].isError, false);

  const malformed = makeSupportedDshSessionRows();
  malformed[7].data.error = { name: "MissingCode" };
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(malformed)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  assert.equal(isDshJsonValue({ meta: undefined }), false);
  assert.equal(isDshJsonValue({ meta: Number.NaN }), false);
  assert.equal(isDshJsonValue(new Date(0)), false);
  const cyclic = {};
  cyclic.self = cyclic;
  assert.equal(isDshJsonValue(cyclic), false);
});

test("logical invariant resets step numbering per turn and mirrors tool repair semantics", () => {
  const header = makeDshHeader({ parentSession: undefined, seedLength: undefined, origin: undefined,
    delegationDepth: 0, agentPreset: undefined });
  const time = header.createdAt + 1_000;
  const twoTurns = [
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: time + 1 }),
    makeDshEvent("tool/call", { turn: 1, step: 1, callId: "unfinished", name: "fixture", arguments: "{}" },
      { seq: 2, time: time + 2 }),
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 3, time: time + 3 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 4, time: time + 4 }),
    makeDshEvent("turn/start", { turn: 2 }, { seq: 5, time: time + 5 }),
    makeDshEvent("step/start", { turn: 2, step: 1 }, { seq: 6, time: time + 6 }),
    makeDshEvent("tool/result", {
      turn: 2, step: 1,
      message: { id: "repair-result", role: "user", content: [{ type: "tool-result",
        toolCallId: "not-started", content: [], isError: true }], source: { kind: "tool", callId: "not-started" } },
      error: { name: "ToolNotStartedError", code: "TOOL_NOT_STARTED" },
    }, { seq: 7, time: time + 7, surfaceOp: "append" }),
    makeDshEvent("step/end", { turn: 2, step: 1 }, { seq: 8, time: time + 8 }),
    makeDshEvent("turn/end", { turn: 2, reason: { kind: "completed" } }, { seq: 9, time: time + 9 }),
  ];
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(twoTurns)).events.length, 10);
});

test("replace tool results require only the open turn and do not re-correlate a completed call", () => {
  const rows = makeSupportedDshSessionRows();
  const replacement = structuredClone(rows[7]);
  replacement.seq = 10;
  replacement.time = rows.at(-1).time - 1;
  replacement.data.message.content[0].content = [{ type: "text", text: "replacement content" }];
  replacement.sourceEventSeqs = [6];
  replacement.surfaceOp = { op: "replace", start: 6, end: 6 };
  rows.splice(rows.length - 1, 0, replacement);
  rows.at(-1).seq = 11;
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(rows)).events.at(-2).surfaceOp.op, "replace");
});

test("pinned surface.ts folds real nodes, complete provenance sets, and non-adjacent raw seqs", () => {
  const rows = makeSupportedDshSessionRows();
  const replacement = structuredClone(rows[3]);
  replacement.time = rows.at(-1).time - 1;
  replacement.data.id = "surface-replacement";
  replacement.sourceEventSeqs = [6, 4];
  replacement.surfaceOp = { op: "replace", start: 4, end: 6 };
  const decoded = decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(rows, [replacement])));
  assert.deepEqual(decoded.events.at(-2).sourceEventSeqs, [6, 4]);
});

test("pinned surface.ts rejects missing, reversed, removed, or non-surface replacement endpoints", () => {
  const base = makeSupportedDshSessionRows();
  const userReplacement = (op, sources) => {
    const event = structuredClone(base[3]);
    event.time = base.at(-1).time - 2;
    event.data.id = "surface-replacement";
    event.surfaceOp = op;
    event.sourceEventSeqs = sources;
    return event;
  };
  for (const event of [
    userReplacement({ op: "replace", start: 999, end: 999 }, [2]),
    userReplacement({ op: "replace", start: 4, end: 2 }, [2, 3, 4]),
    userReplacement({ op: "replace", start: 5, end: 5 }, [5]),
  ]) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [event]))),
      stableError("DSH_SURFACE_RANGE_INVALID"));
  }
  const first = userReplacement({ op: "replace", start: 2, end: 2 }, [2]);
  const second = userReplacement({ op: "replace", start: 2, end: 2 }, [2]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [first, second]))),
    stableError("DSH_SURFACE_RANGE_INVALID"));
});

test("pinned surface.ts requires complete, unique, earlier provenance with empty only for assistant", () => {
  const base = makeSupportedDshSessionRows();
  const replacement = structuredClone(base[3]);
  replacement.time = base.at(-1).time - 1;
  replacement.data.id = "surface-replacement";
  replacement.surfaceOp = { op: "replace", start: 2, end: 4 };
  replacement.sourceEventSeqs = [2, 4];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [replacement]))),
    stableError("DSH_SURFACE_PROVENANCE_INCOMPLETE"));

  for (const index of [3, 7]) {
    const empty = structuredClone(base);
    empty[index].sourceEventSeqs = [];
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(empty)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
  assert.deepEqual(decodeDshJsonl(encodeDshRawJsonl(base)).events[4].sourceEventSeqs, []);
});

test("pinned surface.ts tool-result replacement changes only one current result content", () => {
  const base = makeSupportedDshSessionRows();
  const toolReplacement = (target = 6) => {
    const event = structuredClone(base[7]);
    event.time = base.at(-1).time - 1;
    event.data.message.content[0].content = [{ type: "text", text: "rewritten" }];
    event.surfaceOp = { op: "replace", start: target, end: target };
    event.sourceEventSeqs = [target];
    return event;
  };
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [toolReplacement()]))));

  const nonToolTarget = toolReplacement(2);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [nonToolTarget]))),
    stableError("DSH_SURFACE_TOOL_REWRITE_INVALID"));
  const identityMutation = toolReplacement();
  identityMutation.data.message.id = "mutated-id";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [identityMutation]))),
    stableError("DSH_SURFACE_TOOL_REWRITE_INVALID"));
  const metaMutation = toolReplacement();
  metaMutation.data.meta = { changed: true };
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [metaMutation]))),
    stableError("DSH_SURFACE_TOOL_REWRITE_INVALID"));
});

test("known turn-scoped events are rejected outside an open turn", () => {
  const header = makeDshHeader();
  for (const type of ["todo/write", "request/header", "request/context"]) {
    const event = makeDshEvent(type, { synthetic: true }, { seq: 0, time: header.createdAt + 1 });
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([header, event])), stableError("DSH_EVENT_ORDER_INVALID"));
  }
});

test("all six terminal outcomes decode and malformed outcome drift fails closed", () => {
  for (const kind of ["completed", "aborted", "blocked", "error", "max-tokens", "interrupted"]) {
    const decoded = decodeDshJsonl(encodeDshRawJsonl(makeTerminalDshSessionRows(kind)));
    assert.equal(decoded.events.at(-1).data.reason.kind, kind);
  }
  const malformed = [
    { kind: "aborted", reason: { kind: "hook" } },
    { kind: "aborted", reason: { kind: "user", extra: true } },
    { kind: "error", error: { message: "missing code" } },
    { kind: "error", error: { message: "x", code: "X", extra: true } },
    { kind: "completed", extra: true },
  ];
  for (const reason of malformed) {
    const rows = makeTerminalDshSessionRows("completed");
    rows.at(-1).data.reason = reason;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("format guards reject negative zero and tool-result error shape drift", () => {
  for (const field of ["createdAt", "delegationDepth"]) {
    const rows = makeSupportedDshSessionRows();
    const bytes = encodeDshRawJsonl(rows);
    const text = bytes.toString("utf8").replace(new RegExp(`"${field}":\\d+`, "u"), `"${field}":-0`);
    assert.throws(() => decodeDshJsonl(Buffer.from(text, "utf8")), stableError("DSH_INVALID_HEADER"));
  }
  const rows = makeSupportedDshSessionRows();
  rows[9].data.error.extra = true;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
});

test("pinned format accepts empty agent preset and injectively encodes NUL session ids", () => {
  const rows = makeOpenTurnDshRows({ sessionId: "nul\0session", agentPreset: "" });
  const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.equal(decoded.header.id, "nul\0session");
  assert.equal(decoded.header.agentPreset, "");
});

test("header lineage accepts seed parent independently of depth but pins origin discriminator", () => {
  const parentAtDepthZero = makeDshHeader({ delegationDepth: 0, origin: "subagent" });
  const rows = makeOpenTurnDshRows({ delegationDepth: 0, origin: "subagent" });
  rows[0] = parentAtDepthZero;
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(rows)).header.parentSession, parentAtDepthZero.parentSession);
  const invalidOrigin = structuredClone(rows);
  invalidOrigin[0].origin = "invented-origin";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(invalidOrigin)), stableError("DSH_INVALID_HEADER"));
});

test("surface records require exact correlation, causal source references, and surface operations", () => {
  const rows = makeSupportedDshSessionRows();
  for (const index of [3, 4, 7]) {
    const malformed = structuredClone(rows);
    delete malformed[index].surfaceOp;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(malformed)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
  const futureSource = structuredClone(rows);
  futureSource[5].sourceEventSeqs = [futureSource[5].seq];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(futureSource)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const duplicateSource = structuredClone(rows);
  duplicateSource[5].sourceEventSeqs = [0, 0];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(duplicateSource)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const mismatchedResult = structuredClone(rows);
  mismatchedResult[7].data.message.content[0].toolCallId = "different-call";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(mismatchedResult)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const independentToolError = structuredClone(rows);
  delete independentToolError[9].data.error;
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(independentToolError)).events[8].data.message.content[0].isError, true);
});

test("header, format, sequence, identity, project key, raw syntax, and unknown-required defects are rejected", async () => {
  const directCases = [
    [makeBadVersionDshRows(), "DSH_UNSUPPORTED_SESSION_FORMAT"],
    [makeBadHeaderDshRows(), "DSH_INVALID_HEADER"],
    [makeBadSequenceDshRows(), "DSH_INVALID_EVENT"],
  ];
  for (const [rows, code] of directCases) assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError(code));
  const malformedTail = decodeDshJsonl(makeMalformedDshJsonlBytes());
  assert.equal(malformedTail.events.length, 0);
  assert.equal(malformedTail.incomplete, true);
  assert.equal(malformedTail.diagnostics.incompleteReason, "crash-tail");
  const valid = encodeDshRawJsonl(makeSupportedDshSessionRows());
  const withoutFinalNewline = decodeDshJsonl(valid.subarray(0, -1));
  assert.deepEqual(withoutFinalNewline.events, decodeDshJsonl(encodeDshRawJsonl(makeSupportedDshSessionRows().slice(0, -1))).events);
  assert.equal(withoutFinalNewline.incomplete, true);
  const blankTail = decodeDshJsonl(Buffer.concat([valid.subarray(0, valid.length - 1), Buffer.from("\n\n")]));
  assert.equal(blankTail.incomplete, true);
  assert.equal(blankTail.diagnostics.incompleteReason, "crash-tail");
  const unknownRows = appendEvent(makeSupportedDshSessionRows(), makeUnknownRequiredDshEvent({ seq: 10 }));
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(unknownRows)), stableError("DSH_UNKNOWN_REQUIRED_EVENT"));

  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const identity = makeBadIdentityDshFixture({ artifactSessionId: "path-id", workspace });
  await writeNestedDshArtifact({ dshHome: home, rows: identity.rows, sessionId: identity.artifactSessionId });
  const wrongProjectRows = makeSupportedDshSessionRows({ workspace, sessionId: "bad-project" });
  await writeNestedDshArtifact({ dshHome: home, rows: wrongProjectRows, projectSegment: "--wrong--" });
  const result = await inventory(home, workspace);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.warnings.filter((warning) => warning.code === "dsh-artifact-rejected").length, 2);
  assert.equal(result.warnings.some((warning) => warning.reason === "DSH_SESSION_ID_PATH_MISMATCH"), true);
  assert.equal(result.warnings.some((warning) => warning.reason === "DSH_PROJECT_KEY_MISMATCH"), true);
});

test("flat, wrong-depth, and dual-encoding layouts fail closed without hiding valid siblings", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const sessionsRoot = path.join(home, "sessions");
  await mkdir(sessionsRoot, { recursive: true });
  await writeFile(path.join(sessionsRoot, "session.jsonl"), encodeDshRawJsonl(makeSupportedDshSessionRows({ workspace })));
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "dual" });
  const dual = await writeNestedDshArtifact({ dshHome: home, rows });
  await writeFile(`${dual.filePath}.zstd`, Buffer.from("ambiguous"));
  const deep = path.join(sessionsRoot, fixtureProjectKey(workspace), encodeDshSessionIdSegment("too-deep"), "extra");
  await mkdir(deep, { recursive: true });
  await writeFile(path.join(deep, "session.jsonl"), encodeDshRawJsonl(rows));
  await writeNestedDshArtifact({ dshHome: home, rows: makeSupportedDshSessionRows({ workspace, sessionId: "valid-sibling" }) });
  const result = await inventory(home, workspace);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["valid-sibling"]);
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-flat-artifact-rejected"), true);
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-wrong-depth-rejected"), true);
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-ambiguous-artifact-rejected"), true);
});

test("DSH discovery does not admit project or session directory symlinks escaping the sessions root", async () => {
  const root = await tempRoot("dsh-containment-");
  for (const level of ["project", "session"]) {
    const workspace = path.join(root, `${level}-workspace`);
    const home = path.join(root, `${level}-home`);
    const outsideHome = path.join(root, `${level}-outside`);
    const sessionId = `${level}-escape`;
    const written = await writeNestedDshArtifact({
      dshHome: outsideHome,
      rows: makeSupportedDshSessionRows({ workspace, sessionId }),
    });
    const outsideSession = path.dirname(written.filePath);
    const outsideProject = path.dirname(outsideSession);
    const sessionsRoot = path.join(home, "sessions");
    await mkdir(sessionsRoot, { recursive: true });

    if (level === "project") {
      await symlink(outsideProject, path.join(sessionsRoot, path.basename(outsideProject)), SYMLINK_TYPE);
    } else {
      const project = path.join(sessionsRoot, path.basename(outsideProject));
      await mkdir(project, { recursive: true });
      await symlink(outsideSession, path.join(project, path.basename(outsideSession)), SYMLINK_TYPE);
    }

    const result = await inventory(home, workspace);
    assert.equal(result.sessions.length, 0, level);
    assert.equal(JSON.stringify(result).includes(outsideHome), false, level);
  }
});

test("known unsupported and unknown ignorable events are accounted, while open turns are admitted incomplete", async () => {
  const known = decodeDshJsonl(encodeDshRawJsonl(makeKnownUnsupportedDshSessionRows()));
  assert.deepEqual(known.diagnostics.knownUnsupportedTypes, ["todo/write"]);
  assert.equal(known.diagnostics.knownUnsupportedCount, 1);
  const base = makeSupportedDshSessionRows();
  const ignorable = appendEvent(base, makeUnknownIgnorableDshEvent({ seq: 10 }));
  const decodedIgnorable = decodeDshJsonl(encodeDshRawJsonl(ignorable));
  assert.equal(decodedIgnorable.diagnostics.unknownIgnorableTypes.length, 1);
  assert.match(decodedIgnorable.diagnostics.unknownIgnorableTypes[0], /^unknown:[0-9a-f]{12}$/u);
  assert.equal(decodedIgnorable.events.some((event) => event.type === "fixture-future/ignorable"), true);

  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const written = await writeNestedDshArtifact({ dshHome: home,
    rows: makeOpenTurnDshRows({ workspace, sessionId: "open-turn" }) });
  const before = await readFile(written.filePath);
  const result = await inventory(home, workspace);
  assert.equal(result.sessions[0].incomplete, true);
  assert.equal(result.sessions[0].diagnostics.incompleteReason, "open-turn");
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-incomplete-session"), true);
  assert.deepEqual(await readFile(written.filePath), before);
});

test.each([
  "model/selection",
  "session-log-deepseek/delivery-accepted",
  "subagent/model-selection-policy",
])("alpha.1 required metadata event %s is validated and accounted without normalization", async (type) => {
  const base = makeSupportedDshSessionRows();
  const turnEnd = base.at(-1);
  const event = makeAlpha1MetadataEvent(type, base[0], turnEnd.seq, turnEnd.time - 1);
  const rows = appendEvent(base, event);
  const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.equal(decoded.events.some((candidate) => candidate.type === type), true);
  assert.equal(decoded.diagnostics.knownUnsupportedTypes.includes(type), true);

  const root = await tempRoot("dsh-alpha1-metadata-");
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  rows[0].cwd = workspace;
  await writeNestedDshArtifact({ dshHome: home, rows });
  const { analyzer, scope, sessions } = await inventory(home, workspace);
  const normalized = await analyzer.readSession(sessions[0], scope);
  assert.equal(normalized.some((candidate) => candidate.nativeType === type), false);
});

test.each([
  ["model/selection", { provider: "fixture-provider" }],
  ["session-log-deepseek/delivery-accepted", { sessionId: "", throughSeq: 0 }],
  ["subagent/model-selection-policy", { allowedModels: [] }],
])("alpha.1 required metadata event %s rejects malformed payloads", (type, data) => {
  const base = makeSupportedDshSessionRows();
  const turnEnd = base.at(-1);
  const rows = appendEvent(base, makeDshEvent(type, data, { seq: turnEnd.seq, time: turnEnd.time - 1 }));
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
});

test.each([
  ["foreign non-inherited session", (header, seq) => ({ sessionId: `${header.id}-foreign`, throughSeq: seq - 1 })],
  ["equal watermark", (header, seq) => ({ sessionId: header.id, throughSeq: seq })],
  ["future watermark", (header, seq) => ({ sessionId: header.id, throughSeq: seq + 1 })],
])("alpha.1 delivery marker rejects %s", (_case, makeData) => {
  const base = makeSupportedDshSessionRows({ parentSession: undefined, seedLength: undefined,
    origin: undefined, delegationDepth: 0 });
  const turnEnd = base.at(-1);
  const event = makeDshEvent("session-log-deepseek/delivery-accepted", makeData(base[0], turnEnd.seq), {
    seq: turnEnd.seq, time: turnEnd.time - 1,
  });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(appendEvent(base, event))),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("alpha.1 delivery marker accepts inherited parent identity before seedLength", () => {
  const rows = makeSupportedDshSessionRows({ sessionId: "fixture-child", parentSession: "fixture-parent",
    seedLength: 2, origin: "subagent", delegationDepth: 1 });
  rows.splice(2, 0, makeDshEvent("session-log-deepseek/delivery-accepted", {
    sessionId: rows[0].parentSession,
    throughSeq: 0,
  }, { seq: 1, time: rows[1].time + 1 }));
  rows.slice(1).forEach((event, index) => { event.seq = index; });
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(rows)));
});

test("alpha.1 model-selection policy rejects duplicate provider and model routes", () => {
  const base = makeSupportedDshSessionRows();
  const turnEnd = base.at(-1);
  const route = { provider: "fixture-provider", model: "fixture-model" };
  const event = makeDshEvent("subagent/model-selection-policy", {
    allowedModels: [route, { ...route }],
  }, { seq: turnEnd.seq, time: turnEnd.time - 1 });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(appendEvent(base, event))),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
});

test("alpha.1 compatibility keeps truly unknown required events fail closed", () => {
  const base = makeSupportedDshSessionRows();
  const turnEnd = base.at(-1);
  const rows = appendEvent(base, makeUnknownRequiredDshEvent({ seq: turnEnd.seq, time: turnEnd.time - 1 }));
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_UNKNOWN_REQUIRED_EVENT"));
});

test("unknown ignorable events accept every JSON data class without projecting their payloads", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const values = [null, false, true, 0, 7, "future-string", ["future-array"], { future: "object" }];
  const rows = insertBeforeTurnEnd(makeSupportedDshSessionRows({ workspace, sessionId: "json-ignorable" }),
    values.map((data, index) => makeDshEvent(`fixture-future/json-${index}`, data, { ignorable: true })));

  const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
  const unknown = decoded.events.filter((event) => event.type.startsWith("fixture-future/json-"));
  assert.equal(decoded.diagnostics.unknownIgnorableCount, values.length);
  assert.deepEqual(unknown.map((event) => event.data), values);

  await writeNestedDshArtifact({ dshHome: home, rows });
  const { analyzer, scope, sessions } = await inventory(home, workspace);
  const normalized = await analyzer.readSession(sessions[0], scope);
  const unknownSeqs = new Set(unknown.map((event) => event.seq));
  assert.equal(normalized.some((event) => unknownSeqs.has(event.nativeSeq)), false);
  assert.equal(JSON.stringify(normalized).includes("future-string"), false);
});

test("RC8 interrupted assistant messages accept only the optional literal true marker", () => {
  const valid = makeRc8InterruptedDshSessionRows();
  const decoded = decodeDshJsonl(encodeDshRawJsonl(valid));
  assert.equal(decoded.events.find((event) => event.type === "assistant/message").data.interrupted, true);

  for (const value of [false, "true", 1]) {
    const rows = makeRc8InterruptedDshSessionRows();
    rows.find((event) => event.type === "assistant/message").data.interrupted = value;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)),
      stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("RC8 team events validate all four strict payloads and remain account-only", () => {
  const rows = makeRc8TeamDshSessionRows();
  const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.deepEqual(decoded.events.map((event) => event.type), [
    "team/member", "team/task", "team/message/queued", "team/message/delivered",
  ]);
  assert.deepEqual(decoded.diagnostics.knownUnsupportedTypes, [
    "team/member", "team/message/delivered", "team/message/queued", "team/task",
  ]);
  assert.equal(decoded.diagnostics.knownUnsupportedCount, 4);

  const malformed = [
    (events) => { events[1].data.member.name = 42; },
    (events) => { events[2].data.task.revision = 0; },
    (events) => { events[3].data.message.delivery = "immediate"; },
    (events) => { delete events[4].data.messageId; },
    (events) => { events[1].data.extra = true; },
    (events) => { events[3].data.message.content[0].extra = true; },
  ];
  for (const mutate of malformed) {
    const candidate = makeRc8TeamDshSessionRows();
    mutate(candidate);
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(candidate)),
      stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("RC8 team fold enforces member, task, and mailbox relationships", () => {
  const invalidCases = [
    (rows) => { rows[1].data.member.phase = "active"; },
    (rows) => { rows[2].data.task.revision = 2; },
    (rows) => { rows[2].data.task.blockedBy = ["task-404"]; },
    (rows) => { rows[4].data.targetId = "different-target"; },
    (rows) => { [rows[3], rows[4]] = [rows[4], rows[3]]; },
  ];
  for (const mutate of invalidCases) {
    const rows = makeRc8TeamDshSessionRows();
    mutate(rows);
    rows.slice(1).forEach((event, index) => { event.seq = index; });
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)),
      stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  }

  const foreign = makeRc8TeamDshSessionRows();
  for (const event of foreign.slice(1)) event.data.teamId = "inherited-team-root";
  foreign[1].data.member.phase = "active";
  foreign[2].data.task.revision = 9;
  foreign[4].data.targetId = "different-target";
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(foreign)));
});

test("pinned types.ts validates todo, request context, and end-seed payloads before accounting", () => {
  const base = makeSupportedDshSessionRows();
  const validEvents = [
    makeDshEvent("todo/write", {
      todos: [
        { content: "Inspect contract", status: "pending" },
        { content: "Implement validator", status: "in_progress" },
        { content: "Review evidence", status: "completed" },
      ],
    }),
    requestHeaderEvent({ config: { provider: "synthetic", model: "fixture" } }),
    makeDshEvent("request/context", { provider: "synthetic", model: "fixture", contextWindow: 128_000 }),
    makeDshEvent("session/end-seed", {}),
  ];
  const decoded = decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, validEvents)));
  assert.deepEqual(decoded.diagnostics.knownUnsupportedTypes,
    ["request/context", "request/header", "session/end-seed", "todo/write"]);

  const malformedTodos = [
    {},
    { todos: [], extra: true },
    { todos: "not-an-array" },
    { todos: [{}] },
    { todos: [{ content: 7, status: "pending" }] },
    { todos: [{ content: "x", status: "started" }] },
    { todos: [{ content: "x", status: "pending", extra: true }] },
  ];
  for (const data of malformedTodos) {
    const rows = insertBeforeTurnEnd(base, [makeDshEvent("todo/write", data)]);
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("the complete pinned known-event catalog rejects malformed payloads instead of accepting names alone", () => {
  const base = makeSupportedDshSessionRows();
  for (const type of PINNED_KNOWN_EVENT_TYPES) {
    const rows = insertBeforeTurnEnd(base, [makeDshEvent(type, { malformed: true })]);
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), `${type} accepted malformed required data`);
  }
});

test("pinned request headers validate initial, resume, and changed snapshots", () => {
  const base = makeSupportedDshSessionRows();
  const initial = insertRequestHeader(base, requestHeaderEvent());
  assert.equal(decodeDshJsonl(encodeDshRawJsonl(initial)).diagnostics.knownUnsupportedTypes
    .includes("request/header"), true);
  const secondResume = insertBeforeTurnEnd(base, [requestHeaderEvent(), requestHeaderEvent({ reason: "resume" })]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(secondResume)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const changed = insertBeforeTurnEnd(base, [
    requestHeaderEvent(),
    requestHeaderEvent({ reason: "change", config: { provider: "fixture-provider", model: "fixture-model-2" } }),
  ]);
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(changed)));
  const emptyOptional = requestHeaderEvent({
    config: { provider: "", model: "" }, adapterDefaults: {}, system: "", tools: [],
  });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertRequestHeader(base, emptyOptional))),
    stableError("DSH_EVENT_SHAPE_DRIFT"));

  const full = requestHeaderEvent({
    reason: "initial",
    config: {
      provider: "fixture-provider",
      model: "fixture-model",
      reasoningEffort: "high",
      temperature: 0.25,
      maxTokens: 4_096,
      stop: ["STOP", "DONE"],
    },
    adapterDefaults: { reasoningEffort: true, maxTokens: true },
    system: `System metadata ${DSH_FIXTURE_SECRET}`,
    tools: [{
      name: "read_file",
      description: `Tool metadata ${DSH_FIXTURE_SECRET}`,
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
    }],
  });
  const decoded = decodeDshJsonl(encodeDshRawJsonl(insertRequestHeader(base, full)));
  assert.equal(decoded.events.find((event) => event.type === "request/header").data.header.system,
    `System metadata ${DSH_FIXTURE_SECRET}`);
  assert.equal(JSON.stringify(decoded.diagnostics).includes(DSH_FIXTURE_SECRET), false);
});

test("pinned headless snapshot-like base flow decodes all required writer records account-only", () => {
  const decoded = decodeDshJsonl(encodeDshRawJsonl(makeNativeSnapshotDshSessionRows()));
  assert.equal(decoded.incomplete, false);
  assert.deepEqual(decoded.events.map((event) => event.seq), Array.from({ length: 32 }, (_value, index) => index));
  for (const type of ["permission/preset", "sandbox/mode", "approval/policy", "agent/inbox/spliced",
    "session/title", "request/header", "request/context", "session/title-llm-request"]) {
    assert.equal(decoded.diagnostics.knownUnsupportedTypes.includes(type), true, type);
  }
});

test("pinned fork snapshot admits a turn-2 descriptor before the resumed lifecycle request", () => {
  const base = makeNativeSnapshotDshSessionRows();
  // The persisted end-seed marker is at seq 32, while this resume's actual live boundary is seq 33.
  base[0].seedLength = base.length - 1;
  base[0].parentSession = "fixture-parent";
  base[0].origin = "subagent";
  base[0].delegationDepth = 1;
  const events = base.slice(1);
  const push = (type, data, extra = {}) => events.push(makeDshEvent(type, data, {
    seq: events.length, time: base[0].createdAt + 5_000 + events.length, ...extra,
  }));
  const message = {
    id: "fixture-fork-user", role: "user", content: [{ type: "text", text: "Resume the child." }],
    source: { kind: "user" },
  };
  push("session/end-seed", {});
  push("subagent/descriptor", {
    version: 2, mode: "continuable", provider: "fork", label: "Synthetic child",
  });
  push("approval/policy", { policy: "never", source: "delegation" });
  push("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [message] });
  push("turn/start", { turn: 2 });
  push("agent/inbox/spliced", { target: "next-turn", start: 0, removedCount: 1, inserted: [] });
  push("step/start", { turn: 2, step: 1 });
  push("user/message", message, { surfaceOp: "append" });
  push("request/header", {
    header: { config: { provider: "fixture-provider", model: "fixture-model", reasoningEffort: "off" } },
    reason: "resume",
  });
  push("request/context", { provider: "fixture-provider", model: "fixture-model" });
  push("step/end", { turn: 2, step: 1 });
  push("turn/end", { turn: 2, reason: { kind: "completed" } });
  const decoded = decodeDshJsonl(encodeDshRawJsonl([base[0], ...events]));
  assert.equal(decoded.incomplete, false);
  assert.equal(decoded.diagnostics.knownUnsupportedTypes.includes("subagent/descriptor"), true);
});

test("pinned inbox replay starts at header seedLength and reports only live pending input", () => {
  const header = makeDshHeader({ seedLength: 1 });
  const message = {
    id: "fixture-seed-pending", role: "user", content: [{ type: "text", text: "Seed input." }],
    source: { kind: "user" },
  };
  const seedOnly = [
    header,
    makeDshEvent("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [message] }, { seq: 0 }),
    makeDshEvent("session/end-seed", {}, { seq: 1 }),
  ];
  const decodedSeed = decodeDshJsonl(encodeDshRawJsonl(seedOnly));
  assert.equal(decodedSeed.incomplete, false);
  assert.equal(decodedSeed.diagnostics.pendingInboxMessageCount, undefined);

  const livePending = structuredClone(seedOnly);
  livePending.push(makeDshEvent("agent/inbox/spliced", {
    target: "next-step", start: 0, inserted: [{ ...message, id: "fixture-live-pending" }],
  }, { seq: 2 }));
  const decodedLive = decodeDshJsonl(encodeDshRawJsonl(livePending));
  assert.equal(decodedLive.incomplete, true);
  assert.equal(decodedLive.diagnostics.incompleteReason, "pending-inbox");
  assert.equal(decodedLive.diagnostics.pendingInboxMessageCount, 1);

  const badBounds = structuredClone(seedOnly);
  badBounds.push(makeDshEvent("agent/inbox/spliced", {
    target: "next-turn", start: 1, inserted: [],
  }, { seq: 2 }));
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badBounds)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("pinned request and title relationships reject drift while allowing an auxiliary title route", () => {
  const base = makeSupportedDshSessionRows();
  const initial = requestHeaderEvent();
  const alternateTitle = makeDshEvent("session/title-llm-request", {
    titleProvider: "fixture-title-provider",
    messageSeqs: [2],
    route: { provider: "aux-provider", model: "aux-model" },
    system: "private title system",
    messages: [{
      id: "fixture-title-message", role: "user", content: [{ type: "text", text: "private title prompt" }],
      source: { kind: "plugin", plugin: "fixture-title" },
    }],
    maxTokens: 32,
  });
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, [initial, alternateTitle]))));

  const noHeaderContext = insertBeforeTurnEnd(base, [
    makeDshEvent("request/context", { provider: "fixture-provider", model: "fixture-model" }),
  ]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(noHeaderContext)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const mismatch = insertBeforeTurnEnd(base, [initial,
    makeDshEvent("request/context", { provider: "other", model: "fixture-model" })]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(mismatch)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  for (const headers of [
    [requestHeaderEvent({ reason: "resume" })],
    [initial, requestHeaderEvent()],
    [initial, requestHeaderEvent({ reason: "change" })],
  ]) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, headers))),
      stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  }

  const extraHuman = {
    id: "fixture-second-human", role: "user", content: [{ type: "text", text: "Second human prompt." }],
    source: { kind: "user" },
  };
  const reversedTitle = insertBeforeTurnEnd(base, [
    makeDshEvent("user/message", extraHuman, { surfaceOp: "append" }),
    makeDshEvent("session/title", {
      title: "Synthetic provider title", messageSeqs: [10, 2], source: { kind: "provider", provider: "fixture" },
    }),
  ]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(reversedTitle)),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
  const invalidFallback = insertBeforeTurnEnd(base, [makeDshEvent("session/title", {
    title: "Invalid fallback", messageSeqs: [3], source: { kind: "fallback" },
  })]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(invalidFallback)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("pinned descriptor and inbox relations reject duplicate, late, and cross-queue identity drift", () => {
  const header = makeDshHeader({ seedLength: undefined });
  const descriptor = {
    version: 2, mode: "continuable", provider: "fixture", label: "Synthetic child",
    agentProvider: "fixture-provider", agentModel: "fixture-model", persona: "Synthetic persona",
    toolFilter: { allow: ["read_file"], deny: ["shell_exec"] },
  };
  const fresh = [header,
    makeDshEvent("subagent/descriptor", descriptor, { seq: 0 }),
    makeDshEvent("turn/start", { turn: 1 }, { seq: 1 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 2 })];
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(fresh)));
  const duplicate = [
    header,
    makeDshEvent("subagent/descriptor", descriptor, { seq: 0 }),
    makeDshEvent("subagent/descriptor", descriptor, { seq: 1 }),
  ];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(duplicate)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const late = [
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1 }),
    requestHeaderEvent(),
    makeDshEvent("subagent/descriptor", descriptor, { seq: 3 }),
    makeDshEvent("step/end", { turn: 1, step: 1 }, { seq: 4 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 5 }),
  ];
  late.slice(1).forEach((event, index) => { event.seq = index; });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(late)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));

  const message = {
    id: "duplicate-pending", role: "user", content: [{ type: "text", text: "Synthetic pending." }],
    source: { kind: "user" },
  };
  const duplicateInbox = [
    header,
    makeDshEvent("agent/inbox/spliced", { target: "next-turn", start: 0, inserted: [message] }, { seq: 0 }),
    makeDshEvent("agent/inbox/spliced", { target: "next-step", start: 0, inserted: [message] }, { seq: 1 }),
  ];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(duplicateInbox)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const invalidCanceled = [header,
    makeDshEvent("agent/inbox/spliced", {
      target: "next-turn", start: 0, inserted: [], outcome: "canceled",
    }, { seq: 0 })];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(invalidCanceled)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));

  const seededDescriptor = [
    makeDshHeader({ seedLength: 3 }),
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0 }),
    makeDshEvent("subagent/descriptor", { version: 2, mode: "one-shot", provider: "fixture" }, { seq: 1 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }, { seq: 2 }),
    makeDshEvent("session/end-seed", {}, { seq: 3 }),
    makeDshEvent("subagent/descriptor", descriptor, { seq: 4 }),
    makeDshEvent("turn/start", { turn: 2 }, { seq: 5 }),
    makeDshEvent("turn/end", { turn: 2, reason: { kind: "completed" } }, { seq: 6 }),
  ];
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(seededDescriptor)));
  const duplicateOwn = structuredClone(seededDescriptor);
  duplicateOwn.splice(6, 0, makeDshEvent("subagent/descriptor", descriptor, { seq: 6 }));
  duplicateOwn.slice(1).forEach((event, index) => { event.seq = index; });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(duplicateOwn)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("pinned end-seed lifecycle requires initial or resume first and change only afterward", () => {
  const header = makeDshHeader({ seedLength: 6 });
  const events = [
    makeDshEvent("turn/start", { turn: 1 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }),
    requestHeaderEvent(),
    makeDshEvent("step/end", { turn: 1, step: 1 }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }),
    makeDshEvent("session/end-seed", {}),
    makeDshEvent("session/end-seed", {}),
    makeDshEvent("turn/start", { turn: 2 }),
    makeDshEvent("step/start", { turn: 2, step: 1 }),
    requestHeaderEvent({ reason: "resume" }),
    makeDshEvent("step/end", { turn: 2, step: 1 }),
    makeDshEvent("turn/end", { turn: 2, reason: { kind: "completed" } }),
  ];
  events.forEach((event, index) => { event.seq = index; event.time += index; });
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl([header, ...events])));

  const firstLiveChange = structuredClone(events);
  firstLiveChange[9].data.reason = "change";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([header, ...firstLiveChange])),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const secondResume = structuredClone(events);
  secondResume.splice(10, 0, requestHeaderEvent({ reason: "resume" }));
  secondResume.forEach((event, index) => { event.seq = index; });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([header, ...secondResume])),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("pinned common writer records use exact account-only payload validators", () => {
  const time = Date.parse("2026-08-18T00:00:00.000Z");
  const cases = [
    ["agent-preset/selected", { agentPreset: "minimal" }],
    ["feedback/record", { text: "synthetic feedback" }],
    ["goal/change", {
      kind: "goal/change", version: 1, operation: "create",
      goal: { id: "goal-1", revision: 1, objective: "Synthetic goal", phase: "active", maxGoalRounds: 3 },
      roundsStarted: 0, createdAt: time, updatedAt: time,
    }],
    ["plan/mode", { active: true }],
    ["todo/write", { todos: [{ content: "Synthetic task", status: "pending" }] }],
    ["schedule/change", {
      version: 1, operation: "create", schedule: {
        id: "schedule-1", kind: "after", prompt: "Synthetic reminder", afterSeconds: 60,
        scheduledAt: "2026-08-19T00:00:00.000Z",
      },
    }],
    ["web/deepseek-search-llm-request", {
      endpoint: "https://api.deepseek.com/anthropic/v1/messages",
      apiVersion: "2023-06-01",
      body: {
        model: "deepseek-v4-flash", max_tokens: 4_096,
        messages: [{ role: "user", content: [{ type: "text", text: "Synthetic search" }] }],
        tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      },
    }],
    ["session/end-seed", {}],
  ];
  const base = makeSupportedDshSessionRows();
  for (const [type, data] of cases) {
    const rows = insertBeforeTurnEnd(base, [makeDshEvent(type, data)]);
    const decoded = decodeDshJsonl(encodeDshRawJsonl(rows));
    assert.equal(decoded.diagnostics.knownUnsupportedTypes.includes(type), true, type);
    const malformed = structuredClone(data);
    malformed.__extra = true;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(
      insertBeforeTurnEnd(base, [makeDshEvent(type, malformed)]))), `${type} accepted an extra payload key`);
  }
});

test("pinned MessageSourceMap extensions accept exact private context arms and reject union drift", () => {
  const base = makeSupportedDshSessionRows();
  const sources = [
    { kind: "plugin", plugin: "fixture-context" },
    { kind: "plugin", plugin: "fixture-context", form: "snapshot", sections: [{ name: "scope", text: "private" }] },
    { kind: "agent-instructions", form: "instructions", baseline: true, baselineIdentity: "private",
      changes: [{ action: "set", scope: "workspace", path: "AGENTS.md", digest: "private" }] },
    { kind: "session-reference", form: "recall", version: 1, references: [{
      sessionId: "private-session", label: "private-label", capturedThroughSeq: null, compacted: false,
      originalMessages: 2, retainedMessages: 1, omittedMessages: 1, omittedBytes: 12, truncated: true, inputIndex: 0,
    }] },
    { kind: "coordinator", form: "relay", senderSessionId: "private-parent" },
    { kind: "subagent-report", form: "relay", senderSessionId: "private-child" },
    { kind: "subagent-settled", form: "notice", summary: "private summary", senderSessionId: "private-child" },
    { kind: "skill-catalog", form: "catalog", update: true,
      entries: [{ name: "private-skill", description: "private description" }] },
    { kind: "skill-invocation", form: "instructions", name: "private-skill" },
  ];
  for (const source of sources) {
    const rows = structuredClone(base);
    rows[4].data.source = source;
    assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(rows)), source.kind);
    rows[4].data.source.extra = true;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(rows)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
  const apiHuman = structuredClone(base);
  apiHuman[3].data.source = { kind: "user", rpcId: "private-rpc", clientTimeZone: "Asia/Shanghai" };
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(apiHuman)));
  const badApiHuman = structuredClone(apiHuman);
  delete badApiHuman[3].data.source.rpcId;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badApiHuman)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const compactWithoutIdentity = structuredClone(base);
  compactWithoutIdentity[4].data.source = { kind: "plugin", plugin: "compact" };
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(compactWithoutIdentity)),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
});

test("pinned approval command hook workflow dispatch and retry folds admit one correlated stream", () => {
  const header = makeDshHeader({ seedLength: undefined });
  const events = [];
  const push = (type, data, extra = {}) => events.push(makeDshEvent(type, data, {
    seq: events.length, time: header.createdAt + events.length + 1, ...extra,
  }));
  push("turn/start", { turn: 1 });
  push("step/start", { turn: 1, step: 1 });
  push("request/header", {
    header: { config: { provider: "fixture-provider", model: "fixture-model" } }, reason: "initial",
  });
  push("approval/asked", { id: "approval-1", toolName: "bash", callId: "call-1" });
  push("approval/decided", { id: "approval-1", outcome: "allowed-once" });
  push("command/run", { commandId: "command-1", name: "review", source: { kind: "user" } });
  push("command/done", { commandId: "command-1", kind: "success", sourceEventSeq: 2 });
  push("hook/invoked", { turn: 1, point: "PreToolUse", dialect: "codex", handlerId: "hook-1" });
  push("hook/result", { turn: 1, point: "PreToolUse", handlerId: "hook-1", decision: "pass", durationMs: 0.5 });
  push("tool-workflow/run-start", { runId: "workflow-1", name: "review" });
  push("tool-workflow/agent-start", { runId: "workflow-1", seq: 1, label: "worker", childId: "child-1" });
  push("tool-workflow/agent-end", { runId: "workflow-1", seq: 1, outcome: "completed" });
  push("tool-workflow/run-end", { runId: "workflow-1", stopReason: "completed" });
  push("tool/code-dispatch-start", {
    rootCallId: "root", parentCallId: "root", subCallId: "child", name: "read", arguments: {},
  });
  push("tool/code-dispatch", {
    rootCallId: "root", parentCallId: "child", subCallId: "grandchild", name: "read", arguments: {},
    isError: false, content: [{ type: "text", text: "ok" }],
  });
  push("llm/retry", {
    retryId: "retry-1", turn: 1, step: 1, provider: "fixture-provider", mode: "normal",
    policyKey: "default", retry: 1, maxRetries: 2, delayMs: 12.5,
    failure: { message: "temporary", code: "TEMPORARY", status: 503, providerRetryAfterMs: 2.5,
      requestId: "request-1" },
  });
  push("llm/retry-started", { retryId: "retry-1", turn: 1, step: 1, retry: 1 });
  push("llm/retry", {
    retryId: "retry-1", turn: 1, step: 1, provider: "fixture-provider", mode: "normal",
    policyKey: "default", retry: 2, maxRetries: 2, delayMs: 0,
    failure: { message: "temporary", code: "TEMPORARY" },
  });
  push("llm/retry-started", { retryId: "retry-1", turn: 1, step: 1, retry: 2 });
  push("step/end", { turn: 1, step: 1 });
  push("turn/end", { turn: 1, reason: { kind: "completed" } });
  const valid = [header, ...events];
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(valid)));
  const corruptions = [
    (rows) => { rows.find((event) => event.type === "approval/decided").data.id = "missing"; },
    (rows) => { rows.find((event) => event.type === "command/done").data.kind = "error"; },
    (rows) => { rows.find((event) => event.type === "hook/result").data.handlerId = "missing"; },
    (rows) => {
      const endIndex = rows.findIndex((event) => event.type === "tool-workflow/run-end");
      const [end] = rows.splice(endIndex, 1);
      rows.splice(rows.findIndex((event) => event.type === "tool-workflow/agent-end"), 0, end);
    },
    (rows) => { rows.find((event) => event.type === "tool/code-dispatch").data.rootCallId = "other"; },
    (rows) => { rows.find((event) => event.type === "llm/retry").data.delayMs = 2_147_483_648; },
    (rows) => { rows.filter((event) => event.type === "llm/retry")[1].data.retry = 1; },
    (rows) => { rows.filter((event) => event.type === "llm/retry-started")[1].data.retry = 1; },
  ];
  for (const corrupt of corruptions) {
    const malformed = structuredClone(events);
    corrupt(malformed);
    malformed.forEach((event, index) => { event.seq = index; });
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([header, ...malformed])));
  }
});

test("pinned goal fold validates transitions and the exact rendered continuation prompt", () => {
  const header = makeDshHeader({ seedLength: undefined });
  const events = [];
  const push = (type, data, extra = {}) => events.push(makeDshEvent(type, data, {
    seq: events.length, time: header.createdAt + events.length + 1, ...extra,
  }));
  const snapshot = (revision, phase, extra = {}) => ({
    id: "goal-1", revision, objective: "Finish the synthetic objective", phase, maxGoalRounds: 3, ...extra,
  });
  const change = (operation, goal, updatedAt) => ({
    kind: "goal/change", version: 1, operation, goal, roundsStarted: operation === "create" ? 0 : 1,
    createdAt: 10, updatedAt,
  });
  push("goal/change", change("create", snapshot(1, "active"), 10));
  push("turn/start", { turn: 1 });
  push("user/message", {
    id: "goal-round", role: "user", source: { kind: "goal", goalId: "goal-1", revision: 1, round: 1 },
    content: [{ type: "text", text: "<goal_round>\nObjective: \"Finish the synthetic objective\"\nRound: 1/3\n\nContinue working toward the objective in this same session. Treat the current workspace, tool results, and durable session state as authoritative; inspect them instead of assuming earlier narration is still current. Make concrete progress and verify the result. Before claiming completion, gather evidence that the whole objective is achieved, read the current goal, and mark it complete. If work remains, leave the goal active for the next round. Follow the configured goal-tool policy before reporting a blocker.\n</goal_round>" }],
  }, { surfaceOp: "append" });
  push("turn/end", { turn: 1, reason: { kind: "completed" } });
  push("goal/change", change("edit", { ...snapshot(2, "active"), objective: "Finish the revised objective" }, 11));
  push("goal/change", change("pause", { ...snapshot(3, "paused"), objective: "Finish the revised objective" }, 12));
  push("goal/change", change("resume", { ...snapshot(4, "active"), objective: "Finish the revised objective" }, 13));
  push("goal/change", change("block", { ...snapshot(5, "blocked"), objective: "Finish the revised objective",
    blockedReason: { code: "needs-input", message: "Need synthetic input" } }, 14));
  push("goal/change", change("resume", { ...snapshot(6, "active"), objective: "Finish the revised objective" }, 15));
  push("goal/change", change("complete", { ...snapshot(7, "complete"), objective: "Finish the revised objective" }, 16));
  push("goal/change", {
    kind: "goal/change", version: 1, operation: "clear", cleared: { id: "goal-1", revision: 8 }, clearedAt: 17,
  });
  const valid = [header, ...events];
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(valid)));
  const counterfeit = structuredClone(valid);
  counterfeit[3].data.content[0].text = "counterfeit";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(counterfeit)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const badRevision = structuredClone(valid);
  badRevision[5].data.goal.revision = 4;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badRevision)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const badBlockCode = structuredClone(valid);
  badBlockCode[8].data.goal.blockedReason.code = "1invalid";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badBlockCode)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const badClear = structuredClone(valid);
  badClear.at(-1).data.cleared.id = "";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badClear)), stableError("DSH_EVENT_SHAPE_DRIFT"));

  const todoBase = makeSupportedDshSessionRows();
  for (const todos of [
    [{ content: " spaced", status: "pending" }],
    [{ content: "duplicate", status: "pending" }, { content: "duplicate", status: "completed" }],
    [{ content: "", status: "pending" }],
  ]) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(
      insertBeforeTurnEnd(todoBase, [makeDshEvent("todo/write", { todos })]))),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("pinned compaction fold accepts surface-order shadows and requires the adjacent checkpoint rewrite", () => {
  const header = makeDshHeader({ seedLength: undefined });
  const events = [];
  const push = (type, data, extra = {}) => events.push(makeDshEvent(type, data, {
    seq: events.length, time: header.createdAt + events.length + 1, ...extra,
  }));
  const message = (id, text, source = { kind: "user" }) => ({
    id, role: "user", content: [{ type: "text", text }], source,
  });
  push("turn/start", { turn: 1 });
  push("user/message", message("first", "first"), { surfaceOp: "append" });
  push("user/message", message("second", "second", { kind: "plugin", plugin: "fixture" }), {
    surfaceOp: "append",
  });
  push("user/message", message("first-rewrite", "first rewrite", { kind: "plugin", plugin: "fixture" }), {
    sourceEventSeqs: [1], surfaceOp: { op: "replace", start: 1, end: 1 },
  });
  push("compaction/start", { compactionId: "compact-1", turn: 1, sourceCommandId: "command-1" });
  push("compaction/summary", {
    compactionId: "compact-1", sourceCommandId: "command-1",
    summary: [{ type: "text", text: "summary" }], shadowedRange: { start: 3, end: 2 },
    shadowedSeqs: [3, 2], shadowedTokenCount: 2, provider: "fixture", model: "fixture",
  });
  push("user/message", message("checkpoint", "checkpoint", {
    kind: "plugin", plugin: "compact", compactionId: "compact-1", sourceCommandId: "command-1",
  }), { sourceEventSeqs: [4, 5, 3, 2], surfaceOp: { op: "replace", start: 3, end: 2 } });
  push("compaction/end", { compactionId: "compact-1", turn: 1, sourceCommandId: "command-1" });
  push("turn/end", { turn: 1, reason: { kind: "completed" } });
  const valid = [header, ...events];
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(valid)));

  const wrongCheckpointKind = structuredClone(valid);
  wrongCheckpointKind[7].data.source = { kind: "plugin", plugin: "fixture" };
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(wrongCheckpointKind)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const missingAdjacent = structuredClone(valid);
  missingAdjacent.splice(7, 0, makeDshEvent("plan/mode", { active: true }, { seq: 6 }));
  missingAdjacent.slice(1).forEach((event, index) => { event.seq = index; });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(missingAdjacent)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  const badEndpoint = structuredClone(valid);
  badEndpoint[6].data.shadowedRange.end = 3;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badEndpoint)),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  for (const sources of [[5, 3, 2], [5, 4, 3, 2], [4, 5, 3]]) {
    const badProvenance = structuredClone(valid);
    badProvenance[7].sourceEventSeqs = sources;
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badProvenance)),
      stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
  }
  const duplicate = structuredClone(valid);
  duplicate[6].data.shadowedSeqs = [3, 3];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(duplicate)), stableError("DSH_EVENT_SHAPE_DRIFT"));
  const emptySourceCommand = structuredClone(valid);
  emptySourceCommand[6].data.sourceCommandId = "";
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(emptySourceCommand)),
    stableError("DSH_EVENT_SHAPE_DRIFT"));

  const pruneHeader = makeDshHeader({ seedLength: undefined });
  const callId = "prune-call";
  const result = {
    turn: 1, step: 1,
    message: { id: "prune-result", role: "user", source: { kind: "tool", callId }, content: [{
      type: "tool-result", toolCallId: callId, content: [{ type: "text", text: "large result" }],
    }] },
  };
  const pruneEvents = [
    makeDshEvent("turn/start", { turn: 1 }),
    makeDshEvent("step/start", { turn: 1, step: 1 }),
    makeDshEvent("tool/call", { turn: 1, step: 1, callId, name: "read", arguments: "{}" }),
    makeDshEvent("tool/result", result, { surfaceOp: "append" }),
    makeDshEvent("step/end", { turn: 1, step: 1 }),
    makeDshEvent("compaction/prune", {
      shadowedRange: { start: 3, end: 3 }, shadowedSeqs: [3], shadowedTokenCount: 10,
    }),
    makeDshEvent("tool/result", {
      ...structuredClone(result),
      message: { ...structuredClone(result.message), content: [{
        type: "tool-result", toolCallId: callId, content: [{ type: "text", text: "pruned" }],
      }] },
    }, { sourceEventSeqs: [3], surfaceOp: { op: "replace", start: 3, end: 3 } }),
    makeDshEvent("turn/end", { turn: 1, reason: { kind: "completed" } }),
  ];
  pruneEvents.forEach((event, index) => { event.seq = index; event.time = pruneHeader.createdAt + index + 1; });
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl([pruneHeader, ...pruneEvents])));
  const wrongPruneType = structuredClone(pruneEvents);
  wrongPruneType[6] = makeDshEvent("user/message", message("wrong-prune", "wrong", {
    kind: "plugin", plugin: "fixture",
  }), { seq: 6, time: pruneHeader.createdAt + 7, sourceEventSeqs: [3],
    surfaceOp: { op: "replace", start: 3, end: 3 } });
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl([pruneHeader, ...wrongPruneType])),
    stableError("DSH_EVENT_RELATIONSHIP_INVALID"));
});

test("pinned schedule v1 enforces exact records and session-local transitions", () => {
  const base = makeSupportedDshSessionRows();
  const createAfter = makeDshEvent("schedule/change", {
    version: 1, operation: "create", schedule: {
      id: "schedule-after", kind: "after", prompt: "Synthetic reminder", afterSeconds: 60,
      scheduledAt: "2026-08-19T00:00:00.000Z",
    },
  });
  const dispatchAfter = makeDshEvent("schedule/change", { version: 1, operation: "dispatch", id: "schedule-after" });
  const createEvery = makeDshEvent("schedule/change", {
    version: 1, operation: "create", schedule: {
      id: "schedule-every", kind: "every", prompt: "Synthetic recurring reminder", everySeconds: 300,
      scheduledAt: "2026-08-19T00:00:00.000Z",
    },
  });
  const dispatchEvery = makeDshEvent("schedule/change", {
    version: 1, operation: "dispatch", id: "schedule-every", acceptedAt: "2026-08-19T00:05:00.000Z",
  });
  const deleteEvery = makeDshEvent("schedule/change", { version: 1, operation: "delete", id: "schedule-every" });
  const valid = insertBeforeTurnEnd(base, [createAfter, dispatchAfter, createEvery, dispatchEvery, deleteEvery]);
  assert.doesNotThrow(() => decodeDshJsonl(encodeDshRawJsonl(valid)));
  for (const events of [
    [dispatchAfter],
    [createAfter, createAfter],
    [createAfter, { ...dispatchAfter, data: { ...dispatchAfter.data, acceptedAt: "2026-08-19T00:00:00.000Z" } }],
    [createEvery, { ...dispatchEvery, data: { ...dispatchEvery.data, acceptedAt: undefined } }],
    [createEvery, { ...dispatchEvery, data: { ...dispatchEvery.data, acceptedAt: "2026-08-18T23:59:59.000Z" } }],
  ]) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertBeforeTurnEnd(base, events))));
  }
  const malformed = [
    { version: 2, operation: "delete", id: "schedule-1" },
    { version: 1, operation: "delete" },
    { version: 1, operation: "create", schedule: { id: "schedule-1", kind: "at", prompt: " x ", scheduledAt: "bad" } },
    { version: 1, operation: "create", schedule: {
      id: "schedule-1", kind: "every", prompt: "x", everySeconds: 299, scheduledAt: "2026-08-19T00:00:00.000Z",
    } },
  ];
  for (const data of malformed) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(
      insertBeforeTurnEnd(base, [makeDshEvent("schedule/change", data)]))),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("pinned DeepSeek search request rejects tuple and field drift without exposing request content", () => {
  const base = makeSupportedDshSessionRows();
  const valid = {
    endpoint: `https://example.invalid/${DSH_FIXTURE_SECRET}`,
    apiVersion: "2023-06-01",
    body: {
      model: "deepseek-v4-flash", max_tokens: 64,
      messages: [{ role: "user", content: [{ type: "text", text: DSH_FIXTURE_SECRET }] }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1 }],
    },
  };
  const decoded = decodeDshJsonl(encodeDshRawJsonl(
    insertBeforeTurnEnd(base, [makeDshEvent("web/deepseek-search-llm-request", valid)])));
  assert.equal(decoded.diagnostics.knownUnsupportedTypes.includes("web/deepseek-search-llm-request"), true);
  assert.equal(JSON.stringify(decoded.diagnostics).includes(DSH_FIXTURE_SECRET), false);
  const malformed = [];
  for (const mutate of [
    (data) => { delete data.endpoint; },
    (data) => { data.extra = true; },
    (data) => { data.body.max_tokens = 0; },
    (data) => { data.body.messages = []; },
    (data) => { data.body.messages[0].role = "assistant"; },
    (data) => { data.body.messages[0].content.push({ type: "text", text: "extra" }); },
    (data) => { data.body.tools[0].type = "other"; },
  ]) {
    const data = structuredClone(valid); mutate(data); malformed.push(data);
  }
  for (const data of malformed) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(
      insertBeforeTurnEnd(base, [makeDshEvent("web/deepseek-search-llm-request", data)]))),
    stableError("DSH_EVENT_SHAPE_DRIFT"));
  }
});

test("pinned request headers reject outer, config, defaults, reason, tool, and schema drift", () => {
  const base = makeSupportedDshSessionRows();
  const valid = requestHeaderEvent();
  const malformed = [];
  const add = (mutate) => {
    const event = structuredClone(valid);
    mutate(event);
    malformed.push(event);
  };
  add((event) => { event.data.reason = "retry"; });
  add((event) => { delete event.data.header; });
  add((event) => { event.data.extra = true; });
  add((event) => { delete event.data.header.config.provider; });
  add((event) => { delete event.data.header.config.model; });
  add((event) => { event.data.header.extra = true; });
  add((event) => { event.data.header.config.extra = true; });
  add((event) => { event.data.header.config.provider = 7; });
  add((event) => { event.data.header.config.reasoningEffort = 1; });
  add((event) => { event.data.header.config.temperature = "cold"; });
  add((event) => { event.data.header.config.maxTokens = null; });
  add((event) => { event.data.header.config.stop = ["STOP", 2]; });
  add((event) => { event.data.header.adapterDefaults = { maxTokens: false }; });
  add((event) => { event.data.header.adapterDefaults = { maxTokens: true, extra: true }; });
  add((event) => { event.data.header.system = 7; });
  add((event) => { event.data.header.tools = {}; });
  add((event) => { event.data.header.tools = [{ name: "x", description: "x" }]; });
  add((event) => { event.data.header.tools = [{ name: "x", description: "x", parameters: [], extra: true }]; });
  for (const event of malformed) {
    assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(insertRequestHeader(base, event))),
      stableError("DSH_EVENT_SHAPE_DRIFT"));
  }

  const runtimeOnly = requestHeaderEvent({
    tools: [{ name: "x", description: "x", parameters: { invalid: undefined } }],
  });
  const analyzer = new DshSessionAnalyzer();
  assert.throws(() => analyzer.normalizeEvents(runtimeOnly, {
    kind: "dsh-session-jsonl", role: "session-transcript", path: "synthetic.jsonl",
    sessionId: "synthetic", cwd: "/synthetic", dshProvenance: { delegationDepth: 0 },
  }), stableError("DSH_EVENT_SHAPE_DRIFT"));
});

test("unknown ignorable diagnostics use bounded stable tokens and required errors do not echo type", () => {
  const secretType = `future/${DSH_FIXTURE_SECRET}`;
  const longType = `future/${"x".repeat(4_000)}`;
  const rows = insertBeforeTurnEnd(makeSupportedDshSessionRows(), [
    makeDshEvent(secretType, {}, { ignorable: true }),
    makeDshEvent(secretType, {}, { ignorable: true }),
    makeDshEvent(longType, {}, { ignorable: true }),
  ]);
  const first = decodeDshJsonl(encodeDshRawJsonl(rows));
  const second = decodeDshJsonl(encodeDshRawJsonl(rows));
  assert.equal(first.diagnostics.unknownIgnorableCount, 3);
  assert.equal(first.diagnostics.unknownIgnorableTypes.length, 2);
  assert.deepEqual(first.diagnostics.unknownIgnorableTypes, second.diagnostics.unknownIgnorableTypes);
  assert.equal(first.diagnostics.unknownIgnorableTypes.every((type) => /^unknown:[0-9a-f]{12}$/u.test(type)), true);
  const diagnosticsText = JSON.stringify(first.diagnostics);
  assert.equal(diagnosticsText.includes(DSH_FIXTURE_SECRET), false);
  assert.equal(diagnosticsText.includes("x".repeat(100)), false);

  const required = insertBeforeTurnEnd(makeSupportedDshSessionRows(), [makeDshEvent(secretType, {})]);
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(required)),
    (error) => error?.code === "DSH_UNKNOWN_REQUIRED_EVENT"
      && !String(error?.message).includes(DSH_FIXTURE_SECRET));
});

test("crash prefixes with an open step or pending tool result remain incomplete", () => {
  const header = makeDshHeader({ sessionId: "open-step-prefix" });
  const start = header.createdAt + 1_000;
  const openStepRows = [
    header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: start }),
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 1, time: start + 1 }),
  ];
  const openStep = decodeDshJsonl(encodeDshRawJsonl(openStepRows));
  assert.equal(openStep.incomplete, true);
  assert.equal(openStep.diagnostics.incompleteReason, "open-step");

  const pendingRows = structuredClone(openStepRows);
  pendingRows[0].id = "pending-tool-prefix";
  pendingRows.push(makeDshEvent("tool/call", {
    turn: 1, step: 1, callId: "pending-call", name: "read_file", arguments: "{}",
  }, { seq: 2, time: start + 2 }));
  const pending = decodeDshJsonl(encodeDshRawJsonl(pendingRows));
  assert.equal(pending.incomplete, true);
  assert.equal(pending.diagnostics.incompleteReason, "pending-tool-result");
  assert.equal(pending.diagnostics.pendingToolCallCount, 1);

  const stepWithoutTurn = [header,
    makeDshEvent("step/start", { turn: 1, step: 1 }, { seq: 0, time: start })];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(stepWithoutTurn)), stableError("DSH_EVENT_ORDER_INVALID"));
  const callWithoutStep = [header,
    makeDshEvent("turn/start", { turn: 1 }, { seq: 0, time: start }),
    makeDshEvent("tool/call", {
      turn: 1, step: 1, callId: "orphan-call", name: "read_file", arguments: "{}",
    }, { seq: 1, time: start + 1 })];
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(callWithoutStep)), stableError("DSH_EVENT_ORDER_INVALID"));
});

test("DSH timestamps are validated and normalized strictly as Unix epoch milliseconds", () => {
  assert.equal(normalizeDshEpochMillis(0), "1970-01-01T00:00:00.000Z");
  assert.equal(normalizeDshEpochMillis(1_000), "1970-01-01T00:00:01.000Z");
  assert.equal(normalizeDshEpochMillis(Date.parse("2026-08-18T00:00:00.000Z")),
    "2026-08-18T00:00:00.000Z");
  assert.throws(() => normalizeDshEpochMillis(Number.MAX_SAFE_INTEGER), stableError("DSH_INVALID_EPOCH_MILLIS"));

  const badHeader = makeOpenTurnDshRows();
  badHeader[0].createdAt = Number.MAX_SAFE_INTEGER;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badHeader)), stableError("DSH_INVALID_HEADER"));
  const badEvent = makeOpenTurnDshRows();
  badEvent[1].time = Number.MAX_SAFE_INTEGER;
  assert.throws(() => decodeDshJsonl(encodeDshRawJsonl(badEvent)), stableError("DSH_INVALID_EVENT"));
});

test("DSH discovery sorts validated millisecond observations without nullable timestamps", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeOpenTurnDshRows({ workspace, sessionId: "earlier", createdAt: 0 }) });
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeOpenTurnDshRows({ workspace, sessionId: "later", createdAt: 1_000 }) });
  const result = await inventory(home, workspace);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["later", "earlier"]);
  assert.deepEqual(result.sessions.map((session) => session.firstSeen),
    ["1970-01-01T00:00:01.000Z", "1970-01-01T00:00:00.000Z"]);
});

test("workspace qualification rejects foreign cwd and handles POSIX and Windows case semantics", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "target");
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace: path.join(root, "foreign"), sessionId: "foreign" }) });
  const foreign = await inventory(home, workspace);
  assert.equal(foreign.sessions.length, 0);
  assert.equal(foreign.warnings.some((warning) => warning.code === "dsh-foreign-workspace-rejected"), true);

  for (const entry of makeCrossPlatformDshWorkspaceFixtures()) {
    const caseRoot = await tempRoot();
    const caseHome = path.join(caseRoot, "home");
    await writeNestedDshArtifact({ dshHome: caseHome, rows: entry.rows });
    const requested = entry.platform === "win32" ? entry.workspace.toLowerCase() : entry.workspace;
    const result = await inventory(caseHome, requested);
    assert.equal(result.sessions.length, 1, entry.platform);
  }
});

test("validated topology semantics are reused for direct workspace qualification", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "repo", "member");
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace, sessionId: "topology-direct" }) });
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace: path.join(root, "repo"), sessionId: "topology-root-candidate" }) });
  const analyzer = new DshSessionAnalyzer();
  const scope = await analyzer.resolveScope({ dshHome: home, workspace, topology: {
    kind: "better-harness.workspace-topology", schemaVersion: 1,
    requestedWorkspace: workspace, gitRoot: path.join(root, "repo"),
    target: { kind: "workspace-member", route: "member", memberRoute: "member", memberMatch: "exact" },
  } });
  const sessions = await analyzer.discoverSessions(scope, await analyzer.discoverSourceRoots(scope));
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].sessionId, "topology-direct");
  assert.equal(sessions[0].workspaceMatch, "direct-cwd");
  assert.equal(analyzer.analysisWarnings.some((warning) => warning.code === "dsh-foreign-workspace-rejected"), true);
});

test("same session id in distinct valid artifacts rejects the complete identity", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace, sessionId: "collision" }) });
  await writeNestedDshArtifact({ dshHome: home,
    rows: makeSupportedDshSessionRows({ workspace: path.join(workspace, "child"), sessionId: "collision" }) });
  const result = await inventory(home, workspace);
  assert.equal(result.sessions.length, 0);
  assert.equal(result.warnings.some((warning) => warning.code === "dsh-session-identity-conflict"), true);
});

test("public discovery and diagnostics never expose fixture credentials", async () => {
  const root = await tempRoot();
  const home = path.join(root, "home");
  const workspace = path.join(root, "workspace");
  const rows = makeSupportedDshSessionRows({ workspace, sessionId: "privacy",
    parentSession: DSH_FIXTURE_SECRET, agentPreset: DSH_FIXTURE_SECRET });
  rows[5].data.message.source.replayState = { opaque: DSH_FIXTURE_SECRET };
  rows[7].data.meta = { opaque: DSH_FIXTURE_SECRET };
  await writeNestedDshArtifact({ dshHome: home, rows });
  const result = await inventory(home, workspace);
  assert.equal(JSON.stringify({ sessions: result.sessions, warnings: result.warnings }).includes(DSH_FIXTURE_SECRET), false);
  assert.equal(result.sessions[0].dshProvenance.parentSession, "<secret>");
  assert.equal(result.sessions[0].dshProvenance.agentPreset, "<secret>");
  try { decodeDshJsonl(Buffer.from(`${DSH_FIXTURE_SECRET}\n`, "utf8")); } catch (error) {
    assert.equal(String(error.message).includes(DSH_FIXTURE_SECRET), false);
  }
});

test("session reading and normalization remain explicitly unavailable until the next module", async () => {
  const analyzer = new DshSessionAnalyzer();
  await assert.rejects(() => analyzer.readSession(), stableError("DSH_NORMALIZATION_UNAVAILABLE"));
  assert.throws(() => analyzer.normalizeEvent({}), stableError("DSH_NORMALIZATION_UNAVAILABLE"));
  assert.throws(() => analyzer.normalizeEvents([]), stableError("DSH_NORMALIZATION_UNAVAILABLE"));
});
