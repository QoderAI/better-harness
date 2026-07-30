# WorkBuddy Host Adapter

## Traceability

- Spec ID: SPEC-2026-07-30-workbuddy-host-adapter
- Status: Implemented

## Intent

Add WorkBuddy as an analysis-capable source-local host so Better Harness can
collect WorkBuddy session evidence and configured-asset inventory with the same
privacy, selection, and reporting boundaries as the existing Codex, Cursor,
Qwen, and Pi hosts. WorkBuddy stores workspace-scoped JSONL transcripts under
`~/.workbuddy/projects/<cwd-slug>/<session-uuid>.jsonl` and configured assets
under `~/.workbuddy` (skills, marketplace plugins, MCP config, global
`AGENTS.md`, identity files).

## Non-Goals

- No WorkBuddy install shell, plugin manifest, or npm-packaged host artifact.
  WorkBuddy installs skills through its own `~/.workbuddy/skills` and
  marketplace surfaces; this spec only documents that path.
- No `docs/adapters/workbuddy.md` split file; the host enters the shared
  adapter matrix row only.
- No WorkBuddy-side write, migration, or cleanup behavior. All collection is
  read-only.
- No parsing of `~/.workbuddy/workbuddy.db` or other binary stores; JSONL
  transcripts and JSON settings are the only evidence sources.

## Evidence Format (observed on WorkBuddy 2.106.4, macOS)

- Session transcripts: `~/.workbuddy/projects/<cwd-slug>/<uuid>.jsonl` where
  `<cwd-slug>` is the absolute workspace path with the leading separator
  stripped and every remaining `/`, `\`, and `:` replaced by `-` (spaces and
  case preserved).
- Record shape: flat JSONL records with `id`, `parentId`, `timestamp`
  (epoch milliseconds), `type`, optional `role`, `content`, `providerData`,
  `sessionId`, and `cwd`.
- Record types: `message` (role `user`/`assistant`, content items
  `input_text`/`output_text`), `reasoning`, `function_call` (top-level `name`,
  `callId`, JSON-string `arguments`, model + usage in `providerData`),
  `function_call_result` (top-level `name`, `callId`, `status`, `output`),
  `file-history-snapshot`, and `ai-title`.
- Usage: `providerData.usage` carries `inputTokens`, `outputTokens`,
  `inputTokensDetails[].cached_tokens`; `message.usage` mirrors it in
  snake_case.
- Configured assets: `~/.workbuddy/skills/<name>/SKILL.md`,
  `~/.workbuddy/plugins/marketplaces/<marketplace>/plugins/<plugin>/` with
  `.codebuddy-plugin/plugin.json`, `settings.json` `enabledPlugins`
  (`<plugin>@<marketplace>` keys), `mcp.json` (`mcpServers`), global
  `AGENTS.md`, and identity files `SOUL.md`, `IDENTITY.md`, `USER.md`.

## Acceptance Criteria

- AC1: `node scripts/session-analysis.mjs sessions --platform workbuddy
  --workspace <path>` discovers workspace-matching WorkBuddy JSONL transcripts,
  honoring `--home`/`WORKBUDDY_DIR` overrides, and rejects transcripts whose
  embedded `cwd` belongs to another workspace.
- AC2: Normalized WorkBuddy events cover user/assistant messages, tool calls
  with command text and file paths, tool results with success state, model
  usage totals, and metadata records (`reasoning`, `file-history-snapshot`,
  `ai-title`) without leaking raw session identifiers or home paths in facts
  output.
- AC3: `better-harness agent-customize inventory --provider workbuddy`
  inventories user skills, marketplace plugins with enabled state from
  `settings.json`, MCP servers from `mcp.json`, the global `AGENTS.md` rule,
  identity files, and project `.workbuddy` plus `.agents/skills` assets.
- AC4: All shared platform registries (session-analysis dispatchers,
  agent-customize CLI, better-harness CLI registry, evidence bundle contract,
  harness report run, task-loop source, asset baseline/integrity/inventory,
  lifecycle demand signals, selection profile, usage summary) accept
  `workbuddy` and keep help text in sync.
- AC5: The adapter matrix, references routing, sessions diagnostics, and
  architecture docs document WorkBuddy; the doc link graph test passes.

## Plan / Tasks

1. `scripts/session-analysis/platforms/workbuddy.mjs`: session analyzer with
   `workspaceToWorkbuddySlugVariants`, transcript probing, and event
   normalization (modeled on the Pi and Claude adapters).
2. `scripts/agent-customize/providers/workbuddy.mjs`: configured-asset
   collector for skills, marketplace plugins, MCP, rules, and project assets.
3. Register `workbuddy` in every shared platform list and option pass-through
   (`--workbuddy-home`).
4. Docs: adapter matrix row + discovery bullet, platform reference page,
   routing, diagnostics, architecture, glossary, concepts, community, ADR,
   READMEs, CHANGELOG, host matrix docs site pages.
5. Tests: provider fixtures for discovery, normalization, isolation, and
   inventory; registry/help-text updates in contract tests.

## Test Evidence

- `npm test` (full suite) passes locally.
- `node --test test/session-analysis-providers.test.mjs
  test/agent-customize.test.mjs` covers AC1-AC3.
- Real-machine smoke: `node scripts/session-analysis.mjs sessions --platform
  workbuddy --workspace <workspace with local WorkBuddy sessions>`.
