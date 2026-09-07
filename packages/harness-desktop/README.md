# Harness Studio Desktop

Electron distribution of Harness Studio. Build from the repository root:

```sh
npm ci
npm run harness-desktop:build
npm run harness-desktop:dev
```

`npm run harness-desktop:pack` builds an unpacked application under
`packages/harness-desktop/dist/installers`. Run it on the target OS/architecture
so npm selects the matching oxc native packages. `npm run dist -w
@qoder-ai/harness-desktop` creates the configured ZIP (macOS), NSIS (Windows),
or AppImage (Linux). These are development packaging targets; signing,
notarization and automatic updates are not configured.

The main process owns the native window, menus, single instance and directory
chooser. A utility process owns a Node worker hosting the Studio HTTP server, providers,
ACP and compiler workers. Renderer fetch and SSE stay unchanged. A per-launch
HTTP credential is attached by an isolated Electron session; the renderer has
no Node integration or preload API. External links need native confirmation.

The v1 service channel supports only start/ready/error/stop and directory
request/result. Startup and shutdown are bounded, directory requests are
correlated, and service failure terminates the desktop app. The browser CLI
continues to use its existing directory chooser and server behavior.

“XPC” describes the intended cross-process service boundary here. The current
transport is Electron utilityProcess on all three platforms, not native macOS
NSXPC. Extracting ACP and oxc into dedicated services is a later step; keep
request/result/cancellation contracts with those capability owners.

Validation:

```sh
npm run harness-desktop:test
npm run smoke -w @qoder-ai/harness-desktop
```

The smoke command launches a real Electron window with Playwright, verifies
renderer isolation, local HTTP protection and native parsing, saves a screenshot,
and checks service shutdown. It requires a graphical session (Xvfb on Linux).
Staging resolves production dependencies through npm; a signed, reproducible
release pipeline and native Windows/Linux receipts remain separate work.

The Node worker is required by PDF.js environment detection: directly loading
Studio in utilityProcess selects its browser path and fails on missing DOMMatrix.
This keeps Node dependencies in their supported environment without patching
PDF.js or Electron process metadata.
