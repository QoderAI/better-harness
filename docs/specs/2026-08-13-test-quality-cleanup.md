# Make the test suite prove behavior instead of implementation text

## Traceability

- Spec ID: test-quality-cleanup
- Status: Implemented

## Intent

Reduce the maintenance cost and false confidence created by tests that read
source, templates, or prose and then lock individual words, private function
names, CSS literals, or JSX spelling with regular expressions. Keep tests that
prove observable behavior, versioned data contracts, security boundaries,
package contents, documentation links, and intentionally stable public output.

The 2026-08-13 baseline has 95 `*.test.mjs` files, about 52,000 lines, and
2,020 `assert.match` / `assert.doesNotMatch` calls. Twelve hotspot files contain
1,089 of those text assertions. This cleanup is therefore organized by evidence
quality rather than by mechanically banning regular expressions.

## Acceptance Scenarios

- AC-1: The shipped Canvas template is accepted by the production artifact
  validator using representative findings and Canvas data without a test
  enumerating private component names, exact JSX layout literals, copy text, or
  helper-function spelling.
- AC-2: Harness Inspector tests assert the versioned report projection,
  self-contained document boundary, embedded data, privacy/redaction, and
  executable client script without enumerating private browser function names,
  CSS classes, or incidental visible copy in one omnibus assertion block.
- AC-3: Skill, model, template, and documentation checks retain structural
  invariants such as valid front matter, prompt budgets, heading/routing shape,
  resolvable links, locale coverage, and unsafe-content exclusions, but do not
  pin ordinary explanatory sentences word by word.
- AC-4: Tests that inspect module architecture use public exports, behavior, or
  a dedicated dependency/structure check. They do not infer ownership from the
  presence or absence of private identifier text when an executable seam is
  available.
- AC-5: Security, canonical-path, symlink, schema, packaging, privacy, parser,
  and failure-boundary regressions remain covered. A lower text-assertion count
  is not accepted if it removes these independent oracles.
- AC-6: Focused tests for every changed area, the documentation link graph, the
  full suite, package verification, and `git diff --check` pass from a cleanly
  identified workspace state. Visual behavior removed from source-text tests is
  either exercised in a browser or explicitly recorded as an unautomated
  verification gap.

## Non-goals

- Rewriting all 95 test files in one change.
- Banning regular expressions in parser, validation, diagnostic, CLI-output,
  security, or intentionally stable serialization tests.
- Adding coverage percentage gates before a trustworthy behavioral baseline
  exists.
- Changing production behavior, report schemas, user-visible copy, package
  contents, or supported host declarations as part of the cleanup.
- Treating a green full-suite run as proof that the resulting tests are useful.

## Plan and Tasks

1. Remove the largest implementation-text locks first: the shipped Canvas
   template test and the Harness Inspector omnibus HTML test. Preserve their
   executable validator, report-model, serialization, privacy, and script
   syntax checks.
2. Reduce the Better Harness Skill, model, style-template, and documentation
   suites to structural contracts and high-risk exclusions. Let the existing
   documentation graph and package verification own link and artifact reachability.
3. Replace source-token architecture checks with runtime exports, behavior, or
   one parser-backed dependency rule where the architecture itself is public.
4. Keep the suite organized around unit contracts, filesystem/CLI integration,
   artifact validation, documentation/package integrity, and browser/evaluation
   evidence. Introduce separate commands only when the file ownership boundary
   is clear enough that the command cannot silently omit tests.
5. After each slice, compare test count, assertion mix, changed behavior seams,
   and known verification gaps. Do not use assertion deletion alone as the
   success metric.

## Test and Review Evidence

- AC-1: `node --test test/harness-canvas-validation.test.mjs`
- AC-2: `node --test test/harness-inspector.test.mjs`
- AC-3/AC-4: focused tests for every edited Skill, docs, template, model, or
  architecture file plus `node --test test/doc-link-graph.test.mjs`
- AC-5: focused security/schema/package tests remain unchanged unless replaced
  by an equal or stronger oracle.
- AC-6: `npm test`, `npm run pack:verify`, and `git diff --check` after focused
  tests. Browser-visible changes require preview health/module smoke checks,
  console inspection, and a saved screenshot under the repository's existing
  visual verification workflow.
- Review risk: removing phrase locks can reveal that some prompt or visual
  behavior has no executable oracle. Record those gaps in review evidence and
  add a scenario evaluation or browser check rather than recreating the same
  source-text assertion under another helper name.

## Implementation Evidence

- Static workspace census changed from 52,298 to 50,913 test lines and from
  2,020 to 1,066 `assert.match` / `assert.doesNotMatch` calls. This count
  includes a concurrent 13-line cleanup in `test/read-only-command.test.mjs`
  outside this implementation slice. Test files remain 95; security, schema,
  parser, filesystem, CLI, packaging, and privacy suites were not removed.
- Focused changed-area run: 62 passed, 0 failed. The docs runtime test was then
  rerun after warning isolation: 4 passed, 0 failed.
- `node --test test/doc-link-graph.test.mjs`: passed as part of the focused run;
  `node scripts/doc-link-graph/cli.mjs skills/better-harness` regenerated the
  same 39-file, 56-link graph.
- `npm test -- --test-reporter=dot`: exit 0.
- `npm run pack:verify`: passed with 504 npm entries and 526 runtime ZIP entries.
- `git diff --check` and `node --check` for every changed test file: passed.
- Known gap: Canvas composition, Inspector interactions, and LLM prompt quality
  are no longer represented as proven behavior merely because source tokens are
  present. This change does not alter production visuals or prompts. A future
  change to those behaviors still requires the repository's browser evidence or
  a dedicated scenario evaluation.
- Follow-up hardcode cleanup removed 147 `assert.match` / `assert.doesNotMatch`
  calls across six suites. It deleted private TSX identifier and style checks,
  packaging-script source inspection, a duplicate template spelling test, a
  private-function source slice, catalog ownership inferred from source tokens,
  and an exact HTML-markup test. Focused verification passed 191/191; `npm test`,
  `npm run pack:verify` (504 npm entries and 526 runtime ZIP entries), and
  `git diff --check` passed. Public package metadata, Canvas validators, CLI
  integration, catalog data, privacy, schema, and artifact checks remain.
- Follow-up gap: future-version Canvas sidecar merge behavior no longer has a
  focused unit test because its only seam was a source slice bounded by private
  function names. Restore that coverage only after the merge owner is exposed
  as a directly importable production function.
