# Customizations as a docked workbench

## Traceability
- Spec ID: studio-customizations-workbench
- Status: Implemented (source and browser validation)
- Source: Maintainer request in this task ("remove the popup; Agents belong in a
  secondary sidebar with All / per-Agent rows").
- Supersedes the popup interaction in
  [2026-09-08-studio-customization-library.md](2026-09-08-studio-customization-library.md);
  its catalog model, provenance rules, and privacy boundary stay in force.

## Intent
Customizations is the only Studio surface that answers a question in a modal.
Every other View reads its evidence in the docked workspace: a source list on the
leading edge, evidence in the centre, facts on the trailing edge. The popup also
forces two `select` controls to carry navigation — category and Agent — so a
reader cannot see which categories exist while looking at one, and cannot see how
many entries each Agent contributed without opening the menu.

Replace it with a docked Customizations View whose two filter dimensions are
visible source-list rows in a secondary sidebar, and whose entries read as a
sortable table with a detail inspector.

## Acceptance Scenarios

- AC-1 (View, not popup): Customizations is a row in the primary sidebar's View
  list and opens in the workspace. No `dialog` element, backdrop, or focus trap
  takes part in customization browsing. `#/…/customizations` resolves to the View
  itself and no longer rewrites the hash back to another area.
- AC-2 (secondary sidebar): The View's leading pane is one keyboard group with two
  labelled sections. **Library** lists Overview and the eight categories; **Agents**
  lists All Agents, one row per observed Agent, and *Agent not identified* only
  when unassigned entries exist. Every row shows its entry count in its single
  trailing slot; an Agent that did not collect cleanly shows its status word there
  instead. The active row in each section carries `aria-current`.
- AC-3 (composed filters): Category and Agent compose. Overview keeps every
  category and adds a Category column. Changing either dimension keeps the other,
  updates the counts a reader can see, and reports an empty result as an empty
  state rather than a blank pane.
- AC-4 (entries and detail): Entries render through the shared `DataTable` with
  sortable Name, Agents, Scope, Evidence, and Source columns, a frozen header, and
  a text filter over name, description, and source. Selecting a row updates the
  adjacent detail pane, which states the entry's category, Agents, scope,
  evidence, and source path. Selection does not navigate, expand the row, or run a
  command.
- AC-5 (keyboard and focus): The secondary sidebar is one Tab stop; Arrow keys,
  Home, and End move the focused row without changing the filter, and Enter or
  Space applies it. Table rows are reachable and selectable from the keyboard.
  Every control has a visible `:focus-visible` treatment.
- AC-6 (layout): Wide (>1080px) shows sidebar, entries, and detail side by side
  with the entries pane holding at least half the usable width; the sidebar is
  resizable through a real separator. Compact (760–1080px) drops the detail to a
  bounded region under the entries. Narrow (<760px) stacks filters, entries, and
  detail. No layout scrolls the window horizontally or strands the primary
  decision below the fold.
- AC-7 (loading and privacy): The catalog loads once when the View is first
  opened, reuses a retained catalog on return, and offers Refresh in the toolbar
  action slot. Loading, failure, retry, and per-Agent collection errors stay
  visible in the View. Native paths and secret values never reach the client.

## Non-goals
- No new collectors, hosts, editing, install, or live MCP connection.
- No sub-route in the location hash for the selected category or Agent; the View
  opens on Overview / All Agents.
- No change to the catalog contract, collector privacy rules, or provenance model.

## Plan and Tasks
1. Extend the browser model with the Agent facet (id, label, count, status) and a
   text filter, so counts and rows come from one tested function.
2. Rewrite `CustomizationView` as a three-region docked workbench: secondary
   sidebar (roving source list), entries pane (`DataTable` + filter), detail pane.
   Move Refresh into the toolbar slot through `ToolbarActions`.
3. Return Customizations to the primary sidebar's View list; delete the popup, its
   open-request plumbing, and the hash rewrite in `App`.
4. Replace `customization-library.css` with `customizations.css` for the docked
   regions; keep every value on a semantic token.
5. Update DESIGN.md's navigation contract, the bilingual strings, and the tests.

## Test and Review Evidence
- Unit (Vitest): `test/customization-library.test.ts` covers the Agent facet — All plus
  every observed Host, Host rows retained at zero, status passthrough, and an
  `unassigned` row only when an entry really has no Agent edge — and the text filter
  over name, description, and source. Full package run: 631 tests in 84 files pass.
- Browser (Playwright): `test/browser/customization.spec.mjs` proves AC-1 through
  AC-5 and AC-7 — the View owns the workspace with `getByRole("dialog")` at count 0,
  the sidebar row carries `aria-current="page"`, held and failed catalog requests,
  Refresh/Retry in the toolbar slot, section rows with counts and the failed Agent's
  status word, composed category/Agent filters, Overview's Category column, row
  selection into the provenance pane, and Arrow-then-Enter roving that moves focus
  without changing the filter. Privacy is asserted by absence of the workspace path
  and the fixture's token in the rendered workbench.
- Layout (AC-6): the same scenario measures the entries pane at ≥ half the workbench
  width above 1080px, bounded region heights, and no horizontal document overflow at
  1440/1024/390 in light and dark, with screenshots under
  `outputs/studio-customizations-workbench/`. Selected-state screenshots at all three
  widths come from a 24-entry probe fixture.
- Regression: the full Studio Playwright suite passes (110 tests), including the
  rendered-shell contract (renamed stylesheet, no docked shadows, no sub-12px text)
  and the updated primary-sidebar roving assertions in `project-shell.spec.mjs`.
- TypeScript check and the application bundle build pass. The documentation link
  graph test passes.
- Two defects were found and fixed during browser review, both outside the new
  component: a row scrolled into view landed under the frozen table header
  (`scroll-margin-top` on `tbody tr`, a WCAG 2.2 focus-not-obscured risk for every
  Studio table), and a percentage `max-height` on a content-sized stacked pane
  resolved against itself and clipped the pane to its header.
- Review Readiness: the maintainer request supplies scope; no Story id was provided
  or inferred. Concurrent ACP, Compare, and run/* edits in the working tree belong to
  other work and are not part of this change. No commit, push, or install was
  requested. AI implementation and review: Qoder.

Desktop packaging, installed-host behavior, and Windows/Linux CI were not exercised.
The View still reads retained metadata only: it does not edit configuration or open
live MCP connections.
