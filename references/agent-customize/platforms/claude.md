# Claude Code Configured Assets

Use this note for Claude Code-specific configured-asset locations and evidence
boundaries. Start from [Agent Customize Routing](../routing.md) for owner
selection and [Global Coding-Agent Assets](../global-assets.md) for the shared
inventory contract.

Official references:

- Hooks: https://code.claude.com/docs/en/hooks
- Skills: https://code.claude.com/docs/en/skills
- MCP: https://code.claude.com/docs/en/mcp-quickstart
- Plugins: https://code.claude.com/docs/en/plugins-reference
- Instructions and Memory: https://code.claude.com/docs/en/memory

## Static Inventory Route

```bash
<node> <better-harness-root>/scripts/agent-customize/cli.mjs inventory \
  --provider claude \
  --workspace <absolute-target-path>

<node> <better-harness-root>/scripts/coding-agent-practices/asset-baseline.mjs claude \
  --workspace <absolute-target-path> \
  --include-user-home \
  --format json
```

Use `--claude-home <path>` and `--claude-state <file>` for an isolated
configuration root and state file. `CLAUDE_CONFIG_DIR` is honored when no
explicit home is supplied.

## Source Map

| Asset | User | Selected project | Installed Plugin |
|---|---|---|---|
| Instructions / Rules | `~/.claude/CLAUDE.md`, `~/.claude/rules/**/*.md` | `CLAUDE.md`, `.claude/CLAUDE.md`, `CLAUDE.local.md`, `.claude/rules/**/*.md` | Not a default Plugin component |
| Skills | `~/.claude/skills/**/SKILL.md` | `.claude/skills/**/SKILL.md` | default `skills/` plus manifest-declared Skill paths |
| Agents | `~/.claude/agents/*.md` | `.claude/agents/*.md` | default `agents/` or manifest-declared agent paths |
| Commands | `~/.claude/commands/*.md` | `.claude/commands/*.md` | default `commands/` or manifest-declared command paths |
| Hooks | `~/.claude/settings.json` | `.claude/settings.json`, `.claude/settings.local.json` | `hooks/hooks.json`, manifest path, or inline manifest object |
| MCP | top-level `.claude.json#mcpServers` | `.mcp.json` plus exact `.claude.json#projects[workspace].mcpServers` | `.mcp.json`, manifest path, or inline manifest object |
| Plugins | `~/.claude/plugins/installed_plugins.json` | install scope/project path plus `enabledPlugins` settings | component files below the installed root |

Arbitrary nested workspace `.claude/skills` discovery and package inheritance
remain a workspace-topology concern. Do not widen a repository walk merely
because a Claude asset exists below one package.

## Hook Interpretation

Claude Hook `timeout` values are seconds. Better Harness normalizes them to
`timeoutMs` and keeps event, matcher, handler type, async state, safe command
display, configuration digest, and bounded local script path. Raw prompt text,
HTTP headers, command arguments, and Hook configuration values are not report
evidence.

Configured Hook types include `command`, `http`, `mcp_tool`, `prompt`, and
`agent`. Type and registration prove configuration only. Observed execution,
blocking, latency, or successful output requires session/audit evidence.

## Plugin Truth And Activation

Use `installed_plugins.json` as installation evidence. Marketplace clones and
cache directories without a matching record are catalogs or cached source, not
installed Plugins.

For the selected workspace, combine the install record's scope/project path
with `enabledPlugins` from local, project, and user settings in that precedence
order. Keep disabled or non-applicable Plugins visible in direct Manage
inventory, but exclude their child assets from the public configured-asset
surface. A discovered or enabled Plugin still does not prove that one of its
Skills, Hooks, agents, commands, or MCP servers ran.

## MCP And Privacy Boundary

The static collector does not run `claude mcp list`; that command connects to
servers and belongs to an explicit runtime diagnostic. Static MCP output may
include server name, transport, redacted URL, safe argument metadata,
environment key names, and direct-secret-key warnings. It must not contain
environment values, URL credentials/query parameters, authentication state, or
unrelated `.claude.json` fields.

Raw auto-memory bodies, transcripts, OAuth data, caches, enterprise managed
settings, and CLI-session ephemeral configuration are outside the default
Agent Customize pass.
