import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { test } from "vitest";

import {
  decodeDshZstdFramesForFixture,
  decodePackedDshStorageRecordForFixture,
  dshProjectKey,
  DSH_FIXTURE_MALFORMED_PACKED_ROW,
  DSH_FIXTURE_SECRET,
  DSH_FIXTURE_UNSUPPORTED_PACKED_ROW,
  DSH_FORMAT_VERSION,
  DSH_ZSTD_UNAVAILABLE,
  encodeDshRawJsonl,
  encodeDshSessionIdSegment,
  makeCanonicalDedupeDshFixture,
  makeCrossPlatformDshWorkspaceFixtures,
  makeBadHeaderDshRows,
  makeBadIdentityDshFixture,
  makeBadSequenceDshRows,
  makeBadVersionDshRows,
  makeDshHeader,
  makeDshZstdArtifact,
  makeForeignWorkspaceDshFixture,
  makeKnownUnsupportedDshEvent,
  makeKnownUnsupportedDshSessionRows,
  makeMalformedDshJsonlBytes,
  makeMalformedPackedDshStorageRows,
  makeNativeSnapshotDshSessionRows,
  makeOpenTurnDshRows,
  makePackedDshStorageRows,
  makeSupportedDshSessionRows,
  makeTerminalDshSessionRows,
  makeUnknownIgnorableDshEvent,
  makeUnknownRequiredDshEvent,
  writeNestedDshArtifact,
} from "./dsh-fixtures.mjs";

const ZSTD_MAGIC = 0xFD2FB528;
const TERMINAL_REASONS = ["completed", "aborted", "blocked", "error", "max-tokens", "interrupted"];

async function fixtureRoot(prefix) {
  return mkdtemp(path.join(os.tmpdir(), prefix));
}

function jsonlRows(bytes) {
  const text = bytes.toString("utf8");
  assert.ok(text.endsWith("\n"));
  return text.slice(0, -1).split("\n").map((line) => JSON.parse(line));
}

test("pinned DSH v0 builders preserve exact header, event, message, and fresh-copy contracts", () => {
  const rows = makeSupportedDshSessionRows();
  const [header, ...events] = rows;
  assert.deepEqual(Object.keys(header), [
    "type", "version", "id", "cwd", "createdAt", "parentSession", "seedLength", "origin",
    "delegationDepth", "agentPreset",
  ]);
  assert.equal(header.type, "session");
  assert.equal(header.version, DSH_FORMAT_VERSION);
  assert.ok(path.posix.isAbsolute(header.cwd));
  assert.equal(header.delegationDepth, 1);
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index));

  const users = events.filter((event) => event.type === "user/message");
  assert.equal(users[0].data.source.kind, "user");
  assert.deepEqual(users[1].data.source, {
    kind: "plugin",
    plugin: "fixture-context",
    form: "notice",
    summary: "Synthetic context injection.",
  });
  const assistant = events.find((event) => event.type === "assistant/message");
  assert.deepEqual(assistant.data.usage, {
    inputTokens: 12,
    outputTokens: 8,
    cacheReadTokens: 2,
    reasoningTokens: 1,
  });
  assert.equal(assistant.data.turn, 1);
  assert.equal(assistant.data.step, 1);
  assert.deepEqual(assistant.data.message.source, {
    kind: "model",
    provider: "fixture-provider",
    model: "fixture-model",
  });
  const calls = events.filter((event) => event.type === "tool/call");
  const results = events.filter((event) => event.type === "tool/result");
  assert.deepEqual(results.map((event) => event.data.message.source.callId), calls.map((event) => event.data.callId));
  assert.equal(results[0].data.message.content[0].isError, false);
  assert.equal(results[1].data.message.content[0].isError, true);
  assert.deepEqual(header, makeDshHeader());

  const other = makeSupportedDshSessionRows();
  rows[0].parentSession = "mutated";
  rows[3].data.content[0].text = "mutated";
  assert.notEqual(other[0].parentSession, "mutated");
  assert.notEqual(other[3].data.content[0].text, "mutated");
});

test("pinned headless snapshot builder preserves native base ordering and request records", () => {
  const rows = makeNativeSnapshotDshSessionRows();
  const events = rows.slice(1);
  assert.deepEqual(events.map((event) => event.seq), events.map((_event, index) => index));
  assert.deepEqual(events.slice(0, 7).map((event) => event.type), [
    "permission/preset", "sandbox/mode", "approval/policy", "agent/inbox/spliced",
    "turn/start", "agent/inbox/spliced", "step/start",
  ]);
  assert.deepEqual(events.filter((event) => event.type === "request/header").map((event) => event.data.reason),
    ["initial", "change"]);
  assert.deepEqual(events.filter((event) => event.type === "agent/inbox/spliced")
    .map((event) => event.data.removedCount ?? 0), [0, 1]);
  const another = makeNativeSnapshotDshSessionRows();
  rows[4].data.inserted[0].content[0].text = "mutated";
  assert.notEqual(another[4].data.inserted[0].content[0].text, "mutated");
});

test("terminal fixtures each contain one semantically isolated exact turn outcome", () => {
  for (const kind of TERMINAL_REASONS) {
    const rows = makeTerminalDshSessionRows(kind);
    const events = rows.slice(1);
    const terminal = events.filter((event) => event.type === "turn/end");
    assert.equal(terminal.length, 1, kind);
    assert.equal(terminal[0].data.reason.kind, kind);
    assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index));
    assert.equal(Object.hasOwn(rows[0], "parentSession"), false);
    assert.equal(Object.hasOwn(rows[0], "seedLength"), false);
    assert.equal(Object.hasOwn(rows[0], "origin"), false);
    assert.equal(Object.hasOwn(rows[0], "agentPreset"), false);
    if (kind === "aborted") {
      assert.deepEqual(terminal[0].data.reason.reason, {
        kind: "hook",
        reason: "synthetic cancellation",
      });
    }
    if (kind === "error") {
      assert.deepEqual(terminal[0].data.reason.error, {
        message: "synthetic provider failure",
        code: "FIXTURE_PROVIDER_FAILURE",
        status: 503,
      });
    }
  }
});

test("known unsupported and truly unknown event fixtures remain distinct", () => {
  const knownRows = makeKnownUnsupportedDshSessionRows();
  const knownUnsupported = knownRows[2];
  const unknownRequired = makeUnknownRequiredDshEvent({ seq: 1 });
  const unknownIgnorable = makeUnknownIgnorableDshEvent({ seq: 2 });
  assert.equal(knownUnsupported.type, "todo/write");
  assert.deepEqual(knownUnsupported.data.todos, [{
    content: "Review the synthetic fixture",
    status: "in_progress",
  }]);
  assert.equal(Object.hasOwn(knownUnsupported, "ignorable"), false);
  assert.deepEqual(knownRows.slice(1).map((event) => event.seq), [0, 1, 2]);
  assert.deepEqual(knownRows.slice(1).map((event) => event.type), ["turn/start", "todo/write", "turn/end"]);
  assert.equal(unknownRequired.type, "fixture-future/required");
  assert.equal(Object.hasOwn(unknownRequired, "ignorable"), false);
  assert.equal(unknownIgnorable.type, "fixture-future/ignorable");
  assert.equal(unknownIgnorable.ignorable, true);
});

test("pinned chunk-row oracle expands exact text, reasoning, and tool-call storage records", () => {
  const rows = makePackedDshStorageRows();
  assert.deepEqual(Object.keys(rows[0]), ["type", "seq0", "time0", "data"]);
  assert.deepEqual(Object.keys(rows[0].data), ["turn", "step", "index", "dt", "texts"]);
  assert.deepEqual(Object.keys(rows[2].data), ["turn", "step", "index", "id", "name", "dt", "args"]);
  const events = rows.flatMap((row) => decodePackedDshStorageRecordForFixture(row));
  assert.deepEqual(events.map((event) => event.seq), events.map((_, index) => index));
  assert.deepEqual(events.map((event) => event.type), Array(9).fill("assistant/chunk"));
  assert.deepEqual(events.slice(0, 3).map((event) => event.data.chunk), [
    { type: "text-delta", index: 0, text: "one" },
    { type: "text-delta", index: 0, text: " two" },
    { type: "text-delta", index: 0, text: "." },
  ]);
  assert.deepEqual(events.slice(3, 6).map((event) => event.data.chunk.type), [
    "reasoning-delta", "reasoning-delta", "reasoning-delta",
  ]);
  assert.deepEqual(events.slice(6).map((event) => event.data.chunk), [
    { type: "tool-call-delta", index: 2, id: "fixture-packed-call", name: "fixture_tool",
      argumentsDelta: "{\"value\":" },
    { type: "tool-call-delta", index: 2, id: "fixture-packed-call", name: "fixture_tool",
      argumentsDelta: "1" },
    { type: "tool-call-delta", index: 2, id: "fixture-packed-call", name: "fixture_tool",
      argumentsDelta: "}" },
  ]);
  assert.deepEqual(events.map((event) => [event.data.turn, event.data.step]), Array(9).fill([1, 1]));
});

test("fixture-side chunk-row oracle rejects malformed and unsupported packed shapes", () => {
  const malformed = makeMalformedPackedDshStorageRows();
  for (const row of malformed.slice(0, -1)) {
    assert.throws(
      () => decodePackedDshStorageRecordForFixture(row),
      (error) => error?.code === DSH_FIXTURE_MALFORMED_PACKED_ROW,
    );
  }
  assert.throws(
    () => decodePackedDshStorageRecordForFixture(malformed.at(-1)),
    (error) => error?.code === DSH_FIXTURE_UNSUPPORTED_PACKED_ROW,
  );
});

test("raw JSONL encoding is deterministic, newline terminated, and lossless", () => {
  const rows = makeSupportedDshSessionRows();
  const first = encodeDshRawJsonl(rows);
  const second = encodeDshRawJsonl(rows);
  assert.notStrictEqual(first, second);
  assert.deepEqual(first, second);
  assert.equal(first.at(-1), 0x0A);
  assert.deepEqual(jsonlRows(first), rows);
});

test("bad and incomplete builders each introduce their named contract defect", () => {
  assert.notEqual(makeBadVersionDshRows()[0].version, DSH_FORMAT_VERSION);
  assert.equal(Object.hasOwn(makeBadHeaderDshRows()[0], "delegationDepth"), false);
  const identity = makeBadIdentityDshFixture();
  assert.notEqual(identity.rows[0].id, identity.artifactSessionId);
  const badSequenceEvents = makeBadSequenceDshRows().slice(1);
  assert.notDeepEqual(badSequenceEvents.map((event) => event.seq),
    badSequenceEvents.map((_, index) => index));
  assert.throws(() => jsonlRows(makeMalformedDshJsonlBytes()), SyntaxError);
  const openEvents = makeOpenTurnDshRows().slice(1);
  assert.equal(openEvents.some((event) => event.type === "turn/start"), true);
  assert.equal(openEvents.some((event) => event.type === "turn/end"), false);
});

test("Zstandard fixture encodes independent checksummed frames or reports stable unavailability", () => {
  const rows = makeSupportedDshSessionRows();
  const batches = [[rows[0]], rows.slice(1, 6), rows.slice(6)];
  if (typeof zlib.zstdCompressSync === "function" && typeof zlib.zstdDecompressSync === "function"
    && Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) {
    const result = makeDshZstdArtifact(batches);
    assert.equal(result.frames.length, 3);
    for (const [index, frame] of result.frames.entries()) {
      assert.equal(frame.readUInt32LE(0), ZSTD_MAGIC);
      assert.equal((frame[4] & 0x04) === 0x04, true);
      assert.deepEqual(
        decodeDshZstdFramesForFixture([frame])[0],
        encodeDshRawJsonl(batches[index]),
      );
    }
    assert.deepEqual(result.artifact, Buffer.concat(result.frames));
  } else {
    assert.throws(
      () => makeDshZstdArtifact(batches),
      (error) => error?.code === DSH_ZSTD_UNAVAILABLE,
    );
  }
  assert.throws(
    () => makeDshZstdArtifact(batches, { compressor: null }),
    (error) => error?.code === DSH_ZSTD_UNAVAILABLE,
  );
  assert.throws(
    () => decodeDshZstdFramesForFixture([Buffer.from([0x28, 0xB5, 0x2F, 0xFD])], {
      decompressor: null,
    }),
    (error) => error?.code === DSH_ZSTD_UNAVAILABLE,
  );
  assert.deepEqual(jsonlRows(encodeDshRawJsonl(rows)), rows);
});

test("nested artifact writer emits only the fixed caller-owned raw and compressed layouts", async () => {
  const root = await fixtureRoot("dsh-fixture-writer-");
  const rawHome = path.join(root, "raw-home");
  const zstdHome = path.join(root, "zstd-home");
  const rows = makeSupportedDshSessionRows();
  const raw = await writeNestedDshArtifact({ dshHome: rawHome, rows, compression: "raw" });
  const expectedProjectSegment = dshProjectKey(rows[0].cwd);
  assert.equal(expectedProjectSegment, "--synthetic-workspace-project--");
  assert.equal(raw.filePath, path.join(rawHome, "sessions", expectedProjectSegment,
    encodeDshSessionIdSegment(rows[0].id), "session.jsonl"));
  assert.deepEqual(await readFile(raw.filePath), encodeDshRawJsonl(rows));

  if (typeof zlib.zstdCompressSync === "function"
    && Number.isSafeInteger(zlib.constants?.ZSTD_c_checksumFlag)) {
    const compressed = await writeNestedDshArtifact({ dshHome: zstdHome, rows, compression: "zstd" });
    assert.equal(compressed.filePath, path.join(zstdHome, "sessions", expectedProjectSegment,
      encodeDshSessionIdSegment(rows[0].id), "session.jsonl.zstd"));
    assert.equal((await readFile(compressed.filePath)).equals(compressed.bytes), true);
  }
  assert.deepEqual((await readdir(root)).sort(), ["raw-home", ...(typeof zlib.zstdCompressSync === "function"
    ? ["zstd-home"] : [])].sort());
  assert.equal(raw.filePath.startsWith(root), true);
});

test("workspace fixtures cover foreign rejection inputs and platform-specific absolute cwd forms", () => {
  const foreign = makeForeignWorkspaceDshFixture();
  assert.notEqual(foreign.rows[0].cwd, foreign.requestedWorkspace);
  assert.equal(path.posix.isAbsolute(foreign.rows[0].cwd), true);

  const cases = makeCrossPlatformDshWorkspaceFixtures();
  assert.deepEqual(cases.map((entry) => entry.platform), ["posix", "win32"]);
  assert.equal(path.posix.isAbsolute(cases[0].workspace), true);
  assert.equal(path.win32.isAbsolute(cases[1].workspace), true);
  for (const entry of cases) {
    assert.equal(entry.rows[0].cwd, entry.workspace);
    assert.equal(entry.rows[0].delegationDepth, 1);
    assert.equal(entry.rows.slice(1).every((event, index) => event.seq === index), true);
  }
});

test("canonical dedupe fixture binds path aliases to one artifact and session identity", async () => {
  const root = await fixtureRoot("dsh-fixture-dedupe-");
  const fixture = makeCanonicalDedupeDshFixture({ dshHome: path.join(root, "dsh-home") });
  assert.notEqual(fixture.candidates[0].path, fixture.candidates[1].path);
  assert.equal(path.resolve(fixture.candidates[0].path), path.resolve(fixture.candidates[1].path));
  assert.equal(fixture.candidates.every((candidate) => candidate.rows[0].id === fixture.sessionId), true);
  assert.deepEqual(fixture.candidates[0].rows, fixture.candidates[1].rows);
  fixture.candidates[0].rows[0].id = "mutated";
  assert.equal(fixture.candidates[1].rows[0].id, fixture.sessionId);
});

test("serialized synthetic fixtures contain only the declared fake credential sentinel", () => {
  const rows = [
    ...makeSupportedDshSessionRows(),
    ...TERMINAL_REASONS.flatMap((kind) => makeTerminalDshSessionRows(kind)),
    makeKnownUnsupportedDshEvent(),
    makeUnknownRequiredDshEvent(),
    makeUnknownIgnorableDshEvent(),
    ...makePackedDshStorageRows(),
  ];
  const serialized = encodeDshRawJsonl(rows).toString("utf8");
  assert.equal(serialized.includes(DSH_FIXTURE_SECRET), true);
  assert.equal(serialized.includes(process.cwd()), false);
  assert.equal(serialized.includes(os.homedir()), false);
  assert.doesNotMatch(serialized, /ghp_[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}/u);
  assert.doesNotMatch(serialized.replaceAll(DSH_FIXTURE_SECRET, ""), /sk-[A-Za-z0-9_-]{16,}/u);
});
