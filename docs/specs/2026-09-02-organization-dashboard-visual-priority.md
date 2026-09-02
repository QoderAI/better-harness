# Organization Dashboard visual priority

## Traceability

- Spec ID: `2026-09-02-organization-dashboard-visual-priority`
- Status: Implemented
- Extends: `2026-09-01-organization-harness-dashboard`,
  `2026-09-02-organization-dashboard-evidence-depth`

## Intent

Keep the organization Dashboard decision-first without turning its first screens
into an evidence report. The workspace, analyzed window, four source-backed
usage facts, and the three primary Harness asset types should establish context
quickly; activity charts should then become the dominant visual evidence.

Delivery behavior, repository correlation, and per-host tables remain available
as operational evidence, but they no longer delay the first trend chart. Asset
lint prose and secondary configured-asset counts are removed from the primary
overview because they do not change the first organization-level decision.

## Acceptance Scenarios

- **AC-1 — Compact identity:** the page header is a single row containing only
  the analyzed workspace and its date window. Host count and collection
  freshness do not compete with the primary metrics.
- **AC-2 — Decision facts first:** the four existing usage facts remain visible
  immediately below the header, with no new or synthetic metric.
- **AC-3 — Bounded asset overview:** Skills, MCPs, and Hooks appear as a compact
  three-column overview. Secondary asset types and zero-value lint status chips
  do not occupy the primary overview.
- **AC-4 — Charts retain priority:** Usage activity and Skill activity follow the
  overview directly. Token, Context, and Model charts retain their existing
  interactions and evidence boundaries. Section headers do not repeat their
  domain in an eyebrow label when the title already states it. A non-negative
  activity series never renders below the zero baseline through curve
  interpolation.
- **AC-5 — Detail remains available:** delivery, repository, and per-host
  evidence move below the charts into one keyboard-operable disclosure. Opening
  it restores the existing evidence rows and bounded host table.
- **AC-6 — Responsive and error-free:** 1440x900, 1024x768, and 390x844 layouts
  have no page overflow; focus remains visible; browser console, page, request,
  and response error collections remain empty.

## Non-goals

- Changing collector, upload, or Dashboard projection contracts.
- Adding governance grades, cost, autonomy, quality, or compliance metrics.
- Removing delivery, repository, or host evidence from the Dashboard.
- Redesigning the existing chart encodings or controls.

## Plan and Tasks

1. Simplify the page header and primary asset overview in
   `packages/harness-ui/components/usage-dashboard.tsx`.
2. Reorder the existing sections so source-backed charts follow the decision
   facts, then place operational evidence in a native disclosure after the
   chart and accepted-evidence sections.
3. Tighten responsive styles in `packages/harness-ui/app/globals.css` without
   introducing new visual tokens.
4. Update Playwright assertions for visual priority, disclosure keyboard
   behavior, focus, overflow, screenshots, and browser errors.

## Test and Review Evidence

- **AC-1, AC-2, AC-3, AC-4, AC-5:** `npx vitest run --testTimeout=15000`
  passes all 34 package tests. The ordinary `npm test` run reached the same
  assertions but its four real-CLI upload tests exceeded Vitest's default
  five-second timeout on this machine; the bounded 15-second rerun passed all
  four without implementation changes.
- **AC-4, AC-6:** `npm run typecheck`, `npm run build`, and
  `HARNESS_UI_TEST_PORT=3411 npx playwright test` pass. The production build
  retains 13 existing Turbopack dynamic-filesystem tracing warnings. Playwright
  verifies the activity chart precedes the operational disclosure in document
  order, proves the rendered activity curve does not extend below the zero grid
  line, exercises the keyboard toggle, checks chart focus and the bounded Host
  table, records no console/page/request/HTTP errors, proves no page overflow,
  and saves screenshots at 1440x900, 1024x768, and 390x844. Port 3411 was used
  because an existing local process owned the default 3410 port; the config now
  supports this isolated override while retaining 3410 as its default.
- **Risk:** reordering must not hide missing-source empty states or change the
  meaning of configured assets, estimated active time, model attribution, cache
  relationships, or commit correlation.
