# Apple NSXPC transport for the Rust ACP host

## Traceability
- Spec ID: apple-nsxpc-acp-host
- Status: Implemented
- Request: "desktop 里的 ACP 应该走 XPC 稳定一点" — run desktop ACP over a bundled
  NSXPC service, the way OXC already does.
- Builds on: [`2026-09-07-apple-nsxpc-oxc-service`](2026-09-07-apple-nsxpc-oxc-service.md),
  [`2026-09-07-acp-rust-host-and-streaming-ui`](2026-09-07-acp-rust-host-and-streaming-ui.md).

## Intent

On macOS, run Studio's ACP runs through a launchd-managed Foundation NSXPC
service instead of a plain `harness-acp-host` stdio child. This adds launchd
supervision of the native service and a process/privilege boundary between
Studio's Node worker and the agent subprocesses, with deterministic failure and
no silent downgrade to stdio. Windows/Linux keep the stdio driver unchanged.

## Design

- **One driver child per connection.** The `harness-acp-xpc` service runs one
  unmodified `harness-acp-host` process per accepted NSXPC connection and pumps
  newline frames both ways. Studio already opens one connection per run, so the
  blast radius is unchanged (one crashed agent fails one run) while the service
  gains launchd supervision. `connection.rs` / `thread.rs` / `wire.rs` and the
  driver `main.rs` are untouched.
- **Bidirectional interface, JSONL inside.** `HarnessAcpHostProtocol` exports
  `sendFrame:(NSData*)` (bridge → service); `HarnessAcpClientProtocol` exports
  `deliverFrame:(NSData*)` and `hostFailed:(NSString*)` (service → bridge). Each
  `NSData` is one line of the existing `acp-rust-2.0.0+jsonl-v1` contract.
  OXC's single `performRequest:reply:` cannot carry replies *and* unsolicited
  events from concurrent driver tasks; ACP needs both.
- **No silent fallback.** The service delivers a synthetic first frame
  `{"version":1,"event":{"type":"transport","transport":"nsxpc","servicePid":N,"bridgePid":M}}`
  before any driver output. `AcpRustExecutor`'s `HostClient` refuses to proceed
  unless that frame leads and `servicePid != bridgePid`. A `transport: "nsxpc"`
  client pointed at the plain stdio driver fails the run rather than running it.
- **Bundle layout.** Dev `dist/native/Harness ACP.app` (for `npm run dev` /
  smoke) and the packaged app both carry
  `Contents/XPCServices/com.qoder.harness-studio.acp.xpc` (holding
  `harness-acp-xpc` and the `harness-acp-host` driver it spawns) plus
  `Contents/MacOS/harness-acp-client`. Ad-hoc signatures only.

## Acceptance Scenarios

- AC-1: A macOS Studio run reaches an NSXPC service whose pid differs from the
  bridge and from Studio. Replies, streamed transcript events, the redacted
  protocol trace, and the permission round trip all survive the hop.
- AC-2: `acpHostTransport: "nsxpc"` makes `/api/config` report
  `acpRuntimeProfile: "acp-v1-nsxpc"`; the run receipt records the same profile.
- AC-3: A `transport: "nsxpc"` client given a stdio host fails the run with a
  "refusing a silent stdio fallback" message. A service crash invalidates the
  bridge connection and fails the active run; the next run reconnects (launchd
  owns service lifetime).
- AC-4: Windows/Linux keep the `harness-acp-host` stdio executable and contract.
- AC-5: Existing ACP behaviour (two prompt turns per agent, fenced `fs/*` and
  `terminal/*`, credential redaction, session-option acknowledgement, cwd
  released on close) is unchanged on both transports.

## Non-goals

Node host replacement, public Mach services, App Sandbox entitlements,
distribution signing/notarization, auto-update, renderer IPC changes, new ACP
semantics. Automated fault-injection of a mid-run service SIGKILL (verified
manually; the invalidation/interruption handlers that back AC-3 are small).

## Changed modules

- `rust/acp-host`: `xpc.rs` (service `listen()` + bridge `bridge()`),
  `src/acp-protocol.m`, `build.rs`, two `[[bin]]` entries, macOS `objc2` deps.
- `packages/harness/src/exec/acp-rust.ts`: `transport` option, leading
  `transport`-frame verification, `acp-v1-nsxpc` receipt profile.
- `packages/harness-studio/src/server`: `acpHostTransport` option,
  `acpRuntimeProfile()` third value, executor factories forward `transport`.
- `packages/better-harness-desktop/src`: `main.mjs` picks the bridge + `nsxpc`
  on darwin; `service-host.mjs` / `studio-runtime.mjs` carry `acpHostTransport`
  in the start contract.
- `packages/better-harness-desktop/scripts`: `nsxpc-bundle.mjs` gains
  `installAcpXpc` / `acpServiceId`; `rust.mjs` and `after-pack.mjs` build, stage
  and sign the ACP service, bridge and dev bundle.

## Test evidence

Local, macOS arm64, Rust 1.96.0.

- `npm run test:rust -w @qoder-ai/better-harness-desktop`: OXC 5, acp-host lib
  61, `fixture_agent` 4, `stdio_host` 10 — all pass; the three ACP bins compile.
- `npm run test:native -w @qoder-ai/harness`: 11 pass, including
  `AcpRustExecutor over NSXPC` (full run + redacted trace over the service) and
  the stdio-fallback refusal.
- `npm run test:native -w @qoder-ai/better-harness-desktop`: 19 pass, including
  the parametrised `Harness Studio Rust ACP route ('nsxpc')` and the
  route-level `acp-v1-nsxpc` fallback guard.
- `npm run better-harness-desktop:test`: 6 pass (start contract now carries
  `acpHostTransport`).
- A standalone probe drove `harness-acp-client` end to end: `transport` proof
  (`servicePid != bridgePid`), `host.describe`, `connection.open` spawning the
  fixture agent as the service's grandchild, event streaming while the bridge
  blocks on stdin, a permission decision arriving on a later line, and a clean
  `shutdown` exit 0.
