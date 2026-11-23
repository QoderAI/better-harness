# BitFun (OpenBitFun) Partial Host Adapter

## Traceability

- Spec ID: SPEC-2026-11-23-bitfun-host-adapter
- Status: Implemented
- Upstream request: [QoderAI/better-harness#204](https://github.com/QoderAI/better-harness/issues/204)
- Native evidence: OpenBitFun `v1.0.12` (released 2026-11-20), upstream source
  read at `openBitFun/OpenBitFun@main` on 2026-11-23
  (`src/crates/assembly/core/src/infrastructure/app_paths/path_manager.rs`,
  `src/crates/contracts/core-types/src/product_identity.rs`,
  `src/crates/services/services-core/src/session/types.rs`,
  `src/crates/services/services-core/src/workspace_instructions.rs`,
  `src/crates/execution/agent-runtime/src/skills/roots.rs`,
  `src/crates/services/services-core/src/session/metadata_store.rs`,
  `docs/features/agent-hooks.md`)

## Intent

Add OpenBitFun (referred to as BitFun below) as a partial, source-local host so
Better Harness can read BitFun session evidence and configured-asset inventory
through the existing contracts instead of inventing a parallel path. The
adapter covers the first slice requested in #204: configuration metadata plus
workspace-associated session evidence, mapped onto existing evidence contracts,
and emitted through an existing report mode (portable HTML with a companion
Markdown report).

## Non-Goals

- No BitFun install shell, plugin manifest, npm metadata root, or generated host
  artifact. BitFun discovers skills from its own roots; this spec only documents
  them.
- No plugin lifecycle profile. Like Kimi Code, Grok, and DSH, BitFun is an
  unmanaged host here, so lifecycle targets keep rejecting `bitfun` with
  `UNKNOWN_HOST`.
- No Asset Practices, Checkup, neutral Harness report preparation, or Evidence
  Bundle claim. The capability descriptor lists only session analysis,
  configured assets, and portable HTML rendering.
- No write, migration, repair, or cleanup of BitFun state. All collection is
  read-only.
- No claim over remote SSH workspaces, the BitFun Tauri/Web UI state, SQLite
  stores (`memories.sqlite`, `coordination.sqlite`), cron/miniapp data, or
  BitFun plugin package execution.

## Evidence Format

BitFun keeps three storage families apart, and the adapter must not flatten
them:

- Product home: `~/.openbitfun`, overridden by `OPENBITFUN_HOME`. Sessions live
  below `~/.openbitfun/projects/<24-hex-runtime-key>/sessions/<session-id>/`.
- User root: platform config directory plus the `openbitfun` namespace —
  `~/Library/Application Support/openbitfun` on macOS, `~/.config/openbitfun`
  on Linux, `%APPDATA%\openbitfun` on Windows — overridden by
  `OPENBITFUN_USER_ROOT`. It holds `config/app.json`, `config/hooks.json`,
  `agents/`, and `data/`.
- Project root: `<workspace>/.openbitfun` with `config/`, `agents/`, `rules/`,
  `skills/`, and `plugins/`.

Observed session layout below a session directory:

- `metadata.json`: `{ schema_version, metadata }`, where `metadata` carries
  `sessionId`, `sessionName`, `sessionKind`, `modelName`, `createdAt`,
  `lastActiveAt`, `workspacePath`, optional `projectWorkspacePath`, and
  `workspaceHostname`. Timestamps are Unix milliseconds. Metadata files are
  authoritative; `index.json` is a rebuildable cache and is not read.
- `turns/turn-%04d.json`: `{ schema_version, turn }` where `turn` is a
  `DialogTurnData` with `turnId`, `turnIndex`, `timestamp`, `kind`
  (`user_dialog` / `manual_compaction` / `local_command`), `userMessage`,
  `modelRounds`, `tokenUsage`, `finishReason`, `hasFinalResponse`, `error`,
  and `status`.
- Each model round carries `textItems`, `toolItems`, and `thinkingItems`.
  A tool item has `toolName` plus `toolCall { id, input }` and an optional
  `toolResult { result, success, resultForAssistant, error }`.
- `artifacts/transcript.txt` is an export, not the source of truth, and stays
  unread.

Observed configured-asset surfaces:

- Skills: `<user skills dir>/<name>/SKILL.md` with the managed builtin subtree
  `.system`, where the user skills dir is
  `~/Library/Application Support/openbitfun/skills` on macOS,
  `~/.local/share/openbitfun/skills` (or `$XDG_DATA_HOME`) on Linux, and
  `%APPDATA%\openbitfun\skills` on Windows. Project skills come from
  `.openbitfun/skills` plus the shared `.agents/skills`.
- Agents: markdown frontmatter files under `<user root>/agents` and
  `.openbitfun/agents`.
- Rules: `.openbitfun/rules/`, plus workspace instruction files
  `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`, `.claude/CLAUDE.md`, and
  `CLAUDE.local.md` that BitFun reads for compatibility.
- Hooks: `<user root>/config/hooks.json` and
  `<workspace>/.openbitfun/config/hooks.json`, using the documented
  `{ hooks: { <Event>: [{ matcher, hooks: [{ type: "command", command }] }] } }`
  document.
- MCP: `app.json` stores MCP servers under the snake_case top-level
  `mcp_servers` key whose value is `{ "mcpServers": { ... } }`. BitFun also
  reads compatibility skill roots for Claude Code, Codex, Cursor, OpenCode,
  `.agents`, DSH, and Pi; this adapter inventories only the native and
  `.agents` roots so other hosts' assets are not double-counted.

## Acceptance Criteria

- AC1: `node scripts/session-analysis.mjs sessions --platform bitfun
  --workspace <path>` discovers session directories under
  `<home>/projects/*/sessions/*` by scanning `metadata.json`, admits only
  sessions whose `workspacePath`, `projectWorkspacePath`, or
  `executionTarget.rootPath` matches the requested workspace scope, skips hosts
  whose `workspaceHostname` is not `localhost`, and honours `--bitfun-home`,
  `--home`, and `OPENBITFUN_HOME`.
- AC2: Normalized events cover user messages, assistant text items, tool calls
  with invocation ids, tool results with success state and result facts, per-turn
  token usage when `tokenUsage` is present, and explicit metadata for thinking,
  non-dialog turn kinds, turn errors, and unknown records. Missing usage stays
  unobserved rather than zero, and facts output leaks neither prompt text nor
  home paths.
- AC3: `better-harness agent-customize inventory --provider bitfun` inventories
  user skills (excluding `.system`), user agents, user hooks, user MCP servers
  from `app.json`, project `.openbitfun` skills/agents/rules/hooks, shared
  `.agents/skills`, and the workspace instruction files, while reporting
  BitFun plugins and non-inventoried config surfaces as unsupported.
- AC4: Shared registries accept `bitfun` wherever the claimed slices are routed:
  the host descriptor catalog, the configured-asset provider map, the
  session-analysis platform registry and help, the agent-customize CLI home
  option, and the portable HTML render platform list. Help snapshots stay in
  sync, and capability-mapping tests catch a claimed slice without an
  implementation or the reverse.
- AC5: The adapter matrix (canonical README, docs site page, and its zh-Hans
  copy), the platform reference note, and the sessions diagnostics page
  document BitFun with its limitations; the doc-link graph and docs tests pass.

## Plan / Tasks

1. `docs/specs/2026-11-23-bitfun-host-adapter.md`: record the host contract,
   the claimed and unavailable slices, and the acceptance ids.
2. `scripts/agent-customize/providers/bitfun.mjs`: resolve the product home and
   user root with documented overrides, inventory user and project primitives,
   and parse `app.json` MCP servers without serializing env values.
3. `scripts/session-analysis/platforms/bitfun.mjs`: scan project runtime
   directories for metadata-qualified sessions, read turns in order with the
   workspace preflight budget, and normalize events into the shared contract.
4. Register `bitfun` in `scripts/host-support/index.mjs` with only the three
   claimed capabilities, then thread it through the provider map, the platform
   registry, help text, and the agent-customize summary.
5. Tests: deterministic synthetic fixtures for session discovery, workspace
   rejection, event normalization, usage observation, configured-asset
   inventory, home overrides, and help/routing contracts.
6. Docs: adapter matrix row and paragraph, docs site table row and per-host
   section, zh-Hans mirror, platform reference page, and sessions diagnostics.

## Test and Review Evidence

- AC1-AC2: `npx vitest run test/sessions/session-analysis-providers.test.mjs`
  covers workspace-qualified discovery, foreign-workspace and remote-host
  rejection, turn ordering, tool call/result correlation, sparse usage, and
  unknown-event accounting.
- AC3: `npx vitest run test/agents/agent-customize.test.mjs` covers user and
  project inventory, `.system` skill exclusion, `app.json` MCP parsing with
  credential-shaped env keys, and the `--bitfun-home` CLI override.
- AC4: host-support, provider/registry equality, help snapshot, and render
  platform tests fail if the descriptor and the implementations drift.
- AC5: `node scripts/doc-link-graph/cli.mjs skills/better-harness`,
  `npx vitest run test/skills-docs/doc-link-graph.test.mjs`, `npm test`,
  `npm run pack:verify`, and `git diff --check`.
- Native smoke: not performed in this change. The adapter is fixture-verified
  against the documented layout only, so the matrix lists BitFun as a partial
  adapter with no install, lifecycle, or Quickstart claim.

Residual risk: BitFun's runtime project directory name is a 24-hex key derived
from workspace identity, and the derivation is not part of the public contract.
The adapter therefore trusts `metadata.json` workspace fields instead of
reimplementing the hash. If a future release stops writing `workspacePath`, or
starts writing sessions with a non-`localhost` hostname for local workspaces,
discovery degrades to reporting no sessions rather than guessing. Turn files
that use an unknown item shape are preserved as metadata events, so a schema
addition stays visible instead of being silently dropped.
