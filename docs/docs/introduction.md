---
id: introduction
title: Introduction
sidebar_position: 1
---

# Introduction

**Better Harness** reviews how coding agents understand tasks, make changes,
verify results, deliver safely, and learn—then shows what to improve next,
with every finding tied to visible evidence.

## Why Better Harness?

AI coding agents change code fast, but the workflow around them is often the
weak point:

- 🎯 **Fuzzy goals** — the agent confidently solves the wrong problem.
- 🧭 **Improvised steps** — work happens on paths nobody can reproduce.
- ✅ **"It works" without proof** — validation is incomplete or missing.
- 🚢 **Speed over safeguards** — review and delivery checks get bypassed.
- 🧠 **Lessons lost** — the same friction comes back on the next task.

Reviewing only the final diff misses these system-level problems. Better
Harness reviews the workflow itself: it gathers project evidence (and session
evidence where supported), evaluates five connected dimensions, and turns
concrete gaps into prioritized findings — each tied to its evidence, expected
outcome, repair boundary, and validation route, so a team can improve one
issue at a time.

## What is open

Better Harness opens three connected layers, not only a slash-command prompt:

- **Engineering practices** — evidence and judgment guidance across
  [Session Evidence, Project Harness, Agent Customize, and Loop Engineering](https://github.com/QoderAI/better-harness/blob/main/references/README.md).
- **Evaluation model** — the task-centered
  [Agent Work Loop](./concepts/agent-work-loop.md), including evidence states,
  findings, scoring boundaries, and longitudinal validation.
- **Runnable implementation** — the canonical
  [`/better-harness` workflow](https://github.com/QoderAI/better-harness/blob/main/skills/better-harness/SKILL.md),
  evidence collectors, analyzers, renderers, and thin
  [host adapters](./hosts/adapter-matrix.md).

The three layers share the same boundary: configured assets can establish that
a mechanism exists, but only linked task evidence can establish that it was
used or improved an outcome.

## Deliberately honest

Unobserved behavior stays explicit instead of becoming an unsupported score or
claim. Passing a current check proves that the intervention was exercised;
only a comparable later result can prove that the loop improved.

## Next steps

- [Install Better Harness](./installation.mdx) for your coding agent.
- [Generate your first report](./your-first-report.md).
- Understand the [Agent Work Loop](./concepts/agent-work-loop.md) behind every
  report.

:::info Source of truth
This site is a curated view. Canonical judgment lives in the
[repository](https://github.com/QoderAI/better-harness) under `skills/`,
`models/`, `references/`, and `docs/`.
:::
