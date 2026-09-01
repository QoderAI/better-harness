# Harness UI and Studio: streaming run events, AG-UI adapter, React studio

## Traceability

- Spec ID: `2026-08-15-harness-ui-studio`
- Status: Superseded

This historical implementation was superseded by
[Native Harness run streams in Studio](2026-09-01-harness-native-studio-stream.md).
The AG-UI adapter and its package are no longer current product surfaces.

## Intent

The Harness DSL currently runs only in batch mode: `compileHarness →
resolveHarness → executor.execute()` returns one `HarnessRunResult` after the
run ends, and the compare CLI writes evidence JSON to disk. Neither path gives
a user any live view of a running harness, and the compare/inspector evidence
has no interactive UI.

This spec adds three bounded layers without changing DSL semantics:

1. **Streaming run-event seam** in `@qoder-ai/harness`: executors emit
   host-neutral `HarnessRunEvent` values while a run is in flight.
2. **`@qoder-ai/harness-ui`**: a protocol adapter that translates neutral run
   events into [AG-UI protocol](https://docs.ag-ui.com/) events and serves
   them over SSE, so any AG-UI-compatible frontend (CopilotKit, custom
   clients) can drive a harness run.
3. **`@qoder-ai/harness-studio`**: a React application (bundled with esbuild,
   served by a small Node CLI) with a live Run view fed by the AG-UI stream
   and a Compare view fed by `harness-compare.v1` evidence directories.

The DSL core stays UI-free: no grammar, IR, or resolver change. The existing
static-HTML harness inspector remains the zero-dependency offline report; the
studio is an additive, richer surface, not a replacement.

## Acceptance scenarios

- **AC-1 (neutral event seam)**: `QoderSdkExecutor` accepts an
  `onRunEvent` listener, requests the SDK's partial-message stream, and emits
  text deltas as they arrive rather than waiting for a completed assistant
  turn. The lifecycle-ordered sequence contains one `run-started` first,
  framed `message-started`/`text-delta`/`message-finished` text, paired
  `tool-call-started`/`tool-call-finished` events, `run-error` only on
  failure, and exactly one final neutral `run-finished` with the exit code and
  metrics. When Qoder exposes a retained `tool_result`, the seam correlates it
  back to the originating tool-call id without leaking credential-shaped
  fields (the existing trace redaction applies before mapping).
- **AC-2 (event mapping is deterministic and tested)**: the lifecycle emitter
  and SDK-message mapping (`applyQoderSdkMessage`) are exported and covered by
  unit tests using scripted partial and completed SDK messages, with no live
  SDK required. Completed assistant payloads do not duplicate text already
  emitted from partial messages, and completed-only messages remain a fallback
  for older or injected SDK implementations.
- **AC-3 (AG-UI translation)**: `@qoder-ai/harness-ui` translates a neutral
  event sequence into a valid AG-UI event sequence: `RUN_STARTED`, paired
  `TEXT_MESSAGE_START`/`TEXT_MESSAGE_CONTENT`/`TEXT_MESSAGE_END`,
  `TOOL_CALL_START`/`TOOL_CALL_ARGS`/`TOOL_CALL_END`, optional correlated
  `TOOL_CALL_RESULT`, and exactly one terminal
  event: `RUN_FINISHED` on success or `RUN_ERROR` on failure. Open text
  messages are always closed before a tool call, an error, or run completion.
  Message and tool-call ids are namespaced by `runId`, so repeated runs in one
  thread cannot overwrite earlier AG-UI entities.
- **AC-4 (SSE endpoint)**: the harness-ui server accepts an AG-UI
  `RunAgentInput` POST (threadId, runId, messages) and responds with an SSE
  stream (`data: <json>\n\n` frames) of the translated events, echoing the
  caller's threadId/runId. The run layer owns the outer lifecycle: failures
  while constructing or invoking an injected executor still produce
  `RUN_STARTED` followed by one `RUN_ERROR`. Browser requests are same-origin
  by default; explicitly allowlisted origins receive an exact CORS response,
  while untrusted origins, non-loopback `Host`/matching-`Origin` pairs, and
  non-JSON POST bodies are rejected before an executor is created. A request
  larger than 1 MiB receives a structured HTTP 413 response rather than a
  reset socket. Verified by in-process and raw-HTTP tests with injected fake
  executors; no network or live SDK in tests.
- **AC-5 (interactive studio run trace)**: the studio's AG-UI event reducer
  folds an event stream into UI state (messages, tool calls, results, run
  status, error). Run renders workbench-style, keyboard-expandable tool cards
  with a compact argument preview, formatted arguments, retained result, call
  id, and preparing/running/completed/failed/result-unavailable/interrupted
  status. Tool-result error metadata survives the neutral and AG-UI seams; a
  successful run without a retained result is not labelled as a completed
  result. Retained results are capped at 64 KiB with explicit truncation
  metadata. Pure model tests cover streamed arguments, result correlation,
  terminal settlement, failure/truncation metadata, and malformed/plain-text
  payload formatting; browser verification expands a real rendered tool card.
- **AC-6 (studio compare view)**: the studio server exposes the evidence
  directory's `verdict.json` via `/api/evidence`, and the compare summary
  model derives per-variant rows (pass rate, mean score, cost) from a
  core-validated `HarnessCompareVerdict` value. Malformed aggregates or trial
  rows produce a readable evidence error rather than crashing React. Both are
  covered by tests against fixture and malformed data.
- **AC-7 (pipeline parity)**: both new packages follow the existing
  `packages/harness` pipeline rules: npm workspace membership, root
  `<pkg>:build` / `<pkg>:test` scripts, CI build+test steps, `prepack` build
  and test, `publishConfig.access: public`, MIT license, repo `engines` range.
- **AC-8 (CLI help contract)**: `harness-ui --help` and `harness-studio
  --help` print usage and exit 0 without reading the workspace, compiling a
  harness, or opening a port.
- **AC-9 (responsive studio shell)**: Run controls and Compare tables remain
  usable at desktop and 390px-wide browser viewports. Wide evidence tables
  scroll inside labelled containers without increasing the document width;
  browser verification records console/page errors and screenshots.
- **AC-10 (automated interaction regression)**: a Playwright test drives the
  built Studio through its real HTTP server, starts a scripted run, expands and
  collapses a failed/truncated Tool Call with the keyboard, verifies its
  retained details and status, checks 390px document containment, and fails on
  browser console/page errors. CI runs this gate once on Ubuntu/Node 22 after
  installing Chromium; package unit tests remain cross-platform and do not
  require a browser download.
- **AC-11 (GitHub-owned publication)**: `.github/workflows/release.yml` remains
  the only publication entrypoint. Its manual dispatch selects exactly one of
  the root package, `@qoder-ai/harness`, `@qoder-ai/harness-ui`, or
  `@qoder-ai/harness-studio`, runs the complete repository check first, and
  publishes with the protected `npm` environment and repository secret. Local
  development commands build, test, pack, and dry-run only; this change never
  executes a local `npm publish`.

## Non-goals

- No change to DSL grammar, IR version, resolver semantics, or the
  `advisory` materialization cap.
- No dependency on `@ag-ui/core` (0.0.x, pre-stable, pulls rxjs/zod). The
  adapter implements the AG-UI **wire format** with local types; conformance
  is asserted by tests on the emitted JSON shapes. Revisit when AG-UI reaches
  a stable major.
- No replacement of the static-HTML harness inspector or the compare
  `verdict.html`; the studio reads the same evidence, it does not own it.
- No Pi live-run view in the studio (the seam is executor-generic; the Qoder
  executor is the first emitter, and the Pi executor emits text deltas only).
- No local publication or registry mutation. Package versions and the selected
  release target must be reviewed in git, then publication is dispatched from
  the repository's protected GitHub Actions `Publish npm` workflow.
- No authentication or remote deployment story for the SSE server; it binds
  to `127.0.0.1` by default and is a local development surface. This does not
  waive browser-origin protection: cross-origin access requires an explicit
  exact-origin allowlist.

## Design

```text
.harness ── @qoder-ai/harness ── HarnessRunEvent (neutral, streaming)
                                        │
                     @qoder-ai/harness-ui: AG-UI translator + SSE server
                                        │
             any AG-UI client ◄── SSE ──┤
                                        │
                     @qoder-ai/harness-studio: React Run view + Compare view
                                                  (verdict.json / evidence)
```

- `packages/harness/src/exec/events.ts`: `HarnessRunEvent` union plus
  `HarnessRunEmitter`, the lifecycle guard that enforces the framing
  invariants (single started/finished, message frames, paired tool calls).
  `QoderSdkExecutor` and `PiSdkExecutor` gain `onRunEvent`; the mapping from
  redacted SDK messages lives in `applyQoderSdkMessage()`. Qoder enables SDK
  partial messages and keeps per-parent mapping state so the later completed
  assistant message is a fallback, not duplicate output.
- `packages/harness-ui`: `protocol.ts` (AG-UI wire types), `translate.ts`
  (stateful neutral→AG-UI translator), `sse.ts` (frame encoding), `run.ts`
  (compile+resolve+execute with an injected executor factory), `server.ts`
  (`POST /agui`, `GET /healthz`, origin/content-type policy), `cli.ts`
  (`harness-ui serve`, repeatable `--allow-origin`).
- `packages/harness-studio`: React app under `src/app/` (pure state modules
  `agui-store.ts`, `compare-model.ts` kept separate from components), Node
  server under `src/server/` serving the esbuild bundle, `/api/evidence`, and
  an embedded harness-ui `/agui` route when a `.harness` file is provided.

## Plan and tasks

1. Tighten the neutral Qoder mapper around the SDK's `stream_event` contract,
   retain completed-message fallback behavior, and test de-duplication.
2. Make the AG-UI run layer own start/terminal framing and namespace protocol
   entity ids with the caller's run id.
3. Add a shared local-browser request policy to the standalone and embedded
   `/agui` handlers, plus an explicit origin allowlist for external local UIs.
4. Move verdict validation to the core compare owner and make Studio consume
   that validated contract.
5. Add workbench-style interactive tool cards, correlated result rendering,
   responsive table containers, and verify Run/Compare in a real browser at
   desktop and narrow viewports.
6. Keep the truncated-declaration compiler diagnostic fix as a supporting
   robustness change: malformed harness input must reach the AG-UI error path
   as diagnostics rather than an uncaught compiler exception.
7. Harden the browser boundary against client-controlled Host trust and make
   oversized request handling return a real 413 response without destroying the
   socket before the response is written.
8. Carry tool-result error/truncation metadata through a namespaced AG-UI custom
   event, distinguish failed and result-unavailable cards, memoize payload
   formatting, and add one built-app Playwright regression to CI.
9. Extend the existing GitHub Actions publication workflow with a constrained
   package selector so each Harness workspace is publishable without adding a
   local release path.

## Risks

- **Duplicate streaming text:** Qoder emits both partial events and a completed
  assistant message. Mapping state must suppress only the matching completed
  text and reset at the assistant boundary.
- **Browser-triggered runs:** a loopback listener is reachable from arbitrary
  webpages. Reject untrusted `Origin` values, DNS-rebinding-shaped
  non-loopback `Host` values, and simple non-JSON POSTs before reading or
  executing the harness; never derive trust from an arbitrary client-supplied
  Host or emit wildcard CORS.
- **Protocol identity collisions:** neutral emitter counters are run-local.
  The AG-UI adapter must namespace every correlated message/tool id
  consistently without changing the neutral contract.
- **Evidence drift:** Studio consumes persisted JSON that can be stale,
  truncated, or hand-edited. Validate the core verdict contract before
  deriving render rows and return bounded diagnostics.
- **Layout regression:** compare tables are intentionally wide. Constrain
  overflow to the table region and verify both desktop and narrow viewports.
- **False tool completion:** `TOOL_CALL_END` ends the streamed argument
  declaration, not necessarily execution. Keep the card in a running state
  until `TOOL_CALL_RESULT` or the run terminal settles it; retain failed and
  result-unavailable as distinct terminal states.
- **Large retained results:** tool output can be megabytes and otherwise
  amplify SSE buffering, React state, JSON parsing, and DOM work. Bound retained
  output at the neutral event owner, carry the original byte length, and memoize
  Tool Call rendering so unrelated text deltas do not reformat settled cards.

## Test evidence

- `packages/harness/test/events.test.ts` — AC-1, AC-2, including partial/full
  de-duplication and completed-message fallback
- `packages/harness-ui/test/translate.test.ts` — AC-3, including run-id
  namespacing and mutually exclusive terminal events
- `packages/harness-ui/test/server.test.ts` — AC-4, AC-8, including factory
  failure, same-origin/allowlisted CORS, and rejected hostile/simple requests
- `packages/harness-studio/test/agui-store.test.ts`,
  `packages/harness-studio/test/tool-call-model.test.ts` — AC-5, including
  result correlation, interrupted calls, and payload formatting
- `packages/harness-studio/test/compare-model.test.ts`,
  `packages/harness-studio/test/server.test.ts` — AC-6, AC-8, including
  malformed verdict rejection
- CI: `harness-ui:build` / `harness-ui:test` / `harness-studio:build` /
  `harness-studio:test` steps in `.github/workflows/ci.yml` — AC-7
- Release: manual `Publish npm` workflow package choices plus its protected
  environment, full-check, and workspace-scoped publish steps — AC-11
- Browser: built Studio Run and Compare views at desktop and 390px width,
  console/page error inspection, and saved screenshots — AC-5, AC-6, AC-9

## Validation record

- `npm run check` passed on 2026-08-15: root 94 files / 1324 tests,
  harness 9 files / 93 tests, harness-ui 2 files / 20 tests, harness-studio
  4 files / 25 tests, plus generated-source and package verification gates.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed after
  regenerating `docs/better-harness-doc-links.mmd`.
- Browser fixture verification exercised an expanded `Read` tool card with
  formatted arguments and correlated result. At an exact 390px content
  viewport, the document remained 390px wide; tool cards stayed within their
  container and Compare tables scrolled inside their labelled regions.
  Browser console/page logs were empty.
- Automated Playwright verification exercised a failed 64 KiB-truncated Bash
  result through the built Studio server at 390px, expanded and collapsed the
  card by keyboard, asserted document containment, saved a screenshot, and
  observed no console/page errors.
- Raw HTTP tests reject a matching attacker Host/Origin pair and return JSON
  413 responses for both declared-length and chunked bodies over 1 MiB. The
  GitHub `Publish npm` workflow parsed successfully with constrained package
  choices; no local publication command was executed.
- Workspace `npm pack --dry-run` gates passed without registry mutation:
  Harness UI contained 17 entries (12.2 kB) including the browser-safe protocol
  entrypoint; Harness Studio contained 28 entries (296.1 kB) including the
  built React application.
