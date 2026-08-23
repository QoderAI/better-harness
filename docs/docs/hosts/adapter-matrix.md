---
id: adapter-matrix
title: Adapter Matrix
sidebar_position: 1
---

# Host Adapter Matrix

Better Harness runs inside your existing coding agent. Host differences enter
only a thin adapter layer: host shells, configured-asset providers, session
evidence adapters, and output modes. Canonical product judgment stays
host-neutral.

## Support levels

Better Harness currently declares ten more complete capability-level host
adapters plus bounded DSH discovery, configured-assets, and session slices. Six
have verified public
Quickstart paths. Pi, Kimi Code, WorkBuddy, and Grok are visible as adapter
support because their installation and end-to-end evidence boundaries differ
from that six-host set. DSH has Verified install/discovery for a qualified
runtime/preset boundary plus developer-preview configured-assets and
session-evidence contracts; it is not a runnable report adapter. The
[canonical adapter matrix](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md)
remains the complete capability-level source of truth.

## Supported host adapters

| Host | Public entry | Positioning | Shell | Session Evidence | Default Output |
| --- | --- | --- | --- | --- | --- |
| Qoder | Verified Quickstart | First-class product host | `.qoder-plugin/` | Qoder sessions | Qoder Canvas report |
| Claude Code | Verified Quickstart | Analysis-capable source-local host | `.claude-plugin/` | Workspace-matching local Claude transcripts when present | Self-contained HTML + Markdown |
| Codex | Verified Quickstart | Analysis-capable source-local host | `.codex-plugin/` | Codex sessions | Self-contained HTML + Markdown |
| Cursor | Verified Quickstart | Canvas-capable source-local host | `.cursor-plugin/` | Workspace-matched transcripts, metadata, audit logs, and optional native Context Usage snapshots; partial coverage stays explicit | Cursor Canvas report |
| Qwen Code | Verified Quickstart | Analysis-capable source-local host | `qwen-extension.json` | Workspace-matching local Qwen transcripts when present | Self-contained HTML + Markdown |
| GitHub Copilot | Verified Quickstart | Analysis-capable source-local host | `.github/plugin/` | Workspace-matched Copilot CLI transcripts; partial coverage stays explicit | Self-contained HTML + Markdown |
| Pi | Adapter support | Analysis-capable source-local host | `pi` manifest in `package.json` | Workspace-matching local Pi sessions | Self-contained HTML + Markdown |
| Kimi Code | Adapter support | Analysis-capable source-local host | `.kimi-plugin/plugin.json` | Workspace-matching Kimi wire transcripts | Self-contained HTML + Markdown |
| WorkBuddy | Adapter support | Analysis-capable source-local host | None; skills use WorkBuddy-owned paths | Workspace-matching WorkBuddy JSONL transcripts | Self-contained HTML + Markdown |
| Grok | Adapter support | Analysis-capable source-local host | None; skills use Grok-owned paths | Workspace-matching Grok session dirs (`updates.jsonl`) | Self-contained HTML + Markdown |
| DeepSeek Harness (DSH) | Verified install/discovery | Qualified headless/base and Web `standard`/`code`/`cordis`; partial configured-assets and session evidence | Local DSH Cordis policy; no lifecycle shell | DSH JSONL backend session format `0`: raw `.jsonl` and feature-detected `.jsonl.zstd` | Unavailable |

The `@qoder-ai/better-harness` npm package includes all seven plugin metadata
roots. Pi reuses install metadata in the existing `package.json`, so it does
not add an eighth filesystem metadata root. The generated Qoder runtime bundle
includes only the Qoder shell; non-Qoder generated host artifacts remain
source-local.

## Read-only plugin lifecycle

The standalone CLI can normalize local Better Harness installation evidence
without flattening host capability differences:

```bash
better-harness plugin status --host all
better-harness plugin verify --host all
better-harness doctor --platform all
```

`plugin plan` requires one explicit host and emits typed native argv or manual
steps without executing them. Qoder Desktop remains bundled, Codex Desktop uses
manual UI steps, Cursor installation stays unavailable while its local help
contract is stale, persistent Pi operations without native evidence stay
unavailable, transient Pi update/remove are not applicable, and WorkBuddy
returns `PLUGIN_LIFECYCLE_UNSUPPORTED`. Kimi Code and Grok have no validated
native lifecycle contract yet, so lifecycle targets reject them with
`UNKNOWN_HOST` while their adapter evidence stays available. DSH likewise has
no lifecycle profile: lifecycle targets reject it with `UNKNOWN_HOST`; its
manually configured verified discovery and partial session evidence remain
available. The shadow host profiles do not replace the canonical adapter matrix
while ADR-0002 remains proposed. DSH's verified discovery does not add a
lifecycle target.

## Output modes

- **Qoder Canvas** — renderer-owned `findings.json`, Canvas-only
  `canvas.json`, and `report.canvas.tsx`.
- **Cursor Canvas** — the same complete report contract rendered with
  `cursor/canvas`, native Context Window evidence, and IDE actions.
- **HTML visual** — portable Claude Code/Codex/Qwen/Copilot/Pi/Kimi Code/WorkBuddy/Grok contract
  covering `findings.json`, `report.md`, and a self-contained `report.html`
  (see the [sample report](pathname:///demo/better-harness-report/)).
- **Markdown-only** — no visual companion.

DSH is not an output-mode host. Session-analysis evidence does not grant HTML,
Canvas, Markdown, or any report route.

## Adapter support boundaries

### Pi {#pi}

Pi can install the repository through `pi install <source>` or load it with
`pi -e <source>`. Lifecycle status treats persisted user/project package
settings as the `cli` inventory surface and one-run `pi -e` activation as the
separate `cli-session` session-only surface; empty settings do not prove that a
running session omitted the package. Package discovery, configured assets,
workspace-matched session evidence, and portable HTML routing are implemented.
Pi remains outside the verified Quickstart set until a complete interactive
report-loop smoke is observed.

### Kimi Code {#kimi-code}

Kimi Code installs the repository through `/plugins install <source>` and the
`.kimi-plugin/plugin.json` manifest, then invokes `/skill:better-harness` after
reload. Configured assets, workspace-matched wire transcripts, and portable HTML
routing are implemented. Kimi Code remains outside the verified Quickstart set
until a complete interactive report-loop smoke is observed.

### WorkBuddy {#workbuddy}

WorkBuddy configured assets, workspace-matched session evidence, and portable
HTML routing are implemented. This repository does not ship a WorkBuddy install
shell, plugin manifest, or npm-packaged host artifact; installation remains on
WorkBuddy's own `~/.workbuddy/skills` or marketplace surfaces.

### Grok {#grok}

Grok configured assets, workspace-matched session evidence, and portable HTML
routing are implemented. This repository does not ship a Grok install shell or
npm-packaged host artifact; installation is a manual skill symlink into
`~/.grok/skills/better-harness` (or project `.grok/skills`). Grok remains
outside the verified Quickstart set until a complete interactive report-loop
smoke is observed.

### DeepSeek Harness (DSH) {#deepseek-harness-dsh}

DSH has Verified install/discovery against DSH `0.1.1-rc.2` at audited source
`b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`. The only supported route points
the active `skill-filesystem.customSkillDirs` at the absolute
`<BETTER_HARNESS_ROOT>/skills` directory and loads the Better Harness DSH policy
from the same complete root. The policy fails closed unless DSH's winning
definition has the expected `custom` source, `SKILL.md` path, directory
`resourceBase`, two-parent root, and required root resources. A direct user
`/better-harness` gesture then injects the canonical Skill at DSH's pre-model
step boundary, while a model-facing Better Harness `skill` tool call is
rejected.

This route is qualified for headless/base. In Web it is qualified only for an
active user preset copied from `standard`, `code`, or `cordis` and configured
through that preset's scoped `skill-filesystem` row. Web `minimal` has no Skill
loader and remains unsupported. DSH's project-local same-name roots keep their
native higher precedence, but such a winner is reported unverified rather than
canonical. Standalone copies and symlinks/junctions are not supported install
routes. Paths must be absolute; DSH resolves relative paths from its process
working directory and does not expand a literal `~`. Moving the complete Better
Harness root requires reconfiguring every absolute path. The Installation page
documents the configuration boundary; run the pinned, credential-free owner
smoke with `npm run test:dsh-native`.

DSH also has a developer-preview configured-assets provider. It reports native
filesystem Skill winners and cwd-sensitive Instruction sources as
configured-not-observed evidence:

```bash
better-harness agent-customize inventory --provider dsh --workspace <path> [--cwd <path>] [--dsh-home <dir>] [--include-user-home[=true]]
```

User-home Skills and Instructions are not read by default. Runtime/in-process
Skills and active Cordis, Profile, and Preset composition remain unresolved.
The host advertises exactly `sessionAnalysis` and `agentCustomize`; this does
not add asset-practices, evidence-bundle, report, rendering, or output support.
Repository contributors can run the pinned credential-free comparison with
`npm run test:dsh-configured-assets-native`. See
[DeepSeek Harness Configured Assets](https://github.com/QoderAI/better-harness/blob/main/references/agent-customize/platforms/dsh.md).

Separately, DSH has a developer-preview JSONL session slice with Better Harness
adapter metadata `dsh-v1`. Its format-0 session-evidence slice is
validated against DSH `dsh-v0.1.0-rc.7` and `dsh-v0.1.0-rc.8`, including RC8
interrupted assistant messages and required team-event vocabulary. Team events
are validated and accounted, not projected as team analytics. Home resolution
is strictly `--dsh-home` over `DSH_HOME` over `~/.dsh`; the only source root is
`<home>/sessions`. The adapter reads the fixed nested `session.jsonl` or
`session.jsonl.zstd` layout without writing or repairing artifacts, and it
qualifies a workspace only from the header's absolute `cwd`.

Compressed artifacts are concatenated independently checksummed Zstandard
frames and are validated and decompressed one complete frame at a time. The
public API available in supported Node.js 22.20 and 24 runtimes is
feature-detected. When it is unavailable, including Node.js 23.0 through 23.7,
compressed evidence is reported unavailable while independent raw JSONL
evidence remains readable; no fallback dependency is installed.
Known-but-unsupported and unknown ignorable events are accounted
for, while unknown required events, committed corruption, identity drift, and
unsupported versions fail closed. Uncommitted final raw rows and structurally
incomplete final Zstandard frames preserve only the prior committed prefix and
remain incomplete. The adapter does not infer plugin ownership, causality, or
faults.

The implemented source-checkout smoke boundary is read-only:

```bash
node scripts/session-analysis.mjs sources --platform dsh --workspace <path> [--dsh-home <dir>]
```

Verified discovery does not imply a complete report loop. DSH has no live
PTY/process integration, complete runtime configured-asset resolution, plugin
lifecycle, managed shell, manifest, package integration, report/output route,
public Quickstart, SQLite or custom persistence support, automatic
optimization, plugin-fault attribution, or artifact mutation/recovery. See the
[canonical source matrix](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md)
and [Story #93](https://github.com/QoderAI/better-harness/issues/93).

## Capability coverage

Capabilities differ per host on purpose: no host claims a capability without a
real evidence source, and unsupported behavior fails before reading private
data or changing files. The maintained capability-by-capability coverage
table, TODO list, and definition of done live in the repository
[roadmap](https://github.com/QoderAI/better-harness/blob/main/roadmap.md).

## Source of truth

The canonical matrix, discovery rules, and split triggers live in
[`docs/adapters/README.md`](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md).

## Contributing another host

Start with [Contributing a Coding Agent Host](./contributing-new-coding-agent.md).
It separates native shell, configured-asset, session, output, and packaging
claims and links Qwen Code and GitHub Copilot pull requests as worked examples.
