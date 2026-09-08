# Give the Debugger Live observation pane one identity line and frame timing

## Traceability

- Spec ID: studio-debugger-live-inspector-density
- Status: Proposed

## Intent

The Debugger's live right pane stacks four regions before the first piece of
protocol evidence: a pane header (`Live observation` + status), a runtime meta
row (project label, Agent label, `ACP v1 · Harness stream`), a five-row
`Observed state` fact list, and a bordered `Raw ACP` list. Three concrete
problems, not only density:

1. **The protocol is named three times and timed zero times.** `ACP v1 · Harness
   stream`, the `ACP frames` counter, and the `Raw ACP` section title all say the
   same thing, while nothing says *when* those frames arrived. The pane can
   report `17 frames` without revealing whether they streamed over 200ms or over
   four minutes.
2. **The runtime meta row is chrome that disappears when it is needed.** Agent
   identity, protocol version, and the run's bound Project sit in a floating row
   between the pane header and its first section, and two media queries hide
   that row entirely at 1320px and 1080px — dropping the only statement of what
   this pane is observing exactly where space is tightest.
3. **Counters occupy the same visual weight as identifiers.** `Tool calls`,
   `Warnings`, and `ACP frames` are three single-digit numbers, each given a
   full-width bordered `<dt>/<dd>` row equal in weight to a 30-character run
   id — which itself wraps mid-token because the term column takes 38%.

The `Raw ACP` list then draws a box border inside a section that already draws
its own bottom hairline, and inside a section inset that already indents it.

This change folds the pane's identity into the section it describes, compresses
the three counters into one row, gives each identifier its own full-width line,
drops the repeated borders, and adds observed timing — the elapsed time between
each adjacent pair of frames, plus the total span above the list.

Separately, the live Execution Tree reserves a disclosure column
(`.tree-caret-spacer`, `--space-xl`) on all four of its rows even though none of
them is expandable, so its first node sits 24px inside its own pane header.

## Non-Goals

- Changing the recorded (saved-run) `StateInspector`. Its tabs, comparison line,
  and `Raw ACP` dl stay as they are; only the shared `.inspector-section` and
  `.acp-protocol-list` border rules it inherits are touched.
- Dropping the run's bound Project label. It is not a third copy of the sidebar's
  Project: a sidebar switch during a live run leaves this the only place naming
  what the run is actually executing in, which
  `test/browser/project-shell.spec.mjs` already pins.
- Making live tree rows selectable. They remain non-navigable in live mode; only
  the dead disclosure column is removed.
- Adding a wire timestamp to `HarnessProtocolEvent`. Timing is the Studio's own
  observation clock, read when a frame is folded into run state, and is labelled
  as observed rather than as agent-reported.
- Persisting frame timing into saved run records.

## Acceptance Scenarios

- **AC-1:** The live Execution Tree reserves no disclosure column. Its first node
  aligns with its pane header text instead of being indented past an empty
  caret slot, and depth indentation for turn, prompt, and stage rows is
  preserved.
- **AC-2:** The live pane names the observed Agent, protocol, and bound Project
  exactly once, on a single wrapping identity line that opens the `Observed
  state` section. No separate runtime meta row exists above the section, and the
  identity is never hidden by a width breakpoint.
- **AC-3:** The bound Project stays named after the sidebar switches to another
  Project, so an in-flight run cannot be misread as belonging to the Project now
  selected in the sidebar.
- **AC-4:** `Tool calls`, `Warnings`, and `ACP frames` render as one row of
  inline counters, each a value with its own visible label, not as three
  full-width bordered fact rows. `ACP frames` still appears only for ACP runs.
- **AC-5:** `Run ID` and `Thread ID` stay visible and complete, each as a
  monospace value under its own label so a `thread_<stamp>` id reads on one line
  at the pane's default width instead of breaking mid-token.
- **AC-6:** The `Raw ACP` frame list draws no outer box border and no bottom
  border under the last section. Adjacent frames stay separated by a single
  hairline.
- **AC-7:** Above the frame list, a bounded strip states the first and latest
  observed frame clock times and the total span between them. It is absent while
  no frame has been observed.
- **AC-8:** Each listed frame states the elapsed time since the previous
  retained frame. The first frame of a run states no elapsed time rather than
  `0 ms`, and a frame whose predecessor scrolled out of the rendered window still
  reports its true delta.
- **AC-9:** Timing values use tabular figures and never widen the pane: the live
  pane stays bounded with no horizontal document overflow at wide (1440),
  compact (1024), and narrow (390) layouts.

## Plan

- `app/run/acp-frame-timing.ts` (new): pure, exported, and independently
  testable. `acpFrameTimings(events)` maps retained frames to
  `{ observedAt, sincePreviousMs? }` over the full array; `acpObservationSpan`
  reduces those to `{ firstAt, lastAt, totalMs }`; `formatObservedClock` and
  `formatObservedElapsed` produce the display strings.
- `app/run/run-store.ts`: `protocolEvents` becomes
  `ObservedProtocolEvent[]` (`HarnessProtocolEvent & { observedAt: number }`),
  stamped from the Studio clock as the `protocol-event` case folds. The reducer
  keeps its two-parameter signature — `applyHarnessRunEvent` is used as a
  `reduce` callback, so a clock cannot be added as a third positional argument.
- `app/run/RunView.tsx` `LiveInspector`: the `.debugger-runtime-meta` row becomes
  a `.live-observation-identity` line inside the `Observed state` section,
  keeping the `.debugger-run-project` hook; the counters become
  `.observed-counters`; the fact list keeps only the two ids as
  `.fact-list-ids`; the `Raw ACP` section delegates to a new `AcpFrameList` that
  renders `.acp-observation-span` above the list and a per-frame
  `.acp-frame-delta` inside each summary.
- `styles/workbench.css`: `.live-tree` drops the caret column; add
  `.live-observation-identity`, `.observed-counters`, `.fact-list-ids`,
  `.acp-observation-span`, `.acp-frame-delta`; remove the `.acp-protocol-list`
  box border and its section inset; add
  `.inspector-section:last-child { border-bottom: 0 }`; delete the two
  `.debugger-runtime-meta` media-query rules and its remaining base rules, which
  no markup targets once the row is gone.
- i18n (`en` + `zh-CN`): add `raw.frameWindow`, `raw.firstFrame`,
  `raw.latestFrame`, `raw.totalSpan`, `raw.sincePrevious`.

## Test & Review Evidence

- `packages/harness-studio/test/acp-frame-timing.test.ts` (new, 13 assertions):
  pairwise deltas over the full array, absent delta for the first frame, a
  clamped backwards clock, span reduction for zero/one/many frames, and the
  `ms`/`s`/`m s` formatting boundaries. Each calls a function and checks its
  returned value.
- `packages/harness-studio/test/run-store.test.ts`: a folded `protocol-event`
  carries a finite `observedAt`, and a replayed sequence neither appends nor
  restamps it.
- `packages/harness-studio/test/browser/acp-session-stream.spec.mjs`: after a
  streamed ACP run, asserts three counters with `ACP frames` last, two complete
  id rows, a two-clock window strip with a numeric span, `min(retained, 12)`
  rendered frames, a `+<duration>` delta on the second frame, no delta on the
  run's first frame (and a real delta when the tail's predecessor is off-screen),
  a computed `border-top-width: 0px` on the frame list, a computed
  `border-bottom-width: 0px` on the last section, and a hidden live-tree caret
  spacer. It also asserts `document.documentElement.scrollWidth` equals the
  viewport width at 1440/1024/390 with page errors empty (AC-9).
- `packages/harness-studio/test/browser/acp-debugger.spec.mjs`: the two Agent
  identity assertions now target `.live-observation-identity`.
- Verified in an isolated checkout of exactly this change, with the concurrent
  ACP session-control work in the tree excluded: `packages/harness` typechecks,
  `harness-studio` builds, `vitest run` is 584/584, and
  `acp-session-stream` + `acp-debugger` + `project-shell` browser specs are 18
  passed / 1 skipped (macOS NSXPC). This is what proves the `run-store` change is
  consistent with the committed harness event union rather than only with the
  working tree's.
- `tool-call.spec.mjs:697` fails on an arrow-key focus assertion in
  `.studio-primary-nav`. Reproduced at plain `HEAD` (`1eea73a`) in the same
  isolated setup with none of this change applied, so it is pre-existing and out
  of scope here.
- In the full working tree (this change plus the concurrent ACP session-control
  work) the browser suite is 80 passed / 4 failed. Besides `tool-call.spec.mjs`,
  `acp-debugger.spec.mjs:422`, `acp-session-stream.spec.mjs:38`, and
  `git-history.spec.mjs:98` each pass when run individually and are therefore
  order-dependent in that tree, not results of this change.

## Risk

- Deltas are Studio receipt times, not wire times. Two frames delivered in one
  SSE flush can read as `0 ms` apart when the Agent produced them further apart.
  The strip is therefore labelled as observed frame timing, and the run's own
  reported duration in `result.metrics` remains the authority for run cost.
- Removing `.debugger-runtime-meta` from this pane deletes CSS that two media
  queries still target. Both rules are removed in the same change; leaving them
  would be dead code that a future reader would mistake for a live constraint.
