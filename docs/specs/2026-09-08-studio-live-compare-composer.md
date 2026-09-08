# Fuse the Live compare composer into one control

## Traceability

- Spec ID: studio-live-compare-composer
- Status: Proposed
- Supersedes AC-8 of `2026-09-07-studio-live-agent-compare.md`

## Intent

The `Live Agents` compare composer shipped as four stacked regions: a bordered
textarea, one `<select>` per lane, an `Add Agent` button, a `Run` button, and a
permanently docked paragraph of prose. At 390px that is six rows of chrome above
an empty results region, and at 1440px the prose is the widest line on the
surface.

Three specific problems, not just density:

1. **The slot model allows a non-comparison.** Each lane is an independent
   `<select>` over the same catalog, so `Alpha` can be chosen in both lanes. Two
   lanes of one Agent is not a comparison, and nothing refuses it.
2. **The warning is always shown and never true.** The shared-working-tree
   consequence only exists once two or more Agents will actually write. It is
   rendered before any Agent is chosen, competing with the prompt for attention
   and reading as boilerplate by the time it matters.
3. **Add/Remove duplicate the picker.** `Add Agent`, `Remove Agent {{index}}`,
   and the per-slot empty option are three affordances for one decision: which
   Agents answer this prompt.

This replaces the four regions with one composer shell: a borderless prompt over
a single toolbar row that carries an Agent picker, the chosen Agents as
removable chips, one state-appropriate note, and Run.

## Non-Goals

- Relaxing the two-Agent floor. `MIN_LANES` stays 2: one lane is a Debugger run,
  not a comparison. The picker may hold one selection; Run refuses it and says
  why.
- Raising the four-Agent ceiling.
- Putting Agent selection *inside* the prompt text as `@mention` tokens. The
  Agent set is run configuration, not prompt content; fusing them would mean
  stripping tokens out of the string each Agent receives and re-implementing
  combobox/`aria-activedescendant` semantics this repo has no component for.
- Changing the launch, streaming, cancel, permission-gate, or lane behaviour.
  This is composer-only.
- Producing a verdict. The surface stays observational.

## Acceptance Scenarios

- **AC-1:** The composer is one bordered control. The prompt textarea carries no
  border of its own, and a focus ring is drawn on the composer shell whenever
  focus is anywhere inside it.
- **AC-2:** Agents are chosen from one `Agents` popup whose entries are
  `menuitemcheckbox`. Selecting the same Agent twice is not expressible, so N
  chips are always N distinct Agents.
- **AC-3:** Each chosen Agent appears as a chip in the toolbar row with a
  remove control named after that Agent (`Remove Alpha ACP`), not after a lane
  index. `Add Agent` and `Remove Agent {{index}}` no longer exist.
- **AC-4:** At the ceiling, unchosen menu entries are disabled and the reason is
  stated once inside the menu. At the floor, Run is disabled and the
  prerequisite is stated once in the toolbar row next to Run.
- **AC-5:** Unavailable Agents stay listed, are not selectable, and show the
  server's reason as readable text in the menu rather than as an `<option
  title>`.
- **AC-6:** The toolbar row carries exactly one note, chosen by state: the hard
  `noAgents` boundary, else the floor prerequisite when fewer than two Agents are
  chosen, else the shared-working-tree note.
- **AC-7:** The shared-working-tree note is a short always-visible label plus a
  focusable disclosure. The full consequence text is reachable by pointer hover,
  by keyboard focus, and by click-to-pin, and is associated with the control
  through `aria-describedby` so it reaches assistive technology in every visual
  state. It is not hover-only.
- **AC-8:** Chips wrap before they shrink and are never clipped by a fixed-height
  row. The composer stays bounded with no horizontal document overflow at wide
  (1440), compact (1024), and narrow (390) layouts.
- **AC-9:** Run's accessible name states the count it will start
  (`Run 2 Agents`) once the floor is met, and reads plain `Run` while disabled
  below the floor.

## Plan

- `app/CompareLiveView.tsx`: replace `LaneSlot[]` + per-slot `<select>` with an
  ordered `readonly string[]` of chosen Agent ids, an `AgentPicker` popup
  (`menuitemcheckbox`, pointerdown/Escape dismissal, following the existing
  `SourceSwitcher` pattern in `App.tsx`), chips with per-Agent remove, and a
  `SharedTreeNote` toggletip. `launch()` maps the id list instead of slots.
- `styles/workbench.css`: `.live-compare-composer` becomes the bordered shell
  with `:focus-within`; `.live-compare-prompt` loses its border and background;
  add `.live-compare-bar`, `.live-compare-picker`, `.live-compare-menu`,
  `.live-compare-chip`, `.live-compare-note`. Chip removal target ≥24px; row
  wraps rather than clips.
- i18n (`en` + `zh-CN`): replace `live.sharedWorkingTree`, `live.addAgent`,
  `live.removeAgent`, `live.chooseAgent` with `live.agents`, `live.agentsAria`,
  `live.agentsMenuAria`, `live.agentCeiling`, `live.agentFloor`,
  `live.removeChosenAgent`, `live.sharedTree`, `live.sharedTreeDetail`,
  `live.sharedTreeAria`, `live.runIdle`.

## Test & Review Evidence

Not yet produced. The composer is implemented and typechecks, but the evidence
below is still outstanding and the two existing live-compare browser tests are
currently red because they drive the removed controls.

- **Outstanding:** `packages/harness-studio/test/browser/acp-debugger.spec.mjs`
  still targets `Add Agent`, `Remove Agent {{index}}`, and
  `.live-compare-agents option[value="missing"]`, none of which exist now. Both
  live-compare tests must be rewritten against the picker to assert no
  preselection, Run gated on prompt plus two Agents, chips named per Agent,
  duplicate selection unavailable, the unavailable Agent's reason readable in the
  menu, the ceiling disabling unchosen entries, the floor prerequisite, and the
  shared-tree detail reachable by keyboard focus (AC-2 … AC-9).
- **Outstanding:** Playwright screenshots at 1440/1024/390 with console and page
  errors asserted empty (AC-1, AC-8).
- Done: `npx tsc --noEmit` reports no error in the changed files, and
  `scripts/build-app.mjs` bundles. Unrelated pre-existing type errors in
  `app/GitHistoryView.tsx` come from concurrent work in the same tree.

## Risk

- The picker replaces a native `<select>`, whose keyboard and screen-reader
  behaviour was free. The popup must therefore carry its own `aria-haspopup`,
  `aria-expanded`, Escape dismissal, and outside-pointer dismissal, and each
  entry must expose `aria-checked`. This is the largest regression surface in the
  change and is covered by browser assertions rather than by inspection.
- Moving the shared-working-tree consequence behind a disclosure lowers its
  default prominence. Mitigated by keeping a labelled warning visible in the row,
  by showing it exactly when two or more Agents will write, and by
  `aria-describedby` rather than visibility-gated text.
