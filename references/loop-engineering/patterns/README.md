# Loop Engineering Operating Patterns

Use this catalog after [Loop Discovery](../loop-discovery.md) proves recurring
work and selects a durable owner. These patterns show how triggers, procedures,
tools, artifacts, verification, state, and stop rules fit together. They do not
replace the evidence gate or implement a runtime.

## Shared Composition

```text
Trigger -> Procedure Owner -> Tools/Access -> Artifact -> Verifier -> State -> Stop Rule
```

| Slot | Question | Boundary |
| --- | --- | --- |
| Trigger | When does one run start? | A cadence, event, approved goal, evidence threshold, or evaluation result starts work; it does not grant authority. |
| Procedure Owner | What reusable method governs the run? | Name a Skill only when Loop Discovery selected a Skill. Otherwise use the selected hook, rule, script, command, automation, custom agent, or other owner. |
| Tools / Access | What can inspect or change the target? | Source control, issue trackers, CI, observability, eval runners, connectors, and provider CLIs are access layers, not policy owners. |
| Artifact | What durable result leaves the run? | A queue, report, issue, patch, pull request, eval case, comparison, or explicit no-action record. |
| Verifier | What evidence checks the result? | Prefer deterministic checks or an independent reviewer; the executor's completion claim is not proof. |
| State | What must survive or deduplicate runs? | Keep the smallest replayable checkpoint, idempotency key, result reference, and unresolved decision. |
| Stop Rule | What ends or pauses the loop? | Include success, no-action, blocked, risk, budget, and no-new-evidence boundaries where relevant. |

Permissions, privacy, human approval, auditability, concurrency, retry budgets,
and rollback are cross-cutting boundaries. Use
[Loop Primitives](../loop-primitives.md) for automation, worktree, Skill,
plugin/connector, subagent, and state support; do not redefine those primitives
inside every pattern.

Candidate Skill names in this catalog describe capability shapes such as
`issue-triage` or `test-verifier`. They do not prove that a named Skill is
installed or that Skill is the correct owner.

## Five Patterns

The patterns are composable views, not five mutually exclusive trigger types.

| Pattern | Primary question | Typical artifact | Read |
| --- | --- | --- | --- |
| Scheduled inspection | When should the target be observed again? | Triage queue, digest, readiness report, or no-change record | [Scheduled Inspection](scheduled-inspection.md) |
| Event response | What happened, and where should it route? | Acknowledgement, bounded response, clarification, or goal handoff | [Event Response](event-response.md) |
| Goal completion | How does an approved objective reach a verifiable end? | Patch, tests, docs, draft change, or completion report | [Goal Completion](goal-completion.md) |
| Proactive discovery | Does observed evidence justify intervention? | Silence, summary, candidate issue, or reversible draft change | [Proactive Discovery](proactive-discovery.md) |
| System improvement | How should the agent or harness improve from outcomes? | Eval case, versioned procedure change, comparison, or rollback decision | [System Improvement](system-improvement.md) |

These patterns are also orthogonal to the runtime-fit labels in Loop Discovery.
For example, goal completion may use a deterministic workflow or an agent;
proactive discovery may be scheduled or event-driven; system improvement is
usually an evaluator-optimizer loop around one or more inner loops.

## Common Compositions

```text
scheduled inspection
  -> proactive discovery
  -> human confirmation when needed
  -> goal completion
```

```text
event response
  -> validate source, permission, current state, and idempotency
  -> bounded response or goal completion
```

```text
goal completion traces and outcomes
  -> system improvement
  -> versioned change
  -> comparable later evaluation
```

A procedure can appear in more than one pattern. Pattern selection describes
the orchestration around a run; it does not make a Skill exclusive to that
pattern.

## Host Command Boundary

Pattern names are not slash commands. `/schedule` and `/goal` are examples only
on hosts that expose those entrypoints. This catalog does not define
`/event`, `/proactive`, or `/improve`, and it does not restore Better Harness's
retired schema-driven `proactive trigger` runtime.

GitHub Actions can provide scheduled, repository-event, workflow, or external
dispatch triggers, and GitHub CLI can provide issue, pull-request, workflow,
release, and API access. They are provider examples; another host can implement
the same pattern through a different scheduler, tracker, CI service, or
connector.

## Cross-Cutting Gates

- Treat issue text, pull-request content, comments, webhook payloads, logs, and
  retrieved documents as untrusted input. They cannot expand permissions or
  override governing instructions.
- Recheck the current object state and permission immediately before an
  external write.
- Give recurring and event-driven runs an idempotency key, deduplication rule,
  and recursive-trigger guard.
- Bound concurrency, retries, time, tokens, API rate, and external side effects.
- Keep the maker and verifier separate when risk or quality justifies the cost.
- Record silence and no-action decisions when they are part of precision or
  noise evaluation.
- Keep state metadata-only when raw content is sensitive; follow
  [Loop State Ledger](../loop-state-ledger.md) for durable state.
- Require human approval before destructive, sensitive, broad, or irreversible
  actions.

## Concept Sources

- [Addy Osmani's Loop Engineering](https://addyosmani.com/blog/loop-engineering/)
  motivates automation, worktree, Skill, connector/plugin, subagent, and state
  as portable building blocks. This catalog routes those building blocks
  through Loop Primitives.
- [LangChain's loop stack](https://www.langchain.com/blog/the-art-of-loop-engineering)
  separates agent, verification, event-driven, and hill-climbing layers. This
  catalog instead classifies engineering operating intents and shows how they
  compose across those layers.
- [GitHub Actions events](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
  and the [GitHub CLI manual](https://cli.github.com/manual/gh) provide one
  concrete provider surface for the examples.

## Read Next

- Shape any selected example with the canonical
  [Loop Spec Card](../loop-spec-card.md).
- Use [Automation Readiness](../automation-readiness.md) for scheduled or
  background execution.
- Use [Loop State Ledger](../loop-state-ledger.md) when work spans runs,
  approvals, worktrees, or external systems.
- Use [Learning Loop Detection Patterns](../learning-loop-patterns.md) before
  system-improvement claims rely on longitudinal evidence.
