# Local multi-project Dashboard

## Traceability

- Spec ID: `2026-09-02-local-multi-project-dashboard`
- Status: Implemented
- Extends: `2026-09-01-organization-harness-dashboard`

## Intent

Let the local Harness Dashboard switch between several explicitly configured
workspaces while keeping the current single-workspace collector and charts as
the source of truth. This is the smallest useful step from a repository view
toward an organization view: one local process can inspect several projects,
but it does not claim cross-machine identity, remote ingestion, or organization
governance.

Harness Studio and Harness UI continue to share the existing
`scripts/session-analysis/` owner for Session evidence. This change does not
move Dashboard-specific projections into Studio or introduce a second Session
collector.

## Acceptance Scenarios

- **AC-1 — Local project identity without path disclosure:** each collected
  Dashboard input includes a deterministic, opaque workspace id and its existing
  human label. The id is stable for the same normalized local path, distinct for
  different local paths with the same basename, and the emitted Dashboard input
  does not expose the absolute path.
- **AC-2 — Explicit multi-project configuration:**
  `BETTER_HARNESS_WORKSPACES` accepts a platform-delimited list of workspace
  paths, normalizes and de-duplicates them, and takes precedence over the
  existing singular `BETTER_HARNESS_WORKSPACE`. With neither configured, the
  current repository fallback remains unchanged.
- **AC-3 — One collector contract per project:** the server invokes the existing
  local Dashboard collector once per resolved workspace and returns every
  project input through one bounded refresh cache. Provider and session-limit
  options apply consistently to every invocation. The collector CLI remains a
  parser-safe, single-workspace JSON command.
- **AC-4 — Project-scoped UI:** when more than one project is supplied, the page
  exposes one labelled project selector in the compact header and every metric,
  chart, asset count, delivery row, and operational detail updates to the
  selected project. A single project renders the current compact header without
  a redundant selector. Visible provider terminology uses `Agent source` rather
  than implying a physical machine.

## Non-goals

- Stable identity across machines or clones, machine registration, heartbeat,
  or cross-machine Session de-duplication.
- Remote upload, authentication, organization/team permissions, or an
  organization-wide aggregate across projects.
- Changing Session references or introducing a new Session schema.
- Replacing Harness Studio project ids or embedding this Dashboard in Studio.
- Automatically scanning parent directories or remembering projects outside
  the explicitly configured environment variable.

## Plan and Tasks

1. Add pure workspace-list resolution and opaque local workspace identity to
   the existing Harness UI scripts using `node:path` and `node:crypto`.
2. Extend the server data loader to run the unchanged single-workspace collector
   for each configured workspace and cache the resulting list.
3. Extend the typed Dashboard boundary and client component with a conditional,
   accessible project selector; keep single-project rendering unchanged.
4. Replace ambiguous visible `host` labels with `Agent source` where the value
   is a coding-agent provider rather than a physical machine.
5. Add focused behavior tests, production build evidence, and wide, compact,
   and narrow browser evidence.

## Test and Review Evidence

- **AC-1, AC-2:** focused `workspace.mjs` tests cover normalized de-duplication,
  same-basename isolation, singular fallback, platform-delimited input, and
  absence of absolute paths in the emitted identity. The focused local-data and
  Dashboard-model run passes 20 tests.
- **AC-3:** local-data tests assert one collector argv per resolved workspace,
  shared provider/limit options, and refresh-cache behavior. A live bounded
  collection used the same `codex` collector for `better-harness` and
  `canvas-sdk`; the two projects remained separate at `5/150` and `5/292`
  analyzed/eligible Sessions.
- **AC-4:** a focused component test asserts that project options keep each
  project's own id and label and that selecting the second id yields that
  project's input while an unknown id falls back to the first. The repository
  Playwright suite covers the single-project case: the Project selector is
  absent, and no page overflow or console errors appear at 1440x900, 1024x768,
  and 390x844. The multi-project selector rendering and keyboard pass were
  verified manually with two configured workspaces and are not part of the
  committed Playwright suite. The suite runs on port 3412; port 3410 was already
  occupied by an unrelated local Node listener.
- **Build and regression:** `npm run build -w @qoder-ai/harness-ui` succeeds with
  the 13 existing dynamic-filesystem tracing warnings. The full package run
  reports 37 of 38 tests passing, with one `upload-dashboard-e2e` case exceeding
  the shared 5-second timeout at roughly 5.0s; a focused
  `test/upload-dashboard-e2e.test.mjs` run passes all 4 tests, so the failure is
  a pre-existing timeout margin rather than a regression from this change. The
  doc-link graph test passes all 8 tests.
- **Risk:** collecting several repositories increases refresh work linearly.
  Collection remains explicitly configured and cached; automatic discovery and
  unbounded concurrency are excluded.
