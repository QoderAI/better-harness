# Describe exact leaf command paths

## Traceability

- Spec ID: `issue-33-describe-leaf-command-paths`
- Story: `#33`
- Status: Implemented

## Intent

Make `better-harness command describe` resolve the complete registered command
path so contributors and automation can inspect a leaf command without executing
its capability. A two-segment request must not silently fall back to metadata for
the parent command.

## Acceptance Scenarios

- AC-1: `command describe <parent> <leaf> --json` returns parser-safe metadata
  for the exact registered leaf, including its canonical path, audience, and
  script, without dispatching the leaf.
- AC-2: The human form identifies the canonical two-segment path and reports the
  leaf audience, script, and summary or description when present.
- AC-3: One-segment parent descriptions and parent-alias canonicalization remain
  unchanged.
- AC-4: An unknown leaf fails with the existing unknown-subcommand diagnostic in
  human and JSON modes instead of returning parent metadata.
- AC-5: A third command-path segment fails with a bounded invalid-path diagnostic
  in human and JSON modes instead of being ignored.

## Non-goals

- Do not execute a described command or inspect capability-private runtime state.
- Do not add leaf aliases, change command registration, or change dispatch.
- Do not redesign command inventory, OpenCLI schema, global option parsing, or
  command output contracts outside `command describe`.

## Plan and Tasks

1. Add a registry-owned lookup for an exact canonical command path while
   preserving the existing parent metadata lookup.
2. Parse the describe path after removing the recognized `--json` bootstrap flag,
   reject paths longer than two command segments, and distinguish unknown parents
   from unknown leaves.
3. Render leaf descriptions through the existing human and JSON output paths.
4. Add focused regression coverage for group and direct-command leaves, human and
   JSON output, parent compatibility, unknown leaves, extra path segments, and
   non-dispatch behavior.
5. Record the user-visible correction in `CHANGELOG.md` and run focused, full,
   documentation, package, and diff validation.

## Test and Review Evidence

- Before implementation, the five focused #33 regression cases failed against
  `origin/main`: 0 passed, 5 failed.
- AC-1 through AC-5 and frozen root CLI contracts:
  `node --test --test-concurrency=1 test/better-harness-cli.test.mjs
  test/scripts-refactor-contract.test.mjs` completed with 39 passed, 0 failed,
  and 1 Windows symlink-permission skip.
- The additional sparse leaf human-output check passed: 1 passed, 0 failed.
- Documentation integrity:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness` reported 34 files
  and 50 links; `node --test test/doc-link-graph.test.mjs` passed 6 of 6.
- Package boundary: `npm run pack:verify` passed with 359 npm entries and 382
  runtime-zip entries.
- Final full regression: `node --test` completed with 1015 passed, 10 failed,
  and 3 skipped. Every failure was a Windows host error before or after the
  assertion body: directory cleanup returned `EBUSY`, or symlink creation
  returned `EPERM`. The changed CLI test file passed 32 tests with one symlink
  skip and no failure.
- A same-name selected run on untouched `origin/main` reproduced 6 of the 10
  failures with the same `EBUSY`/`EPERM` classes. Four cleanup-sensitive cases
  passed in that attempt; the baseline also produced nondeterministic `EBUSY`
  failures in the same unchanged test areas.
- `git diff --check` passed.

Risk is limited to root CLI introspection. Dispatch, registry contents, parent
metadata, schemas, and capability-owned scripts remain unchanged.
