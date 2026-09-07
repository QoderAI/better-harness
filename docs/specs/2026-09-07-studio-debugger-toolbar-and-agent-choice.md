# Compact the Debugger step controls and choose the Agent for a live run

## Traceability

- Spec ID: studio-debugger-toolbar-and-agent-choice
- Status: Implemented

## Intent

The Retained Session Debugger toolbar spent a full row on seven labelled step
controls. At the Studio's real width the labels wrapped to two lines ("Previous
/ Stop", "Step / Into"), pushed the stop conditions past their room, and let the
Evidence Cursor marker collide with the last checkbox. A debug transport is the
one toolbar where the icons *are* the vocabulary — a docked workbench renders it
as icon targets and keeps the verb in the accessible name and a tooltip.

The **New live run** dialog had the second problem: it asked for a "Runtime"
(`Qoder SDK` versus `ACP`) and then silently used whichever ACP Agent the server
happened to default to. Studio already discovers a bounded ACP catalog
(`qodercli`, `pi`, `dsh`, `codex-acp`, `claude-acp`), already publishes it on
`/api/config` as `acpAgents`, and `/api/acp/runs/stream` already honours an
`?agent=<id>` selector. The Debugger was the only launcher that could not name
the Agent it was about to run, so a reader could not start a run against Qoder
CLI on purpose.

## Non-Goals

- Adding a host adapter or a new ACP preset. The catalog stays server-owned and
  bounded; the browser selects an entry and never supplies a command or argv.
- Changing step semantics, stop conditions, or the Evidence Cursor model.
- Running two Agents from the Debugger; cross-Agent execution stays in Compare.
- Replacing native `title` tooltips elsewhere in the shell.

## Acceptance Scenarios

- **AC-1:** The seven step controls (Previous Stop, Continue, Next Stop, Step
  Into, Step Over, Step Out, Previous State) render as icon-only toolbar targets.
  Each keeps the command verb as its accessible name, so no label text competes
  for the toolbar row.
- **AC-2:** Each step control reveals its verb in a tooltip on pointer hover and
  on keyboard focus. The tooltip is a supplement, never the only carrier of the
  accessible name.
- **AC-3:** The toolbar keeps the stop conditions and the Evidence Cursor marker
  on one row without overlap at wide, compact, and narrow layouts, with no
  horizontal document overflow. The topbar's session and runtime facts truncate
  on one line instead of wrapping into the neighbouring column.
- **AC-4:** **New live run** asks which Agent answers the prompt. The choices are
  the local Qoder harness (offered only when a harness is loaded) plus every ACP
  Agent the server registered in `/api/config` as `acpAgents`, named by its own
  label (for example `Qoder CLI`).
- **AC-5:** A registered but unavailable ACP Agent appears as a disabled option
  marked unavailable, carrying the server's reason as its title. It cannot be
  selected and cannot start a run.
- **AC-6:** Starting a run with a selected ACP Agent posts to
  `/api/acp/runs/stream?agent=<id>`, and the topbar Agent field names the chosen
  Agent instead of the server default.
- **AC-7:** When only one choice exists the selector is hidden, and when no Agent
  is available the run action stays disabled. A host that predates `acpAgents`
  still gets the single default ACP choice.

## Plan

- `app/run/live-agent-choices.ts` (new): the choice model as an exported seam —
  `liveAgentChoices()` builds the bounded list from `localRunEnabled`, the ACP
  endpoint, and the config catalog; `resolveLiveAgentChoice()` falls back to the
  first available entry; `liveRunEndpoint()` maps a choice to its POST target,
  appending `?agent=<id>` only for a catalog entry.
- `app/run/RunView.tsx`: make `ControlButton` icon-only with `aria-label` plus
  `data-tooltip`; replace the `runtime` state with the choice model, render the
  Agent selector in the composer, and report the selected Agent's label in the
  topbar.
- `app/App.tsx`: pass `acpAgents` and `localRunEnabled` from `StudioConfig` into
  the Debugger.
- `styles/workbench.css`: square the step controls to `--toolbar-target`, add the
  hover/focus tooltip from existing semantic tokens, stop the stop-condition and
  Evidence Cursor row from overlapping, truncate the topbar session and runtime
  meta instead of wrapping them, and rename `.live-runtime-select` to
  `.live-agent-select` with the dialog's own inset.
- i18n (`en` + `zh-CN`): replace `composer.runtime` with `composer.agent` and add
  `composer.agentUnavailable`.

## Test & Review Evidence

- `packages/harness-studio/test/live-agent-choices.test.ts`: the choice list with
  and without a local harness, catalog absence falling back to one default ACP
  choice, unavailable entries staying unselectable, the resolver preferring the
  first available choice, and the endpoint mapping including `?agent=` only for a
  catalog id (AC-4, AC-5, AC-6, AC-7).
- `packages/harness-studio/test/browser/acp-debugger.spec.mjs`: the fixture now
  registers a catalog (`Fixture ACP`, `Qoder CLI`, unavailable `Pi ACP`). The
  composer lists all four choices in order, marks the unavailable preset disabled
  with the server's reason, and a run started against `Qoder CLI` reaches the ACP
  permission gate while the topbar names that Agent (AC-4, AC-5, AC-6).
- `packages/harness-studio/test/browser/tool-call.spec.mjs`: the retained toolbar
  exposes seven controls whose accessible names are the verbs, carries no label
  text in the row, reveals the verb on hover, and reveals the focused control's
  verb after a keyboard Tab (AC-1, AC-2).
- Verified locally: `npx tsc --noEmit` clean; 537 studio unit tests pass (the one
  `/api/config` failure is a pre-existing `acpRuntimeProfile` mismatch from
  unrelated in-flight work, not this change); all 60 Playwright browser tests
  pass. Toolbar and composer screenshots reviewed at 1440, 1024, and 390 px with
  `documentWidth === innerWidth` and no console or page errors (AC-3, AC-7).

## Risk

- The verb text is no longer on screen at rest. Mitigated by the accessible name
  plus a tooltip on both hover and focus, which is the docked-workbench contract
  for a debug transport; the previous wrapped labels were themselves unreadable.
- Behavior change: an ACP run now names its Agent in the request. Omitting the
  selector keeps the previous server-default path, so a host without the catalog
  is unaffected.
- Boundary, not fixed here: the selector can only offer what the server enabled.
  `harness-studio` discovers the ACP catalog only when `--harness` or
  `--experiment` is given, and `acpAgentEnabled()` still requires either an Agent
  with its own `harnessSource` or `harnessMode: "workspace-default"`. A
  zero-configuration Studio therefore shows only the local harness choice even
  when `qodercli` is on PATH; enabling discovery there is a separate runtime-scope
  decision.
