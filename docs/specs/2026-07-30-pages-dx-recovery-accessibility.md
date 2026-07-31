# Make the Documentation Easier to Start and Recover

## Traceability

- Spec ID: `pages-dx-recovery-accessibility`
- Status: Implemented

## Intent

Help a new Better Harness user answer four questions without leaving the
documentation: what is required before installation, how to install and verify
the plugin for the chosen host, how to recover when that path fails, and where
to report a reproducible problem. Improve the landing page at the same time so
its product claims, sample-report language, motion, contrast, and loading
behavior do not undermine that first-use path.

This change keeps two support layers distinct. The repository has seven
capability-level host adapters, while the public Quickstart contains the six
hosts whose reader-facing installation path is already published. Pi remains
outside the public Quickstart until its full report loop has the evidence
required by the existing host-entrypoint contract.

## Acceptance Scenarios

- PDX-AC-1: English and Simplified Chinese documentation expose local search in
  the navbar and through the platform keyboard shortcut. Search works in the
  statically built GitHub Pages site without an external account, crawler, API
  key, or network request to a hosted search service. Queries can find headings
  and body content from the curated documentation pages in the active locale.
- PDX-AC-2: The Installation page in both locales begins with a Prerequisites
  section that distinguishes using a host plugin from developing or running the
  source checkout. It names Windows, macOS, and Linux support, requires a
  supported Coding Agent host, tells users to begin a new host task after an
  install or update, and records the standalone/source-development baselines from the
  repository contracts: Node.js `>=22.20.0 <25.0.0` and npm
  `>=10.9.3 <12.0.0`.
- PDX-AC-3: Every public Quickstart host tab—Claude Code, Codex, Qoder, Cursor,
  Qwen Code, and GitHub Copilot—contains an explicit verification step. The
  step uses an existing host-native inspection command where one is supported;
  otherwise it uses the smallest honest session-level discovery check and does
  not invent a CLI contract. Codex Desktop uses its current
  `@better-harness` entrypoint and Codex CLI uses
  `$better-harness:better-harness`; the site does not copy the slash-command
  contract from another host. The English and Simplified Chinese variants stay
  structurally aligned.
- PDX-AC-4: A Troubleshooting page exists in both locales under Getting
  Started. It covers unsupported runtime versions for source/CLI use, a plugin
  or Skill that is not visible after installation, host-specific discovery
  checks, source-local Cursor path mistakes, report output that cannot be
  found, session-evidence limitations, and how to collect bounded diagnostics.
  Recovery instructions avoid destructive cleanup and link back to the exact
  installation anchors where appropriate.
- PDX-AC-5: A visible `Report Issue` navbar item opens the repository's issue
  chooser. The Troubleshooting page links to the same chooser and asks for the
  host, operating system, Better Harness version, installation method, minimal
  reproduction, expected/actual behavior, and focused diagnostics already
  requested by the bug-report template. The template does not hard-code a
  drifting current version, includes all capability-level hosts, and offers
  installation methods that match the published host paths.
- PDX-AC-6: The landing page no longer claims that standalone Qoder CLI always
  needs no installation, and the demo CTA identifies the checked-in artifact as
  a sample rather than a live report. It does not present `/better-harness` as a
  universal six-host invocation when Codex and Copilot have different verified
  contracts. The primary Get Started path goes to the Installation page. These
  strings have matching Simplified Chinese translations.
- PDX-AC-7: The landing page does not autoplay an infinitely looping animation
  for longer than five seconds without a pause mechanism. It provides an
  equivalent static history image or user-controlled playback, preserves an
  explanatory caption, and respects reduced-motion preferences. Hero text and
  button combinations meet WCAG AA contrast in light and dark themes.
- PDX-AC-8: Below-fold landing-page images have intrinsic dimensions and lazy
  decoding/loading hints where appropriate, meaningful localized alternative
  text, and no layout regression at desktop or mobile widths.
- PDX-AC-9: Automated checks protect the search configuration, visible issue
  route, Prerequisites values, Troubleshooting route, six-host verification
  structure, accurate Qoder/sample copy, and accessible static history media.
  Focused tests, the regenerated documentation link graph, both Docusaurus
  locale builds, the repository test suite, package-boundary verification,
  whitespace checks, and browser checks complete successfully.
- PDX-AC-10: The published demo-report route contains a visible notice that it
  is a checked-in, bounded sample rather than a freshly generated live report.
  From the notice, readers can return to the Better Harness site or open the
  Installation page to run their own review. Those links remain correct under
  the GitHub Pages base path, and the underlying checked-in report artifact
  remains the source of the published sample.
- PDX-AC-11: The published architecture diagram no longer names only the four
  original hosts. It either depicts the current public Quickstart set and its
  capability-level boundary or uses host-neutral language that cannot drift as
  adapters are added. The public adapter matrix explains that seven adapters
  have capability declarations, six are public Quickstarts, and Pi is pending
  full report-loop evidence.

## Non-goals

- Do not add Pi to the public Quickstart or claim that capability-level support
  proves a complete user-facing report path.
- Do not create the full CLI command reference, configuration reference, FAQ,
  or upgrade/migration guide in this batch.
- Do not add Algolia or another hosted search service, analytics, telemetry, or
  credentials.
- Do not redesign the report renderer, publish a freshly generated live report,
  or change scoring and evidence semantics.
- Do not modify user-global plugin configuration, remove caches, delete reports,
  publish packages, or deploy GitHub Pages from this change.

## Plan and Tasks

1. Add a Docusaurus 3-compatible local-search integration to the isolated
   `docs/` package and configure it for English and Simplified Chinese builds.
2. Add paired Prerequisites and Troubleshooting content, route the new page
   through the Getting Started sidebar, and expose the existing GitHub issue
   chooser from the navbar.
3. Normalize the six public installation tabs around explicit verification
   steps using only repository- or host-contract-backed commands.
4. Correct the Qoder and sample-report homepage copy, point Get Started to
   Installation, and update paired translation keys.
5. Replace the uncontrolled history GIF presentation with an accessible static
   representation or explicit playback control. Add responsive image metadata,
   localized alternative text, reduced-motion behavior, and AA-safe hero
   styles.
6. Add provenance and navigation affordances to the materialized demo route,
   update the architecture visual and adapter-matrix support tiers without
   editing the checked-in report's analysis claims, and cover the asset sync
   contract with tests.
7. Add focused source-contract tests and update existing public-entrypoint
   checks without merging the six-host public set into the seven-host
   capability set.
8. Regenerate the documentation link graph and validate the static site,
   package boundaries, browser routes, search behavior, keyboard interaction,
   contrast-sensitive states, responsive layout, and console output.

## Test and Review Evidence

- PDX-AC-1, PDX-AC-6 through PDX-AC-11: focused documentation-DX tests with
  `node --test test/docs-dx.test.mjs test/docs-entrypoints.test.mjs`.
- PDX-AC-4: regenerate the routing graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then run
  `node --test test/doc-link-graph.test.mjs`.
- PDX-AC-1 through PDX-AC-9: run `npm ci && npm run build` inside `docs/` to
  build both locales with broken-link failures enabled.
- PDX-AC-7 and PDX-AC-8: serve the production build, inspect English and
  Simplified Chinese desktop/mobile routes with Playwright, exercise the search
  keyboard shortcut and a result navigation, inspect console/page errors, and
  retain screenshots for layout review.
- PDX-AC-9: run root `npm test`, `npm run pack:verify`, and
  `git diff --check`. Packaging verification must continue to exclude the
  Docusaurus package, cache, build, and static synchronization outputs.
- Before handoff, run Change Traceability Review in Review Readiness mode over
  the local diff and record any unobserved deployment or host-runtime evidence.

### Observed Implementation Evidence

- The focused documentation suite passed 33/33 checks across the link graph,
  DX contracts, site assets, public entrypoints, and support declarations.
- The full repository test suite completed successfully, and
  `npm run pack:verify` passed with 333 npm-package entries and 356 runtime-ZIP
  entries. `git diff --check` and the staged-diff whitespace check passed.
- A clean `npm ci` followed by the two-locale Docusaurus production build
  completed successfully. The generated English and Simplified Chinese search
  indexes contain the Prerequisites and Troubleshooting content.
- Production-browser checks exercised English and Simplified Chinese search,
  the keyboard shortcut, result navigation, the Cursor installation deep link,
  light and dark themes, a 390-pixel mobile viewport, and the sample-report
  exits under the GitHub Pages base path. No browser console or page errors were
  observed. This check exposed and then verified a fix for the sample route's
  no-trailing-slash base-path resolution.
- The root preview returned `ok` from `/health` and HTTP 200 from
  `/canvas-module.js` (86,836 bytes).
- CI, the deployed GitHub Pages site, and end-to-end installation/report loops
  in the six real hosts remain unobserved in this local implementation pass.

## Risks

- **Static search base-path or locale drift:** a search plugin can work in a
  development server yet produce broken links under `/better-harness/` or mix
  locales after a production build. Mitigation: exercise built English and
  Simplified Chinese routes under the production base URL.
- **Search dependency compatibility:** local-search packages often depend on a
  specific Docusaurus or React range. Mitigation: use the current published
  peer contract, lock it only in `docs/package-lock.json`, and require a clean
  two-locale production build.
- **Invented verification commands:** normalizing headings can accidentally
  imply every host exposes the same CLI inspection surface. Mitigation: use
  host-native commands only when evidenced and label session-level checks as
  discovery checks rather than package inspection.
- **Bilingual drift:** new English recovery guidance can silently leave the
  Chinese path incomplete. Mitigation: pair every new route, heading, string,
  and structural test across both locales.
- **Accessibility regression hidden by static checks:** source assertions do
  not prove focus behavior, rendered contrast, responsive layout, or search
  navigation. Mitigation: add browser interaction and screenshot evidence on
  the production build and keep deployment itself explicitly unobserved.
