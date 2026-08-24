---
version: beta
name: Better Harness Studio
description: Visual design contract for Studio, interactive reports, and other Better Harness product surfaces.
colors:
  primary: "#1B5CC8"
  primary-hover: "#164EAD"
  primary-soft: "#EAF1FE"
  on-primary: "#FFFFFF"
  text: "#1B2430"
  text-muted: "#5A6676"
  text-subtle: "#5C687A"
  canvas: "#F2F4F7"
  titlebar: "#FFFFFF"
  sidebar: "#F7F9FB"
  workspace: "#FFFFFF"
  panel: "#FFFFFF"
  surface: "#FFFFFF"
  surface-subtle: "#F6F8FA"
  surface-hover: "#EFF2F6"
  surface-active: "#E3E8EF"
  surface-selected: "#E3EDFD"
  border: "rgba(15, 23, 42, 0.11)"
  border-strong: "rgba(15, 23, 42, 0.22)"
  focus: "#1E6FE0"
  success: "#0F7048"
  success-surface: "#E6F6EE"
  warning: "#85500E"
  warning-surface: "#FDF0DC"
  danger: "#B23640"
  danger-surface: "#FDEAEC"
  candidate: "#6941B8"
  candidate-surface: "#F3EFFB"
  categorical-1: "#1C6699"
  categorical-2: "#6B4BB0"
  categorical-3: "#4A5B6E"
  categorical-4: "#136B5E"
  categorical-5: "#8A5710"
  categorical-6: "#4F6E27"
  categorical-7: "#665D6F"

themes:
  default: dark
  light:
    source: colors
    selection: "rgba(27, 92, 200, 0.18)"
    overlay: "rgba(20, 28, 40, 0.40)"
    scrollbar: "rgba(15, 23, 42, 0.24)"
    scrollbar-hover: "rgba(15, 23, 42, 0.40)"
    overlay-shadow: "0 24px 56px -16px rgba(15, 23, 42, 0.24), 0 4px 12px -4px rgba(15, 23, 42, 0.12)"
    popover-shadow: "0 12px 28px -10px rgba(15, 23, 42, 0.18), 0 2px 6px -2px rgba(15, 23, 42, 0.10)"
  dark:
    primary: "#5A97FF"
    primary-hover: "#7CADFF"
    primary-soft: "#12233F"
    on-primary: "#061225"
    text: "#E8ECF3"
    text-muted: "#9BA6B7"
    text-subtle: "#8C97A9"
    canvas: "#08090C"
    titlebar: "#0C0E12"
    sidebar: "#0A0C10"
    workspace: "#101319"
    panel: "#14181F"
    surface: "#191E26"
    surface-subtle: "#0E1116"
    surface-hover: "#1F252F"
    surface-active: "#272E3A"
    surface-selected: "#14294A"
    border: "rgba(233, 240, 255, 0.09)"
    border-strong: "rgba(233, 240, 255, 0.18)"
    focus: "#7FB4FF"
    success: "#46D3A3"
    success-surface: "#0C2A21"
    warning: "#F0B667"
    warning-surface: "#33230F"
    danger: "#FF7B87"
    danger-surface: "#3A1620"
    candidate: "#B99CFF"
    candidate-surface: "#241C3C"
    categorical-1: "#6FB3E8"
    categorical-2: "#A98CF5"
    categorical-3: "#94A6BD"
    categorical-4: "#5FD0BC"
    categorical-5: "#E6A85E"
    categorical-6: "#9DC46B"
    categorical-7: "#C0A5B6"
    selection: "rgba(90, 151, 255, 0.28)"
    overlay: "rgba(3, 5, 9, 0.70)"
    scrollbar: "rgba(233, 240, 255, 0.16)"
    scrollbar-hover: "rgba(233, 240, 255, 0.30)"
    overlay-shadow: "0 24px 56px -16px rgba(0, 0, 0, 0.72), 0 4px 12px -4px rgba(0, 0, 0, 0.56)"
    popover-shadow: "0 12px 28px -10px rgba(0, 0, 0, 0.66), 0 2px 6px -2px rgba(0, 0, 0, 0.48)"

surface-ramp:
  order: [canvas, sidebar, titlebar, workspace, panel, surface]
  rule: >-
    Surface roles are an ordered elevation ramp read back to front. A region that
    sits closer to the reader takes a later step; a region never borrows a step
    to look different. Structure comes from this ramp plus hairlines, never from
    a new hue.

typography:
  display:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 30px
    fontWeight: 600
    lineHeight: 38px
    letterSpacing: -0.022em
  page-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 22px
    fontWeight: 600
    lineHeight: 30px
    letterSpacing: -0.016em
  section-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 24px
    letterSpacing: -0.011em
  subhead:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 15px
    fontWeight: 600
    lineHeight: 22px
    letterSpacing: 0em
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0em
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 13px
    fontWeight: 500
    lineHeight: 18px
    letterSpacing: 0em
  pane-title:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 12px
    fontWeight: 600
    lineHeight: 16px
    letterSpacing: 0.01em
  metadata:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0em
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace"
    fontSize: 13px
    fontWeight: 400
    lineHeight: 20px
    letterSpacing: 0em

weights:
  regular: 400
  medium: 500
  semibold: 600
  bold: 700

rounded:
  none: 0px
  xs: 5px
  sm: 6px
  md: 10px
  lg: 12px
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
  control-height: 32px
  toolbar-target: 30px
  pane-header: 36px
  row: 30px
  navigation-row: 46px
  titlebar: 44px
  statusbar: 26px
  sidebar-width: 248px
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
  navigation-selected:
    backgroundColor: "{colors.surface-selected}"
    textColor: "{colors.primary}"
    typography: "{typography.label}"
    fontWeight: "{weights.semibold}"
    rounded: "{rounded.none}"
    padding: "{spacing.xs} {spacing.sm}"
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

The `beta` token set replaces the `alpha` palette, type scale, and shape scale.
The earlier values were structurally correct but rendered as an unfinished
wireframe: near-identical dark grays separated only by solid mid-gray rules,
2px radii on every control, and a single 32px display size above an otherwise
12–14px page. The roles did not change; their values did. `packages/harness-studio`
implements the `beta` set. Other surfaces — notably the standalone Harness
Inspector report under `scripts/harness-inspector/ui/` — still carry `alpha`
values and are migration targets, not evidence of alignment.

## Reference model: a docked VS Code workbench

Use the structure of the classic, docked VS Code workbench as the reference:
an application title bar, a primary sidebar, one main editor/workspace, an
optional secondary sidebar or bottom panel, and a status bar. These are
edge-to-edge regions separated by 1px rules or resize sashes, not cards placed
on a page canvas.

This is a structural reference, not a request to copy VS Code branding or every
current experiment. VS Code's source now also contains optional floating-panel
and shadow treatments. Better Harness deliberately follows the docked,
no-shadow branch: fixed work regions stay flat; elevation is reserved for
transient UI that actually floats above them.

Primary references:

- [VS Code user interface](https://code.visualstudio.com/docs/editing/userinterface)
- [VS Code UX Guidelines: containers and items](https://code.visualstudio.com/api/ux-guidelines/overview)
- [VS Code theme color roles](https://code.visualstudio.com/api/references/theme-color)
- [VS Code workbench layout source](https://github.com/microsoft/vscode/blob/main/src/vs/workbench/browser/layout.ts)
- [VS Code accessibility and keyboard navigation](https://code.visualstudio.com/docs/configure/accessibility/accessibility)

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

- The default appearance is the dark technical-control-room theme. A supported
  light theme maps the same semantic roles and remains available from a labelled
  title-bar control. Theme choice is local presentation state, not server or
  Session evidence.
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
  Controls use `xs` (5px) or `sm` (6px). `md` (10px) and `lg` (12px) are
  reserved for floating dialogs, menus, quick picks, notifications, or
  exceptional standalone objects. The control radius is a deliberate shape, not
  a hairline chamfer: a 1–2px radius reads as an unstyled default and is below
  this scale.
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
- Compact desktop text controls are 32px high and toolbar targets are at least
  30px square. Pane headers are 36px, dense data rows 30px, navigation rows 46px,
  and the title bar 44px. At narrow or touch-oriented layouts, targets are at
  least 44px.
- Focus is drawn outside the control, at `outlineOffset: 1px`, so it stays
  visible on a filled primary button and on a row whose own edge is a hairline.
  An inset focus ring that disappears into a filled control does not satisfy
  this contract.

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

## Components

### Navigation

- The product rail owns top-level tools. The primary sidebar lists objects in
  the active tool. Tabs own open views of those objects in the workspace. These
  levels must not duplicate one another.
- A segmented control is only for a small, mutually exclusive property switch;
  it is not top-level navigation and should not sit inside a pill-shaped shell.
- Selection uses a filled or soft-blue state plus an `aria-current` or selected
  semantic. Availability uses a labelled status, not a colored dot alone.
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
