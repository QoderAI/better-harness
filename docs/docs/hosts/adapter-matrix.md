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

## Hosts at a glance

| Host | Positioning | Shell | Session Evidence | Default Output |
| --- | --- | --- | --- | --- |
| Qoder | First-class product host | `.qoder-plugin/` | Qoder sessions | Qoder Canvas report |
| Claude Code | Analysis-capable source-local host | `.claude-plugin/` | Workspace-matching local Claude transcripts when present | Self-contained HTML + Markdown |
| Codex | Analysis-capable source-local host | `.codex-plugin/` | Codex sessions | Self-contained HTML + Markdown |
| Cursor | Analysis-capable source-local host | `.cursor-plugin/` | Workspace-matched transcripts, metadata, and audit logs; partial coverage stays explicit | Self-contained HTML + Markdown |
| Qwen Code | Analysis-capable source-local host | `qwen-extension.json` | Workspace-matching local Qwen transcripts when present | Self-contained HTML + Markdown |
| GitHub Copilot | Analysis-capable source-local host | `.github/plugin/` | Workspace-matched Copilot CLI transcripts; partial coverage stays explicit | Self-contained HTML + Markdown |

The `@qoderai/better-harness` npm package includes all six plugin metadata
roots. The generated Qoder runtime bundle includes only the Qoder shell;
non-Qoder generated host artifacts remain source-local.

## Output modes

- **Qoder Canvas** — renderer-owned `findings.json`, Canvas-only
  `canvas.json`, and `report.canvas.tsx`.
- **HTML visual** — portable Claude Code/Codex/Cursor/Qwen/Copilot contract
  covering `findings.json`, `report.md`, and a self-contained `report.html`
  (see the [live demo](pathname:///demo/better-harness-report/)).
- **Markdown-only** — no visual companion.

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
