import assert from "node:assert/strict";
import test from "node:test";

import { selectSessions, selectionSummary } from "../scripts/session-analysis/selection.mjs";
import { buildObservationManifest } from "../scripts/session-analysis/observation-manifest.mjs";

const sessions = [
  { sessionId: "newest", lastSeen: "2026-07-10T12:00:00.000Z" },
  { sessionId: "recent", lastSeen: "2026-07-08T12:00:00.000Z" },
  { sessionId: "middle", lastSeen: "2026-07-05T12:00:00.000Z" },
  { sessionId: "older", lastSeen: "2026-07-03T12:00:00.000Z" },
  { sessionId: "oldest", lastSeen: "2026-07-01T12:00:00.000Z" },
];

test("latest-N selection retains the newest bounded sample", () => {
  const result = selectSessions(sessions, { limit: 2, strategy: "latest-n" });
  assert.equal(result.strategy, "latest-n");
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["newest", "recent"]);
});

test("stratified selection covers the oldest, middle, and newest time strata", () => {
  const result = selectSessions(sessions, { limit: 3, strategy: "stratified" });
  assert.equal(result.strategy, "stratified");
  assert.deepEqual(result.strata, ["time"]);
  assert.deepEqual(result.sessions.map((session) => session.sessionId), ["newest", "middle", "oldest"]);
});

test("selection becomes all-eligible when its limit covers the whole population", () => {
  const result = selectSessions(sessions, { limit: 20, strategy: "stratified" });
  assert.equal(result.strategy, "all-eligible");
  assert.equal(result.analyzedCount, sessions.length);
});

test("stratified samples remain explicit and never masquerade as full coverage", () => {
  const manifest = buildObservationManifest({
    scope: { platform: "codex", workspace: "/workspace/example" },
    eligibleCount: 100,
    analyzedCount: 20,
    selectionStrategy: "stratified",
    selectionStrata: ["time"],
  });
  assert.equal(manifest.selection.strategy, "stratified");
  assert.equal(manifest.selection.representative, false);
  assert.equal(manifest.selection.confidence, "Medium");
  assert.deepEqual(manifest.selection.strata, ["time"]);
});

test("public selection summaries never carry session records or source paths", () => {
  const selection = selectSessions(sessions, { limit: 2, strategy: "latest-n" });
  const summary = selectionSummary(selection);
  assert.equal("sessions" in summary, false);
  assert.equal(JSON.stringify(summary).includes("sessionId"), false);
});
