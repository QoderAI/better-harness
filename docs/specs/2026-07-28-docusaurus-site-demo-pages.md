# Docusaurus Website With Live Demo Report

Publish a GitHub Pages website so the README demo report renders in a browser
instead of showing HTML source, and give the project a curated landing page
plus a small documentation set.

## Traceability

- Spec ID: `2026-07-28-docusaurus-site-demo-pages`
- Status: Implemented
- Story: none (open-source launch gap: repository-relative HTML demo links are
  not rendered by GitHub)

## Intent

- The strongest conversion path for an open-source tool is seeing the output
  before installing. The README currently links
  `assets/demo/better-harness-report.html` as a repository-relative path, which
  GitHub renders as source code.
- The repository already contains launch-quality English content (README
  narrative, `docs/concepts.md`, `docs/glossary.md`, `models/agent-work-loop.md`,
  `docs/adapters/README.md`). The website curates that content; it does not
  fork product judgment.

## Design

- `docs/` holds an isolated Docusaurus 3 site with its own `package.json`,
  colocated with the canonical repository markdown (`docs/ARCHITECTURE.md`,
  `docs/specs/`, `docs/adrs/`, ...), which stays outside the published site.
  Curated site pages live under `docs/docs/`. Root production dependencies and
  the npm `files` whitelist exclude all site machinery (`docs/docs/`,
  `docs/i18n/`, `docs/src/`, `docs/static/`, `docs/scripts/`, `docs/build/`,
  config files); `pack:verify` enforces that boundary.
- The landing page tells one story in six blocks: hero, live demo (report +
  history animation), how it works (Agent Work Loop + architecture), quick
  start prompt, per-host install links, footer.
- `docs/scripts/sync-assets.mjs` copies the three published demo assets, the two
  English SVG diagrams, and the Codex install screenshot into `docs/static/`
  before `start`/`build`. Synced targets are gitignored; `assets/` stays the
  single source of truth.
- The demo report is published as a directory route
  (`demo/better-harness-report/index.html`) so Docusaurus production preview
  and GitHub Pages resolve the same base-URL-aware link without rewriting an
  explicit `.html` suffix outside `/better-harness/`.
- Docs are a curated publication view (Getting Started, Concepts, Hosts,
  Reference). Repository markdown remains canonical; each curated page links
  back to its GitHub source. No blog, no versioning in v1.
- The site ships two locales: `en` (default) and `zh-Hans`. Homepage strings
  use `@docusaurus/Translate` ids filled in `i18n/zh-Hans/code.json`;
  navbar/footer/sidebar labels and the eight docs pages are translated under
  `i18n/zh-Hans/`. Theme strings reuse the official Docusaurus zh-Hans
  translations. The demo report artifact stays English in both locales.
- `.github/workflows/pages.yml` builds the site on pushes to `main` that touch
  `docs/`, `assets/`, or the workflow, and deploys with the official Pages
  actions (`pages: write` + `id-token: write` only).
- README demo links point to the Pages URL; a repository-relative source link
  is kept for offline clones.

## Acceptance Criteria

- DSDP-AC-1: Opening the README demo link renders the interactive HTML report
  in a browser (Pages URL), not HTML source.
- DSDP-AC-2: `https://qoderai.github.io/better-harness/` serves a landing page
  that reaches the demo report in one click.
- DSDP-AC-3: The site builds locally with `npm ci && npm run build` inside
  `docs/` on Node >= 22.
- DSDP-AC-4: Root `npm test` and `npm run pack:verify` pass; the npm package
  contains repository docs markdown but no Docusaurus site machinery
  (`docs/docs/`, `docs/i18n/`, `docs/src/`, `docs/static/`, `docs/scripts/`,
  `docs/build/`, site config, or lockfile).
- DSDP-AC-5: Installation docs cover Claude Code, Codex, Qoder, and Cursor as
  separate tabs consistent with the README.
- DSDP-AC-6: Default-locale site content is English (H2+ headings included);
  the zh-Hans locale carries the Chinese translation set. Demo assets are
  synced from `assets/`, not duplicated by hand.
- DSDP-AC-7: The locale dropdown switches between English and 简体中文; the
  zh-Hans homepage and all eight docs pages render translated content, and
  `npm run build` succeeds for both locales with zero broken links.
- DSDP-AC-8: The generated Qoder runtime ZIP retains canonical repository docs
  but excludes Docusaurus source, dependency, cache, and build paths. Package
  verification must fail if any excluded site prefix appears in either the npm
  tarball or runtime ZIP.
- DSDP-AC-9: In `npm run serve`, the homepage, docs, locale routes, and every
  demo-report link return their intended page under `/better-harness/`; the
  demo link must not redirect to the site homepage.
- DSDP-AC-10: Before commit, the staged snapshot includes the site plus its
  README, package-boundary, validation, and test integration, and a staged-only
  npm dry run contains no Docusaurus machinery.

## Non-goals

- No second source of truth for product judgment; `skills/`, `models/`,
  `references/`, and `docs/` remain canonical.
- No blog, versioned docs, search service, or locales beyond `en`/`zh-Hans`
  in v1.
- No automatic publishing of freshly generated Harness reports yet; only the
  checked-in demo report is published (a later spec may add this).
- No change to `roadmap.md` content (tracked separately).

## Plan

1. Add the Docusaurus skeleton inside `docs/` with isolated dependencies.
2. Implement the landing page and asset sync script.
3. Curate the docs set and sidebar.
4. Add `.github/workflows/pages.yml`.
5. Point README demo links at the Pages URL.
6. Filter Docusaurus-only paths from both npm and runtime bundle packaging, and
   keep the two exclusion contracts under test.
7. Publish the demo report through a directory route that works in Docusaurus
   production preview and GitHub Pages.
8. Verify: website build, browser routes, root `npm test`, staged-only npm pack,
   and `npm run pack:verify`.

## Risks

- Packaging boundary drift can silently ship `docs/node_modules`, build output,
  or the site lockfile in the Qoder runtime ZIP even when npm packaging is
  clean. Mitigation: filter at bundle collection time and independently reject
  the same prefixes in `pack:verify`.
- Static `.html` links are handled differently by Docusaurus production preview
  and GitHub Pages. Mitigation: use one directory-index URL and exercise it with
  Playwright against `npm run serve`.
- The website and root integration span staged and unstaged files. Mitigation:
  run the final readiness check against the staged snapshot before commit; do
  not infer readiness from the working-tree test result.

## Test / Review Evidence

- DSDP-AC-3/7: `cd docs && npm ci && npm run build` — must succeed for both
  locales with zero broken links (`onBrokenLinks: 'throw'`).
- DSDP-AC-4/8: `npm run pack:verify` — npm and runtime ZIP exclusions must pass;
  inspect the reported runtime entry count for unexpected growth.
- DSDP-AC-9: start `npm run serve`, then use Playwright to open English,
  zh-Hans, docs, and demo routes; retain console/page errors and a screenshot.
- DSDP-AC-4/10: materialize the Git index into a temporary directory and run
  `npm pack --dry-run --json --ignore-scripts`; no site machinery may appear.
- DSDP-AC-4/8: `npm test` at the repository root, including focused runtime
  bundle boundary coverage.
- Observed 2026-07-29: the two-locale Docusaurus build completed with zero
  broken links; Playwright received 200 responses for English, zh-Hans, docs,
  and demo routes with zero console/page errors; `npm test` passed 860/860;
  `npm run pack:verify` passed with 305 npm entries and 332 runtime ZIP entries;
  and the staged-only npm dry run contained 305 files with zero Docusaurus site
  machinery entries.
- Post-merge manual steps: Settings → Pages → source "GitHub Actions"; set the
  repository About website field to the Pages URL; verify the deployed URL in
  a browser.
