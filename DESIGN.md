---
version: macos
name: Better Harness Studio
description: Visual design contract for Studio, interactive reports, and other Better Harness product surfaces.
colors:
  primary: "#0A5FD0"
  primary-hover: "#0850B0"
  primary-soft: "#E8F1FE"
  on-primary: "#FFFFFF"
  text: "#1D1D20"
  text-muted: "#54545C"
  text-subtle: "#5E5E66"
  canvas: "#DCDCE1"
  sidebar: "#EEEEF2"
  workspace: "#FFFFFF"
  panel: "#FFFFFF"
  surface: "#FFFFFF"
  titlebar: "#F0F0F4"
  statusbar: "#EEEEF2"
  surface-subtle: "#EFEFF3"
  surface-hover: "#E8E8ED"
  surface-active: "#D9D9E0"
  surface-selected: "#DFDFE6"
  border: "rgba(15, 23, 42, 0.13)"
  border-strong: "rgba(15, 23, 42, 0.24)"
  focus: "#0A5FD0"
  success: "#0C6B44"
  success-surface: "#E4F5EC"
  warning: "#7A4900"
  warning-surface: "#FCEFDA"
  danger: "#B32B36"
  danger-surface: "#FCE9EB"
  candidate: "#5F35B8"
  candidate-surface: "#F2EEFB"
  categorical-1: "#165F92"
  categorical-2: "#63449F"
  categorical-3: "#445466"
  categorical-4: "#106355"
  categorical-5: "#7F5009"
  categorical-6: "#486522"
  categorical-7: "#5F5768"

themes:
  # Studio is a desktop application, so it follows the host appearance until the
  # reader chooses otherwise. Only an explicit choice is stored; a resolved
  # appearance is never written back, or the app would stop following the system
  # after one load. `fallback` applies when the host expresses no preference.
  default: system
  fallback: dark
  light:
    source: colors
    selection: "rgba(10, 95, 208, 0.20)"
    overlay: "rgba(20, 28, 40, 0.34)"
    scrollbar: "rgba(15, 23, 42, 0.26)"
    scrollbar-hover: "rgba(15, 23, 42, 0.42)"
    overlay-shadow: "0 32px 64px -16px rgba(15, 23, 42, 0.22), 0 8px 20px -8px rgba(15, 23, 42, 0.12)"
    popover-shadow: "0 12px 32px -8px rgba(15, 23, 42, 0.16), 0 2px 8px -2px rgba(15, 23, 42, 0.10)"
  dark:
    primary: "#63A8FF"
    primary-hover: "#82BAFF"
    primary-soft: "#1B3054"
    on-primary: "#0A1524"
    text: "#F2F2F5"
    text-muted: "#BEBEC9"
    text-subtle: "#B2B2BD"
    canvas: "#0F0F12"
    sidebar: "#1D1D21"
    workspace: "#28282D"
    panel: "#2E2E34"
    surface: "#36363D"
    titlebar: "#313137"
    statusbar: "#1D1D21"
    surface-subtle: "#191A1D"
    surface-hover: "#3C3C44"
    surface-active: "#45454D"
    surface-selected: "#3A3A43"
    border: "rgba(233, 240, 255, 0.11)"
    border-strong: "rgba(233, 240, 255, 0.20)"
    focus: "#77B4FF"
    success: "#4FDCA4"
    success-surface: "#10352A"
    warning: "#F7C46A"
    warning-surface: "#3B2A14"
    danger: "#FF929A"
    danger-surface: "#421C26"
    candidate: "#C9ADFF"
    candidate-surface: "#2B2246"
    categorical-1: "#7CBCEC"
    categorical-2: "#B298F7"
    categorical-3: "#A0B1C6"
    categorical-4: "#6ED7C4"
    categorical-5: "#ECB36C"
    categorical-6: "#A8CD78"
    categorical-7: "#C9B0C0"
    selection: "rgba(99, 168, 255, 0.30)"
    overlay: "rgba(6, 6, 9, 0.62)"
    scrollbar: "rgba(233, 240, 255, 0.20)"
    scrollbar-hover: "rgba(233, 240, 255, 0.34)"
    overlay-shadow: "0 32px 64px -16px rgba(0, 0, 0, 0.66), 0 8px 20px -8px rgba(0, 0, 0, 0.48)"
    popover-shadow: "0 12px 32px -8px rgba(0, 0, 0, 0.56), 0 2px 8px -2px rgba(0, 0, 0, 0.40)"

surface-ramp:
  order: [canvas, sidebar, workspace, panel, surface]
  chrome: [titlebar, statusbar, surface-subtle]
  rule: >-
    Two axes, deliberately separate. The content ramp is an ordered elevation
    ramp read back to front: a region closer to the reader takes a later step and
    never borrows a step to look different. Chrome materials are not ramp steps —
    a toolbar is lighter than the content below it — so each is measured against
    the content it borders rather than forced onto the ramp. Structure comes from
    these two plus hairlines, never from a new hue.
  minimum-step: 1.12
  minimum-step-rule: >-
    Where two regions meet with a ramp step and no hairline, the step must reach
    1.12:1 so the boundary is visible. Where a hairline carries the boundary, the
    two sides may share a value: in light, `panel` and `surface` are both white.
    A ramp whose whole span is under about 1.3:1 reads as one unfinished slab,
    which is what the previous palette did at 1.19:1.
  enforced-by: packages/harness-studio/test/design-tokens.test.ts

typography:
  # Body sits at 13px, the size a macOS control label uses, so a workbench reads
  # as an application rather than as a document. `metadata` is the floor for
  # meaningful text. Headings tighten as they grow, so large type reads as one
  # shape rather than as spaced letters.
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 26px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: -0.021em
  page-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 20px
    fontWeight: 600
    lineHeight: 26px
    letterSpacing: -0.016em
  section-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 23px
    letterSpacing: -0.011em
  subhead:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0em
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0em
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 16px
    letterSpacing: 0em
  pane-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.006em
  metadata:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0em
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 18px
    letterSpacing: 0em

weights:
  regular: 400
  medium: 500
  semibold: 600
  bold: 700

rounded:
  # macOS shapes controls more generously than a 5px chamfer. Docked panes and
  # tables stay square; `md` and `lg` are reserved for surfaces that float.
  none: 0px
  xs: 6px
  sm: 8px
  md: 10px
  lg: 14px
  full: 9999px

elevation:
  docked: none
  popover: "{themes.*.popover-shadow}"
  overlay: "{themes.*.overlay-shadow}"

spacing:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 24px
  xxl: 32px
  xxxl: 48px

sizing:
  control-height: 30px
  toolbar-target: 28px
  pane-header: 34px
  row: 28px
  # A source-list row is one line: icon, name, trailing slot. Nothing that costs
  # a second line belongs in it.
  navigation-row: 30px
  navigation-row-touch: 44px
  # The window's unified toolbar is tall and carries the OS window controls; a
  # workbench's own toolbar sits inside the work area and stays compact.
  titlebar: 52px
  workbench-bar: 44px
  statusbar: 28px
  sidebar-width: 236px
  sidebar-inset: 8px
  secondary-pane-width: 312px
  touch-target: 44px

motion:
  press: 90ms
  fast: 130ms
  enter: 180ms
  layout: 160ms

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    borderColor: "transparent"
    typography: "{typography.label}"
    fontWeight: "{weights.semibold}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xs} {spacing.md}"
    height: "{sizing.control-height}"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.label}"
    fontWeight: "{weights.medium}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xs} {spacing.md}"
    height: "{sizing.control-height}"
  panel:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.text}"
    rounded: "{rounded.none}"
    elevation: "{elevation.docked}"
    padding: "{spacing.md}"
  segmented-control:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "0"
    height: "{sizing.control-height}"
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border-strong}"
    typography: "{typography.body}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xs} {spacing.sm}"
    height: "{sizing.control-height}"
  menu:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border}"
    rounded: "{rounded.sm}"
    elevation: "{elevation.popover}"
  dialog:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.md}"
    elevation: "{elevation.overlay}"
  status-inline:
    backgroundColor: "transparent"
    textColor: "{colors.text-muted}"
    typography: "{typography.metadata}"
    rounded: "{rounded.none}"
    padding: "0"
  data-table:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "{spacing.sm} {spacing.md}"
  numeric-cell:
    textAlign: "right"
    fontVariantNumeric: "tabular-nums"
  pane-header:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text}"
    typography: "{typography.pane-title}"
    rounded: "{rounded.none}"
    padding: "0 {spacing.md}"
    height: "{sizing.pane-header}"
  list-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.none}"
    padding: "{spacing.xs} {spacing.sm}"
    minHeight: "{sizing.row}"
  list-row-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.text}"
  focus-indicator:
    outlineColor: "{colors.focus}"
    outlineWidth: 2px
    outlineOffset: 1px
    rounded: "{rounded.xs}"
  application-canvas:
    backgroundColor: "{colors.workspace}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
  # A macOS source list, replacing the tinted-text-plus-leading-border model.
  # The row is inset from the sidebar edge so its selection reads as a rounded
  # row rather than a full-bleed band.
  source-list-row:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "0 {spacing.sm}"
    marginInline: "{sizing.sidebar-inset}"
    height: "{sizing.navigation-row}"
  source-list-row-selected:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    fontWeight: "{weights.semibold}"
  source-list-row-selected-unfocused:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.text}"
  status-bar:
    backgroundColor: "{colors.statusbar}"
    textColor: "{colors.text-muted}"
    typography: "{typography.metadata}"
    borderColor: "{colors.border}"
    rounded: "{rounded.none}"
    padding: "0 {spacing.md}"
    height: "{sizing.statusbar}"
  helper-text:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-subtle}"
    typography: "{typography.metadata}"
    rounded: "{rounded.xs}"
    padding: "{spacing.xs} {spacing.sm}"
  divider:
    backgroundColor: "{colors.border}"
    height: 1px
  control-outline:
    borderColor: "{colors.border-strong}"
    rounded: "{rounded.xs}"
    width: 1px
  status-success:
    backgroundColor: "transparent"
    textColor: "{colors.success}"
    typography: "{typography.metadata}"
    rounded: "{rounded.none}"
    padding: "0"
  status-warning:
    backgroundColor: "transparent"
    textColor: "{colors.warning}"
    typography: "{typography.metadata}"
    rounded: "{rounded.none}"
    padding: "0"
  status-danger:
    backgroundColor: "transparent"
    textColor: "{colors.danger}"
    typography: "{typography.metadata}"
    rounded: "{rounded.none}"
    padding: "0"
  candidate-lane:
    backgroundColor: "{colors.candidate-surface}"
    textColor: "{colors.candidate}"
    typography: "{typography.label}"
    rounded: "{rounded.none}"
    padding: "{spacing.xs} {spacing.sm}"
---

# Better Harness Studio

## Overview

Better Harness Studio is a technical evidence workbench. It should feel like a
calm, precise control room: the current decision and next action are obvious,
while traces, checkpoints, costs, and runtime metadata remain available without
competing for attention.

This file is the visual source of truth for `packages/harness-studio` and for
interactive Better Harness reports that do not have a narrower approved design
contract. Product semantics and information architecture remain owned by the
relevant spec and implementation. This contract governs hierarchy, typography,
color, density, component appearance, interaction states, and visual review.

The `macos` token set replaces the `beta` palette, type scale, shape scale, and
density. `beta` had already replaced `alpha`, but it kept a flaw `alpha`
introduced: its surface ramp was not perceptible. Measured, `canvas` to
`sidebar` was 1.017:1, `sidebar` to `titlebar` 1.013:1, and the whole ramp spanned
1.190:1 — while every text pair passed AA. The layout separates several regions
with a ramp step and no rule, so an imperceptible ramp erased the structure and
the workbench read as one unfinished slab. That is a measurable defect, not a
matter of taste, and no contrast fix could reach it.

`macos` re-anchors the ramp on graphite rather than near-black, separates chrome
materials from the content ramp, and raises density to native control sizes. The
same ramp now spans 1.596:1 and its tightest unruled boundary is 1.139:1. The
roles did not change; their values and the model behind them did.
`packages/harness-studio` implements the `macos` set, and
`packages/harness-studio/test/design-tokens.test.ts` holds it to those measured
floors so the ramp cannot quietly flatten again. Other surfaces — notably the
standalone Harness Inspector report under `scripts/harness-inspector/ui/` — still
carry earlier values and are migration targets, not evidence of alignment.

## Reference model: a native macOS application window

Use the structure of a native macOS document application as the reference: one
unified toolbar that reaches the top of the window and carries the OS window
controls, a source-list sidebar, one main content area, an optional inspector or
secondary pane, and a status bar along the bottom. These are edge-to-edge
regions separated by 1px hairlines or resize sashes, not cards placed on a page
canvas.

What this changes in practice:

- The window is frameless, so the application's own toolbar reaches the top and
  the OS controls are inlaid into it. There is no separate native title bar
  strip above the app. In the browser the same shell renders without that
  inlay, because a tab has no window controls to reserve room for.
- A source list is one line per row, inset from the sidebar edge, and its
  selected row is filled with the accent color and set in `on-primary` — not
  marked by a 2px leading border and tinted text.
- The status bar is a permanent region, not a transient message area. It gives
  the shell a bottom boundary and reports the current scope and retained counts.
- Controls take native metrics: 13px labels, 30px controls, 28px rows. Density
  is part of looking like an application.

This is a structural reference, not a request to imitate Apple's applications or
to adopt macOS-only affordances. Studio also runs in a browser and on Windows and
Linux, where the same regions render with that platform's window controls.
Studio deliberately follows the docked, no-shadow branch of this model: fixed
work regions stay flat, and elevation is reserved for transient UI that actually
floats above them.

Primary references:

- [Apple HIG: The macOS windows and toolbars guidance](https://developer.apple.com/design/human-interface-guidelines/toolbars)
- [Apple HIG: Sidebars, including source lists](https://developer.apple.com/design/human-interface-guidelines/sidebars)
- [Apple HIG: Layout and standard control metrics](https://developer.apple.com/design/human-interface-guidelines/layout)
- [Apple HIG: Color, including system accent and semantic roles](https://developer.apple.com/design/human-interface-guidelines/color)
- [Electron frameless windows and window controls](https://www.electronjs.org/docs/latest/tutorial/custom-title-bar)
- [WCAG 2.2 contrast requirements](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)

## Product character

- Prefer restrained, technical, and legible over decorative, playful, or
  dashboard-like.
- Prefer panes, rows, tabs, toolbars, and editor views over cards. A card is an
  exception for an independent object that must move, compare, or stand alone;
  it is never the default content wrapper.
- Let evidence carry the visual interest. Chrome and containers should stay
  neutral so status, diffs, and comparison lanes remain meaningful.
- Use ordinary product language. Avoid invented scientific language, excessive
  all-caps labels, and decorative jargon.
- Use Phosphor icons already owned by Studio. Do not use emoji, text glyphs, or
  improvised SVGs as interface icons.

## Theme and visual direction

- Studio follows the host appearance. With no stored choice it takes the system's
  light or dark setting, tracks a change to it while running, and falls back to
  the dark technical-control-room theme when the host states no preference. An
  explicit choice from the labelled title-bar control outranks the host and is
  the only value stored; a resolved appearance is never written back, or the
  application would stop following the system after one load. Theme choice is
  local presentation state, not server or Session evidence.
- Both themes map the same semantic roles, and neither is a tinted copy of the
  other. Light puts content on white with the frame receding behind it; dark
  rests on graphite, not near-black, because a ramp needs room to move in both
  directions before a single step can be seen.
- The visual style is minimal and grid-led: an ordered surface ramp, alpha
  hairlines, a blue interaction role, and semantic evidence colors. It may borrow
  the discipline of Swiss minimalism, but it must not turn Studio into a landing
  page, card dashboard, or decorative terminal pastiche.
- Restraint is not the same as coarseness. Flat, square, and neutral describe the
  composition, not the craft: a surface step must be visible, a hairline must
  read as a hairline rather than a drawn box, a control must look deliberately
  shaped, and the type scale must have a usable middle. A surface that looks
  unfinished fails this contract as surely as a decorated one.
- Use the system UI stack in both themes. Generated recommendations for Web fonts
  such as IBM Plex Sans or JetBrains Mono are references only; do not load them
  unless the files are deliberately bundled and cross-platform tested.
- Do not add glow, gradients, glass surfaces, or scroll-reveal choreography.
  Hover, pressed, disclosure, pane, and loading transitions must explain state
  and use the shared motion roles.
- Measure dark and light contrast independently. A token name that passed in one
  theme is not proof that its mapped value passes in the other.

## Information hierarchy

Every surface must answer one primary question:

- **Bench:** what is held constant, what changes, and is the comparison ready?
- **Live trial:** what is happening now, what needs attention, and where is the
  active evidence?
- **Evidence results:** what is the verdict, is the evidence sufficient, and
  what trade-off produced it?

Structure each surface in this order:

1. Page context and one sentence describing the decision.
2. The primary state or task, with at most one visually dominant action.
3. Supporting evidence, controls, and metadata.

Show a surface switcher once per viewport. Do not repeat Bench / Live trial /
Evidence results navigation in both the application shell and the page body.
Do not repeat the same run status in a banner, row, sidebar, and footer unless
each occurrence enables a different action.

Use progressive disclosure for runtime detail. The central work area is primary;
execution trees, checkpoint lists, and state inspectors are secondary panes that
may collapse or become drawers. An empty or unavailable secondary pane must not
occupy more attention than the active task.

## Typography

- Use the documented system UI stack across macOS, Windows, and Linux. `Inter`
  is not part of the stack unless the font files are deliberately bundled and
  tested on every supported platform.
- Use monospace only for code, hashes, identifiers, paths, timestamps where
  alignment matters, and numeric trace data. Product copy and navigation stay
  in the UI font.
- Do not render meaningful text below `metadata` (12/16). Dense mode reduces
  spacing before it reduces type size.
- The scale has a usable middle. `subhead` (15/22) carries view titles and pane
  headings that are more than a label but less than a section; reach for
  `display` only when a surface genuinely leads with one statement, and never to
  compensate for a page that is otherwise all 12px.
- Headings tighten as they grow, using the documented `letterSpacing` per role,
  so large type reads as one shape rather than spaced letters. Body, label, and
  metadata roles track at zero; `pane-title` is the one role that opens up,
  because it is set small and semibold.
- Weight carries hierarchy before size does. Body copy is regular; a `label` is
  medium; a selected navigation item, pane title, or section heading is
  semibold. Reserve bold for the verdict, one primary action, or a genuinely
  exceptional state; do not make every `strong`, button, and navigation item
  bold, and do not use semibold as the default weight for ordinary rows.
- Use sentence case. Uppercase is allowed only for short eyebrows or compact
  machine-state badges, never for ordinary section titles or paragraphs. An
  eyebrow must earn its line: do not stack an eyebrow, a title, and a trailing
  caption on a header that describes a six-row list.
- Do not use a global `!important` rule to force one size onto paragraphs,
  labels, buttons, code, and `strong` elements. Each semantic role owns its
  documented type token.

## Color

- Blue is the interaction color: primary actions, selected navigation, links,
  and keyboard focus.
- Green, amber, and red are semantic state colors for success, caution/waiting,
  and failure. Pair every colored state with text or an icon; color is never the
  only signal.
- Violet identifies the Candidate comparison lane. It is not a second primary
  action color.
- The `categorical` scale identifies members of a data dimension that carries no
  judgement, such as tool family or chart lane. It is a fixed ordered scale: a
  surface maps its taxonomy onto it and does not invent hues. A categorical
  color must never equal an interaction or state token, must stay perceptually
  offset from the state hues, and is always redundant with a lane, label, or
  legend. Do not read success, caution, or failure into a categorical color.
- Use neutral borders and surface shifts for structure. Do not assign a new hue
  merely to distinguish another panel or hierarchy level. Two lanes that carry
  no verdict — a left and right Session, an A and B column — are positions, not
  evidence roles: give them the same neutral surface and let the labels and the
  column split distinguish them. Reaching for the interaction blue and the
  Candidate violet to mean "left" and "right" states a judgement the data does
  not support.
- Structure is carried by the surface ramp first and a hairline second. Borders
  are alpha over their surface, not a fixed gray: one divider token then reads
  correctly on the canvas, on a panel, and on a selected row. Do not give every
  nested region its own solid rule — if two regions already differ by a ramp
  step, they usually do not also need a border.
- Text and controls must meet WCAG 2.2 AA contrast against their actual surface.
  Muted text is supporting content, not a way to hide essential information.
  Measure `text-subtle` against the busiest surface it lands on — a hovered or
  selected row — not against the canvas, and re-measure both themes whenever a
  neutral moves.

## Spacing, shape, and depth

- Use the spacing scale. Related items are separated by `sm` or `md`; component
  padding uses `md` or `lg`; major regions use `xl` or more.
- Docked regions meet edge to edge. Separate the title bar, sidebars, workspace,
  panels, rows, and sections with a background shift, a 1px divider, or a resize
  sash; do not place gutters around them to make them look like floating cards.
- Docked panes, tables, list regions, and editor groups use `rounded.none`.
  Controls and source-list rows use `xs` (6px) or `sm` (8px). `md` (10px) and
  `lg` (14px) are reserved for floating dialogs, menus, quick picks,
  notifications, or exceptional standalone objects. The control radius is a
  deliberate shape, not a hairline chamfer: a 1–2px radius reads as an unstyled
  default and is below this scale.
- Depth is a two-step system and both steps belong to transient surfaces.
  `elevation.popover` lifts a menu, quick pick, or notification; `elevation.overlay`
  lifts a modal dialog above a dimmed workbench. `elevation.docked` is `none`,
  and shadows stay forbidden on docked panes, rows, buttons, tabs, tables, empty
  states, and ordinary content groups. A shadow must disappear with the surface
  that earned it.
- A required first-run workspace chooser may use one centered floating dialog
  above the dimmed workbench. It has one primary action, keeps the underlying
  shell inert, cannot be dismissed into an unusable empty application, and
  replaces itself with stable discovery progress until the workspace opens.
- `full` radius is limited to a numeric count or circular target. Status text,
  evidence roles, filters, and navigation do not become pills by default.
- Compact desktop text controls are 30px high and toolbar targets are at least
  28px square. Pane headers are 34px, dense data rows 28px, and source-list
  navigation rows 30px on one line. The window's unified toolbar is 52px because
  it carries the OS window controls; a workbench's own toolbar is 44px, and the
  status bar is 28px. At narrow or touch-oriented layouts, targets — including
  navigation rows — grow to at least 44px.
- Focus is drawn outside the control, at `outlineOffset: 1px`, so it stays
  visible on a filled primary button and on a row whose own edge is a hairline.
  An inset focus ring that disappears into a filled control does not satisfy
  this contract.
- Neutral date-range fields use a single 2px inset focus edge, clearly visible
  against the surface, to avoid doubling their enclosing frame. Keep the native
  select and date inputs; place icons inside the preset and group From/To as two
  aligned rows. Custom mode displays its values once, in those fields.

## Layout and density

- Wide mode is above 1080px, compact mode is 760–1080px, and narrow mode is
  below 760px. These modes follow the existing Studio layout boundaries and
  may be revised only with browser evidence at all three widths.
- Wide workbenches may use three regions, but the central evidence surface must
  retain at least half of the usable width. Side regions must collapse before
  central content becomes unreadable.
- Prefer resizable docked panes with independently scrolling content. Keep the
  active pane title and toolbar visible; do not make the whole page a tall stack
  of repeated session containers.
- Never allow a paragraph to collapse into one-word or character-wide columns.
  Define minimum content widths, wrap at phrase boundaries, or make the bounded
  data region scroll horizontally.
- Use comfortable density for setup, summaries, and empty states. Dense rows
  are reserved for traces, call trees, diffs, and data tables; they still honor
  the typography floor and target-size rules.
- Avoid fixed viewport-height layouts when they strand large empty regions or
  hide the decision below the fold. Prefer local scrolling only for panes whose
  headers and context remain visible.
- The shell itself is a fixed frame: the toolbar, sidebar, and status bar hold
  their positions and content scrolls inside its own region. The window does not
  scroll as a page, and no region ends in bare canvas because its content ran
  out — a pane either fills its height or the region reports why it is empty.
- In a desktop shell the window is frameless, so the toolbar is also the window's
  drag region and every interactive control inside it opts out of dragging. The
  edge that carries the OS window controls reserves room for them: leading on
  macOS, trailing on Windows and Linux. When the layout narrows and the toolbar
  no longer has room to spare, that reserved space moves to the region that still
  does, rather than pushing the application's own controls off-screen.

## Components

### Navigation

- The product rail owns top-level tools. The primary sidebar lists objects in
  the active tool. Tabs own open views of those objects in the workspace. These
  levels must not duplicate one another.
- A segmented control is only for a small, mutually exclusive property switch;
  it is not top-level navigation and should not sit inside a pill-shaped shell.
- Selection uses a filled or soft-blue state plus an `aria-current` or selected
  semantic. A focused source list fills its active row with `primary` and sets it
  in `on-primary`; `surface-selected` is the unfocused selection. Do not mark
  selection with a leading border and tinted text, and do not ask `primary` to
  read as body text on `surface-selected` — it cannot reach AA there.
- A source-list row is one line: icon, name, and one trailing slot. Prose that
  needs a second line belongs in the tooltip, the status bar, or the view itself.
  Availability uses a labelled status, not a colored dot alone; when a row shows
  it, the word goes in the trailing slot.
- The status bar is a permanent region along the bottom of the shell. It reports
  the current scope, the active view's status, and retained counts. It is not a
  transient message area, and it does not repeat the toolbar's navigation.
- Studio owns the observation range in its primary sidebar. Sessions and Artifacts
  consume that range and show loading, empty, or error feedback as evidence is
  refreshed; they do not add a second calendar or Date tab. The calendar rules
  below apply to the standalone Inspector. Studio starts inside its shell with
  an inline welcome region when no project is connected, never a modal gate.
- View rows display their names without implementation maturity badges; retain
  real evidence coverage and error states in the view that owns them.
- Date scope uses a compact calendar grid with weekday alignment, a visible
  month and time zone, and one active date. Follow meeting-calendar conventions:
  keep date cells numeric, mark activity with a subtle dot, and show explicit
  session and commit counts for the active day below the grid. Do not compress
  counts into unexplained abbreviations such as `2s` or `9c`.
- In Date mode, keep the calendar at the top of the sidebar and use the remaining
  sidebar space for flat Session navigator rows from the selected day. A row
  locates its Session in the workspace; do not duplicate the calendar or turn
  the workspace into a second schedule view.

### Actions and forms

- One primary action per task region. Secondary actions use neutral styling;
  destructive actions use the danger role and require clear copy.
- Put workspace-wide actions in the title bar, view-wide actions in the pane
  toolbar, and item actions on the row or in its context menu. Do not repeat one
  command at all three levels.
- Show no more than three view-toolbar actions and two inline row actions. Put
  less frequent commands in an overflow or context menu and keep their labels
  and enablement consistent everywhere.
- Disabled controls explain the prerequisite near the control. If an entire
  control group is unavailable, show the prerequisite once instead of a wide
  banner plus multiple disabled buttons.
- Icon-only controls require an accessible name and a visible tooltip on hover
  or focus when the icon is not universally understood.

### Panels, inspectors, and empty states

- A pane has one compact title bar: one view name, optional count or state, and
  its scoped actions. It does not also need a card title, eyebrow, subtitle,
  badge, timestamp, and repeated object type.
- A list row has one primary label, at most one short description, and one
  trailing metadata/state area. Put shared dates or categories in group headers
  instead of repeating them as a heading inside every row.
- A session list should read as rows in a sidebar or table. Selecting a session
  reveals its detail in the workspace; the detail view owns the full prompt,
  activity, and commit panes. Do not expand a miniature three-column dashboard
  inside every session row.
- In a Session row, put the provider and observed start time before the title;
  they establish source and chronology before prose. In Session Detail, keep
  the top bar to product identity, one-line title, view tabs, and Close. Put
  runtime, model, duration, turns, calls, edits, and token availability in the
  right-hand facts pane instead of repeating them under the title.
- Inspector panes use definition-list alignment for stable facts and expandable
  sections for verbose payloads. Long identifiers use copy affordances and
  middle truncation; prose should wrap normally.
- Harness Inspector does not maintain a global “Selected evidence” state or
  evidence Drawer. Scope navigation, **Open session**, local disclosure, and
  chart inspection own their actions directly; clicking passive labels or rows
  must not create a second hidden selection model.
- Harness Inspector is a read-only evidence viewer, not a session-resumption
  surface. Do not generate or expose a continuation packet from Session Detail.
- Empty states name what is missing, why it matters, and the single next action.
  They should not look like completed results. A missing input reports the flag
  or command that supplies it; a list of rows that all read "Not supplied" with
  no remedy is an inventory, not an empty state.
- An item with nothing retained collapses to its title row. Rendering its lanes
  as three empty sections repeats a full dashboard for every absent scope, buries
  the items that do carry evidence, and reads as a completed result.
- A boundary claim — what a pause does and does not stop, what the viewer may
  not assume — is stated once, in the pane that owns it. Do not restate it in a
  tree footer, a timeline footer, and an inspector note; a claim repeated in
  three chrome slots is decoration, and it is what forces a sentence into a
  narrow column where it wraps two words at a time.

### Tables and comparison lanes

- Lead Evidence results with a decision summary: verdict, evidence sufficiency,
  quality delta, and cost guardrail. Raw aggregate and trial tables are the
  supporting layer.
- Keep labels left-aligned and numeric columns right-aligned with tabular
  numerals. Freeze the header in locally scrolling tables when rows exceed the
  visible region.
- A numeric column is marked, never inferred from its position. A rule such as
  "every cell after the first is right-aligned" pushes text columns to the wrong
  edge and leaves headers floating away from their values. Mark the cell and its
  header with the shared `numeric-cell` role so both align together.
- Bound a comparison's value columns. Two `1fr` columns spread a three-digit
  count across half the viewport and stop reading as a pair.
- Reference, Baseline, and Candidate are evidence roles, not generic container
  colors. Use role labels in addition to blue/violet accents.
- Truncation must preserve the distinguishing suffix or offer the full value on
  focus/hover. Never let status copy or summary prose break into vertical words.

## Interaction model

### Selection, opening, and disclosure

- Single click selects a row and updates the adjacent preview/detail pane. It
  must not also expand the row, run a command, or navigate away.
- `Enter` or an explicit **Open** command opens the selected object as a durable
  workspace tab. Double-click may be an accelerator for the same command, but
  it is never the only way to open something.
- A disclosure chevron only expands or collapses its own children. Its hit area
  and accessible name are separate from row selection and from **Open**.
- `Escape` closes the topmost transient surface or clears a temporary mode; it
  must not discard persisted filters, evidence, or edits without confirmation.

### Keyboard and focus

- Every command available by pointer is reachable by keyboard. Use natural Tab
  order between workbench parts; use arrow keys within tab lists, toolbars,
  trees, and listboxes so each composite contributes one Tab stop.
- In lists and trees, Up/Down moves the active row, Left/Right collapses or
  expands hierarchy when present, `Enter` opens, and Space toggles a checkbox or
  explicit selection control. Do not overload Space on ordinary navigation rows.
- Every interactive element has a visible `:focus-visible` treatment using the
  focus token. Focus, selection, hover, active, disabled, and unavailable are
  distinct states and cannot be expressed by color alone.

### Commands and contextual actions

- Each user action has one command definition: stable id, verb-first label,
  handler, visibility condition, enablement condition, and optional shortcut.
  Toolbars, row actions, context menus, and a future command palette invoke the
  same command rather than implementing parallel behavior.
- Hide actions that are irrelevant to the current object. Disable an action only
  when seeing it teaches a useful prerequisite, and explain that prerequisite.
- Hover may reveal secondary row actions only if focus reveals the same actions.
  Essential state and the primary next action remain visible without hover.

### Resize, feedback, and motion

- Resize sashes show a hover/focus affordance and remain keyboard operable.
  Persist user-adjusted pane sizes only after the layout is stable across wide,
  compact, and narrow modes.
- Keep layout transitions at 160ms or less. Respect `prefers-reduced-motion` by
  removing non-essential movement and smooth scrolling.
- Announce asynchronous run, pause, error, and verdict changes through the
  appropriate live-region semantics; visual color changes alone are not enough.

## Implementation alignment

- Project tokens must be exposed as shared CSS custom properties before adding
  new visual variants. Surface-specific aliases may reference the shared roles;
  they must not fork a second palette or type scale.
- A standalone report may carry a literal copy of the palette so it opens
  offline. When that report is embedded in Studio — including inside a shadow
  root — the host owns the theme: keep only the declarations that already
  resolve through `var()` and let the literals inherit. An embedded pane that
  renders its own light palette inside a dark shell is a defect, not a variant.
- Keep component CSS out of `index.html` as the system is migrated. Split tokens,
  shell primitives, and feature styles into owned files or modules so visual
  rules have an inspectable source.
- Do not add one-off hex colors, font sizes, weights, radii, or shadows when an
  existing token expresses the role. Add or revise a token here only when a new
  semantic role is genuinely required.
- The palette floors in `surface-ramp` are enforced by
  `packages/harness-studio/test/design-tokens.test.ts`, which parses the token
  file and measures the ratios. Revising a ramp value means revising that test
  with the measurement that justifies it, not deleting the assertion.
- A test asserting appearance names the token it depends on and resolves it in
  the page. A literal `rgb(...)` pinned in a test restates one theme's palette,
  so it fails on any legitimate revision while proving nothing about the
  relationship the design actually requires.
- Loading, empty, error, partial, running, paused, completed, and unavailable
  states must be visually and textually distinct without inventing product
  semantics absent from runtime evidence.

## Accessibility and visual review

- Review wide (1440×900), compact (1024×768), and narrow (390×844) layouts.
  At each width, confirm the primary question and action are visible, the page
  has no document-level horizontal overflow, and bounded tables/diffs remain
  usable.
- Check keyboard order, focus visibility, landmark and heading order, accessible
  control names, state announcements, 200% zoom/reflow, and reduced motion.
- For visual changes, use Playwright against the built preview, inspect browser
  console and page errors, and save screenshots of every changed surface in
  meaningful non-loading states. For Studio that means Bench, Live trial, and
  Evidence results; for an interactive report it means each view a reader can
  reach without leaving the page.

## Do and do not

**Do**

- Make the verdict, active run, or setup decision the first thing users see.
- Use a restrained neutral canvas and reserve color for action, state, and
  evidence identity.
- Build the shell from docked regions and the content from rows or editor views.
- Make selection, opening, disclosure, and commands visibly distinct.
- Let users collapse secondary evidence while preserving the current scope.
- Prefer fewer, stronger labels and larger readable type over dense decoration.
- Separate regions with a ramp step first and a hairline second.
- Give an absent input its remedy — the flag, the command, or the control that
  supplies it — on the same row that reports it missing.
- Let an embedded surface inherit the active theme instead of shipping its own
  copy of the palette.

**Do not**

- Duplicate navigation or status merely to fill a header.
- Use a card grid as the default information architecture, or give every object
  its own rounded title block and embedded dashboard.
- Make the whole row, its chevron, and its **Open** action perform the same or
  overlapping behavior.
- Render meaningful text below the `metadata` floor, use broad `!important`
  readability overrides, or use an unbundled font name.
- Give every nested region a border, radius, shadow, badge, and uppercase label.
- Present a plain data dump as a decision screen or a decorative dashboard as
  evidence.
- Open a workbench with a landing-page hero: a display headline and one button
  filling a region, above rows set at a third of its size.
- Lead a surface with a slogan. `Observe → Promote`, `Evidence before defaults`,
  and `Local control plane` state a position, not the state of this workspace.
- Use the interaction blue or the Candidate violet as a container color for two
  lanes the data does not rank.
- Leave a docked region's remaining height as bare canvas below its last row.
