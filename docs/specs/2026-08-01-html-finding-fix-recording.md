# Keep Portable HTML Fix Records Consistent

## Traceability

- Spec ID: `html-finding-fix-recording`
- Status: Implemented
- Review context: `QoderAI/better-harness#39`

## Intent

Complete the finding-bound repair flow introduced for portable HTML reports.
The fix recorder must recognize a valid HTML report without requiring Qoder's
Canvas sidecar, validate the correct report contract, and publish the updated
`findings.json`, `report.md`, and `report.html` as one consistent revision.
Qoder Canvas reports must retain their stricter split-artifact validation.

## Acceptance Scenarios

- **HFR-AC-1 (report-family resolution):** a compact findings document with
  `report.md` and `report.html`, and without Canvas artifacts, is recognized as
  an HTML report. A split Canvas report is recognized only through its Canvas
  artifacts. Mixed, incomplete, or otherwise ambiguous artifact sets fail
  closed with a stable report-context error.
- **HFR-AC-2 (HTML recording):** a valid result for an HTML finding records
  `actualOutput`, its AI-authored Assignment Summary, and its independent repair
  review without reading or creating `canvas.json`; the finding revision and
  report repair progress advance exactly once.
- **HFR-AC-3 (three-artifact consistency):** after a successful HTML record,
  `findings.json`, `report.md`, and `report.html` are regenerated from the same
  updated report data. The HTML action callback carries the new expected
  revision, and the report directory still contains only those three durable
  report artifacts.
- **HFR-AC-4 (failure safety):** stale revisions, invalid result payloads,
  invalid output paths, render-validation failures, and ambiguous report
  families do not change any durable report artifact and do not consume the
  result file.
- **HFR-AC-5 (Canvas isolation):** existing Qoder split reports still require
  and validate their Canvas sidecar, and a fabricated or missing sidecar cannot
  make an HTML report pass through the Canvas contract.
- **HFR-AC-6 (result lifecycle):** workflow guidance keeps the temporary result
  outside the renderer-owned report directory and consumes it only after the
  recorder returns `status: "pass"`.

## Non-goals

- Changing Loop Effectiveness scores or treating a repair review as delayed
  outcome evidence.
- Changing the callback transport contract already shipped by PR #39.
- Redesigning Qoder Canvas rendering, durable Canvas ownership, or its split
  report schema.
- Reconstructing or mutating historical reports without an explicit
  finding-bound record operation.
- Guaranteeing cross-file atomicity across an operating-system or power loss;
  the publish order instead keeps `findings.json` as the final commit marker.

## Plan and Tasks

1. Resolve report family from the durable sibling artifact signature before
   validation: full findings, portable HTML, or Qoder Canvas. Reject mixed and
   incomplete compact contexts.
2. Validate portable HTML findings with the compact task-loop contract and
   preserve the existing full and Canvas validation paths.
3. Apply the result to an isolated clone, validate outputs, render Markdown and
   HTML, and run the HTML evaluator before writing durable files.
4. Publish HTML and Markdown first and `findings.json` last so the revision file
   remains the final commit marker for prepared artifacts.
5. Update the finding-bound-fix workflow to place temporary result payloads
   outside the report directory and consume them only on recorder success.
6. Add focused tests using an actual three-artifact HTML report, plus failure
   and Canvas-isolation coverage.

## Test and Review Evidence

- **HFR-AC-1/HFR-AC-2/HFR-AC-3:** add focused tests to
  `test/task-loop-report.test.mjs` that render an HTML report, record one fix,
  parse the resulting findings, and verify Markdown, HTML, callback revision,
  repair progress, and durable artifact names.
- **HFR-AC-4:** snapshot all three artifacts before representative failures
  and assert byte identity afterward; assert the temporary result remains.
- **HFR-AC-5:** retain existing split-report tests and add explicit missing and
  mixed-sidecar rejection cases.
- **HFR-AC-6:** update and validate the shipped skill reference and package.
- **Regression:** run the focused report and CLI tests, `npm run pack:verify`,
  and the full `npm test` suite.
- **Documentation integrity:** regenerate the Better Harness doc routing graph
  and run `node --test test/doc-link-graph.test.mjs`.
- **Review readiness:** run `git diff --check`, inspect staged and unstaged
  changes, and record changed modules, generated files, risks, and AI evidence.
- **Risk:** an interrupted multi-file publish can leave prepared Markdown or
  HTML ahead of the old findings revision. Publishing `findings.json` last
  keeps the old callback revision authoritative until all prepared views have
  been installed; normal validation failures occur before any publish begins.

## Observed Validation Evidence

- The 16 focused `record-fix-output` tests passed, including the new portable
  HTML success, pre-publish failure safety, and Qoder Canvas isolation cases.
- The HTML fixture proves that a successful record updates all three artifacts,
  increments the embedded callback revision, advances repair progress, leaves
  only `findings.json`, `report.md`, and `report.html`, and consumes an external
  result only after success.
- The original three-artifact Codex report was exercised without mutation by
  deliberately supplying a stale expected revision. The recorder returned
  `STALE_FIX_OUTPUT_REVISION` instead of `ENOENT`, proving that the valid compact
  HTML contract no longer attempts to read `canvas.json`.
- The combined report, renderer, Skill, CLI, and compatibility run passed 166
  tests with one supported Windows symlink skip; its only failure was the same
  pre-existing unguarded Windows symlink-permission case reproduced on the
  unchanged baseline.
- The full repository run reached 1,044 passes and 6 supported skips. Its four
  failures were all pre-existing Windows `EPERM` symlink-creation cases and did
  not execute the changed recorder or HTML publication path.
- `npm run pack:verify` passed with 369 npm entries and 392 runtime-zip entries;
  the regenerated doc graph and all six doc-link tests passed.
