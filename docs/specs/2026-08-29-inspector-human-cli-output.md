# Make Inspector startup output human-friendly

## Traceability

- Spec ID: `inspector-human-cli-output`
- Status: Implemented

## Intent

Make `npm run inspector` behave like a user-facing startup command: render and
open the current workspace report, then print a compact readable summary rather
than exposing the internal JSON result by default. Preserve deterministic JSON
for scripts through an explicit flag.

## Acceptance Scenarios

- AC-1: `npm run inspector` invokes the zero-argument Inspector workflow, which
  renders the current workspace with the documented default window and attempts
  to open the written report.
- AC-2: A successful render without `--json` prints a concise summary containing
  the report path, scope counts, coverage counts, contributing Session providers,
  and an honest browser-open result when opening was requested.
- AC-3: `--json` emits the existing parser-safe result object, including provider
  details and the optional `opened` field, with no human text mixed into stdout.
- AC-4: Help documents `--json`; invalid and duplicate boolean flags retain the
  existing exit-64 behavior without leaking caller values.
- AC-5: Open failure still leaves a valid report and exits successfully, while
  human output tells the user to open the reported path manually.

## Non-goals

- Change report contents, collection limits, provider discovery, or privacy
  projection.
- Add ANSI styling, progress animation, a local HTTP server, or a new viewer.
- Remove the existing `inspector:open` compatibility script.

## Plan and Tasks

1. Route the package `inspector` script through the CLI zero-argument default.
2. Add `--json` as a valueless render option and separate result construction
   from human and machine formatting.
3. Update focused CLI tests to cover human startup output, JSON compatibility,
   browser-open success/failure, parsing, and the package-script route.
4. Run the focused Inspector suite, CLI/package contract tests, full repository
   checks, and a live `npm run inspector` smoke without changing Git metadata.

## Test and Review Evidence

- AC-1: inspect `package.json` behavior and run a focused spawned package-script
  smoke with browser opening stubbed where tests require isolation.
- AC-2/AC-3/AC-5: `npx vitest run test/reporting/harness-inspector.test.mjs`.
- AC-4: focused help and option parser assertions in the same suite.
- Regression: `npm run check` and `git diff --check`.
- Risk: scripts that parsed the former implicit JSON must add `--json`; the flag
  preserves the full prior object rather than introducing a second schema.

Implemented evidence:

- The focused Inspector and root CLI suites passed 86 tests. They cover the
  zero-argument package route, human output, JSON output, help, boolean parsing,
  report-before-open ordering, and honest open failure.
- A current-workspace smoke printed a five-line human summary with correct
  singular labels; `npm run --silent inspector -- ... --json` retained a
  parser-safe result containing all 13 provider receipts.
- The documentation graph regenerated with 39 files and 56 links, and all 8
  link-graph tests passed.
- `npm run check` passed: root Vitest reported 1,595 passed and 2 skipped,
  Harness 173 passed, Harness UI 31 passed, Studio 494 passed, generated sources
  were current, and package verification passed with 610 npm entries and 880
  runtime ZIP entries.
