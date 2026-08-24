import assert from "node:assert/strict";
import { test } from "vitest";

import {
  buildHarnessInspectorReport,
  commitStartsCompact,
  DEFAULT_COMPACT_COMMIT_EVIDENCE_KINDS,
  emptyFeatureTree,
} from "../../scripts/harness-inspector/index.mjs";

test("contextual commit evidence starts compact while stronger evidence stays expanded", () => {
  assert.equal(commitStartsCompact("contextual"), true);
  assert.equal(commitStartsCompact("file-context"), true);

  for (const evidenceKind of ["explicit", "observed-commit", "observed-overlap", "candidate", "declared"]) {
    assert.equal(commitStartsCompact(evidenceKind), false, `${evidenceKind} should start expanded`);
  }
});

test("the self-contained report carries the compact commit policy used by its workbench", () => {
  const report = buildHarnessInspectorReport({
    repoRoot: "/workspace/repo",
    featureTree: emptyFeatureTree(),
    correlation: { schemaVersion: 1, commits: [] },
  });

  assert.deepEqual(
    report.presentation.defaultCompactCommitEvidenceKinds,
    [...DEFAULT_COMPACT_COMMIT_EVIDENCE_KINDS],
  );
});
