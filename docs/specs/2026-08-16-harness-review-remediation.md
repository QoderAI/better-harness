# Close the harness review's honesty and boundary gaps

## Traceability

- Spec ID: harness-review-remediation
- Status: Implemented

## Intent

A review of `packages/harness` found that the package's central claim — a
resolved revision states what a run *really* got, not what its author hoped for
— was not upheld on several paths. The largest gap sat exactly where the design
invested most: a `source`-backed skill was locked byte-for-byte, resolved as
`advisory` guidance, and recorded in the materialization receipt as
`delivered / materialized`, while the executor put nothing but the source
*path* into the prompt. The lock protected content no code ever read.

This change makes the recorded facts true, and closes the smaller boundary and
validation gaps found alongside them.

## Non-goals

- Making any shipped adapter materialize MCP connections, per-agent sessions, or
  programmatic workflows. Those stay declaration-only, as before.
- Adding authentication to the `harness-ui` AG-UI endpoint. This change makes
  the missing authentication a bind-time decision instead of a silent default.
- Replacing the portable SHA-256 in `ir/canonical.ts`. `test/module-graph.test.ts`
  keeps the core and browser-verdict entries free of `node:` imports, so that
  implementation is a requirement, not duplication.

## Acceptance scenarios

- **AC-1** — A revision realizing a `source`-backed skill delivers that skill's
  `SKILL.md` text into the run preamble, names the remaining files in the tree
  as further reading, and truncates an oversized body with an explicit run
  warning.
- **AC-2** — A skill source that cannot be delivered (no entry file, unreadable
  path, missing source root) fails the run before the host SDK loads, rather
  than degrading into a path reference.
- **AC-3** — `buildRunPreamble` called without deliveries still reports a
  source-backed skill as undelivered, so a third-party executor cannot
  accidentally reproduce the original gap through the public API.
- **AC-4** — `materializePiPackage` writes a source-backed skill's real bytes
  and copies its reference files, instead of a generated stub naming the path.
- **AC-5** — `resolveHarness` fails when the supplied realization descriptor's
  `adapterId` differs from the adapter the selected runtime declares.
- **AC-6** — A declarative workflow with no `stop when` fails compilation, as
  does a harness agent role its declarative workflow never references.
- **AC-7** — `resolveHarness` freezes only the revision: the caller's bundle and
  the returned `ResolutionReport` stay mutable and unaliased.
- **AC-8** — A caller-supplied `toolExposure` entry the standard map does not
  contain is honoured through `doStart`; a standard capability remapped to a
  different host tool is still rejected as registry drift.
- **AC-9** — A permission grant counts as enforced only when the adapter
  declares that exact domain/access pair.
- **AC-10** — `startHarnessUiServer` and `startHarnessStudioServer` refuse a
  non-loopback bind address unless the caller passes `allowRemote`
  (CLI: `--unsafe-allow-remote`), which also prints a warning.

## Changes

| Area | Change |
| --- | --- |
| `exec/skill-delivery.ts` (new) | Reads declared skill sources under the locked root, bounded at 32 KiB, sharing the lock module's containment checks |
| `exec/executor.ts` | Preamble inlines delivered skill bodies; warns when a source-backed skill arrives undelivered |
| `exec/qoder-sdk.ts`, `exec/pi-sdk.ts` | Load deliveries in `doStart`; Pi package materialization copies real skill files |
| `resolver/resolve.ts` | Descriptor/runtime adapter identity check; revision cloned before freezing; single-realization return |
| `resolver/source-lock.ts` | Exported `resolveContainedSource`; file digests use `node:crypto` on this Node-only path |
| `resolver/adapter-descriptor.ts` | `enforcedPermissionDomains` → `enforcedPermissions` (grants); added `descriptorsEqual` |
| `compiler/compile.ts` | Reject a declarative workflow with no stop condition, and an unreferenced agent role |
| `ir/canonical.ts` | Added `contentEquals`; documented why the digest is not `node:crypto` |
| `harness-ui`, `harness-studio` | Bind-address boundary with explicit opt-in |
| package scripts | `pretest` builds, so a clean checkout no longer fails on a missing `dist/` |

## Test evidence

- `packages/harness`: 143 tests pass, including a new `test/skill-delivery.test.ts`
  (6 cases) and new cases in `compile`, `resolve`, and `exec` suites.
- `packages/harness-ui`: 26 tests pass, including the bind-address boundary.
- `packages/harness-studio`: 29 tests pass.
- End-to-end: a stubbed Qoder host records the prompt it received and shows the
  skill's `SKILL.md` body inlined, where it previously received only the path.

## Risk

- **AC-6 is a breaking compile change.** Existing `.harness` documents with a
  stop-free declarative workflow or an unreferenced agent role now fail to
  compile. Both were previously silent defects; the diagnostics name the fix.
- **AC-5 is a breaking resolve change** for callers that passed a descriptor not
  matching the runtime's declared adapter. Those resolutions produced
  self-contradicting revisions.
- `enforcedPermissions` renames a descriptor field. No shipped adapter enforced
  anything, so every shipped descriptor's value is unchanged (`[]`).
