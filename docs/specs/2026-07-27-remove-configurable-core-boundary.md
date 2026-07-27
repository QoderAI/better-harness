# Remove the configurable core boundary

## Traceability

- Spec ID: remove-configurable-core-boundary
- Status: Implemented

## Intent

Remove the repository-owned core-boundary configuration and its runtime contract.
Core Change Watch should identify affected core paths from repository structure and
bounded Git history without a hidden override file that can suppress inferred
change risk.

## Acceptance Scenarios

- AC-1: `.better-harness/core-code` is absent, and no runtime code reads, parses,
  accepts a CLI override for, or emits schema fields for that configuration.
- AC-2: Diff impact and evidence-pack analysis continue to mark changes to an
  inferred medium- or high-confidence core candidate as requiring attention,
  including untracked files under an inferred core path.
- AC-3: Project Harness guidance describes only inferred core boundaries, and
  obsolete report filtering and quality checks for the removed internal
  configuration are deleted.
- AC-4: Focused Core Change Watch, report-quality, maturity-model, and Markdown
  link tests pass, and repository searches find no active implementation or
  guidance references to the removed configuration.

## Non-goals

- Removing the Core Change Watch module or its project, history, candidate,
  diff-impact, drift, or evidence-pack collectors.
- Changing core-candidate scoring thresholds, final finding eligibility, report
  severity, or Lead judgment ownership.
- Replacing the removed configuration with another user-authored core-path file.

## Plan and Tasks

1. Delete `.better-harness/core-code` and remove its parser, matcher, CLI option,
   diff-impact schema fields, and evidence-pack sanitization/guidance branches.
2. Keep diff attention routing on inferred candidates and update focused tests
   for inferred tracked and untracked core changes.
3. Remove obsolete report-quality rejection logic and align Project Harness
   documentation with inference-only behavior.
4. Add a forward link from the historical open-source baseline spec, run focused
   tests and link validation, then record visible implementation evidence.

## Test and Review Evidence

- AC-1/AC-3: `rg -n "\\.better-harness/core-code|core-code|coreCode|coreCodePath|coreCodeRules" scripts references skills .better-harness` returns no active matches.
- AC-2: `node --test test/core-change-watch.test.mjs`.
- AC-3: `node --test test/harness-report-quality.test.mjs test/maturity-models.test.mjs`.
- AC-4: `node --test test/doc-link-graph.test.mjs` and `git diff --check`.
- Risk: removing the configured allowlist means repositories that previously
  suppressed inferred candidates can receive additional attention signals; keep
  final finding judgment with the Lead and verify inferred non-core supporting
  files remain companion evidence only.

## Implementation Evidence

- AC-1/AC-3: the tracked configuration, parser/matcher, CLI override, schema
  fields, evidence-pack sanitization, report-quality guard, and active guidance
  references were removed; the bounded implementation/guidance search returned
  no matches.
- AC-2/AC-4: `node --test test/core-change-watch.test.mjs test/harness-report-quality.test.mjs test/maturity-models.test.mjs test/doc-link-graph.test.mjs`
  passed 98 tests with no failures.
- AC-4: `npm test` completed successfully.
- AC-4: `npm run pack:verify` initially stopped at the root-owned global npm
  cache; rerunning with an isolated `/tmp` npm cache passed with 293 npm entries
  and 327 runtime-zip entries.
- `git diff --check` and Node syntax checks passed for the changed implementation
  files.
