# WorkBuddy Best Practices

Use this file for WorkBuddy-specific operating practice. Use `../routing.md`
for host-neutral owner selection and `codex.md`/`claude.md`/`qwen.md`/`pi.md`
for other host references. Do not copy WorkBuddy-only workflow advice into
shared docs unless there is matching surface evidence.

## Operating Frame

Treat WorkBuddy as a persistent personal-assistant harness layered over a
coding agent. It keeps standing identity context (`SOUL.md`, `IDENTITY.md`,
`USER.md`) and a global `AGENTS.md` in `~/.workbuddy`, injects them into every
conversation, and persists workspace-scoped transcripts per working
directory. Move repeated guidance into the global or project `AGENTS.md`,
turn repeated work into Skills, and install shared workflows through
WorkBuddy marketplaces.

## Durable Guidance

Use `AGENTS.md` for guidance that should load automatically. WorkBuddy loads
the global `~/.workbuddy/AGENTS.md` and the identity files as standing
context before project rules:

- repo layout and important directories
- build, test, lint, and local run commands
- engineering conventions and review expectations
- safety constraints and do-not rules

Keep the identity files (`SOUL.md`, `IDENTITY.md`, `USER.md`) focused on
stable operating posture; they enter every session, so oversized identity
context taxes each turn.

## Configured Surfaces

- **Skills**: `~/.workbuddy/skills/<name>/SKILL.md` follows the Agent Skills
  standard (`name` and `description` frontmatter). User-imported skills carry
  a `_user_meta.json` install record. The shared `~/.agents/skills/` and
  project `.agents/skills/` directories are also honored.
- **Marketplace plugins**: installed under
  `~/.workbuddy/plugins/marketplaces/<marketplace>/plugins/<plugin>/` with a
  `.codebuddy-plugin/plugin.json` manifest. Enabled state lives in
  `~/.workbuddy/settings.json` `enabledPlugins` keyed as
  `<plugin>@<marketplace>`. Marketplace records live in
  `plugins/known_marketplaces.json`.
- **MCP servers**: `~/.workbuddy/mcp.json` or `~/.workbuddy/.mcp.json`
  (`mcpServers`) declares user-scope MCP servers. Marketplace plugins can
  declare plugin-scope servers through the same filenames at the plugin root.
- **Project assets**: a project `.workbuddy/` directory can carry
  `skills/`, `rules/`, and `commands/`; project `AGENTS.md` provides repo
  rules.

## Session Evidence

WorkBuddy sessions are flat JSONL records under
`~/.workbuddy/projects/<cwd-slug>/<session-uuid>.jsonl`, where the slug is
the absolute working directory with the leading separator stripped and path
separators replaced by `-`. WorkBuddy 2.x records carry `cwd`; observed 5.x
records can omit it, so the adapter admits cwd-less transcripts only from the
exact requested workspace slug and rejects prefix-only matches. Record types
include `message` (user/assistant), `reasoning`, `function_call`,
`function_call_result`, `file-history-snapshot`, `ai-title`, and
`custom-title`. Usage may use camelCase or snake_case token fields.
`WORKBUDDY_DIR` relocates the data root. Route session reads
through `scripts/session-analysis/platforms/workbuddy.mjs`; configured
presence never substitutes for observed session behavior.

## Boundaries

- `~/.workbuddy/workbuddy.db` and other binary stores are not evidence
  sources; keep claims bound to JSONL transcripts and JSON settings.
- Marketplace catalogs list availability, not use; bind plugin capability
  claims to `enabledPlugins` state plus observed session behavior.
- Connectors, automations, and memory stores are not inventoried; keep those
  claims out of readiness evidence.
- Skills and plugins can instruct or execute arbitrary actions. Review
  provenance before treating a configured asset as a safe, supported path.
