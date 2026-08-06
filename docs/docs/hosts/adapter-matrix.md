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
| Cursor | Verified Quickstart | Analysis-capable source-local host | `.cursor-plugin/` | Workspace-matched transcripts, metadata, and audit logs; partial coverage stays explicit | Self-contained HTML + Markdown |
| Qwen Code | Verified Quickstart | Analysis-capable source-local host | `qwen-extension.json` | Workspace-matching local Qwen transcripts when present | Self-contained HTML + Markdown |
| GitHub Copilot | Verified Quickstart | Analysis-capable source-local host | `.github/plugin/` | Workspace-matched Copilot CLI transcripts; partial coverage stays explicit | Self-contained HTML + Markdown |
| Pi | Adapter support | Native extension-capable package | `pi` manifest + `extensions/pi/better-harness.ts` | Workspace-matching local Pi sessions | Self-contained HTML + Markdown |
| WorkBuddy | Adapter support | Native Team expert plugin | `.codebuddy-plugin/` + `settings.json` + `agents/` | Workspace-matching WorkBuddy JSONL transcripts | Self-contained HTML + Markdown |

The `@qoderai/better-harness` npm package includes native metadata for all
eight adapters. The generated Qoder runtime bundle includes only the Qoder
shell; non-Qoder generated host artifacts remain source-local.

## Output modes

- **Qoder Canvas** — renderer-owned `findings.json`, Canvas-only
  `canvas.json`, and `report.canvas.tsx`.
- **HTML visual** — portable Claude Code/Codex/Cursor/Qwen/Copilot/Pi/WorkBuddy contract
  covering `findings.json`, `report.md`, and a self-contained `report.html`
  (see the [sample report](pathname:///demo/better-harness-report/)).
- **Markdown-only** — no visual companion.

## Adapter support boundaries

### Pi {#pi}

Pi can install the repository through `pi install <source>` or load it with
`pi -e <source>`. Its native extension registers one `/better-harness` command,
orchestrates three isolated RPC lanes, and leaves evidence collection and
rendering in the canonical scripts. Pi remains outside the verified Quickstart
set until a complete interactive report-loop smoke is observed.

### WorkBuddy {#workbuddy}

WorkBuddy configured assets, workspace-matched session evidence, and portable
HTML routing are implemented. The native Team plugin uses one lead and three
fixed members, and `npm run workbuddy:verify` validates its manifest/archive
without copying private host state. It remains outside the verified Quickstart
set until a complete interactive report-loop smoke is observed.

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
