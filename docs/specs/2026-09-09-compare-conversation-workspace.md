# Compare conversation workspace

## Traceability
- Spec ID: compare-conversation-workspace
- Status: Implemented
- Request: use the shared AI components in Compare, move input to the bottom,
  resize the Agent panes and associate file calls with their outcomes.

## Intent
Keep Compare readable as a docked conversation workspace. Put the initial prompt
below the reading area and correlate observed file operations across Agent lanes.

## Acceptance Scenarios
- AC-1: The initial shared Prompt Input sits at the bottom with upward-opening
  Agent selection. Running lanes retain shared messages, tools, confirmation,
  Markdown and independent bottom composers with queue/retry semantics.
- AC-2: Two to four panes resize at adjacent separators with pointer capture,
  arrows, Shift acceleration, Home/End and double-click reset. Widths survive
  view switches; narrow containers stack bounded scrollable panes.
- AC-3: A collapsible file table aligns exact observed paths across lanes. Each
  operation retains its kind and individual result: pending/running, completed,
  failed, unavailable or interrupted. Missing observations are not successes.
  Repeated calls remain inspectable. Clicking a result expands and focuses its
  source tool in the correct lane, without opening or reading any filesystem file.
- AC-4: Lane status separates session readiness from the latest turn result,
  cancellation and errors; a live connection alone is never labelled successful.
- AC-5: Behavior and layouts pass focused unit/browser tests, including wide,
  compact, narrow, light/dark, keyboard focus, bounded overflow and page errors.
  Build and local Desktop verification show the current source UI.

## Non-goals
New adapters, a shared follow-up dispatch protocol, workspace indexing, parsing
shell strings to guess accessed files, basename-based matching, filesystem reads,
retained Sessions comparison changes, packaging, publishing or committing.
Native path strings are opaque host observations: only identical full strings
are correlated. Relative/absolute or case aliases are not guessed in the browser.

## Plan and Tasks
1. Reorder the initial composer and reuse the existing transcript components.
2. Add accessible resizable lanes and persistent presentation state.
3. Share tool projection/status rendering and build a pure file evidence model
   from explicit ACP locations and structured file-path inputs.
4. Add source-tool navigation, truthful lane outcome labels and localization.
5. Verify fixture streams, screenshots, browser errors and the running Desktop.

## Test and Review Evidence
- AC-1/AC-2: browser fixtures verify the bottom input at 1440, 1024 and 390px,
  upward Agent menu bounds, pointer/keyboard resizing, double-click reset and
  saved widths/drafts across navigation. Existing three-Agent and NSXPC tests pass.
- AC-3/AC-4: actual ACP fixture streams expose one shared file and a file observed
  only by Beta. Failed/completed/absent results stay distinct; clicking Beta's
  result expands and visibly focuses only Beta's tool. Cancellation displays
  Interrupted. File paths remain visible under collapsed tool titles.
- Seven focused model tests cover repeated operations, explicit status precedence,
  missing results, opaque Windows/UNC/POSIX paths, turn outcomes and pane fitting.
  Thirty unit tests pass across five relevant suites.
- Browser regression: 28 scenarios across conversation, session stream, settings,
  Debugger, Compare and Memory have passed across the final regression/reruns.
  The final path-display change passed all 18 scenarios in its four affected suites.
- Studio build/typecheck, eight doc-link tests and `git diff --check` pass. Canvas
  preview was started; health and module endpoints returned 200 on 58575/58577.
- Independent Electron smoke passed: sandboxed renderer, authorized HTTP,
  NSXPC ACP/evidence service and clean shutdown, with no renderer errors.
  Windows/Linux native hosts and a packaged install were not exercised.

## Review Readiness Check
The user's requests are the scope evidence; no Story id or remote CI receipt was
inferred. Specs map to local code and tests. Risks exercised include confusing
transport with turn outcomes, merging unrelated files, missing failed attempts,
popup clipping, drag bounds and disturbing another lane's draft/scroll position.
The shared path projection uses explicit observed paths without filesystem access.
AI: Codex implementation. No dependencies, releases or versions changed by this
work. Concurrent Customizations changes remain separate; no staging or commit.
