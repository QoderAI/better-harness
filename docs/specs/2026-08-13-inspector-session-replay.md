# Replay retained session evidence

## Traceability

- Spec ID: inspector-session-replay
- Status: Draft

## Intent

Let a reviewer play through one retained coding-agent session without leaving
the Inspector's existing evidence model. Session View should keep its current
chronological Trace and add a Replay mode that synchronizes a current-event
stage, an event/file index, a compact timeline, and playback controls.

Replay is a read-only presentation of the sanitized report projection. It does
not rerun tools, restore a worktree, resume a native host session, or invent
timestamps for content whose time was not observed.

## Acceptance Scenarios

- AC-1: `Open session` exposes semantic `Trace` and `Replay` tabs. Trace remains
  the default, and a URL with `view=session&session-mode=replay` restores Replay
  for the named session.
- AC-2: Each projected session owns a `SessionReplay` model, without a version
  suffix in its name. It deterministically projects retained prompts,
  intermediate responses, tool calls, final responses, and directly linked
  commits from the already-sanitized report model.
- AC-3: Every replay event declares its timing basis. Observed prompt, tool, and
  commit timestamps may appear on the wall-clock rail; response boundaries may
  be labelled as Turn-bound; intermediate responses and other untimed content
  remain `sequence-only` and are never assigned an invented clock time.
- AC-4: Selecting an event updates the current-event stage, the event index, the
  compact timeline cursor when timing exists, and the Inspector selection when
  the event has a Story, Session, Turn, Tool Call, File, or Commit descriptor.
  Existing Evidence Drawer relationships and limitations remain authoritative.
- AC-5: Replay provides previous, play/pause, and next controls plus 1x, 2x, 4x,
  and 8x event pacing. Playback advances by retained event order, compresses
  long unobserved gaps instead of making multi-hour sessions wait in real time,
  stops at the end, and never invokes a host tool.
- AC-6: Replay exposes `Events` and `Files` index tabs. Choosing a file selects
  that repository-relative path and moves to the first retained replay event
  that names it, without claiming the event authored a commit.
- AC-7: The mode tabs, index tabs, event rows, file rows, playback buttons, and
  speed controls are keyboard operable; the current event uses non-color state
  cues, playback respects reduced-motion preference, and controls do not steal
  shortcuts from form inputs.
- AC-8: The self-contained HTML retains no raw tool input/output, hidden
  reasoning, absolute home path, or credential. Missing content and unavailable
  timing stay explicit in the model and UI.
- AC-9: Focused behavior tests cover `SessionReplay` ordering and timing bases,
  direct-commit inclusion, untimed fallbacks, mode restoration, playback
  controls, and final HTML privacy. A real multi-hour local session is verified
  in desktop and narrow browser layouts with no page or console errors.

## Non-goals

- Adding Replay as a top-level Inspector scope beside Delivery Tree and Date.
- Executing, retrying, resuming, or mutating a tool call, Git state, worktree,
  feature-tree mapping, checkpoint, or native host session.
- Human annotations, pinned notes, author identity, or report persistence.
- Fabricating cost, token, test-result, response, or timing evidence that the
  source projection did not retain.
- Replacing Trace, the Evidence Drawer, or the existing wall-clock activity
  chart with a second relationship model.

## Plan and Tasks

1. Extend `scripts/harness-inspector/report-model.mjs` with a bounded
   `SessionReplay` projection built only after Session/Commit links exist.
   Preserve explicit timing bases and direct-commit limitations.
2. Extend `scripts/harness-inspector/ui/workbench.js` with a session-local
   playback owner separate from evidence selection and chart zoom. Render
   Trace/Replay tabs, the event stage, Events/Files index, compact rail, and
   playback controls from the projected model.
3. Extend `scripts/harness-inspector/ui/workbench.css` with responsive Replay
   layout and accessible selected/focus treatments that reuse current Inspector
   tokens and typography.
4. Extend focused Inspector tests with behavior assertions over the model and
   rendered interactions. Preserve unrelated working-tree changes in the same
   files and keep the report self-contained.
5. Render a real report, exercise mode switching, event/file selection,
   playback, speed, URL restoration, Trace return, keyboard behavior, desktop
   and narrow layouts, then inspect console/page errors.

## Test and Review Evidence

- AC-2/AC-3/AC-8: `npx vitest run test/reporting/harness-inspector.test.mjs`
  asserts the parsed model shape, event ordering, timing bases, direct commits,
  and sanitized projection rather than matching implementation source text.
- AC-1/AC-4..AC-7: browser behavior against a real self-contained report,
  including a copied Replay deep link and an event with no observed timestamp.
- AC-9 regression: `npm test`, `npm run pack:verify`, documentation link graph,
  and a Review Readiness Check over the final local/staged split.
- Privacy risk: Replay consumes only projected safe text and repository-relative
  paths; final HTML is checked for private-path and credential leakage.
- Correlation risk: only explicit or observed-commit relationships enter the
  replay stream. Same-path and contextual commits stay in Trace/Evidence.
- Scale risk: the index is event-driven and the compact rail renders timed
  events only; playback advances by event pace so long idle windows do not block
  review.
- Interaction risk: Replay state is session-local and URL-addressable, while
  Evidence selection and activity zoom remain separate owners.

## Replay Legibility Follow-up

Deep-linking to a mid-session event (`replay-event=call:A179`) exposed six
legibility defects, since fixed and verified in-browser against a real
multi-hour local session with no console or page errors:

- AC-4 follow-up: `updateReplayPresentation` now keeps the current event row in
  view inside the index's own scroller only, so following playback never scrolls
  Session View or the Workbench underneath it, and a tab return re-reveals it.
- AC-7 follow-up: the current row uses a stronger non-color cue (heavier bar,
  bold title) in addition to background, and the mode tabs (filled) read
  distinctly from the index tabs (underlined).
- Layout: the index column tracks layout width instead of the viewport and keeps
  its own readable height, so a narrow window or open Drawer narrows the column
  rather than stacking it where the sticky transport would cover the list. The
  event card no longer reserves a tall fixed height that dwarfed short evidence.
- AC-8 follow-up: a bounded (clipped) projection body is flagged `bodyExcerpt`
  and shown as an `Excerpt` badge instead of a silently truncated command.
- Orientation: the timeline rail gains a type legend, and duplicated position and
  timing text collapses to one `Event N / total` label plus the card's Turn line.
- Overlay: the root scroller locks while Session View is open so wheel gestures
  cannot scroll the hidden Workbench.
