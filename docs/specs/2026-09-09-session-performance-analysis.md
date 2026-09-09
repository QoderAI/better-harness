# Session performance analysis

## Traceability

- Spec ID: session-performance-analysis
- Status: Implemented; local validation
- Request: add a Sessions performance subpage after examining Qoder slow sessions; implement analysis in Rust wherever practical.

## Intent

Explain where a retained session spent time. Preserve the existing Sessions
overview and add Performance beneath Sessions. Lead with long execution and
waiting intervals, distinguishing model requests, tool dispatch, shell execution,
hooks, approval, nested agents, and missing evidence.

## Acceptance scenarios

- AC-1: Sessions exposes Overview and Performance as secondary navigation, with
  project-scoped deep links and the existing shared date filter. Selection,
  filtering, and the route survive back navigation.
- AC-2: The Rust evidence host owns Qoder execution-log discovery, event pairing,
  duration calculations, interval unions, and evidence-backed finding codes.
  Node owns transport/project binding; React owns presentation. Desktop reuses
  its existing evidence host. A host without the capability shows unavailable.
- AC-3: A Bash lifecycle of 349.182 seconds with a 108 ms shell interval shows
  both values, with dispatch wait and hooks distinct. It is never labelled as
  349 seconds of command execution.
- AC-4: A 35,308,824 ms explicit approval duration is retained even if permission
  event timestamps differ by 5 ms. Reported duration and timestamp basis remain
  visible; approval does not become command execution.
- AC-5: Concurrent hooks, tools, and nested agents are not added twice into total
  occupied time. Category totals are labelled as overlapping; the timeline
  retains containing spans and evidence identities. Unpaired/ambiguous events
  leave explicit incomplete coverage and never fabricated pairings.
- AC-6: Model start/completion uses stable request ids where possible, with a
  unique turn/loop/request-index fallback for retries. Retry signals remain
  visible. No first-token/chunk timing means TTFT and streaming stay unrecorded.
- AC-7: Session wall span, completed-turn time, approval time, and unattributed
  intervals remain distinct. Late SessionEnd does not make a completed task
  appear to have executed overnight. Date filtering uses observed activity.
- AC-8: The page provides a sortable session list, per-turn timeline, category
  filters, bounded event rows, an evidence detail pane, and explicit loading,
  empty, unavailable, incomplete, and error/retry states in English and Chinese.
- AC-9: Verify wide 1440x900, compact 1024x768, and narrow 390x844 layouts,
  keyboard selection/focus, hover/selected states, back navigation, 200% reflow,
  reduced motion, dark/light themes, overflow, and browser console/page errors.
- AC-10: File reads and response sizes are bounded, symlinks/path traversal do
  not expand workspace scope, browser requests cannot select host-home paths,
  and project changes invalidate pending responses. Native path handling uses
  Path/PathBuf and shared Windows/UNC slug rules. Return only timing metadata
  and bounded redacted labels; prompts/commands/results are not raw evidence.
- AC-11: Include observed subagent count, individual durations, cumulative work,
  interval-union time, and peak concurrency. Link explicit fork lifecycles or
  Agent tool invocations to parent spans where the evidence permits; a nested
  turn is attached only with an unambiguous identity/containment match. Do not
  count the wrapper and its child twice or confuse accumulated agent time with
  elapsed parent waiting. Unlinked subagent evidence remains explicit.

- AC-12: Follow the requested macOS Storage composition: one segmented time bar
  and compact category rows, with timing notes and execution records collapsed.
  Every segment and row expands proportional category details and calls inline;
  the overview and sibling categories remain present. The bar represents combined
  category activity time with category-internal interval unions, and separately
  states observed elapsed time. Categories can run concurrently. Subagent rows
  show actual union time even when all work overlaps another category; deeper
  call proportions use labelled cumulative invocation time. Rust computes both
  bases. Validate against the actual better-harness Qoder corpus.

## Non-goals

New Coding Agent adapters, changing existing session/commit analysis, upstream
Qoder instrumentation, network/service internals diagnosis, automatic tuning,
publishing, installing, or changing release metadata. Other agents have explicit
timing coverage boundaries; this first detailed timing adapter is Qoder.

## Plan and tasks

1. Add a bounded `sessions.performance` capability to the existing Rust evidence
   host, using independent performance modules rather than extending the legacy
   session summary schema or duplicating analysis in JavaScript.
2. Cover timing semantics with synthetic logs representing the inspected Qoder
   cases, plus malformed/missing/concurrent data and native path fixtures.
3. Add a typed Studio timing contract and project-bound read-only API, reuse the
   desktop host, and wire the development launcher to a built native service.
4. Add a secondary Sessions route and a docked performance workbench, reusing
   DESIGN.md tokens and the existing Phosphor icon set. Keep category labels and
   evidence accessible without hover; paginate long lists instead of mounting
   the full event corpus. Compact hides the trailing evidence pane until a row
   is selected; narrow navigates list -> session -> evidence with visible Back.
5. Build and exercise Rust, transport/API, routing and browser tests. Re-run the
   representative local Qoder corpus through the actual Rust binary, then
   review readiness against this spec and the changed-file boundary.

## Test and review evidence

Local validation: Rust performance semantics (11 tests), Studio build/typecheck,
focused API/transport/routing/i18n/project/scale tests (38 tests), and native-backed
Playwright Storage overview/drilldown checks at 1440x900, 1024x768 and 390x844.
Chinese/dark mode, keyboard entry and focus restoration, reduced motion and 200%
zoom also exercised. Screenshots are in the ignored Studio test-results directory.
The real Qoder corpus contains 141 sessions; prior model/tool/hook timings match
the native output. Root preview health and Canvas module returned HTTP 200;
doc-link graph tests passed (8 tests). No installed Desktop or non-macOS runtime
claim is made. The implementation was authored with Codex in this task.

Review readiness: user request is the visible scope evidence; no Story id was
provided. This spec covers the native analyzer, server binding and Storage UI.
The commit scope excludes release/version metadata and unrelated customization
work. Missing native support, timing coverage and concurrent work
have explicit representations.

Risk: request ids can change on retry; loop identities can collide across nested
agents; permission events may be emitted at completion; hooks may lack unique
command ids; lifecycle completion can lag actual tool execution. These are
coverage/basis facts, not grounds for guessing a more specific cause. Missing
native binary or older native capability must remain visible. Local macOS
execution and simulated Windows path tests are not Windows/Linux runtime proof.

The user authorized committing this feature after reviewing the live preview.
The commit includes only this feature's implementation, spec, and tests.
