# Bring the Inspector workbench into Studio

## Traceability

- Spec ID: studio-native-inspector-workbench
- Status: Implemented

## Intent

Move the Harness Inspector workbench experience into the Studio `/#/inspector` surface so reviewers can inspect retained delivery evidence without leaving the Studio shell. The migration keeps the existing self-contained Inspector HTML report as the authoritative offline artifact and compatibility fallback, while adding a native Studio mounting path that reads the report data through a server JSON boundary and runs a copied workbench asset inside the Studio page.

## Acceptance Scenarios

- AC-1: Starting Studio with `--inspector <report.html>` enables `/#/inspector`; when the report contains `HarnessInspectorReportV1` data, the page renders an in-Studio Inspector workbench without the iframe being the primary surface.
- AC-2: The server exposes the privacy-filtered Inspector report data through a same-server JSON endpoint derived from the configured report only. Missing, unreadable, or non-workbench HTML does not expose arbitrary files and produces a bounded error.
- AC-3: The native workbench uses a copied Inspector workbench asset in the Studio app bundle, keeps CSS isolated from Studio shell styles, and preserves the existing Capability/Date, Session, Trace/Replay, activity chart, and deep-link behavior as owned by the copied workbench.
- AC-4: Existing `/inspector` HTML serving remains available and `/#/inspector` falls back to the legacy sandboxed iframe when the configured HTML is not a structured Inspector workbench report.
- AC-5: Tests cover the JSON extraction contract, fallback behavior, and build integration. Browser smoke evidence verifies the native Inspector workbench loads in Studio without console or page errors.

## Non-goals

- Rewriting every Inspector workbench interaction as first-class React components in this change.
- Changing the Harness Inspector report model, privacy filtering, correlation logic, or static HTML renderer output.
- Adding write, resume, checkpoint mutation, or execution controls to the read-only Inspector surface.
- Removing the existing `/inspector` compatibility route.

## Plan and Tasks

1. Add a server-side Inspector JSON query helper that extracts and validates the `inspector-data` JSON from the configured self-contained HTML report.
2. Add `/api/inspector-report` to the Studio server with `no-store` JSON responses and bounded errors when no structured report is available.
3. Copy the Inspector workbench JavaScript and CSS into the built Studio app assets during `harness-studio` build.
4. Add a native `InspectorWorkbench` React component that fetches the report JSON plus copied assets, mounts the copied workbench into an isolated Shadow DOM, and scopes the workbench's document access to that mount.
5. Replace the iframe-first `InspectorWorkspace` with the native component while retaining a sandboxed iframe fallback to `/inspector`.
6. Add focused Vitest coverage for report JSON extraction and server route behavior, then run the Studio build/test gate and a browser smoke check against a real Inspector report.

## Test and Review Evidence

- AC-1/AC-3/AC-4: Browser smoke opened `http://127.0.0.1:3311/#/inspector` with `.qoder/native-studio-inspector.html`; the page rendered native `Harness Inspector`, `Capability`, and `Date` content, `/api/inspector-report` plus copied workbench assets returned 200, iframe count was 0, and no console or page errors were observed.
- AC-2: `npm run harness-studio:test` passed 82 tests, including server coverage for valid structured Inspector JSON, 204 fallback for non-workbench Inspector HTML, missing-report errors, and unchanged `/inspector` HTML serving.
- AC-5: `npm run harness-studio:build`, `npm test -w @qoder-ai/harness-studio -- server.test.ts`, `npm run harness-studio:test`, and `npm run harness-studio:test:browser` passed after the fallback response was changed to 204 to avoid browser console noise during legacy iframe fallback.
