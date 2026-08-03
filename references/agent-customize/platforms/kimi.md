# Kimi Code Configured Assets

Use this note for Kimi Code-specific configured-asset locations and evidence
boundaries. Start from [Agent Customize Routing](../routing.md) for owner
selection and [Global Coding-Agent Assets](../global-assets.md) for the shared
inventory contract.

## Static Inventory Route

```bash
<node> <better-harness-root>/scripts/agent-customize/cli.mjs inventory \
  --provider kimi \
  --workspace <absolute-target-path>

<node> <better-harness-root>/scripts/coding-agent-practices/asset-baseline.mjs kimi \
  --workspace <absolute-target-path> \
  --include-user-home \
  --format json
```

Use `--kimi-home <path>` for an isolated configuration root
(default: `~/.kimi-code`).

## Source Map

| Asset | User | Selected project | Installed Plugin |
|---|---|---|---|
| Instructions / Rules | None | `AGENTS.md`, `CLAUDE.md` (compat) | Plugin `systemPrompt`/`systemPromptPath` (plugin metadata only, never merged into rules) |
| Skills | `~/.kimi-code/skills/**/SKILL.md` | `.kimi-code/skills/**/SKILL.md`, `.kimi/skills/**/SKILL.md` (probed) | Plugin-declared `skills` roots under `~/.kimi-code/plugins/managed/<id>/` (root `SKILL.md` when undeclared) |
| MCP | `~/.kimi-code/mcp.json#mcpServers` | None | Plugin-declared `mcpServers` from `kimi.plugin.json` |
| Agents / Commands / Hooks | Custom agents (not yet inventoried) | Custom agents (not yet inventoried) | Plugin `agents`, `commands`, and `hooks` from `kimi.plugin.json` |
| Memory | No Kimi Code equivalent | No Kimi Code equivalent | No Kimi Code equivalent |

`~/.kimi-code/config.toml` holds model/provider settings, not customizable
assets; it is surfaced only as a diagnostics flag and never parsed into
inventory items.

Installed plugins are indexed in `~/.kimi-code/plugins/installed.json`; each
record points at a managed copy under `~/.kimi-code/plugins/managed/<id>/`.
The provider reads `kimi.plugin.json` first and falls back to
`.kimi-plugin/plugin.json`, inventories assets only for records with
`enabled: true` (disabled plugins stay listed without component assets), and
skips manifest-declared paths that escape the plugin root. Collection follows
symlinks, so any collected file whose realpath escapes the plugin root (for
example through a symlink inside it) is dropped from the inventory as well.

## Skill Layout And Invocation

Repository-root `skills/` is the Better Harness distribution layout, not a
Kimi Code project-level convention. The provider deliberately does not probe
it, so a workspace-only inventory can report `skills: 0` for a repository
whose skills are physically present in that root directory. A skill counts
only after installation into user scope (`~/.kimi-code/skills`) or project
scope (`.kimi-code/skills`, `.kimi/skills`).

Skills are invoked with `/skill:<name>` (for example `/skill:better-harness`)
or automatically by the model, so the skill surface doubles as the main
invocation surface. Plugins can additionally register namespaced slash
commands (`<plugin>:<command>`) from a `commands/` directory declared in
`kimi.plugin.json`; commands declared by enabled plugins are inventoried into
the Commands collection.

## Session Evidence Boundary

Session evidence comes from `scripts/session-analysis/platforms/kimi.mjs`:

- Transcripts live at `~/.kimi-code/sessions/<wd_*>/ses{sion}_*/agents/<agent>/wire.jsonl`;
  `state.json` next to them supplies title and created/updated timestamps.
- The workspace-to-`wd_*` mapping is resolved through
  `~/.kimi-code/workspaces.json` (exact `root` match) and
  `~/.kimi-code/session_index.jsonl` (per-session `workDir`). Only when both
  indexes are absent does the adapter fall back to `wd_<name>_*` directory
  prefixes, and it records a `kimi-workspace-index-absent` warning.
- Wire records are normalized from `context.append_loop_event`
  (`tool.call`/`tool.result`/`content.part`), `turn.prompt`/`turn.steer`,
  `context.append_message` (protocol 1.0), and `usage.record` token usage.
  Unknown record types degrade to bounded `metadata.*` events for forward
  compatibility (`metadata.protocol_version` is currently `1.4`).
- User text, command text, and message content stay gated behind the shared
  `includeUserText`/`includeCommandText`/`includeContent` privacy flags.
- `~/.kimi-code/credentials` and `server.token` are never read.

## MCP And Privacy Boundary

The static collector reads `mcp.json` only. Output may include server name,
transport, command, safe argument metadata, environment key names, and
direct-secret-key warnings. It must not contain environment values, header
values, URL credentials, or authentication state.
