# Memory composer and source context

## Traceability
- Spec ID: memory-composer-context
- Status: Implemented
- Request: remove duplicated More settings, merge the two footer rows into the
  Memory input and show the file context used by the analysis.

## Intent
Give Memory one bounded input surface and make the supplied source visible in
its conversation without claiming an Agent performed a filesystem read.

## Acceptance Scenarios
- AC-1: Model/mode/reasoning controls appear once. More contains only additional
  options and disappears when there are none; settings failures remain retryable.
- AC-2: State, Agent label, keyboard hint and Close session share a row inside the
  input. Stop, queueing, draft preservation and independent Compare inputs work.
- AC-3: After the first request starts, the transcript shows the frozen source
  title/path and source line information with a return-to-source action. It is
  labelled supplied context, not a successful Agent tool call. Changing the
  selected Memory entry never relabels the source of a running conversation.
- AC-4: Explicit tool file locations are visible when tools are collapsed and
  remain linked to their own status. No filesystem reads or inferred paths.
- AC-5: Wide, compact, narrow, light/dark, keyboard, overflow and error checks pass
  in the browser, followed by a Studio build and local Desktop refresh if idle.

## Non-goals
Changing Memory access, snapshot limits, ACP permissions, source content,
workspace indexing, publishing, packaging or committing.

## Plan and Tasks
1. Remove core settings from More and retain extra-option search.
2. Let the shared composer own its caption and caller-specific session controls.
3. Add supplied-source disclosure to the transcript; expose declared tool paths.
4. Extend settings and Memory browser tests, and preserve the Compare work.

## Test and Review Evidence
- AC-1: a 22-model fixture with only core options renders one model control and
  no More popup. The extra-option fixture retains Fast mode, retryable errors and
  keyboard dismissal without duplicating Model.
- AC-2: Memory tests verify the status, Agent name and Close session inside the
  input, plus Stop, subsequent turns, retained drafts and no external footer row.
  Compact Memory exposes keyboard instructions on the input rather than a second
  footer row. Shared conversation/queue/IME/attachment tests continue to pass.
- AC-3: Memory fixtures inspect the actual sent prompt and the frozen transcript
  source. Switching the reader leaves the source tied to General Tips; Open source
  selects that original tab. The source record identifies supplied context.
- AC-4: one path projection now feeds collapsed tool titles, Compare and mentions.
  The prior CSS hid every tool summary; only ordinary argument summaries remain
  hidden. A browser assertion verifies the file path has a visible width.
- AC-5: light/dark screenshots reviewed at wide/compact/narrow sizes, with visible
  focus, bounded overflow and no page/console errors. The 10 Memory scenarios and
  the affected conversation/stream/Compare suites passed. Studio build, 30 focused
  unit tests and eight document-link tests passed; independent Desktop smoke
  passed with native NSXPC and a sandboxed renderer.

## Review Readiness Check
The request and the opened source are confirmed scope evidence. The existing
server `memoryAnalysisPrompt` supplies the frozen line-numbered snapshot; this
change exposes that source without introducing a file read or claiming an Agent
read it. User controls, errors and capability checks remain. Tests cover the
More duplication and original-context navigation. AI: Codex implementation.
No commit, package or installation was made; the existing desktop Debugger
conversation was preserved while a separate temporary Desktop smoke ran.
