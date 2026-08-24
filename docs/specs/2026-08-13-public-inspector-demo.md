# Public Harness Inspector demo

## Traceability

- Spec ID: `public-inspector-demo`
- Status: Implemented

## Intent

Add a first-class Harness Inspector entry to the Better Harness GitHub Pages
site. Readers should understand the Inspector's evidence-bounded purpose and
explore the current Workbench interactions without installing the project or
exposing any maintainer's local sessions, prompts, paths, or repository state.

## Acceptance Scenarios

- AC-1: The website navbar contains an internal `Inspector` link immediately
  after Docs. A compact green `New` badge sits at the link's upper-right on
  desktop and beside the link on the mobile menu; `New` is not part of the
  product name, route, page title, or accessible link name.
- AC-2: `/inspector/` is a full-width Docusaurus page with a concise product
  introduction, explicit `Interactive sample`, `Read-only`, and `English sample
  data` boundaries, an `Open full screen` action, and an embedded current
  Harness Inspector Workbench.
- AC-3: The embedded Workbench is generated from a deterministic in-memory
  fixture. Every user-facing fixture value is English, no local session or Git
  discovery runs during the docs build, and the sample contains enough Stories,
  Sessions, Tool Calls, Files, Commits, dates, and evidence kinds to exercise
  Delivery Tree, Date, Evidence Drawer, Session View, and Replay interactions.
- AC-4: The embedded page identifies itself as sample data rather than `real
  local evidence`, carries `noindex, follow`, and preserves the standalone
  Workbench's escaping and privacy guarantees. The indexable Docusaurus wrapper
  owns the public description.
- AC-5: English and Simplified Chinese website builds expose the same English
  Workbench sample. Only the wrapper introduction and actions are localized.
  Desktop and narrow viewports retain usable navigation, iframe focus, a
  full-screen fallback, and no page-level horizontal overflow.
- AC-6: Changes to the Inspector renderer, UI, fixture, docs page, or publishing
  workflow trigger or participate in the GitHub Pages build so the published
  demo cannot silently drift behind the current Workbench.
- AC-7: The page continues below the interactive sample with concise,
  indexable documentation that explains the Inspector's core jobs, the
  difference between direct, observed, candidate, and contextual evidence, and
  the limits of what those relationships prove.
- AC-8: A numbered usage guide walks readers through choosing a scope,
  inspecting the three Workbench lanes, opening evidence details, and using
  Session View or Replay. A separate local-project callout provides the exact
  advanced CLI command, default output location, and a link to installation
  documentation without implying that the hosted sample reads local data.

## Non-goals

- Publishing a maintainer's `.qoder/` report, native session identifiers, real
  prompts, commit authors, or current repository activity.
- Reading a visitor's local workspace or offering a server-backed live report.
- Rewriting the self-contained Workbench as Docusaurus React components.
- Synchronizing the wrapper URL with every iframe selection in this slice; the
  standalone Workbench remains the owner of evidence deep links.
- Adding Compare, editing mappings, recovery, or workspace mutation controls.

## Plan and Tasks

1. Add a pure Inspector demo builder under `scripts/harness-inspector/` with a
   fixed English fixture and generated timestamp.
2. Add a bounded rendering presentation option for the sample context label,
   robots metadata, and optional public-demo marker without changing local
   report defaults.
3. Generate `docs/static/demo/harness-inspector/index.html` during the existing
   docs asset-sync step instead of committing a second Workbench copy.
4. Add a custom full-width `/inspector/` page, localized wrapper copy, full-screen
   action, iframe title, clipboard permission, and responsive frame layout.
5. Add the `Inspector` navbar item and CSS-only green `New` badge while keeping
   the DOM link text and accessible name equal to `Inspector`.
6. Extend Pages path triggers to include the Inspector owners and add focused
   behavior tests for fixture language, privacy, presentation metadata, and
   generated output.
7. Add localized feature, usage, evidence-label, and local-project sections
   below the sample, with responsive cards and semantic headings/lists.

Decision rationale: the Inspector already emits a portable self-contained HTML
Workbench. Embedding that artifact keeps one UI owner and makes the public sample
track current interactions. A deterministic fixture prevents CI from depending
on developer homes or native host state, while the Docusaurus wrapper provides
the indexable explanation and locale-specific framing.

## Test and Review Evidence

- AC-3/AC-4: focused Vitest coverage builds the demo twice, compares the stable
  report projection, validates English fixture strings, asserts sample/noindex
  metadata, and rejects absolute-home or credential-shaped output.
- AC-1/AC-2/AC-5: `cd docs && npm run build`, followed by Playwright checks of
  English and `zh-Hans` `/inspector/` routes, navbar/badge placement, iframe
  interaction, full-screen target, console/page errors, and desktop/narrow
  screenshots.
- AC-6: inspect the Pages workflow path filter and run the docs prebuild from a
  clean generated-static target.
- AC-7/AC-8: inspect the English and Simplified Chinese page structure in the
  production build, verify the installation link and literal CLI command, and
  review the lower-page layout at desktop and narrow breakpoints.
- Documentation integrity: `node scripts/doc-link-graph/cli.mjs
  skills/better-harness` and `npx vitest run
  test/skills-docs/doc-link-graph.test.mjs` after adding this spec.
- Regression and package boundary: focused Inspector tests, `npm test`,
  `npm run pack:verify`, and `git diff --check`.
- Privacy risk: fixture generation must remain pure and fixed; the docs build
  must never call session discovery or Git history collection.
- UI risk: nested browser scrolling can obscure the Workbench. Keep the wrapper
  as a viewport-height flex surface and provide a visible full-screen escape.

Observed on 2026-08-13:

- Focused Inspector coverage: 21 tests passed.
- Documentation link graph: 6 tests passed after regeneration.
- Full regression suite: 92 files and 1,309 tests passed.
- Package verification: npm package and runtime zip contents passed.
- Production documentation build: English and Simplified Chinese builds passed.
- Browser verification: the English and Simplified Chinese wrappers loaded with
  no console errors or page-level horizontal overflow; the embedded sample used
  English-only fixture data and realistic short commit hashes. The standalone
  sample opened Session View and switched to Replay successfully.
- Documentation extension: the English and Simplified Chinese production pages
  exposed all feature, usage, evidence-label, and local-project sections; the
  advanced CLI command and installation link were present, with no console
  errors or page-level horizontal overflow.
