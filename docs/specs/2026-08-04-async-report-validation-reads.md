# Read report validation artifacts asynchronously

## Traceability

- Spec ID: async-report-validation-reads
- Status: Implemented

## Intent

Keep report validation non-blocking while it loads generated Markdown, findings,
and HTML artifacts. The renderer already exposes an asynchronous validation
pipeline, so independent artifact reads should use the promise-based filesystem
API and complete together without changing report contents or validation
decisions.

## Acceptance Scenarios

- **ARV-AC-1 (asynchronous reads):** Markdown and HTML report validation reads
  generated artifacts through the promise-based filesystem API, with no
  synchronous file reads remaining in `render-report.mjs`.
- **ARV-AC-2 (bounded concurrency):** The independent findings, Markdown, and
  optional HTML reads begin through one bounded `Promise.all` operation; Markdown
  mode does not require an HTML artifact.
- **ARV-AC-3 (output compatibility):** Rendering preserves the existing artifact
  names, contents, ordering in the renderer result, and selected validation
  checks for Markdown and HTML modes.
- **ARV-AC-4 (failure safety):** An unreadable required artifact still rejects
  validation before the staged run is published, retaining the existing atomic
  publication boundary.

## Non-goals

- Change report schemas, renderer output, validation rules, or reader-visible
  copy.
- Parallelize artifact writes, Canvas validation, or publication and rollback.
- Change CLI arguments, output locations, run-directory allocation, or supported
  hosts.
- Add caching, streaming, or performance claims that are not measured by this
  change.

## Plan and Tasks

1. Update `scripts/harness-analysis/render-report.mjs` to import `readFile` from
   `node:fs/promises` and remove its synchronous read dependency.
2. Read findings, Markdown, and the optional HTML artifact through one
   `Promise.all` while preserving the current validation calls and artifact
   ordering.
3. Run focused HTML coverage and the complete report-render test file.
4. Run the full repository suite, separately verify loopback preview tests when
   sandbox networking blocks them, and check the final diff for whitespace
   errors.

## Test and Review Evidence

- **ARV-AC-1/ARV-AC-2:** focused diff review confirms `readFileSync` is removed
  from `render-report.mjs` and the three independent reads share one
  `Promise.all` operation.
- **ARV-AC-3:** run
  `node --test --test-name-pattern="render command writes disk-openable HTML artifacts|HTML mode validates canonical compact" test/harness-report-render-cli.test.mjs`.
- **ARV-AC-3:** run
  `node --test test/harness-report-render-cli.test.mjs`; its staging,
  validation, output-location, Markdown, HTML, and publication coverage must
  remain green.
- **ARV-AC-4:** focused control-flow review must confirm artifact reads remain
  inside staged validation and `publishStagedRun` is reached only after
  validation succeeds.
- Regression gate: run `npm test`. If sandbox loopback restrictions produce
  `listen EPERM`, rerun `node --test test/preview-servers.test.mjs` with local
  loopback permission and record both results without presenting the sandbox
  result as a product failure.
- Documentation gate: regenerate the routing graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then run
  `node --test test/doc-link-graph.test.mjs`.
- Diff gate: run `git diff --check` and confirm the change remains limited to
  the renderer and this Spec.
- Primary risk: concurrent reads can change which filesystem error is observed
  first when multiple required staged artifacts are simultaneously unreadable.
  Normal rendering creates all required artifacts before validation, and the
  staged publication boundary prevents partial output from replacing a prior
  run.

### Observed Evidence (2026-08-04)

- **ARV-AC-1/ARV-AC-2:** `render-report.mjs` now imports `readFile` from
  `node:fs/promises`; `readFileSync` is absent, and findings, Markdown, and the
  optional HTML artifact are read by one `Promise.all`.
- **ARV-AC-3:** the two focused HTML tests passed 2/2, and
  `node --test test/harness-report-render-cli.test.mjs` passed 32/32 across
  Canvas, Markdown, and HTML rendering contracts.
- **ARV-AC-4:** the existing control flow still writes into `stageDir`, validates
  that staging directory, throws on failed validation, and invokes
  `publishStagedRun` only after the validation gate passes.
- Full regression: `npm test` ran 1,148 tests; 1,145 passed and three loopback
  preview tests failed with sandbox-only `listen EPERM`. The bounded rerun
  `node --test test/preview-servers.test.mjs` passed 8/8 with loopback
  permission.
- Documentation gate: the routing graph generator reported 35 files and 51
  links with no generated diff; `node --test test/doc-link-graph.test.mjs`
  passed 6/6.
- Package gate: the default `npm run pack:verify` attempt was blocked by an
  unwritable user npm cache. Re-running with the isolated task cache
  `/tmp/better-harness-npm-cache-20260804` passed with 395 npm entries and 417
  runtime ZIP entries; no user cache permissions were changed.
- `git diff --check` passed. The working tree remains unstaged so the reviewer
  can inspect the renderer and Spec together before commit.
