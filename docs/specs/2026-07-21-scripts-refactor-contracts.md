# Stabilize Scripts Refactoring Contracts

## Traceability

- Spec ID: 2026-07-21-scripts-refactor-contracts
- Status: Accepted

## Intent

Reorganize `scripts/` around clearer capability and CLI boundaries without
changing public command behavior, machine-readable output, report artifacts, or
documented compatibility entrypoints. Establish a committed characterization
baseline before moving implementation files so later refactor commits can be
reviewed against unchanged tests.

## Acceptance Scenarios

- AC-1: Characterization tests compare the exact maintainer-level root help,
  Harness group help, and session-analysis help emitted by the current primary
  CLI, including whitespace and trailing newlines.
- AC-2: Characterization tests freeze the complete command-routing projection:
  command and subcommand names, kinds, audiences, aliases, and exposed script
  paths. Existing direct paths remain callable compatibility entrypoints even
  when their implementation moves.
- AC-3: Characterization tests freeze representative failure behavior,
  including exit status, empty stdout, exact stderr text, and newline handling
  for unknown commands and subcommands.
- AC-4: Existing report, JSON, Markdown, Canvas, validation, and session-analysis
  tests pass before the refactor baseline is committed. The later refactor must
  pass the same tests without changing their expected output.
- AC-5: The baseline commit contains the spec and test-only assets, with no
  `scripts/` implementation change. Later refactor commits must leave all files
  under `test/` byte-for-byte unchanged relative to the baseline commit, checked
  with `git diff --exit-code <baseline-commit> -- test`.
- AC-6: If a frozen test is proved incorrect, changing it requires a separate,
  explicitly reviewed test-contract commit before further refactoring; an
  implementation move must never update the test and implementation together to
  make a failure disappear.
- AC-7: Phase 1 moves Canvas serving, transform, runtime-discovery, fixture, and
  platform helpers into `scripts/harness-analysis/canvas-preview/` with
  `cli.mjs` and `index.mjs`; other implementation modules import it only through
  that public surface, and copying all of `harness-analysis/` remains sufficient
  for installed-like validation.
- AC-8: `scripts/harness-analysis/canvas-preview-server.mjs` and its historical
  `preview-support/` modules remain thin compatibility facades with unchanged
  exports and CLI output.
- AC-9: Package and runtime artifacts contain both the new Canvas Preview owner
  and the frozen compatibility paths. The command inventory continues exposing
  the historical path, so the committed machine-output hashes remain unchanged.
- AC-10: Phase 2 moves the report-source contract, review-packet binding,
  episode/delivery review normalization, and review application into
  `scripts/harness-analysis/report-source/` with `index.mjs` as the only import
  surface used by other non-facade implementation modules.
- AC-11: The historical `report-source.mjs`, `report-review-packet.mjs`,
  `episode-evidence-review.mjs`, and `apply-source-review.mjs` paths remain thin
  compatibility facades with unchanged exports. Direct invocation of
  `apply-source-review.mjs` retains its exact help, status JSON, stderr prefix,
  and exit behavior.
- AC-12: Package and runtime artifacts contain the new report-source owner and
  all four compatibility paths. The frozen command inventory, report source,
  projected findings, and review behavior remain unchanged without editing any
  file under `test/`.

## Non-goals

- Moving, renaming, splitting, or rewriting `scripts/` in the baseline commit.
- Changing command names, flags, help prose, exit codes, stdout/stderr routing,
  JSON fields, report schemas, report copy, artifact filenames, or output paths.
- Freezing temporary absolute paths, timestamps, ports, or other intentionally
  variable runtime data as literal fixtures.
- Combining npm package assembly with source-local host artifact packaging.

## Plan and Tasks

1. Add a dedicated `scripts` refactor contract test and readable golden help
   fixtures under `test/fixtures/scripts-refactor-contract/`.
2. Freeze the complete machine command inventory, OpenCLI schema, and Harness
   command description byte-for-byte with reviewed SHA-256 baselines, covering
   every public command, audience, alias, description, and script path.
3. Run the focused CLI and new characterization tests, then the full repository
   test suite and package verification.
4. Perform a Review Readiness Check and commit the spec plus tests as the
   immutable refactor baseline.
5. Phase 1 groups Canvas Preview under the existing Harness analysis copy/install
   boundary, keeps its fixture beside the Harness model owner, and converts
   historical paths to thin compatibility facades without changing registry or
   package-script output.
6. Phase 2 groups report-source creation/validation and its bounded human-review
   workflow under one owner. Keep existing direct paths as compatibility
   facades, route implementation consumers through `report-source/index.mjs`,
   and leave report projection/rendering for a later phase.
7. Later phases reorganize one additional capability boundary at a time.
   Preserve old public paths with thin compatibility entrypoints and do not edit
   `test/`.
8. Before each refactor commit, run the frozen-test diff check, focused tests,
   full tests, package verification, and `git diff --check`.

## Test and Review Evidence

- AC-1/AC-2/AC-3: `node --test test/scripts-refactor-contract.test.mjs
  test/better-harness-cli.test.mjs`. The historical baseline evidence below
  retains the command name that existed when that phase ran.
- AC-4: `npm test`; retain the exact pass/fail evidence observed on the baseline
  rather than claiming unavailable CI or runtime evidence.
- AC-4: `npm run pack:verify` to confirm compatibility entrypoints and packaged
  runtime paths remain present.
- AC-5: baseline Review Readiness Check must show no `scripts/` diff and a clean
  staged/unstaged split.
- AC-5/AC-6 during refactoring:
  `git diff --exit-code <baseline-commit> -- test`.
- Cross-platform risk: snapshots may accidentally capture terminal styling or
  platform paths. Run child processes without a TTY, set `NO_COLOR=1`, and keep
  fixtures limited to path-independent help and routing output.
- Compatibility risk: script paths are exposed by `commands --json` and appear
  in documentation and generated handoff text. Preserve shims and route internal
  moves behind those stable paths.
- Copy-boundary risk: installed-like consumers copy `harness-analysis/` without
  sibling capabilities. Keep the preview subcapability inside that tree so
  `validate-canvas.mjs` does not acquire an unavailable external dependency.
- Review-binding risk: source digests, packet digests, evidence refs, and review
  normalization form one integrity boundary. Move these modules together and
  preserve old import and CLI paths so no caller can bypass or observe a changed
  binding contract.

### Baseline Evidence

- `node --test test/scripts-refactor-contract.test.mjs test/better-harness-cli.test.mjs`
  passed: 33 tests, 0 failures.
- `npm test` passed outside the restricted network sandbox: 767 tests, 0
  failures. The restricted run passed 764 tests and failed only the three
  preview-server cases because binding `127.0.0.1` returned `EPERM`.
- `npm run pack:verify` passed: the npm artifact contains 250 entries and the
  runtime zip contains 284 entries.

### Phase 1 Evidence

- `git diff --exit-code d05b400caf2f5c106e8ac0e0ee957524f2aa07ee -- test`
  passed: no frozen test or fixture changed.
- The initial top-level sibling extraction failed the installed-like validation
  fixture because that consumer deliberately copies only `harness-analysis/`.
  Keeping `canvas-preview/` inside that owner restored the tested copy boundary
  without modifying the test.
- `node --test test/preview-servers.test.mjs test/harness-canvas-validation.test.mjs test/host-plugin-artifact.test.mjs`
  passed: 25 tests, 0 failures, including loopback preview and installed-like
  runtime resolution.
- `npm test` passed outside the restricted network sandbox: 767 tests, 0
  failures. The frozen CLI output hashes and compatibility-path checks passed.
- `npm run pack:verify` passed: the npm artifact contains 257 entries and the
  runtime zip contains 291 entries, including the seven new owner modules and
  all historical compatibility paths.

### Phase 2 Evidence

- `git diff --exit-code d05b400caf2f5c106e8ac0e0ee957524f2aa07ee -- test`
  passed: no frozen test or fixture changed.
- Direct `apply-source-review.mjs --help` output matched the previous committed
  implementation byte-for-byte. The frozen root/Harness/session help, machine
  command inventory, schema, and failure-output hashes also passed unchanged.
- Focused report-source, review, projection, render, CLI, and frozen-contract
  coverage passed: 196 tests, 0 failures.
- Installed-like Canvas and host-artifact coverage passed: 17 tests, 0 failures.
- `npm test` passed outside the restricted loopback sandbox: 767 tests, 0
  failures.
- `npm run pack:verify` passed outside the restricted npm-cache sandbox: the npm
  artifact contains 262 entries and the runtime zip contains 296 entries,
  including the five new owner modules and all four historical compatibility
  paths.
