import assert from "node:assert/strict";
import test from "node:test";

import { normalizeTimestamp, timestampMillis } from "../scripts/session-analysis/time.mjs";

test("session-analysis timestamp helpers normalize Qoder segment timestamps", () => {
  const normalized = normalizeTimestamp("2026-06-18T18-00-10-000+08-00");

  assert.equal(normalized, "2026-06-18T10:00:10.000Z");
  assert.equal(timestampMillis("2026-06-18T18-00-10-000+08-00"), Date.parse("2026-06-18T10:00:10.000Z"));
});

test("session-analysis timestamp helpers preserve invalid timestamp boundaries", () => {
  assert.equal(normalizeTimestamp("not-a-date"), "not-a-date");
  assert.equal(timestampMillis("not-a-date"), null);
  assert.equal(normalizeTimestamp(Number.NaN), null);
  assert.equal(timestampMillis(Number.NaN), null);
});

test("session-analysis timestamp helpers accept epoch seconds and milliseconds", () => {
  assert.equal(normalizeTimestamp(1_781_833_210), "2026-06-19T01:40:10.000Z");
  assert.equal(normalizeTimestamp(1_781_833_210_000), "2026-06-19T01:40:10.000Z");
});
