# Better Harness Glossary

A one-stop decoder for the vocabulary in the rest of the docs. If a term in a
report, skill, or reference is unfamiliar, find it here first. For the overall
flow, read the [Agent Work Loop](../models/agent-work-loop.md); for report
judgments, follow the selected [model](../models/routing.md) and
[report contract](../skills/better-harness/SKILL.md#report-output);
for extension surfaces, read [community.md](community.md).

## The Mental Model In Three Lines

- A **harness** wraps a target so an agent can run a bounded, recoverable loop:
  understand → change → validate → repair → re-validate → state residual risk.
- Better Harness starts from the Agent Work Loop, qualifies it with available
  session and project evidence, guards changes while they happen, and feeds
  what it learns back into rules.
- You only need two terms to start: **lifecycle dimensions** and **report**.
  Everything below is progressive detail you load when a task needs it.

## Core Concepts

| Term | What it means | Owner / read next |
|---|---|---|
| Harness | The engineering environment around an agent that makes a change loop bounded and recoverable; Better Harness uses it to establish and validate the improvement baseline. | [models/agent-work-loop.md](../models/agent-work-loop.md) |
| The loop | `understand context -> bounded change -> choose validation -> interpret failure -> repair -> re-run validation -> state residual risk`. | [models/agent-work-loop.md](../models/agent-work-loop.md) |
| Software Fluency | The static project lens used for an explicit repository-only score and the independent project evidence pass. | [models/software-fluency.md](../models/software-fluency.md) |
| Agent Work Loop | Default `/better-harness` model: what the Harness supports, what agents actually did when observable, where a task loop lost control, and what should improve next. | [models/agent-work-loop.md](../models/agent-work-loop.md) |
| Progressive disclosure | Reveal context to an agent by task, not all at once; the design principle behind these docs. | [skills/better-harness/SKILL.md](../skills/better-harness/SKILL.md) |

## Lenses And Models

| Term | What it means | Owner / read next |
|---|---|---|
| Five lifecycle dimensions | Default `/better-harness` dimensions: **Task Understanding**, **Controlled Execution**, **Change Validation**, **Reliable Delivery**, and **Learning Capture**. | [models/agent-work-loop.md](../models/agent-work-loop.md) |
| Five software capabilities | Static/project-pass lens: **Context Map**, **Environment Readiness**, **Fast Feedback**, **Quality Gates**, and **Change Safety**. | [models/software-fluency.md](../models/software-fluency.md) |
| AI Readiness Ladder | The L1–L5 maturity scale (Awareness → Assisted → Structured → Spec-Governed → Closed-Loop). | [models/software-fluency.md](../models/software-fluency.md) |
| `agent-work-loop-v4` | The default `/better-harness` model; earlier Agent Work Loop contracts are unsupported except for the bounded v21 intervention-ledger continuity read. | [models/routing.md](../models/routing.md) |
| `software-fluency` | The explicit static scan and project-pass lens, not a no-session `/better-harness` fallback. | [models/routing.md](../models/routing.md) |
| `harness-engineering` (F0–F4) | Advanced, optional evidence contract with submetric-level scoring. Ignore until a report needs that detail. | [models/routing.md](../models/routing.md) |
| Submetric | A diagnostic detail under a software capability, such as Task Entrypoint under Context Map, with L1-L5 decision rules. | [models/software-fluency.md](../models/software-fluency.md) |
| Style | The visual framing of a report (analyst, audit scorecard, consulting deck, dashboard, …); ids stay internal. | [templates/style/routing.md](../templates/style/routing.md) |
| Output mode | The rendered form of a report: Qoder Canvas, HTML visual, or Markdown. | [templates/reporting/routing.md](../templates/reporting/routing.md) |

## Evidence And Scoring

| Term | What it means | Owner / read next |
|---|---|---|
| Harness report concepts | Terms that can appear in `findings.json`, score rows, report cards, AI Agent Practices rows, recommendations, or reader notes. | [model routing](../models/routing.md); [report contract](../skills/better-harness/SKILL.md#report-output) |
| Evidence boundary | The rule that separates static file evidence from executed command, CI, runtime, or UI evidence; unverified areas cap confidence. | [Core Change Watch](../references/project-harness/core-change-watch.md) |
| Detector / signal | A named evidence contract (e.g. `context-fluency`) that projects raw evidence into scorecard rows. | Start with [model routing](../models/routing.md); executable or workflow-specific signals stay with their capability or skill-local owner. |
| Confidence | Low/Medium/High rating bound to how much was actually executed vs. only read; static-only first passes stay Low/Medium. | [skills/better-harness/SKILL.md](../skills/better-harness/SKILL.md) |
| Change confidence | Whether an AI-generated change is ready to land, judged by blast radius, sensitive paths, size, and validation. | [Core Change Watch](../references/project-harness/core-change-watch.md) |

## Capabilities (What Runs Under The Hood)

| Term | What it means | Owner / read next |
|---|---|---|
| Bounded static first pass | The fast, non-interactive path behind `better-harness report`: static evidence only, capped findings and scores. | [skills/better-harness/SKILL.md](../skills/better-harness/SKILL.md) |
| `better-harness` | The skill that turns gathered evidence into the readiness report. | [skills/better-harness](../skills/better-harness) |
| `core-change-watch` | Project, history, core-path, and current-diff evidence collection. | [scripts/core-change-watch](../scripts/core-change-watch) |
| Blast radius | The symbol-graph reach of a change, computed with tree-sitter (JS/TS, Go, Python) as a git hook. | [hooks/git-scripts/blast-radius](../hooks/git-scripts/blast-radius) |
| `dependency-governance` | Update-automation, audit, and stale-dependency signals. | [scripts/dependency-governance](../scripts/dependency-governance) |
| `session-analysis` | Normalizes Qoder, Codex, Claude, Cursor, Qwen, Copilot, Pi, or WorkBuddy agent session behavior into evidence. | [scripts/session-analysis](../scripts/session-analysis) |
| Guardrails | Change-time enforcement: secret scanning and lifecycle hook checks. | [hooks](../hooks), [scripts/agent-guardrails](../scripts/agent-guardrails) |

## The Action Loop (Report → Change)

| Term | What it means | Owner / read next |
|---|---|---|
| Handoff | A row-scoped next step inside a report (draft a fix, schedule a follow-up, open a chat), not a dead-end score. | [templates/reporting/qoder-canvas.md](../templates/reporting/qoder-canvas.md) |
| Repair plan | A bounded fix plan for one finding, drafted via `/better-harness repair-plan` (起草修复方案) without writing report artifacts. | [skills/better-harness/SKILL.md](../skills/better-harness/SKILL.md) |
| Loop Engineering | The domain that decides whether repeated work exists and which durable owner (skill, hook, script, automation, rule) should hold it. | [references/loop-engineering/README.md](../references/loop-engineering/README.md) |
| Loop Discovery | The routing gate that proves a loop from evidence and picks the smallest durable owner. | [references/loop-engineering/loop-discovery.md](../references/loop-engineering/loop-discovery.md) |
| Schedule-ready | A finding stable enough to become a recurring `/schedule /better-harness` follow-up, with cadence, validation, and stop condition. | [references/loop-engineering/loop-discovery.md](../references/loop-engineering/loop-discovery.md) |

## Extension And Hosting

| Term | What it means | Owner / read next |
|---|---|---|
| Skill | A repeatable agent workflow defined by `SKILL.md` frontmatter plus a concise workflow. | [community.md](community.md); report use: [report contract](../skills/better-harness/SKILL.md#report-output) |
| Host adapter | Per-host discovery and evidence-shape glue (e.g. Qoder, Codex); keeps the engine host-neutral. | [adapters/README.md](adapters/README.md) |
| Host shell | Thin host metadata (`.claude-plugin/`, `.qoder-plugin/`, `.cursor-plugin/`, `.codex-plugin/`, `.github/plugin/`, `qwen-extension.json`, the `pi` manifest in `package.json`, `.codebuddy-plugin/` + `settings.json` + `agents/`, or a future lifecycle shell) that exposes canonical behavior without owning product logic; the public npm package ships all eight current native metadata roots, while the Qoder runtime bundle includes only `.qoder-plugin/`. | [ARCHITECTURE.md](ARCHITECTURE.md) |
| Canonical owner | The single directory that owns a behavior's product judgment; host shells and mirrors point back to it. | [ARCHITECTURE.md](ARCHITECTURE.md) |

## "I Want To… → Use"

| Goal | Start with |
|---|---|
| Improve one bounded work loop | Use `better-harness report` or `/better-harness` to establish the baseline, then review one finding-bound intervention ([README](../README.md)) |
| Understand a report | [Agent Work Loop](../models/agent-work-loop.md): five lifecycle dimensions qualified by session and project evidence |
| Act on a finding | `/better-harness repair-plan`, then [Loop Discovery](../references/loop-engineering/loop-discovery.md) |
| Add a workflow or guidance | [community.md](community.md) "Start Here" |
| Support a new agent host | [adapters/README.md](adapters/README.md) |
