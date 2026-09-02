# Organization Dashboard evidence depth

## Traceability

- Spec ID: `2026-09-02-organization-dashboard-evidence-depth`
- Status: Implemented
- Extends: `2026-09-01-organization-harness-dashboard`,
  `2026-09-01-task-evidence-upload-end-to-end`

## Intent

A review of the Dashboard against the scripts behind it found three classes of
gap: values the collector gathered and the page discarded, values the page
rendered that were not interpretable, and signals the scripts already produce
that the collector never asked for. This spec closes them without adding a
metric that has no source field.

The correctness problems came first, because the page's largest numbers were
the wrong ones:

- **Asset inventory double-counted.** `runAgentLint` was called once per host
  and the per-host summaries were summed. Eleven hosts read the same four
  `.agents/skills/*/SKILL.md` and the same `AGENTS.md`/`DESIGN.md`, so the page
  reported 28 Skills and 18 Rules for a repository holding 4 and 2.
- **The Model chart implied the full response population.** It plotted the
  1,474 responses that carried a model beside a headline of 17,163 responses,
  with no statement that 15,712 were unattributed.
- **Token lanes summed incompatible counters.** `codex` reports
  `included-in-input` (cache reads already inside `inputTokens`) and `claude`
  reports `separate-input-lane`. Adding them produced an Input total that is not
  a quantity of anything, and the summary's own `accountingMode: "mixed"` was
  never shown.

The organization angle had one structural hole: the upload record carries
`destination.organization`, `receipt.acceptedAt`, `receipt.state`, and the
packet digest, and the collector projected only `plan.packet`, so an
organization Dashboard could not group by organization.

## Acceptance Scenarios

- **AC-1 — Distinct assets, with instances preserved:** `agent-lint` emits a
  host-stable `assets[]` identity per configured asset — the workspace-relative
  path for a contained file, otherwise a scope-qualified name that carries no
  absolute path. The Dashboard reports distinct assets as the headline and the
  summed configured instances beside them. A report without identities marks the
  distinct total incomplete rather than silently undercounting.
- **AC-2 — Model attribution stays visible:** the Model section states how many
  responses carry a model out of the analyzed total, and names the unattributed
  remainder that the chart cannot show. The overview's response card reports the
  attribution rate rather than an unqualified count.
- **AC-3 — Cache relationships travel with the totals:**
  `session-efficiency` records the distinct `cacheAccountingModes` behind its
  retained counters, `usage-summary` carries them, and the Token section states
  the observed relationship. Hosts that disagree produce an explicit
  non-comparability note and overlapping lane labels.
- **AC-4 — Organization identity survives collection:** the collector reads
  upload records, not bare packets, so organization, acceptance time, receipt
  state, and digest reach the page. A bounded read reports how many records
  exist, so a capped list never reads as the whole population.
- **AC-5 — Delivery behavior is reported:** post-edit validation status, edit
  and later-validation counts, Task Episode closure, execution friction,
  observed tools, and observed hooks are projected from the insight pack the
  analyzer already builds. Evidence refs stay behind: they carry absolute
  session-file paths.
- **AC-6 — Delivered change and project shape:** `commit-session-link` supplies
  session-attributed commits and attributed line counts, and
  `workspace-topology` supplies member routes, tracked files, and instruction
  scope activation. Only `explicit`, `high`, and `medium` matches attribute a
  commit; a `low` match is a bare time overlap and attributes nothing.
- **AC-7 — Host axis:** one row per session provider reports that host's own
  sessions, active minutes, responses, model attribution, edits, episodes, and
  cache relationship. The table scrolls inside its own container.
- **AC-8 — Analyzed window is stated:** the page leads with the workspace label,
  the UTC date range and day count the series cover, the host counts, and the
  collection time.

## Non-goals

Unchanged from `2026-09-01-organization-harness-dashboard`, and specifically:

- No cost, first-pass-success, autonomy, or quality score is introduced. Commit
  attribution is a correlation with a stated confidence floor, not a claim that
  an agent authored a commit.
- Episode closure and post-edit validation are reported as observed counts, not
  converted into a readiness grade.
- No authentication, remote ingestion, or multi-repository aggregation.

## Test and Review Evidence

- **AC-1, AC-2, AC-3, AC-4, AC-5, AC-6, AC-7:** `npm test -w @qoder-ai/harness-ui`
  passes 34 tests. `test/collector-signals.test.mjs` drives the real
  `buildInsightPack`, `runAgentLint`, `createUploadPlan`, and `storeUploadPlan`,
  and asserts that delivery projections contain no `evidenceRef` or absolute
  path, that a `low` commit match attributes nothing, that a bounded delivery
  read still reports its total, and that a workspace file yields the same
  identity for every host. `test/dashboard-model.test.mjs` proves one shared file
  counts once while its configured instances stay visible, that an inventory
  without identities marks the distinct total incomplete, and that mixed cache
  modes are reported as non-comparable.
- **AC-8 and the rendered contract:** `npm run build -w @qoder-ai/harness-ui`
  produces the dynamic route, and the page was driven manually against that
  production server with the browser tooling: the header reports the workspace,
  the `Jul 28 - Sep 2 UTC / 37 days` window and the collection time; assets read
  `Skills 4` with `28 configured instances / 4 observed invocations`; the model
  caption reads `1,650 of 17,362 responses carry a model` beside the explicit
  unattributed remainder; the Token section reports `mixed accounting` with the
  cache-disagreement note and `(overlapping)` lane labels; the host table lists
  only the five hosts with sessions and names the seven scanned-empty ones; and
  the accepted evidence row shows `acme-engineering`, its acceptance time, and a
  12-character digest. `document.documentElement.scrollWidth` equals the client
  width at both 1440 and 390, and the host table keeps `overflow-x: auto`.

  The Playwright suite (`npm run test:browser -w @qoder-ai/harness-ui`) was
  updated for this contract but **was not executed**: this machine cannot fetch
  the browser build the pinned `@playwright/test@1.55.0` requires
  (`chromium_headless_shell-1187`), so the run fails before reaching the page.
  Run it where that download succeeds before treating its assertions as passing.

  Follow-up: CI hit the same missing browser build, because the repository-level
  `playwright install chromium` step provisions only the version the other
  workspaces share. The Dashboard now depends on that same
  `@playwright/test@^1.62.1`, and the suite passes under it.
- **No regression in the owners:** `npx vitest run` at the repository root passes
  1,639 tests, covering `session-efficiency`, `usage-summary`, and `agent-lint`
  after the contract additions.
