---
slug: better-harness-is-now-open-source
title: "/better-harness Goes Open Source"
description: We are open-sourcing the engineering practices, evidence model, and runnable workflow behind Better Harness for coding agents.
date: 2026-07-30T18:00:00+08:00
authors: [qoder]
tags: [better-harness, open-source, harness-engineering, agent-work-loop]
---

Last week, we built Better Harness into Qoder Desktop. After launch, many users
asked the same question: **Will this be open source?**

In its first three days, 100,000 people tried Better Harness.

The answer is yes.

Today, Better Harness is officially open source. You can find the project at
[github.com/QoderAI/better-harness](https://github.com/QoderAI/better-harness).

Better Harness is an open-source analysis and continuous-improvement tool for
coding-agent workflows. It connects the engineering practices, evaluation
model, and runtime capabilities of Harness Engineering and Loop Engineering.
The initial open-source release supported Claude Code, Codex, Qoder, and Cursor
with one shared judgment model, although session analysis, evidence coverage,
and output capabilities were not yet identical across the four hosts. Qoder,
which had already been exercised repeatedly in real development workflows, was
the most complete reference implementation at launch.

<!-- truncate -->

| Launch host | Installation or loading path | Default output |
| --- | --- | --- |
| **Claude Code** | Add the repository marketplace, then install the plugin | HTML + Markdown |
| **Codex** | Install through a Git marketplace | HTML + Markdown |
| **Qoder Desktop** | Built in; no separate installation | Canvas |
| **Cursor Agent** | Load from source | HTML / Markdown |

> **Editor's note:** This table records the launch state. Better Harness now
> publishes additional host integrations, and entrypoints differ by host. See
> the current [Installation guide](https://qoderai.github.io/better-harness/docs/installation)
> before installing or running a review.

At launch, the shared workflow was commonly invoked as:

```text
/better-harness
```

You could start the analysis, inspect the report as it ran, and continue
reading this article. When a category of evidence was unavailable, Better
Harness preserved that boundary in the result instead of substituting config
counts or data from another host.

## Better Harness cares about what the agent did in the task

Imagine that an agent modifies a module, runs one test command, and declares
the task complete. The real question is not whether the repository *has* tests.
It is whether that test was relevant to the change, covered the main risks, and
produced enough evidence to support delivery.

Better Harness therefore does not treat the presence of AGENTS.md, Rules,
Skills, MCP servers, Hooks, memories, tests, or CI as proof that they influenced
the task. Every improvement item—a Finding—must include traceable evidence, a
specific user impact, the smallest repair boundary, and a way to verify the
result after the repair.

In one self-analysis snapshot produced from Codex, Better Harness did not turn
the absence of an executed Codex host test into the stronger claim that
“Codex has failed.” It kept the unexecuted host test as an explicit evidence
boundary. Scores can help locate a problem, but the conclusion, impact, repair
scope, and verification method are what matter.

That is the difference between Better Harness and a configuration checklist. A
checklist tells you what the project possesses. Better Harness asks whether
those capabilities actually helped the agent complete a trustworthy task.

And if the judgments in a report are meant to be inspected, changed, and
reverified, open source cannot stop at publishing an executable entrypoint.

## The three-layer open-source system behind Better Harness

Publishing the `/better-harness` prompt on GitHub would technically qualify as
open source. But for a coding agent, no single prompt determines the result.
What matters is the full working method behind it: what is worth checking, what
counts as evidence, how judgments are formed, and how they can keep running and
changing in real projects.

That is why Better Harness opens three connected layers.

### Layer 1: Harness Engineering best practices

This layer answers a practical question: when we examine sessions, CLIs,
observability, Rules, Skills, MCP servers, memories, Hooks, and automation, what
should we check—and which conclusions cannot be drawn merely from the presence
of configuration?

The knowledge is organized by problem domain under `references/`:

| Domain | Question it answers | Main evidence |
| --- | --- | --- |
| **Session Evidence** | How did the agent actually complete the task? | Sessions, task episodes, tool calls, retries, usage, and outcome evidence |
| **Project Harness** | Does the project provide reliable execution, verification, and delivery paths? | CLI, observability, design contracts, tests, Git Hooks, sensitive code, and recovery mechanisms |
| **Agent Customize** | Are agent assets discoverable, applicable, and actually useful? | Rules, Skills, MCP, memories, Hooks, Custom Agents, and host configuration |
| **Loop Engineering** | Which mechanism should own a confirmed repeated workflow? | Skills, Hooks, scripts, automation, Rules, Custom Agents, MCP, and related mechanisms |

Better Harness does not load one endlessly expanding master prompt on every
run. It reads the judgment criteria for the problem at hand. A diagnostic issue
routes to observability practices. A Skill issue routes to Skill Review. A
repeated workflow first triggers a decision about whether a Skill, Hook, script,
or automation should own it over time.

### Layer 2: the Agent Work Loop evaluation model

This layer turns engineering practices into questions that can be checked one
by one, while constraining the relationship between evidence, scores, and
conclusions. The current model and evidence states are public in the
[Agent Work Loop model](https://github.com/QoderAI/better-harness/blob/main/models/agent-work-loop.md).

Because the standard is still emerging, we did not want one model to define a
“good harness” subjectively. The first internal evaluation selected 30 real
GitHub projects. Four model families independently evaluated them using
OpenAI's Harness Engineering article as a starting point, producing 120
standardized reports. Cross-model comparison and human calibration then
clarified evidence requirements, judgment boundaries, and differences between
project types before every project was evaluated again under the updated
criteria.

This loop—automated evaluation, automated aggregation, human calibration, and
automated reruns—produced the first reproducible Harness Engineering evaluation
model that we could continue to adjust.

The first version still resembled a conventional software-engineering maturity
scan. It focused on whether a project had documentation, tests, CI, and safety
mechanisms. We soon learned that static assets cannot prove that an agent
actually completed a task.

Better Harness itself is developed through a spec-driven process so that
changes in the model and product capabilities remain traceable. As more than
200 specs accumulated, the model shifted from asking “What exists in the
repository?” to asking “What actually happened in the task?”

The evaluation target narrowed from a repository or a session to a concrete
task. A session stopped being the thing being evaluated and became a container
for evidence. The model then stabilized around five dimensions: task
understanding, controlled execution, change verification, reliable delivery,
and experience capture. File existence, config counts, temporal proximity, and
even a successful command can no longer be treated as direct proof that a
capability was effective.

The Agent Work Loop is therefore not a static scorecard. It is a judgment
system centered on real tasks, designed to be reproduced and continuously
calibrated.

### Layer 3: a runnable engineering implementation

The third layer makes the practices and model repeatable in real projects.
Better Harness starts an analysis through a plugin or CLI—the JavaScript code
under the project's `scripts/` directory—freezes the task scope, and collects
three evidence lanes independently:

- **Session Evidence** reconstructs the agent's behavior in real tasks.
- **Project Harness** checks whether the project can be started, diagnosed,
  verified, and recovered.
- **Agent Customize** checks the configuration, routing, and usage evidence for
  Rules, Skills, MCP servers, memories, and Hooks.

The lanes remain separate during collection and analysis. Only then does the
Lead reconcile them using the criteria in `references/` and the Agent Work Loop
model. “The project has this capability” and “the agent used this capability in
the task” remain two different facts.

The output is not just a score. It is a set of Findings with evidence
boundaries, user impact, repair scope, and verification methods. Once rendered
and validated, the report can enter a repair flow. If the analysis finds stable
repeated work, Loop Engineering determines whether a Skill, Hook, script,
automation, or another mechanism should own it over time.

Completing a repair still does not prove that the workflow improved. The loop
is closed only when a later task of the same kind produces a better observed
result.

## Start with the first verifiable problem

### For Qoder users

At the time of the announcement, Qoder Desktop included Better Harness in the
Quest view as **Better Harness (Beta)** and exposed `/better-harness` directly.
Qoder CLI and the JetBrains plugin could use the same capability on a machine
where Qoder Desktop had already been installed. Refer to the current
[Installation guide](https://qoderai.github.io/better-harness/docs/installation#qoder)
for today's supported Qoder entrypoints.

### From the open-source repository

Visit the
[Better Harness GitHub repository](https://github.com/QoderAI/better-harness)
and follow the current README or Installation guide. For example, Claude Code
users can run:

```text
/plugin marketplace add QoderAI/better-harness
/plugin install better-harness@better-harness
```

Then start a review with:

```text
/better-harness Analyze my project's harness and generate an HTML report
```

Your first Better Harness run does not need to build a complete agent
engineering system, and it does not need to chase a perfect score. A more
practical starting point is one problem with clear evidence, a concrete impact,
and a fast verification path.

It might be a check command the agent cannot find, an error log with no useful
next diagnostic step, or a Skill that exists but has never entered the task
routing path.

Fix one problem, run the review again, and observe whether a later task of the
same kind changes. Harness Engineering is not a one-time configuration project.
It is the continuous work of making a project easier for an agent to understand,
execute, and verify.

## We know it is not complete

Better Harness has been run and calibrated repeatedly in Qoder's real
development workflows, but the current model still reflects the project types
and task scenarios we know best.

Different technology stacks, project sizes, team constraints, and coding
agents may reveal blind spots. Better Harness needs more real evidence to keep
correcting them.

If you would like to contribute, there are several useful starting points:

- **Add an engineering practice.** Add a judgment guide for a language,
  framework, or common workflow under `references/`. No code is required.
- **Add an evaluation perspective.** Add an evidence-backed dimension or
  detector under `models/` or `scripts/`, together with fixtures and tests.
- **Add host support.** Complete evidence collection and verification for
  another coding agent. The repository
  [Roadmap](https://github.com/QoderAI/better-harness/blob/main/roadmap.md)
  lists candidate work.
- **Add a real case study.** Contribute a redacted team example under
  `case-studies/`.

If you disagree with a Finding, please open an issue. A counterexample from a
real project is more useful to us than a star—although we will happily accept
the star too. 😁

---

**Born in Qoder, returned to the community. Give every coding agent a foundation
of verified engineering practice.**
