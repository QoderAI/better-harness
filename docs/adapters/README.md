# Host Adapter Matrix

This is the single entry point for Claude Code, Codex, Qoder, Cursor, Qwen,
GitHub Copilot, Pi, Kimi Code, WorkBuddy, and Grok host boundaries, plus the
DeepSeek Harness (DSH) verified install/discovery, developer-preview
configured-assets, session, Asset Practices, neutral Harness analysis, and
Evidence Bundle slices. Do not
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

The `@qoder-ai/better-harness` npm package includes seven filesystem metadata
roots for Qoder, Claude Code, Codex, Cursor, Qwen, Copilot, and Kimi Code,
plus Pi install metadata in the existing `package.json`.
The generated Qoder runtime bundle includes only the Qoder shell,
`.qoder-plugin/`; non-Qoder generated host artifacts remain source-local.
Claude Code installs its shell through the repository's native marketplace
manifest. Pi installs the repository as a pi package through the `pi` manifest
in `package.json`. Kimi Code installs the repository as a plugin through the
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
| Pi | Analysis-capable source-local host | `pi` manifest in `package.json` | `scripts/agent-customize/providers/pi.mjs` | `scripts/session-analysis/platforms/pi.mjs` | self-contained HTML + Markdown | `.pi` + `.agents` + `AGENTS.md` | `pi install <source>` or `pi -e <source>` -> `/better-harness` prompt template -> validated `html` render |
| Kimi Code | Analysis-capable source-local host | `.kimi-plugin/plugin.json` | `scripts/agent-customize/providers/kimi.mjs` | `scripts/session-analysis/platforms/kimi.mjs` | self-contained HTML + Markdown | `AGENTS.md` + `~/.kimi-code/skills` + project `.kimi-code/skills`/`.kimi/skills` + `~/.kimi-code/mcp.json` | `harness evidence-bundle --platform kimi` -> validated `html` render |
| WorkBuddy | Analysis-capable source-local host | none (skills install into `~/.workbuddy/skills`) | `scripts/agent-customize/providers/workbuddy.mjs` | `scripts/session-analysis/platforms/workbuddy.mjs` | self-contained HTML + Markdown | `~/.workbuddy` `AGENTS.md` + identity files + `.agents` + `AGENTS.md` | `session-analysis --platform workbuddy sources` -> validated `html` render |
| Grok | Analysis-capable source-local host | none (skills install into `~/.grok/skills`) | `scripts/agent-customize/providers/grok.mjs` | `scripts/session-analysis/platforms/grok.mjs` | self-contained HTML + Markdown | `~/.grok` + `.grok` + `.agents` + `AGENTS.md` | `session-analysis --platform grok sources` -> skill symlink -> validated `html` render |
| DeepSeek Harness (DSH) | Verified install/discovery for headless/base and Web `standard`/`code`/`cordis`; shared read-only analysis over developer-preview configured and Session evidence | local DSH Cordis policy at `scripts/dsh-skill-discovery/index.mjs`; no lifecycle shell | `scripts/agent-customize/providers/dsh.mjs`; filesystem Skills and cwd-sensitive Instructions, configured-not-observed | `scripts/session-analysis/platforms/dsh.mjs`; `dsh-v1` for the audited format-0 session-evidence slice from DSH `dsh-v0.1.0-rc.7` and `dsh-v0.1.0-rc.8`, raw `.jsonl` and feature-detected `.jsonl.zstd` | unavailable; neutral `harness analyze` and Evidence Bundle only | canonical Skill from the complete root; model Skill calls rejected | `npm run test:dsh-native`; `npm run test:dsh-configured-assets-native`; shared analysis remains inline/no-files |

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

Kimi Code, Grok, and DSH are absent from this table on purpose: none has a
validated native lifecycle contract yet, so lifecycle targets reject them with
`UNKNOWN_HOST` instead of borrowing another host's install route. Kimi Code and
Grok retain their configured-asset and session evidence. DSH retains its
bounded verified discovery, configured-assets, and partial session-evidence
slices, but has no lifecycle profile or native lifecycle claim.

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
  discovers the canonical root `skills/` directory and the `prompts/`
  templates through the `pi` manifest in `package.json`; that manifest is
  install/discovery metadata and does not own Pi evidence collection.
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
  override. WorkBuddy has no install shell in
  this repository; skills install manually into `~/.workbuddy/skills` or
  through WorkBuddy's own marketplace surfaces.
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
- DeepSeek Harness has independent bounded capabilities. Verified
  install/discovery uses DSH `0.1.1-rc.2` at audited source
  `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The sole supported discovery
  route points the active DSH `skill-filesystem.customSkillDirs` at the
  absolute `<BETTER_HARNESS_ROOT>/skills` directory and loads the local Cordis
  policy at `scripts/dsh-skill-discovery/index.mjs` with the same complete root.
  The policy verifies the winning DSH definition's `custom` source, absolute
  `SKILL.md` path, directory `resourceBase`, two-parent root invariant, and
  required `scripts/`, `references/`, `models/`, and `templates/` resources
  before direct `/better-harness` injection. It rejects model-facing
  `skill({ name: "better-harness" })` calls without changing shared Skill
  frontmatter or other hosts. The route is qualified for headless/base and for
  a Web user preset copied from `standard`, `code`, or `cordis`, where the
  active scoped `skill-filesystem` row is edited. Web `minimal` mounts no Skill
  loader and remains unsupported. Project `.dsh/skills` and `.agents/skills`
  candidates retain DSH precedence; a same-name shadow fails canonical
  verification. Copies, symlinks/junctions, relative paths, and literal `~`
  values are not canonical routes. Moving the Better Harness root requires
  updating every configured absolute path. The credential-free native owner
  smoke is `npm run test:dsh-native`.
- Its developer-preview configured-assets provider at
  `scripts/agent-customize/providers/dsh.mjs` reports native filesystem Skill
  winners and byte-budget-represented Instruction sources for an authorized
  workspace and cwd. User-home sources are excluded unless
  `--include-user-home` is supplied. The evidence is
  `configured-not-observed`: runtime/in-process Skills and active Cordis,
  Profile, and Preset composition remain unresolved. DSH advertises exactly
  `sessionAnalysis`, `agentCustomize`, `assetPractices`, `harnessReport`, and
  `evidenceBundle`. Shared analysis accepts a canonical contained `--cwd` and
  remains inline/no-files because checkup, rendering, and output are unsupported. See
  [DeepSeek Harness Configured Assets](../../references/agent-customize/platforms/dsh.md)
  and run the credential-free owner smoke with
  `npm run test:dsh-configured-assets-native`.
- Separately, DeepSeek Harness has a developer-preview, JSONL-only session
  adapter at `scripts/session-analysis/platforms/dsh.mjs`. Home resolution is strictly
  `--dsh-home` over `DSH_HOME` over `~/.dsh`, and the only source root is
  `<home>/sessions`. Discovery is read-only and accepts only the fixed nested
  `session.jsonl` or `session.jsonl.zstd` layout. Workspace qualification uses
  only the format-0 header's absolute `cwd`; the lossy project directory is not
  workspace evidence. Better Harness reports adapter metadata `dsh-v1`; its
  format-0 session-evidence slice is validated against `dsh-v0.1.0-rc.7` and
  `dsh-v0.1.0-rc.8`, including RC8 interrupted assistant messages and the
  required team-event vocabulary. Team events are validated and accounted,
  not projected as team analytics.
  Known-but-unsupported events and unknown ignorable events are explicitly
  accounted for. Unknown required events, malformed records, identity drift,
  committed corruption, and unsupported versions fail closed; an uncommitted
  raw row or incomplete final Zstandard frame preserves only the prior
  committed prefix and remains incomplete. Bounded source distinctions are retained without copying
  arbitrary plugin data or inferring plugin ownership, causality, or faults.
  Compressed artifacts are concatenated independently checksummed Zstandard
  frames and are scanned and decompressed one complete frame at a time. The
  public API available in supported Node.js 22.20 and 24 runtimes is
  feature-detected; where it is absent, including Node.js 23.0 through 23.7,
  compressed evidence is unavailable while independent raw JSONL evidence
  remains readable. There is no fallback dependency or shell.
  The combined DSH boundary does not provide live PTY or process state,
  complete runtime configured-asset resolution, plugin lifecycle, a managed
  shell, manifest or package integration, rendered report/output routing, README
  Quickstart, SQLite or custom
  persistence, automatic optimization, plugin fault or causality attribution,
  or artifact repair or writes. See
  [Story #93](https://github.com/QoderAI/better-harness/issues/93)
  and the [dated support specification](../specs/2026-08-18-93-deepseek-harness-session-evidence.md).

## Output Modes

Canonical templates live under `templates/reporting/`.

- `qoder-canvas.md`: Qoder Canvas output contract, covering renderer-owned
  `findings.json`, Canvas-only `canvas.json`, and `report.canvas.tsx`.
- `cursor-canvas.md`: Cursor Canvas output contract, covering the complete
  report, native Context Usage projection, and public IDE actions.
- `html-visual.md`: portable Claude Code/Codex/Qwen/Copilot/Pi/Kimi Code/WorkBuddy/Grok visual output contract, covering
  `findings.json`, `report.md`, and `report.html`.
- Markdown-only output has no visual companion.

DSH is intentionally absent from these output-mode host lists. Its neutral
`harnessReport` capability does not grant rendering, HTML, Canvas, or Markdown
output support.

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
