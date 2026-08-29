# Show user prompts as turn boundaries

## Traceability

- Spec ID: harness-inspector-prompt-boundaries
- Status: Implemented

## Intent

Make User Prompt evidence clarify where a new user turn starts in the Usage and
Context report. Prompt text should remain first-class, bounded evidence without
being repeated beneath every model response or visually competing with the
context-progression curve.

## Acceptance Scenarios

- AC-1: A Usage progression point retains a bounded `userPrompt` only when it
  is the first observed model response inside that user Turn. Later responses
  retain the Turn index but do not duplicate the prompt text.
- AC-2: Context progression renders each observed user Turn as a short,
  keyboard-focusable boundary tick on the response-order axis. It does not draw
  a warning-shaped triangle or a full-height prompt line across the chart.
- AC-3: Focusing, hovering, clicking, Enter, or Space on a Turn boundary opens
  one inspector detail containing response time, Turn number, and the bounded
  privacy-filtered prompt excerpt.
- AC-4: The latest-response table shows prompt text once at an observed Turn
  boundary. When its bounded window begins partway through a Turn, the first
  visible row says `Turn N continued`; subsequent rows do not repeat the Turn
  label or prompt excerpt.
- AC-5: Standalone Inspector and native Studio expose the same prompt-boundary
  vocabulary and remain usable at 1440x900, 1024x768, and 390x844 with no
  document-level horizontal overflow, clipped meaningful text, sub-12px text,
  console errors, or page errors.

## Non-goals

- Showing system, developer, or base-instruction text.
- Guessing a Turn association when response timestamps do not fall inside an
  observed Turn window.
- Adding a prompt filter, prompt editor, session continuation action, or a
  second selection model to the read-only report.
- Changing provider token accounting, context-reset detection, or compaction
  semantics.

## Plan and Tasks

1. Tighten the report projection so prompt text is attached only to the first
   time-contained response in each Turn while keeping `turnIndex` on later
   responses.
2. Replace the chart's prompt triangles and full-height dashed lines with short
   categorical Turn-boundary ticks on the response-order axis.
3. Group the bounded latest-response rows by Turn, rendering one prompt or one
   continuation label per visible Turn group.
4. Keep standalone string rendering and native Studio React rendering
   behaviorally equivalent.
5. Add focused report-model and browser checks, then capture wide, compact, and
   narrow visual evidence.

## Test and Review Evidence

- AC-1: `test/reporting/harness-inspector.test.mjs` pins prompt text to the
  first observed Usage point while later points keep only their Turn index.
- AC-2/AC-3: the existing Studio Usage-report Playwright flow verifies the
  focusable Turn marker, detail inspector, marker shape, and absence of a
  full-height prompt line.
- AC-4: Studio browser assertions cover one prompt excerpt and one continued
  Turn label across a bounded response window; standalone visual inspection
  checks the same generated report.
- AC-5: build Studio, run its focused browser scenario, run the standalone
  visual contract, inspect console/page errors and overflow, and save all three
  viewport screenshots.
- Privacy risk: prompt text remains bounded by the existing report projection;
  no new raw transcript field enters the portable HTML.
- Traceability risk: `turnIndex` is retained on continuation responses so the
  compact presentation does not weaken the observed time-containment link.

## Validation Evidence

- `npx vitest run test/reporting/harness-inspector.test.mjs`: 35 tests passed.
- `npm run build -w @qoder-ai/harness-studio`: passed with the Node 24 runtime.
- Focused Studio Playwright Usage flow: 1 test passed. The first run exposed a
  prompt-boundary hit target overlapping the context baseline; moving Turn
  markers onto a separate event rail fixed the interaction and the rerun passed.
- A generated 622-response Codex report rendered 12 short Turn-boundary ticks,
  no full-height legacy prompt lines, no repeated prompt in the latest-response
  window, and one `Turn 12 continued` label. Click and Enter opened the same
  bounded prompt detail.
- Standalone visual-contract review passed all 15 surfaces at 1440x900,
  1024x768, and 390x844 with no overflow, clipped meaningful text, text below
  the 12px floor, console errors, or page errors.
- `npm run check`: all root, Harness, Harness UI, and Studio test suites passed;
  Studio reported 62 files and 494 tests, and npm/runtime pack verification
  passed.
