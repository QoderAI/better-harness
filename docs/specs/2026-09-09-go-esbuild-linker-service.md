# Native esbuild linking for Studio

## Traceability
- Spec ID: go-esbuild-linker-service
- Status: Implemented (local macOS verified; target-OS CI pending)
- Request: implement the first stage of the discussed Go esbuild XPC service.
- AI involvement: Codex implementation and local verification.

## Intent
Use native Go esbuild for macOS desktop AgentReact linking, sharing esbuild's public
engine rather than maintaining a fork. Preserve OXC source parsing, Profile
admission, ABI extraction, semantic indexing, and TSX transformation.

## Acceptance Scenarios
- AC-1: A macOS desktop AgentReact build links OXC-admitted ESM with Go esbuild 0.28.2;
  multi-module resolution, TypeScript extension substitution, runtime externals,
  executable output, and semantic/source-map outputs match the existing pipeline.
- AC-2: Imports outside the submitted virtual revision and unapproved packages
  fail without host filesystem or network resolution. Invalid envelopes, module
  identifiers, and source/output budgets fail with bounded diagnostics.
- AC-3: macOS uses an actual bundled NSXPC service containing the Go engine,
  distinct from its client and Studio PIDs. Explicit NSXPC selection cannot
  silently fall back to stdio. Timeout/close rejects pending work; a subsequent
  build can use a fresh connection/process. The service has its own watchdog.
- AC-4: Windows/Linux retain their existing OXC and WASM linker pipeline. Go
  stdio remains available for protocol tests, but is neither selected at startup
  nor shipped in their desktop packages. Platform selection has behavior tests.
- AC-5: Linker version/policy affects snapshot identity and factory identity
  separates build caches. Both build and preview HTTP routes inject and close
  the native linker; transient service failures remain retryable.
- AC-6: Desktop build/stage/package includes the new service and startup probe.
  Local macOS native integration and Electron smoke record actual Go/XPC use.

## Non-goals
- Removing OXC, exposing esbuild internal ASTs, migrating the Canvas Compiler's
  JavaScript plugins, or changing JSX transforms.
- Migrating final production preview packaging, ordinary React artifact builds,
  trusted renderer compilation, or every existing esbuild-wasm dependency.
- UI changes, installing an app, publishing, signing with a release identity,
  notarization, performance/size improvement claims, or pushing. The user has
  authorized a scoped commit.

## Plan and Tasks
1. Add a capability-local Go linker core and bounded JSONL executable. Admit
   only submitted ESM modules and trusted runtime mappings through Go plugins;
   use portable POSIX revision identifiers separately from native disk paths.
2. Build the same Go core as a c-archive and link a thin Objective-C NSXPC
   listener. Keep Foundation/Go memory ownership explicit with copied bytes and
   a C allocation/free boundary. A small client bridges Node JSONL to NSXPC.
3. Add an injectable managed linker port to Studio. Retain the WASM default for
   standalone Studio and Windows/Linux desktop; macOS selects NSXPC explicitly. Bind linker
   identity into build policy and isolate factory-specific caches.
4. Wire desktop startup, lifecycle, native build and package scripts, and smoke.
5. Run Go contract tests, focused Studio/desktop tests, native transport parity,
   cross-builds, doc links, preview health/module smoke, and macOS Electron smoke.

Packaged-host verification exposed a pre-existing final-packager failure:
external Node cannot open `esbuild-wasm/bin/esbuild` inside `app.asar`.
Include the complete WASM package and its trusted AgentReact/React input closure
in `app.asar.unpacked`; load those physical paths only for AgentReact final packaging. This fixes the path boundary without
migrating the final packager or its plugins; the retained WASM step still uses
the existing `node` executable from PATH.

## Test and Review Evidence

| Acceptance | Local evidence |
| --- | --- |
| AC-1, AC-2 | Go linker contract tests and `go test -race ./linker`, `go vet ./linker` pass. Native tests execute linked output and compare bundles, semantic indexes, source maps, and ABI declarations with the WASM path. |
| AC-3, AC-5 | `vitest run --config vitest.native.config.ts test/agent-react/go-esbuild.native.ts`: 18 passed across stdio and NSXPC. Includes timeout, malformed/oversized/wrong-version/invalid-diagnostic responses, close, reconnect, transport mismatch, HTTP routes, factory cache separation, and build identity. |
| AC-1 regression | Combined Go/OXC native run: 34 passed. Build coordinator, runtime addressing, and artifact compile regression run: 39 passed. |
| AC-4 | Pure Go stdio cross-builds pass for Windows amd64, Linux amd64, and macOS amd64; local execution is macOS arm64. Desktop CI builds the stdio test harness separately and runs Go/native tests in its existing three-OS matrix; Windows/Linux packages do not include or select it. |
| AC-6 | Studio typecheck/build, Rust service build, Go native build, npm staging, and `electron-builder --dir` pass. Packaged macOS Electron smoke imports an actual AgentReact source, renders Unicode, clicks its counter, checks renderer isolation, keyboard focus and bounded overflow, and captures 1440/1024/390 px screenshots. |
| Packaged path fix | WASM runtime/path tests plus artifact compilation: 13 passed. Verifies POSIX, Windows drive and UNC paths and actual JS plugin execution. Packaged runtime/React/WASM file closure verified on disk. |
| Repository gates | Desktop host tests: 7 passed; doc-link graph: 8 passed; routing graph regenerated without diff; `git diff --check` passes. |

Packaged smoke receipt and screenshots are in
`packages/better-harness-desktop/dist/smoke/`. The observed Go XPC PID is distinct
from the client, Studio, and Electron main PIDs. `go version -m` on the packaged
XPC executable confirms esbuild v0.28.2 and Go c-archive linkage. The executable
is 8,494,592 bytes; this is a measurement, not a before/after size claim.
The service bundle passes local `codesign --verify --strict` with an ad-hoc
signature. No release identity or notarization was used.

`npm run preview` found the existing server on port 58575; its `/health` and
`/canvas-module.js` both returned HTTP 200. That is endpoint smoke against the
running preview, not evidence that this task started a new preview process.

### Review readiness
- Request/spec evidence is explicit; no Story or issue ID was supplied or inferred.
- Changes are confined to the linker/service, desktop wiring/packaging, their
  tests, and the required architecture/spec documentation. OXC and admission
  guards remain in place. The ASAR fix was driven by a reproduced packaged error.
- Linker identity participates in both inner snapshots and outer preview build
  IDs. Transient native failures cannot populate successful-build caches.
- Go archives, generated headers, executables, package staging and screenshots
  remain ignored build outputs; Go dependency checksums and source are tracked inputs.
- The commit includes only the esbuild implementation and supporting evidence.
  Pre-existing and concurrent UI/performance changes remain outside its scope.
- Windows/Linux runtime, macOS x64 XPC, release signing, notarization, installation,
  and performance gains remain unverified. Final preview packaging still requires
  the existing WASM runtime and a Node executable on PATH.

Risks: Go/Objective-C ABI ownership, service termination and launchd restart,
resolver differences, stale build caches, and macOS native linking/signing.
Input frames and responses are capped at 64 MiB; submitted modules at 512, each
at 1 MiB and together at 32 MiB; emitted code at the host's limit up to 16 MiB.
The wire protocol carries data only, never arbitrary JavaScript plugin callbacks.
