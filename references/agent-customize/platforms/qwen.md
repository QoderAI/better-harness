# Qwen Code Best Practices

Use this file for Qwen Code-specific operating practice. Use `../routing.md`
for host-neutral owner selection and `codex.md`/`claude.md` for other host
references. Do not copy Qwen-only workflow advice into shared docs unless there
is matching surface evidence.

## Operating Frame

Treat Qwen Code as a configured teammate, not a one-off assistant. Start with
the right task context, move repeated guidance into `QWEN.md` and `AGENTS.md`,
configure Qwen Code for the real workflow, connect external systems through
MCP, turn repeated work into Skills and extensions, and automate only stable
workflows.

## Prompt Shape

A strong first prompt has four parts:

- **Goal**: the change, bug, review, artifact, or decision needed.
- **Context**: files, folders, docs, examples, logs, errors, or other material
  Qwen Code should inspect.
- **Constraints**: architecture rules, safety limits, review standards, platform
  requirements, and do-not-touch boundaries.
- **Done when**: tests, checks, behavior, output files, or review evidence that
  prove the task is complete.

## Durable Guidance

Use `QWEN.md` and `AGENTS.md` for repository guidance that should load
automatically:

- repo layout and important directories
- build, test, lint, and local run commands
- engineering conventions and review expectations
- safety constraints and do-not rules
- what "done" means and how to verify work

Keep context files short and practical. Put large or conditional detail in
linked references. Use project-level `.qwen/settings.json` for repo-specific
behavior and global `~/.qwen/settings.json` for personal defaults.

When Qwen Code repeats a mistake, update durable guidance only when the lesson
is reusable.

## Configuration

Qwen Code configuration should match the actual environment:

- Use `~/.qwen/settings.json` for personal defaults (model, approval mode,
  permissions).
- Use `<project>/.qwen/settings.json` for repo-specific behavior.
- Use `.qwen/` for project-scoped skills, agents, hooks, and worktrees.
- Keep approval and sandbox settings tight until a trusted workflow needs more
  access.

## Skills and Extensions

Turn a repeated workflow into a Skill when it has stable triggers, inputs,
steps, outputs, and validation. Install extensions from marketplaces or local
sources; each extension records its install marker under
`~/.qwen/extensions/<name>/.qwen-extension-install.json` with a `source`
pointer to the real plugin root.

## External Context

Use MCP when Qwen Code needs context or actions outside the repository. MCP
servers are configured in `~/.qwen/settings.json` under `mcpServers` (user) or
`<project>/.mcp.json` (project). Project-level `.qwen/settings.json` can also
carry `mcpServers`. Start with one or two MCP tools that remove a real repeated
manual step.

## Session Controls

Keep one Qwen Code session per coherent unit of work. Session transcripts are
recorded as JSONL under `~/.qwen/projects/<workspace-slug>/chats/`. The slug
replaces every non-alphanumeric character with `-` (matching Qwen's native
`sanitizeCwd`; on Windows the path is lowercased first). Use worktrees when
concurrent
sessions could edit the same files. Use subagents for bounded exploration,
testing, or independent review.

## Harness Projection

For readiness reports, separate static presence from quality and execution:

- `QWEN.md`, `AGENTS.md`, `.qwen/settings.json`, Skills, extensions, MCP config,
  and hooks are configured-surface evidence.
- Test output, build logs, reviewed diffs, session transcripts, and automation
  histories are execution evidence.
- Do not claim a Qwen Code practice is effective from file presence alone.
