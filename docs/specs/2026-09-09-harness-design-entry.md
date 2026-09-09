# Name the runtime workbench Harness Design

## Traceability

- Spec ID: harness-design-entry
- Status: Implemented (local browser validation)
- Request: name the entry Harness Design. No Story id supplied.

## Intent and acceptance

Group the existing DSH and Pi workspaces under one Harness Design navigation
entry. Keep their official interfaces and runtime ownership unchanged.

- **AC-1:** English and Chinese sidebars and page titles display Harness Design.
  DSH and Pi are selectable within the page; the title contains no new actions.
- **AC-2:** Selection works by pointer and keyboard, retains the existing deep
  links and browser history, and remembers the selected runtime when returning
  from another page. Switching does not relaunch or unmount native workspaces.
- **AC-3:** Each runtime retains its single launch button and setup state.
  Verify focus, draft retention, console/page errors and bounded layouts at
  1440, 1024 and 390 pixels.

## Plan and non-goals

Reuse existing shell navigation, semantic tokens, DSH frame and Pi terminal.
Merge only their sidebar representation; retain runtime routes and readiness
records. Update affected browser/native-smoke selectors. This does not connect
the separate WASM compiler experiments or modify installed upstream interfaces.

## Evidence and risk

- Studio build/typecheck passed on Node 24.20.0.
- DSH/Pi Playwright checks: 9 passed, 1 native DSH case skipped because no
  installed CLI was configured for this run. Browser fixtures verify the new
  entry/title, keyboard runtime switching, history back, runtime selection on
  return, draft retention and unchanged control guards. Zero console/page
  errors. Launch/container screenshots reviewed at 1440/1024/390 widths.
- Eight document-link checks pass; regenerated routing graph is unchanged.
- Canvas preview was attempted but cannot start without its SDK runtime;
  its health and module endpoints remain unverified.
- Native Desktop smoke selectors were updated, but installed DSH/Pi, packaged
  Desktop, Windows/Linux and hosted CI were not revalidated for this UI change.

Readiness review: shell composition, two locale labels, scoped shared-token
styles and affected browser/native-smoke selectors serve AC-1 through AC-3.
Existing runtime routes, readiness records and host authority are unchanged.
Both runtime components stay mounted; the browser tests exercise the primary
draft-loss risk. No dependency, release or unrelated files are included. The
scoped commit records its AI co-author and validation explicitly.
