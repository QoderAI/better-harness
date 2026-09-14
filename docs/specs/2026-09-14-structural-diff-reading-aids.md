# Structural Diff Reading Aids

## Traceability

- Spec ID: `2026-09-14-structural-diff-reading-aids`
- Refs: `2026-09-14-structural-commit-diff`
- Status: In Progress

## Intent

The structural reading shipped by `2026-09-14-structural-commit-diff` renders
correct data but is hard to read for two reasons the reader reports directly:

1. **No syntax colour.** Every side renders as plain text. The only colour in the
   view is the change polarity on the runs difftastic flagged, so a reader coming
   from the Textual reading (which is highlighted by `@pierre/diffs` + Shiki)
   sees the structural reading as a downgrade. The wire contract carries
   difftastic's `highlight` kind, but only for *novel* runs, and no stylesheet
   rule ever consumed it; unchanged text is one `normal` segment per line and has
   no token information at all.
2. **No way to find the next change.** The view is a flat list of aligned rows.
   On a 140-row file the reader scrolls looking for coloured runs, with nothing
   between the two revisions to say where the change regions are.

This spec adds both reading aids to the same surface. Neither changes the wire
contract, the native service, or the Textual reading.

## Non-Goals

- Changing `StructuralDiffV1`. The contract already carries everything needed.
- Deriving syntax colour from difftastic's `highlight` kind. It is only present
  on novel runs, so it can never colour the file the reader is reading around.
- A minimap or overview ruler for the whole file.
- Word-wrap, inline (unified) structural layout, or editing from the diff.
- Highlighting the Textual reading differently. It is already highlighted.

## Acceptance Scenarios

- **AC-1** In the structural reading, unchanged code carries the same syntax
  colours the rest of Studio uses (Shiki, Studio light/dark token themes),
  resolved from the file path, not from difftastic's language name.
- **AC-2** A novel run keeps its polarity (added/removed) *and* its syntax
  colour: the run background stays the success/danger surface while the token
  foreground comes from the theme. When highlighting is unavailable the run falls
  back to the polarity foreground, so a run is never invisible.
- **AC-3** Neither side's text is altered by highlighting: each rendered side
  still reconstructs its own source line character for character, including
  leading whitespace and multi-byte characters.
- **AC-4** A file whose language Studio cannot resolve (or whose grammar fails to
  load) renders as it does today, with `data-highlight-state="plain"` and no
  console error.
- **AC-5** The view reports how many change regions the file has, where a region
  is a maximal run of consecutive changed rows, and offers Previous/Next controls
  that move between regions, wrapping at both ends.
- **AC-6** Activating a control scrolls the target region into view, announces
  the new position through a polite live region, and marks the region in the DOM
  so the reader can see which one they are on.
- **AC-7** A change marker sits between the two revisions on every changed row,
  identifying it as added, removed, or modified, so the reader can see where the
  changes are while scrolling rather than only through the controls.
- **AC-8** The controls are keyboard reachable and disabled (not hidden) when the
  file has no change region.
- **AC-9** The aids survive wide (1440), compact (1080) and narrow (390) layouts
  in both themes: the header with the controls stays visible while the rows
  scroll, the marker column collapses when the sides stack, no side wraps, and
  the document does not gain horizontal overflow.

## Plan / Tasks

1. **Reading model** — new `src/app/code/structural-diff-model.ts`, pure and unit
   tested:
   - `structuralRowChange(line)` — `added` / `removed` / `modified` / `unchanged`.
   - `structuralChangeBlocks(lines)` — maximal runs of changed rows.
   - `revisionSource(lines, revision)` — that revision's own text plus a
     row → line-index map, so one Shiki pass covers a whole side.
   - `paintSegments(segments, tokens)` — intersects the contract's novel runs with
     the theme's token runs and coalesces the result. Falls back to the segments
     unchanged when there are no tokens.
2. **View** — `src/app/code/StructuralDiffView.tsx`:
   - Lazy `code-highlight.js` import per side, keyed on path and theme, mirroring
     `HighlightedCode`; expose `data-highlight-state`.
   - Change-region navigator in the summary header (`Previous`/`Next`, live
     position), and a marker column between the two revisions.
   - Rows own the scroll, so the header and its controls stay put.
3. **Stylesheet** — `src/app/styles/workbench.css`: navigator, marker column,
   changed-row band, absent-row hatch, and the run rule reduced to a background
   plus a fallback foreground so the token colour wins when present.
4. **i18n** — `src/app/i18n/{en,zh-CN}/git.ts`: navigator strings.
5. **Tests** — unit tests for the model; extend
   `test/browser/structural-diff.spec.mjs` with highlighting, navigation, and
   marker assertions at all three widths.

## Test / Review Evidence

Recorded on 2026-09-14, macOS arm64.

- `npx vitest run test/structural-diff-model.test.ts test/code-highlight.test.ts
  test/structural-diff.test.ts test/i18n-resources.test.ts` — 12 new model tests
  pass, including the round-trip that proves painting never changes the text and
  the boundary case where a novel run starts mid-token.
- `npx playwright test test/browser/structural-diff.spec.mjs` — 3 tests
  (1440/1080/390, light + dark, screenshot each) pass. They assert the syntax
  colours are present on unchanged code, that a novel run keeps its polarity
  background, that Next/Previous move between regions and wrap, that the position
  is announced, that the marker column reports the change kind, and that the
  console stays clean.
- `npx playwright test test/browser/git-history.spec.mjs` — regression guard for
  the textual reading, unchanged.

## Decisions and Boundaries

- **Shiki, not difftastic's kinds.** The contract's `highlight` field stays on
  the wire and in the DOM for debuggability, but colour comes from the same
  highlighter every other Studio code surface uses. Two token vocabularies on one
  screen is the drift `DESIGN.md` forbids.
- **One highlight pass per side, not per line.** A line-by-line pass would lose
  multi-line context (template literals, block comments) and pay the grammar cost
  per row. The pass is fed only the rows the engine returned, so a discontinuous
  hunk can mis-colour a construct that spans the gap; that is preferred over
  re-fetching whole file bodies the structural response deliberately omits.
- **Regions, not rows, for navigation.** Jumping row by row through a rewritten
  block is noise; a region is what a reviewer treats as one change.
- **Markers are decorative.** The marker column is `aria-hidden`: the row's
  change is already conveyed by the polarity of its runs and by the navigator's
  live position. A per-row control on a large file would add hundreds of tab
  stops for no new information.
