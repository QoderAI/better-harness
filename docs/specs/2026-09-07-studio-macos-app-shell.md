# Rebuild Harness Studio as a macOS-native application shell

## Traceability

- Spec ID: studio-macos-app-shell
- Status: In progress

## Intent

Harness Studio reads as a web page rendered in dark mode, not as a desktop
application. The 2026-08-20 redesign established the correct *roles* — an
ordered surface ramp, alpha hairlines, one interaction hue, semantic evidence
colors — but the shipped values never made those roles perceptible, and the
shell kept a page-like composition: a landing-style hero, a full-width metric
band, two-line navigation rows, and a bare canvas below the last row.

This spec replaces the `beta` token set and the VS Code structural reference
with a macOS-native application model, and rebuilds the shell layout to match.

### Measured problem

The surface ramp is the contract's primary structural mechanism. As shipped it
is imperceptible — six named surfaces spanning 1.19:1 in total:

| boundary | shipped | rebuilt |
| --- | --- | --- |
| canvas → sidebar | 1.017 | 1.139 |
| sidebar → workspace | 1.052 | 1.145 |
| titlebar → workspace | 1.039 | 1.135 |
| workspace → panel | 1.045 | 1.087 |
| panel → surface | 1.063 | 1.126 |
| **canvas → surface (span)** | **1.190** | **1.596** |

Text contrast was never the defect: every shipped text/surface pair already met
AA. The defect is that no region boundary was visible, so the application had no
readable architecture and every pane looked like the same unfinished slab.

### Structural defects, each already contrary to DESIGN.md

- Overview opens with an eyebrow, a 22px display heading, and one lone button —
  the "landing-page hero" the contract forbids.
- Roughly 300px of bare canvas sits below the last Overview row, which the
  contract lists under **Do not**.
- `--statusbar-height` is defined but no status bar is rendered.
- Navigation rows are 46px two-line blocks, each carrying a colored availability
  dot with no accompanying label — availability by color alone.
- `ProjectSidebar` renders `t("sidebar.projects")`, a key absent from both
  locale bundles, so the raw key string is visible in the sidebar.

## Non-goals

- No change to information architecture ownership, routing, server contracts,
  discovery behavior, or evidence semantics.
- No new host adapter, and no change to the supported host set.
- No web font. The system UI stack stays; on macOS it already resolves to SF Pro.
- No translucency/vibrancy emulation via `backdrop-filter`. macOS materials are
  approximated with opaque ramp steps so contrast stays measurable.
- The standalone Harness Inspector report under `scripts/harness-inspector/ui/`
  keeps its `alpha` values and remains a separate migration target.

## Reference model change

The contract's reference moves from "docked VS Code workbench" to a macOS
document application (Finder, Mail, Xcode): a unified title bar plus toolbar, a
source-list sidebar with inset rounded selection, one content area, an optional
inspector on the trailing edge, and a status bar.

The consequential differences from the VS Code model:

- **Selection.** A macOS source list fills the active row with the accent color
  and uses `on-primary` text; the unfocused list keeps a neutral gray selection.
  This replaces the 2px left border plus tinted-text treatment, and it removes
  the requirement that `primary` read as text on `surface-selected` — a pair
  that cannot reach AA at either theme's chosen values.
- **Sidebar rows are inset.** Rows sit inside horizontal margins with `sm`
  radius rather than bleeding edge to edge.
- **The toolbar is a material, not a ramp step.** `titlebar` and `statusbar`
  leave the `canvas → sidebar → workspace → panel → surface` content ramp and
  become chrome roles measured against the content they border.
- **Single-line navigation rows.** Icon, label, and a trailing count; the
  subtitle and the unlabelled dot are removed.

## Acceptance Scenarios

- **AC-1:** Every boundary that the layout separates without a hairline reaches
  at least 1.12:1 in both themes: canvas→sidebar, sidebar→workspace,
  titlebar→workspace, statusbar→workspace, and surface-subtle→surface. The
  content ramp spans at least 1.35:1.
- **AC-2:** `text`, `text-muted`, and `text-subtle` each meet 4.5:1 against
  every surface they land on in both themes, including `surface-hover`,
  `surface-active`, and `surface-selected`. `primary` meets 4.5:1 on every
  neutral bed it is used as text or an icon on, and `on-primary` meets 4.5:1 on
  both `primary` and `primary-hover`.
- **AC-3:** `success`, `warning`, `danger`, and `candidate` meet 4.5:1 on
  workspace, surface, panel, surface-subtle, sidebar, and titlebar in both
  themes. The focus token reaches 3:1 against every region it is drawn over.
- **AC-4:** A repository check computes AC-1 through AC-3 from the shipped
  token file and fails on regression, so the palette cannot drift back to an
  imperceptible ramp.
- **AC-5:** The shell renders a macOS application layout: a unified title bar
  that owns workspace-wide controls, a source-list sidebar with inset
  single-line rows and accent-filled selection, one content area, and a status
  bar carrying the current scope and counts.
- **AC-6:** Overview leads with a compact document header — title, one-line
  detail, and its primary action on the trailing edge — not a hero band. Its
  heading text and the `Workspace summary` / `Recent Sessions` labels are
  unchanged so existing assertions still bind.
- **AC-7:** No surface leaves bare canvas below its last row. A region that
  runs out of content either fills to its boundary or ends at its content with
  the remaining space owned by an adjacent region.
- **AC-8:** Theme follows the host appearance via `prefers-color-scheme` when
  the reader has expressed no preference, and an explicit choice from the title
  bar still persists locally. Only an explicit choice is stored: a resolved
  appearance is never written back, so following the host survives a reload and a
  live system switch.
- **AC-9:** The sidebar heading renders a translated string in both locales; no
  raw i18n key is visible anywhere in the shell.
- **AC-10:** Availability is announced by a label, never by a colored dot alone.
- **AC-11:** Exactly three owned stylesheets ship, docked regions keep no
  shadow, no meaningful text renders below 12px, and the document has no
  horizontal overflow at 1440×900, 1024×768, and 390×844.
- **AC-12:** Keyboard order, focus visibility, roving tab lists, reduced motion,
  and 200% reflow remain intact; Playwright captures both themes at all three
  widths with no console or page errors.
- **AC-13:** A workbench's own toolbar does not inherit the window's unified
  toolbar height. The two are separate roles (`workbench-bar` and `titlebar`),
  and the inner one stays the shorter of the two.
- **AC-14:** `DESIGN.md` and `tokens.css` cannot drift: a repository check parses
  both and fails when a declared palette value, density metric, shape step, or
  type size is not the one that ships.
- **AC-15:** In the desktop shell the window is frameless — the application's own
  toolbar reaches the top of the window with the OS controls inlaid, the toolbar
  is the drag region, its interactive controls opt out, and the edge carrying
  those controls reserves room for them (leading on macOS, trailing elsewhere).

## Plan

1. Add `packages/harness-studio/test/design-tokens.test.ts` computing AC-1..AC-3
   from `src/app/styles/tokens.css`. Land it red.
2. Rewrite the `tokens.css` palette, shape scale, sizing, and type scale to the
   macOS values; turn the check green.
3. Update `DESIGN.md` front matter and the reference-model, color, spacing, and
   component prose to the macOS model.
4. Rebuild the shell in `shell.css` and `App.tsx` / `ProjectSidebar.tsx`:
   unified toolbar, inset source list, status bar, compact Overview header, no
   bare canvas. Fix the `sidebar.projects` key and the dot-only availability.
5. Align `workbench.css` to the new radius, density, and selection roles, and
   split the inner workbench toolbar off the window title-bar token (AC-13).
6. Follow the host appearance for the initial theme, storing only an explicit
   choice (AC-8).
7. Make the window frameless in `better-harness-desktop`, and reserve the window
   controls' edge in the app's toolbar (AC-15).
8. Add `test/governance/design-contract-tokens.test.mjs` so the contract and the
   token file cannot disagree (AC-14).
9. Verify: `build`, unit tests, browser tests, root tests, and screenshots of
   both themes at all three widths.

## Test and review evidence

- `npx vitest run packages/harness-studio/test/design-tokens.test.ts` — palette
  contract: 17 passed.
- `npx vitest run test/governance/design-contract-tokens.test.mjs` — contract and
  tokens agree: 73 passed.
- `npm run harness-studio:test` — unit suite: 526 passed (67 files).
- `npm run harness-studio:build && npm run harness-studio:test:browser` —
  rendered contract: 57 passed, no console or page errors.
- `npm test` — root suite: 1746 passed, 2 skipped (114 files).
- Screenshots: `.tmp/studio-after/<route>-<width>-<theme>.png` — 48 captures,
  8 routes × 3 widths × 2 host appearances. Measured across all of them: the app
  resolved to the host appearance every time, no document overflow, the status
  bar present everywhere.
- Frameless window: captured by `CGWindowID` (a window-scoped capture, so it
  cannot pick up anything else on screen) at
  `.tmp/studio-desktop/frameless-window.png`, with
  `-webkit-app-region: drag` on the toolbar, `no-drag` on its controls, a 78px
  leading inset, and no console errors.

## Defects found while implementing

- **The theme was persisted on every mount.** The effect that mirrored the theme
  to `data-theme` also wrote it to `localStorage`, so the first paint pinned
  whatever the host happened to be and Studio stopped following the system after
  one load. Following the host appearance lasted exactly one page view. Fixed by
  storing only an explicit choice; a new browser test covers both directions.
- **`availability-partial` was an unscoped class.** It set a `background`, which
  was correct for the status dot but painted a solid block behind the new text
  label. Scoped to `.availability-dot`.
- **Three browser assertions pinned literal `rgb(...)` values** from the previous
  palette. They restated one theme's palette rather than the relationship the
  design requires, so they failed on a legitimate revision while proving nothing.
  Rewritten to resolve the token in the page.
- **Inner workbench toolbars borrowed `--titlebar-height`.** Raising the window
  toolbar to 52px silently grew every workbench's own bar. Separated into
  `--workbench-bar-height`.
- **Two floating drawers had their offsets rewritten by that same split.** The
  experiment rail and the Debugger's tree/inspector drawers are `position: fixed`,
  so their `inset-block` offsets are viewport-relative and encode the *window*
  toolbar's height — the one role `workbench-bar` is not. A blanket token rename
  moved both 8px too high, so each covered the bar that opened it. Restored to
  `--titlebar-height` and `calc(--titlebar-height + --workbench-bar-height)`, and
  measured: the Debugger drawers now start at 96px, exactly the topbar's bottom
  edge. Found by code review, not by the suite — no test asserts drawer
  alignment, and the offsets are inside `@media` blocks the token checks skip.

## Risk

- **Broad CSS surface.** `workbench.css` is 2294 lines and consumes the tokens
  being revalued. Mitigated by changing token values rather than token names, so
  every consumer moves together, and by the rendered-contract browser assertions.
- **Selection model change.** Moving from tinted text to accent fill touches
  sidebar, tabs, trees, and list rows. Mitigated by the token check plus browser
  assertions on `aria-current` / `aria-selected` styling.
- **Assertion coupling.** `overview.spec.mjs` binds the Overview heading text
  and `tool-call.spec.mjs` pins exactly three stylesheets. Both constraints are
  preserved deliberately rather than by accident.
