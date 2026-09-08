# ACP connection discovery and authentication

## Traceability
- Spec ID: acp-connection-actions
- Status: Implemented; local acceptance verified

## Intent
Continue the user-requested Zed parity work with connection-level interfaces.
Hosts must be able to discover Agent sessions and explicitly authenticate before
session creation. Local saved records are not Agent discovery results.

## Acceptance scenarios
- AC-1: Node and native executors expose a connection callback after initialize
  and before session/new; finishing execution invalidates the handle.
- AC-2: session/list requires advertised support and forwards cwd and opaque
  cursor unchanged, retaining nextCursor and session metadata.
- AC-3: authenticate only accepts an advertised agent/default method; terminal
  methods and unknown ids are rejected without invoking the Agent.
- AC-4: Authentication is never automatic; an explicit callback action can
  authenticate and then allow session/new to proceed. Errors reach the caller.
- AC-5: Existing callers without the callback retain their lifecycle.

## Plan and tasks
Add a shared guarded connection control, executor hooks, native wire calls and
fixture integration tests. Keep initialization metadata outside redacted trace
extraction so discovery remains available even when traces are truncated.

## Non-goals
The Studio picker lists Agent sessions filtered to the active Project. Browsing
other projects is outside this increment. No terminal login process,
credential storage, logout, checkpoint or implicit authentication is introduced.

## Test and review evidence
- AC-1–5: Harness focused suite, 49 tests passed including child-process
  discovery/authentication, unchanged callers and closed-handle rejection.
- AC-1–5: Native suite, 19 tests passed including discovery/authentication over
  Rust stdio and macOS NSXPC.
- Rust library: 61 tests passed; release host/bridge build passed.
- Harness TypeScript check passed; doc routing regenerated and unchanged.
- Capability gating and explicit callback authentication have executable tests;
  no real account login or installed desktop replacement was performed.

References:
[ACP session list](https://agentclientprotocol.com/protocol/v1/session-list) and
[ACP authentication](https://agentclientprotocol.com/protocol/v1/authentication).
Native filesystem filtering uses node:path and PathBuf; macOS tests do not prove
Windows/Linux execution.

## Studio integration increment
- AC-6: Compare and Debugger offer an explicit Choose session entry. Connecting
  pauses before session creation; new/session selection releases the same connection.
- AC-7: A compact shared panel offers project-filtered Agent history with bounded
  pagination, manual refresh, empty/unsupported states and explicit authentication.
  Only session IDs actually returned for this project can be selected for recovery.
- AC-8: Failure preserves the panel and prompt for retry; Close and disconnect
  release the preparation gate and reap the connection. Inactive handles reject actions.
- AC-9: Keyboard controls, visible focus, wide/compact/narrow layouts, console and
  page errors are verified in Playwright. Existing direct runs remain one-click.

Implementation uses a typed stream event and the existing injected action adapter.
No credentials are accepted by Studio; terminal authentication stays unsupported.


### Studio acceptance evidence
- AC-6–9: 3 browser scenarios pass on Node stdio, Rust stdio and macOS NSXPC:
  discovery/authentication/pagination/restore/next turn, closing preparation, and
  direct-run failure followed by login and retry of the original prompt.
- Existing controls, stream and conversation browser regression: 11 cases pass
  including the 3 connection cases. Wide 1440, compact 1024 and narrow 390
  screenshots checked; reduced motion prevents transition frames contaminating
  layout receipts. Browser page errors and console errors checked.
- Studio suite: 80 files / 596 tests pass (includes other work in this checkout).
- Root preview health and canvas-module.js return HTTP 200; document links: 8 pass.
- Lists retain at most 500 sessions / 100 pagination cursors per preparation.
  Preparation expires after 5 minutes; close and disconnect release the gate.
- Historical analysis remains an analysis-time snapshot. Native checkpoint,
  terminal authentication, interactive terminal controls and filesystem/editor
  actions are still separate host integration work.

### Review readiness
The user request is the requirement source; no Story id was supplied. This is an
AI-authored, spec-backed ACP change spanning the Harness executors, Rust ACP
wire, shared Studio panel, action route and tests. The independently modified
Rust evidence host, desktop packaging, workflow deletion and sidebar tests are
outside this change. Generated build products and local screenshot receipts are
not staged. No push, publication or installed-app replacement is included.
