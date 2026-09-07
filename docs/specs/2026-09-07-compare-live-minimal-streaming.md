# Minimal Compare lanes with revealed streaming and diagnosable ACP failures

## Traceability

- Spec ID: compare-live-minimal-streaming
- Status: Draft

## Intent

Compare's live Agent surface answers one question: what do these two Agents do
with this prompt. Today four stacked bands sit above the lanes before any
comparison exists, the lanes render raw event bursts instead of the revealed
stream the Debugger already uses, and a failed ACP handshake reports
`Incoming transport closed` without the Agent's own reason.

Reduce the surface to a composer plus two lanes, reveal assistant text at the
established cadence, and carry the ACP Agent's retained stderr into the
handshake failure so the reader can act on it.

## Acceptance Scenarios

- AC-1: The live Compare surface renders exactly two docked regions: one
  composer band and the lane pair. The duplicated page title, the eyebrow, the
  restated prompt line, and the four-row metric table are gone; the Studio shell
  and sidebar remain the only place the area is named.
- AC-2: The prompt box and both Agent selects keep their accessible names
  (`What should both Agents do?`, `Left Agent`, `Right Agent`) without rendering
  a visible label above each control.
- AC-3: The shared-working-tree caveat survives as one sentence inside the
  composer, and the no-Agent boundary still renders as an alert when the host has
  no available ACP Agent.
- AC-4: Each lane header carries the Agent label, its run status, and its own
  tool-call, message, and warning counts, so removing the metric table loses no
  fact. Warning counts appear only when a lane has warnings.
- AC-5: Assistant text in a lane is revealed through the shared
  `useStreamingText` hook at the 16ms/200ms cadence, with a caret while the
  message is open, so a bursty Agent reads as streaming rather than as a block.
  `RunView` and Compare use one implementation, not two.
- AC-6: A lane whose event list is already scrolled to the bottom follows new
  events; a lane the reader scrolled up is left where it was.
- AC-7: When the Rust ACP host cannot complete `initialize`, the reported error
  includes the Agent's retained stderr tail, bounded and redacted the same way
  existing evidence is, so a misconfigured Agent names its own cause instead of
  only `Incoming transport closed`.
- AC-8: Focused tests cover the streaming hook module boundary, the reduced
  Compare DOM at wide, compact, and narrow widths with no horizontal overflow and
  no console or page errors, and the host reporting an Agent's stderr from a
  failed `connection.open`.

## Non-goals

- Streaming Agent thought/reasoning chunks. The neutral `HarnessRunEvent` set has
  no thought type, and adding one changes both executors, the Rust adapter, and
  every consumer. Out of scope here.
- Changing the SSE transport, the run request contract, or the ACP wire contract.
- Changing which Agents the catalog offers, or how a lane is launched.
- Fixing any individual Agent's local configuration.

## Plan and Tasks

1. Extract `useSmoothStreamingText` from `RunView.tsx` into
   `src/app/run/use-streaming-text.ts` as `useStreamingText`, and import it in
   both `RunView` and `CompareLiveView`.
2. Rewrite `CompareLiveView` as composer plus lanes: drop the header band, the
   winner/prompt restatement, and the metric table; move per-lane counts into the
   lane header; keep accessible names on the controls.
3. Reduce `.live-compare-*` styles to the two remaining regions and delete the
   metric-grid rules, including their compact/narrow overrides.
4. Prune the retired `compare.live` i18n keys and add the lane-count and
   control-name keys in both locales.
5. Retain a bounded stderr tail per ACP connection in the Rust host's existing
   debug tap and append it to `connection.open` failures.
6. Update the live-compare browser test to the reduced DOM, add a host test for a
   stderr-bearing handshake failure, and re-verify Studio at three widths.

## Test and Review Evidence

- AC-1/AC-2/AC-3/AC-4/AC-6: `packages/harness-studio/test/browser/acp-debugger.spec.mjs`
  live-compare test, updated for the reduced DOM and per-lane counts.
- AC-5: `packages/harness-studio/test/streaming-text.test.ts` keeps covering the
  reveal function; the hook module is imported by both surfaces so a divergence
  fails typecheck rather than passing silently.
- AC-7: `packages/better-harness-desktop/rust/acp-host/tests/stdio_host.rs`
  opens a connection to a command that prints to stderr and exits, and asserts
  the reported error carries that text.
- AC-8: package typechecks and test suites for `@qoder-ai/harness-studio`,
  `cargo test` for the host, and Playwright screenshots at 1440x900, 900x800, and
  390x844.
- Risk: removing the metric table could hide a fact. Mitigated by moving every
  metric it showed into the lane header, where it sits next to the evidence it
  describes.
- Risk: stderr can carry secrets. Mitigated by reusing the existing bounded
  retention and redaction path rather than adding a new channel.
