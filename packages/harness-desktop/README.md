# Harness Studio Desktop

Electron distribution of Harness Studio. Install Rust 1.96.0 with rustup for
the native OXC service (macOS also requires Xcode Command Line Tools), then build from the repository root:

```sh
rustup toolchain install 1.96.0 --profile minimal
npm ci
npm run harness-desktop:build
npm run harness-desktop:dev
```

`npm run harness-desktop:pack` builds an unpacked application under
`packages/harness-desktop/dist/installers`. Run it on the target OS/architecture
so Cargo produces the matching Rust executable. `npm run dist -w
@qoder-ai/harness-desktop` creates the configured ZIP (macOS), NSIS (Windows),
or AppImage (Linux). These are development packaging targets; signing,
notarization and automatic updates are not configured.

The main process owns the native window, menus, single instance and directory
chooser. A utility process owns a Node worker hosting the Studio HTTP server, providers,
ACP and the semantic kernel. OXC parsing and transformation run in Rust. On macOS, launchd owns a bundled
NSXPC service; on Windows/Linux, Studio supervises the Rust stdio process. Renderer fetch and SSE stay unchanged. A per-launch
HTTP credential is attached by an isolated Electron session; the renderer has
no Node integration or preload API. External links need native confirmation.

The v1 service channel supports only start/ready/error/stop and directory
request/result. Startup and shutdown are bounded, directory requests are
correlated, and service failure terminates the desktop app. The browser CLI
continues to use its existing directory chooser and server behavior.

All extracted capability services, including OXC and future ACP services, are
written in Rust. macOS uses a Rust client bridge and an actual Foundation
`NSXPCConnection` to `com.qoder.harness-studio.oxc`. The exported protocol has
one `NSData` request/reply method. A small Objective-C declaration supplies
Clang protocol/block ABI metadata; all service and client behavior is Rust.
The Node-to-bridge boundary and Windows/Linux transport use bounded JSONL.
No TCP listener or public Mach service is added.

A compiler belongs to one artifact build. Parse/transform requests carry source
text and portable module names; Rust never opens those names as files. Profile,
ABI and semantic-index rules stay in the JS kernel; AST transfer is private to
its native backend. Deadlines, malformed replies, crashes and cancellation kill
the affected bridge (or stdio process). The NSXPC connection then closes, and
launchd manages service lifetime. Native compilation has a separate 30-second
watchdog: exceeding it terminates the service and fails all its outstanding
connections. A later request can create a fresh connection; work is never
replayed automatically. There is no desktop fallback to NAPI or from NSXPC to stdio. Compiler-factory identity partitions artifact caches.

macOS packages the Rust service in
`Contents/XPCServices/com.qoder.harness-studio.oxc.xpc` and the client in
`Contents/MacOS/harness-oxc-client`. Development uses the same service inside
`dist/native/Harness OXC.app`, so service discovery works without modifying
Electron.app. Local bundles receive ad-hoc code signatures; this is not a
notarized release or an App Sandbox entitlement configuration.
Windows/Linux package `Resources/native/harness-oxc-service` (with `.exe` on
Windows), outside ASAR. The browser CLI still uses its existing NAPI
worker, so the shared Studio package retains those dependencies.

Validation:

```sh
npm run harness-desktop:test
npm run test:rust -w @qoder-ai/harness-desktop
npm run test:native -w @qoder-ai/harness-desktop
npm run smoke -w @qoder-ai/harness-desktop
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
