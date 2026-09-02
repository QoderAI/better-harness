# Docs navbar brand truncation

## Traceability

- Spec ID: docs-navbar-brand-truncation
- Story: #133
- Status: Implemented

## Intent

At 1280px the docs site navbar shows `Better Har…` instead of `Better Harness`.
The brand is a primary identity landmark, so laptop widths must keep the full
title readable without hiding Docs, Inspector, Blog, or search.

Keep the existing Infima desktop navbar. Do not replace it with a hamburger at
1280px, and do not change the product name.

## Acceptance Scenarios

- AC-1: At 1280×800 the navbar brand text is exactly `Better Harness`, with no
  ellipsis and no clipped glyphs. The same holds at 1366×768.
- AC-2: At 1280px the desktop navbar still shows Docs, Inspector, Blog, Demo
  Report, search, locale, and GitHub. It does not collapse to the mobile menu.
- AC-3: Compact laptop widths still keep the brand fully visible. If nav items
  need space, shrink item padding or search width before truncating the title.
- AC-4: The 996px mobile breakpoint is unchanged. Below it, the hamburger may
  hide desktop links, but the brand title remains `Better Harness`.
- AC-5: Keyboard focus, overflow, and console/page errors stay clean on the
  homepage navbar at 1280px, 1024px, and 390px.

## Non-goals

- Redesigning the docs navbar or applying Studio DESIGN.md tokens to Infima.
- Removing Inspector `New`, locale, search, or GitHub items.
- Changing the 996px Docusaurus mobile breakpoint.
- Editing Studio, Inspector Workbench, or report chrome.

## Plan and Tasks

1. Keep `.navbar__brand` from shrinking (`min-width: auto` / `flex-shrink: 0`)
   and disable title overflow ellipsis on desktop.
2. Raise the compact-item media query from `max-width: 1250px` past 1280px so
   1280px laptops use the tighter padding and search width.
3. Leave `@media (max-width: 996px)` Inspector badge rules unchanged.
4. Verify with Playwright against the served docs site.

Decision rationale: Infima sets `.navbar__brand { min-width: 0 }` and
`.navbar__title` uses `text--truncate`. The current compact query stops at
1250px, so 1280px still uses full padding and the brand loses. Protect the
title first, then reclaim space from items and search.

## Test and Review Evidence

- AC-1/AC-2/AC-3: Playwright at `http://127.0.0.1:3000/better-harness/` with
  viewport 1280×800 and 1366×768. Brand text `Better Harness`,
  `scrollWidth <= clientWidth`, desktop Docs/Inspector/Blog/Demo Report remain,
  hamburger `display: none`. Compact query now covers 997px–1400px.
- AC-4: 390×844 still uses hamburger (`display: flex`); brand text stays
  `Better Harness` with `overflow: visible`.
- AC-5: no console errors; screenshots under `.qoder/design-qa/docs-navbar/`.
- Focused: `npx vitest run test/docs-navbar-brand-truncation.test.mjs` (2 passed).
