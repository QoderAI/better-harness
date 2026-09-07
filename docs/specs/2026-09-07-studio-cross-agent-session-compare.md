# Scope Session compare to Agents inside one Project

## Traceability

- Spec ID: studio-cross-agent-session-compare
- Status: Implemented

## Intent

Session compare answers what two Coding Agents / ACP clients did to the *same*
working tree. Studio instead treated it as a Session-count question and, when a
connected Project could not satisfy it, pointed the reader at a second Project
("Choose a Project with at least two Sessions" plus an **Open Another Project**
button). That is the wrong dimension: opening another Project changes the working
tree and destroys the only thing the comparison controls for.

The evidence needed to model the right dimension already existed. Every retained
Session carries `summary.provider` — the Agent that produced it — and the Session
catalog already displayed it. Only the Compare gate, its copy, and its comparison
payload were Agent-blind.

This change makes the Agent dimension first class in the Compare path and keeps
the remedy inside the active Project. It does not add a way to *run* a second
Agent; Studio still observes whatever local Agents left evidence.

## Non-Goals

- Adding new host adapters or a multi-Agent launcher to the Debugger.
- Attributing Git commits to Agents (Commits stays a repository-level view).
- Changing the Bench or Evidence-results compare surfaces, which are already
  variant-oriented rather than Project-oriented.
- Ranking Agents. The comparison stays observational with no inferred winner.

## Acceptance Scenarios

- **AC-1:** `/api/config` reports a per-Agent Session breakdown
  (`sessionAgents: [{ agent, sessionCount }]`) derived from the Sessions Studio
  actually retained, so the Compare gate and the Compare picker cannot disagree.
- **AC-2:** The Session compare surface is scoped by Agent count, not Session or
  Project count: two or more Agents is `cross-agent`, two or more Sessions from a
  single Agent is `single-agent`, fewer than two Sessions is `insufficient`.
- **AC-3:** A `single-agent` Project keeps the surface reachable but reports
  `partial` availability with an honest status ("One Agent only"); it is never
  advertised as ready.
- **AC-4:** A connected Project that cannot compare shows Agent-dimension copy
  ("Run a second Agent in this Project") and an action that stays inside the
  Project ("Review this Project's Sessions"). It never offers **Open Project** or
  **Open Another Project**. A *disconnected* Studio still asks for a Project,
  because that request is correct there.
- **AC-5:** `/api/session-compare` carries the Agent identity of each side and a
  `crossAgent` flag. The view labels both lanes with their Agent, adds an Agent
  row to the metric table, and warns when both sides are the same Agent.
- **AC-6:** The compare picker seeds itself with two *different* Agents when the
  Project has them, instead of pairing whichever two Sessions are newest.
- **AC-7:** The Sessions catalog can be narrowed by Agent when more than one
  Agent contributed evidence, and keyboard row navigation follows the filtered
  rows. A single-Agent Project shows no filter.
- **AC-8:** Overview reports an `agents` fact beside `sessions`, stating whether
  the Project's evidence is comparable across Agents.

## Plan

- `server/workspace/routes.ts`: add `sessionAgentBreakdown()` over retained
  Sessions, add `agent` to each comparison side, and add the `crossAgent` flag.
- `server/server.ts`: publish `sessionAgents` from `/api/config`.
- `app/studio-shell-model.ts`: add `StudioSessionAgent`, `sessionAgents()`, and
  `sessionCompareScope()`; drive `compareSurfaces()`, the Compare destination
  availability/status, the Overview `agents` fact, and the Overview compare
  action from the scope instead of `sessionCount >= 2`.
- `app/App.tsx`: split the Compare empty state by connection state, route the
  connected case to Sessions, label picker options and lanes by Agent, seed a
  cross-Agent pair, add the Sessions Agent filter, and scope row navigation to
  the filtered rows.
- i18n (`en` + `zh-CN`): replace `destination.chooseTwoSessions` with
  `agentCompare` / `singleAgentOnly` / `secondAgentRequired`; rewrite
  `compare.empty.*`; add the Agent row, lane notices, and filter strings.
- `styles/workbench.css`: add `.session-agent-filter` as a docked toolbar row
  using existing semantic tokens.

## Test & Review Evidence

- `packages/harness-studio/test/studio-shell-model.test.ts`: scope resolution
  across `cross-agent` / `single-agent` / `insufficient`, `partial` availability
  for a single Agent, the "Second Agent required" status for a connected Project,
  and the Overview `agents` fact (AC-2, AC-3, AC-4, AC-8).
- `packages/harness-studio/test/server.test.ts`: `/api/config` exposes an empty
  breakdown with no Project and a two-Agent breakdown once discovered;
  `/api/session-compare` returns `crossAgent` and per-side `agent` (AC-1, AC-5).
- `packages/harness-studio/test/browser/artifact-host.spec.mjs`: the fixture now
  discovers two Agents in one Project; the flow proves the Agent filter, the
  Agent row, both Agent names, the cross-Agent notice, and the absence of
  **Open Another Project** (AC-5, AC-6, AC-7).
- `packages/harness-studio/test/browser/tool-call.spec.mjs`: a single-Agent
  Project shows "Run a second Agent in this Project", no Project-opening action,
  a "Second Agent required" sidebar status, and no Agent filter in Sessions
  (AC-3, AC-4, AC-7).
- Verified locally: `npx tsc --noEmit`, 528 unit tests, and 58 browser tests pass
  at wide, compact, and narrow layouts with no console or page errors.

## Risk

- Behavior change: a Project whose Sessions all come from one Agent no longer
  reports Compare as ready. This is intentional honesty, and the surface stays
  reachable, so no comparison that previously worked has been removed.
- Hosts that do not attribute a Session provider group under one `unattributed`
  Agent. Such a Project reads as `single-agent`, which is the honest answer when
  Agent identity is unknown rather than a claim of cross-Agent evidence.
