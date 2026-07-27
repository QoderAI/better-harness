# Better Harness Concepts (one page)

Everything you need to start, on one page. The rest of the docs are progressive
detail you can load when a task needs it.

## What it is

Better Harness makes a repository legible and safe for AI coding agents. It measures
how ready a repo is, guards changes as they happen, and feeds what it learns back
into rules and skills.

## The only thing you need to start

1. Run `better-harness report` to gather static evidence.
2. Run `/better-harness` so the skill turns that evidence into a report.
3. Read the report through the **five work-loop questions** below. Session
   evidence changes confidence and coverage, not the model.

That is enough. Models, detectors, styles, and the extensibility matrix are
optional depth.

## The loop Better Harness scores

A good harness lets an agent finish a bounded, recoverable loop:

```text
understand context -> make a bounded change -> choose the right validation ->
interpret failure -> repair -> re-run validation -> state residual risk
```

## The five lifecycle dimensions (default)

The default Agent Work Loop connects repository engineering facts and any
usable session evidence to the task and its result:

| Dimension | What a newcomer should be able to say |
| --- | --- |
| Task Understanding / 任务理解 | Checks whether Agent understands your goal, the relevant context, and the scope of changes, so the task has a clear direction and boundary. |
| Controlled Execution / 可控执行 | Checks whether Agent can start and operate the project according to its instructions, and complete the task within clear permissions and operating boundaries. |
| Change Validation / 改动验证 | Checks whether Agent runs relevant checks for the current change, and whether it can fix failures and validate again. |
| Reliable Delivery / 可靠交付 | Checks whether the task result has verifiable evidence for acceptance, and whether high-risk actions have approval, rollback, or recovery options. |
| Learning Capture / 经验沉淀 | Checks whether recurring issues are captured as discoverable, reusable, and maintainable rules, workflows, or tools, and whether their effect is validated in later similar tasks. |

See [../models/agent-work-loop.md](../models/agent-work-loop.md). Learning Capture
is scored by the reviewing Agent independently of the first four dimensions.
Its supporting checks constrain evidence and claim consistency rather
than imposing numeric bands or ceilings: only an `Outcome-supported` later
comparison permits a claim that an intervention improved later work or was
effective.

## The five software capabilities (project lens)

| Capability | Question it answers |
| --- | --- |
| Context Map | Can the agent find the right context, boundary, risk area, and next step? |
| Environment Readiness | Can the project set up, run, reset, and diagnose without guesswork? |
| Fast Feedback | Do relevant checks return useful feedback quickly after a change? |
| Quality Gates | Are architecture, security, schema, migration, and drift rules enforced? |
| Change Safety | Are risky actions, acceptance, and recovery controlled? |

Use `software-fluency` for an explicitly requested static repository score and
as the independent project-evidence lens inside `/better-harness`. Do not treat
unobserved task behaviour as missing repository capability. The F0-F4
`harness-engineering` model is advanced evidence detail you can ignore
until you need diagnosis. See [../models/routing.md](../models/routing.md).

## The capabilities (what runs under the hood)

| Capability | CLI | Job |
|---|---|---|
| Quickstart | `better-harness report` | Gather evidence and hand off to the skill |
| Readiness analysis | `/better-harness` skill | Synthesize the evidence-backed report |
| Project evidence | `better-harness core-change-watch` | Project, history, core-path, and diff signals |
| Change confidence | `hooks/git-scripts/blast-radius` | Symbol-graph blast radius of a change |
| Dependency governance | `better-harness dependency-governance` | Update automation, audit, stale-dep signals |
| Session evidence | `better-harness session-analysis` | Normalize Qoder, Codex, Claude, or Cursor session behavior |
| Agent assets | `better-harness coding-agent-practices inventory` | Inventory configured agent surfaces |
| Guardrails | `hooks/`, `scripts/agent-guardrails` | Secret scanning and lifecycle checks |

## Where things live

- `skills/` — repeatable agent workflows (start at `harness`).
- `models/` — maturity models; default first, advanced second.
- `references/` — prose guidance, loaded on demand.
- `templates/` — report skeletons, output modes, and styles.
- `hooks/` — change-time enforcement.
- `scripts/` — capability-owned CLIs behind the commands above.

## From report to action

A report is the start of a loop, not a verdict. Each finding is a row with a
next step, so a score turns into a change:

1. **Draft a bounded fix.** Run `/better-harness repair-plan` (起草修复方案)
   to validate one finding and draft a scoped repair plan, without writing new
   report artifacts.
2. **Give recurring work an owner.** When a finding looks like repeated work,
   route it through [Loop Discovery](../references/loop-engineering/loop-discovery.md)
   to pick the smallest durable owner: a skill, hook, script, automation, or
   rule.
3. **Schedule follow-up.** A schedule-ready finding renders a row-scoped
   `/schedule /better-harness` handoff with cadence, validation, and a stop
   condition.
4. **Confirm movement.** Re-run `better-harness report` to check the change landed
   and the capability signal moved.

## Going deeper

- Extend Better Harness: [community.md](community.md) (start with its two common surfaces).
- Architecture and routing: [ARCHITECTURE.md](ARCHITECTURE.md).
