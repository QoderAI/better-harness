---
id: your-first-report
title: Your First Report
sidebar_position: 3
---

# Your First Report

Once Better Harness is [installed](./installation.mdx), open the repository
you want to analyze and start a new session or task. Use the invocation shown in
your host's **Verify installation** section—the syntax is host-specific:

- Claude Code, Qoder, Cursor, and Qwen Code use the documented
  `/better-harness` report prompt.
- Codex Desktop uses `@better-harness`; Codex CLI uses
  `$better-harness:better-harness`.
- For GitHub Copilot, first confirm that `copilot skill list` includes
  `better-harness`, then ask Copilot to use that Skill for the analysis. The site
  does not claim an unverified slash-command alias.

Better Harness scopes behavior claims to relevant Task Episodes and the
surrounding project mechanisms. Qoder produces a Canvas report; Claude Code,
Codex, Cursor, Qwen Code, and GitHub Copilot produce self-contained HTML with
paired Markdown. Missing or partial evidence remains explicit.

See the [sample report](pathname:///demo/better-harness-report/) for
what the HTML output looks like.

## Reading the report

The report combines the five-part Agent Work Loop overview, prioritized
findings, detected agent assets, and an evidence brief. Read it through the
[five work-loop questions](./concepts/agent-work-loop.md); session evidence
changes confidence and coverage, not the model.

## From report to action

A report is the start of a loop, not a verdict. Each finding is a row with a
next step, so a score turns into a change:

1. **Draft a bounded fix.** Run `/better-harness repair-plan` to validate one
   finding and draft a scoped repair plan, without writing new report
   artifacts.
2. **Give recurring work an owner.** When a finding looks like repeated work,
   route it through
   [Loop Discovery](https://github.com/QoderAI/better-harness/blob/main/references/loop-engineering/loop-discovery.md)
   to pick the smallest durable owner: a skill, hook, script, automation, or
   rule.
3. **Schedule follow-up.** A schedule-ready finding renders a row-scoped
   `/schedule /better-harness` handoff with cadence, validation, and a stop
   condition.
4. **Confirm movement.** Re-run the analysis to check the change landed and the
   capability signal moved.

## Static-only inspection

From a source checkout, you can inspect repository evidence without reading
local sessions:

```bash
node scripts/better-harness.mjs report --no-sessions
```
