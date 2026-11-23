# OpenClaw Best Practices

Use this file for OpenClaw specific operating practice. Use `../routing.md` for
host-neutral owner selection and the other `platforms/` files for different
hosts. Do not copy OpenClaw-only layout advice into shared docs unless there is
matching source evidence.

## Operating Frame

OpenClaw separates two storage families, and a workspace is an agent home rather
than a code checkout:

- **State directory**: `~/.openclaw`, relocated by `OPENCLAW_STATE_DIR` or
  `--openclaw-home`. Holds `openclaw.json`, managed skills, credentials, and
  per-agent runtime state. A non-default `OPENCLAW_PROFILE` moves the default to
  `~/.openclaw-<profile>`.
- **Agent workspace**: the agent's home directory, holding `AGENTS.md` and its
  sibling instruction files plus workspace skills. Default
  `<state-dir>/workspace`, relocated by `OPENCLAW_WORKSPACE_DIR`; per-agent
  overrides live in `agents.entries.<agentId>.workspace`.

Because the workspace *is* the agent home, project-scope assets belong there,
not in an arbitrary repository. Put standing instructions in `AGENTS.md`, tone
and boundaries in `SOUL.md`, and repeated procedures in Skills.

## Durable Guidance

OpenClaw loads `AGENTS.md`, `SOUL.md`, `USER.md`, `IDENTITY.md`, and `BOOT.md`
from the workspace at session start, and `MEMORY.md` in a private main session
only. `memory/YYYY-MM-DD.md` files are daily logs, so keep durable rules in
`AGENTS.md` and let memory tooling own the daily files.

## Configured Surfaces

- **Skills**: precedence for one workspace runs `skills/`, then
  `.agents/skills/`, then personal `~/.agents/skills` (default state only), then
  `<state-dir>/skills` managed skills, then per-agent
  `agents/<agentId>/agent/workshop-skills`. Bundled skills ship with the host and
  are not user-configured inventory. `agents.defaults.skills` and
  `agents.entries.<agentId>.skills` narrow the allowlist.
- **MCP servers**: `openclaw.json` stores them under `mcp.servers`. A stdio
  server carries `command`; a remote server carries `url` plus `transport`.
  `enabled: false` keeps a definition without starting it. Treat env and header
  values as credentials: name the server, never the secret.
- **Config dialect**: `openclaw.json` is JSON5. Comments, trailing commas,
  unquoted keys, and single-quoted strings are expected, so read it through
  `scripts/agent-customize/core/json5.mjs` and report an unparsed config instead
  of treating it as empty.
- **Not configured inventory**: plugin packages, cron jobs, and internal hooks
  have no inventory contract here.

## Session Evidence

Live sessions and transcripts are stored in per-agent SQLite
(`agents/<agentId>/agent/openclaw-agent.sqlite`) plus the shared state database,
and this repository does not decode host databases. `agents/<agentId>/sessions/`
holds legacy migration inputs and archive artifacts, not a live transcript
stream. `openclaw sessions export-trajectory` is not an adapter input: it needs a
running Gateway with owner approval and writes into the workspace it exports.
Treat OpenClaw as configured-assets only until a documented, read-only session
format exists.

## Boundaries

- No install shell or plugin lifecycle profile exists for OpenClaw here; a
  `/better-harness` run needs the skill copied or linked into a native skill
  root manually, and lifecycle targets reject `openclaw` with `UNKNOWN_HOST`.
- Per-agent roster fields outside `agents.entries` and
  `agents.defaults.workspace` are not resolved.
- Daily memory notes, sandboxed workspaces under the state directory, and remote
  workspaces are outside the adapter.
