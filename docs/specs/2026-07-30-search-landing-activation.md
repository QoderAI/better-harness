# Turn Search Visits into a Verified First Report

## Traceability

- Spec ID: `search-landing-activation`
- Status: Implemented

## Intent

Help a search visitor understand what Better Harness is, see the concrete
report outcome, choose the correct Coding Agent path, and reach that host's
verified installation and invocation instructions without guessing. Keep the
GitHub README concise enough to act as the repository landing page while using
the Docusaurus site as the richer activation surface.

The current site already separates Codex Desktop and CLI entrypoints, provides
sample-report exits, and meets the existing hero contrast contract. This change
builds on those fixes instead of replacing them.

The canonical capability registry now supports eight Coding Agent hosts. Six
have verified public Quickstart paths; Pi and WorkBuddy remain adapter-level
support surfaces with different install and end-to-end evidence boundaries.
The landing page must show all eight without flattening those support levels.

## Acceptance Scenarios

- SLA-AC-1: The English and Simplified Chinese home pages expose a descriptive,
  localized page title and outcome-led H1 that identify Better Harness as an
  open-source AI coding workflow review tool. The copy states that findings are
  tied to visible evidence and does not promise behavior, privacy, or causal
  improvement that the repository cannot prove.
- SLA-AC-2: The hero places a real Better Harness report preview beside the
  product explanation, provides an in-page primary action to choose a Coding
  Agent, retains a secondary action to the checked-in sample report, and shows
  a compact trust line for the MIT license, host-specific setup, and explicit
  missing-evidence boundary. The layout remains readable at desktop and mobile
  widths, in light and dark themes, without introducing autoplaying media.
- SLA-AC-3: The home-page host section has a stable `choose-host` anchor and
  eight cards matching the canonical capability registry. The six verified
  public Quickstart hosts identify their installation mode, report output, and
  setup action before linking to the matching installation tab and heading.
  Pi and WorkBuddy identify their adapter-level support and link to bounded
  support details instead of claiming the same verified Quickstart status.
  Codex remains one card but exposes Desktop and CLI surfaces; Qoder keeps its
  Canvas-output distinction.
- SLA-AC-4: The report section explains the four concrete parts of an actionable
  finding—visible evidence, prioritized impact, bounded repair, and acceptance
  checks—and routes readers to the self-contained sample without duplicating
  the same report image below the fold. Historical trend copy continues to say
  that recorded movement is not causal proof of improvement.
- SLA-AC-5: `README.md` and `README.zh-CN.md` use outcome-led opening copy and a
  compact top navigation. The Chinese README links directly to the localized
  website, both website links identify GitHub as the referral source, and both
  Quick Start sections send readers to host-specific instructions instead of
  presenting one slash command as universal. Detailed installation remains in
  the existing per-host sections.
- SLA-AC-6: English source strings and `zh-Hans` translation keys remain
  structurally aligned for the metadata, hero, eight host cards, support-level
  actions, and report-proof content. Automated checks protect the descriptive
  title, host anchor, real hero media, eight-card registry, six-host
  installation-tab subset, README routing, and absence of a universal Quick
  Start invocation.
- SLA-AC-7: Focused docs tests, both locale builds, doc-link integrity, the full
  repository suite, package verification, whitespace checks, root preview
  health checks, and browser review of English and Simplified Chinese desktop
  and mobile home pages complete successfully. Browser review records console
  or page errors and retains screenshots for visual inspection.
- SLA-AC-8: The Installation page keeps its six verified host tabs focused on
  setup, while a compact developer path explains where to inspect all eight
  adapter boundaries, follow the new-host contribution workflow and its worked
  pull requests, and browse current repository pull requests. The same path is
  available in Simplified Chinese and does not imply that an open PR is an
  installable or verified integration.

## Non-goals

- Do not add analytics, telemetry, Search Console verification tokens, cookies,
  or a consent flow without a selected measurement provider and privacy
  decision.
- Do not create keyword-swapped host pages, FAQ pages, or other search-only
  pages before real Search Console query evidence exists.
- Do not change report scoring, evidence semantics, host installation commands,
  the six-host public Quickstart set, or the documented Pi and WorkBuddy
  readiness boundaries.
- Do not redesign the Docusaurus theme, report renderer, or navigation system.
- Do not edit GitHub repository metadata, deploy Pages, publish packages, or
  change external state in this implementation slice.

## Plan and Tasks

1. Update the home-page metadata and reshape the existing hero with the checked-
   in report preview, trust line, and host-selection anchor while preserving the
   current Canvas-derived colors, radius, shadows, and accessibility behavior.
2. Render all eight canonical host adapters with setup mode, output type, and
   support level. Keep the six verified hosts on the installation-tab contract;
   route Pi and WorkBuddy to their public support boundaries.
3. Replace the duplicated report screenshot in the lower demo section with a
   four-part explanation of the report and a visible sample-report action.
4. Add paired Simplified Chinese translation keys and keep the Chinese prose
   natural rather than mechanically mirroring English word order.
5. Tighten both README openings and remove the remaining universal Quick Start
   prompt while preserving detailed, host-specific installation sections.
6. Connect the Installation page to the adapter matrix, contribution workflow,
   worked pull-request examples, and current pull-request list without
   interrupting the regular six-host setup flow.
7. Extend focused source-contract tests, build both locales, run repository and
   package checks, then review the rendered result at desktop and mobile sizes.

## Test and Review Evidence

- SLA-AC-1 through SLA-AC-6: extend and run
  `node --test test/docs-site.test.mjs test/docs-dx.test.mjs test/docs-entrypoints.test.mjs`.
- SLA-AC-5 and markdown routing: run
  `node --test test/doc-link-graph.test.mjs`; regenerate the graph only if the
  test reports a stale route.
- SLA-AC-6 and SLA-AC-7: run `npm ci && npm run build` inside `docs/` so both
  locales build with broken-link failures enabled.
- SLA-AC-7: run root `npm test`, `npm run pack:verify`, `git diff --check`, then
  start `npm run preview` and check `/health` and `/canvas-module.js`.
- SLA-AC-2 through SLA-AC-4: use Playwright against the built or development
  site at desktop and 390-pixel mobile widths for English and Simplified
  Chinese. Inspect light/dark themes, host-anchor navigation, sample-report
  navigation, console errors, page errors, overflow, and visible focus states.

## Prior Implementation Evidence

- After fast-forwarding `main` to `59ceb99`, `node --test
  test/docs-site.test.mjs test/docs-dx.test.mjs
  test/docs-entrypoints.test.mjs test/docs-blog.test.mjs`: 24 tests passed,
  including the newly added Blog integration coverage.
- `node --test test/doc-link-graph.test.mjs`: 6 tests passed and the generated
  routing graph remained current.
- `npm run build` in `docs/`: optimized English and Simplified Chinese builds
  completed, and both builds emitted the self-contained sample-report route.
- Root `npm test`: 1,003 tests passed. `npm run pack:verify` passed with 343 npm
  package entries and 366 runtime zip entries. `git diff --check` passed.
- Root `npm run preview` returned `ok` from `/health` and served the transformed
  module from `/canvas-module.js`.
- Browser review covered 1,920-by-1,061 desktop and 390-by-844 mobile viewports,
  English and Simplified Chinese, and light and dark themes. The English mobile
  review exposed a long sample-report button that caused 146 pixels of
  horizontal overflow; the responsive button rule was corrected and the
  repeated measurement reported zero overflow. The mobile host action landed
  on `#choose-host` below the fixed navbar and exposed all six single-column
  cards. No site-origin console or page errors were observed.
- Local visual artifacts retained for review include English and Chinese
  desktop captures, both 390-pixel mobile heroes, and the mobile host-card
  landing capture. These are verification artifacts, not committed site assets.
- Ranking, search snippets, deployed-page behavior, and search-to-first-report
  conversion remain unobserved because this slice does not deploy the site or
  add a measurement provider.

## Observed Extension Evidence

- `node --test test/docs-site.test.mjs test/docs-dx.test.mjs
  test/docs-entrypoints.test.mjs test/docs-blog.test.mjs`: 25 tests passed,
  including the eight-card registry, six-tab Quickstart subset, bilingual
  support matrix, and Installation-to-PR contribution path.
- `node --test test/doc-link-graph.test.mjs`: 6 tests passed with the generated
  routing graph current. `npm run build` in `docs/` completed optimized English
  and Simplified Chinese builds.
- Root `npm test`: 1,004 tests passed. `npm run pack:verify` passed with 343 npm
  package entries and 366 runtime zip entries. `git diff --check` passed.
- Root `npm run preview` returned `ok` from `/health`; `/canvas-module.js`
  served the transformed Canvas module.
- Browser review covered English and Simplified Chinese at 1,920-by-1,061
  desktop and 390-by-844 mobile viewports, plus the Simplified Chinese
  Installation page. Both locales rendered eight cards as four-by-two desktop
  grids and single-column mobile lists, with six `quickstart` and two `adapter`
  states, zero horizontal overflow, and no site-origin console warnings or
  errors. Light and dark themes were inspected.
- The Installation developer path preserved six setup tabs, linked the eight-
  adapter support matrix and current pull-request list, and navigated to the
  contribution guide where PR #6 and PR #22 were present as worked examples.
- Visual review artifacts are retained under
  `/Users/phodal/.codex/visualizations/2026/07/30/019fb352-80d6-7983-9aec-610333c69b39/expanded-host-landing-review/`;
  they are not committed site assets.

## Risks

- **Hero overload:** adding proof and trust content can make the first viewport
  harder to scan. Mitigation: keep one outcome-led H1, one short lead, two
  actions, three trust facts, and one real product image.
- **Largest-contentful-paint regression:** moving the report preview above the
  fold can improve comprehension while increasing initial image cost.
  Mitigation: reuse the existing optimized checked-in PNG with intrinsic
  dimensions, eager priority only for that image, and lazy loading below fold.
- **Bilingual drift:** new host metadata and product claims can diverge across
  locales. Mitigation: pair translation keys and assert both the key set and
  host-card structure.
- **Support-level collapse:** showing eight cards can imply that every host has
  the same install and report-loop maturity. Mitigation: keep verified
  Quickstart and adapter support visible in each card, route them differently,
  and preserve the six-host installation-tab subset in tests.
- **Contribution-state ambiguity:** an open or historical pull request can be
  mistaken for shipped host support. Mitigation: keep PR links inside a clearly
  labeled developer path and make the canonical adapter matrix the support
  source of truth.
- **Search-result uncertainty:** descriptive metadata can improve relevance but
  cannot guarantee ranking or snippet changes. Mitigation: treat search impact
  as unobserved until a verified Search Console property provides query/page
  evidence.
