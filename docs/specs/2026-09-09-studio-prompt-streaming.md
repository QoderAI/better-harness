# Studio prompt input and streaming Markdown

## Traceability

- Spec ID: studio-prompt-streaming
- Status: Implemented
- Request: refine the unified AI UI, use Streamdown, and improve input based on
  [AI Elements issue 179](https://github.com/vercel/ai-elements/issues/179) and
  [PR 448](https://github.com/vercel/ai-elements/pull/448).

## Intent

Give Compare, Debugger and Memory one coherent composer and render formatted
assistant responses during generation. Keep ACP submission and queue semantics.

## Acceptance Scenarios

- AC-1: A shared Prompt Input shell groups a growing textarea, attachment/context
  chips, compact settings and one trailing Send/Queue/Save action. Stop remains
  available while generating; Close remains accessible with lower emphasis.
- AC-2: Observed ACP slash commands and session file references use a filtered
  listbox with descriptions, active descendant, arrows, Enter/Tab selection and
  Escape dismissal. Selection replaces only the trigger range at the caret.
  IME confirmation never selects or submits. Shift+Enter inserts a line break.
- AC-3: Files can be selected, pasted or dropped within the composer. Capability
  and 2 MB validation remain. Failed sends retain drafts and attachments; queue
  editing, immediate send, idempotent retries and per-session isolation persist.
- AC-4: Streamdown renders incomplete Markdown while generating and settled
  content consistently, including CJK, tables and existing code highlighting.
  Unsafe links, raw HTML and remote images retain Studio's rendering boundary.
- AC-5: Wide, compact, narrow, dark/light and reduced-motion browser checks show
  visible focus/actions, bounded overflow, usable suggestion lists and no errors.

## Non-goals

Workspace indexing, implicit file reads from mentions, rich-editor dependencies,
ACP transport changes, host adapters, packaging, installation and publishing.
Mentions insert a plain-text reference to files already observed in the session.

## Plan and Tasks

1. Adapt AI Elements Prompt Input composition and PR 448's plain-text suggestion
   model to Studio tokens, Phosphor icons and ACP-controlled drafts.
2. Use the shared input in Compare setup, Debugger setup/follow-up and Memory.
3. Integrate Streamdown and its CJK plugin, reusing Studio code highlighting.
4. Test editing/submission, incomplete Markdown and responsive real browser UI.

## Test and Review Evidence

- AC-1–AC-5: 36 Playwright tests passed across `acp-conversation`,
  `acp-session-stream`, `acp-debugger`, `memory-workbench` and `tool-call`.
  The final input refinements also passed focused reruns covering the setup
  dialog, Compare setup and the completion/Markdown scenario.
- AC-2/AC-3: completion replaces only the caret range, preserves suffix text,
  supports pointer/Arrow/Tab/Enter selection, dismisses on Escape and ignores
  IME confirmation. Drafts, retries, queue actions, file selection/drop and
  attachment references are exercised through actual ACP fixture sessions.
- AC-4: a protocol-gated incomplete response proves formatted CJK, headings,
  tables and TypeScript highlighting before message completion and after it.
  No raw script executes, unsafe URL becomes inert and no remote image request
  occurs. ACP partial/truncation evidence remains outside Markdown repair.
- AC-5: screenshots reviewed at 1440x900, 1024x768 and 390x844, in light/dark
  and reduced motion. Focus is owned by the input shell; controls keep their
  individual keyboard focus. Popups and internal scrolling stay bounded.
  Narrow Debugger Agent selection occupies its own row to keep the name legible.
- 45 unit tests passed in seven focused suites, including command/reference
  matching, Windows/UNC text preservation, ACP state/actions and design tokens.
- Studio build/typecheck passed. Electron smoke passed with a sandboxed renderer,
  authorized HTTP, NSXPC service and no renderer errors. This does not qualify
  an installed Desktop package or Windows/Linux native hosts.
- Eight document-link checks passed; routing graph regeneration left no diff.
  Canvas preview was started at 58577; `/health` and `/canvas-module.js` returned
  HTTP 200 on both 58577 and the existing 58575 preview. `git diff --check` passed.
- Risks covered: IME/caret behavior, popup clipping, protocol retry preservation,
  rendering untrusted Markdown and preserving prior local work. Streamdown and
  CJK are new runtime dependencies; existing highlighting is reused without the
  Streamdown code/math/Mermaid plugins or a rich-editor runtime.
- AI involvement: Codex implementation and review in this task.

## Review Readiness Check

- The user's follow-up and the opened upstream issue/PR are scope evidence.
  No local Story id or remote CI result was supplied or inferred.
- Shared input, localized copy, Streamdown rendering, fixture cases and tests
  map to the acceptance scenarios. Source provenance records PR 448 as unmerged,
  along with its patch hash; this is a local adaptation, not an upstream release.
- The package lock and upstream receipt are the generated changes. New Markdown
  docs resolve; Vercel copyright and Apache-2.0 license are retained in the build.
- Earlier AI Elements changes remain intact. All changes are local and unstaged;
  no commit, push, version change, Desktop package or installation was made.
