# Studio AI Elements integration

## Traceability

- Spec ID: studio-ai-elements
- Status: Implemented
- Request: use Vercel AI Elements to unify Desktop Studio's ACP, Compare and AI analysis UI.

## Intent

Make ACP conversations consistent across Compare Live, Debugger and Memory AI
analysis by adopting the AI Elements source components. Preserve the existing
ACP transport, control authority, retained evidence and Studio design tokens.

## Acceptance Scenarios

- AC-1: All three surfaces render the same AI Elements conversation, message,
  tool and confirmation components. Thought events and observed plan steps use
  Chain of Thought; suggestions fill an editable draft without sending it.
- AC-2: Assistant text is visible before completion. User text, thought events,
  tool input/output, rich ACP content, truncation and partial evidence remain
  distinguishable. Interrupted or missing tool results never appear successful.
- AC-3: New content follows the bottom until the reader scrolls up. Back to
  latest restores following and keyboard focus. Switching conversations
  preserves each reading position and tool disclosure state.
- AC-4: Permission actions retain the exact request/option ids and ACP option
  kinds. Pending submissions cannot repeat; failures remain visible and
  retryable. Compare lanes act independently. Read-only transcripts cannot
  acquire mutation controls.
- AC-5: Wide (1440x900), compact (1024x768) and narrow (390x844) layouts have
  bounded content, visible primary actions and keyboard focus. Dark/light,
  reduced motion, rich payloads and browser console/page errors are checked.
- AC-6: Upstream origin/license and local adaptations are recorded. Only used
  dependencies ship; installation does not replace the workbench theme, ACP
  runtime, or existing Markdown/code rendering pipeline.

## Non-goals

New model providers or host adapters; AI SDK transport migration; changing
retained Compare evidence/count semantics; desktop packaging/installation;
commits, releases or unrelated staged work.

The [prompt and streaming follow-up](2026-09-09-studio-prompt-streaming.md)
extends this initial integration with Prompt Input and Streamdown, replacing
AC-6's original Markdown-renderer boundary. The evidence below records the
initial integration; the follow-up spec records its additional validation.

## Plan and Tasks

1. Inspect the current official registry/CLI and source components. Import the
   six selected component families under `src/app/components/ai-elements`.
2. Adapt component imports, icons and styles to Studio's Phosphor icons and
   semantic CSS tokens. Keep a small component surface with source provenance.
3. Project ACP state into display states in a pure adapter. Integrate shared
   timeline/stream/permission components and contextual draft suggestions.
4. Extend behavioral tests for state mapping, streaming, permission retries,
   reading/disclosure persistence, suggestions and responsive visual evidence.
5. Run Studio build/type checks, focused browser tests, document-link checks,
   Canvas preview health/runtime smoke and a Review Readiness Check.

## Test and Review Evidence

- AC-1/AC-6: AI Elements CLI 1.9.0 installed the six selected families in an
  isolated scaffold. Imported source hashes, license and adaptation boundaries
  are recorded in the [component notes](../../packages/harness-studio/src/app/components/ai-elements/README.md).
  Only Radix Collapsible and use-stick-to-bottom are new direct dependencies.
  The built app includes the component stylesheet and upstream license.
- AC-2/AC-4: 42 tests passed across `ai-elements-adapter`, `acp-session-state`,
  `run-store`, `tool-call-model`, `acp-run-actions` and `design-tokens`.
- AC-1–AC-5: 35 Playwright tests passed across `acp-session-stream`,
  `acp-conversation`, `acp-debugger`, `memory-workbench` and `tool-call`.
  This includes first-chunk visibility, rich content, failed/truncated results,
  retryable permissions, multiple Compare lanes, read-only history, IME,
  suggestions, pane resizing and the local macOS NSXPC ACP fixture.
- AC-3: the 253-entry reading-position/disclosure test passed five consecutive
  repetitions after fixing scroll-controller mount order and giving upward
  movement priority over same-frame resize reconciliation.
- AC-5: screenshots inspected at 1440x900, 1024x768 and 390x844 for Compare,
  Debugger and Memory. Browser checks cover focus, bounded overflow, light/dark,
  reduced motion and 200% reflow. Memory's 10 tests passed again after adding
  a token-based wait for dark-theme transitions before screenshot capture.
- `npm run build -w @qoder-ai/harness-studio` and TypeScript checks passed.
- `npm run smoke -w @qoder-ai/better-harness-desktop` passed: Electron renderer
  sandbox, HTTP authorization, directory-picker behavior, distinct service
  process, NSXPC runtime and clean shutdown; no renderer errors.
- Native test prerequisite: build evidence-host with the installed Rust 1.96.0
  toolchain and set `BETTER_HARNESS_EVIDENCE_HOST` to the resulting executable.
  The previously staged binary did not support `memory.discover`; tests used
  the freshly built release binary, without changing the installed desktop.
- Eight document-link tests passed; regenerating the routing graph produced no
  diff. `git diff --check` passed.
- Canvas preview: the existing port 58575 returned HTTP 200 for `/health` and
  `/canvas-module.js`. A separately started `npm run preview -- --port 58576`
  also returned 200 for both, loading the Canvas SDK runtime and TSX transform.
- Risks: scroll library behavior during incremental content, mismatched ACP/AI
  SDK status vocabularies, focus after permission completion, bundle expansion,
  and preserving the existing staged Memory/ACP work. Test platform-neutral
  browser behavior locally; Windows/Linux native qualification remains separate.
- AI involvement: this spec and implementation are authored with Codex.

## Review Readiness Check

- User request is the visible scope evidence; no Story or tracker id was supplied.
- Shared source components, ACP adapters, localized suggestion text, asset-copy
  rules and behavioral tests match the acceptance scenarios. Obsolete tool and
  scroll styles were removed; retained Compare metrics and transports are intact.
- Generated changes are limited to the dependency lock and upstream provenance
  receipt. Upstream Apache-2.0 copyright and license are retained.
- Existing Memory/ACP work was preserved. This migration is an unstaged local
  change; no commit, push, release, desktop package or installation was made.
- Local build, browser and macOS desktop evidence is confirmed. Windows/Linux
  native runs and remote CI evidence are unavailable in this task.
