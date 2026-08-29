# Augment session evidence in Harness Inspector

## Traceability

- Spec ID: augment-session-inspector-support
- Status: Implemented

## Intent

Allow Harness Inspector and the shared session-analysis commands to inspect
workspace-qualified Augment/Auggie sessions from the local Augment cache. The
adapter must expose only provider-observed messages, tool lifecycle, token
accounting, context-window occupancy, timestamps, and explicit history-summary
boundaries. Missing or ambiguous evidence remains unobserved instead of being
inferred from field names or represented as zero.

The native contract for this slice was observed from Auggie CLI `0.36.0`
(`@augmentcode/auggie`, commit `7c61e5bb`) and its local `~/.augment/sessions`
records. Deterministic tests use synthetic, redacted fixtures rather than copied
local transcripts.

## Acceptance Scenarios

- AC-1: `session-analysis` discovers JSON sessions under the default
  `~/.augment/sessions` root and an explicit `--augment-home`, but admits only
  sessions whose recorded workspace folder, repository root, or terminal cwd
  matches the requested workspace. POSIX and Windows path semantics are covered
  without splitting native paths on `/`.
- AC-2: One Augment exchange produces bounded user and assistant observations,
  correlated tool call/result events, and one model response per native
  `token_usage` node. Native timestamps and ids preserve chronology without
  counting content, thinking, tool, or history-summary nodes as model calls.
- AC-3: Observed input, output, cache-read, and cache-creation counters remain
  separate. Prompt occupancy is derived only from the additive prompt lanes,
  `max_context_tokens` supplies the same-response window, and absent usage or
  window fields remain unobserved rather than zero.
- AC-4: A native `history_summary_node` produces one explicit compaction
  boundary without exporting summary text. Context shrink remains a measured
  delta; a shrink without that marker is not relabelled as provider-confirmed
  compaction.
- AC-5: Raw prompts, assistant content, thinking, history summaries, tool input,
  and tool output are omitted by default. Existing explicit content flags may
  expose only the bounded fields already owned by the shared session-analysis
  privacy contract.
- AC-6: `augment` is registered only for the session-analysis capability and is
  accepted by `session-analysis` and Harness Inspector help/dispatch. Other host
  capabilities continue to reject it rather than falling through to another
  provider.
- AC-7: Focused provider, workspace-isolation, usage/context, host-catalog,
  Inspector, documentation-link, and package-boundary checks pass. A bounded
  real-host smoke records the installed version and aggregate evidence without
  persisting private transcript content.

## Non-goals

- Adding an Augment plugin shell, configured-asset inventory, Checkup support,
  lifecycle mutation, installation instructions, or public Quickstart status.
- Inferring parent/child or subagent ownership from `rootTaskUuid`,
  `subAgentCreditsUsed`, filename proximity, or session timestamps.
- Treating the session-level current model setting as attribution for every
  historical response.
- Reverse-engineering encrypted thinking, history-summary text, billing data,
  credits, prices, or remote Augment APIs.
- Claiming Windows, macOS, or Linux native-host verification from deterministic
  path fixtures alone.

## Plan and Tasks

1. Add an Augment platform adapter under
   `scripts/session-analysis/platforms/augment.mjs` with a local-home override,
   bounded JSON discovery, workspace qualification, privacy-safe normalization,
   and visible malformed-source diagnostics.
2. Register the session-only host identity in the host catalog and capability
   loader/help surfaces used by session-analysis and Harness Inspector.
3. Add deterministic provider fixtures covering direct/foreign workspaces,
   Windows paths, usage/context, tool correlation, explicit compaction,
   missing evidence, malformed JSON, and default privacy behavior.
4. Document the partial support boundary and reproducible read-only commands in
   the host adapter matrix.
5. Run focused and full validation, then update this spec status only when the
   recorded evidence supports it.

## Test and Review Evidence

- AC-1 through AC-5: `npx vitest run test/sessions/session-analysis-augment-provider.test.mjs`
- AC-6: `npx vitest run test/sessions/session-analysis-providers.test.mjs test/plugins/host-support.test.mjs test/cli/better-harness-cli.test.mjs`
- AC-6 and AC-7: focused Harness Inspector tests selected from the changed
  registration and report path.
- AC-7: `node scripts/doc-link-graph/cli.mjs skills/better-harness`
- AC-7: `npx vitest run test/skills-docs/doc-link-graph.test.mjs`
- AC-7: `npm test`
- AC-7: `npm run pack:verify`
- AC-7: `git diff --check`
- AC-7 native smoke: run `auggie --version`, then read-only `sources`,
  `sessions`, and a bounded Inspector render against the local Augment home;
  report missing workspace matches as unobserved rather than success.

Implemented evidence on 2026-08-29:

- `npm run check` passed on Node 24: root 1589 tests, Harness 173 tests,
  Harness UI 31 tests, Harness Studio 494 tests, generated-source checks, and
  package verification (607 npm entries; 869 runtime-zip entries).
- The English and Simplified Chinese Docusaurus production builds completed,
  and the documentation link graph remained current.
- Auggie `0.36.0` (commit `7c61e5bb`) exposed six workspace-qualified native
  sessions in a bounded local smoke. A selected native session projected 26
  unique usage nodes as 26 model calls and 29 tool-use nodes as 29 calls.
- A second native session exposed two request-lane `history_summary_node`
  records, both normalized as explicit compaction boundaries without summary
  text.
- The Inspector rendered two native sessions, including user-prompt time,
  response time, a 200K context window, additive processing lanes, and Usage &
  Context details. Wide and 390px visual checks had no console errors or
  horizontal overflow.

Risk notes:

- The local Augment schema is not a public compatibility promise. Unknown node
  types remain metadata and malformed files produce bounded diagnostics so a
  future host update degrades visibly.
- A session file can be large. Discovery reads remain file-count bounded and
  selected-session hydration remains governed by the shared selection limit.
- Workspace folders and terminal cwd may be absent. Such sessions are excluded
  rather than joined to the requested project by title or prompt content.
