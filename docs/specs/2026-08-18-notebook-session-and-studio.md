# Make session review and harness comparison read like a notebook

## Traceability

- Spec ID: notebook-session-and-studio
- Status: In Progress

## Intent

Make a retained Session and a live Harness Studio comparison easier to scan by
using the same notebook-shaped mental model: shared context first, then one
understandable work unit with its input, collapsible process, result, and
evidence. The two products keep their existing authority boundaries. Inspector
remains a read-only presentation of retained evidence, while Studio may lock and
run an already supported checkpoint-backed comparison.

The supplied Jupyter-style reference defines hierarchy, composition, and
rhythm, not a new data contract. The implementation should visibly read as a
notebook at first glance: one application bar, one wide cell stream, a
continuous `In`/`Out` execution rail, and a narrow contextual rail. Labels and
actions must continue to describe facts the product actually owns.

## Acceptance Scenarios

- AC-1: Inspector Session Detail renders every retained Turn as a numbered Run
  Cell with a visible input prompt, a collapsible Process section, and a result
  area. Each Process contains a timeline scoped to that Turn's retained calls,
  and one collapsed-by-default overall Session timeline appears before the first
  Turn so long Sessions retain an immediately discoverable global overview.
  Retained responses, commits, tool calls, and unplaced evidence keep their
  existing selection descriptors and evidence limitations.
- AC-2: Inspector does not label a Turn as a checkpoint, resumable state, code
  rollback, or successful artifact unless that fact already exists in the
  report. Trace/Replay, activity zoom, Jump, filters, call expansion, evidence
  selection, deep links, and the Continuation packet remain available.
- AC-3: Harness Studio Workbench presents one shared Context block, one Run
  Comparison cell, and one Compare Result cell. The Run cell owns the existing
  Run/Cancel action and Reference/Baseline/Candidate outputs; the Compare cell
  owns comparability plus Summary, Trace, and Evidence. Switching views or run
  roles keeps the existing data and selection state.
- AC-4: Studio continues to state one shared starting checkpoint and one
  derived treatment boundary without inventing duration, token, cost,
  authorship, correctness, or causality. Inspector and Studio both keep
  uncertainty and privacy-filtered content explicit.
- AC-5: At 1024 by 576, the Studio context and Run cell lead-in are visible,
  the focused call rows remain at least 11 px, and the document does not scroll
  horizontally. At 390 px, overflow stays inside the comparison surface and
  the context rail remains collapsible. Inspector Session Detail keeps one page
  scroller and stacks its index below the cells at narrow width.
- AC-6: Focused tests assert the rendered notebook structure and preserved
  interactions through DOM roles and behavior. Browser verification uses real
  report/experiment fixtures, exercises primary controls, checks console and
  page errors, and compares screenshots against the supplied reference at the
  same desktop viewport.
- AC-7: At desktop width, Studio uses a top Notebook bar, a wide left cell
  stream, and a right Checkpoints rail rather than a permanent left setup rail.
  Inspector uses the same main-stream/right-context composition but names the
  right rail `Session outline` and does not expose Continue, Fork, or checkpoint
  mutations. Generic card shadows, all-caps microcopy, and console-like gray
  framing do not dominate the above-the-fold notebook surface.
- AC-8: Inspector does not repeat a Session-level Context card above the Cell
  stream. Stable Session metadata stays in the notebook bar and outline; Turn
  activity stays inside its Process, and overall activity appears once before
  the first Cell as a collapsed disclosure.
- AC-9: Inspector preserves the observed order of intermediate assistant
  messages and tool calls through session parsing, report projection, Trace,
  and Replay. Presentation may collapse only adjacent tool-call runs. Counts
  distinguish intermediate responses, tool calls, and retained process events.
- AC-10: A terminal assistant response is retained as `Out` only when it is the
  final observed event in its Turn. A later tool call makes the retained Turn
  incomplete. The Outcome labels observed edit paths, verification calls, and
  correlated commits as evidence; it shows a code diff only from a retained,
  session-scoped patch artifact and never from the current worktree.
- AC-11: Intermediate and terminal assistant prose renders as sanitized
  Markdown without allowing raw HTML or executable links. At narrow widths,
  Trace/Replay, Continuation packet, Jump, filters, and Process controls remain
  reachable without horizontal document overflow.

## Non-goals

- Adding a new checkpoint store, checkpoint mutation, native-session resume,
  replay execution, artifact adoption, or Git rollback.
- Merging Inspector and Harness Studio data models or moving Studio execution
  controls into the read-only Inspector.
- Replacing the existing Evidence Drawer, Studio comparison models, Builder,
  or server endpoints.
- Reproducing the reference image's branch picker, sharing controls, model
  names, test counts, file counts, or other illustrative facts when local
  evidence does not provide them.

## Plan and Tasks

1. Restructure Inspector's existing Session Detail markup into Run Cell
   regions while preserving element ids, selection attributes, filters, tool
   disclosures, and Replay ownership. Keep Session-wide metadata in the title
   bar and outline rather than repeating a Context card.
2. Add notebook-specific Inspector styles for cell numbering, input/process/
   result hierarchy, compact metadata, and responsive stacking.
3. Restructure Studio Workbench markup into a top Notebook bar, shared Context,
   Run Comparison and Compare Result cells, plus a right Checkpoints rail,
   without changing run, selection, or comparison models.
4. Extend Studio styles and browser coverage for the notebook hierarchy,
   desktop density, narrow containment, role switching, filtering, view tabs,
   and Run/Cancel behavior.
5. Restructure Inspector Session Detail into the same main-stream/right-outline
   composition while keeping its outline and evidence controls strictly
   read-only.
6. Render both products, capture desktop and narrow evidence, compare the
   implementation with the reference, fix actionable visual gaps, and run the
   focused and repository-level gates proportional to the changed surface.
7. Preserve one ordered Turn event stream in the session projection, expose
   response availability and honest event counts, and render the same order in
   Trace and Replay.
8. Replace the undifferentiated result prose with an evidence-bounded Outcome,
   add safe Markdown rendering, and keep notebook navigation available on
   narrow screens as specified by
   [ADR-0006](../adrs/session-notebook-evidence-projection.md).
9. Keep the overall Session activity disclosure before the first Turn and
   collapsed by default in both standalone Inspector and Studio Session Detail.

## Test and Review Evidence

- AC-1/AC-8 follow-up: standalone Inspector and Studio now render the overall
  Session activity disclosure before the first Turn and keep it closed on
  initial render. `npx vitest run test/reporting/harness-inspector.test.mjs`
  passed 39 tests; `npm run harness-studio:test` passed 65 files / 512 tests;
  the Studio browser suite passed 56 tests; and `npm run
  inspector:visual-check` passed all Trace, Usage, and Replay states at 1440 by
  900, 1024 by 768, and 390 by 844 with no overflow or browser errors.
- AC-1/AC-2/AC-8: `npx vitest run
  test/reporting/harness-inspector.test.mjs` passed 28 tests. A real five-Turn,
  230-call report rendered five scoped Process timelines and one overall
  Session timeline. The in-app browser exercised Process expansion, Trace,
  evidence selection/closure, and the read-only Session outline with no page
  or console errors. The rendered Session contains no Notebook Context card.
- AC-3/AC-4: `npm run harness-studio:test` passed 59 tests after rebuilding the
  package. The built Studio fixture exercised Builder -> Workbench, Process,
  Run, Summary/Trace/Evidence, call filtering, and synchronized selection in
  the in-app browser with no console or page errors.
- AC-5/AC-7: browser measurements covered 1229 by 819 and 1024 by 576 desktop
  states plus two 390 by 844 narrow iframes. Each iframe's one-pixel border
  leaves a 388 px inner viewport: Studio document and workspace widths stayed
  388 px, the Checkpoints rail was hidden by default and reopened as a 335 px
  overlay without document overflow. Inspector document, Session View, and
  layout widths stayed 388 px; the first Cell started at 70 px and the stacked
  Session outline began after the Cell stream. Five Process disclosures and one
  overall activity section were present.
- AC-6: the prior same-scale reference/implementation boards and
  desktop/narrow captures were recorded in the local ignored `design-qa.md`;
  they are not used as review evidence for AC-9 through AC-11. The Studio
  browser test covers the notebook region, Context, two Cell regions,
  Process disclosure, desktop dimensions, collapsed narrow rail, and the 335
  px Checkpoints overlay; `node --check` passed for that test file and the same
  interactions were exercised in the in-app browser.
  `git diff --check`, `node --check` for the updated Playwright test,
  documentation link graph (6 tests), full root suite (95 files / 1327 tests),
  package verification (541 npm / 563 runtime-zip entries), and preview
  `/health` plus `/canvas-module.js` smokes all passed.
- AC-9/AC-10: `npx vitest run
  test/sessions/commit-session-link.test.mjs
  test/reporting/harness-inspector.test.mjs` passed 70 tests. The parser test
  asserts `tool -> intermediate -> tool`, an incomplete terminal status, and
  separate observed/retained counts; the report-model test asserts that the
  same order and response status cross the Inspector projection unchanged.
  The real 96-event Turn rendered alternating Intermediate/tool-run regions,
  reported `80 of 96 process events retained`, aligned `Out` with the Outcome,
  and labeled its edit path while explicitly declining to derive a patch from
  the current worktree.
- AC-11: browser verification at 1280 by 720 and 390 by 844 kept Trace, Replay,
  Continuation packet, Jump, filters, and Process controls visible with document
  widths equal to viewport widths. Rendered assistant Markdown contained real
  heading and list elements, no raw `script` or `iframe` nodes, and Process
  expansion preserved the observed event order. Replay opened at event 1 of
  139; expand/collapse worked for all six Turns; browser warnings and errors
  were empty. `npm run harness-studio:test` passed 59 tests, the documentation
  link graph passed 6 tests, the full root suite passed 95 files / 1327 tests,
  `node --check`, `git diff --check`, and preview `/health` plus
  `/canvas-module.js` smokes passed.
- Risk: notebook terminology can overstate state continuity. UI copy uses
  `Turn`, `Run`, `result`, and `evidence`, and reserves `checkpoint` for the one
  Studio checkpoint source that the server already verifies.
- Risk: added hierarchy can consume too much vertical space. Context stays
  compact, Process stays collapsed by default, and repeated metadata is owned
  once per notebook or cell.
- Remaining activation decision: the ADR is still `Proposed`, so this spec
  remains `In Progress` until maintainers accept the ordered-event and
  session-scoped patch boundary or request a different report contract.
