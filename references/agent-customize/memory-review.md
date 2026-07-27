# Memory Review And Learning-Loop Evidence

Use this reference when a user asks whether an agent remembered a prior
decision, preference, correction, or recurring trap; when an Agent Work Loop
review needs Learning Capture evidence; or when a team needs to inspect Codex or
Qoder memory safely. It is a read-only evidence protocol, not a user-profile
workflow. Use [Global Coding-Agent Assets](global-assets.md) for configured
asset inventory, [Agent Work Loop Task Episode construction](../../models/agent-work-loop.md#construct-task-episode-evidence)
for the five-dimension report, and [Loop Discovery](../loop-engineering/loop-discovery.md)
to choose a durable owner after a real repeated pattern is established.
For cross-asset Coverage, Routing, Freshness, Usage, and Evolution review, use
[Knowledge-Asset Review](knowledge-assets-review.md). For one-window
Opportunity/Readiness classification and coverage reason codes,
use [Learning Loop Detection Patterns](../loop-engineering/learning-loop-patterns.md).

## Authority And Privacy Boundary

Apply this precedence without exception:

1. Current explicit user, system, developer, and scoped repository
   instructions.
2. Current verified repository state, current task artifacts, and bounded
   task/session evidence.
3. Project-scoped durable knowledge, specs, and Memory candidates with visible
   provenance.
4. User/global generated memory only when the task needs it and the scope is
   safe.
5. Raw transcripts, audits, caches, and database rows only with an explicit,
   bounded need.

Memory is a recall lead, not the source of mandatory rules or current facts.
When it conflicts with a current instruction, spec, or verified artifact, keep
the current source, record `stale-or-conflicting`, and do not silently merge
the two.

Never read raw memory text, session transcripts, prompt/tool arguments,
databases, auth material, or cache rows by default. Do not put raw prompts,
commands, absolute paths, stable session identifiers, personal attributes, or
verbatim memory text into report copy. Do not create, edit, delete, or
consolidate user memory without explicit user authorization.

Treat `user_info` and `user_hobby` categories as out of scope for engineering
loop evidence. Read `user_communication` or `user_behavior` only when the
current task explicitly needs an interaction preference or a repeated user
correction; extract the smallest operational constraint, not a personality
profile.

## What Each Source Can Prove

| Source | Safe first use | It can support | It cannot prove alone |
| --- | --- | --- | --- |
| Checked-in `MEMORY.md`, spec, decision, or runbook | Read as project knowledge. | A documented rule, owner, or prior decision exists. | The current agent loaded, followed, or benefited from it. |
| Codex `~/.codex/memories/` | Inspect metadata and selected summaries only when needed. These are generated local state. | A prior task was captured as a recall candidate. | Current truth, memory injection, adoption, or effectiveness. |
| Qoder `~/.qoder/memories/` | Inspect the primary project/global tree at metadata level. | A host memory category or candidate exists in the selected scope. | Retrieval, use in a Task Episode, or a user preference outside that scope. |
| Host cache or shared-memory mirror | Use only to find a missing primary record or detect duplication. | A mirrored copy may exist. | A second independent memory, a second episode, or stronger evidence. |
| Bounded session analysis and current artifacts | Inspect only the few episodes needed to test a claim. | Relevance, adoption, correction, validation, or outcome evidence. | A durable memory was written or will be recalled later. |

Codex memory generation is asynchronous and may skip ineligible sessions or
tasks that used external context. Missing files therefore mean `unobserved` or
`not-evaluable`, not that a user preference or learning mechanism is missing.
Qoder and Codex layouts are host state, not a cross-version schema; discover
them conservatively and do not infer fields from filenames alone.

## Inspection Protocol

### 1. Frame the narrow question

Classify the request before opening a memory source:

- **Current constraint:** start with the current task, `AGENTS.md`, spec, and
  verified repository state. Do not read memory unless a missing prior decision
  blocks progress.
- **Prior project decision or trap:** start with project-scoped knowledge and
  the current status/spec, then select the smallest relevant memory candidate.
- **User interaction preference or repeated correction:** require that the
  current request needs the preference; prefer an explicit current statement
  over an inferred one.
- **Did recall work?** require an invocation, prompt-boundary, audit, or
  episode-linked application signal. Configuration and file presence are not
  recall evidence.
- **Did the loop improve?** require comparable later episodes and an outcome;
  a captured note or a final “done” message is not enough.

State the provider, workspace, time window, and read-only scope. If a request
would cross projects, include personal categories, or open raw transcripts,
ask for a narrower scope first.

### 2. Establish inventory and session boundaries

Run the source probe before claiming task behavior. Its paths and stable IDs
are operator-private and must not be copied into a report:

```text
<node> scripts/session-analysis.mjs sources --platform <qoder|codex> --workspace <target> --format markdown
```

Treat selected-session Memory tools as first-class evidence beside Skill
invocations. Normalize host-equivalent `search_memory` calls to `retrieve` and
`create_memory` / `update_memory` calls to `write`; retain counts only. A tool
call proves observed Memory activity, not result relevance, later adoption, or
effectiveness. Do not emit its query, result title, content, or raw arguments.

For metadata-only memory inventory, use the existing cross-platform command:

```text
<node> scripts/coding-agent-practices/inventory.mjs <qoder|codex> \
  --workspace <target> --include-user-home --include-memories --format json
```

The inventory returns roots, category counts, supported memory configuration,
and storage presence without reading memory bodies. It reports configuration as
`configured`, never as retrieved or applied. For Qoder, inspect the primary
memory tree before any shared-cache mirror and deduplicate by stable host ID or
content hash when one is available.

For a title-overlap or ordinary Harness report, run the deterministic metadata
pass instead of opening note bodies:

```text
<cli> coding-agent-practices asset-integrity <qoder|codex> --workspace <target> --language <en|zh-CN> --json --include-memories [--include-user-home]
```

The pass privately indexes every discovered `.md` filename stem, normalizes
Unicode, case, whitespace, and separators, then separates exact-title
collisions from bounded high-similarity candidates. It serializes only bounded
candidate copy and counts, not the complete title index, Memory body text, or
private absolute paths. Similarity is a review lead only; never delete, merge,
or rewrite Memory from a title score alone.

When current project evidence confirms that a candidate exposes incorrect,
conflicting, duplicated, or missing knowledge, keep Memory governance separate
from Wiki or Knowledge Card maintenance. For a separately authorized Qoder
repair, route by the real owner and use only capabilities declared by the system
prompt; do not scan Skill or command directories:

- For Qoder Memory, use `SearchMemory` to obtain exact Memory IDs and current
  content. Choose one canonical record, merge valid content with `update_memory`
  update, and delete a redundant exact ID only after the canonical update
  succeeds and the authorized repair includes removal. Never edit Memory files,
  caches, or databases directly.
- For project Wiki or Knowledge Cards, return a new-turn `/knowledge` handoff
  containing the target, evidence, intended CRUD operation, and validation. Use
  only the tools injected for that request; read before write and re-read after.

When exact collisions coexist with a large near-title queue, keep one Low
governance finding and process at most five candidate groups per authorized
repair. Resolve current content through the host route, update only confirmed
owners, report the remaining count, and start another bounded `/knowledge` or
`SearchMemory` -> `update_memory` pass only when requested. Near-title volume
alone never authorizes a finding, merge, rewrite, or deletion.

Do not update both routes merely because the same fact is visible in both.
Require current evidence that both assets own the fact, and never substitute
`/knowledge` for Memory governance or `update_memory` for project documentation.

Carry one explicit metadata state into the Learning Capture review:

- `scanned-present`: metadata was inspected and bounded candidates exist;
- `scanned-empty`: metadata was inspected but no bounded candidate exists;
- `not-scanned`: inventory did not run or the provider path was unavailable.

Do not collapse these states into an empty `memories[]` list. `not-scanned` and
`scanned-empty` remain evidence-boundary states, not findings. Recommend a
project-scoped Memory or equivalent governed knowledge route only after two
comparable Episodes establish repeated knowledge demand and inspected coverage
shows no current retrievable owner. Validate one later retrieval and application;
do not claim the feature is disabled unless configuration proves it.

### 3. Select and corroborate a lead

Select at most the few summaries necessary to answer the framed question. For
each candidate, record a reader-safe facet:

```text
source kind + scope + freshness/provenance + neutral lesson
-> current task or episode evidence -> disposition
```

Corroborate a recalled constraint against a current instruction, checked-in
decision, current artifact, or bounded Task Episode. If provenance, freshness,
or relevance is unavailable, preserve that uncertainty instead of treating the
candidate as a fact.

### 4. Classify capture separately from learning

Use this chain, in order:

```text
Correction captured? -> relevant here? -> consulted/applied next time?
-> comparable outcome improved?
```

| Stage | Minimum evidence | Safe report state |
| --- | --- | --- |
| Capture | A scoped memory or durable knowledge candidate exists. | `captured-unverified` |
| Relevance | The candidate matches the current goal and is not stale/conflicting. | `relevant-not-yet-adopted` |
| Adoption | A bounded later Task Episode follows or explicitly corrects the candidate. | `adopted` |
| Outcome | A comparable later result improves the declared primary metric without violating a guardrail. | `outcome-supported` |

Use `not-evaluable-missing-invocation-events` when a host has memory files or
configuration but no safe retrieval/application signal. Use
`stale-or-conflicting` when a candidate loses to a current source. A missing
candidate, a one-off correction, an interrupted task, or a protective block
does not become friction by default.

## Promote A Repeated Problem Into A Loop Carefully

Only after at least two independent, comparable Task Episodes show a similar
correction, rediscovery, or avoidable trap. Apply the positive and negative
controls in [Learning Loop Detection Patterns](../loop-engineering/learning-loop-patterns.md)
before promoting the problem:

1. Keep candidate causes plural: task framing, repository guidance, tool
   access, model behavior, external systems, and memory can all contribute.
2. Use [Loop Discovery](../loop-engineering/loop-discovery.md) to choose the
   smallest durable owner. Memory is one option beside repository knowledge,
   Rule, Skill, Hook, Gate, Agent, workflow, or Eval.
3. Name an owner, baseline, primary metric, guardrail, validation method, and
   stop or revert condition before changing anything.
4. Compare a declared later all-eligible or stratified window. Until then,
   report `pending` or an opportunity—not `Improving`, `Sustained`, or
   `Effective`.

Do not turn every memory gap into a Skill. A reusable Skill still needs the
stable trigger, inputs, procedure, output, and validation gate required by
[Skill Discovery](skill-discovery.md). Do not create a
memory or Skill from the review without separate user authorization.

## Reader-Safe Handoff

When a Memory claim matters to the Agent Work Loop, publish only:

```text
question + source scope/kind + evidence state + confidence
-> current corroboration + disposition + next validation or stop condition
```

Examples:

- “A project-scoped correction was captured, but no later invocation evidence
  was available; keep the recall claim unverified.”
- “A current spec supersedes a stale global preference; follow the spec and do
  not write back automatically.”
- “Two comparable episodes rediscovered the same setup boundary; evaluate a
  project-owned setup rule with a later success-rate and time-to-first-run
  comparison.”

For the Harness report envelope, return to the
[Learning Capture Review Procedure](../../models/agent-work-loop.md#review-procedure).
Keep only reader-safe facets in `report.source.json`; raw source material stays
outside the durable report artifact.

## Common Review Failures

- **Capture is called adoption:** memory files prove only capture. Require a
  later episode or current artifact before saying the lesson was used.
- **Generated state overrides policy:** current user/repository instruction
  wins; flag the memory as stale or conflicting.
- **Global personal data leaks into a project review:** default to current
  workspace scope and exclude personal categories.
- **Cache mirrors inflate counts:** primary and mirror copies are one lead until
  proven distinct.
- **A final response closes the loop:** a final message terminates an agent
  turn, not a validation or acceptance boundary.
- **Read-only review silently writes memory:** creation, consolidation, or
  cleanup needs explicit authorization and a separate mutation plan.

## External Grounding

- [OpenAI: Codex local memories](https://learn.chatgpt.com/docs/customization/memories?surface=app)
  distinguishes generated local memory state from required repository guidance
  and documents task-level controls.
- [OpenAI: Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/)
  explains that an agent turn ends at an assistant message, while tool results
  and context management belong to the iterative loop.
- [Anthropic: Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
  supports retaining compact, high-signal task state instead of copying raw
  transcripts into long-lived context.
