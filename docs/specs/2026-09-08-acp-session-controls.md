# Complete ACP session controls and evidence

## Traceability

- Spec ID: acp-session-controls
- Status: Implemented and verified
- Request: investigate missing tool counts and complete ACP session UI, including
  model, reasoning effort and other agent-defined settings.
- Story: no issue or tracker identifier was supplied.

## Intent

An ACP lane exposes the settings its agent actually supports, applies changes to
that same session, and renders supported session evidence without duplicate Mode
labels or losing tools when only partial updates arrive.

## Acceptance Scenarios

- AC-1: Audit the installed ACP v1 schema against both executors, the server and
  shared view, with local Zed and VS Code references. Distinguish optional
  negotiated client services and unstable APIs from stable session UI.
- AC-2: Select, grouped select and boolean config options preserve ids, labels,
  descriptions, category, current values and choices. Prefer configOptions over
  legacy modes. Unknown option types remain non-actionable.
- AC-3: Model, reasoning effort, mode and custom options can be changed on an
  active session. Requests are validated, serialized, scoped per lane, and only
  acknowledged state is displayed; failures are visible and retryable. Legacy
  mode-only agents use session/set_mode.
- AC-4: Users can prepare lanes and configure them before sending their prompt.
  Cancellation/disconnection releases preparation waits and session controls.
- AC-5: Tool counts use unique ACP tool ids, including update-only and permission
  first tools. Status-only updates preserve content. Rich content, diffs, file
  locations, user messages and terminal evidence remain inspectable; unsupported
  or bounded content is explicit. No duplicate assistant text is introduced.
- AC-6: Settings occupy a compact disclosure with labelled native controls;
  context usage remains read-only. No latest button appears without transcript
  content. Wide, compact, narrow, light/dark, keyboard and reduced-motion checks
  pass. Long session titles do not dominate the transcript.
- AC-7: Transport tests cover Node and the staged Rust stdio/NSXPC bridge.
  Real-agent evidence is recorded separately from fixtures and source builds.

## Plan and Tasks

1. Capture the protocol capability matrix and reproduce missing transcript/counts.
2. Preserve config schemas and introduce a public session-control callback in
   executors, with checked Studio action routes and optional preparation barrier.
3. Add shared controls and complete session content projection/rendering.
4. Add behavioral regression tests, build, run browser fixtures and inspect UI.

## Protocol Audit

Sources: [ACP v1 schema](https://agentclientprotocol.com/protocol/v1/schema),
[config options](https://agentclientprotocol.com/protocol/session-config-options),
[tool calls](https://agentclientprotocol.com/protocol/v1/tool-calls), installed
`@agentclientprotocol/sdk/schema/schema.json`, local Zed
`crates/agent_ui/src/config_options.rs` and `crates/agent_servers/src/acp.rs`, and
VS Code `agentHostLanguageModelProvider.ts` / `agentHostSessionHandler.ts`.
VS Code's host protocol is AHP; its model picker is a UX reference, not ACP wire
compatibility evidence. Zed confirms category-driven controls and replacement of
all config options after a successful set, rather than optimistic field patches.

| ACP surface | Previous gap | Current behavior |
| --- | --- | --- |
| `configOptions`, `config_option_update`, `session/set_config_option` | Values reduced to text; option schema and live control unavailable | Shared checked schema and native controls; select/grouped select/boolean; option/choice descriptions; full response replacement including model-dependent reasoning choices |
| `modes`, `current_mode_update`, `session/set_mode` | Duplicate Mode and no edit path | Config options take precedence; legacy available modes remain selectable when configOptions is absent |
| `session/new` then `session/prompt` | Prompt immediately began before UI could configure | Choosing an Agent prepares its session for inline configuration; independent per-lane Send prompt; ordinary Run remains immediate |
| `agent_message_chunk`, `agent_thought_chunk` | Only text projected; separate message ids could merge | Canonical content events; role separation and message-id framing; completed text uses the existing safe Markdown renderer |
| `user_message_chunk` | No retained message view | User content retained separately and excluded from assistant response counts and response stop conditions |
| `tool_call`, `tool_call_update` | Permission-first tools delayed; rich fields lost | Unique-id canonical tools before permission decisions; update-only calls; partial merges; title/kind/input/output/status/content/locations |
| `session/request_permission` | Permission view did not establish its referenced tool | Tool registered once by id, existing offered-option gate and retry behavior retained |
| Tool content: text, diff, terminal | Generic output could hide fields or duplicate payload JSON | Reused code diff view, file/line locations, terminal output/exit/truncation correlated from RPC evidence; snapshots remain after release |
| Message content: image, audio, resource, resource_link | No meaningful rich renderer | Bounded raster images, audio controls, embedded resource text and checked external links; unsupported media/blob content retains an explicit inspectable fallback |
| `plan` | Priority omitted | Status and priority visible; complete plan snapshots replace prior entries |
| `available_commands_update` | Input hint omitted | Names, descriptions and input hints retained in a disclosure; no unsupported command execution button |
| `session_info_update` | Only title projected, long title could dominate | Title and nullable updatedAt merged independently; expandable bounded title summary |
| `usage_update` | Context and cost already projected | Retained as read-only agent-reported usage, never treated as model configuration or inferred billing |
| Unknown extensions / truncated observations | Potential silent loss | Explicit unsupported/partial view; retained protocol evidence remains the source for unrecognized fields |

### Capability boundaries

This change completes the current single-run session settings and transcript
surfaces. It does not claim a complete ACP client implementation:

- Node initializes with no filesystem or terminal client capabilities. The Rust
  host already implements fenced filesystem and terminal services; this change
  displays their evidence and does not widen their permission roots.
- Authentication UI, elicitation, session listing/loading/resuming, outgoing
  image/audio/resource attachments, MCP server configuration and subsequent-turn
  slash-command execution require separate session-manager/composer work. These
  are not configurable numeric or select values from configOptions.
- Forking, compaction updates, plan update/remove extensions and detailed prompt
  response token usage marked UNSTABLE in the installed schema are not advertised
  as supported. Unknown session updates remain visible as unsupported evidence.
- Provider choices are authoritative. There is no hard-coded model list or
  guarantee that every agent offers a reasoning-effort setting. Changes affect
  the current session, not persistent provider defaults.

## Test and Review Evidence

- AC-1/2/3: Studio config/state/store/Markdown adapter unit tests: 25 passing;
  grouped choices, boolean validation, full response replacement, nullable
  metadata patches, retained tool snapshots and terminal RPC correlation.
- AC-3/4/5: Harness events/protocol/Node ACP tests: 27 passing; live configuration
  before prompt and revocation, text message-id boundaries, and event parsing.
- AC-3/5/7: Staged native targeted tests: six passing across stdio and NSXPC;
  config acknowledgements, rich content, legacy mode and tool order. Rust library
  tests: 61 passing. Native build used the installed Rust 1.96 toolchain.
- AC-6/7: Browser suites cover prepared model/effort/boolean changes, dependent
  options, failed updates and retry, lane isolation, permission-first counts,
  cancellation, rich messages/diffs, focus, overflow and scroll behavior at
  1440/1024/390 widths. Node and native stdio/NSXPC receipts are distinguished;
  final combined Debugger/Compare/session suite: 12 passing; a separate
  NSXPC settings/rich-content run: two passing; Rust stdio settings/rich-content
  run: two passing. No page or unexpected console
  errors in the scoped session UI checks.
- AC-7 real agents: a separate current-build Studio server used the staged Rust
  host and installed Codex ACP / Qoder ACP. Both exposed provider model and
  reasoning choices; both acknowledged Low before prompt. A read-only README
  request then finished in both lanes with one tool call and two assistant
  messages. This proves the exercised standalone build, not a reload of the
  user's already-running desktop app. No global provider settings were changed.
- `npm run build -w @qoder-ai/harness-studio` and Harness TypeScript compilation
  passed. Preview `/health` and `/canvas-module.js` both returned HTTP 200.
- Documentation link graph test: eight passing; routing graph regeneration
  produced no change. No versions, release notes, or publication were modified.

### Review readiness and risks

The evidence chain is the explicit user request, this spec and the observed test
receipts; external Story/CI status is unavailable. New public events and callback
lifecycle span Harness, Studio and native RPC code, so downstream consumers of
the event union must be rebuilt together. The callback remains optional.

Session actions accept only offered values on the active run, check origin,
serialize requests and release on cancellation. No arbitrary RPC endpoint was
added. Untrusted content is rendered with React nodes and existing Markdown/code
views; media size/type checks and explicit fallback preserve the display boundary.

The local diff also contains a concurrent Debugger Inspector density/timing task
(`RunView`, `workbench.css`, frame timing and shared i18n/store/test hunks). It is
not evidence for this spec and must not be swept into a future ACP-only commit.
Nothing is staged or committed by this task. AI contribution is explicit from
this Codex session; any future commit must carry the repository's single co-author
line. Local macOS passes do not establish installed Windows/Linux qualification.
