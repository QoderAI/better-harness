# Make Session Viewer easier to scan

## Traceability

- Spec ID: inspector-session-view-density
- Status: Implemented

## Intent

Opening a session currently spends most of a laptop-height viewport on the
title, mode controls, and full normalized-activity chart before the dialogue
trace begins. Reviewers should be able to keep the activity overview in sight
while scanning multiple turns without losing the existing evidence details.

Use the supplied dense trace-view reference for layout rhythm only. Preserve
Better Harness terminology, evidence semantics, privacy boundaries, controls,
and visual tokens.

## Acceptance Scenarios

- AC-1: At a 1280 by 720 desktop viewport, opening Trace keeps the session
  identity, mode tabs, and normalized activity overview inside the top half of
  the viewport, so the first Turn's prompt is readable without scrolling. A Turn
  longer than the remaining viewport still scrolls; the criterion bounds the
  pre-dialogue chrome, not the Turn body.
- AC-2: Session View uses a compact activity projection with at most four
  visible action lanes while retaining the full call total, the compressed
  long-idle axis, zoom, commit markers, and keyboard-selectable evidence. The
  compact projection drops the chart legend, so the numeric longest-idle span
  and the untimed-call notice stay in the Workbench chart only.
- AC-3: Per-turn tool-call groups start collapsed in every session. Reviewers
  can still expand one group, expand all groups, reveal grouped overflow, and
  select an individual call.
- AC-4: Turns read as dense row groups instead of separated floating cards;
  prompts, intermediate responses, tool groups, responses, and commits remain
  visibly distinct and keep their native focus and selection behavior.
- AC-5: Jump, filters, source, Trace/Replay, Continuation packet, and the
  Evidence Drawer remain available. At narrow widths the sidebar continues to
  stack without horizontal page overflow.

## Non-goals

- Copying DeepSeek branding, navigation, chat composer, or model controls.
- Adding raw system prompts, tool payloads/results, schemas, or new evidence.
- Replacing the existing Evidence Drawer with a second detail system.
- Changing report data, correlation, replay semantics, or privacy projection.

## Plan and Tasks

- Add an explicit compact rendering mode for the Session View activity chart;
  keep the Workbench chart unchanged.
- Tighten the title, tabs, timeline panel, turn groups, event rows, tool rows,
  and sidebar using the existing Inspector token family.
- Default per-turn tool disclosures closed while preserving all reveal and
  selection paths.
- Compare before/after screenshots at the same 1280 by 720 viewport and verify
  Trace, zoom, call expansion/selection, filters, Replay, and responsive reflow.

## Test and Review Evidence

- AC-1: measured element bounds on a real rendered report — session title
  58–84px, activity panel 169–349px, first Turn starting at 359px, so the
  pre-dialogue chrome stays inside the top half of a 720px viewport.
- AC-2/AC-3/AC-5: browser interaction checks on a real report — four lane
  labels with the remainder aggregated as Other activity, Reset zoom present,
  legend computed as display:none, zero tool groups open on load, one group
  expanding to its rows, expand-all and collapse-all, the Prompts filter
  hiding and restoring prompt events, Trace/Replay switching, and no
  horizontal page overflow at a narrow width.
- AC-4: focus and selection applied to a Turn's prompt button, with the focus
  outline and the selection ring both rendering inside the Turn card.
- Regression: full `npm test` at 1317 passing; the two failures were
  load-induced 120s timeouts in unrelated CLI suites
  (`test/plugins/host-support.test.mjs`,
  `test/reporting/report-source-review.test.mjs`) that pass when run alone.
  `git diff --check` clean. No console or page errors in the rendered report.

## Risks

- Density can become illegible; keep primary dialogue text at 11px and preserve
  focus outlines rather than shrinking every surface uniformly.
- Fewer chart lanes can hide categories; aggregate the remainder as Other
  activity with a descriptive accessible title instead of dropping calls.
- Sticky regions can compete for height; keep one page scroller and verify the
  timeline does not cover turn content.
