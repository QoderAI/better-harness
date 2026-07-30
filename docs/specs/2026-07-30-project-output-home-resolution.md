# Project output avoids Home resolution

## Traceability

- Spec ID: project-output-home-resolution
- Status: Implemented

## Intent

Allow `record-fix-output` to record verified Project-scoped output even when the
current process Home directory is unavailable or cannot be canonicalized. This
keeps Project output validation independent of unrelated Global-scope state.

## Acceptance Scenarios

- AC-1: A result whose `actualOutput` entries are all `scope: "Project"` is
  accepted when every referenced file exists within the canonical workspace,
  even if `HOME` and `USERPROFILE` point to a non-existent directory.
- AC-2: A `scope: "Global"` output resolves and canonicalizes the process Home
  on demand, accepts an existing `~/...` file within that canonical Home, and
  fails without writing the report when Home is unavailable.
- AC-3: Project output continues to require an existing file and rejects a
  canonical target that escapes the workspace.

## Non-goals

- Change output schemas, CLI arguments, or result consumption behavior.
- Relax existing-file, `realpath`, or scope-containment validation.
- Add test-only production API parameters or alter host environment state.

## Plan and Tasks

1. Add a deterministic CLI regression test that invokes `record-fix-output`
   with only Project output in a child process whose `HOME` and `USERPROFILE`
   refer to a non-existent directory.
2. Confirm the regression fails against the current eager Home resolution.
3. Make Home canonicalization lazy in `assertOutputTargets`, retaining the
   existing workspace canonicalization and Global validation behavior.
4. Run focused, task-loop, documentation-link, packaging, and practical full
   test gates; record any environment limitation.

## Test and Review Evidence

- AC-1: `node --test test/task-loop-report.test.mjs` exercises the isolated
  child-process regression and verifies a successful JSON CLI result.
- AC-2: `node --test test/task-loop-report.test.mjs` runs isolated Global
  success and unavailable-Home failure cases; the latter verifies the JSON
  error envelope and that findings bytes are unchanged.
- AC-3: existing `record-fix-output` cases retain automated Project
  existing-file rejection. Focused source review confirms the canonical
  `realpath` containment check and its validation order are unchanged.
- Documentation: regenerate `docs/better-harness-doc-links.mmd` and run
  `node --test test/doc-link-graph.test.mjs` after adding this spec.
- Packaging: run `npm run pack:verify`; run `npm test` when the local runtime
  can complete the full suite.
- Risk: `os.homedir()` stays intentionally reachable for Global output only;
  a regression could weaken containment only if lazy initialization is applied
  to the wrong scope, which focused scope tests mitigate.

### Observed Evidence (2026-07-30)

- Pre-fix regression: temporarily restoring eager Home resolution made the new
  Project-only child-process test fail with exit code 1.
- Focused gate:
  `node --test --test-name-pattern="record-fix-output"
  test/task-loop-report.test.mjs` passed 10/10.
- Task-loop gate: `node --test test/task-loop-report.test.mjs` passed 76/76.
- Documentation gate: the routing graph had no semantic diff and
  `node --test test/doc-link-graph.test.mjs` passed 6/6.
- Full regression: `npm test` exited 0; the suite retained its existing
  Windows symlink-permission skip.
- Package gate: `npm run pack:verify` passed using an isolated temporary npm
  cache, which was removed afterward.
- Environment limitation: Node `v22.17.0` and npm `10.9.2` are below the
  repository minimums of Node `22.20.0` and npm `10.9.3`.
