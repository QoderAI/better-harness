---
slug: better-harness-in-qoder
title: "Introducing Better Harness in Qoder"
description: Learn how Better Harness diagnoses weak links in a coding-agent workflow, plans bounded improvements, and verifies whether the loop actually got better.
date: 2026-07-30T10:00:00+08:00
authors: [qoder]
tags: [better-harness, qoder, harness-engineering, loop-engineering]
---

Today's coding agents can read requirements, modify code, run tests, and even
submit pull requests. But being able to do many things is not the same as being
able to do them well.

An agent usually cycles through **understanding the task, taking action,
checking the result, and adjusting its next step**. That is the Agent Loop. A
reliable loop does more than keep the agent moving: it gives the agent a clear
goal, defines what it must not touch, explains how to judge the result, and
provides a recovery path when something fails. Without those boundaries, an
agent may change a great deal of code and run many tests while still being
unable to prove that the task is actually complete.

This is the problem that Loop Engineering and Harness Engineering address.
They equip the agent with project context, relevant development tools,
effective verification methods, and explicit safety boundaries so that every
loop moves closer to a reliable delivery.

Building on Qoder's internal experience and the broader community's work on
coding agents, agent loops, and software engineering, we introduced **Better
Harness (Beta)**.

<!-- truncate -->

In current versions of Qoder, you can open Better Harness and start an analysis
and repair from the visual interface, or run the `/better-harness` Skill
directly. It examines how the agent worked through the current task, identifies
missing or weak elements in the loop, and helps you decide what to improve
next.

## How Better Harness diagnoses, improves, and rechecks the loop

Better Harness does not grade the quality of a single answer. It examines the
entire harness that supports a coding agent as it completes a task:

- Are the goal and context clear?
- Is the project easy to run?
- Are permissions under control?
- Does verification provide meaningful evidence?
- Is delivery safe?
- Can the team and the agent learn from the task?

Its main analysis flow is:

1. **Map the current harness.** Identify the goal, context, execution
   entrypoints, feedback paths, delivery mechanisms, and learning mechanisms.
2. **Find the breaks.** Explain which part of the loop lacks a mechanism,
   integration, observed execution, or outcome evidence.
3. **Choose the smallest improvement vehicle.** Route the problem to the most
   appropriate Rule, Skill, Hook, script, automation, or human gate.
4. **Repair and recheck.** Keep the fix bounded, run the relevant verification,
   and run `/better-harness` again to see whether the loop actually improved.

The main analysis flow first collects the underlying evidence. It then asks
three independent, read-only subagents to interpret three evidence lanes:

- **Agent customization assets**, such as Rules, Skills, and Hooks;
- **Real task-session records**, which show what the agent actually did and how
  the task ended; and
- **The project's software-engineering foundation**.

The three lanes are collected independently and reconciled only afterward, so
that one category of evidence does not contaminate the conclusions drawn from
another.

## Agent customization: from capability inventory to actual use

In coding agents such as Qoder, Rules, Skills, Custom Agents, MCP servers,
plugins, memories, and Hooks are the building blocks of an effective loop.
Better Harness inventories these custom capabilities and checks whether they
are complete, discoverable, and usable.

But having the building blocks does not make the loop reliable. A project can
have tests without running the relevant tests for a task. A Skill can exist
without the agent invoking it when it matters. Better Harness therefore also
examines evidence that Rules and Skills were actually used, helping users find
context-engineering gaps and reduce wasted credits.

Qoder Canvas presents this evidence in a detailed report, including patterns
such as Skill usage over a recent period. Better Harness also looks for
repeated work in task sessions that might justify a reusable Rule or Skill.
However, not every observation should become a Skill, and not every repeated
task should be automated. The report keeps those distinctions explicit and
offers bounded improvement suggestions.

For an identified opportunity, the user can select **Plan a fix** and let the
AI generate and execute a repair plan. More importantly, the result does not
have to remain a one-off fix. It can become a reusable Rule, Skill, memory, or
other asset that strengthens the user's own agent harness.

Each task analysis can therefore improve more than the current task. As the
asset base grows, the agent learns more about the user and the quality,
efficiency, and control of later loops can improve as well.

## Real task sessions: reconstructing how the Agent Loop actually ran

Capability inventory alone cannot prove that a loop worked. Better Harness
also analyzes real task-session records—by default, from the most recent 30
days—to understand what the agent actually did and what outcome it produced.

The basic unit of analysis is a task episode: one user goal plus an observable
acceptance boundary. Within each episode, Better Harness looks for four kinds
of signals:

1. **Repeated workflows.** When the same task repeatedly requires the same
   steps or corrections, the project may be missing a Skill, Rule, or script.
2. **Closed-loop verification.** Did the agent actually run the relevant tests,
   lint checks, builds, or regressions in the right place? Repeating a check is
   not enough; the subsequent result must also be accepted and used.
3. **Attribution of friction.** When a task stalls, did the problem come from
   the harness, the project, the model, or the requirement itself? Not every
   failure should be blamed on the agent.
4. **High-impact one-off events.** Did a permission block, missing diagnostic
   entrypoint, or failed recovery materially change the direction of the task?

This lane is analyzed by an independent, read-only subagent. It sees only
redacted factual summaries, not raw prompts, private paths, secrets, or other
sensitive material. These signals make it possible to assess the real use of
Skills and Rules, identify context-engineering problems that affect the loop,
and reduce unnecessary credit consumption.

## Project engineering foundations: make it findable, runnable, and verifiable

The project's existing software-engineering foundations also shape the quality
of every agent loop. A repository may contain extensive documentation, scripts,
and tests, but those capabilities cannot help if the agent cannot find the
correct entrypoint, run it successfully, or decide what to do after it fails.

Better Harness examines five aspects of a project's readiness for agent work:

1. **Findable.** Can the agent quickly locate the relevant code, module
   boundaries, project constraints, and required checks for a specific task?
2. **Runnable.** Are dependencies, configuration, build steps, and startup
   instructions clear? When the environment breaks, can the agent diagnose it,
   reset safely, and start again?
3. **Fast feedback.** After a code change, do the available checks and tests
   quickly show what failed, where it may have failed, and what to try next?
4. **Enforceable rules.** Are architecture, security, API compatibility, and
   database-migration requirements checked by tools rather than existing only
   as documentation or convention?
5. **Controlled changes.** Are change boundaries explicit, do high-risk actions
   require confirmation, and can a failed operation be rolled back, recovered,
   or exited safely?

For example, a test command in the README proves only that the project exposes
a test entrypoint. Inspecting the script reveals what the command actually
covers. Only running the relevant check in a real task and responding to its
result can show that the feedback path has truly entered the Agent Loop.

## Turn every Agent Loop into an asset for the next one

A `/better-harness` analysis is not the finish line. It helps you find breaks,
generate a repair plan, and verify whether a new Rule, Skill, Hook, or script
actually entered the agent's workflow.

The most reusable lessons can then become personal or team-owned agent assets,
making later loops more stable, efficient, and controllable. Open Better
Harness in Qoder—or run `/better-harness`—and find the next part of your loop
that is worth strengthening.
