# Host Adapter Matrix

This is the single entry point for Claude Code, Codex, Qoder, Cursor, Qwen, and
GitHub Copilot host boundaries. Do not create `docs/adapters/claude-code.md`,
`docs/adapters/codex.md`, `docs/adapters/qoder.md`, `docs/adapters/cursor.md`,
`docs/adapters/qwen.md`, or `docs/adapters/copilot.md` by default.

Host differences enter only this matrix, capability-local configured-asset
providers, real session-evidence adapters, and output modes. Canonical product
judgment stays in `skills/`, `models/`, `references/`, `templates/`, and
`scripts/<capability>/`.

The `@qoderai/better-harness` npm package includes the Qoder, Claude Code,
Codex, Cursor, Qwen, and GitHub Copilot plugin metadata roots. The generated
Qoder runtime bundle includes only the Qoder shell, `.qoder-plugin/`; non-Qoder
generated host artifacts remain source-local. Claude Code installs its shell
through the repository's native marketplace manifest.

| Host | Positioning | Shell | Configured Assets | Session Evidence | Default Output | Rules / Prompts | Smoke |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Analysis-capable source-local host | `.claude-plugin/` | `scripts/agent-customize/providers/claude.mjs` | `scripts/session-analysis/platforms/claude.mjs` | self-contained HTML + Markdown | `.claude` + `CLAUDE.md` + Plugin assets | `claude plugin validate --strict .` -> isolated install/discovery -> configured-asset baseline -> validated `html` render |
| Codex | Analysis-capable source-local host | `.codex-plugin/` | `scripts/agent-customize/providers/codex.mjs` | `scripts/session-analysis/platforms/codex.mjs` | self-contained HTML + Markdown | `.codex` + `.agents` + `AGENTS.md` | `harness prepare --platform codex` -> finalize with `html-report` validation |
| Qoder | First-class product host | `.qoder-plugin/` | `scripts/agent-customize/providers/qoder.mjs` | `scripts/session-analysis/platforms/qoder.mjs` | `better-harness` | `.qoder/rules` + `AGENTS.md` + output templates | `better-harness harness render --mode qoder-canvas --validate` |
| Cursor | Analysis-capable source-local host | `.cursor-plugin/` | `scripts/agent-customize/providers/cursor.mjs` | `scripts/session-analysis/platforms/cursor.mjs` | self-contained HTML + Markdown | `.cursor` + `.codex` compatibility + `AGENTS.md` | `agent --plugin-dir . --mode ask --print` -> Cursor evidence bundle -> validated `html` render |
| Qwen Code | Analysis-capable source-local host | `qwen-extension.json` | `scripts/agent-customize/providers/qwen.mjs` | `scripts/session-analysis/platforms/qwen.mjs` | self-contained HTML + Markdown | `.qwen` + `QWEN.md` + `AGENTS.md` | `harness prepare --platform qwen` -> finalize with `html-report` validation |
| GitHub Copilot | Analysis-capable source-local host | `.github/plugin/` | `scripts/agent-customize/providers/copilot.mjs` | `scripts/session-analysis/platforms/copilot.mjs` | self-contained HTML + Markdown | `.github` + `AGENTS.md` + `~/.copilot` | `copilot plugin marketplace add .` -> `copilot plugin install better-harness@better-harness` -> configured-asset baseline -> validated `html` render |

## Discovery And Evidence

- Claude Code discovers the canonical root `skills/` directory through
  `.claude-plugin/plugin.json`; `.claude-plugin/marketplace.json` makes the
  repository installable with Claude's native plugin commands. Its
  capability-owned session adapter reads workspace-matching local Claude
  transcripts when present; the shell does not own that evidence. Configured
  user/project/Plugin assets are inventoried through
  `scripts/agent-customize/providers/claude.mjs`; installed Plugin records are
  kept separate from marketplace catalogs and runtime-use claims.
- Qoder configured assets are inventoried from Qoder plugin, rules, commands,
  skills, hooks, and MCP-facing paths through
  `scripts/agent-customize/providers/qoder.mjs`. Session evidence comes from
  `scripts/session-analysis/platforms/qoder.mjs`.
- Codex configured assets are inventoried through
  `scripts/agent-customize/providers/codex.mjs`. Session evidence comes from
  `scripts/session-analysis/platforms/codex.mjs`. The `.codex-plugin/` shell is
  install/discovery metadata included in the public npm package; it does not
  own Codex evidence collection.
- Cursor configured assets are inventoried through
  `scripts/agent-customize/providers/cursor.mjs` and the active
  `.cursor-plugin/` shell, which is included in the public npm package. Session
  evidence comes from
  `scripts/session-analysis/platforms/cursor.mjs`, which keeps transcript,
  metadata, and audit coverage explicit when local identities do not join.
- Qwen Code configured assets are inventoried through
  `scripts/agent-customize/providers/qwen.mjs`. Session evidence comes from
  `scripts/session-analysis/platforms/qwen.mjs`, which reads workspace-matching
  JSONL transcripts under `~/.qwen/projects/<slug>/chats/`. The `qwen-extension.json`
  manifest is native Qwen install/discovery metadata included in the public npm package; it
  does not own Qwen evidence collection.
- GitHub Copilot configured assets are inventoried through
  `scripts/agent-customize/providers/copilot.mjs`, covering `AGENTS.md`,
  `.github/copilot-instructions.md`, `.github/instructions/`, `.github/skills/`,
  `.agents/skills/`, `.github/agents/`, `.github/prompts/`, `.github/hooks/`,
  `.mcp.json`, `.github/mcp.json`, and the user-scope `~/.copilot` equivalents.
  Installed-Plugin records come from the `installedPlugins` array in
  `~/.copilot/config.json` and stay separate from marketplace catalogs and
  runtime-use claims. Session evidence comes from
  `scripts/session-analysis/platforms/copilot.mjs`, which reads
  workspace-matching `~/.copilot/session-state/<id>/events.jsonl` bound through
  each session's `workspace.yaml`. Copilot transcripts record no per-response
  model token usage, and a matched session directory without `events.jsonl`
  stays an explicit partial coverage boundary. `~/.copilot/session-store.db` is
  documented as automatically managed and is not an evidence source. The
  `.github/plugin/` shell is native Copilot install/discovery metadata included
  in the public npm package; it does not own Copilot evidence collection.

## Output Modes

Canonical templates live under `templates/reporting/`.

- `qoder-canvas.md`: Qoder Canvas output contract, covering renderer-owned
  `findings.json`, Canvas-only `canvas.json`, and `report.canvas.tsx`.
- `html-visual.md`: portable Claude Code/Codex/Cursor/Qwen/Copilot visual output contract, covering
  `findings.json`, `report.md`, and `report.html`.
- Markdown-only output has no visual companion.

## Split Triggers

Split a host into `docs/adapters/<host>.md` only when at least one condition is
true:

- That host's discovery, smoke, or packaging guidance exceeds one screen.
- That host has an independent release or install lifecycle.
- That host's evidence collection is referenced by two or more capabilities.
- That host's prompt contract changes generated artifacts or validation.
- This README matrix is no longer easy to scan.

A split file must link back to this matrix and keep canonical judgment in the
owning capability, template, skill, model, or reference path.
