# Performance call context and source navigation

## Traceability

- Spec ID: performance-call-source
- Status: Draft
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

Pending implementation. Codex authors this change. Preserve unrelated Memory edits.
Local macOS and simulated path checks do not establish other-OS runtime support.
