# Persistent ACP conversation runtime

## Traceability

- Spec ID: acp-conversation-runtime
- Status: Core implementation verified; remaining host integrations listed below
- Request: implement the interfaces and make every scenario in the Zed parity analysis verifiable.

## Intent

Separate session ownership, turn execution, pending input and view state. Reuse
one action contract in Compare and Debugger. Preserve optional capability gates
instead of claiming native Zed APIs exist in every ACP Agent.

## Acceptance scenarios

Use AC-01 through AC-18 in [the parity analysis](2026-09-08-acp-zed-parity-analysis.md).
For optional Agent APIs, acceptance includes the supported-driver path and an
explicit unavailable result without submitting a fabricated RPC. No unsupported
capability is silently simulated by editing the visible transcript.

## Plan

1. Add typed conversation actions/capabilities and a transport-independent session
   controller with turn identities, queue/stop/close, idempotent submissions and
   per-turn snapshots. Connect both existing executors through a bounded optional
   conversation lifecycle; single-run/Bench callers retain their current behavior.
2. Add checked server actions, session snapshots, retention and subscription
   ownership independent of mounted views.
3. Add injected UI actions, compact composer/config controls, drafts, command
   completion, attachment gates and specialized tool display.
4. Add common controller/transport fixtures, browser acceptance and a scenario
   receipt matrix. Validate current build separately from installed application.

## Non-goals

No invented agent protocol extensions, hidden workspace rewind, changes to global
provider credentials, release or publication. Native-only operations require a
capability and an implementation supplied by the connection driver.

## Evidence

In progress. The retained run id remains the compatibility envelope for the
existing Harness stream; each turn has its own id, timestamps and snapshot and
must be persisted before the next turn, not only when the connection closes.

## Implemented contract and evidence (2026-09-08)

The reusable runtime is `AcpConversation`, with injected
`AcpConversationDriver` and `AcpSessionActions`. Compare lanes and Debugger use
that same controller. Session stop, session close and turn completion are
separate operations. A new prompt reuses the session; a recovered connection
negotiates `session/load` or `session/resume` and omits the initial harness
preamble. Native and SDK paths call `session/close` only when supported.

HTTP actions validate the live run, same-origin request and Agent-offered config
values. Prompt ids make transport retries idempotent. Queue edits cannot affect
an already submitted prompt. Stop pauses queued messages, cancels outstanding
permissions and waits for the old prompt. Stop acknowledgement has a bounded
wait; explicit Close can tear down an unresponsive connection.

Each turn is saved atomically under a hashed run id before dispatching the next.
Records preserve typed content, protocol observations with their actual clock
readings, and session configuration. Recovery requires the original Project and
configured Agent. Read-only replay never exposes live controls. Live page
switches retain owner state and drafts; a page reload closes its old connection
and uses an explicit recovery action. Recovery errors retain the saved transcript
and pending input. The index lists locally retained conversations; it does not
claim to enumerate all sessions known to an Agent.

The UI has a bounded transcript, a persistent composer and compact current-value
config controls. Advanced config is disclosed on demand. Ordinary tool rows have
no empty argument/result placeholders. Multiple permissions remain individually
actionable. Text/media frames share message identity, while exactly one matching
optimistic user echo is suppressed. Saved observations remain available even if
the Agent cannot restore them.

Resource bounds: 50 queued messages, 1000 submitted ids, 4 MB per prompt, 16 MB
retained input signatures, 30 minutes idle lease, 20,000 retained event frames /
32 MB event budget. Truncated history is marked partial. Offscreen rows use CSS
content visibility; this preserves their DOM and expanded state, rather than
unmounting focused controls through list virtualization.

### Acceptance receipts

| AC | Evidence and exact boundary |
| --- | --- |
| AC-01 | Controller and browser tests assert three prompts, one `session/new`, same session id and no repeated preamble. |
| AC-02 | Two-lane browser scenarios independently change config, draft, queue and stop. |
| AC-03 | Controller and UI cover queued send, edit/remove, pause/resume and immediate send. |
| AC-04 | Text/tool fixture and two simultaneous permissions cancel; another prompt succeeds. Real Codex/Qoder cancellation also succeeds. |
| AC-05 | Deferred cancel acknowledgement prevents the next prompt; final tool update arrives before cancel response. Non-responsive cancellation has a timeout/close test. |
| AC-06 | Echo-filter tests cover chunked text with media, property-order changes and a second identical genuine message. |
| AC-07 | Emitter behavior tests assert shared ids for mixed text/image/text and distinct ids for distinct messages; rich browser rendering is covered. |
| AC-08 | Dependent effort replacement, invalid options and failed config acknowledgement are exercised by settings tests; newer observed config wins over a delayed UI acknowledgement. |
| AC-09 | Capability validation rejects unsupported media before submission. Recovery UI is gated; Agent rejection retains input. Optional driver actions require both a declaration and a handler. |
| AC-10 | Browser scenarios exercise text/file/image input, attachment deletion, IME Enter, Shift+Enter, submission failure and retry. The controller validates empty/malformed/oversized content. |
| AC-11 | Current-session `/review` completion supports keyboard selection and preserves arguments. No native command semantics are invented. |
| AC-12 | SPA navigation preserves drafts and live state. Reload shows saved observations; explicit recovery has successful load, resume fallback and rejected-Agent cases. |
| AC-13 | Each turn is read from disk before close; history uses the same projection, rich fields and actual observation timestamps. |
| AC-14 | Optional retry/rewind/checkpoint/steer interfaces have supported mock-driver and unsupported-driver tests. Standard production drivers do not advertise or simulate these native-only operations. |
| AC-15 | Existing tool, permission, diff and terminal render tests remain. Tools have compact disclosure rows; rich payload and locations remain in details. Host file open/reveal and interactive terminal control are not supplied by this change. |
| AC-16 | 1440/1024/390 screenshots, keyboard focus, Escape return, IME and a 720×450 CSS viewport (200% equivalent) are covered. This is not a manual screen-reader certification. |
| AC-17 | 250-message browser scenario preserves scroll and expanded tool state across views and follows an explicit new submission. This is bounded workload evidence, not an unbounded transcript performance claim. |
| AC-18 | Same browser conversation fixture passes Node stdio, Rust stdio and macOS NSXPC. Two real Agents each complete normal/normal/cancelled/normal turns and subsequently load that same session in a new subprocess. |

### Verification commands and results

- Harness: `npx vitest run test/acp-conversation.test.ts test/events.test.ts test/acp-sdk.test.ts` — 45 tests passed.
- Harness native: `npx vitest run --config vitest.native.config.ts test/acp-rust.native.ts` — 17 tests passed.
- Studio: `npx vitest run` — 78 files / 592 tests passed.
- Browser ACP regression: `acp-debugger`, `acp-session-controls`,
  `acp-session-stream`, `acp-conversation` — 15 cases passed before adding the
  independently passed 250-message / zoom case. Native conversation, resume
  fallback and recovery rejection have separate receipts.
- Harness and Studio TypeScript builds pass; staged Rust release build passes.
- Root preview `/health` and `/canvas-module.js`: HTTP 200 with expected content types.
- Markdown routing graph regenerated; document-link graph: 8 tests passed.
- Real-agent receipts and screenshots were retained in the local Codex task's
  `acp-conversation` artifact directory. These are local subprocess and browser
  receipts, not evidence that the installed desktop app was replaced.

- Rust host unit suite: 61 tests passed.
- Final NSXPC conversation suite: all four cases passed, including the long transcript. Rust stdio resume fallback and Agent recovery rejection also passed.

### Remaining protocol/product boundaries

This implements the common conversation lifecycle and reusable optional-action
contract, not every native Zed service. Global Agent `session/list` discovery,
provider authentication UI, workspace checkpoint/action-log integration,
subagent/elicitation extensions, model favorites/defaults, editor symbol pickers
and interactive terminal/file actions still need corresponding host adapters.
They must not be reported as working merely because an interface or a capability
name exists. Full native-Zed parity is therefore not an acceptance claim of this
change. Windows/Linux execution still needs their CI/native receipts.

### Review readiness

User request and linked analysis are the requirements; there is no supplied
Story id. This is a non-trivial AI-authored runtime/UI change, prepared for the
user-requested commit. Unrelated workflow deletion and sidebar test changes are
excluded. No push or release is included. Generated `dist` and native outputs
are local validation artifacts. The acceptance evidence above covers the common
conversation lifecycle; remaining host integrations retain explicit boundaries.
