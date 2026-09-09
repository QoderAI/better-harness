# Performance call context and source navigation

## Traceability

- Spec ID: performance-call-source
- Status: Implemented; local validation
- Request: show identifiable Waiting calls and navigate source file/line references; bound reads for long JSONL logs.

## Intent

Identify the invocation behind a wait and inspect its recorded event in context.
Extend the metadata-only boundary of session-performance-analysis for explicit
source inspection and bounded, redacted invocation summaries.

## Acceptance scenarios

- AC-1: Calls show the recorded command or argument summary with ordinal fallback
  when absent. Waiting retains its timing category and duration semantics.
- AC-2: Source references are keyboard-operable. Activation opens a read-only
  Shiki view with original line numbers, adjacent lines, and the target line
  highlighted and scrolled into view. Escape closes source first and returns focus.
- AC-3: Fetch only on activation; Rust reads the selected discovered session file,
  scans incrementally with byte/line limits, stops after the context, and returns
  at most seven lines with per-line truncation. No full-log browser load or
  repeat performance analysis. Loading, failure/retry and truncation are explicit.
- AC-4: Same-origin/project revision checks apply. Browser input cannot choose a
  host home or arbitrary filesystem path; symlinks and traversal remain rejected.
  Redact credentials and private paths before returning previews or source text.
- AC-5: Native/API tests cover summaries, source numbering/bounds/missing lines and
  invalid scope. Browser checks cover calls, source switching, keyboard focus,
  highlighting, overflow and screenshots at wide/compact/narrow sizes.

## Non-goals

Editing logs, new dependencies, changing timing accounting, installing Desktop,
committing or publishing.

## Plan and tasks

1. Add bounded call summaries to native span facts, including linked wait phases.
2. Add native source-window reads through the existing project-bound API.
3. Reuse HighlightedCode with optional line numbering/target-line support; add
   source navigation to the evidence pane and concise bilingual states.
4. Run focused Rust/API/browser checks, build/typecheck, preview smoke and doc links.

## Test and review evidence

Codex authored the implementation. Local Rust performance tests passed (14),
Studio API tests passed (9), code highlighting/rendering and i18n tests passed
(10), Studio build/typecheck passed, and doc-link checks passed (8). Root preview
health and Canvas module returned HTTP 200. Browser tests exercise native-backed
wide/compact/narrow views, original line positions, source switching, focus
restoration, lazy reads and failure/retry. Dark Chinese 200% reflow is also checked.

The actual requested session and source line 44 were opened in a dark browser:
seven lines rendered, line 44 selected, no console/page errors. Its invocation is
`git --no-pager log --oneline -8`. Five native source-window reads took 4.1–4.5 ms
on this Mac, scanned 15,021 bytes, and returned 3,054 bytes. A 128 MiB synthetic
file required only 15 scanned bytes for its early five-line window. These are
bounded-read observations, not general latency guarantees.

Review readiness: the user request supplies scope; no Story was supplied. This
spec intentionally extends the earlier metadata-only source boundary. Native
source reads bypass analysis, retain path checks, cap scanning at 32 MiB, cap
retained lines at 16 KiB, and cap displayed lines at 4,096 characters. New UI
uses existing semantic tokens and Shiki. Shared HighlightedCode retains its
plain-text fallback for existing consumers. Unrelated Memory/server work was
left alone. Source windows are excerpts of the current file; moved, missing or
changed logs may no longer match an earlier timing snapshot.

Local macOS and simulated path checks do not establish Windows/Linux runtime
support. No installed Desktop validation was performed.
