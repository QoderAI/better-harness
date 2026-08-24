# Organize tests by capability ownership

## Traceability

- Spec ID: test-suite-capability-layout
- Status: Implemented

## Intent

Replace the flat `test/` directory with a small capability-oriented hierarchy
so maintainers can find the tests owned by the production area they are
changing. Keep Node-native recursive test discovery, focused test commands,
fixtures, and cross-platform behavior intact.

## Acceptance Scenarios

- AC-1: Every active `*.test.mjs` file lives in exactly one documented
  capability directory: `agents`, `cli`, `governance`, `learning`, `plugins`,
  `reporting`, `sessions`, or `skills-docs`.
- AC-2: `npm test` recursively discovers only moved `*.test.mjs` files without
  maintaining a second hand-written test manifest or executing fixture modules.
- AC-3: Imports, `import.meta.url` resources, repository-root fixtures, and CLI
  paths resolve on Windows, macOS, and Linux after the extra directory level.
- AC-4: Active repository instructions and code comments use the new paths;
  historical specs retain their original evidence paths as historical records.
- AC-5: `test/fixtures` remains a shared, non-test resource directory and is not
  duplicated inside capability folders.
- AC-6: The focused category commands, full suite, package verification, and
  whitespace checks pass from the repository root.

## Non-goals

- Reclassifying tests as unit, integration, or end-to-end when one file crosses
  those execution levels.
- Splitting large test files or changing production behavior in the same change.
- Rewriting historical specs merely because their recorded test paths predate
  the new layout.
- Moving shared fixtures away from `test/fixtures`.

## Plan and Tasks

1. Document category ownership in `test/README.md` with focused commands.
2. Move each active test to the directory matching its primary production
   owner; prefer one obvious home over duplicated or nested taxonomies.
3. Mechanically update imports from repository modules and the one
   `import.meta.url` fixture reference affected by the extra path level.
4. Update active instructions, references, and code comments that invoke exact
   test paths.
5. Verify each category is discovered independently, then run the complete
   suite and real package verification.

## Test and Review Evidence

- AC-1/AC-5: inventory `test/**/*.test.mjs`, confirm the root contains no test
  files, and compare the moved-file count with the pre-move active count.
- AC-2/AC-3: `npm test` plus focused
  `node --test "test/<category>/*.test.mjs"` commands.
- AC-4: repository search for active references to old flat test paths.
- AC-6: `npm run pack:verify` and `git diff --check`.
- Risk: path-only moves can hide a missing test if default discovery changes;
  category counts and the full-suite test total must be inspected, not only the
  process exit code.

## Implementation Evidence

- All 90 active `*.test.mjs` files moved from the flat root into eight owner
  directories: agents 10, CLI 5, governance 11, learning 7, plugins 12,
  reporting 24, sessions 17, and skills/docs 4. The `test/` root now contains
  zero test files, while `test/fixtures` remains shared.
- Node 24 rejected directory operands, so focused commands use quoted native
  globs such as `node --test "test/sessions/*.test.mjs"`; the plugins and
  skills/docs focused run passed.
- Four missed repo-root calculations initially caused seven path failures.
  After repairing those seams, their focused rerun passed 21/21. A later Git
  timeout under two concurrent full-suite processes passed 29/29 when rerun
  without resource contention.
- Final `npm test -- --test-reporter=tap` passed 1301/1301. The explicit
  `test/**/*.test.mjs` discovery removed two fixture helper modules that the old
  default discovery incorrectly executed as tests.
- `node --test test/skills-docs/doc-link-graph.test.mjs` passed 6/6 after graph
  regeneration. `npm run pack:verify` passed with 505 npm entries and 527
  runtime ZIP entries; `git diff --check` passed.
