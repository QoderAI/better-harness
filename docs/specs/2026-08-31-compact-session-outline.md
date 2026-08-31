# Make the Session outline compact and decision-first

## Traceability

- Spec ID: compact-session-outline
- Status: Implemented

## Intent

Reduce the Session outline by removing low-value items inside its sections, not
by removing the sections themselves. Keep Cell navigation, the complete
historical Evidence filters, a small set of identifying Session facts, and then
the Usage and context decision. Preserve the original Evidence filters
disclosure interaction and contents; its collapsed default already prevents the
checkbox list from consuming initial height.
Keep the standalone Inspector and React Studio surfaces aligned.

## Acceptance Scenarios

- AC-1: `Read-only` and bulk Expand/Collapse are absent. The outline retains its
  pane title, Cell jump control, Evidence filters section, Session facts
  section, and Usage and context in that order.
- AC-2: Evidence filters preserves its original disclosure interaction: it is
  collapsed by default, opens from its summary by pointer or keyboard, and uses
  the existing bounded popover treatment at compact/narrow widths. Its expanded
  content restores Prompts, Results, Intermediate, Model usage, Commits, Tool
  calls, retained tool-name subtypes, and File paths with their historical
  counts. The original total-call count remains visible in the disclosure
  summary at wide layout.
- AC-3: Session facts is directly visible and contains exactly Runtime, Model,
  and Duration. It contains no Source, Turns, Tool calls, File edits, or
  Projection rows.
- AC-4: Every restored evidence and tool-name filter works independently, and
  each Process disclosure remains independently operable.
- AC-5: The default Usage and context summary begins within 230 px of the
  outline's top edge at wide layout, with no horizontal overflow.
- AC-6: Compact and narrow layouts preserve visible focus, reachable controls,
  and the existing 44 px narrow touch targets without document overflow.
- AC-7: Standalone Inspector and React Studio render the same outline hierarchy
  and behavior.

## Non-goals

- Changing retained Session evidence, Usage calculations, Replay, or the
  Session notebook stream.
- Restoring bulk Process controls or duplicated facts in another disclosure,
  menu, or pane.
- Redesigning the full Usage report.

## Plan and Tasks

1. Remove read-only status and bulk Process actions; retain one full-width Cell
   jump control.
2. Update the shared Inspector stylesheet for wide, compact, and narrow modes.
3. Restore the full historical filter disclosure and render three high-value
   Session facts in a compact always-visible row; remove only low-value facts.
4. Preserve corresponding React/standalone filter state and handlers.
5. Assert the restored Evidence filters disclosure, exact retained items,
   filter behavior, and decision position.

## Test and Review Evidence

- AC-1/AC-2/AC-3/AC-7: the focused Studio browser scenario confirmed the
  compact outline hierarchy, the original disclosure interaction, all 10
  fixture filters and counts, and standalone/Studio parity.
- AC-4: the focused Studio browser scenario confirmed independent Model usage,
  tool-name, Tool calls, Prompts, and File paths behavior. The regenerated
  standalone report also confirmed independent Model usage and Tool calls.
- AC-5/AC-6: the Studio browser scenario passed at 1440x900, 1024x768, and
  390x844 with the Usage offset within 230 px, no document/pane overflow, and
  44 px narrow filter/select targets. Its narrow disclosure popover remained
  within the viewport. Collapsed wide/compact/narrow and expanded narrow
  screenshots were visually reviewed.
- `npx vitest run test/reporting/harness-inspector.test.mjs`: 39 passed.
- Studio typecheck and build passed; the full Studio suite passed 512 tests;
  the focused Studio Inspector browser scenario passed.
- Standalone report regeneration succeeded. The full visual-contract run passed
  its first three wide surfaces, then stopped before Session Trace because
  concurrent activity-chart work requires a long idle scale-break fixture that
  this real report does not contain; no Session-outline failure was reported.
- Preview `/health` returned `ok`, `/canvas-module.js` loaded, and
  `git diff --check` passed.
- Risk: the restored filter list can be tall when expanded. It remains
  collapsed by default, and the compact/narrow popover is bounded and
  scrollable instead of increasing the initial outline height.
