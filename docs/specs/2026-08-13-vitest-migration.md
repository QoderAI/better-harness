# Make test failures directly visible

## Traceability

- Spec ID: vitest-migration
- Status: Implemented
- Supersedes the CI runner/reporting slice of
  [Make test failures concise and actionable](2026-08-13-test-ci-diagnostics.md).

## Intent

Replace the repository's custom `node:test` CI orchestration with Vitest so a
failed GitHub Actions step names the failing file and test, prints the useful
assertion stack in the main log, links an annotation to the source, and retains
downloadable JUnit evidence. Remove the custom reporting lifecycle that reduced
successful output but hid the identity of failures behind dots and artifacts.

## Acceptance Scenarios

- AC-1: `npm test` runs the complete `test/**/*.test.mjs` population through
  Vitest on the declared Node.js versions without requiring tests to adopt
  Vitest assertions or mocks.
- AC-2: An intentionally failing isolated test produces a main-log summary
  containing its relative file, full test name, assertion message, and source
  location; diagnosing the failure does not require opening an artifact.
- AC-3: GitHub Actions uses Vitest's built-in default and `github-actions`
  reporters plus its JUnit reporter, uploads the JUnit file on success or
  failure, and publishes a test Job Summary.
- AC-4: The repository no longer owns a custom test scheduler or reporter for
  ordinary CI execution; `test/support/run-ci.mjs` and
  `test/support/github-actions-reporter.mjs` are removed.
- AC-5: Existing Node assertion behavior, dynamic skip behavior, per-test
  cleanup, suite setup/teardown, filename filtering, and exit codes remain
  observable after migration.
- AC-6: CI passes on Linux Node 22.20.0, macOS Node 22.20.0, Windows Node
  22.20.0, and Linux Node 24.x from the exact pushed head.
- AC-7: `npm run pack:verify` continues to exclude test infrastructure and
  development dependencies from the published runtime artifact.

## Non-goals

- Rewriting Node `assert` calls to Vitest `expect` matchers.
- Adding coverage thresholds, browser tests, snapshots, or TypeScript test
  compilation.
- Changing product behavior or weakening platform-specific tests.
- Keeping capability-by-capability subprocess scheduling when Vitest can report
  file and suite ownership directly.

## Plan and Tasks

1. Add the exact stable Vitest version as a development dependency and add
   local and CI configurations for the existing `.test.mjs` population.
2. Mechanically replace `node:test` imports with Vitest imports. Map per-test
   cleanup from `t.after` to `t.onTestFinished`, retain context `skip`, and map
   suite hooks to `beforeAll` and `afterAll`.
3. Replace `npm test` and `npm run test:ci` with Vitest run commands. Configure
   the CI route with `default`, `github-actions`, and JUnit reporters so failures
   stay human-readable while machine artifacts remain available.
4. Update the GitHub Actions upload boundary for the single Vitest JUnit file
   and remove the custom runner and reporter.
5. Validate one isolated intentional failure, focused migrated tests, the full
   suite, package verification, documentation links, and the exact-head CI
   matrix before release.

Decision rationale: Vitest 4.1.10 supports the repository's Node.js range and
ships the three required reporting surfaces. The test corpus primarily uses
`node:assert/strict`, so the migration changes lifecycle registration while
leaving nearly all assertions and fixtures unchanged.

## Test and Review Evidence

- AC-1/AC-5: `npm test` passes all 91 files and 1,305 Vitest cases. The five
  result-count difference from the 1,310 Node baseline is accounted for by
  removing four custom-runner component tests and representing the two adapter
  cases directly instead of counting their former parent subtest. All 91 test
  files import Vitest, and no `node:test`, `t.after`, or `context.test` route
  remains. Focused lifecycle coverage passes 79/79 across cleanup, dynamic
  skip, and filesystem-heavy suites.
- AC-2: the reporting contract launches Vitest against an intentionally failing
  temporary fixture and passes only when the captured main log contains the
  relative file, full test name, Node assertion message, and line 3 location.
- AC-3: a focused `npm run test:ci` writes and parses
  `test-results/vitest.junit.xml`. A GitHub Actions environment simulation also
  writes a non-empty Job Summary with the one-test pass result.
- AC-4: both custom support modules are absent, and no non-historical reference
  to either module remains.
- AC-6: the exact-head four-platform PR matrix remains the merge gate; local
  evidence does not claim remote Windows, macOS, or Linux status.
- AC-7: `npm run pack:verify` passes with 508 npm entries and 530 runtime zip
  entries. Test files, Vitest configuration, and installed development modules
  remain outside both artifacts.
- Documentation and installation: `npm ci` succeeds from the lockfile; the
  regenerated documentation graph contains 39 files and 56 links, and its
  focused suite passes 6/6. `git diff --check` is clean.
- Risk: Vitest file parallelism and cleanup timing can differ from `node:test`.
  The fork pool preserves process isolation, cleanup is migrated explicitly,
  and the full cross-platform suite remains the release gate.
