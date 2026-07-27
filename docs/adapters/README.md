# Host Adapter Matrix

This is the single entry point for Claude Code, Codex, Qoder, and Cursor host
boundaries. Do not create `docs/adapters/claude-code.md`,
`docs/adapters/codex.md`, `docs/adapters/qoder.md`, or
`docs/adapters/cursor.md` by default.

Host differences enter only this matrix, capability-local configured-asset
providers, real session-evidence adapters, and output modes. Canonical product
judgment stays in `skills/`, `models/`, `references/`, `templates/`, and
`scripts/<capability>/`.

The `@qoderai/better-harness` npm package and generated Qoder runtime bundle include
only the Qoder shell, `.qoder-plugin/`. Claude Code, Codex, and Cursor shell
directories are source-local install/discovery metadata unless a dedicated
host package is introduced. Claude Code installs its shell through the
repository's native marketplace manifest.

| Host | Positioning | Shell | Configured Assets | Session Evidence | Default Output | Rules / Prompts | Smoke |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Analysis-capable source-local host | `.claude-plugin/` | `scripts/agent-customize/providers/claude.mjs` | `scripts/session-analysis/platforms/claude.mjs` | self-contained HTML + Markdown | `.claude` + `CLAUDE.md` + Plugin assets | `claude plugin validate --strict .` -> isolated install/discovery -> configured-asset baseline -> validated `html` render |
| Codex | Analysis-capable source-local host | `.codex-plugin/` | `scripts/agent-customize/providers/codex.mjs` | `scripts/session-analysis/platforms/codex.mjs` | self-contained HTML + Markdown | `.codex` + `.agents` + `AGENTS.md` | `harness prepare --platform codex` -> finalize with `html-report` validation |
| Qoder | First-class product host | `.qoder-plugin/` | `scripts/agent-customize/providers/qoder.mjs` | `scripts/session-analysis/platforms/qoder.mjs` | `better-harness` | `.qoder/rules` + `AGENTS.md` + output templates | `better-harness harness render --mode qoder-canvas --validate` |
| Cursor | Analysis-capable source-local host | `.cursor-plugin/` | `scripts/agent-customize/providers/cursor.mjs` | `scripts/session-analysis/platforms/cursor.mjs` | self-contained HTML + Markdown | `.cursor` + `.codex` compatibility + `AGENTS.md` | `agent --plugin-dir . --mode ask --print` -> Cursor evidence bundle -> validated `html` render |

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
  source-local install/discovery metadata and does not ship in the Qoder npm
  package.
- Cursor configured assets are inventoried through
  `scripts/agent-customize/providers/cursor.mjs` and the active
  `.cursor-plugin/` shell. The shell does not ship in the Qoder npm package.
  Session evidence comes from
  `scripts/session-analysis/platforms/cursor.mjs`, which keeps transcript,
  metadata, and audit coverage explicit when local identities do not join.

## Output Modes

Canonical templates live under `templates/reporting/`.

- `qoder-canvas.md`: Qoder Canvas output contract, covering renderer-owned
  `findings.json`, Canvas-only `canvas.json`, and `report.canvas.tsx`.
- `html-visual.md`: portable Claude Code/Codex/Cursor visual output contract, covering
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
