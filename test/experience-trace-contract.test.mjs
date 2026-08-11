import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  EXPERIENCE_TRACE_BOUNDS,
  ExperienceTraceError,
  assertIterativeJsonStructure,
  bindingRefFromKey,
  canonicalJson,
  createTraceFromProjection,
  experienceTraceValidationDocument,
  parseAndValidateExperienceTraceJsonl,
  serializeExperienceTrace,
  traceDigestFor,
  validateExperienceTraceRecords,
} from "../scripts/experience-trace/contract.mjs";

const noSessionFixtureUrl = new URL("../docs/specs/fixtures/lc03-no-session-v1.jsonl", import.meta.url);
const episodeFixtureUrl = new URL("../docs/specs/fixtures/lc03-episode-v1.jsonl", import.meta.url);

async function fixtureText(url = noSessionFixtureUrl) {
  return readFile(url, "utf8");
}

function canonicalJsonl(records) {
  return records.map((record) => `${canonicalJson(record)}\n`).join("");
}

function noSessionProjection() {
  return {
    schemaVersion: 1,
    producer: { platform: "qoder", reportSourceSchemaVersion: 3, manifestSchemaVersion: 2 },
    selection: {
      sourceFingerprint: "0123456789abcdef",
      strategy: "all-eligible",
      eligibleCount: 0,
      analyzedCount: 0,
      sampled: false,
      representative: true,
      confidence: "Low",
      warningCodes: [],
    },
    episode: null,
    absenceReason: "caller-declared-no-session-evidence",
  };
}

function episodeProjection() {
  return {
    schemaVersion: 1,
    producer: { platform: "qoder", reportSourceSchemaVersion: 3, manifestSchemaVersion: 2 },
    selection: {
      sourceFingerprint: "fedcba9876543210",
      strategy: "stratified",
      eligibleCount: 3,
      analyzedCount: 2,
      sampled: true,
      representative: false,
      confidence: "Medium",
      warningCodes: ["disabled-source-root", "missing-optional-root"],
    },
    episode: {
      episodeRef: "episode:abcdefabcdef",
      sessionCount: 1,
      continuation: "session-bounded",
      startBoundary: "session-start",
      toolCallCount: 5,
      changeSets: [{ eventCount: 2, firstOrdinal: 3, lastOrdinal: 4, targetKeys: ["11111111111111111111", "22222222222222222222"] }],
      validationSets: [{
        category: "node --test",
        status: "passed",
        sourceOrdinal: 7,
        checkIdentity: "check:aaaaaaaaaaaaaaaaaaaaaaaa",
        targetKeys: ["33333333333333333333"],
      }],
      permissionBoundary: { prompted: 1, denied: 0, escalated: 0, protectedActions: 1 },
      closureStatus: "closed",
      repairStatus: "repaired-and-passed",
    },
    absenceReason: null,
  };
}

function assertInvalid(callback) {
  assert.throws(callback, (error) => error instanceof ExperienceTraceError && error.code === "INVALID_EXPERIENCE_TRACE");
}

function assertCode(callback, code) {
  assert.throws(callback, (error) => error instanceof ExperienceTraceError && error.code === code);
}

test("consumes the normative no-session fixture and reproduces every golden vector", async () => {
  const fixture = await fixtureText();
  const records = parseAndValidateExperienceTraceJsonl(fixture);
  assert.equal(records.length, 12);
  assert.equal(serializeExperienceTrace(records), fixture);
  assert.equal(records[0].source.projectionDigest, "sha256:f46c5aaea639376da6fca7bfa9df215ee2a22bdad509761912a705d57d8eb9c9");
  assert.equal(records[0].traceId, "trace:sha256:a924fb792337d1a641f2cc152a67764387d6ae0b0d04fa6ff0752469ab8d095f");
  assert.equal(records.at(-1).traceDigest, "sha256:e568040d4ce087a63abb593e760ea4b94b140a8da6421dad7b69ab583426956e");
  assert.deepEqual(experienceTraceValidationDocument(records), {
    kind: "better-harness.experience-trace.validation",
    schemaVersion: 1,
    valid: true,
    traceId: records[0].traceId,
    streamStatus: "complete",
    evidenceStatus: "unavailable",
    recordCount: 12,
    eventCount: 10,
    traceDigest: records.at(-1).traceDigest,
  });
});

test("creates the normative no-session byte stream without emitting raw caller keys", async () => {
  const result = createTraceFromProjection({
    projection: noSessionProjection(),
    taskKey: "task-key-00000001",
    workspaceKey: "workspace-key-00000001",
    runKey: "run-key-00000001",
  });
  assert.equal(result.jsonl, await fixtureText());
  assert.equal(result.jsonl.includes("task-key-00000001"), false);
  assert.equal(result.records[0].binding.episode.ref, null);
  assert.equal(bindingRefFromKey("task", "task-key-00000001"), "task:sha256:fce82f8f9ff62cd9af044e2e21bfd2a1822d4cc506bf174a285b8fd03fb011e9");
  assert.equal(bindingRefFromKey("workspace", "workspace-key-00000001"), "workspace:sha256:50c688560321b967e32f410e861cf64cc7af45c817bddbe466aa1f703a29850e");
  assert.equal(bindingRefFromKey("run", "run-key-00000001"), "run:sha256:7522f027d7bb67cbdbb3818345249dc1f4429fe8e484f44c6330083f1292e1d0");
});

test("reproduces the versioned Episode golden fixture and vectors byte-for-byte", async () => {
  const projection = episodeProjection();
  const created = createTraceFromProjection({
    projection,
    taskKey: "episode-task-key-01",
    workspaceKey: "episode-workspace-01",
    runKey: "episode-run-key-0001",
  });
  const fixture = await fixtureText(episodeFixtureUrl);
  assert.equal(created.jsonl, fixture);
  const parsed = parseAndValidateExperienceTraceJsonl(created.jsonl);
  assert.equal(parsed[0].source.projectionDigest, "sha256:670e6779abb62b2dae18d2f5081a11b102bbef3a9baa0799b1828d0666b4ff8b");
  assert.equal(parsed[0].traceId, "trace:sha256:4064d02402929c3629fdbeefa261106c0e9806c8802dcfbc5302ee2dae5279ee");
  assert.equal(parsed.at(-1).traceDigest, "sha256:f15892bcafa1ad3ac34586a0bdae412d73e995f84bd72ebe340b5470cf5ae5f1");
  assert.equal(parsed.at(-1).evidenceStatus, "partial");
  assert.equal(parsed.at(-1).eventCount, 11);
  assert.equal(parsed.at(-1).recordCount, 13);
  assert.equal(parsed[3].evidenceRef, "source:validation:1");
  assert.equal(serializeExperienceTrace(parsed), created.jsonl);
});

test("rejects an Episode header ref that disagrees with reconstructed event evidence", async () => {
  const records = parseAndValidateExperienceTraceJsonl(await fixtureText(episodeFixtureUrl));
  const mismatched = structuredClone(records);
  mismatched[0].binding.episode.ref = "episode:bbbbbbbbbbbb";
  mismatched.at(-1).traceDigest = traceDigestFor(mismatched.slice(0, -1));
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(canonicalJsonl(mismatched)));
});

test("rejects shared line, record, event, and byte bounds with the bounds code before JSON parsing", () => {
  const tooManyRecords = `${Array(EXPERIENCE_TRACE_BOUNDS.maxRecords + 1).fill("{").join("\n")}\n`;
  assertCode(() => parseAndValidateExperienceTraceJsonl(tooManyRecords), "TRACE_BOUNDS_EXCEEDED");

  const tooManyEvents = `${Array(EXPERIENCE_TRACE_BOUNDS.maxEvents + 3).fill("{").join("\n")}\n`;
  assertCode(() => parseAndValidateExperienceTraceJsonl(tooManyEvents), "TRACE_BOUNDS_EXCEEDED");

  const oversizedLine = `${JSON.stringify("x".repeat(EXPERIENCE_TRACE_BOUNDS.maxLineBytes))}\n{}\n{}\n`;
  assertCode(() => parseAndValidateExperienceTraceJsonl(oversizedLine), "TRACE_BOUNDS_EXCEEDED");

  const exactLine = `${JSON.stringify("x".repeat(EXPERIENCE_TRACE_BOUNDS.maxLineBytes - 3))}\n{}\n{}\n`;
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(exactLine));

  const oversizedTrace = Buffer.alloc(EXPERIENCE_TRACE_BOUNDS.maxTraceBytes + 1, 0x61);
  assertCode(() => parseAndValidateExperienceTraceJsonl(oversizedTrace), "TRACE_BOUNDS_EXCEEDED");

  assertCode(
    () => validateExperienceTraceRecords(Array(EXPERIENCE_TRACE_BOUNDS.maxRecords + 1).fill(null)),
    "TRACE_BOUNDS_EXCEEDED",
  );
  assertCode(
    () => validateExperienceTraceRecords(Array(EXPERIENCE_TRACE_BOUNDS.maxEvents + 3).fill(null)),
    "TRACE_BOUNDS_EXCEEDED",
  );
});

test("raw-byte shared bounds outrank invalid UTF-8 without masking under-bound UTF-8 failures", () => {
  const overTotal = Buffer.alloc(EXPERIENCE_TRACE_BOUNDS.maxTraceBytes + 1, 0x61);
  overTotal[0] = 0xff;
  assertCode(() => parseAndValidateExperienceTraceJsonl(overTotal), "TRACE_BOUNDS_EXCEEDED");

  const overLine = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.alloc(EXPERIENCE_TRACE_BOUNDS.maxLineBytes, 0x61),
    Buffer.from("\n"),
  ]);
  assertCode(() => parseAndValidateExperienceTraceJsonl(overLine), "TRACE_BOUNDS_EXCEEDED");

  const overRecords = Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from("null\n".repeat(EXPERIENCE_TRACE_BOUNDS.maxRecords + 1)),
  ]);
  assertCode(() => parseAndValidateExperienceTraceJsonl(overRecords), "TRACE_BOUNDS_EXCEEDED");

  const overEvents = new Uint8Array(Buffer.concat([
    Buffer.from([0xff]),
    Buffer.from("null\n".repeat(EXPERIENCE_TRACE_BOUNDS.maxEvents + 3)),
  ]));
  assertCode(() => parseAndValidateExperienceTraceJsonl(overEvents), "TRACE_BOUNDS_EXCEEDED");

  const underBoundInvalidUtf8 = Buffer.from([0xff, 0x0a, 0x7b, 0x7d, 0x0a, 0x7b, 0x7d, 0x0a]);
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(underBoundInvalidUtf8));
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(`\ud800${"x".repeat(EXPERIENCE_TRACE_BOUNDS.maxLineBytes)}`));

  // Sixty-six terminated lines model the header plus 65 events; the nonempty
  // trailing segment is the unterminated terminal and must count as line 67.
  const unterminatedOverEvents = Buffer.concat([
    Buffer.from("null\n".repeat(EXPERIENCE_TRACE_BOUNDS.maxEvents + 2)),
    Buffer.from([0xff]),
  ]);
  assertCode(() => parseAndValidateExperienceTraceJsonl(unterminatedOverEvents), "TRACE_BOUNDS_EXCEEDED");

  assertInvalid(() => parseAndValidateExperienceTraceJsonl("{}\n{}\n{}"));
});

test("rejects non-canonical line endings, BOMs, whitespace, duplicate keys, and reordered data", async () => {
  const fixture = await fixtureText();
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(fixture.replaceAll("\n", "\r\n")));
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(`\uFEFF${fixture}`));
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(fixture.replace("{\"binding\"", "{ \"binding\"")));
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(fixture.replace("\"kind\":\"better-harness.experience-trace.header\"", "\"kind\":\"better-harness.experience-trace.header\",\"kind\":\"better-harness.experience-trace.header\"")));

  const lines = fixture.trimEnd().split("\n");
  [lines[1], lines[2]] = [lines[2], lines[1]];
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(`${lines.join("\n")}\n`));
});

test("rejects unknown fields and hash tampering even when the bytes are canonical", async () => {
  const records = parseAndValidateExperienceTraceJsonl(await fixtureText());
  const unknown = structuredClone(records);
  unknown[0].unexpected = true;
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(canonicalJsonl(unknown)));

  const tampered = structuredClone(records);
  tampered.at(-1).traceDigest = `sha256:${"0".repeat(64)}`;
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(canonicalJsonl(tampered)));

  const reversedHeader = Object.fromEntries(Object.entries(records[0]).reverse());
  const text = `${JSON.stringify(reversedHeader)}\n${canonicalJsonl(records.slice(1))}`;
  assertInvalid(() => parseAndValidateExperienceTraceJsonl(text));
});

test("normalizes NFC while rejecting unsafe JSON strings and numbers", () => {
  assert.equal(canonicalJson({ text: "e\u0301" }), "{\"text\":\"é\"}");
  assertInvalid(() => canonicalJson("\ud800"));
  assertInvalid(() => canonicalJson(-0));
  assertInvalid(() => canonicalJson(1.5));
  assertInvalid(() => canonicalJson(Number.MAX_SAFE_INTEGER + 1));
});

test("preflights deep JSON structures iteratively before recursive serialization", () => {
  let allowed = null;
  for (let index = 0; index < 64; index += 1) allowed = { next: allowed };
  assert.ok(Buffer.byteLength(JSON.stringify(allowed), "utf8") < 64 * 1024);
  assert.equal(assertIterativeJsonStructure(allowed), 65);
  assert.doesNotThrow(() => canonicalJson(allowed));

  let rejected = null;
  for (let index = 0; index < 65; index += 1) rejected = { next: rejected };
  assertInvalid(() => assertIterativeJsonStructure(rejected));
  assertInvalid(() => canonicalJson(rejected));

  assertInvalid(() => assertIterativeJsonStructure(Array(EXPERIENCE_TRACE_BOUNDS.maxValues).fill(null)));
});
