# Rust OXC Service

OXC 0.147.0 parser/transformer hosted in a standalone Rust executable.
Build through `npm run build:rust -w @qoder-ai/better-harness-desktop` at repository root.
The build uses Rust 1.96.0, Cargo.lock and the native host target. The output is
copied to the desktop package's `dist/native/` directory.

The persistent stdin/stdout channel carries one UTF-8 JSON object per line:

```json
{"version":1,"id":1,"method":"parse","filename":"/view.tsx","source":"export const View = () => <h1>Hello</h1>;"}
```

`method` is `parse` or `transform`; unknown fields and methods are rejected.
`id` is a positive u32. `filename` is a revision-relative POSIX identifier with
leading `/`, not a native file to open. Parser output contains `program` (ESTree,
with UTF-16 positions) and `errors`. Transformer output contains `code`, `map`
and `errors`, using the fixed AgentReact development JSX transform.

Successful replies contain `version`, `id`, `pid`, and `result`. Failed requests
contain `version`, `id`, and `error.code`; malformed envelopes have a null id.
Diagnostics stay structured; stdout never contains operational log messages.
EOF ends the service; `--help` and `--version` provide CLI discovery.

Limits are 512 KiB source, 4 KiB filename, 4 MiB request frame and 16 MiB response
frame. Oversized or truncated input frames produce an error and close the
channel. The Node supervisor bounds pending requests to 16, applies deadlines,
and kills the process for cancellation, crash recovery or malformed output.
There is no generic execution or filesystem command.

The JS semantic kernel owns profile admission, ABI extraction and semantic
indexing. It requests transformation only after those checks pass. ASTs remain
private to this boundary; callers still consume OxcCompilerPort results. This
is a portable process service, not an Apple NSXPC bundle.
