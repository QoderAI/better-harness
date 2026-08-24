# Render complete Better Harness reports in Cursor Canvas

## Traceability

- Spec ID: `cursor-canvas-report`
- Status: Implemented

## Intent

Give Cursor users the same durable, complete Better Harness report experience
that Qoder users receive, while using Cursor's public Canvas SDK and native IDE
actions. Cursor session scans should automatically retain any workspace-scoped
Context Usage snapshot that Cursor has already materialized, and the report
renderer should present that evidence as one section of the full report rather
than as a standalone Context Usage page.

The existing Qoder Canvas, Markdown, and HTML routes remain unchanged. JSON
analysis remains parser-safe and does not acquire an implicit file-write side
effect.

## Acceptance Scenarios

- AC-1: A Cursor session analysis for a workspace discovers existing native
  `context-usage-*.canvas.data.json` snapshots only below that workspace's
  Cursor project directory. It projects bounded token/category/item metadata,
  omits raw item text, and reports missing snapshots as unobserved rather than
  as zero usage.
- AC-2: `harness analyze --platform cursor --format json` includes the bounded
  Context Usage projection in its exact summary facts when observed, without
  changing Qoder, Markdown, or HTML behavior and without writing files unless
  an explicit output option is supplied.
- AC-3: `harness render --mode cursor-canvas` accepts the same complete reviewed
  `summary + findings` contract as Qoder Canvas and writes a deterministic
  `findings.json`, `canvas.json`, and `report.canvas.tsx` bundle.
- AC-4: The generated Cursor Canvas renders the complete Better Harness reader
  flow: introduction and Fluency dimensions, project usage, AI Agent Practice,
  Context Window, prioritized findings, suggestions, and evidence/methodology.
  Context Window remains visible as unavailable when no native snapshot exists.
- AC-5: The Canvas uses only the public `cursor/canvas` surface. Finding handoff
  dispatches `newComposerChat`, safe file-backed evidence dispatches `openFile`
  with an optional selection, and an observed source conversation dispatches
  `openAgent`. Action payloads are transport data and raw session ids are not
  printed as reader copy.
- AC-6: Render-time validation proves the final TSX parses as TSX, imports only
  the public `cursor/canvas` surface, contains the complete report
  sections, and binds the public Canvas actions. Validation does not depend on
  Qoder's runtime declarations.
- AC-7: A bounded real-workspace smoke completes the Cursor scan and then
  produces a validated `cursor-canvas` bundle from the resulting report data.
  The generated TSX can be transformed successfully with the repository's
  shipped TSX transform.

## Non-goals

- Reproduce Cursor's proprietary Context Usage implementation or copy its
  generated template.
- Decode Cursor `store.db`, synthesize missing system/tool definitions, or claim
  token attribution that Cursor did not materialize.
- Make Canvas generation a side effect of every JSON command.
- Refactor the existing Qoder Canvas template in the same change.
- Add comprehensive unit coverage before the first end-to-end render smoke;
  focused contract tests may follow once the runnable path is proven.

## Plan and Tasks

1. Extend the Cursor session provider with an optional, workspace-qualified
   native Context Usage source and a privacy-bounded projection.
2. Thread Context Usage through the task-loop source, summary-facts projection,
   complete report contract, and Canvas split/merge path.
3. Add the `cursor-canvas` renderer and a standalone Cursor SDK template that
   embeds the merged complete report while retaining the sibling JSON artifacts
   as the durable data contract.
4. Add Cursor-specific validation using the existing module-boundary scanner
   and TSX transform, then register the mode in report routing and CLI help.
5. Run a real Cursor scan followed by a complete report projection/render and
   inspect the generated artifacts and transformed module.

The Cursor renderer remains capability-owned under `scripts/harness-analysis/`
and the template remains under `templates/canvas/`; the `.cursor-plugin` shell
does not own report judgment or schema.

## Test and Review Evidence

- AC-1/AC-2: Run `node scripts/session-analysis.mjs insights --platform cursor
  --workspace <workspace> --format json` and `node scripts/better-harness.mjs
  harness analyze --platform cursor --workspace <workspace> --format json`.
  Inspect the bounded projection and confirm no raw item `text` is retained.
- AC-3/AC-4/AC-5: Render a complete Agent Work Loop report with `--mode
  cursor-canvas`; inspect all three artifacts and the generated action bindings.
- AC-6: Run the Cursor Canvas validator against the final run directory and
  transform `report.canvas.tsx` with `transformCanvasSource`.
- AC-7: Use a temporary run directory for the real scan/render smoke and retain
  the command output plus artifact inventory as review evidence.
- Risk: Cursor's native snapshot schema and public Canvas SDK may change. Fail
  closed on malformed snapshots, retain an explicit schema/status boundary,
  and avoid private command ids or internal protobuf imports.
- Risk: native snapshot items may contain raw prompt or tool text. Persist only
  labels, token/character counts, hierarchy, and safe file references; never
  copy the native `text` field into analysis or report artifacts.
- Risk: Cursor actions can expose local identity or files. Keep ids as hidden
  action transport, render safe paths only when already admitted by the report,
  and omit unavailable actions instead of inventing targets.

## Implementation Evidence

- AC-1/AC-2: Real Cursor scans covered both an observed native snapshot
  (`56,860 / 300,000`, seven categories, 119 bounded items) and the explicit
  unobserved Better Harness workspace state; projected items retained no raw
  `text` and did not print absolute labels.
- AC-3/AC-4/AC-5/AC-6: `harness render --mode cursor-canvas --validate` wrote
  exactly `findings.json`, `canvas.json`, and `report.canvas.tsx`; validation
  passed data, module-boundary, complete-section, action-binding, and TSX
  transform checks with `cursor/canvas` as the sole import.
- AC-7: Cursor 3.13.10 opened the generated managed Canvas and rendered the
  overview, strengths, Fluency chart, AI Agent Practice, Context Window,
  findings boundary, and evidence/methodology sections. The unavailable Context
  Window state remained explicit for the Better Harness workspace.
- Repository verification: `npm test` passed 1,051 tests, `npm run pack:verify`
  passed both npm and runtime ZIP inventories, the generated doc-link graph was
  current, and the local preview returned `ok` from `/health` plus a transformed
  `/canvas-module.js`.
