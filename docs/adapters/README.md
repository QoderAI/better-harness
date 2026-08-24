# Host Adapter Matrix

This is the single entry point for Claude Code, Codex, Qoder, Cursor, Qwen,
GitHub Copilot, Pi, Kimi Code, WorkBuddy, and Grok host boundaries. Do not
create `docs/adapters/claude-code.md`, `docs/adapters/codex.md`,
`docs/adapters/qoder.md`, `docs/adapters/cursor.md`, `docs/adapters/qwen.md`,
`docs/adapters/copilot.md`, `docs/adapters/pi.md`,
`docs/adapters/kimi-code.md`, `docs/adapters/workbuddy.md`, or
`docs/adapters/grok.md` by default.

Adding another host? Follow
[Contributing a New Coding Agent Host](contributing-new-coding-agent.md) before
editing the matrix. The guide separates shell, configured-asset, session,
output, and packaging claims and links reviewed Qwen Code and GitHub Copilot
pull requests as worked examples.

Host differences enter only this matrix, capability-local configured-asset
providers, real session-evidence adapters, and output modes. Canonical product
judgment stays in `skills/`, `models/`, `references/`, `templates/`, and
`scripts/<capability>/`.

The `@qoder-ai/better-harness` npm package ships all eight current/native
metadata roots for Qoder, Claude Code, Codex, Cursor, Qwen, Copilot, Kimi Code,
and WorkBuddy, plus Pi install metadata in the existing `package.json`.
The generated Qoder runtime bundle includes only the Qoder shell,
`.qoder-plugin/`; non-Qoder generated host artifacts remain source-local.
Claude Code installs its shell through the repository's native marketplace
manifest. Pi installs the repository as a pi package through the `pi` manifest
in `package.json`. WorkBuddy installs the repository as a native Team expert
plugin through `.codebuddy-plugin/`, `settings.json`, and `agents/`. Kimi Code
installs the repository as a plugin through the
`.kimi-plugin/plugin.json` manifest with `/plugins install <source>` (or a
manual `skills/better-harness` copy/symlink into `~/.kimi-code/skills/` or a
project `.kimi-code/skills/`), then runs `/skill:better-harness`.

| Host | Positioning | Shell | Configured Assets | Session Evidence | Default Output | Rules / Prompts | Smoke |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Claude Code | Analysis-capable source-local host | `.claude-plugin/` | `scripts/agent-customize/providers/claude.mjs` | `scripts/session-analysis/platforms/claude.mjs` | self-contained HTML + Markdown | `.claude` + `CLAUDE.md` + Plugin assets | `claude plugin validate --strict .` -> isolated install/discovery -> configured-asset baseline -> validated `html` render |
| Codex | Analysis-capable source-local host | `.codex-plugin/` | `scripts/agent-customize/providers/codex.mjs` | `scripts/session-analysis/platforms/codex.mjs` | self-contained HTML + Markdown | `.codex` + `.agents` + `AGENTS.md` | `harness prepare --platform codex` -> finalize with `html-report` validation |
| Qoder | First-class product host | `.qoder-plugin/` | `scripts/agent-customize/providers/qoder.mjs` | `scripts/session-analysis/platforms/qoder.mjs` | `better-harness` | `.qoder/rules` + `AGENTS.md` + output templates | `better-harness harness render --mode qoder-canvas --validate` |
| Cursor | Canvas-capable source-local host | `.cursor-plugin/` | `scripts/agent-customize/providers/cursor.mjs` | `scripts/session-analysis/platforms/cursor.mjs` | `cursor-canvas` | `.cursor` + `.codex` compatibility + `AGENTS.md` | native `cursor-agent --help` contract check -> unavailable install plan -> Cursor evidence bundle -> validated `cursor-canvas` render |
| Qwen Code | Analysis-capable source-local host | `qwen-extension.json` | `scripts/agent-customize/providers/qwen.mjs` | `scripts/session-analysis/platforms/qwen.mjs` | self-contained HTML + Markdown | `.qwen` + `QWEN.md` + `AGENTS.md` | `harness prepare --platform qwen` -> finalize with `html-report` validation |
| GitHub Copilot | Analysis-capable source-local host | `.github/plugin/` | `scripts/agent-customize/providers/copilot.mjs` | `scripts/session-analysis/platforms/copilot.mjs` | self-contained HTML + Markdown | `.github` + `AGENTS.md` + `~/.copilot` | `copilot plugin marketplace add .` -> `copilot plugin install better-harness@better-harness` -> configured-asset baseline -> validated `html` render |
| Pi | Native extension-capable package | `pi` manifest in `package.json` | `scripts/agent-customize/providers/pi.mjs` | `scripts/session-analysis/platforms/pi.mjs` | self-contained HTML + Markdown | `.pi` + `.agents` + `AGENTS.md` | `pi install <source>` or `pi -e <source>` -> `/better-harness` native extension -> validated `html` render |
| WorkBuddy | Native Team expert plugin | `.codebuddy-plugin/` + `settings.json` + `agents/` | `scripts/agent-customize/providers/workbuddy.mjs` | `scripts/session-analysis/platforms/workbuddy.mjs` | self-contained HTML + Markdown | `~/.workbuddy` `AGENTS.md` + identity files + `.agents` + `AGENTS.md` | `codebuddy --plugin-dir .` -> Review Team -> validated `html` render |
| Kimi Code | Analysis-capable source-local host | `.kimi-plugin/plugin.json` | `scripts/agent-customize/providers/kimi.mjs` | `scripts/session-analysis/platforms/kimi.mjs` | self-contained HTML + Markdown | `AGENTS.md` + `~/.kimi-code/skills` + project `.kimi-code/skills`/`.kimi/skills` + `~/.kimi-code/mcp.json` | `harness evidence-bundle --platform kimi` -> validated `html` render |
| Grok | Analysis-capable source-local host | none (skills install into `~/.grok/skills`) | `scripts/agent-customize/providers/grok.mjs` | `scripts/session-analysis/platforms/grok.mjs` | self-contained HTML + Markdown | `~/.grok` + `.grok` + `.agents` + `AGENTS.md` | `session-analysis --platform grok sources` -> skill symlink -> validated `html` render |

## Read-only Plugin Lifecycle

`better-harness plugin status`, `plan`, and `verify` expose a Better Harness-only
view over these adapters. The shadow declarations in `scripts/host-support/`
record lifecycle evidence without replacing this matrix while ADR-0002 is
proposed. Each host declaration lives in `scripts/host-support/profiles/<host>.mjs`
and uses the shared typed constructors rather than copying registry logic. Each
module is locally validated and deeply frozen before registry composition;
aggregate validation adds only cross-host id and alias uniqueness. The
same profile declares its provider home option and each surface's observation
kind, so status collection does not carry a second host lookup table or
host-specific branches. Lifecycle status and plan also share one private target
resolver for aliases, explicit host requirements, surfaces, and scopes, keeping
usage diagnostics consistent as profiles grow. Plugin leaf metadata is declared
once and projected into the root command registry; runtime definitions bind the
same entries to executors and human renderers without leaf-name branches. Every
observed or inventory-failure status instance passes through one validated row
factory, so host additions cannot invent a second status shape. Every lifecycle
plan likewise passes through one transition and validation model: mutation
steps declare external host-plugin-state effects, while follow-up verification
steps declare read-only host-observation effects. The thin plan core does not
copy lifecycle state policy when a host profile is added.
Plans never execute and always preserve native surface differences:

| Host surface | Lifecycle disposition |
| --- | --- |
| Claude Code CLI | Native install, update, remove, and details verification steps |
| Codex CLI / Desktop | Native CLI argv; manual Desktop UI steps |
| Qoder Desktop / CLI | Bundled Desktop; manual CLI install, verified list/remove, unavailable update |
| Cursor Agent | Session-only evidence; install remains unavailable while the local help contract is stale |
| Qwen Code | Native extension install/list argv; update and remove remain unavailable until safe scope-targeted mutation semantics are evidenced |
| GitHub Copilot CLI | Native marketplace install, list, update, and uninstall argv |
| Pi CLI / CLI session | Persistent user/project install guidance and inventory; separate `pi -e` session-only activation whose update/remove operations are not applicable |
| WorkBuddy | `PLUGIN_LIFECYCLE_UNSUPPORTED`; adapter evidence remains available |

Kimi Code and Grok are absent from this table on purpose: neither host has a
validated native lifecycle contract yet, so lifecycle targets reject them with
`UNKNOWN_HOST` instead of borrowing another host's install route. Their adapter,
configured-asset, and session evidence remain available through the matrix above.

The lifecycle commands do not read raw session transcripts, contact a registry,
edit host settings, or register an `apply` path.

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

- Pi configured assets are inventoried through
  `scripts/agent-customize/providers/pi.mjs`, covering `~/.pi/agent`
  (settings-declared pi packages, skills, prompt templates, extensions, the
  global `AGENTS.md` context file), the shared `.agents/skills` directories,
  and project `.pi` assets. Session evidence comes from
  `scripts/session-analysis/platforms/pi.mjs`, which reads workspace-matching
  JSONL transcripts under `~/.pi/agent/sessions/--<cwd-slug>--/` and honors the
  `PI_CODING_AGENT_DIR` and `PI_CODING_AGENT_SESSION_DIR` overrides. Pi
  discovers the canonical root `skills/` directory and the native
  `extensions/pi/better-harness.ts` through the `pi` manifest in
  `package.json`. The extension registers exactly one `/better-harness`
  command and owns only orchestration; evidence and rendering remain in the
  canonical scripts.
  The manifest is install/discovery metadata and does not own Pi evidence
  collection.
- Kimi Code configured assets are inventoried through
  `scripts/agent-customize/providers/kimi.mjs`: user-level
  `~/.kimi-code/skills/**/SKILL.md` and `~/.kimi-code/mcp.json`, plus
  project-level `AGENTS.md`/`CLAUDE.md` and the probed skill roots
  `.kimi-code/skills/**/SKILL.md` and `.kimi/skills/**/SKILL.md`. The
  repository's `.kimi-plugin/plugin.json` manifest makes Better Harness
  installable through Kimi Code's `/plugins` manager. Kimi Code also
  supports hooks, custom agents, plugin-declared slash commands, and
  plugin-bundled skills (installed per user under
  `~/.kimi-code/plugins/managed/`); the provider inventories those surfaces
  for plugins recorded in `~/.kimi-code/plugins/installed.json` (assets only
  for `enabled: true` records), while memory has no Kimi Code equivalent.
  Session evidence comes
  from `scripts/session-analysis/platforms/kimi.mjs`, which reads
  `~/.kimi-code/sessions/<wd_*>/ses{sion}_*/agents/*/wire.jsonl` and resolves
  the workspace-to-`wd_*` mapping through `workspaces.json` and
  `session_index.jsonl` (falling back to `wd_<name>_*` directory prefixes).
- WorkBuddy configured assets are inventoried through
  `scripts/agent-customize/providers/workbuddy.mjs`, covering `~/.workbuddy`
  user skills, marketplace plugins under `plugins/marketplaces/` with enabled
  state from `settings.json`, `mcp.json`/`.mcp.json` user and plugin MCP
  servers, the global `AGENTS.md`
  and identity context files, the shared `.agents/skills` directories, and
  project `.workbuddy` assets. Session evidence comes from
  `scripts/session-analysis/platforms/workbuddy.mjs`, which reads
  workspace-matching JSONL transcripts under `~/.workbuddy/projects/<cwd-slug>/`.
  Embedded `cwd` values are authoritative; cwd-less 5.x transcripts qualify
  only from an exact workspace slug. The adapter honors the `WORKBUDDY_DIR`
  override. The native `.codebuddy-plugin/` Team shell points at the canonical
  Skill and fixed lead/member Agent files; `scripts/packaging/workbuddy-plugin.mjs`
  validates the Marketplace metadata and produces an offline archive without
  copying private WorkBuddy state.
  The shell is source-local and does not copy private WorkBuddy state; the
  underlying adapter still keeps session and configured-asset evidence explicit.
- Grok configured assets are inventoried through
  `scripts/agent-customize/providers/grok.mjs`, covering `~/.grok` user skills
  (including bundled skills), hooks, MCP servers declared in `config.toml`,
  installed plugins under `installed-plugins/`, shared `.agents/skills`, and
  project `.grok` assets. Session evidence comes from
  `scripts/session-analysis/platforms/grok.mjs`, which reads workspace-matching
  session directories under `~/.grok/sessions/<url-encoded-cwd>/<session-id>/`
  (`summary.json`, `updates.jsonl`, optional `chat_history.jsonl` and
  `signals.json`). The adapter honors `GROK_HOME`. Grok has no install shell in
  this repository; skills install manually into `~/.grok/skills` (symlink is
  enough for `/better-harness`).

## Output Modes

Canonical templates live under `templates/reporting/`.

- `qoder-canvas.md`: Qoder Canvas output contract, covering renderer-owned
  `findings.json`, Canvas-only `canvas.json`, and `report.canvas.tsx`.
- `cursor-canvas.md`: Cursor Canvas output contract, covering the complete
  report, native Context Usage projection, and public IDE actions.
- `html-visual.md`: portable Claude Code/Codex/Qwen/Copilot/Pi/Kimi Code/WorkBuddy/Grok visual output contract, covering
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
