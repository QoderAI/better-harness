# Keep copied finding fixes bound without exposing local paths

## Traceability

- Spec ID: html-finding-fix-callback
- Review: QoderAI/better-harness#39
- Status: Implemented

## Intent

Make `Copy AI Fix` from a durable Codex HTML report executable by the
activated Better Harness Skill when the report remains in its generated
workspace-relative location. Preserve callback-free report compatibility and
the report's portable reader surface without embedding renderer-added absolute
workspace or artifact paths.

The callback is local action transport, not an analysis conclusion or
AI-authored reader field. Rendering must leave the persisted `findings.json`,
paired Markdown report, finding scores, and reviewed `aiFixPrompt` unchanged.

## Acceptance Scenarios

- AC-1: A report renders two Copy controls only for each finding whose reviewed
  `aiFixPrompt` is a non-empty, non-whitespace string. A finding without a
  usable prompt retains its details control but has no action row and no
  callback metadata.
- AC-2: A bound report embeds only a normalized workspace-relative POSIX route
  to the final `report.html`, plus finding ids and current revisions. It does
  not embed renderer-added absolute `workspacePath`, `findingsPath`,
  `dataPath`, or `target.path` values in either interaction payload.
- AC-3: When the current document is a `file:` URL whose decoded path ends in
  the exact embedded report route, Copy derives the workspace root and sibling
  final `findings.json` path locally. It appends exactly one
  `<better-harness-fix-output>` block with contract
  `better-harness-fix-output/v1`, the derived exact paths, exact finding id,
  and the finding's current `actualOutputRevision` or `0`.
- AC-4: When the renderer has no safe action context, or the report is opened
  through HTTP or from a file path that does not match the expected route, all
  clipboard and manual-copy paths transport the unchanged reviewed
  `aiFixPrompt` without a callback or renderer-added local paths.
- AC-5: An intentionally empty action binding enables only the compatibility
  fallback. A present but malformed, incomplete, stale, cross-bound, absolute,
  or escaping binding fails deterministic HTML validation and never becomes a
  compatibility fallback.
- AC-6: Action transport remains finding-scoped across multiple rows and
  produces parseable callback JSON for Windows drive paths, Windows UNC paths,
  macOS paths, Linux paths, spaces, Unicode, and punctuation.
- AC-7: The final route is derived from the published run directory, never the
  temporary staging directory or source findings path. Existing output-location
  allocation and replacement behavior remains unchanged.
- AC-8: The rendered `findings.json`, paired `report.md`, source
  `aiFixPrompt`, Qoder Canvas behavior, report scoring, finding eligibility,
  and visible details content remain unchanged.

## Non-goals

- Automatically submit, approve, or execute the copied fix.
- Add a ChatGPT Desktop host bridge, deep link, network request, sidecar action
  file, new persisted finding field, or runtime file read.
- Guarantee a finding-bound callback after the HTML file is moved, downloaded
  outside its generated route, shared to another machine, or served over HTTP.
  Those states retain the reviewed manual prompt only.
- Change Qoder Canvas handoffs or broaden one finding-bound repair into a new
  Harness review.
- Repair previously generated HTML files in place.

## Plan and Tasks

1. Project the full report into a minimal reader-safe interaction payload
   containing only actionable finding ids and unchanged reviewed prompts.
   Remove the full `reportData` object from embedded interaction JSON.
   (AC-1, AC-2, AC-8)
2. Build deterministic machine action metadata from the target workspace and
   final report location. Emit only a safe workspace-relative report route and
   per-finding revision metadata; emit an intentionally empty binding when the
   report is not safely beneath the workspace. (AC-1, AC-2, AC-5, AC-7)
3. Resolve file-local bindings inside the self-contained interaction
   controller. Require exact route suffix matching, derive platform-native
   workspace and sibling findings paths, and append the v1 callback only at
   copy time. (AC-3, AC-6)
4. Preserve the raw-prompt compatibility route for intentionally empty
   bindings, HTTP previews, and moved file reports. Keep malformed declared
   bindings fail-closed. (AC-4, AC-5)
5. Render and validate Copy controls only for usable prompts. Validate exact
   interaction and action payload projections plus per-finding action counts.
   (AC-1, AC-5)
6. Add unit, renderer, CLI, and browser regression coverage for callback
   generation, fallback states, empty prompts, binding tampering, final routes,
   and cross-platform URL/path conversion. (AC-1..AC-8)

## Test and Review Evidence

- Interaction coverage:
  `node --test test/html-report-interactions.test.mjs` must verify original
  file binding, callback JSON parsing, Clipboard API/legacy/manual parity,
  intentional-empty fallback, HTTP fallback, moved-file fallback, malformed
  binding failure, and Windows/macOS/Linux paths.
- Renderer and CLI coverage:
  `node --test test/harness-report-render-cli.test.mjs` must verify minimal
  embedded interaction data, relative final report routes, actionable finding
  counts, no renderer-added absolute paths, no staging routes, exact revisions,
  and validator rejection of tampering.
- AC-8: compare rendered `findings.json` and Markdown semantics with the input,
  and run the existing Canvas and report-render suites.
- Documentation integrity:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then
  `node --test test/doc-link-graph.test.mjs`.
- Complete validation: `npm test`, `npm run pack:verify`, and
  `git diff --check`.
- Visual validation: serve a generated HTML report through the local HTML
  preview, use Playwright to inspect console/page errors, exercise raw-prompt
  HTTP fallback and the details dialog, and retain a screenshot.
- Repository preview smoke: run `npm run preview`, then request
  `http://localhost:58575/health` and
  `http://localhost:58575/canvas-module.js`. If the external Canvas SDK
  runtime is unavailable, record the limitation separately rather than
  claiming success.
- Risk: route suffix matching could bind a moved report to the wrong workspace.
  Accept only safe relative segments and an exact decoded `file:` suffix;
  otherwise transport only the reviewed prompt.
- Risk: Windows URL decoding and separator conversion could create invalid JSON
  or paths. Generate the callback with `JSON.stringify` and parse it in
  cross-platform fixtures.
- Risk: compatibility fallback could hide a corrupted binding. Distinguish an
  explicit empty binding from any declared malformed or mismatched binding and
  keep the latter fail-closed.

## Revision Baseline

- PR #39 review confirmed that callback-free renders expose Copy buttons whose
  interaction controller can no longer find the original prompt.
- The same review confirmed that empty prompts currently receive callback-only
  actions and that the hand-written Windows callback fixture is invalid JSON.
- The pre-change HTML already embeds absolute `dataPath` and `target.path`;
  the first callback implementation additionally embeds `workspacePath` and
  `findingsPath`. This revision removes renderer-added absolute paths from both
  interaction payloads rather than documenting a local-path disclosure.

## Implementation Evidence

- The renderer now embeds only actionable finding ids/prompts and a separate
  final workspace-relative report route with ids/revisions. Context-free or
  unsafe output locations emit `{ reportRoute: null, findings: [] }`.
- The browser controller validates both minimal payloads, derives native
  workspace and sibling `findings.json` paths only for an exact matching
  `file:` route, and uses the same computed text for Clipboard API, legacy, and
  manual-copy paths. HTTP and moved-file routes preserve the raw reviewed
  prompt; malformed declared bindings fail closed.
- Copy controls and binding rows are omitted for empty or whitespace-only
  prompts while details remain visible. The HTML validator enforces the minimal
  payloads, relative route, revision, finding binding, and actionable counts.
- `node --test test/html-report-interactions.test.mjs` passed 9/9, including
  Windows drive, Windows UNC, macOS, Linux Unicode, local-file, HTTP, moved-file,
  empty-binding, and malformed-binding cases. All HTML-focused render tests
  passed; the enclosing file has one unrelated local symlink-permission case.
- Playwright verified the original local file callback fields and the raw-prompt
  HTTP fallback, opened the details dialog, retained a screenshot, and found no
  report-script warning or error. The temporary HTTP server produced only a
  missing `favicon.ico` 404.
- `npm run pack:verify` passed with 365 npm entries and 388 runtime ZIP entries.
  The full `npm test` run passed 1036/1046 with 6 platform skips; the remaining
  4 failures are local Windows `EPERM` errors from tests that require symlink
  creation and do not touch this change.
- `npm run preview` could not start because no Canvas SDK runtime or
  `CANVAS_SDK_MEDIA_DIR` / `CANVAS_SDK_ROOT` is available, so `/health` and
  `/canvas-module.js` were unavailable. The self-contained HTML browser route
  has no Canvas runtime dependency.
