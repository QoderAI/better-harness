# Native Harness run streams in Studio

## Traceability

- Spec ID: `2026-09-01-harness-native-studio-stream`
- Status: Implemented

## Intent

Remove AG-UI from the Harness Studio application path. Studio should execute,
stream, render, and retain runs through the host-neutral `HarnessRunEvent`
contract owned by `@qoder-ai/harness`, without translating those events into a
second protocol that has no independent Studio consumer.

The obsolete `@qoder-ai/harness-ui` AG-UI adapter is removed rather than kept as
a compatibility branch. Git history remains the recovery path; the application
and repository no longer carry its second run protocol, server, CLI, or release
practice. The package name was subsequently reused by the private organization
Dashboard defined in `2026-09-01-organization-harness-dashboard`; that
application does not restore AG-UI or Agent execution.

## Acceptance Scenarios

- **AC-1 — Core run orchestration:** `@qoder-ai/harness/exec` exposes one
  executor-injected run function that compiles, locks, resolves, and executes a
  Harness while producing a complete neutral `HarnessRunEvent` lifecycle for
  success and pre-execution, executor, and non-zero-exit failures.
- **AC-2 — Versioned browser contract:** `@qoder-ai/harness/protocol` owns a
  browser-safe run request and sequenced stream envelope. Studio validates the
  request and streams those envelopes over its same-origin local endpoint.
- **AC-3 — Native Debugger projection:** the Studio Run view folds neutral
  Harness events directly into the existing message, Tool Call, warning,
  permission, result, and terminal UI states. Duplicate or replayed sequence
  numbers do not append deltas twice.
- **AC-4 — No application AG-UI dependency:** production and test code under
  `packages/harness-studio` has no import from `@qoder-ai/harness-ui`, no
  `/agui` route, no AG-UI-named state/config/endpoint, and no AG-UI product copy.
- **AC-5 — Domain-native Artifact streams:** Artifact Agent progress and
  AgentReact observations use their own browser-safe Studio contracts instead
  of AG-UI `CUSTOM` envelopes.
- **AC-6 — Retained evidence compatibility:** previously saved Debugger run
  JSON remains readable because its persisted timeline shape is unchanged; new
  retained Sessions identify their protocol as Harness run evidence.
- **AC-7 — Adapter removal:** the legacy `packages/harness-ui` adapter source,
  release choice, root scripts, CI steps, package-lock dependency entry, and
  current product documentation are removed. Historical specs may retain
  factual references to the superseded implementation. A later private
  Dashboard may reuse the workspace name without restoring the adapter.
- **AC-8 — Product verification:** focused unit/server tests, Studio typecheck,
  the full Studio suite, and changed-surface Playwright checks pass without
  browser console or page errors at wide, compact, and narrow layouts.

## Non-goals

- Treating the loopback Studio server as a Team or Org gateway.
- Adding remote authentication, tenancy, persistence, upload, or Control Plane
  APIs.
- Redesigning the Debugger information architecture or visual language.
- Migrating historical specs that accurately describe earlier AG-UI behavior.

## Plan and Tasks

1. Move generic compile/resolve/execute orchestration into
   `packages/harness/src/exec/run.ts` and keep executors injected.
2. Add browser-safe request and sequenced event-envelope contracts under
   `packages/harness/src/protocol/` with no Node or host SDK dependencies.
3. Add a Studio-owned same-origin run stream handler and route local Harness and
   ACP execution through it.
4. Replace `agui-store` with a native `run-store`, preserving the timeline and
   saved-record shape while adding sequence replay protection.
5. Replace Artifact Agent and AgentReact AG-UI custom envelopes with
   domain-specific Studio contracts.
6. Remove the Studio package dependency, AG-UI labels, route names, imports,
   and test fixtures. Keep the retained timeline JSON schema unchanged without
   introducing a protocol compatibility branch.
7. Delete `@qoder-ai/harness-ui` and remove its workspace, CI, release, lockfile,
   documentation, and Studio dependency surfaces.

The package decision is intentionally smaller: neutral execution and wire
contracts belong to Harness; application projection and local transport belong
to Studio. No package remains solely for AG-UI interoperability.

## Test and Review Evidence

- **AC-1/AC-2/AC-7:** focused `@qoder-ai/harness` run and protocol tests plus
  legacy adapter source, CI, release, lockfile, and dependency inspection.
- **AC-3/AC-5/AC-6:** focused Studio run-store, Artifact Agent, AgentReact,
  run-log, and server tests using parsed event objects rather than source-text
  matching.
- **AC-4:** dependency and route inspection plus package build/typecheck. The
  application check is scoped to `packages/harness-studio`; superseded specs
  retain factual AG-UI references only as historical decision records.
- **AC-8:** `npm run typecheck -w @qoder-ai/harness-studio`,
  `npm test -w @qoder-ai/harness-studio`, and focused Playwright runs against a
  built preview at 1440x900, 1024x768, and 390x844 with console/page-error
  inspection and screenshots.

Primary risks are an incomplete terminal lifecycle after moving orchestration,
double-applying streamed deltas after reconnection, breaking pending ACP
permission handling, or accidentally changing the persisted timeline shape.
The tests must exercise each risk directly.

Implemented verification:

- `npm test -w @qoder-ai/harness` — 22 files, 179 tests passed.
- `npm run typecheck -w @qoder-ai/harness-studio` — passed.
- `npm test -w @qoder-ai/harness-studio` — 65 files, 507 tests passed.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` — 8 tests passed.
- `npx playwright test test/browser/acp-debugger.spec.mjs` — wide, compact,
  and narrow Debugger interaction passed with no console or page errors.
- Sequential `npm pack --dry-run` checks passed for `@qoder-ai/harness` and
  `@qoder-ai/harness-studio`.
