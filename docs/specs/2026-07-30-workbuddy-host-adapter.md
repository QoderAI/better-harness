# WorkBuddy Host Adapter

## Traceability

- Spec ID: SPEC-2026-07-30-workbuddy-host-adapter
- Status: Draft

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

## Evidence Format

The adapter must preserve the observed differences between supported WorkBuddy
layouts instead of treating one fixture shape as universal:

- WorkBuddy 2.106.4 on macOS writes `cwd` into transcript records, uses
  `providerData.usage` camelCase token fields, and stores user MCP configuration
  as `mcp.json`.
- WorkBuddy 5.0.2 on macOS was locally observed with project-bound transcripts
  that omit `cwd`, use `providerData.usage` snake_case token fields on assistant
  and reasoning records, use `custom-title`, and store MCP configuration as
  `.mcp.json` at user and plugin roots.

- Session transcripts: `~/.workbuddy/projects/<cwd-slug>/<uuid>.jsonl` where
  `<cwd-slug>` is the absolute workspace path with the leading separator
  stripped and every remaining `/`, `\`, and `:` replaced by `-` (spaces and
  case preserved).
- Record shape: flat JSONL records with `id`, `parentId`, `timestamp`
  (epoch milliseconds), `type`, optional `role`, `content`, `providerData`,
  and `sessionId`; 2.106.4 records also include `cwd`, while 5.0.2 records may
  rely on the exact project-directory slug for workspace binding.
- Record types: `message` (role `user`/`assistant`, content items
  `input_text`/`output_text`), `reasoning`, `function_call` (top-level `name`,
  `callId`, JSON-string `arguments`, model + usage in `providerData`),
  `function_call_result` (top-level `name`, `callId`, `status`, `output`),
  `file-history-snapshot`, and `ai-title`.
- Usage: `providerData.usage` may carry `inputTokens`/`outputTokens` or
  `input_tokens`/`output_tokens`; optional cache fields stay unobserved when
  absent. Usage can appear on assistant, reasoning, or function-call records.
- Configured assets: `~/.workbuddy/skills/<name>/SKILL.md`,
  `~/.workbuddy/plugins/marketplaces/<marketplace>/plugins/<plugin>/` with
  `.codebuddy-plugin/plugin.json`, `settings.json` `enabledPlugins`
  (`<plugin>@<marketplace>` keys), `mcp.json` or `.mcp.json` (`mcpServers`) at
  user and plugin roots, global `AGENTS.md`, and identity files `SOUL.md`,
  `IDENTITY.md`, `USER.md`.

## Acceptance Criteria

- AC1: `node scripts/session-analysis.mjs sessions --platform workbuddy
  --workspace <path>` discovers workspace-matching WorkBuddy JSONL transcripts,
  honoring `--home`/`--workbuddy-home`/`WORKBUDDY_DIR` overrides. Records with
  `cwd` must match the workspace; records without `cwd` are eligible only from
  the exact workspace-slug directory, never from a prefix-only subdirectory
  candidate.
- AC2: Normalized WorkBuddy events cover user/assistant messages, tool calls
  with command text and file paths, tool results with success state, model
  usage totals from camelCase or snake_case fields on assistant, reasoning, and
  function-call records, and metadata records (`reasoning`,
  `file-history-snapshot`, `ai-title`, `custom-title`). Missing usage fields stay
  unobserved rather than becoming zero, and facts output leaks neither raw
  session identifiers nor home paths.
- AC3: `better-harness agent-customize inventory --provider workbuddy`
  inventories user skills, marketplace plugins with enabled state from
  `settings.json`, user and plugin MCP servers from `mcp.json` or `.mcp.json`,
  the global `AGENTS.md` rule, identity files, and project `.workbuddy` plus
  `.agents/skills` assets.
- AC4: All shared platform registries (session-analysis dispatchers,
  agent-customize CLI, better-harness CLI registry, evidence bundle contract,
  harness report run, task-loop source, asset baseline/integrity/inventory,
  lifecycle demand signals, selection profile, usage summary) accept
  `workbuddy`, thread `--workbuddy-home`, and keep help text in sync.
- AC5: The adapter matrix, references routing, sessions diagnostics, and
  architecture docs document WorkBuddy; the doc link graph test passes.

## Plan / Tasks

1. `scripts/session-analysis/platforms/workbuddy.mjs`: support embedded-cwd and
   exact-directory workspace binding, sparse camelCase/snake_case usage, and
   usage-bearing reasoning records.
2. `scripts/agent-customize/providers/workbuddy.mjs`: collect both native MCP
   filenames at user and plugin roots alongside skills, marketplaces, rules,
   and project assets.
3. Register `workbuddy` in every shared platform list and option pass-through
   (`--workbuddy-home`).
4. Docs: adapter matrix row + discovery bullet, platform reference page,
   routing, diagnostics, architecture, glossary, concepts, community, ADR,
   READMEs, CHANGELOG, host matrix docs site pages.
5. Tests: separate 2.106.4 and 5.0.2 fixtures for discovery, prefix rejection,
   sparse usage normalization, user/plugin MCP inventory, CLI override, and
   help-text contracts.

## Test and Review Evidence

- AC1-AC3: `node --test test/session-analysis-providers.test.mjs
  test/agent-customize.test.mjs` covers both observed layouts, sparse usage,
  exact-directory admission, foreign/prefix-only rejection, and MCP filenames.
- AC4: CLI help and evidence-bundle routing tests prove `--workbuddy-home`
  reaches the selected provider without scanning an unrelated home.
- AC5: regenerate and validate the doc-link graph after changing this spec.
- Full regression: `npm test`, `npm run pack:verify`, and `git diff --check`.
- Real-machine smoke on WorkBuddy 5.0.2: run `sources`, `sessions`, `facts`,
  usage summary, configured-asset inventory, and evidence bundle against an
  isolated `--workbuddy-home`; report only bounded metadata and aggregate
  counts.

Residual risk: the WorkBuddy directory slug is not injective. Transcripts that
omit `cwd` therefore qualify only from the exact requested workspace directory;
prefix-only directories remain unavailable until a stronger native workspace
identity is observed.
