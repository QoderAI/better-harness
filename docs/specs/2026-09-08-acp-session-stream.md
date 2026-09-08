# Reusable ACP session stream

## Traceability

- Spec ID: acp-session-stream
- Status: Implemented
- Request: improve the Compare ACP flow using the supplied ACP/AHP gap analysis and local VS Code source.

## Intent

Compare and Debugger should share one session stream with readable messages,
inspectable tools, explicit pending decisions, and observed ACP session state.
The supplied plan is a gap analysis, not an accepted implementation plan for an
entire session manager. This change closes its incoming-update and stream UX
gaps within the current single-run Studio contract.

Reference inspected: local VS Code `chatListRenderer.ts` separates thinking,
tool invocations and confirmation states; `chatWidget.ts` retains whether the
reader is at the bottom. Adopt those interaction boundaries without importing
VS Code code or AHP channels. The installed ACP v1 SDK schema owns update shapes;
its `plan_update` and `plan_removed` variants are explicitly unstable.

## Acceptance Scenarios

- AC-1: Compare and live ACP Debugger render the same reusable stream component.
  It receives state and action callbacks; it does not own agent selection,
  project routing, or launch requests.
- AC-2: Responses and collapsible thoughts retain arrival order; tools disclose
  input/result and terminal status, including late tool updates. The submitted
  prompt remains visible after the composer changes.
- AC-3: Valid incoming plan snapshots, usage/context and reported cost, commands,
  current mode, config values and session metadata are projected incrementally.
  Empty snapshots clear state; absent metadata is never invented. Malformed,
  truncated and unsupported updates do not crash or masquerade as full support.
- AC-4: Each lane owns its permission queue and pending action. Decisions are
  never auto-approved, duplicates are disabled while sending, HTTP failures
  remain visible and retryable, and terminal runs clear obsolete decisions.
- AC-5: Appended content and progressive text follow only while at the bottom.
  Scrolling back preserves position; a keyboard-accessible latest button resumes
  following. Completed/error streams settle busy message/tool state.
- AC-6: Concurrent lanes fold independently, duplicate launch is prevented, and
  failed or prematurely closed streams keep partial evidence and show failure.
- AC-7: Wide, compact and narrow layouts have bounded overflow, visible focus,
  actionable permission controls, and no console/page errors. Shared styles use
  existing semantic tokens and both English and Chinese labels.

## Non-goals and remaining gaps

Cross-restart session catalog/load/resume/delete, multi-turn/fork, auth, outgoing
rich attachments, MCP hosting, mode/config mutation, PTY, AHP, and ACP v2 remain
separate host/API work. Commands/config are observed state, not enabled actions.
Protocol evidence is bounded/redacted; this projection does not promise complete
session persistence, and agent-reported cost is not billing verification.

## Plan and Tasks

1. Add validated ACP observation projection under Studio `app/run` and fold it
   at the existing sequenced protocol-event boundary (both Node and Rust).
   Emit thought text through the normal message framing with optional
   `role: "thought"` from both executors; role transitions close the previous
   message. Keep it out of the executor's final answer and retain its identity
   in saved Debugger records. This avoids merging independently scheduled wire
   evidence and transcript callbacks into one apparent conversation order.
   Accept the native serde enum's snake_case tool fields in the Rust bridge,
   retaining compatibility with camelCase client fixtures.
2. Extract reusable timeline entries and a session stream; compose it from
   Compare and Debugger while retaining their independent host controls.
3. Correct permission/action failure and stream completion handling.
   Mark native raw permission frames `permissionActionable: false` in the
   neutral protocol envelope; preserve their RPC evidence while only exposing
   the host-owned request as an actionable decision. The parser retains this
   optional annotation across SSE.
4. Add reducer/transport and real fixture browser tests; build and inspect
   screenshots. Review only this task's diff against the pre-existing dirty tree.

## Test and Review Evidence

- AC-1–AC-7: `npm run build --workspace=@qoder-ai/harness-studio` and Studio
  `npm run typecheck` passed. Earlier transient build failures in a concurrently
  edited Git view are superseded by this successful full build.
- AC-2–AC-4, AC-6: 28 tests passed across the Studio session projection,
  run-action, run-store, stream transport, tool payload, streaming-text and
  retained-record transform tests. Another 25 Harness event/protocol/SDK tests
  passed, including the existing
  serialization/lifecycle contracts. Projection tests exercise Node and Rust
  response shapes, empty snapshots, malformed values, independent permission
  queues, wire-only permissions, late tool input/result, and thought settlement.
- AC-1, AC-4–AC-7: 10 Playwright tests passed in `acp-debugger.spec.mjs` and
  `acp-session-stream.spec.mjs`. The runtime attachments confirmed Node stdio,
  the staged native Rust host, and the staged macOS NSXPC service. These are
  fixture-agent receipts, not installed commercial-agent qualification.
- AC-2–AC-4: both rich-stream browser tests also passed with the staged Rust
  stdio host explicitly selected through `STUDIO_TEST_ACP_HOST`. The native
  executor regression passed both tests and covers serde tool fields, message/thought/tool order,
  final output excluding thoughts, and non-actionable raw permission evidence
  through both stdio and NSXPC.
- AC-2, AC-7: the existing keyboard-expandable failed/truncated Tool Call browser
  regression also passed after extracting the shared entry renderer.
- AC-5: rich stream tests passed twice consecutively after exercising progressive
  text growth, upward reading, continued streaming without position theft and
  keyboard return to latest. A later error-placement adjustment passed the full
  10-test browser set above.
- AC-7: reviewed Compare and Debugger screenshots at 1440×900, 1024×768 and
  390×844, including light/dark themes. Assertions cover console/page errors,
  keyboard focus, document/transcript overflow and non-overlapping stacked lanes.
  The expected 503 responses in failure/retry tests are explicitly excluded from
  console-error counting. Reduced-motion preference disables progressive reveal.
- Additional ego-browser inspection of the shared Debugger stream at 200% CSS
  zoom retained a 1200px document in a 1200px viewport and a readable completed
  fixture response. This is CSS zoom evidence, not a native browser zoom test.
- Preview: `npm run preview` found the existing server on 58575; `/health` and
  `/canvas-module.js` both returned 200. No existing preview process was stopped.
- Documentation: routing graph regenerated with no diff; all 8 doc-link tests
  passed. `git diff --check` passed.

### Review readiness

This is a user-requested maintenance feature without a supplied Story id.
The spec and observed tests cover the scoped diff. AI assistance is explicit in
this Codex task and the commit co-author. The user authorized committing this
change after implementation validation; no push, installation or release is
included. Concurrent work touched the composer, shell, Git view and customization
view; those changes were preserved and are outside this review.

Screenshots are retained under the task's `acp-session-stream` visualization
directory. Tests accept `STUDIO_TEST_APP_DIR` so an isolated application build
can be used while other local tasks rebuild the shared distribution.

Risk: raw protocol evidence can be incomplete. Projection accepts known shapes,
preserves the redaction boundary and reports incompleteness. Native OS host
qualification remains distinct from local browser/fixture evidence.
