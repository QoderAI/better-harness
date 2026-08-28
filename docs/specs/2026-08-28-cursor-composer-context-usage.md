# Read current Cursor composer context usage

## Traceability

- Spec ID: cursor-composer-context-usage
- Status: Implemented
- Refs: `docs/specs/2026-08-28-harness-inspector-usage-context.md`

## Intent

Make Cursor Session reports use the current, composer-matched Context Usage
state that Cursor persists in `state.vscdb`. A saved Context Usage Canvas is an
optional historical snapshot and must not override newer composer state or be
presented as current after the Session continued.

The portable report continues to omit prompt text, context item text, absolute
host paths, raw composer payloads, and unrelated application state.

## Acceptance Scenarios

- AC-1: For a discovered Cursor Session whose `composerData:<session-id>` row
  contains `promptTokenBreakdown`, Session Detail uses its exact
  `totalUsedTokens` and positive categories in the native retained order.
- AC-2: The current model comes from the composer row. Its context window comes
  from Cursor's persisted `availableDefaultModels2` model catalog when a
  matching positive `contextTokenLimit` exists; percentage full is recomputed
  from the selected total and window. Composer-local `maxTokens` and
  `contextUsagePercent` do not override a matching current model-catalog window.
- AC-3: Composer state is admitted only for the exact discovered Session id and
  a workspace identifier inside the selected workspace scope. No composer,
  category, model, or workspace from another Session may be borrowed.
- AC-4: Composer state takes precedence over a composer-matched Canvas. When no
  usable composer state exists, a Canvas may remain a fallback only while it is
  not older than the Session's retained last activity. A stale Canvas does not
  contribute Session-current context.
- AC-5: Missing databases, missing tables, malformed JSON, unknown models, and
  incomplete breakdowns fail closed. A native positive `maxTokens` may supply
  the window only when the selected model is absent from the retained model
  catalog; otherwise unavailable fields remain unavailable.
- AC-6: The Cursor source inventory exposes the platform-specific
  `state.vscdb` route without assuming a macOS path. Windows, macOS, and Linux
  paths use their native path semantics, and an explicit `stateDbPath` remains
  testable and caller-owned.
- AC-7: The normalized event and portable Inspector report retain only bounded
  model, total, window, category, timestamp, source, and omission metadata.
  Raw composer JSON, prompt/context tree nodes, conversation text, application
  settings, and absolute workspace/state paths do not enter the report.
- AC-8: The three locally retained Grok 4.6 Sessions reproduce Cursor's visible
  totals from native state: `96,716 / 256,000`, `62,296 / 256,000`, and
  `122,768 / 256,000`, with category sums equal to their totals. The existing
  `56,860 / 300,000` slice-compiler Canvas is rejected as Session-current
  evidence when newer composer state exists.

## Non-goals

- Treating Cursor's internal SQLite schema as a stable public API.
- Reconstructing historical per-response context progression from current
  composer state.
- Exporting Context Usage item text or the raw `promptContextUsageTree`.
- Changing Codex, Qoder, or Claude Code accounting semantics.
- Changing report layout, typography, or responsive behavior.

## Plan and Tasks

1. Add a Cursor session-analysis helper that resolves `state.vscdb`, reads only
   allowlisted scalar/category fields through SQLite JSON projections, and
   maps the retained model catalog.
2. Add the composer-state source to Cursor discovery, match it after transcript
   discovery, and prefer it over Canvas evidence for the same Session.
3. Make Canvas freshness conservative against the joined Session range and
   keep the existing Canvas projection as a bounded fallback.
4. Extend the Context Usage evidence validator for the new native source while
   preserving the raw-text omission contract.
5. Add database-backed fixtures for exact totals, window precedence,
   workspace/session isolation, malformed/missing state, Canvas fallback, and
   stale-Canvas exclusion.
6. Replay the three local Sessions and render Inspector evidence without
   embedding raw composer data.

## Test and Review Evidence

- AC-1/AC-2/AC-5: focused Cursor state fixtures assert exact totals, native
  category order, category sum, model-catalog precedence, and closed failure.
- AC-3/AC-4: provider fixtures use two workspaces, unrelated composer ids, a
  newer composer row, and an older Canvas; assertions inspect normalized
  behavior rather than source text.
- AC-6: pure path-resolution fixtures exercise `posix` and `win32` semantics;
  GitHub Actions remains the authoritative Windows/macOS/Linux receipt.
- AC-7: serialized Session/report assertions reject fixture prompt secrets,
  raw tree fields, database paths, and absolute workspace paths.
- AC-8: a bounded local replay reads only allowlisted SQLite projections and
  compares exact numbers with the three manually observed Cursor screenshots.
- Validation commands: focused Vitest files, `npm run check`, `git diff --check`,
  and a real single-Session Inspector render for each retained Session.
- Schema risk: Cursor may rename tables or JSON fields. Reads are optional,
  read-only, and fail closed to Canvas/unobserved evidence.
- Concurrency risk: Cursor may update SQLite while the report runs. Queries use
  a read-only connection and one bounded read transaction; no database files or
  WAL files are copied, changed, or checkpointed.

## Validation Evidence

- The focused Cursor/report/Session suites passed 118 tests. Fixtures cover
  model-catalog precedence over composer-local limits, native category order,
  exact Session matching, cross-workspace exclusion, composer-over-Canvas
  precedence, stale-Canvas exclusion, privacy projection, and platform paths.
- Local read-only replay reproduced all three retained Cursor Sessions exactly:
  `96,716 / 256,000` (38%), `62,296 / 256,000` (24%), and
  `122,768 / 256,000` (48%). Each projected category sum equals its total.
- Complete cosy and flow-go Inspector renders retained
  `cursor-native-composer-state`, omitted `state.vscdb` and
  `promptContextUsageTree`, and kept the seven visible categories. The removed
  slice-compiler workspace could not be passed through the Git-backed render
  entrypoint; the same native Session was hydrated directly through the Cursor
  analyzer and Session summarizer with one context event and the exact current
  manifest.
- `npm run check` passed: root Vitest reported 1,579 passed and 2 skipped;
  Harness/Harness UI/Studio reported 172/31/293 passed; package verification
  retained 599 npm and 869 runtime entries. JavaScript syntax and
  `git diff --check` also passed.
