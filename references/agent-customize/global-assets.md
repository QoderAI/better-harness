# Global Coding-Agent Assets

Use this reference when a readiness run, screenshot, or user request points to
Cursor, Qoder, Codex, Claude, Qwen, or Copilot settings, installed assets,
global skills, user hooks, commands, agents, plugins, MCPs, or memories. Treat
this as a configured asset inventory, not a session behavior report.

## Scope

- Project assets: `.cursor`, `.qoder`, `.codex`, `.claude`, `.agents`,
  `.github`, project rules, skills, agents, commands, hooks, workflows,
  settings, and MCP config.
- User/global assets: `~/.{cursor,qoder,codex,claude,qwen,copilot}` skills,
  hooks, commands, agents, rules, settings, and MCP config.
- Plugin/marketplace assets: provider plugin caches and install evidence under
  `~/.cursor`, `~/.qoder`, `~/.codex`, `~/.claude`, `~/.qwen`, and
  `~/.copilot`, including plugin-declared Skills, MCPs, Commands, Hooks, Rules,
  and Subagents.
- Memories: `~/.qoder/memories/**` plus Qoder `SharedClientCache`
  `app-config.json` memory keys and `cache/db/*.db*` file presence; and Codex
  generated-memory metadata under `~/.codex/memories/` plus supported
  `config.toml` memory settings.
- Session observed behavior: cite `session-analysis.mjs sources/facets`
  separately; configured assets do not prove runtime use.

## Inventory Command

Run the read-only inventory when user-home or installed assets are in scope:

```bash
<node> <better-harness-root>/scripts/agent-customize/cli.mjs inventory --provider <cursor|qoder|codex|claude|qwen|copilot> --workspace <absolute-target-path>
<node> <better-harness-root>/scripts/coding-agent-practices/inventory.mjs <cursor|qoder|codex|claude|qwen|copilot> --workspace <absolute-target-path> --include-user-home --include-memories --format markdown
<cli> coding-agent-practices asset-integrity <cursor|qoder|codex|claude|qwen|copilot> --workspace <absolute-target-path> --language <en|zh-CN> --json [--include-memories] [--include-user-home]
```

Use `--cursor-home <path>`, `--qoder-home <path>`, `--codex-home <path>`,
`--claude-home <path>`, `--qwen-home <path>`, `--copilot-home <path>`,
`--claude-state <file>`, `--codex-app-path <path>`, or `--shared-cache <path>`
for fixtures, alternate
installs, or non-standard homes. Use the `agent-customize` command as the
provider-specific configured asset source of truth; use the
`coding-agent-practices` wrapper when the report also needs the matrix shape or
Qoder/Codex memory metadata summary. For Qoder reports, project
`summary.practiceCoverageRows`; it resolves `~/.qoder` assets separately from
the active `SharedClientCache` MCP home, excludes runtime-only project MCP
metadata, and omits zero-count rows.

For Claude-specific settings/state/Plugin precedence and privacy boundaries,
continue with [Claude Code Configured Assets](platforms/claude.md).

The provider-labelled asset-integrity command reuses that inventory for a lightweight
second pass. It checks Memory filename-title collisions/similarity, enabled
Plugin canonical/display-name and non-empty capability-fingerprint overlap,
and Hook count/exact-duplicate/fan-out pressure when those surfaces are available. Treat exact name and fingerprint
matches as owner-review candidates and similar E2E/P7/P8-style Plugin names as
advisory families. Never edit a Plugin cache or disable a variant from naming
similarity alone.

## Evidence Levels

- **Configured**: path or settings entry exists.
- **Inspected**: metadata, frontmatter, settings sections, or plugin index was
  opened.
- **Observed**: session, audit, hook, permission, or tool event shows runtime
  use.
- **Backstopped**: CI, host policy, sandbox, or hook tests enforce the practice.

Report configured and inspected global assets as evidence, but do not claim a
Skill, Hook, Command, MCP, Plugin, Agent, Workflow, or Memory was used unless
session or audit evidence shows it. For the cross-asset Exists -> Routed ->
Applied -> Effective check, continue with
[Knowledge-Asset Review](knowledge-assets-review.md).

## Presence, Use, And Cleanup Eligibility

Customization Checkup projects the evidence ladder into these reader states:

- `observed`: mapped runtime use exists in the bounded scope;
- `configured-only`: configuration was inspected but runtime use was not in
  scope;
- `unobserved`: a bounded window did not contain mapped use;
- `candidate`: sufficiently covered, outside a new-install grace period,
  unshadowed, owner-mapped, and safe for a disable-first plan;
- `healthy`: configured/effective state and observation are consistent;
- `unavailable`: active source, identity, or coverage cannot be established.

No observed use in one workspace cannot make a user/global asset a cleanup
candidate. User/global cleanup needs an explicitly enabled user-global session
pass and a declared time/session window. Plugin use can be demonstrated by an
observed plugin-owned Skill, MCP tool, Command, Hook, or Agent only when stable
metadata maps the child to the plugin. Ambiguous ownership stays `unobserved`.

Keep generated runtime state, caches, merged MCP snapshots, logs, and encrypted
diagnostics read-only. Plan changes against author-owned files or supported host
CLI operations.

## Memory Boundary

Do not read raw memory text, private transcripts, auth files, token stores,
model catalogs, or database rows by default. For memories, summarize only:

- memory root existence and category/path counts
- memory-related config keys such as Qoder `memory.fetch.enable`,
  `memory.retrieve.enable`, `memory.file_memory.prompt.enabled`, and
  `memory.topictree.enable`, or Codex `features.memories`,
  `memories.generate_memories`, and `memories.use_memories`
- database file presence such as `local.db`, `memory.db`, WAL, and SHM files
- drift or risk notes such as stale, duplicated, or sensitive-looking category
  names without printing content

If raw memory content is explicitly requested, treat it as sensitive user data
and ask for a bounded scope before opening files. For recall, stale-memory,
adoption, or learning-loop claims, continue with
[Memory Review And Learning-Loop Evidence](memory-review.md); metadata and
configuration never prove that a task retrieved or applied a memory.

## Report Projection

In `AI Agent Practices`, surface a compact matrix with these rows when the
inventory is in scope: Project assets, User/global assets,
Plugin/marketplace assets, Session observed behavior, and Memories. Each row
should show configured/inspected/observed status, strongest evidence, main gap,
and `Low`, `Medium`, or `High` confidence.

Current Harness coverage rows remain inventory-only. Project material
asset-integrity observations as ordinary grouped `findings[]` for `Memories`,
`Plugins`, and `Hooks`; do not add health status or evaluation fields to the
coverage rows.
