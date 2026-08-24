---
slug: harness-inspector
title: "Harness Inspector: Seeing an Agent Delivery from Intent to Commit"
description: A session log tells you what an agent did, not why the task started or which actions reached the codebase. Harness Inspector reconnects intent, sessions, file activity, and Git commits into one traceable delivery you can actually read.
date: 2026-08-14T10:00:00+08:00
authors: [qoder]
tags: [better-harness, harness-inspector, coding-agent, provenance, agent-skills]
---

Lately we have been trying to improve one capability in Better Harness: **automatic SKILL distillation** — recognizing the recurring work paths inside an agent's real sessions, and then deciding which of them are worth capturing as a reusable SKILL. Once we actually started, we found the problem was far harder than "just analyze a session."

For a real software task, an agent's behavior never happens in isolation. It starts from a requirement or a user story, moves through understanding the intent, exploring context, editing code, and verifying the change, and only then produces a contribution someone can review. Looking at the session alone, you can see *what* the agent did, but it is hard to tell *why* those actions happened, or *which* of them actually made it into the final delivery.

So we began treating a single agent delivery as one continuous chain. Today, you only need to run this inside a project directory:

```bash
npx @qoder-ai/better-harness inspector
```

and you get a local, read-only Harness Inspector page that puts the project's agent sessions, file activity, and Git commits into one interactive view.

<!-- truncate -->

GitHub: [https://github.com/QoderAI/better-harness](https://github.com/QoderAI/better-harness)

## From a session to a complete delivery

Harness Inspector started as a session-debugging tool: a way to see what an agent said, which tools it called, and which files it changed. But as sessions, file activity, and Git history got wired together, we realized the thing worth observing was not the conversation itself, but this:

> How a software change starts from an intent, passes through an agent's execution, and ends up as an artifact that can enter the engineering system.

The session is only the middle of that chain.

### The delivery chain: from intent to output

We split a coding-agent delivery into three continuous parts with different boundaries:

![Intent, process, and output form one traceable delivery chain from requirement to commit](/img/harness-inspector-architecture-en.svg)

- **Intent** is the semantic starting point of a change — a requirement, an Issue, a Spec, or an architectural constraint.
- **Process** is how the change actually unfolds. For an agent, that is mostly the session record and the searching, reading, editing, and verifying inside it.
- **Output** is the final result the agent delivers into the engineering system. For now, the clearest anchor is the code commit.

So Story, Session, and Commit are not three parallel abstractions. They are the **observable objects of Intent, Process, and Output in today's software toolchain** (intent may also appear as an Issue or a Spec depending on the context). What Harness Inspector does is not to render a conversation more completely, but to rebuild a *traceable* delivery chain from requirement to commit.

As a narrative it reads like a straight line. In a real project it looks more like an evidence graph: one Story may span several sessions, and one session may touch several commits.

### A small example: from Story to Commit

We published a read-only public sample on the Better Harness docs site (English demo data, no local content is read): [https://qoderai.github.io/better-harness/inspector](https://qoderai.github.io/better-harness/inspector).

Looking at the session alone, you see a stream of search, read, edit, and test activity. It is hard to be sure it stayed anchored to the original requirement, and impossible to know which of those edits reached the repository. Looking at the commit alone, you see which files changed, but not how the agent understood the problem, built context, or verified the result before committing.

Put Story, Session, and Commit in one view, and the change finally becomes a reasonably complete delivery: the Story says *why* the change was needed, the Session shows *how* it happened, and the Commit records *what* was left behind.

Connecting requirement, agent behavior, and commit let us inspect a delivery as a whole for the first time. But once we opened a few real sessions with hundreds of tool calls, another problem showed up fast: **being able to connect a delivery is not the same as being able to read it.**

## How Harness Inspector reads an agent delivery

Around the Better Harness harness model, we define Harness Inspector like this:

> **Harness Inspector is a local, read-only workbench for agent deliveries. It brings requirements, agent sessions, file activity, and Git commits into one interactive view, so you can inspect why a software change happened, how it happened, and what it left behind.**

Centered on a single complete delivery, it offers three ways to observe the chain from requirement to commit:

- **Workbench** — the relationships between requirement, session, and commit.
- **Trace** — the internal structure of a session.
- **Replay** — the task replayed in event order.

Put simply: **Workbench for relationships, Trace for structure, Replay for order.** Together they reconstruct how a requirement passes through an agent's understanding, exploration, editing, and verification into a reviewable commit.

### Workbench: connecting intent, process, and output

Workbench is the whole-delivery view. On the left is the user requirement that triggered the session, plus the goal refinements made along the way. In the middle is what happened during the session — searches, reads, tool calls, and Git operations. On the right are the commits observed within the current scope and the files they changed.

Its point is not to pile data together, but to show the relationships between requirement, process, and output that have **actually been observed**. When the evidence for a relationship is weak, Inspector keeps it as a *candidate* or leaves it *unmapped*, rather than auto-assembling a delivery path that only looks complete.

### Trace: reading a session as a work trajectory

Workbench helps you find a delivery; Trace expands the session inside it.

Inside a session, Trace organizes user input, intermediate responses, tool calls, and file activity by Turn, and connects their positions in time along the timeline at the top. Click a segment to jump to the corresponding call; consecutive repeated activity is folded so a flood of similar operations does not drown out the changes that matter.

Trace does not try to recover reasoning the model never exposed. It reorganizes the behavior that *was* recorded into a readable work trajectory, so you can inspect how the agent searched for context, edited code, and ran verification.

### Replay: revisiting a delivery in event order

Replay walks through the retained events step by step. A reviewer can move through user input, agent response, tool call, file, and commit in order, watching where the agent formed a direction and when it made and verified a change.

It is a read-only replay of evidence only. It does not rerun tools, restore the workspace, or resume the original session; where an exact timestamp was never recorded, it keeps order only and invents nothing that was not observed.

Workbench establishes the delivery context, Trace expands the session's work trajectory, and Replay restores the order of events. Together they turn a requirement-to-commit agent delivery into something you can enter and inspect layer by layer. And once a delivery reads clearly, we can return to the original question: which of the paths in this trajectory are actually worth keeping.

## From delivery evidence to SKILL distillation

Once a delivery can be seen clearly, we can go back to where we started: which experiences inside a session are worth distilling into a SKILL? Clearly not the most frequent tool call. An agent may reread the same file over and over because its context was thin, or retry a failing command repeatedly — behavior that is frequent but is more likely noise than reusable engineering experience.

What is worth keeping is usually a work path that recurs across similar tasks *and* is supported by the final output and verification result: how the agent scoped the change from the requirement, how it built the necessary context, and how it completed the edit, ran verification, and checked the result. Only by placing those actions back into their Story, Session, and Commit can we tell whether they were an incidental choice for this one task or a relatively stable way of working that transfers to others.

So automatic SKILL distillation is not summarizing one session into a new `SKILL.md`. It is recognizing stable patterns across many real deliveries, then giving each one its applicable scenario, context boundaries, execution steps, and verification method. What Inspector solves today is the most basic link in that chain: letting real deliveries leave behind bounded, inspectable evidence. Only on that foundation can we compare similar tasks, form SKILL candidates, and verify in later deliveries whether they actually improved how the agent works.

## Closing: see the delivery first, then distill the experience

What we set out to solve was how to recognize reusable work paths inside agent sessions. But once you actually dig in, a session can only record what the agent did — it cannot, on its own, explain why the task began, or prove which actions became an engineering artifact.

Harness Inspector reconnects requirement, session, file activity, and Git commit, making a single agent delivery observable, inspectable, and traceable. Only by seeing a delivery clearly can we judge which behavior was merely incidental and which path is worth distilling into a SKILL.

From session to delivery, and from delivery to distilled experience — that is the starting point of automatic SKILL evolution.
