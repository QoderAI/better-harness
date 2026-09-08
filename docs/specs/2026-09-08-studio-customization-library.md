# Customization library in the sidebar

## Traceability
- Spec ID: studio-customization-library
- Status: Implemented (source and browser validation)
- Source: Maintainer request in this task.

## Intent
Move customization browsing out of the primary Views into a collapsible library
at the bottom of the sidebar. Open each category in a popup while preserving the
current workbench. Make Coding Agent provenance explicit.

## Acceptance Scenarios
- AC-1: Views omit Customizations. A lower sidebar group offers Overview, Plugins,
  MCP Servers, Skills, Instructions, Agents, Hooks, Tools and Commands. Counts
  appear only after analysis; collapse keeps Settings reachable.
- AC-2: Each entry opens a labelled modal with category and Agent filters. Escape,
  Close and backdrop dismiss it, restore focus, and preserve the current view.
  Legacy customization links open Overview over the default workbench.
- AC-3: Agent provenance comes from exposures, installations and registrations;
  shared definitions retain all Agents and unknown associations stay explicit.
  Tools come from retained MCP discoveries and show freshness, not inferred support.
- AC-4: Studio automatically loads cached metadata or collects it on startup,
  without opening a popup or requiring Analyze. Project changes load their own
  catalog automatically. Manual refresh remains available. Loading,
  retry, empty and partial collector results are visible. Project changes reset
  the catalog and ignore obsolete requests. Private paths and secrets stay private.
- AC-5: Light/dark wide, compact and narrow layouts stay bounded; keyboard focus,
  modal containment, screenshots and browser console errors are verified. Category
  rows use neutral hover, soft open state and filled keyboard focus with readable
  counts, without a detached outline.

## Non-goals
No new collectors, Agent support, configuration editing, installs or publication.
No live MCP connections.

## Plan and Tasks
1. Normalize catalog categories and Agent relations into a browser model.
2. Replace the full-page catalog with sidebar rows and a native dialog; reuse
   semantic tokens and the existing collector API. Preserve legacy routes.
3. Add behavioral model and browser tests; review screenshots and preview health.

## Test and Review Evidence
- AC-1/2/3: Browser tests open categories, filter Codex/Qoder/Claude, retain shared
  provenance, check counts, and exercise Escape, Close, backdrop, focus trapping,
  focus return, collapse, and legacy links over Sessions.
- AC-3: Two model tests cover deduplicated associations, unassigned definitions,
  and tool provenance/freshness resolved through discovery and registration edges.
- AC-4: Browser tests hold a catalog request, fail it, then retry explicitly;
  collector tests cover privacy and partial results. Catalog state is keyed by
  workspace revision and request cleanup ignores responses after unmount.
- AC-5: Light/dark sidebar and popup screenshots saved under
  `outputs/studio-customization-library/`; wide, compact and narrow layouts,
  keyboard focus, bounded overflow and console/page errors checked.
- TypeScript check and application bundle build passed. Focused Playwright:
  19 passed across customization, project shell and shared date scope.
- Focused Vitest: 12 passed across library model, collector, server, i18n resource
  parity and i18n components. Documentation link graph: 8 passed; regeneration
  produced no graph changes.
- `npm run preview` found the existing listener; `/health` and `/canvas-module.js`
  on port 58575 returned 200 without replacing that process.
- Review Readiness: Maintainer request supplies scope, no Story was provided or
  inferred. Source, bilingual labels, owned CSS/build assets, spec and tests align.
  Concurrent Compare, GitHistory and ACP edits remain outside this task, including
  mixed build/index files. The maintainer requested a scoped commit; unrelated
  ACP edits are excluded. No push or install requested. AI implementation and review: Codex.

Desktop packaging, installed-host behavior and Windows/Linux CI were not tested.
Metadata now loads automatically on entry; the popup does not edit configuration
or establish live MCP connections.


## Automatic loading follow-up
The maintainer requested immediate population without manual analysis. The library
now starts collection on mount when no catalog is retained, or loads the cached
catalog. Initial loading is shared across effect replay and does not rerun when
its completion updates shell counts. Sidebar loading status replaces an apparent
empty catalog; the dialog offers Refresh or Retry rather than an initial Analyze
step. Browser coverage holds the automatic request before any click, then verifies
sidebar counts, category contents and cached reload without another collection.
Both updated browser scenarios passed across the existing light/dark layout matrix;
TypeScript and application bundle builds passed. Screenshots are retained under
`outputs/studio-customization-autoload/`. No desktop package was installed.


## Category row interaction review
Replaced the detached focus frame with the source-list fill, using shared primary
and on-primary tokens for the focused row and counts. Neutral hover and soft open
states are separate, and aria-expanded tracks the category popup. Focus assertions
wait for the existing transition to settle before comparing token-resolved colors.
The two customization browser scenarios pass across light/dark and all three widths;
TypeScript and application builds pass. Review screenshots are under
`outputs/studio-customization-row-focus/`.
