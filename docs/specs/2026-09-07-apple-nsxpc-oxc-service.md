# Apple NSXPC transport for Rust OXC

## Traceability
- Spec ID: apple-nsxpc-oxc-service
- Status: Implemented
- Request: implement Apple NSXPC; all capability services use Rust.
- Implementation: Codex; no external Story/issue was supplied.

## Intent
Run macOS desktop OXC parse/transform through an actual bundled Foundation
NSXPC service, keeping the existing Node semantic compiler and Windows/Linux
Rust stdio transport.

## Acceptance Scenarios
- AC-1: A Rust client connects using NSXPCConnection to a launchd-started Rust
  service in Contents/XPCServices. Real parse/transform replies identify a
  service PID distinct from the client and Studio process.
- AC-2: Only a bounded versioned NSData request/reply method is exported; the
  existing source, filename, operation and output limits remain enforced.
- AC-3: Connection failure and deadlines fail pending work without replay or
  silent stdio fallback. Closing a compiler closes its bridge/connection; a new
  compiler can reconnect after a service crash. Service lifetime belongs to
  launchd, not to the Node process PID owner.
- AC-4: Development and packaged macOS app both discover the bundled service.
  Windows/Linux preserve the current executable and stdio contract.
- AC-5: Native tests prove OXC parity, native transport identity and failure
  recovery; packaged Electron smoke proves NSXPC use without OXC NAPI loading.

## Non-goals
ACP extraction, Node host replacement, public Mach services, distribution
signing/notarization, auto-update, renderer IPC migration, and new OXC language
semantics.

## Plan and Tasks
- Share Rust compiler core between stdio and NSXPC entry points.
- Use Foundation bindings from Rust for listener, exported object and client;
  a declaration-only Objective-C file emits Clang protocol metadata, and the
  Rust reply block supplies an explicit NSData ABI signature;
  retain a small bounded stdio bridge at the Node boundary. It performs no
  compilation and communicates with the service exclusively over NSXPC.
- Bundle a private helper app for development; put the client in the packaged
  app executable directory and the service in its XPCServices directory.
- Carry transport and native service identity separately from bridge PID.
- Add packaging, connection lifecycle and real native integration receipts.

## Test and Review Evidence
Local validation on macOS arm64 with Xcode 26.6, Rust 1.96.0 and Electron
44.2.0 (embedded Node 24.20.0):

- AC-1/AC-4/AC-5: `npm run better-harness-desktop:pack` passed. Development
  `npm run smoke -w @qoder-ai/better-harness-desktop` and packaged
  `node packages/better-harness-desktop/scripts/smoke.mjs --packaged` passed.
  Packaged receipt: main PID 19616, Studio PID 19681, bridge PID 19684,
  NSXPC service PID 19685, transport `nsxpc`, OXC NAPI not loaded. Renderer
  isolation, authenticated HTTP, directory flow, three viewport screenshots,
  error-free page and host/bridge shutdown checks passed. Receipt and images
  are generated under `packages/better-harness-desktop/dist/smoke`.
- AC-2/AC-5: `npm run test:rust -w @qoder-ai/better-harness-desktop`: 5 passed.
  Shared compiler behavior is preserved by moving it into the Rust library.
- AC-2/AC-3/AC-4/AC-5: `npm run test:native -w @qoder-ai/better-harness-desktop`:
  16 passed, exercising stdio and NSXPC semantic parity, HTTP build/preview,
  concurrent correlation, malformed output, cancellation, deadlines, actual
  SIGSTOP/SIGKILL of the NSXPC service, reconnection, and refusal of stdio when
  NSXPC is required.
- AC-4: `npm run better-harness-desktop:test`: 6 passed. `codesign --verify --strict`
  passed for the packaged XPC bundle (ad-hoc signature).
- Repository checks: `npm run preview`, `/health` and `/canvas-module.js` both
  HTTP 200; owned preview process stopped. Documentation routing regenerated
  without diff; `npx vitest run test/skills-docs/doc-link-graph.test.mjs`:
  8 passed. `git diff --check` passed.

An initial development smoke overlapped build output cleanup and timed out;
its isolated rerun after build completion passed. Future build and smoke runs
must be sequential. An initial native probe exposed a missing Rust reply-block
signature; the explicit NSData encoding fixes the actual Foundation exception.

## Review Readiness

Request/spec/implementation/tests match AC-1 through AC-5. Changed modules are
Rust compiler transport, desktop packaging/lifecycle, the Studio native adapter,
focused tests and documentation. Cargo.lock contains native binding/build
requirements; generated binaries and screenshots remain ignored. No renderer
business logic or release versions changed. All changes are local and unstaged.

Windows/Linux retain stdio and platform-gated Rust imports/build behavior; their
existing desktop CI jobs remain authoritative, and were not run here. macOS
x64 was not executed locally. Distribution signing/notarization and App Sandbox
entitlements are not configured. NSXPC process lifetime belongs to launchd;
closing a compiler does not promise service exit. A 30-second native watchdog
terminates the shared service if synchronous compilation stalls, so other
connections fail too; this watchdog's hard process-exit path has not been
fault-injected (host deadline and service-kill recovery were exercised).
