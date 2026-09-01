# Organization Harness usage dashboard

## Traceability

- Spec ID: `2026-09-01-organization-harness-dashboard`
- Status: Implemented
- Extended by: `2026-09-01-task-evidence-upload-end-to-end`, which supplies the
  stored evidence AC-8 projects, replaces the process-lifetime data cache with a
  bounded refresh window, and widens the collected host set.

## Intent

Create a private `@qoder-ai/harness-ui` Next.js dashboard whose visible metrics
are projections of data that Better Harness scripts collect from the current
workspace. The first screen is a calm, standalone shadcn-style analytics page,
not a Harness Studio workbench and not a speculative organization-governance
console. Production UI must not fall back to sample organization, session,
usage, context, asset, or upload values.

The source contracts are:

- `better-harness.session-usage-summary` schema version 1 from
  `scripts/session-analysis/usage-summary.mjs`;
- `usageActivity` schema version 3 from
  `scripts/session-analysis/daily-usage.mjs` and the `findings.json` report;
- `contextUsage` from the task-loop report, including observed context-window
  occupancy, bounded category token estimates, item coverage, and native Cursor
  evidence status;
- `agent-lint` with the `agent-assets-review` profile from
  `scripts/agent-lint/index.mjs`, including its configured Skills, MCPs, Hooks,
  Commands, Rules, Agents, and Plugins summary;
- `better-harness.task-evidence-packet` schema version 1 from
  `scripts/task-evidence-upload/contract.mjs`.

Dashboard selectors may derive display rows, cross-host totals, and percentages
from those shapes, but may not introduce a metric that has no source field or
documented formula. Test fixtures remain test-only and are never the normal page
data source.

## Acceptance Scenarios

- **AC-1 — Script-shaped input:** the Dashboard adapter accepts the existing
  usage summary, daily activity, agent asset inventory, and task evidence
  packet shapes. Tests build inputs with the real script functions before
  passing them to the UI adapter.
- **AC-2 — Honest overview:** the usage headline metrics are analyzed sessions,
  estimated active minutes, model responses, and observed Skill invocations.
  Exact cost, first-pass success, intervention rate, autonomy readiness, and
  invented organization outcomes are absent.
- **AC-2a — Organization asset inventory:** a separate overview shows summed
  configured instances of Skills, MCPs, and Hooks across supplied project
  inventory reports. Commands, Rules, Agents, and Plugins use the same contract
  and can be expanded without introducing a new metric model. The UI does not
  call configured instances unique assets or quality scores.
- **AC-3 — shadcn chart composition:** the primary card follows the shadcn Area
  Chart composition: neutral card shell, restrained typography, chart tooltip,
  range control, and an area fill used only as data encoding. Users can switch
  between session starts and estimated active minutes without mixing units on
  one axis.
- **AC-3a — Skill trend, not ranked decoration:** Skill activity uses the
  existing date-aligned `usageActivity.skills[].daily` series in a chart with a
  bounded Skill selector. The ranked progress-bar list is removed.
- **AC-4 — Evidence boundary:** accounting mode, analyzed coverage, usage-field
  coverage, semantic-review state, warning codes, and exact-cost availability
  remain preserved in the source contract. The Dashboard does not convert them
  into outcome metrics or render them as a competing review panel.
- **AC-4a — Usage and context quantities:** token totals keep input, output,
  cache-read, and cache-creation lanes from the usage summary. Context-window
  occupancy and category estimates appear only when `contextUsage.status` is
  `observed`; unobserved inputs do not produce category claims.
- **AC-4b — Token charts own token evidence:** `usageActivity.tokens` adds
  date-aligned daily input, output, cache-read, and cache-creation totals from
  normalized response events. The Token section uses four compact daily charts,
  one each for input, output, cache-read, and cache-creation; it does not
  synthesize dates from the aggregate totals. A provider without non-zero token
  observations contributes neither zero-filled daily points nor false coverage.
- **AC-5 — Existing detail only:** the bounded Model chart switches between
  response count and usage-field-observed count from `modelUsage`; Skill series
  come from `usageActivity.skills`, and task rows come from prepared evidence
  packets and their existing acceptance, asset, observation, and privacy
  coverage fields.
- **AC-5a — Remove internal review chrome:** the Dashboard does not render the
  Data quality/Coverage card. Accounting and review-boundary fields remain in
  the source contract for other consumers, but they are not a primary
  organization Dashboard visualization.
- **AC-6 — Independent responsive UI:** the page has no Studio sidebar, pane
  chrome, or Inspector hierarchy. It remains usable at 1440x900, 1024x768, and
  390x844 with bounded charts/tables, visible focus, and no page or console
  errors.
- **AC-7 — Honest missing-data boundary:** the normal page runs the local
  session-analysis and agent-lint collectors. A missing source hides its
  dependent section or produces one actionable empty state; sample values,
  sample organizations, and prepared test uploads never replace it.
- **AC-8 — Current upload end to end:** a fixture runs through the real
  `better-harness upload plan` CLI, writes and validates a plan artifact,
  preserves the no-network/no-remote-mutation boundary, redacts private input,
  and projects the resulting packet into the Dashboard and browser view.

## Non-goals

- Implementing Protobuf/Buf ingestion, PostgreSQL, authentication, or remote
  live-data refresh.
- Restoring AG-UI or placing Agent execution inside the Next.js application.
- Aggregating unavailable task outcomes, quality, cost, review, or autonomy
  metrics.
- Reusing Harness Studio navigation or visual hierarchy.
- Publishing the package to npm.
- Rendering a product hero, organization switcher, or duplicated Dashboard
  title above the observed data.

## Plan and Tasks

1. Recreate `packages/harness-ui` as a private Next.js application with a
   narrower shadcn-style Dashboard contract.
2. Add a server-only local collector and typed adapter over the existing script
   output shapes; aggregate host series only after aligning their UTC dates.
3. Build one responsive Overview page: observed asset inventory, source-backed
   session, Skill, Token, and optional context charts, plus model activity.
   Render prepared task evidence only when the input actually contains it; omit
   the internal evidence-boundary card from this surface.
4. Extend `usageActivity` at its existing `daily-usage` owner with date-aligned
   Token lanes, then update its validator and focused contract tests.
5. Test projections with inputs generated by the actual scripts, then run
   typecheck, production build, and Playwright visual checks.
6. Keep the rendered view dense: explanatory contract detail belongs in the
   spec, tooltips, or compact status labels rather than large Dashboard copy.

## Later service boundary

Keep `better-harness upload` as the producer of task evidence semantics. A
future Buf module should encode the existing packet rather than redesign it.
The ingestion service validates organization identity, idempotency, digest, and
schema version, then stores packet metadata in PostgreSQL and optional large
evidence blobs in object storage.

`2026-09-01-task-evidence-upload-end-to-end` implements that validation shape
locally: the bundled `/api/upload` route checks schema, digest, and organization
before storing one record per packet digest. It is a local destination for the
local Dashboard, not a deployed control plane, and Next.js remains outside Agent
execution.

## Test and Review Evidence

- **AC-1, AC-2, AC-2a, AC-4, AC-4a, AC-4b, AC-5, AC-7, AC-8:**
  `npm test -w @qoder-ai/harness-ui` passes six projection, local aggregation,
  and upload-chain tests. The primary
  test builds its inputs with `buildUsageSummary`, `buildDailyUsageActivity`,
  `runAgentLint`, and `createTaskEvidencePacket`, then verifies the displayed
  totals, daily token accounting lanes, observed context-window occupancy,
  aligned cross-host daily series, and the absence of cost and autonomy fields
  in the overview model. The normal page calls the local collector rather than
  importing a preview fixture. The daily-usage owner and task-loop validator
  pass 140 focused tests, including schema version 3 token totals/date alignment.
  The upload-chain test invokes the real CLI, validates the written plan and
  digest, proves private path and token redaction, asserts `network: none` and
  `remoteMutation: false`, and projects the emitted packet as `TASK-42`.
- **AC-3, AC-3a, AC-4b, AC-5a, and AC-6:**
  `npm run build -w @qoder-ai/harness-ui` produces the dynamic Next.js route.
  `npm run test:browser -w @qoder-ai/harness-ui` passes one interaction at
  1440x900, 1024x768, and 390x844. It checks the usage area chart, Skill bar
  chart, four Token area charts, Model metric chart, metric/range controls,
  visible chart focus, removed Data quality heading, bounded horizontal
  overflow, three screenshots, and no console or page errors.

The remaining product boundary is explicit: asset totals are configured
instances summed across supplied inventory reports, active time is an estimate,
and the page remains a script-aligned preview until remote upload exists.
