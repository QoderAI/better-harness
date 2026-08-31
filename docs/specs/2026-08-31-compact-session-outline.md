# Make the Session outline compact and decision-first

## Traceability

- Spec ID: compact-session-outline
- Status: Implemented

## Intent

Reduce the default vertical footprint of the read-only Session outline so the
Usage and context decision appears in the first viewport without removing Cell
navigation, Process controls, evidence filters, or Session metadata. Keep the
standalone Inspector and React Studio surfaces aligned.

## Acceptance Scenarios

- AC-1: At desktop width, the outline uses one compact pane header and one
  toolbar row for Cell navigation plus Expand/Collapse actions; it does not
  repeat a separate Cells heading above those controls.
- AC-2: Evidence filters and full Session facts remain keyboard-accessible
  disclosures. Session facts are collapsed by default, while their summary
  still identifies the runtime and primary model.
- AC-3: The default Usage and context summary begins within 210 px of the
  outline's top edge at wide layout, with no horizontal overflow.
- AC-4: Compact and narrow layouts preserve visible focus, reachable controls,
  and the existing 44 px narrow touch targets without document overflow.
- AC-5: Standalone Inspector and React Studio render the same outline hierarchy
  and behavior.

## Non-goals

- Changing retained Session evidence, Usage calculations, filters, Replay, or
  the Session notebook stream.
- Removing facts or controls from the outline.
- Redesigning the full Usage report.

## Plan and Tasks

1. Restructure the shared outline markup into a compact header, one controls
   row, and a collapsed Session facts disclosure.
2. Update the shared Inspector stylesheet for wide, compact, and narrow modes.
3. Keep React labels localized and preserve existing accessible action names.
4. Extend browser and visual-contract checks with default disclosure and
   decision-position assertions.

## Test and Review Evidence

- AC-1/AC-2/AC-5: a real 300-call Codex Session rendered the compact standalone
  outline with full accessible action names, collapsed Session facts, and the
  same runtime/model summary as React Studio. Studio typecheck and build passed;
  the updated browser assertions ran successfully before that long scenario's
  final console-cleanliness check reported pre-existing duplicate React keys
  (`A1` and `call:A1`) outside this change's key ownership.
- AC-3: real-report measurements at 1440x900 and 1024x768 placed Usage and
  context 167 px below the outline top with zero outline or document overflow.
- AC-4: at 390x844 the minimum outline control height was 44 px, with zero
  outline or document overflow. Wide, compact, and narrow screenshots were
  visually reviewed.
- `npx vitest run test/reporting/harness-inspector.test.mjs`: 39 passed.
- Studio model suite: 6 passed after a successful build.
- `node scripts/harness-inspector/visual-contract-check.mjs`: all 18 surfaces
  passed across 1440x900, 1024x768, and 390x844 with no low text, clipping,
  horizontal overflow, or browser errors.
- Documentation link graph: 8 passed. Preview `/health` returned `ok` and
  `/canvas-module.js` loaded. `git diff --check` passed.
- Risk: compressing the toolbar can clip localized labels. Use short visible
  labels with the existing full accessible names and verify English and Chinese
  at the supported layout boundaries.
