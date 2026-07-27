# Knowledge-Asset Review

Use this reference when a user asks why an agent did not follow available
knowledge, whether repeated corrections became a reusable capability, or
whether Rules, Skills, Memory, Hooks, Commands, MCP, Custom Agents, and
Workflows are helping real work. It owns the cross-asset, task-first review
protocol. It does not replace asset-specific quality checks or authorize
changes to user memory.

Start with [Global Coding-Agent Assets](global-assets.md) for a read-only
Exists inventory; use [Memory Review And Learning-Loop Evidence](memory-review.md)
for memory privacy and recall; use [Learning Loop Detection Patterns](../loop-engineering/learning-loop-patterns.md)
for signatures and negative controls; use [Loop Discovery](../loop-engineering/loop-discovery.md)
to select a durable owner; and return to
[Agent Work Loop Task Episode construction](../../models/agent-work-loop.md#construct-task-episode-evidence)
for the five reader dimensions.

## Evidence states

Keep these states separate. Do not skip a state because an asset is configured
or a file was read.

| State | Minimum proof | Does not prove |
| --- | --- | --- |
| **Exists** | The scoped asset was configured or inspected. | That it matched, was selected, or was followed. |
| **Routed** | Host-observed or explicitly reviewed selection for a matching Task Episode. | That a required action occurred. |
| **Applied** | Episode-linked evidence shows the selected asset's required action happened. | That later work improved. |
| **Used** | Both Routed and Applied are supported for the same task. | Cross-task benefit. |
| **Effective** | The intervention ledger has a comparable later result that improves its declared metric without a guardrail regression. | A one-window result, a completion message, or a static asset. |

An apparent file read is partial evidence only. A loaded Memory, Skill, Rule,
or prompt is Routed evidence at most; it is not Applied until the required
action is observed or reviewed. Missing route/application instrumentation is a
coverage reason, not evidence that the asset was ignored.

## Task-first review

Do not start from a document tree and infer a problem. Start from a bounded
user cost or repeated behavior, then use inventory as corroboration:

```text
repeated task, correction, rediscovery, or successful procedure
-> name the applicable knowledge asset(s) and task family
-> prove selection or explicit non-selection
-> prove the required step, or record missing instrumentation
-> compare the asset with current truth and update evidence
-> compare a later similar task before claiming Effective
```

For every reviewed candidate, keep reader-safe evidence only:

```text
redacted asset kind/ref/scope + task family
-> Exists / Routed / Applied state
-> current-truth and required-step evidence where relevant
-> update evidence + later outcome evidence where relevant
-> owner, metric, guardrail, and stop/revert condition
```

Never put raw prompt text, private memory bodies, absolute paths, session IDs,
or credentials into the report artifact. Ask for an explicit bounded scope
before comparing sensitive generated state with current repository truth.

## Relevant content search

Search from the task into knowledge, not from a directory tree into a score.
Build a small query set from the task family, target component, correction or
rediscovery, expected artifact, command names, and validation vocabulary. Use
configured asset paths and project navigation as bounded leads, then open only
the candidates that plausibly answer the task. Search hits, filenames,
frontmatter, descriptions, and inventory counts establish discovery candidates;
they never establish content quality by themselves.

For every opened candidate, judge the content itself:

- **Task relevance:** it addresses the framed task or repeated cost precisely,
  not merely the same broad technology.
- **Current truth:** referenced paths, commands, constraints, and decisions
  agree with current code, specs, and active instructions.
- **Discoverability:** a matching task can find it through a trigger,
  when-to-load rule, scoped link, or reviewed selection path.
- **Executability:** required steps, expected output, validation, and failure or
  escalation behavior are concrete enough for an agent to follow.
- **Maintainability:** owner/update scope is clear and the content does not
  conflict with another active asset or hide a mandatory invariant in optional
  guidance.

An asset can **Exist** while its content is irrelevant, stale, misleading,
non-executable, or unmaintained. Preserve that distinction in the reviewed
summary and evidence refs. Do not infer an unreasonable asset from length or
age alone; open the relevant section and compare its claims with current truth.

## The five checks

### Coverage

Review only domains applicable to the selected tasks, not a generic checklist.
At minimum consider architecture/context, testing/verification,
debugging/diagnosis, deployment/release, and security/permissions when those
domains occur in the evidence window. Inventory Rules, Skills, Memories,
Hooks, Commands, MCP, Custom Agents, and Workflows only to establish what
could have served the task.

An absent event does not establish a missing capability. Return a scoped
`not-evaluable` reason when the task domain, asset inventory, or host event
surface is unavailable.

### Routing

For a matching task, identify the asset selected—or explicitly show that a
known relevant asset was not selected. A global Skill count, an installed
plugin, a Memory file, or an apparent read cannot prove routing. A manual
review may establish routing only when it links the asset, task, and selection
evidence.

### Freshness

Compare a scoped asset claim against current instructions, verified code,
commands, specs, or a newer governed record. File age alone is never stale
evidence. When sources disagree, keep the current authoritative source,
record the conflict, and route consolidation through its owner.

### Usage

For a Routed asset, name the required step and inspect the same Task Episode
for application. A Skill may require a command and a validation; a Rule may
require a boundary decision; a Hook/Gate may require an enforced outcome; a
Workflow may require the declared handoff; an MCP may require a bounded tool
call plus its consuming decision. If the host does not expose a universal
required-step signal, preserve `not-evaluable-missing-application-events`.

### Learning Capture review

Ask whether recurring experience became a discoverable, executable,
verifiable, and maintainable capability:

```text
capture -> generalize -> codify -> route -> exercise -> evaluate -> maintain
```

After two comparable episodes or a reviewed severe readiness issue, choose the
smallest durable owner. Rule and Memory fit compact constraints/lessons; Skill
fits a repeatable procedure; Command is a thin entrypoint; Agent isolates a
specialist role; Workflow coordinates repeatable handoffs; Hook/Gate owns
deterministic enforcement; MCP owns external access; Eval owns comparison.
Use [Loop Discovery](../loop-engineering/loop-discovery.md) instead of defaulting
to a Skill. A mandatory invariant written only in optional guidance is a
wrong-owner candidate and normally belongs in a Hook or Gate.

## Candidate patterns

These are review triggers, not automatic findings. Apply the named positive
evidence and negative control before projecting an Opportunity or Readiness
candidate.

| Pattern | Positive evidence | Negative control |
| --- | --- | --- |
| Repeated rediscovery | Two comparable episodes revisit the same reviewed discovery route. | Repeated file reads or unrelated edits. |
| Recurring correction not promoted | Two semantically equivalent user/reviewer corrections and no reviewed discoverable update. | One correction or an update in a different scope. |
| Present but not routed | A known relevant asset exists and episode evidence explicitly shows it was not selected. | Inventory with no selection telemetry. |
| Routed but not applied | The asset was selected, its required step is named, and that step was not followed. | Load/read evidence with no adherence instrumentation. |
| Stale or conflicting asset | A named asset conflicts with current truth or a newer governed record. | File mtime, broad topic overlap, or an unverified memory lead. |
| Cross-asset duplication or contradiction | Two named assets compete for the same task route or prescribe incompatible action. | Similar wording without a matching task. |
| Asset updated but not re-exercised | A scoped update exists but no comparable later task tests it. | A release/commit alone. |
| Successful procedure not reused | A prior success and a later comparable rediscovery are both episode-linked. | A single successful run. |
| Wrong durable owner | A reviewed mandatory invariant depends only on optional retrieval. | Optional convenience guidance. |

Use the pattern-specific thresholds and coverage codes in
[Learning Loop Detection Patterns](../loop-engineering/learning-loop-patterns.md).
`Effective` remains owned by the intervention ledger; no candidate pattern can
claim it in one window.

## Review handoff

Keep supported causal chains in longitudinal diagnostics and route them to the
smallest canonical owner. They support lifecycle/repeat detection only when the
review establishes a supported repeated opportunity or retains an explicit
result from an adequate no-candidate window. Positive Loop Engineering evidence
additionally requires a discoverable reusable owner and exercised operating
pattern; the later-validation check retains the comparison boundary. Keep each finding small: one asset/owner,
one user cost, one expected outcome, one validation, and one stop or revert
boundary.

For report-envelope and intervention rules, use the
[Learning Capture Review Procedure](../../models/agent-work-loop.md#review-procedure).
Do not write, consolidate, delete, or automatically promote a Memory, Rule,
Skill, Hook, Command, Agent, Workflow, MCP, or Eval from this review without
the authorization required by its owner.
