# Studio esbuild service

The macOS desktop AgentReact linker embeds the public Go esbuild API, pinned by
`go.mod` and `go.sum`. It links ESM already admitted and transformed by OXC.
OXC still owns ASTs, Profile checks, ABI extraction, and semantic indexing.
Windows/Linux desktop, final preview packaging, and standalone Studio retain
their existing WASM path.
That remaining step still requires `node` on PATH. Packaged AgentReact previews
load its engine and trusted runtime inputs from the physical unpacked closure.

From the repository root:

```sh
npm run build:go -w @qoder-ai/better-harness-desktop
npm run test:go -w @qoder-ai/better-harness-desktop
npm exec -w @qoder-ai/harness-studio -- vitest run --config vitest.native.config.ts test/agent-react/go-esbuild.native.ts
```

Build requirements: the Go version declared in `go.mod`; macOS also requires
Xcode Command Line Tools. macOS desktop builds invoke Go automatically.
Windows/Linux desktop builds skip Go and do not ship its executable. The explicit
`build:go` command builds a pure Go executable with cgo disabled for tests. macOS builds that
executable for transport tests and links a Go c-archive into an Objective-C
Foundation service. The archive and generated header are build intermediates,
not runtime dependencies. Dependency license notices accompany the executables.

The native staging directory contains `harness-esbuild-service` (`.exe` on
Windows). On macOS, it additionally contains `Harness Esbuild.app` for development
tests; packaged desktop apps contain the client in `Contents/MacOS` and the
service in `Contents/XPCServices/com.qoder.harness-studio.esbuild.xpc`.

The client bridges one bounded JSONL request/reply at a time through the
`performRequest:reply:` NSXPC protocol. The service returns its actual PID and
engine version; the client checks Foundation's process identity and adds its own
PID. The Node adapter requires the explicitly selected transport and closes
pending work on timeout, shutdown, malformed frames, or incompatible identity.
The service limits concurrency to one build, admission to 16 pending requests,
and active compilation to 30 seconds independently of the client deadline.

Wire protocol v1 accepts only `link`, with `entryModule`, host-generated
`entrySource`, `modules: [{path, code}]`, `runtimePackages: [{specifier, external}]`,
and `maxOutputBytes`. Requests/replies are capped at 64 MiB; modules at 512,
each at 1 MiB and together with entry source at 32 MiB; output at 16 MiB.
Revision identifiers use POSIX paths on every OS. Go resolve/load callbacks only
consult these submitted maps and never fall through to filesystem resolution.
The reply contains `status`, optional `bundle`, and structured diagnostics.

The same engine can later serve Canvas Compiler through a data-oriented adapter,
but JavaScript plugin callbacks are not serialized or executed by this service.
