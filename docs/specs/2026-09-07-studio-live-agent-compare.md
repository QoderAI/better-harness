# Compare two Agents live on one prompt

## Traceability

- Spec ID: studio-live-agent-compare
- Status: Implemented

## Intent

Compare could only replay Agent work that had already happened. To ask "how do
these two Agents handle *this* requirement?", a reader had to start Studio with an
experiment manifest (`--experiment`) so the Bench surface appeared. In a plainly
opened local Project there was no way to state a requirement at all.

This adds a `Live Agents` compare surface: one prompt box, two independently
chosen local ACP Agents, both launched against the open Project, streamed side by
side with a small metric comparison.

The Agent catalog and per-run ACP execution already existed; they were simply not
reachable from the browser. `/api/config` published only the default Agent's
label, and `/api/acp/runs/stream` always used that default.

## Non-Goals

- Isolating the two Agents from each other. This surface deliberately runs both
  against the Project's real working tree, which is the same boundary the
  Debugger already takes. Bench remains the isolated, worktree-per-lane path with
  a verdict.
- Producing a verdict, score, or winner. The comparison is observational.
- Installing or bundling Agents. Only ACP entrypoints already present on the host
  can be launched.
- Replacing retained Session compare, which answers a different question about
  work that already happened.

## Acceptance Scenarios

- **AC-1:** `/api/config` publishes the whole bounded ACP Agent catalog
  (`acpAgents: [{ id, label, available, detail }]`), including unavailable entries
  with their reason, and never leaks an executable path.
- **AC-2:** `/api/acp/runs/stream?agent=<id>` runs that catalog entry. Omitting
  the parameter keeps the existing single-Agent Debugger behaviour.
- **AC-3:** An unknown or unavailable `agent` id is refused with 400 before any
  stream opens. The server is the enforcement point; a disabled `<option>` is
  only a UI affordance.
- **AC-4:** The `live` compare surface appears only when ACP is enabled, the
  Project can execute, and at least one Agent is launchable.
- **AC-5:** Both Agent selectors start empty. Run stays disabled until a non-empty
  prompt and both Agents are chosen, so the pairing is always stated explicitly.
- **AC-6:** Both lanes launch from one submit and settle independently: a slow or
  failing Agent never withholds the other lane's evidence, and each lane has its
  own cancel and its own ACP permission gate.
- **AC-7:** The view compares rather than just logging: status, tool calls,
  messages, and warnings per Agent, with an explicit no-winner boundary and the
  prompt both Agents received.
- **AC-8:** The shared-working-tree consequence is stated in the composer, not
  buried, and points at Bench for the isolated alternative.
- **AC-9:** Both lanes stay present and bounded at wide, compact, and narrow
  layouts.

## Plan

- `server/server.ts`: publish `publicAcpAgentProfiles(options).agents` from
  `/api/config`; resolve `?agent=<id>` through `resolveAcpAgent` on
  `/api/acp/runs/stream` and refuse ids that cannot be launched.
- `app/run/stream-run.ts` (new): extract RunView's private run/SSE transport into
  an exported seam so several concurrent runs share one implementation.
- `app/CompareLiveView.tsx` (new): prompt composer, two empty-by-default Agent
  selects, parallel launch, per-lane cancel and permission gate, metric table.
- `app/studio-shell-model.ts`: add `StudioAcpAgentOption`, `config.acpAgents`,
  `selectableAcpAgents()`, `liveCompareReady()`, the `live` compare surface, and
  its destination status.
- i18n (`en` + `zh-CN`): the `compare.live.*` block and
  `destination.liveAgentCompare`.
- `styles/workbench.css`: `.live-compare-*` as docked composer, metric rows, and
  two lanes, stacking at narrow; scope the lane badge so it does not inherit the
  global filled `status-*` background.

## Test & Review Evidence

- `packages/harness-studio/test/server.test.ts`: the config catalog lists
  available and unavailable Agents without leaking the fixture path; a selected
  id streams a real run; unknown and unavailable ids are refused with 400
  (AC-1, AC-2, AC-3).
- `packages/harness-studio/test/studio-shell-model.test.ts`: the `live` surface
  appears only with ACP, an executable Project, and a launchable Agent, and
  withdraws when any of the three is missing (AC-4).
- `packages/harness-studio/test/browser/acp-debugger.spec.mjs`: against two real
  fixture ACP Agents, both selectors start empty, Run unlocks only after prompt
  plus both Agents, both lanes raise and answer their own permission gate, both
  produce `fixture:allow-once`, the metric table and no-winner boundary render,
  the shared-working-tree notice is present, and both lanes stay bounded at all
  three layouts (AC-5, AC-6, AC-7, AC-8, AC-9).
- Verified locally: `npx tsc --noEmit` clean, 538 unit tests pass, 59 of 60
  browser tests pass. The one failure,
  `artifact-host.spec.mjs › persists the explicit Studio theme`, is a light-theme
  primary-contrast regression in `tokens.css`, a file this change does not touch.

## Risk

- Two Agents mutating one working tree can overwrite each other, so the resulting
  diff is not attributable to either Agent. This is accepted for this surface and
  stated in the UI; Bench is the isolated path. Anyone who needs attributable
  file evidence must use Bench.
- Both runs stream concurrently and each Agent may raise permission prompts, so a
  reader can be asked to decide two gates at once. Each gate is answered inside
  its own lane and one decision never settles the other.
