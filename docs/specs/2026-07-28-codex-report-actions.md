# Make Codex HTML findings easier to act on

## Traceability

- Spec ID: codex-report-actions
- Status: Implemented

## Intent

Make each finding in a durable Codex HTML report easy to scan, inspect, and
carry into the current Codex conversation without changing the reviewed
finding source or requiring a report server. Replace the current expanded
finding rows with compact responsive cards, a finding-scoped detail dialog,
and an explicit copy action that transports the complete `aiFixPrompt`.

The HTML remains a portable fallback rather than pretending to provide a
Codex host bridge. Its action label must describe the behavior it can
guarantee: copy the repair prompt for the reader to paste into Codex.

## Acceptance Scenarios

- CRA-AC-1: Every reviewed finding appears once as a compact card containing
  severity, the first mapped dimension, a bounded title, a two-line reason
  preview, and a stable action row. No finding is expanded by default.
- CRA-AC-2: Every finding card provides localized `Copy AI Fix` and
  `View details` actions. The copy action copies the exact complete
  `aiFixPrompt` for that finding rather than the visible summary or acceptance
  checks alone.
- CRA-AC-3: `View details` opens a finding-scoped modal that displays the full
  Cause, Expected Output, and Acceptance Checks for that finding exactly once.
  The modal also provides the same finding-scoped copy action.
- CRA-AC-4: A successful copy produces localized visible and assistive status
  feedback. If the asynchronous Clipboard API is unavailable or denied, the
  report attempts a user-gesture local copy fallback. If both copy paths fail,
  it exposes and selects the complete prompt with clear manual-copy guidance
  instead of reporting false success.
- CRA-AC-5: The modal fits the viewport and closes through its visible close
  action, Escape, or a backdrop click. Opening and closing preserve a useful
  focus path, and all actions have keyboard-accessible semantics and localized
  accessible names.
- CRA-AC-6: The finding grid uses at most three columns, keeps cards and action
  rows aligned when space permits, and collapses responsively without
  horizontal page overflow. Each card remains readable at a 320 px viewport.
- CRA-AC-7: The default screen does not print or visibly expose the full
  `aiFixPrompt`. JavaScript-disabled and print presentations still expose the
  full reader explanation for every finding, while print hides non-functional
  action controls.
- CRA-AC-8: The report stays self-contained and opens directly from disk. It
  adds no remote assets, network calls, runtime file reads, package imports,
  build step, absolute asset path, undocumented Codex URL scheme, or automatic
  repair execution.
- CRA-AC-9: HTML continues to render from the existing reviewed report data and
  produces exactly `findings.json`, `report.md`, and `report.html`. Finding
  eligibility, ordering, scores, reader copy, `aiFixPrompt`, Markdown output,
  Qoder Canvas output, and report schemas do not change.
- CRA-AC-10: Deterministic validation and focused tests reject missing,
  duplicated, cross-bound, or summary-only finding actions; exercise success
  and copy-fallback states; and retain the existing self-contained, parity,
  localization, responsive, and artifact-set checks.

## Non-goals

- Add an MCP server, plugin UI resource, Codex App integration, or a native
  Codex draft-input bridge.
- Automatically send, submit, execute, or approve an AI Fix.
- Use deep links, local CLI process launches, browser extensions, or operating
  system automation to target a Codex conversation.
- Change Qoder Canvas behavior or replace its `SendToChatButton` and `Dialog`
  controls.
- Add a new report mode, report artifact, finding field, schema version, or
  analysis conclusion.
- Hand-edit or treat a historical generated `report.html` as the canonical
  product owner.
- Redesign unrelated readiness, usage, customization, evidence, or methodology
  sections.

## Plan and Tasks

1. Tighten the portable HTML reporting contract so it distinguishes
   guaranteed local copy actions from unavailable host chat controls, defines
   the compact card and detail-dialog reader flow, and preserves direct-disk,
   no-network, print, and no-JavaScript behavior. (CRA-AC-1..CRA-AC-9)
2. Refactor the deterministic HTML findings renderer from default-open
   `<details>` rows to responsive finding cards with one finding-scoped dialog
   per row. Reuse the existing escaped Cause, Expected Output, and parsed
   Acceptance Checks; do not duplicate or re-author reader copy.
   (CRA-AC-1, CRA-AC-3, CRA-AC-6, CRA-AC-7, CRA-AC-9)
3. Add one bounded inline interaction controller. It resolves a finding only
   by `data-finding-id` against the already embedded report JSON, opens and
   closes that finding's dialog, copies only its complete `aiFixPrompt`, reports
   status through an `aria-live` region, and activates the explicit manual-copy
   fallback when necessary. It must not use `fetch`, `eval`, dynamic imports,
   remote code, or a host-specific global. (CRA-AC-2..CRA-AC-5, CRA-AC-8)
4. Extend the HTML validator with structural action and dialog checks while
   retaining the current forbidden-resource checks and source-row parity.
   Validate one card, one detail surface, and the required row-scoped actions
   for every finding without accepting a shared or mismatched prompt binding.
   (CRA-AC-8..CRA-AC-10)
5. Add focused renderer and browser coverage for multiple findings, special
   characters, English and Chinese labels, Clipboard API success, local-copy
   fallback success, total copy failure, modal dismissal and focus return,
   narrow viewports, print presentation, and no-JavaScript degradation.
   (CRA-AC-2..CRA-AC-7, CRA-AC-10)
6. Render a fresh validation report from a deterministic fixture, inspect it
   with Playwright, run the focused suites and complete project checks, and
   record evidence against the acceptance scenarios. Do not overwrite the
   user-provided historical run as an implementation shortcut.
   (CRA-AC-1..CRA-AC-10)

## Test and Review Evidence

- CRA-AC-1..CRA-AC-3/CRA-AC-9: extend
  `test/harness-report-render-cli.test.mjs` to assert finding-card count,
  row-scoped action count, dialog count, full detail parity, exact artifact
  names, and unchanged Canvas/Markdown boundaries.
- CRA-AC-2/CRA-AC-4: use a deterministic browser fixture to stub successful,
  denied, unavailable, and fully failed clipboard paths. Assert the copied
  value equals the source `aiFixPrompt` byte for byte and that false success is
  impossible.
- CRA-AC-3/CRA-AC-5: use Playwright to open each finding independently, verify
  Cause, Expected Output, and Acceptance Checks, then close by button, Escape,
  and backdrop while checking focus return and the live status message.
- CRA-AC-6/CRA-AC-7: inspect desktop, tablet, and 320 px screenshots; verify no
  horizontal page overflow; verify print CSS exposes full finding explanation
  and hides actions; and verify the no-JavaScript presentation remains
  readable.
- CRA-AC-8..CRA-AC-10: extend `evaluateHtmlReport` tests for required local
  interaction structure and the existing forbidden remote script, stylesheet,
  asset URL, network fetch, and Canvas import patterns.
- Focused commands:
  - `node --test test/harness-report-render-cli.test.mjs`
  - `node --test test/html-report-interactions.test.mjs`
  - `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  - `node --test test/doc-link-graph.test.mjs`
  - `git diff --check`
- Complete validation:
  - `npm test`
  - `npm run pack:verify`
  - `npm run preview`, then smoke-test
    `http://localhost:58575/health` and
    `http://localhost:58575/canvas-module.js`
- Manual direct-disk check: open the fresh `report.html` through `file://` in a
  supported desktop browser and exercise copy success or its explicit fallback
  without a preview server.
- Risk: browser clipboard policy differs across `file://`, loopback HTTP, and
  managed environments. Mitigate with layered copy paths, truthful status, and
  a selected manual-copy fallback.
- Risk: moving explanation behind a modal can weaken print or script-disabled
  reports. Mitigate with explicit print and no-JavaScript presentation rules
  backed by focused inspection.
- Risk: an interaction script can bind the wrong finding or expose unsafe
  content. Resolve only exact finding ids from the embedded reviewed source,
  keep visible data escaped, write fallback prompt text through the textarea
  `value` property, and test multi-row and special-character cases.
- Risk: visual parity work can accidentally change analysis semantics. Keep
  this change in the HTML contract, renderer, validator, and focused tests; do
  not edit report-source projection, schemas, Markdown, Canvas, or finding
  authoring owners.

## Implementation Evidence

- Implemented on `feat/codex-report-actions-implementation` in:
  - `scripts/harness-analysis/renderers/html.mjs`
  - `scripts/harness-analysis/renderers/html-interactions.mjs`
  - `templates/reporting/html-visual.md`
  - `test/harness-report-render-cli.test.mjs`
  - `test/html-report-interactions.test.mjs`
- CRA-AC-1..CRA-AC-3/CRA-AC-6/CRA-AC-9: a fresh render from the historical
  reviewed `findings.json` passed validation with three finding cards, three
  finding dialogs, six copy actions, three detail actions, and exactly
  `findings.json`, `report.md`, and `report.html`.
- CRA-AC-2/CRA-AC-4/CRA-AC-8/CRA-AC-10:
  `node --test test/html-report-interactions.test.mjs
  test/harness-report-render-cli.test.mjs` passed 19/19 tests. Coverage includes
  exact special-character prompt copy, Clipboard API rejection, legacy local
  copy, selected manual fallback, truthful status, Chinese labels, action
  mutation failures, cross-finding binding rejection, manual-fallback focus
  return, and rejected host bridge/deep-link coupling.
- CRA-AC-3/CRA-AC-5: Playwright opened the finding-scoped dialog and observed
  Cause, Expected Output, Acceptance Checks, and the scoped copy action.
  Closing it restored focus to the matching `View details` trigger; focused
  unit coverage also exercised backdrop dismissal.
- CRA-AC-6/CRA-AC-7: Playwright confirmed a three-column desktop finding grid,
  a one-column 320 px grid with `scrollWidth === innerWidth === 320`, and
  readable desktop, dialog, and mobile screenshots. Computed no-JavaScript and
  print styles both hid action controls and the manual-copy dialog while
  exposing each full finding dialog.
- Repository validation:
  - `npm test`: 831 tests, 829 passed, 2 skipped because Windows denied fixture
    symlink creation with `EPERM`, 0 failed.
  - `npm run pack:verify`: passed with 303 npm entries and 330 runtime zip
    entries.
  - `node --test test/doc-link-graph.test.mjs`: 6/6 passed.
  - `git diff --check`: passed.
- PR #8 maintainer follow-up on macOS with supported Node 24.15.0:
  - `node --test`: 833/833 passed with a generated `/.codex/` report present.
  - `node scripts/npm-package/verify-pack.mjs`: passed with 302 npm entries and
    330 runtime zip entries.
  - `node --test test/doc-link-graph.test.mjs`: 6/6 passed.
  - The retired-name repository scan now excludes ignored `/.codex/` runtime
    output, so embedded absolute report paths do not become source violations.
- Environment limitations:
  - `npm run preview` could not start because this environment has no Canvas
    SDK runtime; `/health` and `/canvas-module.js` therefore could not be
    smoke-tested. This does not affect the self-contained HTML runtime.
  - Playwright CLI blocks the `file:` protocol, so its direct-disk navigation
    was not available. The generated file passed the deterministic
    self-contained validator and the existing disk-openable renderer test;
    interactive browser checks used loopback HTTP.
  - The loopback preview logged only automatic browser requests for missing
    `favicon.ico` and Chrome DevTools metadata; the report controller emitted
    no console error.
