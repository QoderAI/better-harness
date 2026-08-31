# Compact Session process evidence

## Traceability

- Spec ID: compact-session-process-evidence
- Status: Implemented

## Intent

Reduce repeated vertical chrome in an expanded Process trace without discarding
observed-order evidence. Restore the complete historical Evidence filters and
pair each model-usage observation with its adjacent tool-call group when the
retained step order supports that relationship.

## Acceptance Scenarios

- AC-1: Evidence filters is collapsed by default and restores Prompts, Results,
  Intermediate, Model usage, Commits, Tool calls, retained tool-name subtypes,
  and File paths with their historical counts and independent behavior.
- AC-2: A model-usage step immediately following one or more contiguous tool
  calls renders in the same compact summary row as that tool-call group. The row
  preserves tool count/name, response ordinal, token summary, and context usage.
- AC-3: The combined summary stays one visual line at wide layout with bounded
  ellipsis. Expanding it reveals tool details only; it does not recreate the
  former multi-row Model response card.
- AC-4: A usage step with no adjacent preceding tool-call group renders as one
  standalone compact row rather than the former card.
- AC-5: Tool-call and Model-usage filters remain independent. Hiding one leaves
  the other evidence visible, and hiding both removes the combined row.
- AC-6: Standalone Inspector and React Studio use the same labels, ordering,
  grouping, and responsive behavior.
- AC-7: Wide, compact, and narrow layouts have no document or pane overflow;
  keyboard operation and existing narrow touch targets remain intact.

## Non-goals

- Inferring causality between a tool call and a model response beyond retained
  adjacency in observed order.
- Changing Usage report calculations, retained evidence, Replay, or Session
  attribution.
- Restoring bulk Process controls or removed low-value Session facts.

## Plan and Tasks

1. Restore the historical filter state, counts, subtype controls, and handlers
   in standalone and Studio renderers.
2. Introduce a compact process-step summary that can present adjacent tool and
   usage evidence without losing independent filter ownership.
3. Keep unmatched usage evidence in the same one-line visual vocabulary.
4. Add exact filter, ordering, grouping, keyboard, and responsive assertions.
5. Regenerate a real standalone report and visually review wide, compact, and
   narrow Process traces.

## Test and Review Evidence

- The focused Studio Inspector browser scenario passed with all 10 fixture
  filters and counts, pointer/keyboard disclosure behavior, independent model,
  tool-name, tool-call, prompt, and file-path filtering, and no wide, compact,
  or narrow overflow.
- Adjacent tool and usage evidence rendered in one summary measuring at most
  40 px in the Studio fixture and 33.3 px in the regenerated standalone report.
  Unmatched usage evidence rendered as a compact row with no legacy usage card.
- Disabling Prompts removes the input marker with the prompt and leaves Process
  and Outcome at 91% of the standalone Turn width; the focused Studio browser
  scenario asserts both remain wider than 75% of the Turn.
- `npm run typecheck -w @qoder-ai/harness-studio` and the Studio build passed.
- `npm test -w @qoder-ai/harness-studio`: 65 files and 512 tests passed.
- `npx vitest run test/reporting/harness-inspector.test.mjs`: 39 tests passed.
- `node --check scripts/harness-inspector/ui/workbench.js` and
  `git diff --check` passed.
- The standalone report regenerated successfully and its wide combined trace,
  prompt-hidden layout, and bounded filter treatment were visually reviewed.
