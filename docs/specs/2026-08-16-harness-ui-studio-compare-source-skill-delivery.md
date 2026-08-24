# Thread source-backed skill delivery through harness-ui, harness-studio, and compare

## Traceability

- Spec ID: harness-ui-studio-compare-source-skill-delivery
- Status: Implemented
- Refs: [2026-08-16-harness-review-remediation.md](./2026-08-16-harness-review-remediation.md)

## Intent

The prior remediation made `resolveHarness` and the core executors honest about
`source`-backed skills: a revision only records `delivered` guidance once the
declared `SKILL.md` was actually read and inlined, and a caller who skips
`loadSkillDeliveries()` gets a run warning instead of a silent gap.

That fix covered `packages/harness`'s own executors. It did not cover the
package's three real callers of those executors:
`@qoder-ai/harness-ui` (the AG-UI HTTP server), `@qoder-ai/harness-studio`
(the local React studio, which embeds the same endpoint), and
`packages/harness/src/compare/runner.ts` (the benchmark pipeline). None of the
three ever called `lockCapabilitySources()` or passed a `sourceRoot` to the
executor, so a harness declaring a `source`-backed skill failed resolution
outright (`"requires exactly one content lock"`) the moment it reached any of
these three surfaces — the only places most users actually run a harness.

This change closes that gap by threading the same root through all three,
using the same convention already used elsewhere in the codebase: relative
paths in a document resolve against that document's own directory.

## Non-goals

- Changing the `harness-compare.v1` manifest schema. The compare pipeline's
  source root is the directory containing the manifest-selected `.harness`
  file, matching the UI and Studio convention without a new manifest field.
- Supporting a source root that differs from the harness file's directory in
  `harness-ui`/`harness-studio` without an explicit flag. The default is a
  convenience, not a constraint: `--source-root` overrides it.

## Acceptance scenarios

- **AC-1** — `POST /agui` against a harness with a `source`-backed skill and
  no `--source-root` fails the run with a "content lock" error instead of a
  silently undelivered skill.
- **AC-2** — The same request with `--source-root` (or the CLI default: the
  harness file's own directory) resolves, locks, and delivers the skill; the
  executor receives a revision with a non-empty `sourceLocks` entry for it.
- **AC-3** — `harness-studio`'s embedded `/agui` endpoint (and its own
  `--source-root`, defaulting from `--harness`) behaves identically.
- **AC-4** — `runHarnessComparison` locks every source-backed skill declared
  by the compared harness against the harness file's own directory before
  resolving either variant, and passes that same root to the executor for
  every trial.
- **AC-5** — `loadSkillDeliveries`, `SkillDelivery`, `SkillDeliveryMap`,
  `HarnessSkillDeliveryError`, `MAX_DELIVERED_SKILL_BYTES`, and
  `SKILL_ENTRY_FILE` are exported from `@qoder-ai/harness/exec`, so a
  third-party `HarnessAdapterV1` implementation can build correct delivery
  without reaching into the package's internal module paths.

## Changes

| Area | Change |
| --- | --- |
| `packages/harness/src/exec/index.ts` | Export the `skill-delivery` module's public surface |
| `packages/harness-ui/src/run.ts` | `HarnessAguiRunOptions.sourceRoot`; locks sources before resolving, forwards the root to the executor |
| `packages/harness-ui/src/server.ts` | `HarnessUiServerOptions.sourceRoot`, forwarded to `runHarnessAgui` |
| `packages/harness-ui/src/cli.ts` | `--source-root <dir>`, defaulting to the harness file's own directory |
| `packages/harness-studio/src/server/server.ts` | `HarnessStudioServerOptions.sourceRoot`, forwarded to `handleAguiRun` |
| `packages/harness-studio/src/server/cli.ts` | `--source-root <dir>`, defaulting from `--harness`'s directory |
| `packages/harness/src/compare/runner.ts` | Locks sources against the harness file's directory before resolving either variant; forwards the root to every trial's executor call |

## Test evidence

- Root suite: 1,325 tests pass.
- `packages/harness`: 152 tests pass (`compare.test.ts` proves a nested harness
  resolves its source relative to its own directory and the executor can load
  the locked `SKILL.md` body from the forwarded root). The test authors its
  source-backed harness fixture directly, so Windows CRLF checkout settings do
  not control whether the required skill binding is inserted.
- `packages/harness-ui`: 29 tests pass (fail-closed without a root, successful
  `SKILL.md` delivery with one, and CLI default/override resolution).
- `packages/harness-studio`: 31 tests pass (embedded `SKILL.md` delivery and
  CLI default/override resolution are covered directly).
- `npx tsc --noEmit` passes for all three packages.
- Generated Langium sources are current; package verification passes with 528
  npm entries and 550 runtime-zip entries.

## Risk

- None of these changes alter behavior for a harness whose skills are
  `description`-only (the shipped `readme-compare` benchmark and every
  existing `harness-ui`/`harness-studio` test fixture): `lockCapabilitySources`
  and `loadSkillDeliveries` are no-ops when no skill declares a `source`.
- The CLI default (harness file's own directory) is new behavior for anyone
  who *does* declare a `source` skill and serves it through `harness-ui` or
  `harness-studio` — previously that combination always failed, so there is no
  working prior behavior to preserve.
