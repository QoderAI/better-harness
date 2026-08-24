# Refine Harness Studio as a technical control room

## Traceability

- Spec ID: harness-studio-visual-redesign
- Status: Implemented

## Intent

Harness Studio should feel like a deliberate local developer workbench rather
than an unstyled collection of dense tables. The redesign keeps the existing
`Workspace -> Sessions -> Detail / Compare -> Artifacts` information
architecture, while establishing one coherent visual language across the shell,
empty states, docked panes, traces, comparisons, and loading feedback.

The direction combines the repository's VS Code-inspired docked workbench
contract with the verified `ui-ux-pro-max` recommendation for a minimal,
high-contrast developer tool: restrained dark surfaces, a supported light
alternative, semantic color, system typography, dense evidence rows, and subtle
motion. The generated FAQ layout, unbundled Web fonts, green primary CTA, and
scroll-reveal effects do not fit the product and are intentionally excluded.

## Acceptance Scenarios

- **AC-1:** A fresh Studio load uses the dark technical-control-room theme. A
  labelled title-bar control switches between dark and light themes, persists
  the local preference, and exposes its current state to assistive technology.
- **AC-2:** Shared semantic tokens own both themes. Studio components introduce
  no one-off colors, fonts, radii, shadows, or motion durations outside the
  approved token source, and docked regions remain flat and edge-to-edge.
- **AC-3:** The application shell has a clear hierarchy at first glance:
  product identity and top-level tools on the left, current context and scoped
  actions in the title bar, and one primary workspace surface. Selection,
  availability, hover, focus, pressed, and disabled states are distinguishable.
- **AC-4:** Overview and workspace-intake screens show one dominant next action,
  readable supporting context, and stable loading feedback without becoming
  card dashboards or decorative landing pages.
- **AC-5:** Session rows establish provider and observed time before prompt,
  keep compare selection separate from opening, and reveal a legible detail
  timeline. Dense metadata uses tabular figures where alignment matters.
- **AC-6:** Session Compare visually distinguishes the two evidence lanes using
  labels and semantic lane treatments, retains the explicit no-winner boundary,
  and keeps tables and tool sequences readable without color-only meaning.
- **AC-7:** Icons use the existing Phosphor family. Decorative icons are hidden
  from the accessibility tree; icon-only controls have an accessible name,
  state where applicable, visible focus, and a tooltip.
- **AC-8:** At 1440x900, 1024x768, 390x844, and 375x812, the primary decision is
  visible, the document has no horizontal overflow, panes use bounded local
  scrolling, and narrow controls provide at least 44px targets.
- **AC-9:** Keyboard navigation, 200% zoom/reflow, light-theme and dark-theme
  contrast, async live regions, and `prefers-reduced-motion` remain usable.
- **AC-10:** Playwright captures meaningful non-loading screenshots of Overview,
  workspace intake, Session browser, Session Compare, Artifact View, Bench,
  Live trial, and Evidence results, with no browser console or page errors.
- **AC-11:** When the server exposes project-workspace Session discovery and no
  workspace is connected, Studio opens with a non-dismissible modal workspace
  gate. The shell remains visible but inert and hidden from assistive
  technology; successful discovery removes the gate and opens Sessions.
  Preconfigured servers without workspace discovery keep their existing direct
  entry into the relevant workbench.

## Non-goals

- Changing the project-workspace and Inspector Session-discovery architecture.
- Introducing cards as the default container, gradients, glassmorphism, glow,
  illustration assets, emoji icons, or marketing-page sections.
- Loading Google Fonts, adding GSAP, or depending on network-hosted visual
  assets.
- Redesigning the separately owned Canvas artifact viewer rendered in its
  sandboxed iframe.
- Adding new data sources, evaluation semantics, or Session write-back.

## Plan and Tasks

### 1. Extend the visual source of truth

Record the verified dark/light palette, theme behavior, motion roles, and
control-room rationale in `DESIGN.md`. Keep the existing system font and
semantic evidence roles.

### 2. Rebuild shared visual primitives

Update `styles/tokens.css` with dark-default and light-theme mappings, theme and
motion roles, predictable focus/pressed/disabled states, and narrow target
sizes. Keep every surface mapped to shared tokens.

### 3. Refine shell and workspaces

Update the React shell and `styles/shell.css` / `styles/workbench.css` so the
brand, navigation, title bar, Overview, empty state, Sessions, detail timeline,
Compare, Artifact View, Bench, Live trial, and Evidence results share the same
hierarchy and density.

### 4. Add explicit theme control

Add a local, accessible dark/light toggle in the title bar. Apply the theme
before meaningful paint where practical and preserve the user's selection
without involving the server.

### 5. Validate the actual product

Build Studio, run behavioral tests, exercise all changed surfaces with
Playwright, inspect console/page errors, verify overflow/focus/reduced motion,
and visually review the required screenshots before marking this spec
implemented.

## Test and Review Evidence

- AC-1/AC-2: theme-state unit/browser assertions plus parsed token/style-source
  checks for approved semantic roles and absence of one-off visual literals.
- AC-3/AC-4: Playwright shell, Overview, empty-state, hover/pressed/disabled,
  and single-primary-action checks.
- AC-5/AC-6: Session browser and Compare interaction tests and screenshots in
  both themes, including independent checkbox/open behavior and no-winner copy.
- AC-7: role/name/state assertions, keyboard focus checks, and icon ownership
  review.
- AC-8: overflow and screenshot checks at all four required viewport sizes.
- AC-9: reduced-motion, 200% zoom/reflow, keyboard order, live-region, and
  measured foreground/background contrast checks.
- AC-10: full Studio Playwright suite with captured screenshots and empty
  console/page-error collections.
- AC-11: server capability assertion plus Playwright dialog, inert-shell,
  responsive screenshot, loading-state, and post-selection navigation checks.

### Recorded validation

- `npm run typecheck` and `npm run build` in `packages/harness-studio` passed.
- `npm test` in `packages/harness-studio` passed 18 files and 121 tests.
- `npm run test:browser` in `packages/harness-studio` passed all 16 Playwright
  scenarios, including the real provisioned `deck.pptx` Canvas viewer.
- Playwright verified 1440x900, 1024x768, 390x844, and 375x812 layouts,
  theme persistence, rendered foreground/background contrast of at least 4.5:1,
  keyboard focus, reduced motion, bounded scrolling, and no page-level
  horizontal overflow.
- Screenshots were visually reviewed for Overview, workspace intake and loading,
  Session browser, Session Compare, Artifact View, Bench, Live trial, and
  Evidence results. Browser console and page-error collections were empty.

### Risks

- Dark-theme muted text and semantic states can appear polished while missing
  WCAG contrast. Measure actual rendered pairs rather than reviewing hex values
  by sight.
- A global token change affects every Studio surface. Validate Bench, Live
  trial, Evidence results, and artifact code/diff previews in addition to the
  new Session flow.
- Theme persistence can cause a flash or stale state if it is applied only after
  React mounts. Initialize the root theme deterministically and keep storage
  failure non-fatal.
- Embedded Inspector and Canvas viewers own separate rendering contexts. Do not
  claim theme parity inside an iframe unless that owner exposes a supported
  theme contract.
