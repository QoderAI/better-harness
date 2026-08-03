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

Better Harness currently declares eight capability-level host adapters. Six
have verified public Quickstart paths. Pi and WorkBuddy are visible as adapter
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
| Pi | Adapter support | Analysis-capable source-local host | `pi` manifest in `package.json` | Workspace-matching local Pi sessions | Self-contained HTML + Markdown |
| WorkBuddy | Adapter support | Analysis-capable source-local host | None; skills use WorkBuddy-owned paths | Workspace-matching WorkBuddy JSONL transcripts | Self-contained HTML + Markdown |

The `@qoderai/better-harness` npm package includes all six plugin metadata
roots. Pi reuses install metadata in the existing `package.json`, so it does
not add a seventh filesystem metadata root. The generated Qoder runtime bundle
includes only the Qoder shell; non-Qoder generated host artifacts remain
source-local.

## Output modes

- **Qoder Canvas** — renderer-owned `findings.json`, Canvas-only
  `canvas.json`, and `report.canvas.tsx`.
- **Cursor Canvas** — the same complete report contract rendered with
  `cursor/canvas`, native Context Window evidence, and IDE actions.
- **HTML visual** — portable Claude Code/Codex/Qwen/Copilot/Pi/WorkBuddy contract
  covering `findings.json`, `report.md`, and a self-contained `report.html`
  (see the [sample report](pathname:///demo/better-harness-report/)).
- **Markdown-only** — no visual companion.

## Adapter support boundaries

### Pi {#pi}

Pi can install the repository through `pi install <source>` or load it with
`pi -e <source>`. Package discovery, configured assets, workspace-matched
session evidence, and portable HTML routing are implemented. Pi remains outside
the verified Quickstart set until a complete interactive report-loop smoke is
observed.

### WorkBuddy {#workbuddy}

WorkBuddy configured assets, workspace-matched session evidence, and portable
HTML routing are implemented. This repository does not ship a WorkBuddy install
shell, plugin manifest, or npm-packaged host artifact; installation remains on
WorkBuddy's own `~/.workbuddy/skills` or marketplace surfaces.

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

Start with [Contributing a Coding Agent Host](./contributing-new-coding-agent).
It separates native shell, configured-asset, session, output, and packaging
claims and links Qwen Code and GitHub Copilot pull requests as worked examples.
