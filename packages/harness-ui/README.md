# @qoder-ai/harness-ui

The AG-UI protocol adapter for [`@qoder-ai/harness`](../harness/README.md).
It turns a `.harness` assembly into an [AG-UI](https://docs.ag-ui.com/)
endpoint: any AG-UI-compatible frontend (CopilotKit, a TUI, or the companion
[`@qoder-ai/harness-studio`](../harness-studio/README.md)) can start runs and
render them live.

## How it fits

```text
.harness ── @qoder-ai/harness ── HarnessRunEvent (neutral lifecycle)
                                        │
                        translate.ts: neutral → AG-UI events
                                        │
                        server.ts: POST /agui → SSE stream
```

The executor's `HarnessRunEmitter` already guarantees a well-formed
lifecycle — one `run-started`, framed messages, paired tool-call argument
events, correlated retained tool results, and one terminal `run-finished` —
so the AG-UI mapping is nearly 1:1. The adapter emits `TOOL_CALL_RESULT` when
the host exposes execution output and enforces the AG-UI termination rule: a
run ends with either `RUN_FINISHED` or `RUN_ERROR`, never both.

Retained tool output is bounded to 64 KiB. Failed or truncated results emit a
namespaced `harness.tool-result-meta` custom event after `TOOL_CALL_RESULT`;
browser clients can import its constant and value type from the browser-safe
`@qoder-ai/harness-ui/protocol` entrypoint.

This package implements the AG-UI **wire format** with local types instead of
depending on the pre-stable `@ag-ui/core`; conformance is asserted by tests
on the emitted JSON.

## Serve a harness

```sh
npx @qoder-ai/harness-ui serve my-agent.harness --port 3210
```

- `POST /agui` — AG-UI `RunAgentInput` in, SSE stream of AG-UI events out.
  The prompt is the latest user message.
- `GET /healthz` — liveness probe.

The server binds to `127.0.0.1` and is a local development surface. Runs
execute through the same v0.3 executors as the core package (Qoder SDK by
default), so the executor honesty rules and redaction guarantees apply
unchanged.

A skill declared with `source "./skills/x"` is delivered from disk, not
merely referenced: the server locks and reads it against `--source-root`,
which defaults to the directory containing `<file.harness>` (skills are
conventionally authored relative to their harness file). A harness whose
`source` cannot be resolved there fails the run instead of silently sending
the model a path it cannot open.

Browser POSTs are same-origin by default and must use
`Content-Type: application/json`. To connect a separately hosted local UI,
allow its exact origin explicitly (the option is repeatable):

```sh
npx @qoder-ai/harness-ui serve my-agent.harness \
  --allow-origin http://127.0.0.1:5173
```

The server echoes an allowed origin; it never enables wildcard CORS or trusts
a non-loopback Host just because the Origin matches it. Keep the default
loopback bind unless a trusted gateway supplies authentication and transport
security.

## Embed in code

```ts
import { runHarnessAgui } from "@qoder-ai/harness-ui";

await runHarnessAgui({
  source,               // .harness source text
  prompt: "Explain the repository in one sentence.",
  threadId: "thread-1",
  runId: "run-1",
  onEvent: (event) => console.log(event.type),
});
```

`executorFactory` injects a custom or scripted executor — that is also how
the tests run without a live SDK.

## Development

```sh
npm run harness-ui:build
npm run harness-ui:test
```

Publication is repository-owned: select `harness-ui` in the protected GitHub
Actions `Publish npm` workflow. Local commands only build, test, pack, or
dry-run; do not publish this workspace from a developer machine.

See the spec:
[Harness UI and Studio](https://github.com/QoderAI/better-harness/blob/main/docs/specs/2026-08-15-harness-ui-studio.md).
