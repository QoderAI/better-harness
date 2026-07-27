# Loop Engineering

## Purpose

Use this domain for repeated-work and schedule-ready owner selection.

## Best-Practice Baseline

Current agent-engineering practice points to the same operating rule: prefer the
smallest controllable workflow that can solve the repeated work, and promote an
autonomous or scheduled loop only when its runtime contract is explicit.

A loop candidate is not ready just because an agent can keep calling tools. It
needs a stable trigger, durable or replayable state when work can pause or
resume, observable traces or logs, evaluation evidence, guardrails for risky
inputs/outputs/tools, a human approval point for sensitive side effects, and a
stop condition. When the control flow is known, use a workflow, hook, rule,
script, command, or Skill-backed playbook before recommending a more autonomous
agent loop.

## Load When

- Repeated prompts, workflow friction, validation habits, or session evidence
  suggest a durable loop.
- Local entropy signals suggest a recurring engineering task, but the owner is
  still unclear.
- A report needs to decide whether work belongs in a Skill, automation, hook,
  command, script, custom agent, MCP-backed loop, or rule.
- An agent loop, evaluator-optimizer loop, background schedule, or approval
  workflow is being considered and needs a trigger/state/eval/safety check.

## Owns

- `demand-source-analysis.md`: raw demand-source normalization before Loop
  Discovery chooses an owner.
- `loop-discovery.md`: durable loop owner selection.
- `patterns/README.md`: five composable operating patterns for scheduled
  inspection, event response, goal completion, proactive discovery, and system
  improvement after a loop and owner are proven.
- `loop-spec-card.md`: compact `WHEN -> SEE -> DO -> CHECK -> STOP -> LEAVE`
  card shape for proven candidates and examples.
- `loop-primitives.md`: primitive map for automation, worktree, Skill,
  plugin/connector, subagent, and state support.
- `automation-readiness.md`: schedule or automation readiness contract after
  Loop Discovery selects automation or `schedule-ready`.
- `loop-state-ledger.md`: state ledger contract for paused, recurring,
  background, or multi-run loops.
- `learning-loop-patterns.md`: longitudinal learning pattern signatures,
  recurrence thresholds, negative controls, claim types, and coverage reason
  codes before Loop Discovery selects a durable owner.

## Does Not Own

- Agent instruction or host asset taxonomy; use
  `../agent-customize/routing.md`.
- Skill or Skill-reference shaping after owner selection; use
  `../agent-customize/skill-discovery.md`.
- Acceptance evidence, change-review triggers, sensitive code, or Git lifecycle
  safeguards; use `../project-harness/`.
- Runtime persistence, tracing backends, external approvals, or background job
  execution. This domain selects the owner and required contract; it does not
  implement the runtime.

## Read Next

- Use `demand-source-analysis.md` first when the input is a raw demand source,
  session signal, report row, local entropy hint, or repeated-work suspicion.
- Start with `loop-discovery.md` while the durable owner is undecided.
- Use `patterns/README.md` after Loop Discovery proves the candidate and the
  result needs an operating composition or scenario-level example.
- Use `learning-loop-patterns.md` from longitudinal Learning Capture review when a bounded
  window needs pattern candidates or explicit no-finding coverage reasons.
- Use `loop-spec-card.md` after a proven loop candidate needs a compact spec,
  example, or report card shape.
- Use `loop-primitives.md` when a proven loop needs supporting primitives.
- Use `automation-readiness.md` after the decision is automation,
  `schedule-ready`, or scheduled/background follow-up.
- Use `loop-state-ledger.md` when a loop needs resumable, recurring, or
  cross-agent state.
- Continue to `../agent-customize/skill-discovery.md` only after Loop Discovery selects
  `Create Skill` or `Extend Skill`.
