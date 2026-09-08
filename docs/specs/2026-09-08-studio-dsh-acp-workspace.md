# Use the official DSH interface inside Studio

## Traceability

- Spec ID: studio-dsh-acp-workspace
- Status: Implemented (local validation)
- Request: maintainer clarified that the dedicated page must reuse DSH's official
  interactive UI. The earlier ACP conversation page does not meet this intent.
- Decision: [Official DSH workspace](../adrs/studio-dsh-acp-workspace.md)

## Intent

Open and use the installed official DSH Web application inside Studio Desktop.
Keep ACP available for Compare and Debugger separately.

## Acceptance scenarios

- **AC-1:** DSH ACP discovery keeps portable PATH/argv and explicit overrides.
- **AC-2:** The DSH page embeds upstream UI and native runtime, with no Studio
  ACP composer. Missing installation, no Project and read-only Project have
  honest setup states. Web availability is independent of ACP availability.
  The launch pane has one Start DSH button; the DSH title has no action buttons.
  On launch, only the official application occupies the pane.
- **AC-3:** Explicit launch binds initial cwd from the current server-owned
  Project/revision. Stale/cross-origin requests cannot launch or stop a host.
  Concurrent opens and different Studio Projects reuse one Web process. Failed
  startup, early exit and retry work.
- **AC-4:** DSH authenticates on its own loopback origin. Studio credentials,
  launch URLs and subprocess diagnostics do not leak into logs or persistence.
  Its official composer, session navigation and settings remain usable.
- **AC-5:** Page navigation and Project changes retain the official frame; DSH itself
  owns workspace selection. Host stop and Studio shutdown clean up owned hosts.
  Runtime death is visible without automatically replaying work.
- **AC-6:** Check keyboard focus, bounded overflow, console/page errors and
  screenshots at wide, compact and narrow layouts, including real Desktop.

## Non-goals

Installing or vendoring DSH, changing upstream code, rebuilding its components,
synchronizing session selection with Compare, restricting DSH's native workspace
selector, introducing Point Go, or claiming real model/platform execution from
fixtures or startup-only evidence.

## Plan and tasks

1. Correct ADR/spec to official UI ownership before implementation.
2. Add an explicit host-owned Web application provider with bounded lifecycle;
   wire Desktop discovery and guarded Studio Project routes.
3. Replace DshWorkspace ACP controls with one launch button and isolated frame;
   retain Studio navigation and upstream interactive behavior.
4. Test provider failure/authority cases and browser controls; exercise the
   installed native Web UI in Electron and inspect three-width screenshots.
5. Run relevant Studio/Desktop checks, doc link graph and preview smoke.

## Test and review evidence

- Node 24 Studio build/typecheck passed. Full Studio Vitest run: 81 files /
  610 tests passed. The subsequently added running-host crash scenario and
  shell-model regression run also passed (24 tests). Lifecycle coverage includes
  concurrent opens, a different requested cwd reusing the same host, stop/reopen,
  timeout, oversized output, missing executable, exit, retry and readiness URL
  validation (AC-1 through AC-5).
- Playwright `dsh-workspace.spec.mjs`: 6 passed. Fixture container tests exercise
  focus, retained draft through page navigation, empty title actions and layout at
  1440/1024/390 widths. API tests reject stale and cross-origin launches. The real
  installed DSH test opens its official settings UI (AC-2 through AC-6).
- Real Electron smoke: `DSH_WEB_ENTRY=<installed CLI entry> node
  packages/better-harness-desktop/scripts/dsh-smoke.mjs` passed against upstream
  `0a53fb55bea101816fa226bb964ae2bed71c343b`. It loads the official UI, types into
  its native composer without submission, navigates away/back with draft retained,
  checks keyboard focus and three window sizes, then closes Studio and verifies
  its DSH endpoint has stopped. Renderer
  sandbox remains enabled; no Studio token reaches the DSH origin; console/page
  errors during interaction are empty. Teardown-only stream diagnostics are
  recorded separately when the host closes. Local screenshots and receipt are in
  `packages/better-harness-desktop/dist/dsh-acceptance/`.
- The first Electron attempt exposed a blocked DSH cookie-exchange redirect.
  Restricting the existing top-level navigation guard to main-frame redirects
  fixed it. UI acceptance waits for actual official controls, not iframe load.
- Desktop unit suite: 6 passed. Markdown link graph: 8 passed; generated routing
  graph unchanged. `git diff --check` passed.
- Required Canvas preview attempt remains blocked by missing Canvas SDK runtime.
  `/health` and `/canvas-module.js` were therefore not verified; this is separate
  from the passing Studio browser and native Desktop UI checks.

### Review readiness

The maintainer request and clarification are the scope authority; no Story id was
provided. ADR-0008 is Proposed. Changed modules are the DSH Web host, guarded
Project routes, dedicated UI and shell embedding, with retained ACP discovery.
No copied third-party source or release/version edits. The maintainer authorized
a scoped commit and draft PR, followed by a similar Pi integration and footprint
comparison. This spec covers the DSH checkpoint only.
AI implementation: Codex. The original ACP-page
screenshots are superseded by official-UI receipts. No real model prompt was
sent; tool/approval execution is upstream-owned and was not exercised here.
Native Windows/Linux, packaging/signing and hosted CI remain unverified.

## Risks

The installed Web profile and frontend must be usable. DSH owns provider access,
policy and writable directories. Its native directory selector can leave the
initial Studio Project. Native Windows/Linux and model execution require their
own receipts; macOS UI checks do not establish either.
