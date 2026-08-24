# Compress long idle windows on the Inspector timeline

## Traceability

- Spec ID: inspector-idle-time-compression
- Status: Implemented
- Extends the wall-clock contract in
  [inspector-trace-view](2026-08-13-inspector-trace-view.md).

## Intent

A session can pause for tens of minutes while a developer is away and then
resume. A strictly linear wall-clock axis gives that unobserved interval most of
the chart width, compressing the actual normalized actions into unreadable
clusters even though the idle duration itself is already known and labelled.

Use a visibly broken time scale for dominant idle windows. Preserve real UTC
timestamps and duration labels, but cap the visual width spent on a long gap so
activity before and after it remains observable.

## Acceptance Scenarios

- AC-1: On an observed-time axis, a gap longer than both five minutes and 12%
  of the visible raw span is compressed to a bounded visual segment.
- AC-2: A compressed gap remains shaded and is labelled with its real duration
  and the word `compressed`; its tooltip retains the real UTC boundaries.
- AC-3: Calls, duration bars, bins, commit markers, grid ticks, and idle shading
  share the same piecewise mapping, so no mark drifts away from its timestamp.
- AC-4: Drag zoom and counted-bin zoom invert the piecewise scale back to real
  wall-clock bounds; Reset zoom restores the full raw session window.
- AC-5: Short gaps, call-sequence fallback charts, and a zoomed range without a
  dominant idle window keep the existing linear layout.
- AC-6: The accessible chart description and legend state that long idle
  windows are visually compressed and remain unobserved time, not user wait.

## Non-goals

- Removing idle windows or subtracting them from the reported session duration.
- Claiming whether an idle interval was model work, user absence, or waiting.
- Compressing the event order used by Replay playback.
- Changing normalized tool-call timestamps or correlation.

## Plan and Tasks

- Add a pure piecewise timeline-scale owner with forward and inverse mapping.
- Embed that tested scale function into the self-contained workbench script.
- Route marks, bins, durations, ticks, gaps, commits, and brush inversion through
  the same scale.
- Give compressed gaps explicit visual and accessible treatment.

## Test and Review Evidence

- AC-1/AC-3/AC-5: focused unit tests exercise forward mapping for long gaps,
  short gaps, boundaries, marks inside a compressed gap, and the linear fallback.
- AC-4: focused tests round-trip visual positions back to raw time; browser
  verification drags or clicks a compressed chart and checks its real range.
- AC-2/AC-6: browser verification inspects the generated SVG label, tooltip,
  description, legend, and a saved real-report screenshot.
- Regression: run the focused Inspector tests, `npm test`, and
  `git diff --check`.

## Risks

- Misreading: compressed segments are explicitly labelled and use break marks;
  UTC ticks continue to show real timestamps rather than a fake shorter session.
- Interaction drift: one forward/inverse scale owns every mark and zoom path.
- Dense gaps: the 12% threshold bounds how many dominant gaps can qualify in one
  view, while each compressed gap receives a small but selectable width.
