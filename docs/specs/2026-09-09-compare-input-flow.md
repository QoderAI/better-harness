# Compare input flow

## Traceability
- Spec ID: compare-input-flow
- Status: Implemented
- Request: simplify the Compare composer, make Agent configuration inline, and keep retained Session comparison explicit.

## Intent
Keep Compare focused on one decision at a time: select Agents, review their offered configuration in the persistent input region, then run. Do not load or open retained Sessions until the reader explicitly selects a pair for comparison.

## Acceptance Scenarios
- AC-1: The idle Compare surface shows only the docked input region and its neutral reading area; it does not render saved conversation/chat content. Readiness remains an inline status/control and never consumes a separate full-width line.
- AC-2: Choosing one or more available Agents automatically prepares their configuration in the input region. Offered core options, including reasoning strength when the Agent supplies it, are editable before the shared prompt starts.
- AC-3: Choosing `Configure Agents` refreshes only the input-region configuration. It does not reveal a transcript, create message panes, or navigate away from Compare.
- AC-4: Starting the prompt from a prepared input region preserves the current prompt and Agent configuration, then opens the existing live comparison lanes.
- AC-5: Compare defaults to Live Agents. Its retained Sessions surface remains empty until the reader explicitly selects two Sessions in the Sessions workspace; it then requests only that pair's comparison, without loading or auto-pairing the retained Session catalog.
- AC-6: Entering the Sessions workspace does not automatically fetch a Session detail; explicit row selection remains the only detail-opening action.

## Non-goals
Do not add Agent adapters, invent configuration options, alter retained Session discovery, change the live comparison evidence panes after a prompt starts, or modify release metadata.

## Plan and Tasks
1. Keep ACP preparation streams in Compare state, expose `AcpSessionSettings` inside the composer, and release them only when the reader starts the prompt.
2. Allow prepared ACP runs to replace their initial prompt at start time, so Agent selection can precede prompt entry.
3. Remove idle conversation history and make composer status/configuration wrap within its own bounded surface.
4. Default Compare to Live Agents; make retained Session comparison pair-driven and remove automatic Session detail opening.
5. Update English/Chinese labels and focused browser tests for configuration, Session scope, keyboard focus, wide/compact/narrow overflow, and browser errors.

## Test and Review Evidence
- AC-1/AC-3: Browser tests assert no idle transcript or lanes while configuration refreshes in the composer.
- AC-2/AC-4: ACP fixture tests change model/reasoning settings, start after preparation, and verify the selected values reach the Agent.
- AC-5/AC-6: Browser coverage verifies the legacy Sessions catalog has no selected detail after reload and opens evidence only after an explicit row click; retained comparison still starts from an explicitly selected pair.
- All ACs: run Studio typecheck/build, relevant Vitest/Playwright suites, `git diff --check`, and visual screenshots at 1440px, 1024px, and 390px with console/page-error checks.
- Verified: Studio build/typecheck, 19 focused unit assertions, and six focused Playwright scenarios covering inline configuration, input-only refresh, explicit Session opening, live lane startup, responsive layouts, keyboard focus, and browser errors passed locally.
- Risk: preparation streams remain live until start or refresh; reset must close old sessions, retain the latest requested Agent set, and never expose stale transcript content.