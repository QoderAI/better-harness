# Qoder Canvas Output

This file owns Canvas artifact shape, runtime rules, chat handoffs, and validation; `skills/better-harness/SKILL.md#report-output` owns reader fields, and style guidance never owns a second report schema.

## Artifact flow

- `harness analyze --format json --canvas-out <run>/canvas.json` returns neutral, budgeted plain-text evidence and initializes Canvas with exact `summaryFacts`. It excludes projected conclusions; the lead judges only evidence, authors `findings.json` without copying machine facts, then renders without another Canvas handoff flag. Render automatically consumes the adjacent analyzer-owned Canvas; explicit `--canvas` remains available for a selected legacy companion. Existing analyzer output is replaced only with separately authorized `--replace-canvas`.
- `/better-harness` always uses Agent Work Loop; session availability changes its evidence mode, not the visible model.
  Use the Software Fluency scaffold only for an explicitly requested static project scan.
- The visible artifact bundle is `findings.json`, `canvas.json`, and `report.canvas.tsx`. The Canvas imports only `qoder/canvas`, `./findings.json`, and `./canvas.json`; do not add helper modules, network access, Node built-ins, or local SDK imports.
  `findings.json` retains the host/UI summary and finding actions; analyzer-owned `canvas.json` retains exact evidence, usage, Learning Capture, and renderer-owned detail rows.
- Render into the requested run directory and validate the final bundle.
- Current Canvas selection requires the exact v4/report-v23 pair and rejects mixed versions.
  Only the prior-state loader may restore a complete exact-project v21 or v22 intervention ledger as bounded later-validation continuity.

## AI authoring and reader mode

This is a findings-backed report contract, not a generic dashboard recipe. The
owner orders supported findings and owns evidence joins; the shipped shell
provides the final validated composition. Do not edit generated files after the
owner succeeds, and never invent diagnosis or user benefit.

Software Fluency keeps its score card and score visual. Agent Work Loop renders one compact SDK `Fluency` visual from the five evidence-bounded `summary.dimensions[]`
scores and uses each row's `summary` as the only hover content: do not repeat the dimension category or score. The fifth bar is **Learning Capture** and follows the same reader treatment; do not expose supporting-check ids,
numbering, or stage progression in its tooltip. It must not average them or synthesize another score, percentage, maturity level, radar, progress bar, or evidence-state count chart.
Follow the field semantics in `skills/better-harness/SKILL.md#report-output`: a finding title names the concrete issue,
`reason` explains current cost, and `expectedOutput` lists one to three direct goal-oriented deliverables that combine the artifact action,
reviewed safe file intent, and purpose/result in one sentence. Reject a bare label such as `Update the Rule`; `aiFixPrompt` remains hidden action transport.

Finding Cards keep severity, the first mapped dimension category, a two-line title,
and a two-line `reason` preview in one shared compact body height. Pin `Plan AI Fix`
left and `View details` right; do not expand detail inside the card. Use the
Canvas SDK `Dialog` for this popup. In Finding Detail, label the full `reason` as “Cause” and render
`expectedOutput` once under “Expected Output” as a numbered list. The popup must
fit the viewport and close by its visible action, Escape, or a backdrop click.
Plan AI Fix opens instructions in chat for review before sending; never print them.
`expectedArtifact` remains an internal owner/type signal and must not be rendered as a separate Deliverable.
When the file owner is unknown, require locating it before editing; do not invent a path from a Rule, Hook, workflow, configuration, or other non-file-specific owner.
The report header contains no IDE-only Better Harness jump. Practice coverage uses fixed category descriptions, counts, scopes, and safe paths—not observations.

Use `summary.usageActivity` for script-aggregated UTC daily session activity, distinct model-active sessions, and deduplicated Skill observations; use `summary.usageEfficiency` for the separate all-eligible raw model-call census and accounting boundary.
The durable `/better-harness` analyzer supplies both usage fields when eligible sessions exist; if a legacy source omits them, show usage as unavailable, never `0/0`, zero models, zero source gaps, or low sampling confidence.
The visible overview keeps only analyzed/eligible sessions, estimated active minutes, Skill observations, estimated active-long sessions, and bounded top Skills. Render Evidence and methodology as a visible decision brief: one evidence-boundary callout, sampling confidence, source gaps, delivery outcome evidence, the pending long-session review queue, and three representative evidence-bearing session observations. Put session composition, raw call attribution, model-response accounting, wall-only spans, sampling provenance, and the complete model table behind one default-collapsed Measurement and model details disclosure. Unreviewed long-session candidates retain safe task summary, role, estimate, failures, and `sessionRef` in structured evidence, but the default row must not display the analysis reference; they do not enter Improvements. Keep every observation reachable through one user-triggered detail dialog. Never expose raw session ids in visible fields; only a user-triggered AI Fix may carry them for local lookup. Do not replace task summaries with ids or call activity frequency a user preference, model quality, or cost.
For Agent Work Loop, keep this reader order:

1. A short project introduction, then one compact SDK `Fluency` visual backed by
   five dimension scores and evidence-bound summaries; hover explains, without an average.
   The fifth hover explains the conservative Learning Capture score without
   exposing internal stage progression or turning evidence state into a fixed
   score band. Only an `Outcome-supported` later-validation result permits an
   improvement or `Effective` claim.
2. One full-width borderless `summary.usageActivity` section: a plain Project usage heading,
   a 53-week, 365-day SDK `RiskHeatmap` with responsive square cells and date/minutes hover labels, compact session insights,
   and bounded Skills. Keep only the chart in the activity layer; only its plot may scroll, and when it does its initial viewport shows the latest dates.
3. Complete findings in an equal-height responsive Grid with one shared 190 px body height and row-scoped `Plan AI Fix`; cap the Grid at three columns.
   Add columns only when cards are at least 300 px, and collapse as the reader narrows.
   Open full Cause and Expected Output in the finding-scoped popup rather than changing card height.
4. Agent Customize uses one compact SDK `Table` with Asset, Coverage, and Representative source; keep the first safe path visible and remaining paths in the row's closed detail.
5. Responsive daily model-active-session and Skill-observation SDK `AreaChart` trends, limited to the latest 30 recorded days and top five labels plus `Other`.
6. One directly readable, compact Evidence and methodology decision brief: a small-text evidence boundary,
   three semantic status cards, one long-session review queue and handoff, and three responsive observation cards.
   Keep complete observations in one dialog and sampling/accounting/model detail behind one quiet closed disclosure.

Do not add a separate work-stage coverage or highest-priority decision card;
Fluency already presents the stage scores and the findings list owns every
evidence-backed improvement. Do not restore the old horizontally scrolling Kata row, wide findings table, or multi-metric capability matrix; they clip inside IDE panels.
The compact Agent Customize table is the small-text, compact-density exception.

Do not ask newcomers to interpret `Present`, `Wired`, question counts, confidence, autonomy radius, ids, or evidence bridges in the main reader flow.
Keep five-question and fifteen-check Canvas detail in `canvas.json`; retain in
`findings.json` only the host-needed dimension score, summary, and finding links,
plus the stable `summary.learningCapture` intervention ledger used by the next
source run. The Fluency visual may show only the dimension label, score, and evidence-bound summary; do not
repeat checks, refs, confidence, or evidence bridges as a chart, overview table,
or accordion.

## Chat handoff and validation
Bind `SendToChatButton.text` to `row.aiFixPrompt` with `options={{ submit: false }}`.
The visible label is short and localized; the full prompt remains action transport, not the newcomer explanation.

Run:
```text
<node> scripts/harness-analysis/validate-canvas.mjs --canvas <run>/report.canvas.tsx
```
The validator discovers sibling `findings.json` and `canvas.json`. It must
validate the split JSON contract, copied shell imports, the evidence/score
branch, and row-scoped handoff. Use preview or browser inspection when
available; static declarations alone do not prove Canvas execution.
