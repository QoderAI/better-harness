import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildHarnessInspectorDemoReport,
  HARNESS_INSPECTOR_DEMO_GENERATED_AT,
  renderHarnessInspectorDemoHtml,
} from "../../scripts/harness-inspector/demo-report.mjs";

test("public Inspector demo is deterministic English sample evidence (AC-3)", () => {
  const first = buildHarnessInspectorDemoReport();
  const second = buildHarnessInspectorDemoReport();

  assert.deepEqual(first, second);
  assert.equal(first.generatedAt, HARNESS_INSPECTOR_DEMO_GENERATED_AT);
  assert.equal(first.workspace.name, "atlas-checkout");
  assert.equal(first.stories.length, 3);
  assert.equal(first.sessions.length, 3);
  assert.equal(first.commits.length, 3);
  assert.ok(first.commits.every((commit) => !/^([0-9a-f])\1{39}$/u.test(commit.hash)));
  assert.equal(first.days.length, 2);
  assert.equal(first.sessions.reduce((sum, session) => sum + session.toolActivity.totalCalls, 0), 12);
  assert.ok(first.sessions.some((session) => session.storyLinks.length === 0));
  assert.ok(first.sessions.some((session) => session.replay?.eventCount > 0));

  const evidenceKinds = new Set([
    ...first.stories.flatMap((story) => story.sessionLinks.map((link) => link.evidenceKind)),
    ...first.sessions.flatMap((session) => session.commitLinks.map((link) => link.evidenceKind)),
  ]);
  assert.ok(evidenceKinds.has("declared"));
  assert.ok(evidenceKinds.has("candidate"));
  assert.ok(evidenceKinds.has("explicit"));
  assert.ok(evidenceKinds.has("observed-overlap"));
  assert.ok(evidenceKinds.has("file-context"));
  assert.doesNotMatch(JSON.stringify(first), /\p{Script=Han}/u);
});

test("public Inspector demo declares sample and indexing boundaries (AC-4)", () => {
  const html = renderHarnessInspectorDemoHtml();

  assert.match(html, /<meta name="robots" content="noindex, follow">/u);
  assert.match(html, /<body data-report-context="sample">/u);
  assert.match(html, /English sample data · no live workspace access/u);
  assert.doesNotMatch(html, /real local evidence/u);
  assert.doesNotMatch(html, /\/Users\/|[A-Za-z]:\\\\Users\\\\/u);
  assert.doesNotMatch(html, /sk-[A-Za-z0-9]{16,}|BEGIN [A-Z ]+ PRIVATE KEY/u);
});
