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

Better Harness currently declares ten capability-level host adapters. Six
have verified public Quickstart paths. Pi, Kimi Code, WorkBuddy, and Grok are visible as adapter
support because their installation and end-to-end evidence boundaries differ
from that six-host set. The [canonical adapter matrix](https://github.com/QoderAI/better-harness/blob/main/docs/adapters/README.md)
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
| Pi | Adapter support | Native extension-capable package | `pi` manifest + `extensions/pi/better-harness.ts` | Workspace-matching local Pi sessions | Self-contained HTML + Markdown |
| Kimi Code | Adapter support | Analysis-capable source-local host | `.kimi-plugin/plugin.json` | Workspace-matching Kimi wire transcripts | Self-contained HTML + Markdown |
| WorkBuddy | Adapter support | Native Team expert plugin | `.codebuddy-plugin/` + `settings.json` + `agents/` | Workspace-matching WorkBuddy JSONL transcripts | Self-contained HTML + Markdown |
| Grok | Adapter support | Analysis-capable source-local host | None; skills use Grok-owned paths | Workspace-matching Grok session dirs (`updates.jsonl`) | Self-contained HTML + Markdown |

The `@qoder-ai/better-harness` npm package includes native metadata for all
eight adapters. Pi reuses install metadata in the existing `package.json`, so it
does not add a filesystem metadata root. The generated Qoder runtime bundle
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
`UNKNOWN_HOST` while their adapter evidence stays available. The shadow host
profiles do not replace the canonical adapter matrix while ADR-0002 remains
proposed.

## Output modes

- **Qoder Canvas** — renderer-owned `findings.json`, Canvas-only
  `canvas.json`, and `report.canvas.tsx`.
- **Cursor Canvas** — the same complete report contract rendered with
  `cursor/canvas`, native Context Window evidence, and IDE actions.
- **HTML visual** — portable Claude Code/Codex/Qwen/Copilot/Pi/Kimi Code/WorkBuddy/Grok contract
  covering `findings.json`, `report.md`, and a self-contained `report.html`
  (see the [sample report](pathname:///demo/better-harness-report/)).
- **Markdown-only** — no visual companion.

## Adapter support boundaries

### Pi {#pi}

Pi can install the repository through `pi install <source>` or load it with
`pi -e <source>`. Its native extension registers one `/better-harness` command,
orchestrates three isolated RPC lanes, and leaves evidence collection and
rendering in the canonical scripts. Lifecycle status treats persisted
user/project package
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
HTML routing are implemented. The native Team plugin uses one lead and three
fixed members, and `npm run workbuddy:verify` validates its manifest/archive
without copying private host state. It remains outside the verified Quickstart
set until a complete interactive report-loop smoke is observed.

### Grok {#grok}

Grok configured assets, workspace-matched session evidence, and portable HTML
routing are implemented. This repository does not ship a Grok install shell or
npm-packaged host artifact; installation is a manual skill symlink into
`~/.grok/skills/better-harness` (or project `.grok/skills`). Grok remains
outside the verified Quickstart set until a complete interactive report-loop
smoke is observed.

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
