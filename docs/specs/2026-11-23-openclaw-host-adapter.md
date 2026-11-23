# OpenClaw Configured-Assets Host Adapter

## Traceability

- Spec ID: SPEC-2026-11-23-openclaw-host-adapter
- Status: Implemented
- Upstream request: [QoderAI/better-harness#114](https://github.com/QoderAI/better-harness/issues/114)
- Documentation baseline: `docs.openclaw.ai` product docs read on 2026-11-23
  (`concepts/agent-workspace`, `tools/skills`, `tools/mcp`). No native OpenClaw
  install was inspected or smoked.

## Intent

Add OpenClaw as a partial, source-local host so Better Harness can inventory the
configured assets an OpenClaw agent actually loads — skills, MCP servers, and
workspace instruction files — through the existing configured-asset contract,
and emit results through an existing report mode. Issue #114 asked for harness
runs and agent customization inside an OpenClaw session; the configured-asset
slice is the part this repository can read without decoding a host database.

## Non-Goals

- No session-evidence adapter. OpenClaw keeps live sessions and transcripts in
  per-agent SQLite (`agents/<agentId>/agent/openclaw-agent.sqlite`), which this
  repository does not decode, and `openclaw sessions export-trajectory` requires
  a running Gateway with owner approval and writes into the workspace it
  exports. Neither is an adapter input.
- No OpenClaw install shell, plugin manifest, npm metadata root, or generated
  host artifact.
- No plugin lifecycle profile. Like Kimi Code, Grok, and DSH, OpenClaw is an
  unmanaged host here, so lifecycle targets keep rejecting `openclaw` with
  `UNKNOWN_HOST`.
- No Asset Practices, Checkup, neutral Harness report preparation, or Evidence
  Bundle claim. The descriptor lists only configured assets and portable HTML
  rendering.
- No write, migration, repair, or cleanup of OpenClaw state. Collection is
  read-only.
- No inventory of plugin packages, cron jobs, internal hooks, daily memory
  notes, sandboxed workspaces, or MCP header/env values.

## Evidence Format

OpenClaw separates two storage families, and the adapter must not flatten them:

- State directory: `~/.openclaw`, overridden by `OPENCLAW_STATE_DIR` or
  `--openclaw-home`. A non-default `OPENCLAW_PROFILE` moves the default to
  `~/.openclaw-<profile>`. It holds `openclaw.json` (overridden by
  `OPENCLAW_CONFIG_PATH` or `--openclaw-config-path`), managed `skills/`, the
  `agents/<agentId>/agent/` runtime directories, and credentials.
- Agent workspace: the agent's home directory, defaulting to
  `<state-dir>/workspace`, overridden by `OPENCLAW_WORKSPACE_DIR`,
  `agents.defaults.workspace`, or `agents.entries.<agentId>.workspace`. In an
  explicit multi-agent roster, unpinned entries fall back to
  `<defaults root>/<agentId>` or `<state-dir>/workspace-<agentId>`.

Configured-asset surfaces inventoried:

- Skills: `<state-dir>/skills` managed skills, per-agent
  `agents/<agentId>/agent/workshop-skills`, personal `~/.agents/skills` (only
  when the state directory is the default), workspace `skills/`, and
  `<workspace>/.agents/skills`. Bundled host skills are excluded.
- MCP: `mcp.servers` in `openclaw.json`. A stdio server carries `command`; a
  remote server carries `url` plus `transport`, which maps onto the shared `type`
  field. `enabled: false` is preserved as a disabled entry. Env keys are named;
  values are never serialized.
- Rules: workspace `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, `MEMORY.md`,
  and `BOOT.md`.
- Config dialect: `openclaw.json` is JSON5, so the reader normalizes line and
  block comments, trailing commas, unquoted identifier keys, and single-quoted
  strings. Text it cannot normalize is reported as unparsed instead of being
  treated as an empty config.

## Acceptance Criteria

- AC1: `better-harness agent-customize inventory --provider openclaw` resolves
  the state directory and config path from `OPENCLAW_STATE_DIR`,
  `OPENCLAW_CONFIG_PATH`, `--openclaw-home`, and `--openclaw-config-path`, and
  reports the resolved paths plus the config parse state (`json`, `json5`,
  `empty`, `invalid`, `missing`, `skipped`).
- AC2: Skill inventory covers managed, per-agent workshop, personal (default
  state directory only), and workspace `skills/` plus `.agents/skills` roots,
  with managed/workshop/personal items in user scope and workspace items in
  project scope.
- AC3: `mcp.servers` entries are inventoried as MCP items with `enabled` state
  preserved, `transport` carried onto `type`, and no env value or header value
  serialized.
- AC4: The requested workspace is attributed to a configured agent through
  `agents.defaults.workspace` and `agents.entries.<agentId>.workspace`; workspace
  instruction files are inventoried as project rules only for that workspace,
  and a workspace outside every configured agent reports the skip instead of
  scanning unrelated files.
- AC5: Shared registries accept `openclaw` wherever the claimed slices are
  routed: the host descriptor catalog, the configured-asset provider map, the
  agent-customize CLI home option and summary, and the portable HTML render
  platform list. Capability tests catch a claimed slice without an
  implementation or the reverse, and lifecycle targets keep rejecting
  `openclaw`.
- AC6: The adapter matrix (canonical README, docs site page, and its zh-Hans
  copy), the README "More adapters" lists, the platform reference note, and the
  installation guide document OpenClaw with its limitations; the doc-link graph
  and docs tests pass.

## Plan / Tasks

1. `docs/specs/2026-11-23-openclaw-host-adapter.md`: record the host contract,
   the claimed and unavailable slices, and the acceptance ids.
2. `scripts/agent-customize/core/json5.mjs`: normalize the JSON5 subset
   OpenClaw configs use and return an explicit parse state.
3. `scripts/agent-customize/providers/openclaw.mjs`: resolve the state
   directory, config path, and agent workspaces; inventory user and project
   primitives; report unsupported surfaces.
4. Register `openclaw` in `scripts/host-support/index.mjs` with only configured
   assets and portable HTML rendering, then thread it through the provider map,
   the CLI options, and the summary.
5. Tests: JSON5 reader units plus deterministic fixtures for managed, workshop,
   personal, and workspace skills, MCP parsing with credential-shaped env keys,
   workspace attribution, restricted runs, unparsed configs, and the CLI
   overrides.
6. Docs: adapter matrix row and section, docs site and zh-Hans mirrors, adapters
   README, README host lists, installation guide lifecycle sentence, template
   routing row, and the platform reference note.

## Test and Review Evidence

- AC1, AC5: `npx vitest run test/agents/agent-customize.test.mjs` covers the
  CLI overrides, the parse-state reporting, and the capability-descriptor
  routing; `test/plugins/host-support.test.mjs` covers descriptor/registry
  equality.
- AC2, AC3, AC4: the same customize suite covers skill scopes, MCP items with
  enabled state and transport, workspace attribution, the outside-workspace
  skip, and restricted runs.
- AC1 (JSON5): `npx vitest run test/agents/json5-config-reader.test.mjs` covers
  comments, trailing commas, bare keys, single-quoted strings, string-embedded
  comment markers, unparsed text, and empty/missing files.
- AC6: `node scripts/doc-link-graph/cli.mjs skills/better-harness`,
  `npx vitest run test/skills-docs/doc-link-graph.test.mjs`, `npm test`,
  `npm run pack:verify`, and `git diff --check`.
- Native smoke: not performed in this change. The adapter is fixture-verified
  against the documented layout only, so the matrix lists OpenClaw as a partial
  adapter with no install, lifecycle, session, or Quickstart claim.

Residual risk: the JSON5 subset is a normalizer, not a full JSON5 parser. A
config that uses constructs outside it — an unquoted string value, a hex number
in a key position, a comment between a key and its colon — is reported as
invalid rather than guessed at, and its MCP servers stay uninventoried until the
config parses. Skill precedence and allowlists (`agents.defaults.skills`,
`agents.entries.*.skills`) are not evaluated, so a skill that exists but is
allowlisted away still appears in the inventory as a configured asset.
