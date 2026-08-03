# Cursor Canvas Output

This file owns the Cursor Canvas artifact, runtime-action, and validation
contract. Reader fields remain owned by `skills/better-harness/SKILL.md`; this
mode renders the same complete reviewed report as Qoder Canvas with Cursor's
public SDK.

## Artifact flow

- `harness analyze --platform cursor --format json --canvas-out
  <run>/canvas.json` writes exact analyzer-owned summary facts only when the
  output is explicit. JSON without `--canvas-out` remains write-free.
- Cursor analysis discovers optional workspace-scoped native
  `context-usage-*.canvas.data.json` snapshots. It retains bounded token,
  category, hierarchy, and safe file metadata; raw item text is always omitted.
  Missing snapshots are `unobserved`, never zero usage.
- The lead authors the same complete reviewed `findings.json` contract used by
  the other report routes. Render automatically consumes an adjacent
  analyzer-owned `canvas.json` when present.
- `harness render --mode cursor-canvas` writes `findings.json`, `canvas.json`,
  and `report.canvas.tsx`. The TSX embeds the merged complete report so Cursor
  does not depend on private companion-data loading behavior; the sibling JSON
  files remain the durable evidence and review contract.

## Complete reader mode

Render the complete Agent Work Loop report, not a Context Usage-only view:

1. project introduction, evidence mode, strengths, and five separate Fluency
   dimensions without an aggregate score;
2. project usage and session-efficiency boundaries;
3. AI Agent Practice inventory with safe file routes;
4. Context Window usage, category shares, and bounded item metadata, or an
   explicit unavailable state;
5. every eligible prioritized finding and expected output;
6. suggestions plus evidence and methodology.

Follow the compact reader semantics in [Qoder Canvas Output](qoder-canvas.md)
where the two public SDKs have equivalent primitives. Cursor's `BarChart`
projects the five independent dimension scores because Cursor does not expose
Qoder's `Fluency` component.

## Native actions

Use only `useCanvasAction()` from `cursor/canvas`:

- `newComposerChat` receives a finding's unchanged `aiFixPrompt` or a bounded
  report/context review prompt. Cursor automatically references the dispatching
  Canvas.
- `openFile` receives a safe report or Context Usage file path. Omit the action
  when no admitted path exists.
- `openAgent` receives an observed Cursor composer id as hidden action
  transport. Do not print the raw id as reader copy.

Never invoke private Cursor command ids, import Cursor workbench internals, or
copy the proprietary generated Context Usage template.

## Validation

Run:

```text
better-harness harness render --findings <run>/findings.json --mode cursor-canvas --out <target>/.cursor/better-harness --run-dir <run> --target <target> --validate --json
```

Validation checks the split report contract, final artifact inventory, module
boundaries, required complete-report sections, public action bindings, and the
final TSX transform. A successful transform is the minimum delivery gate;
visual changes should also be opened in Cursor Canvas for layout inspection.
