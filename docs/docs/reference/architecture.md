---
id: architecture
title: Architecture
sidebar_position: 1
---

# Architecture

![Better Harness architecture: host integration, three independent evidence agents, unified analysis by one lead agent, findings, host outputs, and repair](/img/better-harness-architecture-en.svg)

The architecture keeps the three evidence domains independent until unified
analysis by the lead agent. Every result retains a visible evidence source,
owner, and validation route.

## Feedforward and feedback

Better Harness uses a
[feedforward-and-feedback](https://martinfowler.com/articles/harness-engineering.html#FeedforwardandFeedback)
loop that combines guidance available before work starts with signals
available after the agent acts:

- **Feedforward guides** — `AGENTS.md`, specs, Skills, and acceptance criteria
  steer the agent before it acts.
- **Feedback sensors** — linters, tests, Hooks, and review agents observe
  results and help the agent self-correct.

## Where things live

| Directory | Role |
| --- | --- |
| `skills/` | Repeatable agent workflows (start at `better-harness`) |
| `models/` | Evaluation models; default first, advanced second |
| `references/` | Prose guidance, loaded on demand |
| `templates/` | Report skeletons, output modes, and styles |
| `hooks/` | Change-time enforcement |
| `scripts/` | Capability-owned CLIs |

## What runs under the hood

| Capability | CLI | Job |
| --- | --- | --- |
| Quickstart | `better-harness report` | Gather evidence and hand off to the skill |
| Readiness analysis | `/better-harness` skill | Synthesize the evidence-backed report |
| Project evidence | `better-harness core-change-watch` | Project, history, core-path, and diff signals |
| Change confidence | `hooks/git-scripts/blast-radius` | Symbol-graph blast radius of a change |
| Dependency governance | `better-harness dependency-governance` | Update automation, audit, stale-dep signals |
| Session evidence | `better-harness session-analysis` | Normalize Qoder, Codex, Claude, Augment/Auggie, Cursor, Qwen, Copilot, Pi, Kimi Code, or WorkBuddy session behavior |
| Agent assets | `better-harness coding-agent-practices inventory` | Inventory configured agent surfaces |
| Guardrails | `hooks/`, `scripts/agent-guardrails` | Secret scanning and lifecycle checks |

## Source of truth

Directory routing, template ownership, and canonical-owner rules live in
[`docs/ARCHITECTURE.md`](https://github.com/QoderAI/better-harness/blob/main/docs/ARCHITECTURE.md).
