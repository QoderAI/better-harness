# Dashboard MCP activity

## Traceability

- Spec ID: `2026-09-02-dashboard-mcp-activity`
- Status: Implemented
- Extends: `2026-09-01-organization-harness-dashboard`,
  `2026-09-02-organization-dashboard-visual-priority`

## Intent

Add an MCP activity chart directly below Skill activity using observed session
tool calls. The chart answers which MCP servers were actually invoked by date;
it does not treat configured MCP inventory as runtime activity.

An MCP observation is accepted only when the normalized tool identity has the
canonical `mcp__<server>__<tool>` shape, either as the event tool name or as the
nested tool called by a Codex execution event. Calls are grouped by server,
date-aligned in UTC, and deduplicated by the invocation identity available in
the normalized lifecycle.

## Acceptance Scenarios

- **AC-1 — Source-backed observations:** daily usage extracts the bounded MCP
  server name from canonical MCP tool calls, counts one invocation lifecycle
  once, and ignores configured inventory and ordinary tools.
- **AC-2 — Contract propagation:** usage activity schema version 4 carries a
  bounded `mcps` series alongside Skills. Multi-host collection aligns and sums
  MCP rows by UTC date without losing older schema inputs that omit the field.
- **AC-3 — Honest projection:** the Dashboard model exposes MCP series sorted by
  observed call count. No calls produce no MCP activity section.
- **AC-4 — Chart placement and interaction:** MCP activity appears immediately
  below Skill activity, with a bounded server selector, 7/30-day range control,
  non-negative integer bars, tooltip, keyboard focus, and no repeated eyebrow.
- **AC-5 — Responsive and error-free:** the new chart remains bounded at
  1440x900, 1024x768, and 390x844 with no console, page, request, response, or
  horizontal-overflow errors.

## Non-goals

- Inferring MCP usage from installed or configured server inventory.
- Claiming coverage for hosts that do not preserve canonical MCP tool identity.
- Showing individual MCP tools, arguments, results, secrets, latency, or cost.
- Adding remote ingestion or an MCP runtime connection from the Dashboard.

## Plan and Tasks

1. Extend `scripts/session-analysis/daily-usage.mjs` with privacy-bounded MCP
   observation extraction and schema version 4 output.
2. Update the report validator, Harness UI contract, multi-host aggregator, and
   Dashboard projection for optional MCP series.
3. Add the MCP chart below Skill activity using the existing Recharts bar-chart
   composition and responsive controls.
4. Cover direct/nested call recognition, lifecycle deduplication, date
   alignment, projection order, browser interaction, focus, overflow, and
   screenshots.

## Test and Review Evidence

- **AC-1, AC-2:** `npx vitest run
  test/sessions/session-usage-activity.test.mjs` passed 7 tests; Harness UI
  `test/local-data.test.mjs` passed inside the 34-test package suite. The
  task-loop usage projection test also passed with schema version 4 while
  existing schema version 1 fixtures remained valid.
- **AC-3:** `npm test -- --testTimeout=15000` passed 34 tests, including the
  real-script Dashboard projection and ordered MCP-series assertions.
- **AC-4, AC-5:** `npm run build` completed with the 13 existing dynamic
  filesystem tracing warnings, and `HARNESS_UI_TEST_PORT=3411 npx playwright
  test` passed. Reviewed screenshots:
  `packages/harness-ui/test-results/harness-usage-wide.png`,
  `harness-usage-compact.png`, and `harness-usage-narrow.png`.
- **Risk:** tool-name conventions vary by host. Unknown or non-canonical tool
  names remain unobserved rather than being guessed into an MCP server.
