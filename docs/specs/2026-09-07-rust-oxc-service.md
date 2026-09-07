# Rust OXC Service

## Traceability
- Spec ID: rust-oxc-service
- Status: Implemented
- Request: split OXC into an XPC service; all extracted capability services must be written in Rust.
- AI involvement: Codex implementation and local validation.

## Intent
Move desktop OXC native parsing and transformation into a supervised Rust
executable. Preserve AgentReact profile checks, ABI extraction, semantic index,
diagnostics and browser CLI compatibility.

## Acceptance Scenarios
- AC-1: Desktop uses the Rust service for every OXC parse/transform, with no OXC NAPI library loaded in the Studio process. A typed compiler factory passes through production artifact routes; the browser CLI retains its worker adapter.
- AC-2: A versioned, strict, bounded JSONL stdio protocol carries request ids and parse/transform results. Invalid requests, unknown fields, oversized sources/frames and unsupported protocol versions fail closed. Native code receives source text, not filesystem authority.
- AC-3: Deadline, crash, malformed output and close settle pending calls. Timeout/cancellation kills the affected process; a later compile starts a fresh process. Queues and buffers are bounded; no automatic replay of the failed request.
- AC-4: Valid TSX (including non-ASCII text), refused profile examples, ABI/semantic index and source maps match the existing kernel. Profile refusal happens before requesting transformation. Compiler identity and outer artifact caches distinguish transports.
- AC-5: Cargo locks OXC to 0.147.0; target-native Rust binaries ship outside ASAR. Native tests and the packaged macOS app prove real service calls and process separation. Windows/Linux build and smoke are wired into CI; unrun platforms remain unverified.

## Design and Capability Matrix
| Capability | Decision |
| --- | --- |
| Parse and transform | Rust service using pinned OXC crates |
| Profile, ABI, semantic index | Existing JS semantic kernel, using a private backend port |
| AST transfer | Bounded ESTree JSON inside the kernel/backend boundary only; never exposed to business callers or renderer. UTF-8 spans converted to UTF-16 for parity. |
| Cancellation | Kill dedicated compiler process; synchronous native work cannot consume cancel messages while executing |
| XPC transport | Cross-platform child process + framed JSONL stdio; native macOS NSXPC is not claimed |
| Other future capability services | Rust executables; Studio remains the existing Node host runtime |

## Non-goals
No ACP extraction, semantic-rule rewrite, generic RPC registry, UI changes,
macOS-only NSXPC bridge, signing, publication or auto-update changes.

## Plan and Tasks
1. Separate the native backend from semantic compilation without changing the
   existing default adapter. Keep constants available without importing NAPI.
2. Add Rust parse/transform service and a supervised Node transport adapter.
3. Inject compiler factory from desktop through Studio production routes;
   partition caches by factory and retain current OxcCompilerPort output.
4. Package the Rust binary as an external resource; add Cargo/native/protocol
   parity checks and extend desktop smoke with actual Rust proof.

## Test and Review Evidence
Local macOS arm64 evidence on 2026-09-07:

| Acceptance | Receipt |
| --- | --- |
| AC-1 | Packaged-app smoke records separate main, Studio and Rust PIDs; Studio process.report sharedObjects contains no OXC NAPI. Native HTTP test proves both build and preview routes call the injected compiler. |
| AC-2 | Five Rust tests cover UTF-16 spans, TSX transform/source map, unknown methods/fields/versions, source limits, oversized/truncated frames and parse errors. Cargo.lock pins native dependencies. |
| AC-3 | Native adapter tests exercise a hung child, exit code zero, malformed JSON, oversized stdout, cancellation, use after close and recovery with a real Rust process. Desktop tracks active compilers and closes them before stopping Studio. |
| AC-4 | Seven native integration tests include parity with NAPI over valid and refused inputs, Unicode, generated code and parsed source maps; profile refusal makes zero transform calls. Artifact cache regression proves different factories cannot share cached builds. |
| AC-5 | Full desktop build/stage/pack and packaged macOS arm64 smoke pass. Binary ships outside ASAR. Cargo tests, native integration tests and packaged smoke are wired into the three-platform CI matrix. |
| Regression | AgentReact/artifact/auth selection: 182 passing tests before adding the cache case. Final artifact/project/server selection: 70 passing tests including that new case. These overlap and are not additive. Six desktop lifecycle tests and eight docs-link tests also pass. |

Commands: `npm run test:rust -w @qoder-ai/better-harness-desktop`,
`npm run test:native -w @qoder-ai/better-harness-desktop`,
`npm exec -w @qoder-ai/harness-studio -- vitest run test/agent-react test/artifact-compile-runtime.test.ts test/desktop-authorization.test.ts`,
`npm exec -w @qoder-ai/harness-studio -- vitest run test/artifact-compile-runtime.test.ts test/project-server.test.ts test/server.test.ts`,
`CSC_IDENTITY_AUTO_DISCOVERY=false npm run better-harness-desktop:pack`,
`npm run smoke -w @qoder-ai/better-harness-desktop -- --packaged`.

Generated native and screenshot/JSON receipts live under the desktop package's
ignored `dist/`. Windows/Linux jobs have not run here; no signed release or
native Apple NSXPC acceptance is claimed. Existing Studio npm dependencies retain
NAPI for browser/CLI compatibility, but the desktop does not load or fall back
to those modules. AST serialization adds bounded transport overhead; no speedup
is claimed. Source-map object content matches; JSON property ordering is not a
semantic equality requirement.

Review Readiness Check: user request and spec confirmed; no Story supplied.
The Electron baseline is committed as 3920fd1. This Rust slice is reviewed separately from the baseline: native service/lockfile, semantic-backend seam, supervised
adapter, factory routing/cache isolation, desktop packaging/smoke, architecture
rule and tests. No ACP implementation or UI change is included. No generated
runtime artifacts are staged; no publication is performed.
