---
id: agent-work-loop
title: Agent Work Loop
sidebar_position: 1
---

# Agent Work Loop

The **Agent Work Loop** reviews whether a coding-agent Harness can carry one
task from a clear intent to a validated, reliably delivered result, then turn
supported learning opportunities into improvements that remain useful over
time. It is not a mandatory process, transcript score, asset inventory, or
repository maturity model.

![Agent Work Loop: five dimensions from task understanding through learning capture](/img/agent-work-loop-en.svg)

## The loop being scored

A good harness lets an agent finish a bounded, recoverable loop:

```text
understand context -> make a bounded change -> choose the right validation ->
interpret failure -> repair -> re-run validation -> state residual risk
```

## The five dimensions

| Dimension | The question it answers | Backed by |
| --- | --- | --- |
| **Task Understanding** | Does the agent know the goal and what "done" means? | Rules, `AGENTS.md`, specs, `DESIGN.md` |
| **Controlled Execution** | Is the work on supported, repeatable paths? | Skills, commands, MCP tools, sandbox boundaries |
| **Change Validation** | Is there evidence the change actually works? | Tests, lint, Hooks, observable diagnostics |
| **Reliable Delivery** | Does AI speed bypass quality checks or acceptance? | Human review, approvals, CI/CD, recovery paths |
| **Learning Capture** | Does the next task benefit from this one? | Loop Discovery, reusable SDLC Skills, Memory |

Each dimension resolves three stable checks (fifteen check ids in total)
before it is scored. Learning Capture is scored independently of the first
four dimensions.

## Review unit: the Task Episode

A **Task Episode** is one user goal with one acceptance boundary. It may span
multiple turns or sessions, but every claim must stay tied to the same goal,
target, action, and result. Unrelated work is never merged because it happened
in one session, and aggregate counts never become task behavior.

When eligible session evidence is partial or unavailable, the review stays a
`session-limited` Agent Work Loop review: unavailable behavior remains
`Unobserved`, and inspected project Harness evidence supports only the
mechanisms it can support.

## Evidence states

- `Present`: an owned mechanism or review contract exists;
- `Wired`: the relevant task, trigger, or owner route can reach it;
- `Exercised`: a linked episode or inspection used it and retained a result;
- `Outcome-supported`: a comparable later result supports the claimed effect;
- `Missing`: inspected evidence confirms a required mechanism or result is absent;
- `Unobserved`: the available observation boundary cannot decide;
- `Not applicable`: inspected task and project evidence proves it does not apply.

Evidence state is not pass/fail. An exercised operation may expose a defect, a
safe denial may be correct behavior, and an unavailable external boundary is
`Unobserved`, not automatically `Missing`.

## Evidence limits score confidence

For the four current-task dimensions, the highest supported evidence state
sets an absolute score ceiling:

| Highest supported evidence | Absolute score ceiling |
| --- | --- |
| `Missing`, `Unobserved`, or `Not applicable` | 59 |
| `Present` | 74 |
| `Wired` | 84 |
| `Exercised` | 94 |
| `Outcome-supported` | 100 |

These are ceilings, not a score formula. A configured capability is not
observed use, and only an `Outcome-supported` later comparison permits a claim
that an intervention improved later work.

## Full model

The complete contract — check tables, findings, scoring boundaries, and
longitudinal validation — lives in
[`models/agent-work-loop.md`](https://github.com/QoderAI/better-harness/blob/main/models/agent-work-loop.md).
