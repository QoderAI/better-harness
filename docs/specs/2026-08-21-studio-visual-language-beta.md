# Rewrite the Studio visual contract and align the shell to it

## Traceability

- Spec ID: studio-visual-language-beta
- Status: Implemented

## Intent

The `alpha` visual contract was structurally right and materially wrong. Its
docked-workbench model, evidence roles, and interaction rules held up; its
rendered values did not. Five near-identical blue-blacks separated only by solid
mid-gray rules, a 2px radius on every control, a single 32px display size above
an otherwise 12–14px page, and semibold as the default weight produced a surface
that reads as an unfinished wireframe rather than a precision instrument.

This spec replaces the `alpha` token set with `beta` and migrates
`packages/harness-studio` onto it. The roles do not change — blue is still the
only interaction hue, violet still means Candidate, the categorical scale still
carries no judgement — but their values, the shape scale, the type scale, and
the depth model do. It also repairs the conformance gaps the new values exposed:
a landing-page hero on Overview, an embedded pane rendering its own light
palette inside the dark shell, empty lanes repeated for every unevidenced scope,
one boundary claim restated in three chrome slots, and comparison lanes borrowing
the interaction and Candidate hues to mean nothing more than "left" and "right".

## Acceptance Scenarios

- **AC-1:** `DESIGN.md` publishes a `beta` token set: an ordered surface ramp,
  alpha hairlines, a control radius that reads as a deliberate shape, a
  two-step depth model whose steps both belong to transient surfaces, a type
  scale with per-role tracking and a usable middle (`subhead`), and a `medium`
  weight. Every foreground/background pair in both themes meets WCAG 2.2 AA,
  measured against the busiest surface each foreground lands on.
- **AC-2:** `packages/harness-studio` renders entirely from those tokens. The
  two owned stylesheets contain no literal color, and no docked pane, row,
  button, tab, table, or empty state carries a shadow.
- **AC-3:** Overview leads with the decision and one primary action, not a
  display headline filling a region above rows a third its size. It carries no
  duplicate of the sidebar navigation and no second panel that is a filtered
  view of the first. Each input row names what the input unlocks and, when
  absent, the flag that supplies it.
- **AC-4:** The embedded Inspector workbench inherits Studio's active theme.
  Switching Studio to light or dark changes that pane with the rest of the
  shell, and its metric labels stay whole words at every layout mode. Only
  theme literals are inherited: the report keeps its own shape and metric
  scale, so adopting Studio's radii does not reshape a surface this spec does
  not migrate.
- **AC-10:** Every interactive control keeps an accessible name at every layout
  mode. A toolbar label hidden to save width is clipped, not removed, and a
  control strip that hosts a popup menu is never made a scroll container.
- **AC-5:** A scope that retained no prompt, tool call, or commit collapses to
  its title row instead of rendering three empty lanes.
- **AC-6:** A boundary claim appears once, in the pane that owns it. No sentence
  is placed in a column narrow enough to wrap two words per line.
- **AC-7:** Session comparison lanes use neutral surfaces. Neither the
  interaction blue nor the Candidate violet is used as a container color for
  lanes the evidence does not rank.
- **AC-8:** Numeric table columns are marked, not inferred from column position:
  headers align with their values, and text columns stay left-aligned.
- **AC-9:** At 1440×900, 1024×768, and 390×844, in both themes, every Studio
  surface renders with no document-level horizontal overflow, no console or
  page errors, and no text below the 12px floor.

## Non-Goals

- Migrating the standalone Harness Inspector report
  (`scripts/harness-inspector/ui/`) onto the `beta` values. It still ships the
  `alpha` palette as a literal copy so it opens offline; Studio now overrides
  its presentation only where the embedded pane is visibly wrong. The report
  remains a migration target.
- Changing Studio's information architecture. The
  `Workspace -> Sessions -> Detail / Compare -> Artifacts` model is unchanged.
- Adding product surfaces, evidence semantics, or runtime capability.

## Plan

1. Define the `beta` palette and verify AA contrast for every
   foreground/background pair in both themes before writing any CSS.
2. Rewrite `src/app/styles/tokens.css` as the single runtime source of the new
   values, keeping the existing custom-property names so the two feature
   stylesheets migrate without a rename pass.
3. Rewrite the visual sections of `DESIGN.md` — front-matter tokens, theme
   direction, typography, color, spacing/shape/depth — and record the
   conformance rules the migration surfaced.
4. Repair the conformance gaps: Overview lead and input inventory, embedded
   theme inheritance, unevidenced scope rows, duplicated boundary claims,
   comparison lane color, numeric column marking, narrow-mode title priority.
5. Update the browser contract test's docked-region selectors and the assertions
   that pinned `alpha` sizing values.

## Test and Review Evidence

- `npx vitest run` — 127 tests across 19 files pass.
- `npx playwright test` — 16 tests pass, including the rendered-contract
  assertions for docked shadows, the 12px type floor, document overflow, owned
  stylesheet count, and the wide/compact/narrow layout sweep.
- Contrast verification over the full `beta` palette: every foreground against
  every background surface, both themes, all pairs ≥ 4.5:1.
- Visual review against a real 100-Session workspace: 24 captures covering
  Overview, Sessions, Debugger, and Compare at 1440×900, 1024×768, and 390×844
  in both themes, saved under `.qoder/design-qa/studio-beta/`. The capture run
  reported no console errors, no page errors, and no document overflow.

## Risk

The token rewrite changes every Studio surface at once, including surfaces whose
evidence this repository cannot produce locally (live AG-UI runs against a real
adapter, provisioned Canvas viewers). Those paths are covered by the existing
Playwright fixtures rather than by the real-workspace capture, so a regression
there would surface as a test failure rather than in the review screenshots.
Sizing tokens moved (title bar 40→44px, secondary pane 304→312px, control
30→32px), so any downstream layout that pinned the `alpha` numbers needs the
same update the browser suite received.
