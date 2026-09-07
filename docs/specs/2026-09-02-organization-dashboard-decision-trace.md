# Organization Dashboard decision trace

## Traceability

- Spec ID: `2026-09-02-organization-dashboard-decision-trace`
- Status: Draft
- Extends: `2026-09-01-organization-harness-dashboard`,
  `2026-09-02-organization-dashboard-evidence-depth`

## Intent

Turn the current workspace usage Dashboard into a decision-first organization
Harness proof of concept without inventing policy, cost, ownership, or outcome
facts that the collectors do not emit. The first screen should answer what
accepted task evidence exists, where evidence is incomplete, which configured
assets have observed or task-linked activity, and how a selected task connects
intent, assets, validation observations, and its receipt.

Usage, token, context, and model charts remain available as engineering
diagnostics, but they no longer lead the organization view or compete with task
and delivery evidence.

## Acceptance Scenarios

- **AC-1 — Decision evidence leads:** the page opens with task receipt,
  acceptance, task-linked asset outcome, and evidence-gap facts derived from
  accepted packets and collection errors. When no accepted packet exists, the
  page reports that evidence as unavailable rather than showing a zero-success
  organization state.
- **AC-2 — Asset evidence classes stay separate:** Skills, MCPs, and Hooks show
  distinct configured assets and configured Host instances. Observed Skill
  invocations and Host hook events are labelled as activity, while task-linked
  outcomes come only from accepted task packets. The page never presents these
  different populations as one conversion funnel.
- **AC-3 — One task can be traced:** accepted task packets retain their intent,
  scope, non-goals, acceptance rows, asset rows, observations, receipt state,
  organization, and digest in the Dashboard model. A keyboard-operable task
  selector opens one bounded trace from intent through assets and observations
  to receipt evidence.
- **AC-4 — Diagnostics are secondary but preserved:** session overview,
  activity, Skill, Token, Context, and Model sections remain available behind
  one labelled disclosure that is collapsed by default. Delivery behavior,
  repository outcomes, and per-Host comparison remain visible organization
  evidence.
- **AC-5 — Responsive decision hierarchy:** at 1440x900 the primary task or
  missing-task decision is visible without scrolling past charts. At 390x844
  the decision facts and task trace stack without page-level horizontal
  overflow; the Host table retains bounded internal scrolling. Focus is visible
  on the task selector and diagnostics disclosure, with no browser/page errors.
- **AC-6 — Existing collection boundaries remain honest:** the change consumes
  the current local collector and versioned task packet without moving raw
  prompts, transcripts, tool inputs/outputs, credentials, absolute paths, or
  private evidence refs into the browser model.

## Non-goals

- No remote multi-repository ingestion, authentication, RBAC, team directory,
  policy engine, SLO registry, chargeback, or exact-cost implementation.
- No organization maturity score, readiness grade, asset effectiveness score,
  or inference that an observed invocation caused a task outcome.
- No replacement of capability-owned `agent-customize`, `session-analysis`,
  `project-harness`, commit, topology, or task-evidence collectors with a UI
  monolith.
- No Harness Studio navigation or workbench redesign in this slice. Shared
  collector/catalog consolidation remains a follow-up contract migration.
- No release, package-version, changelog, publication, or deployment change.

## Plan and Tasks

1. Extend the Dashboard packet projection so accepted task detail remains
   available to a browser-safe model rather than being reduced to coverage
   counts.
2. Add aggregate decision facts and per-kind asset evidence rows derived only
   from existing packet, inventory, activity, and collection fields.
3. Reorder the page into decision evidence, asset evidence, task trace,
   delivery/repository/Host comparison, and collapsed engineering diagnostics.
4. Add accessible task selection and diagnostics disclosure interactions, plus
   compact responsive styles that preserve existing chart and table bounds.
5. Update model, upload-chain, and browser tests, then verify typecheck, focused
   tests, production build, wide/compact/narrow screenshots, console errors,
   and the staged/unstaged review boundary.

## Test and Review Evidence

- **AC-1, AC-2, AC-3, AC-6:** `npm test -w @qoder-ai/harness-ui`; model tests
  must cover no-packet, passed/failed/unobserved counts, task detail retention,
  task-linked Skill/MCP outcomes, and the absence of private evidence fields.
- **AC-3, AC-4:** the browser fixture prepared and applied through the real
  upload CLI must expose `TASK-42`, its acceptance rows, Skill and MCP evidence,
  validation/human-review observations, organization, and digest. Diagnostics
  must be absent before disclosure and visible after activation.
- **AC-5:** run the Dashboard browser test at 1440x900, 1024x768, and 390x844;
  inspect screenshots, page overflow, Host-table overflow, focus, console/page
  errors, and the primary decision position.
- Run `npm run typecheck -w @qoder-ai/harness-ui` and
  `npm run build -w @qoder-ai/harness-ui`.
- Run `git diff --check` and a Review Readiness Check before changing this spec
  to `Implemented`.

Risk review must reject aggregate labels that imply causation, organization
coverage, policy compliance, or exact cost. Accepted packet detail remains
bounded and sanitized by the task-evidence contract; the browser model must not
add raw stored-record metadata or absolute evidence paths.
