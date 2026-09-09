# AI Elements in Studio

Source components from [Vercel AI Elements](https://github.com/vercel/ai-elements),
licensed under Apache-2.0 (see `LICENSE`). `provenance.json` records the fetched
registry source hashes, PR patch hash and CLI version. The initial components were installed
with `npx ai-elements@latest add conversation message chain-of-thought tool
confirmation suggestion` in an isolated shadcn scaffold, then adapted here.
Streamdown and its CJK plugin also carry Copyright 2023 Vercel, Inc. and the
same Apache-2.0 license text, retained in `LICENSE` and the built app's
`assets/ai-elements.LICENSE`.

Local changes are deliberate:

- Studio semantic CSS tokens and Phosphor icons replace Tailwind/Lucide styles;
  native controls use the workbench's existing focus, density and theme rules.
- Conversation retains `use-stick-to-bottom`; the ACP view adds per-session
  reading-position restoration and keyboard focus after Back to latest.
- Chain of Thought and Tool use Radix Collapsible. Chain's trigger and content
  share one root so `aria-controls` points at the actual content.
- Message accepts Studio's bounded Markdown and ACP rich-content renderers.
  MessageResponse uses Streamdown 2.6 and its CJK plugin for streaming and
  settled Markdown. Studio supplies code highlighting and semantic HTML styles;
  Streamdown code/math/Mermaid plugins are not imported. Raw HTML is skipped,
  external images stay inert, and links use Studio's explicit navigation boundary.
  Unused branching/download helpers are omitted.
- Tool accepts explicit localized labels and rendered input/output slots. Its
  state vocabulary adds interrupted and unavailable outcomes for ACP evidence.
- Confirmation shows the server's actual permission options, with the existing
  request identity, submission lock and retry behavior owned by the ACP gate.
- Suggestions use native bounded scrolling and fill drafts without submitting.
- Prompt Input was fetched from the official registry and adapted manually. Its
  textarea/body/header/footer/submit composition is shared by Compare, Debugger
  and Memory. ACP still owns file validation, draft persistence and queue actions;
  automatic reset is replaced by clearing only after a successful ACP response.
- Caret-bound completion follows [PR 448](https://github.com/vercel/ai-elements/pull/448),
  which was open and unmerged at retrieval. Studio uses a bounded listbox, native
  textarea IME handling and plain-text insertion. Slash commands come from ACP;
  mentions come from observed tool locations and attachments, with no implied
  file read or workspace indexing.

These components have no ACP networking or model-provider dependencies. Runtime
events are projected by `run/ai-elements-adapter.ts` and the shared stream view.
An AI Elements UI adoption does not require an AI SDK transport migration.

To update, fetch the selected registry into an isolated scaffold, compare the
recorded original hashes and upstream changes, and reapply the adaptations.
Do not run the full registry installer over Studio's theme. Verify the ACP
session-stream, conversation and Memory browser suites after upgrading.
