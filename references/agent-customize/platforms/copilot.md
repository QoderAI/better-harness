# GitHub Copilot Best Practices

Use this file for GitHub Copilot-specific operating practice. Use `../routing.md`
for host-neutral owner selection and `codex.md`/`claude.md`/`qwen.md` for other
host references. Do not copy Copilot-only workflow advice into shared docs
unless there is matching surface evidence.

## Operating Frame

Treat Copilot as a configured teammate across two surfaces: Copilot CLI and the
IDE agent. Both read the same repository instruction and Skill locations, so
durable guidance placed under `.github/` and `AGENTS.md` serves every surface.
Move repeated guidance into instructions, configure Copilot for the real
workflow, connect external systems through MCP, turn repeated work into Skills,
and automate only stable workflows through hooks.

## Prompt Shape

A strong first prompt has four parts:

- **Goal**: the change, bug, review, artifact, or decision needed.
- **Context**: files, folders, docs, examples, logs, errors, or other material
  Copilot should inspect.
- **Constraints**: architecture rules, safety limits, review standards, platform
  requirements, and do-not-touch boundaries.
- **Done when**: tests, checks, behavior, output files, or review evidence that
  prove the task is complete.

## Durable Guidance

Copilot combines every matching instruction file rather than choosing one, so
keep each file scoped and non-contradictory:

- `AGENTS.md` for repo layout, commands, conventions, and what "done" means.
- `.github/copilot-instructions.md` for Copilot-specific repository guidance.
- `.github/instructions/*.instructions.md` for path-scoped guidance. A file with
  no `applyTo` glob is never auto-applied.
- `~/.copilot/copilot-instructions.md` and `~/.copilot/instructions/` for
  personal defaults that should not live in the repository.

Keep context files short and practical. Put large or conditional detail in
linked references. When Copilot repeats a mistake, update durable guidance only
when the lesson is reusable.

## Configuration

Copilot settings cascade, with later layers overriding earlier ones: built-in
defaults, managed policy, `~/.copilot/settings.json`,
`.github/copilot/settings.json`, then environment variables and command flags.

- Keep permission and approval settings tight until a trusted workflow needs
  more access.
- Use `COPILOT_HOME` to isolate a Copilot home for testing.
- `~/.copilot/config.json` is automatically managed application state, not user
  configuration. Read it for installed-plugin metadata only.

## Skills, Agents, and Plugins

Turn a repeated workflow into a Skill when it has stable triggers, inputs,
steps, outputs, and validation. Skill and Agent resolution is first-found-wins,
and plugin-provided assets are the lowest local tier, so a project or personal
asset always wins over a plugin asset of the same name.

- Project Skills: `.github/skills/`, `.agents/skills/`, `.claude/skills/`.
- Personal Skills: `~/.copilot/skills/`, `~/.agents/skills/`.
- Custom Agents: `.github/agents/*.agent.md` and `~/.copilot/agents/`.
- Plugins resolve a manifest from `.plugin/plugin.json`, `plugin.json`,
  `.github/plugin/plugin.json`, or `.claude-plugin/plugin.json`, in that order.
  Marketplaces resolve `marketplace.json` from the equivalent roots.

Prefer marketplace installs. Direct repository, URL, and local-path installs are
deprecated in favor of `plugin@marketplace` installs.

## External Context

Use MCP when Copilot needs context or actions outside the repository. MCP servers
are configured in `~/.copilot/mcp-config.json` (user) or `.mcp.json` and
`.github/mcp.json` (project). MCP resolution is last-wins, so a plugin server
overrides a user server of the same name. Start with one or two MCP tools that
remove a real repeated cost.

## Automation

Copilot hooks load from `.github/hooks/*.json`, `~/.copilot/hooks/`, inline
`hooks` in settings, and plugin hook files. Event names accept a camelCase form
(`sessionStart`, `preToolUse`, `agentStop`) and a PascalCase form
(`SessionStart`, `PreToolUse`, `Stop`) that matches the IDE format. Command
hooks accept `bash` and `powershell` variants, so keep automation
cross-platform.

Automate only stable workflows, and prefer a prompt reminder when a blocking
hook would be disproportionate.

## Evidence Boundaries

- Configured Skills, Agents, hooks, MCP servers, and installed Plugins prove a
  mechanism exists. They never prove it ran.
- Copilot CLI transcripts live at
  `~/.copilot/session-state/<session-id>/events.jsonl` with a `workspace.yaml`
  descriptor. See `../../session-evidence/sessions-diagnostics.md` for the
  supported collection route.
- `~/.copilot/session-store.db` is documented as automatically managed. Never
  read or decode it.
- Copilot transcripts record no per-response model token usage.
