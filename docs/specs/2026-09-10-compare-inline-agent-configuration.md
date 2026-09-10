# Compare inline Agent configuration

## Traceability
- Spec ID: compare-inline-agent-configuration
- Status: Implemented
- Supersedes: AC-3 of [compare-input-flow](2026-09-09-compare-input-flow.md)
- Request: the Compare configuration panel sits in the wrong place; put it inside
  the input region's Agent control, on the same model the Memory analysis
  composer already uses, and keep it as small as possible.

## Intent
A chosen Agent and that Agent's configuration are one object, so Compare states
them as one control inside the composer rather than as a chip in the toolbar plus
a stacked configuration panel below it. Compare and the Memory analysis composer
then share one rule: offered settings render compact, in place, inside the input
region, and never as a second surface.

## Acceptance Scenarios
- AC-1: Choosing an Agent renders one control inside the composer carrying that
  Agent's name, its offered core settings, and its Remove action. No separate
  configuration panel, prepare/refresh button, or `Ready` status is rendered.
- AC-2: The offered settings are the compact `AcpSessionSettings` toolbar used by
  the Memory analysis composer, and remaining options open as one pop-up anchored
  to the composer, above it, bounded at wide, compact, and narrow layouts.
- AC-3: Settings edited in the composer stay per Agent; changing one Agent's model
  or reasoning effort does not change another's, and a rejected change reverts to
  the value the Agent still reports.
- AC-4: A preparation failure is recoverable on the Agent it belongs to: that
  control offers Retry, which re-prepares only that Agent and keeps the already
  settled Agents and the current prompt.
- AC-5: The composer states a prerequisite only when no Agent row can: no local
  ACP Agent is available, or no Agent is chosen yet.

## Non-goals
Do not change ACP preparation, the launch path, lane rendering after a prompt
starts, the Agent catalog or its four-Agent ceiling, the Memory surface, or
release metadata. Do not add Agent adapters or invent configuration options.

## Plan and Tasks
1. Merge the Agent chip and its configuration section into one composer control
   and drop the `Configure Agents` refresh button and the `Ready` readiness text.
2. Render `AcpSessionSettings` in compact mode inside that control, grouped per
   Agent, with the overflow disclosure anchored to the composer.
3. Replace the composer-wide refresh with a per-Agent Retry so one failure cannot
   discard the Agents that already settled.
4. Remove the superseded configuration-panel styles, labels, and the stale narrow
   Agent-slot rules; update the English and Chinese labels.
5. Update the browser coverage that asserted the old panel, refresh button, and
   readiness text.

## Test and Review Evidence
- AC-1/AC-2/AC-3: `test/browser/acp-session-controls.spec.mjs` asserts the Agent
  controls live inside `.live-compare-composer`, that no `Configure Agents`
  button, readiness text, or transcript exists before the prompt starts, that a
  503 config response reverts the model and a retry applies it, and that the
  second Agent keeps its own value; screenshots at 1440×900, 1024×768, 390×844
  verify focus, bounded overflow, and no console/page errors.
- AC-4/AC-5: `test/browser/acp-debugger.spec.mjs` covers the empty-choice
  prerequisite, Agent removal by name, and the four-Agent ceiling.
- Verified locally: `npm run build`, `npx vitest run` (88 files, 658 tests), and
  `npx playwright test test/browser/acp-session-controls.spec.mjs
  test/browser/acp-debugger.spec.mjs` (10 scenarios) passed.
- Risk: preparation streams still stay live until start or removal; Retry must
  release the failed Agent's run before starting a replacement.
