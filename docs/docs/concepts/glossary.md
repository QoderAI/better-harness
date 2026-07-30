---
id: glossary
title: Glossary
sidebar_position: 3
---

# Glossary

A one-stop decoder for the vocabulary in reports and docs. You only need two
terms to start: **lifecycle dimensions** and **report**. Everything below is
progressive detail you load when a task needs it.

## The mental model in three lines

- A **harness** wraps a target so an agent can run a bounded, recoverable
  loop: understand → change → validate → repair → re-validate → state residual
  risk.
- Better Harness starts from the Agent Work Loop, qualifies it with available
  session and project evidence, guards changes while they happen, and feeds
  what it learns back into rules.
- Session evidence changes confidence and coverage, not the model.

## Core concepts

| Term | What it means |
| --- | --- |
| Harness | The engineering environment around an agent that makes a change loop bounded and recoverable. |
| The loop | `understand context -> bounded change -> choose validation -> interpret failure -> repair -> re-run validation -> state residual risk` |
| Agent Work Loop | The default `/better-harness` model: what the Harness supports, what agents actually did when observable, where a task loop lost control, and what should improve next. |
| Task Episode | One user goal with one acceptance boundary; the review unit for behavior claims. |
| Software Fluency | The static project lens used for an explicit repository-only score and the independent project evidence pass. |
| Progressive disclosure | Reveal context to an agent by task, not all at once. |

## Lenses and models

| Term | What it means |
| --- | --- |
| Five lifecycle dimensions | Task Understanding, Controlled Execution, Change Validation, Reliable Delivery, Learning Capture. |
| Five software capabilities | Context Map, Environment Readiness, Fast Feedback, Quality Gates, Change Safety. |
| AI Readiness Ladder | The L1–L5 maturity scale (Awareness → Assisted → Structured → Spec-Governed → Closed-Loop). |
| Style | The visual framing of a report (analyst, audit scorecard, consulting deck, dashboard, …). |
| Output mode | The rendered form of a report: Qoder Canvas, HTML visual, or Markdown. |

## Evidence and scoring

| Term | What it means |
| --- | --- |
| Evidence boundary | The rule that separates static file evidence from executed command, CI, runtime, or UI evidence; unverified areas cap confidence. |
| Evidence state | `Present`, `Wired`, `Exercised`, `Outcome-supported`, `Missing`, `Unobserved`, or `Not applicable` — see [Agent Work Loop](./agent-work-loop.md). |
| Confidence | Low/Medium/High rating bound to how much was actually executed vs. only read. |
| Change confidence | Whether an AI-generated change is ready to land, judged by blast radius, sensitive paths, size, and validation. |

## The action loop (report → change)

| Term | What it means |
| --- | --- |
| Handoff | A row-scoped next step inside a report (draft a fix, schedule a follow-up), not a dead-end score. |
| Repair plan | A bounded fix plan for one finding, drafted via `/better-harness repair-plan` without writing report artifacts. |
| Loop Engineering | The domain that decides whether repeated work exists and which durable owner (skill, hook, script, automation, rule) should hold it. |
| Loop Discovery | The routing gate that proves a loop from evidence and picks the smallest durable owner. |
| Schedule-ready | A finding stable enough to become a recurring `/schedule /better-harness` follow-up, with cadence, validation, and a stop condition. |

## Extension and hosting

| Term | What it means |
| --- | --- |
| Skill | A repeatable agent workflow defined by `SKILL.md` frontmatter plus a concise workflow. |
| Host adapter | Per-host discovery and evidence-shape glue; keeps the engine host-neutral. |
| Host shell | Thin host metadata (`.claude-plugin/`, `.qoder-plugin/`, `.cursor-plugin/`, `.codex-plugin/`) that exposes canonical behavior without owning product logic. |
| Canonical owner | The single directory that owns a behavior's product judgment; host shells and mirrors point back to it. |

The full glossary with owner links lives in
[`docs/glossary.md`](https://github.com/QoderAI/better-harness/blob/main/docs/glossary.md).
