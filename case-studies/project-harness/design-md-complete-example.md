---
version: alpha
name: Example Product
description: Complete generic DESIGN.md structure; replace illustrative values with inspected project evidence.
colors:
  primary: "#0F766E"
  primary-hover: "#115E59"
  on-primary: "#FFFFFF"
  text: "#111827"
  text-muted: "#4B5563"
  surface: "#FFFFFF"
  surface-subtle: "#F3F4F6"
  border: "#D1D5DB"
  focus: "#2563EB"
  danger: "#991B1B"
  danger-surface: "#FEF2F2"

typography:
  heading:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 24px
    fontWeight: 600
    lineHeight: 32px
    letterSpacing: 0px
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 16px
    fontWeight: 400
    lineHeight: 24px
    letterSpacing: 0px
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 20px
    letterSpacing: 0px
  caption:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 16px
    letterSpacing: 0px

rounded:
  sm: 4px
  md: 8px
  lg: 12px
  full: 9999px

spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.label}"
    rounded: "{rounded.md}"
    padding: "{spacing.sm} {spacing.md}"
    height: 40px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.on-primary}"
  text-input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "{spacing.sm} {spacing.md}"
    height: 40px
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.lg}"
    padding: "{spacing.lg}"
  helper-text:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text-muted}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
    padding: "{spacing.xs} {spacing.sm}"
  alert-error:
    backgroundColor: "{colors.danger-surface}"
    textColor: "{colors.danger}"
    typography: "{typography.body}"
    rounded: "{rounded.md}"
    padding: "{spacing.md}"
  avatar:
    backgroundColor: "{colors.surface-subtle}"
    textColor: "{colors.text}"
    typography: "{typography.label}"
    rounded: "{rounded.full}"
    size: "{spacing.xl}"
  section-heading:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    typography: "{typography.heading}"
    rounded: "{rounded.sm}"
  focus-indicator:
    backgroundColor: "{colors.focus}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.sm}"
    width: 2px
  divider:
    backgroundColor: "{colors.border}"
    textColor: "{colors.text}"
    rounded: "{rounded.sm}"
    height: 1px
---

# Example Product

## Overview

Use this file as a structural example only. Derive the real product character,
tokens, component states, and accessibility rules from inspected source files,
rendered UI, and approved design evidence. Record an inference as an inference;
mark unresolved policy `needs-design-decision`.

## Colors

- Use semantic roles such as `primary`, `surface`, and `danger`; do not introduce
  palette names such as `teal-500` into component guidance.
- Maintain at least WCAG AA contrast for normal text and visible focus states.
- Do not use color as the only carrier of error, success, or selection state.

## Typography

- Use `heading` for page or major section titles, `body` for primary reading,
  `label` for controls, and `caption` for secondary metadata.
- Preserve the documented line height and weight instead of selecting nearby
  values ad hoc.

## Layout

- Build spacing from the documented scale. Use `md` for ordinary component
  padding, `lg` between related sections, and `xl` for major page separation.
- Confirm narrow, regular, and wide viewport behavior from the real product.
- Responsive breakpoint policy: `needs-design-decision` until project evidence
  identifies the approved breakpoints.

## Elevation & Depth

- Use borders for ordinary grouping and add a project shadow token only when
  inspected evidence shows content elevated above another surface.
- Do not add shadows to compensate for unclear spacing or hierarchy.

## Shapes

- Use `sm` for compact fields and helpers, `md` for controls, `lg` for cards,
  and `full` only for circular or pill-shaped elements.
- Do not introduce one-off radii outside the documented scale.

## Components

- Primary buttons use the documented hover state and retain a visible keyboard
  focus indicator.
- Inputs pair labels, help text, and errors programmatically; placeholder text
  is not a label.
- Cards use border-first separation. Alerts pair semantic color with an icon,
  heading, or explicit text.
- Document loading, empty, error, disabled, selected, and focus-visible states
  whenever the corresponding component exists in the product.

## Do's and Don'ts

### Do

- Reuse semantic tokens and documented component variants.
- Verify representative rendered states, keyboard flow, contrast, and reduced
  motion behavior after changing the contract.
- Cite source files, screenshots, or approved design artifacts for inferred
  project-specific rules.

### Don't

- Do not invent brand colors, typefaces, breakpoints, or interaction policy.
- Do not copy the illustrative values in this example without project evidence.
- Do not treat a passing structural lint as visual or accessibility acceptance.
