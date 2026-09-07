# Harness Studio Desktop

## Traceability
- Spec ID: harness-studio-electron-shell
- Status: Implemented
- Request: migrate Studio to Electron and prepare ACP/oxc for later XPC services.
- AI involvement: implementation and local validation by Codex.

## Intent
Add a desktop distribution that reuses Studio's browser UI and HTTP contracts.
Keep the window main process independent of Studio's Node/native dependencies.

## Acceptance Scenarios
- AC-1: A desktop command opens the built Studio UI on an ephemeral IPv4 loopback port, in a sandboxed renderer without Node or preload privileges.
- AC-2: Studio runs in an Electron utility process; a versioned, bounded message protocol owns startup, native directory selection, failure and shutdown. Server exit closes the app with a visible error; app exit stops the service.
- AC-3: Open Project uses Electron's native directory dialog through the existing server injection point. Cancellation and errors settle the pending request. Browser CLI behavior is retained.
- AC-4: External navigation and popups cannot replace the trusted window or execute arbitrary external protocols. Desktop HTTP requires a per-launch secret supplied only by the desktop session.
- AC-5: A repository build creates desktop packaging inputs and an unpacked local app. Native modules and WASM remain available. Local Electron smoke verifies the actual UI, Node version, oxc parsing, service isolation and cleanup.

## Non-goals
No ACP/parser service extraction yet, macOS NSXPC implementation, UI redesign,
deep links, updater, signing, notarization, publication, or host adapter changes.
XPC here establishes cross-process ownership; Electron utilityProcess is the
initial portable transport, not a claim of native macOS NSXPC support.

## Plan and Tasks
1. Add private `packages/harness-desktop` workspace with Electron main, utility
   entrypoint, bounded protocol, native menu and platform-neutral lifecycle.
2. Export the existing bundled workspace provider through Studio's public API;
   add optional HTTP access token guarding desktop requests only.
3. Keep renderer fetch/SSE and browser CLI unchanged. Use native window chrome.
4. Build Harness then Studio serially; stage production dependency closure for
   electron-builder, unpack native modules, and provide local packaging/smoke commands.
5. Exercise protocol/security behavior, Studio regression tests, native smoke,
   docs graph and preview health/runtime checks. Record proof boundaries below.

## Test and Review Evidence
Local macOS arm64 validation completed on 2026-09-07:

| Acceptance | Evidence |
| --- | --- |
| AC-1, AC-4 | Real Electron and packaged-app Playwright smoke: renderer has no require/process, sandbox/contextIsolation enabled, unauthenticated HTTP returns 401, session API returns 200. |
| AC-2, AC-3 | Six Node behavior tests cover ready validation, directory selection/cancel/error correlation, startup crash/timeout, unexpected exit and bounded shutdown. Native smoke exercises real HTTP/utility/main round trips with only the OS dialog result stubbed; selection and cancellation pass. |
| AC-3, AC-4 | Studio vitest: desktop-authorization, project-server and server suites, 60 tests pass. |
| AC-5 | Harness and Studio build; production staging and electron-builder --dir pass. The unpacked macOS arm64 app launches under Playwright, Node 24.20.0 and oxc parse probe pass. Main/service PIDs differ; after quit the service URL is unreachable. |
| Visual | Packaged app screenshots at 1440x900, 1024x768 and 390x844 inspected; keyboard focus, bounded document overflow, no console/page errors. Existing Studio UI retained. |
| Repository | Docs graph regenerated without tracked drift; 8 doc-link tests pass. Preview health and canvas-module.js both return 200. git diff --check passes. |

Commands: `npm run harness-desktop:build`, `npm run harness-desktop:test`,
`npx vitest run test/desktop-authorization.test.ts test/project-server.test.ts test/server.test.ts`
(from Studio), `npm run stage -w @qoder-ai/harness-desktop`,
`npm exec -w @qoder-ai/harness-desktop -- electron-builder --dir -c.mac.identity=null`,
`npm run smoke -w @qoder-ai/harness-desktop -- --packaged`.

Local generated evidence lives in `packages/harness-desktop/dist/smoke/`;
application is `dist/installers/mac-arm64/Harness Studio.app` under that package
(494 MiB reported by local du). Neither is committed. OS dialogs are stubbed in
smoke; manual interaction with the native chooser is not claimed.

Review Readiness Check: request and spec confirmed; no Story id supplied.
Changed modules are desktop shell/build/tests, three narrow Studio public/server
seams, workspace manifest/lockfile and desktop CI. All changes are unstaged;
no commit or publication performed. AI involvement is declared above. Existing
lockfile package versions did not change; new packaging dependencies and npm
hoisting account for lockfile churn. Generated Harness sources and docs graph
have no tracked changes.

Target Windows, macOS and Linux through Node path/argv APIs and a new native
CI matrix. Windows/Linux CI receipts remain unavailable until that workflow
runs. Local macOS evidence does not prove those platforms, signed distribution,
or live ACP provider execution. Production staging resolves npm dependency
ranges, so release reproducibility/locking remains outside this initial shell.

ACP and oxc initially remain inside the Studio service (oxc also uses the
existing compiler worker). Future service extraction must retain domain-owned
APIs and introduce explicit versioned request/cancel/result/error contracts;
do not expose generic execution or filesystem IPC to the renderer.

The utility process hosts Studio in a Node worker. PDF.js checks Electron
process identity and otherwise selects browser-only globals in utilityProcess;
the Node worker preserves its actual Node execution path without mutating
`process.type`, patching dependencies, or adding renderer privileges.
