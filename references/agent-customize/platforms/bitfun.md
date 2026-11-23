# BitFun Best Practices

Use this file for BitFun (OpenBitFun) specific operating practice. Use
`../routing.md` for host-neutral owner selection and the other `platforms/`
files for different hosts. Do not copy BitFun-only layout advice into shared
docs unless there is matching source evidence.

## Operating Frame

BitFun is a Rust runtime with a desktop front end. Treat its storage as three
separate families, because the runtime itself does:

- **Product home**: `~/.openbitfun`, relocated by `OPENBITFUN_HOME`. Sessions
  live here.
- **User root**: the platform config directory plus `openbitfun`, relocated by
  `OPENBITFUN_USER_ROOT`. Holds `config/app.json`, `config/hooks.json`, and
  `agents/`.
- **Project root**: `<workspace>/.openbitfun`. Holds `config/`, `agents/`,
  `rules/`, `skills/`, and `plugins/`.

Move repeated guidance into project `AGENTS.md` or `.openbitfun/rules/`, turn
repeated work into Skills, and keep user-wide assets in the user root rather
than a project directory.

## Durable Guidance

BitFun loads `AGENTS.override.md`, `AGENTS.md`, `CLAUDE.md`,
`.claude/CLAUDE.md`, and `CLAUDE.local.md` from the repository. Keep always-on
facts, build/test/lint commands, conventions, and do-not rules in `AGENTS.md`;
use `.openbitfun/rules/` for topic files that should stay workspace-scoped.

## Configured Surfaces

- **Skills**: the user skills directory follows the platform data root
  (`~/Library/Application Support/openbitfun/skills` on macOS,
  `~/.local/share/openbitfun/skills` or `$XDG_DATA_HOME` on Linux,
  `%APPDATA%\openbitfun\skills` on Windows). The builtin `.system` directory is
  host-managed and is not user-configured inventory. Project skills live in
  `.openbitfun/skills/` and the shared `.agents/skills/`.
- **Agents**: user `<user root>/agents/*.md` and project
  `.openbitfun/agents/*.md` are subagent profiles.
- **MCP servers**: `config/app.json` stores a snake_case top-level
  `mcp_servers` whose value is `{ "mcpServers": { ... } }`. Treat env values as
  credentials: name the server, never the secret. A bare server map is accepted
  so a hand-edited file does not silently disappear.
- **Hooks**: `config/hooks.json` with `{ "hooks": { "<Event>": [ { "matcher",
  "hooks": [ { "type": "command", "command" } ] } ] } }` at the user and project
  roots.
- **Project assets**: `.openbitfun/` carries skills, agents, rules, and hooks.
  Compatibility skill roots owned by other hosts (`.claude`, `.codex`,
  `.cursor`, `.opencode`, `.dsh`, `.pi`) stay out of this scope.

## Session Evidence

Sessions are persisted per project key under
`~/.openbitfun/projects/<runtime-key>/sessions/<session-id>/`, with
`metadata.json` as the workspace identity and one `turns/turn-%04d.json` file
per turn. `index.json` is rebuildable cache and `artifacts/transcript.txt` is an
export, so neither is evidence. The runtime project key is a host-owned hash:
read `metadata.json` instead of reimplementing it, and treat a
`workspaceHostname` that is not `localhost` as remote. Route session reads
through `scripts/session-analysis/platforms/bitfun.mjs`; configured presence
never substitutes for observed session behavior.

## Boundaries

- Plugin packages, `agent_profiles.json`, `agent_subagents.json`,
  `mode_skills.json`, and `tool_permissions.json` are not inventoried; keep
  capability claims out of them.
- Remote SSH workspaces, memories/coordination SQLite stores, cron jobs, and
  miniapps are outside the adapter.
- No install shell or plugin lifecycle profile exists for BitFun here; a
  `/better-harness` run needs the skill copied or linked into the native skill
  root manually.
