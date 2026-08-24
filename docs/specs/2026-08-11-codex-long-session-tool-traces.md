# Visualize long-session tool calls in Codex HTML

## Traceability

- Spec ID: codex-long-session-tool-traces
- Status: Implemented
- Depends on: `docs/specs/2026-08-11-long-session-tool-call-traces.md`

## Intent

Give Codex users the same reviewable long-session tool-call evidence available
in the Better Harness Canvas while preserving the portable HTML runtime. The
HTML report should expose the privacy-safe initial request, session locator,
ordered tool lanes, failures, and observed latency without requiring Canvas SDK
packages, remote assets, or a host bridge.

## Acceptance Scenarios

- AC-1: Codex `function_call` and `function_call_output` events with the same
  invocation id produce a v2 tool trace with observed transcript-pair latency.
- AC-2: Portable HTML renders each retained long-session sample as a compact
  metadata card with a native collapsed disclosure containing a repository-owned
  inline SVG swimlane bubble chart.
- AC-3: The SVG groups calls by privacy-safe tool name, orders them by step,
  distinguishes failures, scales bubble area by observed latency, explains
  missing timing, remains horizontally scrollable, and exposes accessible chart
  and point labels.
- AC-4: The HTML renderer keeps the initial user request and bounded session
  locator readable, but does not add Codex deep links, Canvas imports, raw
  transcript data, tool arguments, outputs, or absolute evidence paths.
- AC-5: HTML contract validation, focused renderer/session tests, full tests,
  packaging, and a narrow-browser Playwright preview pass.

## Non-goals

- Adding a Codex Canvas runtime, native Codex panel, host bridge, or `codex://`
  deep link.
- Changing the shared tool-trace schema, long-session selection, duration
  pairing rules, privacy projection, report scoring, or recommendation logic.
- Making the HTML visual byte-for-byte identical to the Qoder Canvas component.
- Adding remote JavaScript, CSS, fonts, dependencies, or runtime file reads.

## Plan and Tasks

1. Add pure HTML/SVG long-session render helpers to the portable HTML renderer,
   reusing the existing reviewed `summary.usageEfficiency.longSessions.samples`
   projection.
2. Insert the trace cards into Project usage and add responsive, print-safe,
   no-JavaScript-compatible CSS for disclosure and horizontal overflow.
3. Extend HTML validation so retained trace samples require accessible,
   self-contained chart output with exact call counts and no host-only routes.
4. Add Codex lifecycle and HTML behavior regressions, then verify the rendered
   report in a narrow browser viewport.

## Test and Review Evidence

- AC-1/AC-2/AC-3/AC-4: `node --test test/session-analysis.test.mjs
  test/harness-report-render-cli.test.mjs` passed 80/80 focused tests.
- AC-2/AC-3/AC-4: A real Better Harness Codex census analyzed 40 eligible
  sessions and retained four complete traces with 1,154, 529, 324, and 261 tool
  calls. The 2,268-point HTML was 725,247 bytes, rendered in 82.6 ms, passed the
  HTML contract, and retained all calls without truncation.
- AC-5: Headless Chrome at 640 px loaded the real report in 68.7 ms and expanded
  the 1,154-point chart in 82.3 ms; the 14,068 px SVG scrolled inside a 518 px
  card while the document stayed 640 px wide, with no console or page errors.
  Desktop width also had no document overflow or browser errors.
- AC-5: `node --test test/doc-link-graph.test.mjs` passed 6/6, `npm test`
  passed 1,313/1,313, and `npm run pack:verify` passed with 473 npm entries and
  495 runtime zip entries.
- Privacy risk: renderer output must remain a projection of already validated
  fields and must escape every visible or accessible label.
- Compatibility risk: reports without samples or with legacy samples lacking a
  trace must remain readable and valid.
- Layout risk: complete traces can be wide; overflow must stay inside each trace
  card and must not widen the report viewport.
