# Better Harness Desktop

Electron distribution of Harness Studio. Install Rust 1.96.0 with rustup for
the native OXC service (macOS also requires Xcode Command Line Tools), then build from the repository root:

```sh
rustup toolchain install 1.96.0 --profile minimal
npm ci
npm run better-harness-desktop:build
npm run better-harness-desktop:dev
```

`npm run better-harness-desktop:pack` builds an unpacked application under
`packages/better-harness-desktop/dist/installers`. Staging drops source maps,
TypeScript declarations, package READMEs, the unused `@phosphor-icons` package
(icons are already bundled into Studio's browser assets), and PDF.js trees the
Node adapter does not import. Run the pack command on the target OS/architecture
so Cargo produces the matching Rust executable. `npm run dist -w
@qoder-ai/better-harness-desktop` creates the configured ZIP (macOS), NSIS (Windows),
or AppImage (Linux). These are development packaging targets; signing,
notarization and automatic updates are not configured.

The main process owns the native window, menus, single instance and directory
chooser. A utility process owns a Node worker hosting the Studio HTTP server, providers,
ACP and the semantic kernel. OXC parsing/transformation and the ACP host run in
Rust. On macOS, launchd owns their bundled NSXPC services; on Windows/Linux,
Studio supervises the Rust stdio processes. Renderer fetch and SSE stay unchanged. A per-launch
HTTP credential is attached by an isolated Electron session; the renderer has
no Node integration or preload API. External links need native confirmation.

The v1 service channel supports only start/ready/error/stop and directory
request/result. Startup and shutdown are bounded, directory requests are
correlated, and service failure terminates the desktop app. The browser CLI
continues to use its existing directory chooser and server behavior.

All extracted capability services are written in Rust. macOS uses a Rust client
bridge and an actual Foundation `NSXPCConnection`: OXC talks to
`com.qoder.harness-studio.oxc` (one `NSData` request/reply method), and ACP talks
to `com.qoder.harness-studio.acp` (a bidirectional pair — `sendFrame:` from the
bridge, `deliverFrame:` / `hostFailed:` back). Small Objective-C declarations
supply Clang protocol/block ABI metadata; all service and client behavior is
Rust. The Node-to-bridge boundary and Windows/Linux transport use bounded JSONL.
No TCP listener or public Mach service is added.

The ACP service runs one unmodified `harness-acp-host` driver per NSXPC
connection, so a crashed agent still fails only its own run. The bridge speaks
the same newline contract as the plain driver, so Studio spawns it the same way;
it emits a leading `transport` frame carrying the service and bridge pids, and
the Node client refuses to run if that proof is missing — NSXPC never silently
downgrades to stdio. Windows/Linux keep the `harness-acp-host` stdio driver.
Session discovery and Artifact observations use the same shape:
`com.qoder.harness-studio.evidence` + `harness-evidence-client`, spawning
`harness-evidence-host` per connection. Windows/Linux spawn that driver over
stdio.

A compiler belongs to one artifact build. Parse/transform requests carry source
text and portable module names; Rust never opens those names as files. Profile,
ABI and semantic-index rules stay in the JS kernel; AST transfer is private to
its native backend. Deadlines, malformed replies, crashes and cancellation kill
the affected bridge (or stdio process). The NSXPC connection then closes, and
launchd manages service lifetime. Native compilation has a separate 30-second
watchdog: exceeding it terminates the service and fails all its outstanding
connections. A later request can create a fresh connection; work is never
replayed automatically. There is no desktop fallback to NAPI or from NSXPC to stdio. Compiler-factory identity partitions artifact caches.

macOS packages each Rust service in `Contents/XPCServices/<id>.xpc` and its
client/bridge in `Contents/MacOS`: `com.qoder.harness-studio.oxc.xpc` +
`harness-oxc-client`, `com.qoder.harness-studio.acp.xpc` (which also carries
the `harness-acp-host` driver it spawns) + `harness-acp-client`, and
`com.qoder.harness-studio.evidence.xpc` + `harness-evidence-client`. Development
uses the same services inside `dist/native/Harness OXC.app`,
`dist/native/Harness ACP.app`, and `dist/native/Harness Evidence.app`, so
service discovery works without modifying Electron.app. Local bundles receive
ad-hoc code signatures; this is not a notarized release or an App Sandbox
entitlement configuration.
Windows/Linux package `Resources/native/harness-oxc-service`,
`Resources/native/harness-acp-host`, and `Resources/native/harness-evidence-host`
(with `.exe` on Windows), outside ASAR. The
browser CLI still uses its existing NAPI worker, so the shared Studio package
retains those dependencies.

Validation:

```sh
npm run better-harness-desktop:test
npm run test:rust -w @qoder-ai/better-harness-desktop
npm run test:native -w @qoder-ai/better-harness-desktop
npm run smoke -w @qoder-ai/better-harness-desktop
```

The smoke command launches a real Electron window with Playwright, verifies
renderer isolation, local HTTP protection, Rust parsing/transformation and absence of OXC NAPI
in the Studio process, saves a screenshot,
and checks bridge/host shutdown. Native integration tests run both transports
on macOS, including service interruption and restart. NSXPC service shutdown
is managed by launchd and is not asserted from compiler close. It requires a graphical session (Xvfb on Linux).
Staging resolves production dependencies through npm; a signed, reproducible
release pipeline and native Windows/Linux receipts remain separate work.

The Node worker is required by PDF.js environment detection: directly loading
Studio in utilityProcess selects its browser path and fails on missing DOMMatrix.
This keeps Node dependencies in their supported environment without patching
PDF.js or Electron process metadata.
