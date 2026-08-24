# Inspect an agent session as a debugger notebook

## Traceability

- Spec ID: harness-studio-session-debugger
- Status: Implemented

## Intent

Redesign the live Run surface in `@qoder-ai/harness-studio` as a
session-oriented debugging workbench. The surface should make an Agent Session
readable as semantic work stages while keeping retained ACP/AG-UI facts
inspectable. It is a debugger for observed session state, not a time-based
Replay player and not a claim that the current workspace can be restored.

The supplied ACP Debugger screenshot defines the IDE-scale information density,
three-column composition, light visual system, and synchronized selection
language. Harness Studio keeps its own product identity, navigation, local-run
boundary, and evidence wording.

## Acceptance Scenarios

- AC-1: The Run view opens as a full-screen workbench with a product/session
  header, semantic debug toolbar, Execution Tree, Session Notebook, State
  Inspector, and Timeline Minimap. It does not present Play, playback speed, or
  any other Replay transport.
- AC-2: The default recorded sample is named `优化 Replay UI` and contains one
  Prompt, one Plan, an Explore group with nine retained calls, a
  `workbench.js` change, a failed test, a CSS fix, a passing test, and a final
  Response. Read/search/inspect calls are grouped rather than rendered as nine
  peer cards.
- AC-3: Selecting a tree node, notebook event, or timeline marker updates one
  shared evidence cursor and visibly synchronizes all three regions. Previous
  Stop, Continue, Next Stop, Step Into, Step Over, Step Out, and Previous State
  update that cursor according to their labels; Step Into expands the current
  Explore group.
- AC-4: Stop Conditions for Changes, Failures, Permissions, Tests, and Responses
  can be toggled. Continue and stop navigation skip events whose stop types are
  disabled without mutating the retained session or workspace.
- AC-5: The notebook is organized by Prompt, Plan Revision, Execution Group,
  File Diff, Validation, and Final Response. Exploration details remain
  collapsed by default; file changes show a Before/After diff; failed and
  passing validations show command, status, and retained duration.
- AC-6: State Inspector exposes Changes, Files, Artifacts, Tests, Terminal,
  Plan, Evidence, and Raw ACP tabs. Changes answers what changed since the prior
  stop. Evidence distinguishes Exact, Correlated, and Inferred relationships;
  Raw ACP includes direction, method, ids, and trace context for the selected
  event.
- AC-7: The state boundary explicitly names the current cursor and available
  checkpoint evidence. The recorded sample offers Previous State and View
  History only; it does not expose Restore or Fork from Here because no
  restorable Workspace or Runtime checkpoint exists. Live inspection labels a
  UI-only pause as Soft Pause rather than claiming the Agent is stopped.
- AC-8: Existing AG-UI run submission remains reachable from the redesigned Run
  view. Starting a run uses the existing endpoint and terminal/tool-call
  reducer; the recorded sample is clearly labeled and cannot be mistaken for
  live backend evidence.
- AC-9: At 1440 by 900 the three primary columns and timeline remain visible
  without document-level horizontal scrolling. At narrower widths the
  inspector and tree can be collapsed or stacked, controls remain reachable,
  and overflow stays inside dense code/trace regions.
- AC-10: Focused tests exercise the semantic cursor model and built-page
  interactions. Browser verification checks synchronized selection, stop
  toggles, Step Into, inspector tabs, diff rendering, live-run entry, responsive
  containment, console errors, and a screenshot comparison against the supplied
  reference.

## Non-goals

- Building a generic ACP Gateway, recorder, JSON-RPC proxy, or persistent
  session store.
- Rerunning retained tool calls, restoring Git state, resuming a native Coding
  Agent session, or adding Workspace/Runtime checkpoint infrastructure.
- Replacing the existing Experiment Builder, comparison Workbench, Results
  surface, evidence contracts, or server endpoints.
- Claiming hidden intent, causality, token usage, cost, exact duration, or file
  state when the current protocol evidence does not provide it.
- Adding a new host adapter or changing the supported host set.

## Plan and Tasks

1. Add a pure session-debugger model for the recorded sample, semantic stops,
   tree projection, cursor movement, and inspector facts.
2. Recompose the Run view into the debugger shell while preserving the existing
   AG-UI request and reducer path behind an explicit `New live run` action.
3. Add icon-library-backed controls and a compact light visual system in the
   existing bundled application stylesheet. Avoid custom SVG/CSS icon art.
4. Add focused model tests and extend the built-app Playwright flow for
   synchronized cursor behavior, tabs, diff, responsive layout, and the live
   run path.
5. Build, inspect at desktop and narrow viewports, compare against the reference,
   fix actionable visual gaps, and record browser/design evidence.

## Test and Review Evidence

- AC-2 through AC-7: `packages/harness-studio/test/session-debugger-model.test.ts`
  passes four focused tests for the eight-stage sample, nine-call Explore group,
  enabled-stop traversal, hierarchy stepping, node resolution, and cumulative
  file state.
- AC-1/AC-3 through AC-10: `npm run harness-studio:test:browser` passes four
  built-app flows. The Session Debugger flow selects the shared cursor, enters
  and exits Explore, disables Changes, continues to the failed Test, opens Raw
  ACP and Diff view, checks the read-only state boundary, and verifies a 1440 by
  900 shell with no document overflow or console/page errors. The existing 390
  px live-run flow still completes and expands a retained Tool Call.
- Package gate: `npm run harness-studio:test` passes 10 files and 63 tests after
  the production build. `npx vitest run
  test/skills-docs/doc-link-graph.test.mjs` passes six checks after regenerating
  `docs/better-harness-doc-links.mmd`; the generated graph is unchanged.
  `git diff --check` passes.
- Visual gate: the same-state desktop and focused comparison boards are recorded
  in the ignored `.qoder/design-qa/` workspace. The ignored `design-qa.md`
  records `final result: passed` after fixing the initial auto-scroll hierarchy.
  In-app Browser inspection also exercised Step Into, Stop Conditions, Raw ACP,
  the live AG-UI path, compact side-panel overlays, and reported no errors.
- Risk: debugger labels can overstate execution control. Copy names the
  Evidence Cursor and Soft Pause boundary, and does not claim a gate or hard
  runtime pause.
- Risk: mock data can be mistaken for product evidence. The default session is
  visibly marked `Recorded sample`; live runs receive their own state and ids.
- Risk: dense three-column layouts can become unreadable. Columns use bounded
  widths, sticky chrome, local overflow, and explicit responsive collapse.
- Risk: keeping the existing live run path can mix semantic sample data with
  live AG-UI data. The two modes stay explicit and never merge evidence.
