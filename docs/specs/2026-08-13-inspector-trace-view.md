# Read a session as a trace in the Inspector

## Traceability

- Spec ID: inspector-trace-view
- Status: Implemented
- Supersedes the presentation slice of [inspector-evidence-selection](2026-08-12-inspector-evidence-selection.md);
  its selection model, evidence vocabulary, and Compare boundary still hold.

## Intent

The Inspector explained relationships but could not be read as a trace. A
reviewer could not see when a session did its work, could not see individual
calls at real volumes, and could not click one without making the surrounding
trace unreadable. This slice keeps the Delivery Tree, Date view, three-lane
workbench, and Session View, and makes the activity legible at the scale local
evidence actually reaches.

Baseline measured on a real local report (20 sessions, 1 654 normalized calls,
one session of 757 calls across 55 turns):

- the swimlane X axis was call ordinal, so a 3.9 h session showed no waiting;
- 577 of 757 bubbles (76 %) were drawn inside another bubble's radius at
  1.89 px per call, and only 29 % of the chart was on screen at once;
- selecting a Tool Call inside Session View rendered the Drawer beneath the
  `z-index:20` overlay and dimmed 1 034 elements to `opacity:.25`;
- one session reported four different turn totals (8 / 25 / 55 / 118);
- three commits predating the session were laid out inside Turn 1;
- 426 of 757 rows (56 %) were byte-identical to another row.

## Acceptance Scenarios

- AC-1: When the host observed call timing, the activity chart plots calls on a
  wall-clock axis and marks windows with no observed call as idle. When it did
  not, the chart states that it fell back to call order rather than implying a
  time it never observed.
- AC-2: No call is hidden underneath another. Above one call per bin a lane
  renders counted bars; drilling in by click or drag reaches individual marks,
  and the view reports how many calls are in view out of the total.
- AC-3: Selecting an object never de-emphasises unrelated objects. The selected
  and related objects gain emphasis, and the Evidence Drawer is readable above
  Session View in both the side and bottom-sheet layouts.
- AC-4: Every surface quotes one turn vocabulary from a single projection, and a
  retained prompt links to the Turn it actually came from rather than to its
  position in a capped, de-duplicated array.
- AC-5: A commit joins a Turn only when its timestamp falls inside that Turn's
  observed window. Every other in-scope commit is held in a labelled
  outside-the-window track that states no Turn is claimed to have produced it.
- AC-6: Identical consecutive tool rows collapse into an expandable run, and
  every row carries its observed start clock so rows stay distinguishable when
  redaction removes the command.
- AC-7: A long session stays navigable: Jump to tracks the reader's position,
  calls expand and collapse in bulk, overflow rows reveal in place instead of
  inside a nested scroll box, and related objects are grouped and capped per
  type so Turns and Tool Calls are never buried by commits.
- AC-8: Session View is a navigable state. Opening it pushes history, Back and
  Close agree, and a `view=session` deep link restores the same surface.
- AC-9: Expanding the activity chart does not collapse the delivery lane, and
  below three-lane width the lanes stack instead of forcing the page to scroll
  sideways.

## Non-goals

- Accepting, rejecting, or editing candidate mappings.
- Writing Feature Tree, Git, checkpoint, or native-session state.
- Inferring a start time, a duration, or an idle window the host did not observe.
- Reconstructing tool input that privacy filtering removed.
- A node-link graph canvas, compare view, search, or row virtualization.

## Design Decisions

**Wall-clock axis.** `buildToolCallTrace` now retains `startedAt`. A merged
lifecycle is canonically the *result* event, so `lifecycleDurationObservation`
exports the paired request stamp and the trace prefers it; reading the merged
event's own timestamp would have reported every paired call as starting when it
finished. `activityTimeline` reports `basis: "observed-time"` only when at least
two distinct stamps define a span, and `"call-sequence"` otherwise.

**Density over marks.** The chart is rendered in the browser from the report
projection rather than baked into per-session `<template>` elements. That is
what makes zoom possible, and it removed the duplicated SVG that inflated the
report from 1.7 MB to 2.9 MB. A lane bins to ~5 px and shows counted bars; when
every bin holds one call it switches to individual marks whose width is the
observed latency.

**Additive emphasis.** De-emphasis is gone. Selection adds a ring and tint to the
selected object and a rule to related ones, which keeps the trace readable and
removes a full-document `filter` repaint across ~10 000 nodes.

**Commit placement.** Turn membership requires containment in the Turn's
observed window. The previous default bucket sent every commit older than the
first Turn into Turn 1, which is exactly the temporal-proximity-as-authorship
claim the evidence vocabulary forbids.

## Test and Review Evidence

- AC-1/AC-2: `activity projection carries a wall-clock timeline and falls back
  to call order` asserts both bases, the span, and that an untimed projection
  omits `startedAt` rather than defaulting it.
- AC-4: `one turn vocabulary is projected and retained prompts resolve to their
  real Turn` binds a single retained prompt to Turn 2 and freezes `turnCoverage`.
- AC-1/AC-3/AC-5..AC-9: `Inspector explains a trace on a time axis without
  occluding or dimming it` asserts the axis copy, idle shading, the absence of
  `selection-unrelated` and `filter:saturate`, Drawer layers above Session View
  in both layouts, the outside-the-window commit track, run collapsing, the
  removal of the `session-call-list` scroll box, scroll-spy, bulk expand,
  `view=session` plus `popstate`, grouped related objects, and that expanding
  activity no longer collapses delivery.
- Regression: `npm test` 1364/1364, `npm run pack:verify` 502 npm / 524 runtime
  entries.
- Browser review on a real local report: drill-down from 757 calls to 36
  individual marks in two clicks; clicking a Tool Call inside Session View
  dimmed 0 elements against a previous 1 034 and left the Drawer on top;
  Session View reported 0 nested scroll boxes and 0 commits in Turn 1 against a
  previous 3, with 5 commits in the outside-the-window track; Back closed the
  view and restored the workbench URL; no page or console errors.

## Risks

- Privacy: `startedAt` is a wall-clock stamp of the same granularity already
  exposed on Turns and Commits; no new input text or path is retained.
- Correlation: idle shading describes windows with no observed call, not user
  inactivity, and the outside-the-window commit track states its own limit.
- Scale: binning is bounded by plot width, not by call count, and the removal of
  per-session SVG templates reduced report size at the same evidence coverage.

## Amendment (2026-08-13): the timeline is inside Session View and linked

The first slice kept the wall-clock activity chart in the workbench lane and left
Session View as a vertical Turn list. In use that split the one time-axis
visualization from the one place calls can be read line by line: they never
shared a screen, so a reviewer could not go from a busy stretch on the chart to
the calls under it, and a session whose calls carried no dialogue Turn showed
"0 tool calls" on every Turn while its whole trace sat in a page-tail bucket.

This amendment moves the same chart (`activityChartMarkup`, re-rendered by
`renderActivityChart` through the existing `[data-activity-chart]` wiring, so it
shares the per-session zoom state and needs no second model) into a sticky,
collapsible strip at the top of Session View, and links it to the list. No new
data is projected; it reuses `startedAt` and Turn `startMs/endMs` already
present.

- AC-10: Session View opens with the wall-clock strip visible above the list.
  A session with no dialogue Turn still renders the strip from observed call
  times, and its untied calls are held in one bucket ordered by observed time
  rather than as an unordered pile.
- AC-11: The strip is a minimap. Clicking a bar scrolls the list to the calls
  under it (expanding whatever disclosure hides them); a multi-call bar also
  zooms. Zooming in the strip and in the workbench chart share one state.
- AC-12: A short session opens every Turn's tool calls; a long session (> 12
  Turns) stays collapsed and is navigated from the strip. Identical consecutive
  rows stay collapsed as a run so the default view is concise, not a wall of
  duplicates. Row virtualization and a node-link canvas remain non-goals.
- AC-13: Filtering a tool type hides both its rows and the run bands that stand
  in for it, and the sidebar tool total recomputes to the count that survives
  the current filters (a run counted once per grouped call), independent of
  which disclosures are open.
- AC-14: The idle legend states the shading is a window with no observed call,
  not a user wait; a session with no observed timing keeps the sequence-axis
  label rather than implying a time.
- AC-15: Above the action lanes the chart carries a ribbon that fills the whole
  domain: observed calls are painted over a continuous band, so the time not
  spent inside a tool is a visible share of the trace rather than blank canvas.
  The bare band is labelled unattributed — model work or waiting — and never as
  a model turn. The ribbon is omitted on the call-order fallback, where spacing
  would be an artefact of ordinal position rather than elapsed time.

**Why the ribbon.** The lanes plot the instant a call ran, so a reader saw only
the moments a tool was executing. Measured on a real local report, 1 178 gaps
between consecutive calls had a median of 6.6 s and a p90 of 29.7 s, while the
idle threshold that produced any shading was 45 s: 1 113 of those gaps (94.5 %)
had no visual representation at all. On one 2.2 h session the observed tool time
totals 14 m — the chart was drawing 21 % of the trace and leaving 79 % blank.
The ribbon makes that residue a first-class part of the picture without claiming
to know what happened inside it: `projectDialogue` keeps note text but no note
timestamp, so the host observed when tools ran, not when the model worked.

Verified on a real local report: on a dialogue-less 235-call session the strip
renders on open and clicking a bar zooms to ~18 calls in view and scrolls the
list to the matching rows (timestamps ascending); toggling the Bash tool moves
the sidebar total 235 → 150 → 235 while its run bands hide and restore; a
10-Turn session opens all five tool blocks by default; no console errors.
