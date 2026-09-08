# Simplify Sessions navigation and evidence views

## Traceability
- Spec ID: sessions-ui-refinement
- Status: Implemented
- Request: user supplied seven Sessions UI corrections and a screenshot.

## Intent
Prioritize session evidence and interactive charts inside the docked Studio.

## Acceptance Scenarios
- AC-1: No Inspector boundaries banner; scoped counts appear in a bottom status row.
- AC-2: Both evidence lane separators resize with pointer and keyboard and reset on double-click; narrow layouts stack without overflow.
- AC-3: Expanded actions expose an interactive graph with selection, zoom and call details instead of a flat list.
- AC-4: Unassigned records remain accessible in a collapsed, plainly named section without implying a turn association.
- AC-5: Session back is at the left, redundant branding is absent, and return preserves scope and focus.
- AC-6: Usage report shows charts and their necessary labels/controls, without introductory dashboards and accounting prose.
- AC-7: Workspace Sessions has no Catalog & Compare switcher; existing standalone Compare is outside scope.

## Non-goals
No data collection, billing semantics, native installation, release metadata, or standalone report rewrite. Preserve the fallback catalog for hosts without workspace inspection.

## Plan and Tasks
Update React Inspector, shared lane sash integration, Sessions routing and English/Chinese labels. Use existing semantic tokens. Graph uses observed timestamps when all calls have them, otherwise explicitly labelled call order; no invented timing. Add focused browser interaction coverage.

## Test and Review Evidence
- AC-1/AC-7: browser confirms the banner and Catalog & Compare tab are absent and scope metrics are in the footer. The fallback catalog and standalone comparison remain covered.
- AC-2: browser measures both lane widths after arrow-key input, pointer dragging and double-click reset.
- AC-3: browser selects graph points and uses arrow keys; a 287-call untimed fixture proves 60-call bounded rendering, paging and zoom. Real project inspection also showed 60 visible marks for a 152-call session with no graph overflow.
- AC-4/AC-5: browser verifies the other-records disclosure, left-positioned back button, history exit and restored trigger focus; Session view is a navigable region rather than an aria-modal dialog.
- AC-6: duplicate report summary, methodology, accounting and response-detail panels are removed; existing usage graph hover, click and keyboard checks pass.
- `npm run build --workspace packages/harness-studio` and `npm run typecheck --workspace packages/harness-studio`: passed.
- From Studio: `npx vitest run test/inspector-session-model.test.ts test/design-tokens.test.ts`: 23 tests passed.
- From Studio: `npx playwright test test/browser/artifact-host.spec.mjs -g 'opens a project workspace'`: passed, including wide/compact/narrow screenshots, dark/reduced-motion graph and console/page error collection.
- `npm run preview`: `/health` and `/canvas-module.js` both returned 200.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs`: 8 tests passed; routing graph regenerated without changes.
- Visual evidence: Studio test-results includes session-actions-long-wide/compact/narrow/dark, session-detail-trace, session-detail-usage and session-inspector screenshots. A real-project screenshot is retained in Studio test/.artifacts/sessions-ui/real-project-wide.png.

## Review Readiness
The seven changed files (including the new graph and this spec) map to the acceptance scenarios above. No issue id was supplied; the explicit user request is the task evidence. AI implementation: Codex. No staged changes, commits, dependency changes or generated release artifacts are included. Other tasks' concurrent edits were left alone.

Risks and limits: browser/source evidence only, not an installed desktop build or Windows/Linux native validation. The new React graph supports selection and bounded window zoom; it does not claim every standalone chart overlay has been ported. Missing timing uses explicit call order. Standalone Inspector remains unchanged.
