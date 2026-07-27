# Loop Discovery Reference

Loop Discovery decides whether repeated or schedulable engineering work exists
and which durable surface should own it. It is a routing gate, not the owner of
session mining, Skill design, hook design, automation wiring, or report
templates.

Use it when `../agent-customize/routing.md`, session evidence, repo
entropy, review feedback, CI results, user prompts, or reports suggest
recurring work. Do not use it for one-off diagnosis or when the owner is
already obvious.

## Chain Position

- Start from `../agent-customize/routing.md` when the action form is
  still unclear.
- Use `demand-source-analysis.md` first when the input is a raw demand source,
  session signal, report row, local entropy hint, or repeated-work suspicion
  that still needs an evidence pack.
- Use `../session-evidence/sessions-diagnostics.md` to gather or inspect
  Qoder, Codex, Claude, or Cursor session evidence.
- Return here only to decide whether the evidence proves a loop and who owns it.
- Use `../agent-customize/skill-discovery.md` only after the decision is `Create Skill` or
  `Extend Skill`.
- Use `patterns/README.md` after a loop and owner are proven when the result
  needs a composable scheduled-inspection, event-response, goal-completion,
  proactive-discovery, or system-improvement operating pattern.
- Use `loop-primitives.md` after a loop is proven but the supporting primitive
  mix is still unclear.
- Use `loop-spec-card.md` after a loop is proven and the result needs a compact
  `WHEN -> SEE -> DO -> CHECK -> STOP -> LEAVE` spec or example.
- Use `automation-readiness.md` after the decision is automation,
  `schedule-ready`, or a scheduled/background follow-up.
- Use `loop-state-ledger.md` when the loop spans turns, runs, worktrees,
  approvals, external systems, or repeated evaluations.
- Use `../agent-customize/agent-hooks.md`, commands, scripts, custom
  agents, MCP, rules, or automation only when this file selects that owner.

## Evidence Contract

Bring bounded evidence, not broad transcript dumps:

- repeated user intent, prompt cluster, report pattern, CI failure, review
  feedback, or scheduled/event trigger
- configured and observed coverage: Skills, hooks, commands, rules, scripts,
  agents, MCP, automation, CI, specs, or plugins
- stable input context: diffs, logs, sessions, reports, manifests, docs,
  screenshots, validation output, or detector output
- local entropy signal when relevant: stale docs, dependency drift, long or hot
  files, complexity pressure, missing validation, guardrail drift, secrets, or
  sensitive boundaries

Configured assets prove presence only. Opened session events, command output,
reports, CI, scans, or external records prove observed behavior.

Example families include Code Health, Security, Documentation, Test,
Architecture, Review, and Modernization loops. These are examples, not owners;
classify by trigger, input, procedure, verification, stop condition, and risk
boundary.

## Runtime-Fit Check

Before choosing an owner, decide what kind of loop is actually needed:

- **Workflow loop**: the steps are mostly known. Prefer a command, script, hook,
  rule, Skill-backed playbook, or scheduled `/better-harness` follow-up over an
  autonomous agent.
- **Agent loop**: the work needs flexible planning, tool use, handoffs, or
  recovery from changing evidence. Require turn limits, tool boundaries,
  observable traces, and a clear final-output condition.
- **Evaluator-optimizer loop**: iterative improvement is useful only when there
  are explicit evaluation criteria and another pass can measurably improve the
  output.
- **Scheduled or background loop**: a cadence or event trigger exists, inputs
  are non-interactive, side effects are reversible or gated, and the loop can
  report completion or `needs more evidence`. Continue to
  `automation-readiness.md`.
- **Human-gated loop**: sensitive edits, shell commands, external writes,
  secrets, policy decisions, or broad repository changes require approval before
  the side effect happens.
- **Skill-shaped loop**: the durable asset is procedural knowledge for an agent
  to load. Use `../agent-customize/skill-discovery.md`; do not treat the Skill itself as runtime
  state, approval, tracing, or scheduling infrastructure.

The operating patterns in `patterns/README.md` are orthogonal to these runtime
fits and to the owner route. For example, goal completion can be a workflow or
agent loop, proactive discovery can start from a schedule or event, and system
improvement is usually an evaluator-optimizer loop around an inner loop. Do not
replace runtime-fit or owner selection with a pattern name.

Do not promote an autonomous agent when a deterministic workflow, static rule,
or human review checklist gives tighter control.

## Decision Gate

Recommend a durable loop only when most answers are concrete:

1. **Repeated intent**: at least two similar asks, or one costly/high-risk task
   likely to recur.
2. **Existing coverage**: visible proof that current Skills, hooks, scripts,
   rules, commands, agents, MCP, automation, CI, or docs do not already cover
   the work.
3. **Stable input**: the loop can start from repeatable evidence or events.
4. **Repeatable procedure**: steps are reusable, not a fresh investigation each
   time.
5. **Verification**: success has a check, report, patch, review result,
   command, or explicit `needs more evidence` boundary.
6. **Stop condition**: the loop can end on a state, score, count, result, or
   human decision.
7. **Safety boundary**: permissions, secrets, external actions, and broad
   changes have a human gate where needed.
8. **State contract**: paused or multi-run work has a replayable input,
   checkpoint, session, artifact, or history pointer; purely stateless loops
   say why state is unnecessary.
9. **Observability contract**: logs, traces, spans, reports, run directories,
   or review artifacts show what happened, which tools ran, what changed, and
   why the loop stopped.
10. **Evaluation contract**: automated checks, LLM/human review, regression
   fixtures, or comparison criteria are named before iterative refinement is
   recommended.

If these are missing, return `Needs more evidence`; do not promote a loop from
file age, line count, churn, cache paths, titles, or counts alone.

## Schedule-Ready Outcome

Use `schedule-ready` only when Loop Discovery has a stable target, cadence or
event trigger, repeatable `/better-harness` input, validation command, safety
boundary, and stop condition. Final harness reports should render this as a
row-scoped `Schedule follow-up` handoff using `/schedule /better-harness`, not
a standalone global call to action.

A generic recommendation to run `/schedule /better-harness` to improve overall
engineering quality is not schedule-ready. The handoff must name the concrete
loop/finding, selected owner, target path or artifact, cadence or trigger,
evidence, validation, risk/safety boundary, acceptance check, and stop
condition.

If recurring schedules are unsupported or unclear, ask `/schedule` for the next
one-time follow-up and state that recurring setup needs user confirmation. Do
not use `schedule-ready` for `Needs more evidence`, sensitive human-judgment
loops, one-off diagnosis, or candidates without validation and stop conditions.

## Owner Route

- **Covered**: existing surface already owns the loop; cite it.
- **Skill**: reusable how-to workflow with judgment, steps, outputs, failure
  modes, and validation. Hand off to
  `../agent-customize/skill-discovery.md`.
- **Automation**: stable trigger, non-interactive inputs, verification, stop
  condition, reversible or gated action.
- **Hook / Rule**: deterministic lifecycle check, warning, block, logging, or
  policy enforcement.
- **Script**: deterministic extraction, validation, transformation, or
  formatting that supports another owner.
- **Command / Prompt**: short fixed manual entrypoint; not broad workflow
  ownership.
- **Custom Agent**: repeatable specialist role needs isolated context,
  independent judgment, or parallel review.
- **MCP-backed Loop**: external data or actions are required; MCP is access, not
  the whole workflow.
- **Skip**: one-off, too broad, too sensitive, speculative, or already handled.
- **Needs more evidence**: name the missing proof.

Prefer the smallest durable owner. Do not default to Skill or automation.

## Output

Keep the answer short:

- candidate loop and evidence refs
- decision: covered, create/extend Skill, automation, hook/rule, script,
  command, custom agent, MCP-backed loop, skip, or needs more evidence
- proposed owner and handoff file
- runtime fit: workflow, agent, evaluator-optimizer, scheduled/background,
  human-gated, Skill-shaped, or not a loop
- state, observability, evaluation, side-effect, stop-condition, and human-gate
  contract
- primitive addendum from `loop-primitives.md` when supporting primitives are
  needed
- selected operating pattern or composition from `patterns/README.md` when the
  result needs scenario-level orchestration
- compact loop card from `loop-spec-card.md` when the output needs a reusable
  example or report-ready spec
- missing evidence, verification, stop condition, and human gate
- for schedule-ready outcomes, the exact `Schedule follow-up` prompt slots:
  target, finding, evidence, cadence/trigger, validation, risk/safety,
  acceptance check, and stop condition

Do not create or wire automation from a Loop Spec until the playbook,
verification path, permissions, stop conditions, and human gate are clear.

## Quality Bar

- Cite concrete files, commands, sessions, reports, dates, scan output, CI, or
  external records opened during the task.
- Separate local entropy from confirmed defects or required automation.
- Separate configured coverage from observed execution.
- Treat observed Skill use as coverage unless repeated setup, repair,
  validation, or schedule handoff is still manual.
- Keep recommendations scoped to the selected owner and handoff file.
- Prefer explicit workflow orchestration over open-ended autonomy when the
  route is predictable.
- Treat traceability, evaluation, and approval as part of the loop contract, not
  optional production polish.
