# Showing what an Agent is doing before it can answer

## Traceability

- Spec ID: agent-startup-visibility
- Status: Implemented
- Request: continue the microVM work; the remaining gap was a boxed run that
  looks hung for its first ~96 s
- Builds on: [`2026-09-11-debugger-microvm-placement.md`](2026-09-11-debugger-microvm-placement.md),
  [`2026-09-11-box-driver-singleton.md`](2026-09-11-box-driver-singleton.md)

## Intent

A boxed Agent installs itself before it can speak ACP. Measured at ~96 s the
first time in a Project. For all of it the run sat in `running` with nothing to
show, which is indistinguishable from wedged — the composer warns that this will
happen, but a warning up front is not the same as knowing it is still working.

The Agent *is* saying what it is doing. `harness-box-exec` writes
`provisioning: npm install …` to stderr, and `harness-acp-host` already captures
that stream — but only to decorate an error, after the fact, if the handshake
dies. On the success path it is retained and never shown.

Stream those lines as they arrive, and show the latest one while the Agent is
starting.

This is not specific to boxes. Any Agent that prints before its first frame —
loading a config, refusing a credential, resolving a model — becomes visible
instead of silent.

## Acceptance Scenarios

- **AC-1** Given an Agent writing to stderr before it answers `initialize`, when
  the host reads those lines, then each is emitted as an event addressed to that
  connection, while the connection is still opening.
- **AC-2** Given such an event, when it reaches Studio, then the Live
  observation panel shows that line, labelled as startup rather than as a
  warning or an error.
- **AC-3** Given many such lines, then only the latest is held. An npm install
  emits hundreds and none of them are history.
- **AC-4** Given the Agent then answers, when the connection is ready, then the
  startup line is cleared — it described getting there, not being there.
- **AC-5** Given a runaway writer, then one line cannot flood the channel: lines
  are capped, and the event is shed rather than queued when the sink is full.
- **AC-6** The retained diagnostic tail keeps working unchanged: a failed
  handshake still carries the Agent's own words into the error.

## Non-goals

- A progress *bar*. Nothing upstream knows how many steps remain or how long
  they take; a line of the Agent's own text is what there is to show.
- History or a log view. The latest line is state, not a transcript, and it is
  deliberately not retained with the run.
- Redaction. These are the same bytes already shown when a handshake fails; the
  Node executor treats its equivalent stream the same way.
- Streaming the Agent's stderr *after* it is answering. The interesting window
  is before the first frame; after that the transcript is the story.

## Plan and Tasks

One line of text crosses four contracts, so each hop stays as small as possible:

| Layer | Change |
| --- | --- |
| `acp-host` wire | `HostEvent::AgentDiagnostic { connectionId, line }`, plus a 512-byte per-line cap |
| `acp-host` connection | The existing stderr tap now also `try_send`s the line it was already retaining |
| `@qoder-ai/harness` | `HarnessRunEvent` gains `acp-agent-diagnostic`; `HarnessRunEmitter.diagnostic()` delivers it |
| `harness-studio` | `startupNotice` on the run state — latest only, cleared on `acp-connection-ready` — rendered in Live observation |

Two deliberate choices:

**Not a warning.** `run-warning` exists and would have been one line of work,
but a run that installs an Agent would then report a wall of warnings for
working normally, and Studio counts warnings on screen.

**`try_send`, not `send`.** The tap is a synchronous `Fn` on the crate's read
path and cannot await; blocking there stalls the Agent's stdout. A dropped
progress line costs nothing, a stalled Agent costs the run. This matches what
the protocol-frame tap beside it already does.

## Test and Review Evidence

Local macOS 26.6.2, 2026-09-11.

| AC | Evidence |
| --- | --- |
| AC-1 | Driving the built `harness-acp-host` with an Agent that writes two stderr lines then exits produced `{"event":{"type":"agent-diagnostic","connectionId":"c1","line":"preparing-the-microVM"}}` and `…"installing-the-agent"…`, both *before* the `initialize` failure reply. |
| AC-2/3/4 | `run-store.test.ts`: a diagnostic sets `startupNotice`, a second replaces it rather than appending, `warnings` stays empty, and `acp-connection-ready` clears it. |
| AC-5 | Lines over 512 bytes are truncated on a character boundary with an ellipsis; the sink is the existing bounded `try_send`. |
| AC-6 | `cargo test` in `acp-host`: 75 passed, including the diagnostics tail tests that decorate a failed handshake. |

`harness` 217 tests and `harness-studio` 671 tests pass; `tsc --noEmit` clean in
both. `cargo fmt --check` shows no diff in the lines this change touched — the
crate has pre-existing formatting drift that was deliberately left alone rather
than reformatted into this diff.

Risk: the Agent's stderr now reaches the browser on the success path, not only
inside an error. It is the Agent's own diagnostic text and was already shown on
failure, but an Agent that prints a secret while starting would now print it
somewhere new. Capping the line does not change that.

AI involvement: Claude implementation and local verification.
