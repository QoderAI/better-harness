# Render session code and diffs with language-aware tooling

## Traceability

- Spec ID: harness-studio-code-rendering
- Status: Implemented

## Intent

Replace Harness Studio's hand-built code and Before/After presentation with
dedicated, language-aware renderers. Recorded and live session evidence should
remain readable as code, preserve exact source text, and use bounded work so a
collapsed Tool Call or an unopened Diff does not eagerly tokenize unrelated
content.

This change also closes the real-session usability and scale gaps found while
loading historical JSONL: restore a 13px body / 12px metadata / 14px primary
action floor, keep Live and Recorded on one semantic phase vocabulary, and
bound server parsing, browser state updates, list DOM, and minimap DOM.

The implementation follows the existing Qoder workspace boundary: use
`@pierre/diffs` for read-only patch rendering and Shiki core with the JavaScript
regex engine plus lazily loaded grammars for code highlighting. CodeMirror and
Monaco remain editor dependencies and are not appropriate for this read-only
surface.

## Acceptance Scenarios

- AC-1: Recorded file changes render through `@pierre/diffs` as a real split
  patch with line numbers, addition/deletion backgrounds, word-level changes,
  and language-aware tokens inferred from the changed path.
- AC-2: The Notebook and dedicated Diff view share the same Diff renderer and
  preserve the existing file path, addition/deletion counts, selection, and
  read-only state boundary.
- AC-3: Expanded Tool Call input/result, terminal output, and Raw ACP JSON use a
  reusable Shiki-backed code renderer. JSON, JavaScript, TypeScript, TSX, CSS,
  HTML, and shell-family paths are recognized; unknown languages fall back to
  escaped plain text without losing content.
- AC-4: Shiki initializes once per browser session and grammar loads are cached.
  Highlighting starts only when the corresponding code surface is mounted;
  unopened Tool Calls and hidden inspector tabs are not tokenized.
- AC-5: The code renderer uses a 13px monospace floor and retains local
  scrolling/wrapping. Syntax color never replaces the semantic Diff background
  or makes the unhighlighted fallback unreadable.
- AC-6: The production build emits the heavy Diff/highlighting implementation
  and language grammars as browser chunks while preserving `assets/app.js` as
  the stable entry point served by the existing Studio server.
- AC-7: Focused tests cover language inference, plain-text fallback, token
  preservation, and patch construction. Browser verification opens both Diff
  surfaces and an expanded Tool Call, observes highlighted tokens, checks for
  page/console errors, and keeps document-level horizontal overflow absent.
- AC-8: Debugger and Experiment surfaces enforce a 13px body, 12px metadata,
  and 14px primary-action floor. Weak text uses a contrast-safe neutral rather
  than the 7–9px low-contrast prototype styling.
- AC-9: Live tool observations project to the same Explore, Change, Verify,
  and Response vocabulary as Recorded events. When Live has no Evidence Cursor,
  the Step Toolbar is absent and the UI states that stepping is unavailable.
- AC-10: Historical JSONL is parsed incrementally by the server without
  retaining raw lines. The initial response and subsequent pages return at most
  100 calls by default and reject unsafe lane ids/cursors.
- AC-11: The client merges pages by stable call id. Streaming AG-UI updates use
  a keyed store so token/result patches do not linearly scan the timeline.
- AC-12: Consecutive equivalent Tool Calls aggregate into semantic Tool Groups;
  call rows over the threshold use a fixed-window virtual list.
- AC-13: Session minimaps use at most 64 fixed bins independent of event count;
  live notebook rendering is bounded to the latest retained window.
- AC-14: Reproducible 100, 1,000, and 10,000 event gates assert bounded server
  parsing, Tool Group count, virtual DOM window size, and minimap bin count.

## Non-goals

- Adding an editable code editor, merge controls, inline commenting, or
  accept/reject patch actions.
- Highlighting arbitrary binary content, ANSI terminal emulation, or every
  language Shiki can ship.
- Changing recorded evidence, reconstructing omitted source, or claiming a
  restorable workspace checkpoint.
- Persisting a cross-process JSONL index or adding search across unloaded pages.

## Plan and Tasks

1. Restore readable typography/contrast and remove misleading Live stepping.
2. Add an incremental server JSONL index, paged endpoint, and keyed client
   merge/store seams.
3. Add Tool Group aggregation, a fixed virtual window, and fixed minimap bins.
4. Add the Qoder-aligned `@pierre/diffs` and Shiki core dependencies.
5. Add pure path/language and patch construction seams with focused tests.
6. Add lazy React renderers for split Diff and highlighted code, with explicit
   fallback states and token-preserving output.
7. Replace hand-built Diff rows and selected code blocks without changing the
   session debugger cursor/state model.
8. Enable build splitting for dynamic libraries and language grammars, then
   measure the stable entry and emitted chunks.
9. Run all three scale gates, package, browser, doc-link, and visual checks
   before marking this spec
   Implemented.

## Test and Review Evidence

- AC-1 through AC-5: focused Vitest tests for patch/language/token contracts,
  plus existing Session Debugger model coverage.
- AC-1 through AC-7: built-app Playwright flow covering Diff view, Notebook
  Diff, expanded Tool Call highlighting, overflow, and browser errors.
- AC-6: production build output inspection records `assets/app.js` and lazy
  chunk sizes; a server smoke confirms every requested chunk returns 200.
- AC-8 through AC-14: server index, keyed-store, grouping, virtual-window, and
  minimap unit tests at 100 / 1,000 / 10,000 events, plus real JSONL browser QA.
- Risk: Diff/highlight libraries can inflate the initial bundle. Keep the
  heavyweight renderer and grammars behind dynamic imports and verify emitted
  chunk boundaries.
- Risk: async highlighting can reorder or lose text. Render escaped plain text
  first and assert concatenated tokens equal the input exactly.
- Risk: third-party Diff Shadow DOM styling can conflict with the Studio
  palette. Use bounded library CSS variables and verify both split panes in the
  browser rather than relying on build success.

## Validation Record

- `npm run typecheck -w @qoder-ai/harness-studio` passed.
- `npm test -w @qoder-ai/harness-studio` passed 75 tests across 14 files,
  including 100 / 1,000 / 10,000 event gates and a 10,000-tool keyed update.
- `npm run test:browser -w @qoder-ai/harness-studio` passed four Chromium flows
  with Pierre Diff, Shiki tokens, typography floors, Live toolbar semantics,
  narrow containment, and zero captured console/page errors.
- A retained 6,210-line, 661,854,903-byte Codex JSONL session projected 2,032
  keyed events and 1,479 Tool Calls at `http://127.0.0.1:3317/`. The finished
  page exposed 1,161
  semantic groups while mounting 16 virtual rows, with 64 minimap bins,
  83,801px of accessible scroll history, and no document-level overflow.
- `npm run preview` served the Canvas preview; `/health` and
  `/canvas-module.js` both returned 200.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` completed without
  a graph diff; `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed
  six checks.
