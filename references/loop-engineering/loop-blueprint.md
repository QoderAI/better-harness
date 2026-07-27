# Loop Blueprint Reference

Use this reference after [Loop Discovery](loop-discovery.md) has evaluated one
concrete Loop candidate or when an existing Loop specification needs a bounded
review. It assembles canonical owner decisions and conditional runtime
contracts into one implementation-neutral blueprint. It does not prove
recurrence, select a different owner, implement a runtime, or authorize work.

## Ownership Boundary

This reference owns:

- the blueprint assembly order and output shape;
- the distinction between discovery decisions and blueprint completeness;
- the boundary between one Loop, a stage, and a composed child Loop; and
- a provider-neutral research synthesis that explains why each blueprint plane
  is required.

Canonical owners remain unchanged:

- [Loop Discovery](loop-discovery.md) owns recurrence proof, runtime fit, and
  the primary owner decision.
- [Loop Spec Card](loop-spec-card.md) owns
  `WHEN -> SEE -> DO -> CHECK -> STOP -> LEAVE` semantics and evidence rules.
- [Operating Patterns](patterns/README.md) owns scenario composition.
- [Loop Primitives](loop-primitives.md) owns supporting primitive selection.
- [Automation Readiness](automation-readiness.md) owns scheduled, event-driven,
  and background readiness.
- [Loop State Ledger](loop-state-ledger.md) owns durable state fields.
- [Learning Loop Patterns](learning-loop-patterns.md) owns longitudinal
  improvement evidence.

## Research Synthesis

This synthesis was reviewed on 2026-07-20. It maps primary-source engineering
guidance to provider-neutral blueprint questions; it does not claim that every
host exposes the same APIs or guarantees. Refresh the relevant source mapping
when a selected host or runtime changes its contract, when implementation
depends on a provider-specific guarantee, or when later evaluation exposes a
missing design plane. Verify the selected runtime's actual capabilities during
implementation.

| Research result | Primary source | Blueprint consequence |
| --- | --- | --- |
| Prefer the simplest controllable shape; use a predefined workflow for stable paths and an agent only when flexible, model-directed decisions are needed. | Anthropic, [Building effective agents](https://www.anthropic.com/engineering/building-effective-agents) | Preserve Loop Discovery's runtime fit and state why a deterministic path is insufficient before adding autonomy. |
| Useful systems can stack an inner agent Loop, a verification Loop, an event-driven Loop, and a later improvement Loop. These layers have different triggers and evidence. | LangChain, [The Art of Loop Engineering](https://www.langchain.com/blog/the-art-of-loop-engineering) | Name the inner procedure, verifier, trigger adapter, and optional improvement Loop separately; do not collapse them into one open-ended agent. |
| Automation, isolated worktrees, reusable Skills, connectors, subagents, and state are portable building blocks, not one universal owner. | Addy Osmani, [Loop Engineering](https://addyosmani.com/blog/loop-engineering/) | Keep one primary procedure owner and list supporting primitives with explicit reasons. |
| Agent evaluation separates task, trial, grader, trace, and environment outcome; probabilistic behavior needs multiple trials, and an agent's success claim is not the outcome. | Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Map acceptance criteria to outcome oracles, evidence artifacts, trials, and negative controls. Prefer environment or artifact checks over self-report. |
| Durable execution retains progress across failures, while retryable side-effecting activities should be small, checkpointed where needed, and idempotent. | Temporal, [What is Temporal?](https://docs.temporal.io/temporal) and [What is a Temporal Activity?](https://docs.temporal.io/activities) | Define state owner, schema/version, checkpoint, resume/replay behavior, idempotency key, retry boundary, and recovery artifact. |
| Sensitive tool actions can pause for approval and resume from serialized state; traces can cover model calls, tools, handoffs, and guardrails, while tool and model data may be sensitive. | OpenAI Agents SDK, [Human-in-the-loop](https://openai.github.io/openai-agents-python/human_in_the_loop/), [Tracing](https://openai.github.io/openai-agents-python/tracing/), and [Running agents](https://openai.github.io/openai-agents-python/running_agents/) | Define the approval packet and expiry/revalidation rule, correlation identifiers, minimum trace events, redaction policy, turn/time limits, and tool-concurrency cap. |
| Concurrent automation needs an explicit grouping key and queue, cancel, or serialization policy. | GitHub Docs, [Control the concurrency of workflows and jobs](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency) | Name the concurrency key, overlap policy, deduplication rule, conflict handling, and backpressure behavior; default to serial execution when unknown. |
| External content can carry indirect prompt injection, and repeated attack attempts can reveal risk hidden by a single trial. | NIST CAISI, [Strengthening AI Agent Hijacking Evaluations](https://www.nist.gov/news-events/news/2025/01/technical-blog-strengthening-ai-agent-hijacking-evaluations) | Mark trust boundaries, keep external data from expanding authority, and include task-specific adversarial negative controls for exposed Loops. |

The dated articles above were published between 2024-12-19 and 2026-01-09.
The OpenAI Agents SDK, Temporal, and GitHub documentation are living sources
accessed on 2026-07-20; re-open them before relying on an exact provider API or
runtime guarantee.

## Assembly Order

### 1. Preserve discovery evidence

Copy these fields from Loop Discovery or the reviewed specification:

- exact discovery decision, without translating it into `ready` or another
  owner vocabulary;
- target outcome and bounded evidence references;
- configured versus observed existing coverage;
- primary owner and implementation handoff file or surface; and
- runtime fit and the evidence that justifies its complexity.

Return to Loop Discovery when recurrence, stable input, verification, stop,
safety, state, observability, or evaluation evidence is too weak. Use
`Blueprint completeness: partial` for a useful but unresolved design and
`not applicable` for a skipped or one-off candidate. A covered Loop can still
be reviewed when the user supplies its current specification or owner surface.

### 2. Shape one canonical card per Loop

Read [Loop Spec Card](loop-spec-card.md) completely. Preserve its canonical
syntax and evidence rules. Each card has exactly one primary owner; supporting
tools, runtimes, connectors, subagents, state stores, and verifiers do not
become co-owners.

For a `partial` review whose preserved Discovery decision is `Skip`, use
`Owner: none — Discovery decision: Skip`. This records that the rejected design
has no selected implementation owner; it must not invent a placeholder owner.

### 3. Select only necessary addenda

- Read [Operating Patterns](patterns/README.md) when the orchestration needs a
  scheduled-inspection, event-response, goal-completion, proactive-discovery,
  system-improvement, or composed pattern.
- Read [Loop Primitives](loop-primitives.md) when the supporting primitive mix
  is unclear.
- Read [Automation Readiness](automation-readiness.md) for every scheduled,
  event-driven, or background proposal.
- Read [Loop State Ledger](loop-state-ledger.md) when work pauses, recurs, spans
  runs or agents, carries approval, or compares results over time.
- Read [Learning Loop Patterns](learning-loop-patterns.md) before a recurring
  outcome is used to justify a system-improvement Loop.

Do not load every addendum by default. Cite the canonical decision instead of
copying its detailed schema into the blueprint.

### 4. Complete the runtime envelope

The core blueprint always names the target and evidence, discovery decision,
primary owner and runtime fit, one canonical card per Loop, durable artifact,
independent verifier, stop boundary, and handoff.

Add only the conditional envelopes required by the selected runtime or risk.
For each included field, cite evidence, link the selected canonical addendum,
or mark the exact missing evidence:

- trigger adapter and recursive-trigger guard;
- tools, filesystem, network, credentials, sandbox, and access boundary;
- durable artifact and independent verifier;
- state and replay addendum from [Loop State Ledger](loop-state-ledger.md),
  including its versioning, checkpoint, pending-side-effect completion,
  resume/replay, approval-expiry, and migration contract;
- idempotency key, deduplication, claim or lease and timeout, concurrency cap,
  ordering or merge rule, partial retry, conflict handling, and backpressure
  policy; default to serial execution when evidence does not justify a safe
  parallel contract;
- side effects, blast radius, versioned approval packet, rejection path,
  durable pause/resume, and approval expiry/revalidation;
- run, step, attempt, tool, approval, checkpoint, and stop correlation plus
  privacy/redaction policy;
- soft pacing and hard ceilings for turns, time, tokens, cost, retries,
  concurrency, and external calls; and
- success, no-action, no-progress, repeated-failure, budget, risk, approval,
  cancellation, recovery, and rollback boundaries.

### 5. Define evaluation and rollout

Use a compact acceptance matrix:

| Acceptance criterion | Outcome oracle or grader | Evidence artifact | Trials / negative control |
| --- | --- | --- | --- |
| ... | ... | ... | ... |

Prefer deterministic environment or artifact checks. Use an independent human
or model grader only when judgment is necessary, and state its calibration
boundary. For probabilistic or agent-driven paths, name the trial count,
held-out or regression cases, sampled trace review, and controlled runtime
conditions such as model, prompt, harness version, time, concurrency, and
network. Do not claim effectiveness from one successful current run.

Start at the least autonomous stage that can collect the missing evidence:

```text
manual rehearsal -> report-only -> human-gated side effects -> bounded autonomy
```

This is a rollout sequence, not a maturity score:

| Stage | Minimum entry evidence | Required exit or demotion evidence |
| --- | --- | --- |
| Manual rehearsal | Bounded input, procedure, verifier, and stop rule | Promote only after representative rehearsals expose stable inputs and repeatable checks. |
| Report-only | Stable trigger plus durable no-write artifact and triage owner | Promote only after precision/noise, adversarial inputs, budgets, and recovery are measured across representative runs. |
| Human-gated side effects | Exact approval packet, current-state revalidation, idempotency, sandbox, independent verifier, and rollback | Demote on approval drift, duplicate writes, verifier regression, unsafe input handling, or unreliable recovery. |
| Bounded autonomy | Stable outcome and safety evaluation across multiple trials, hard resource caps, durable recovery, observability, limited blast radius, and tested rollback | Kill or demote on safety regression, repeated no-progress, budget overrun, control-plane drift, or rollback failure. |

Name the promotion evidence, demotion or kill trigger, rollback path, and
implementation owner for the proposed starting stage. When evidence is
unknown, start at `manual rehearsal` or `report-only`; do not default to
mutation or bounded autonomy.

## One Loop Or A Composition

Keep work inside one card when the supposed child is only a step, tool call,
verification action, or retry in the same lifecycle.

Create a child Loop only when it has an independently meaningful combination
of trigger or stable input, primary owner, artifact or durable state, verifier,
and stop boundary. For a composition:

- give the parent one coordination card and each child its own card;
- treat the top-level Discovery decision as the parent composition's decision,
  and preserve each proven child's Discovery decision on its own card; if a
  child has not passed its own evidence gate, keep it as an unpromoted stage or
  mark its decision `needs more evidence`;
- define handoff data, fan-out/fan-in, ordering, conflict, failure, and parent
  stop semantics;
- keep each child within the authority granted by its own owner; and
- do not infer that a child requires a nested autonomous agent.

## Completeness Gate

Use only these blueprint-completeness values:

- `reviewable`: every required field is evidence-backed or explicitly not
  applicable, and all unresolved risks are visible;
- `partial`: the blueprint is useful for review but required evidence or a
  runtime contract is missing; or
- `not applicable`: Loop Discovery classified the request as a one-off, or
  skipped/found it covered and the user did not request review of the supplied
  proposal or existing owner. An unsafe supplied specification can still be a
  `partial` review while its Discovery decision remains `Skip`.

Blueprint completeness is not Loop Discovery's owner decision, implementation
authorization, deployment readiness, or proof of effectiveness.

## Output Contract

Always return the decision summary and handoff below. Include `Contract card`
for a `reviewable` candidate and for a `partial` candidate only when enough
evidence exists to shape an explicitly incomplete card. Include only selected
items under `Conditional envelopes`; omit unused envelopes instead of printing
the checklist as a template. Include `Evaluation and rollout` only for an
agent/evaluator Loop, a longitudinal improvement claim, or a staged-autonomy
proposal. Omit all three sections for `not applicable`. For a covered decision,
include them only when the user supplied the current owner surface for review.

```markdown
### Loop blueprint

- Blueprint completeness: reviewable | partial | not applicable
- Discovery decision: <preserve the canonical decision>
- Target outcome: ...
- Evidence boundary: ...
- Existing coverage: ...
- Primary owner and handoff surface: ...
- Runtime fit and complexity reason: ...

#### Contract card

When: ...
See: ...
Do: ...
Check: ...
Stop: ...
Leave: ...
Owner: ...

#### Conditional envelopes

- <Only a selected pattern/composition, automation, state/replay,
  concurrency/retry, access/approval, observability/privacy, or
  budget/recovery envelope>: ...

#### Evaluation and rollout

- Acceptance matrix: ...
- Trials and negative controls: ...
- Starting stage: manual rehearsal | report-only | human-gated side effects | bounded autonomy
- Promotion evidence, demotion/kill trigger, and rollback path: ...

#### Handoff

- Missing evidence: none | ...
- Implementation authority: not granted | separately granted outside this blueprint
- Next owner or action: none | ...
```

For a composition, repeat `Contract card` under named child headings and add a
parent coordination card. Add `Child discovery decision` before each child
card. For `partial`, omit the card when only a raw demand
source or static configured presence exists. Otherwise keep only applicable
fields and mark required gaps as `missing evidence: ...` instead of filling
them with assumptions or a long row of `not applicable` values.

## Guardrails

- Do not execute checks, mutate targets, schedule jobs, create external
  objects, or persist state while assembling a blueprint.
- Do not replace primary-source evidence with provider marketing claims or
  assume that a named host supports a feature without current verification.
- Do not treat a configured asset, one successful run, or the executor's final
  message as outcome proof.
- Do not preserve secrets or unnecessary raw content in state, traces, approval
  packets, or research notes.
- Do not let untrusted external content change the Loop objective, tools,
  permissions, approval rule, or stop condition.
