# Agent Work Loop

**Agent Work Loop** reviews whether a coding-agent Harness can carry one task
from a clear intent to a validated, reliably delivered result, then turn
supported learning opportunities into improvements that remain useful over
time. The Harness supplies instructions, tools, environments, permissions,
sensors, recovery paths, and reusable capabilities; this model judges how well
those mechanisms work together. It is not a mandatory process, transcript
score, asset inventory, or repository maturity model.

## Review unit

A **Task Episode** is one user goal with one acceptance boundary. It may span
multiple turns or sessions, but every claim must stay tied to the same goal,
target, action, and result. Do not merge unrelated work because it happened in
one session, and do not turn aggregate counts into task behavior.

Use reviewed Task Episodes for behavior claims. When eligible session evidence
is partial or unavailable, keep the unavailable behavior `Unobserved` and use
the inspected project Harness evidence for the mechanisms it can support. This
is a `session-limited` Agent Work Loop review; session availability does not
select another visible model or manufacture completed behavior.

## Construct Task Episode Evidence

Use this procedure after the Better Harness Skill gathers independent session and
project briefs. Inventory, analyzer output, and `report.source.json` are inputs,
not conclusions; this model remains the owner of checks, evidence states,
findings, and scoring.

1. Inspect the smallest relevant repository and configured-agent surfaces for
   scoped instructions, task ownership, setup/run/debug paths, validation,
   permissions, acceptance, recovery, and reusable knowledge routes. Keep
   clean, unavailable, and inventory-only results in the evidence boundary.
   Use the canonical `agents-md-review` and `agent-assets-review` profiles when
   those surfaces are applicable.
2. Use one provider, workspace, time boundary, and selection for the bounded
   session source. Construct candidate episodes through the public Harness
   route; implementation-generated lifecycle, repeat, or validation signals
   remain candidates and do not invent intent, permission, acceptance,
   recovery, recurrence, capture, or outcomes.
3. Open only the few events needed for important claims and convert them to
   redacted semantic facets. Never copy prompts, commands, private paths,
   stable session ids, or secrets into reader output.
4. Keep static mechanisms in `repositoryEvidence`, linked work in
   `taskEpisodes`, acceptance and recovery in `deliveryEvidence`, and
   longitudinal state in the intervention ledger. Resolve judgment only
   through the five dimension tables below.
5. Close a changed Episode only when review links its final validation set to
   its change set. Treat failure → edit → pass as a repair candidate until the
   evidence also retains reproduction and diagnosis. A configured capability,
   apparent asset read, or local permission mode is not observed task use,
   delivery, approval, or recovery.

A configured capability is not observed use.

Current Qoder/Codex normalization can expose planning signals, lifecycle
demand, file reads, apparent Skill activity, tool/Hook counts, validation
timing, friction, and selection manifests. Treat them as navigation leads.
Command-form `/ultraplan`, `/plan`, `/spec`, `/story`, and `/issue-*` entries
count as lifecycle demand only when user task events establish that intent.

Use this projection boundary:

```text
opened project and agent assets -> repositoryEvidence
bounded relevant task events -> taskEpisodes
relevant change + final validation -> Change Validation
acceptance, approval, rollback, or recovery result -> Reliable Delivery
supported repeated opportunity -> Loop Discovery -> durable owner
reviewed durable owner + exercised route -> reusable Learning Capture evidence
later comparable outcome -> outcome-supported Learning Capture evidence
```

When ownership or linkage is absent, preserve `Unobserved`, `Missing`, or `Not
applicable`; do not fill the gap with aggregate counts or prose.

## Review map

The five dimensions and fifteen check ids are stable review identities. Reader
labels explain the capability being judged; they do not rename the stored ids.

| Dimension | ID | Reader question | Three checks |
| --- | --- | --- | --- |
| **Task Understanding** | `task-understanding` | Does the agent understand the intended outcome, apply the relevant authoritative context, and keep the work within an explicit scope and effect boundary? | **Intent and Acceptance** (`goal-understanding`); **Relevant Context** (`relevant-context`); **Scope Boundary** (`scope-boundary`) |
| **Controlled Execution** | `controlled-execution` | Can the agent start and operate the project through supported routes while remaining within enforced permission and operating boundaries? | **Reproducible Startup** (`instruction-led-start`); **Supported Operation** (`supported-operation`); **Permission Boundary** (`permission-boundary`) |
| **Change Validation** | `change-validation` | Does the agent run verification relevant to the final change, diagnose and repair failures with usable observability, and revalidate the repaired result? | **Relevant Verification** (`relevant-check`); **Failure Diagnosis and Repair** (`failure-repair`); **Post-repair Revalidation** (`validate-again`) |
| **Reliable Delivery** | `reliable-delivery` | Is the current result accepted at its real delivery boundary, with risk-appropriate approval and a usable rollback or recovery path? | **Delivery Acceptance** (`acceptance-evidence`); **High-risk Approval** (`high-risk-approval`); **Rollback or Recovery** (`rollback-recovery`) |
| **Learning Capture** | `learning-capture` | Does the Harness detect lifecycle, recurring, and maintenance opportunities, turn supported opportunities into reusable improvements, and keep those improvements accurate and effective over time? | **Lifecycle Opportunity Detection** (`lifecycle-repeat-detection`); **Loop Engineering** (`loop-engineering`); **Longitudinal Validation** (`later-validation`) |

## Evidence, findings, and scores

Resolve all three checks before scoring a dimension. Each check records a
concise result, bounded evidence references, and supported finding references.
Use these evidence states:

- `Present`: an owned mechanism or review contract exists;
- `Wired`: the relevant task, trigger, or owner route can reach it;
- `Exercised`: a linked episode or inspection used it and retained a result;
- `Outcome-supported`: a comparable later result supports the claimed effect;
- `Missing`: inspected evidence confirms a required mechanism or result is absent;
- `Unobserved`: the available observation boundary cannot decide;
- `Not applicable`: inspected task and project evidence proves it does not apply.

Evidence state is not pass/fail. An exercised operation may expose a defect, a
safe denial may be correct behavior, and an unavailable external boundary is
`Unobserved`, not automatically `Missing`. Static configuration proves at most
the mechanism it contains.

For the first four current-task dimensions, evidence limits score confidence:

| Highest supported evidence | Absolute score ceiling |
| --- | --- |
| `Missing`, `Unobserved`, or `Not applicable` | 59 |
| `Present` | 74 |
| `Wired` | 84 |
| `Exercised` | 94 |
| `Outcome-supported` | 100 |

These are ceilings, not a score formula. A required or triggered check that is
missing, unresolved, or blocked keeps its dimension at 59 or lower. Scores
above 75 additionally require inspected source or test ownership plus an
executed or explicitly provided validation route. Score each dimension
independently and never derive a dimension score from finding counts.

A score never creates or suppresses a finding. A finding requires an inspected
gap, bounded impact, smallest owner-aligned repair, and validation route. Iterate
every supported candidate from the bounded evidence and emit every distinct
repairable causal problem that meets this bar. Map one problem to one primary
check even when evidence supports adjacent claims; this is an ownership rule,
not a per-check or per-dimension cap. Keep distinct causes, owners, or validation
routes separate, and deduplicate only repeated evidence for the same problem.
Counts, filenames, asset presence, severity, age, churn, or score alone are not
findings.

Learning Capture uses an Agent-authored integer from 35 through 100. `null`
belongs to the unresolved review slot; a completed review must not project
zero. The 35 floor means only that a bounded Learning Capture review was
completed. It does not prove an exercised detector, a reusable intervention,
or a later effect, and it does not award points for Findings, states, asset
counts, or configured mechanisms. The Agent still judges every value in the
allowed range from bounded evidence. Historical final reports remain readable
without rewriting their stored score.

Scores never require JavaScript to create or demand a finding. If inspection
cannot support a repairable gap, retain the evidence-bounded score and do not
invent a finding or raise the score. The reviewing Agent may use a low score as
a reason to revisit the evidence, but finding selection remains an independent
evidence judgment.

### Finding-bound repair progress

After a finding-bound repair passes its target-owned check, use one independent
reviewer to judge that finding as `verified`, `partial`, or `blocked` from the
locked pre-fix report, actual outputs, exact post-fix validation, and refreshed
asset-integrity result. This updates Asset Health / Repair Progress only. Keep
the finding, severity, and all five dimension scores unchanged.

Call the dimension scores **Loop Effectiveness** in reader surfaces. They change
only when a comparable later Task Episode or independent outcome window shows
that the repaired mechanism was routed, applied, and improved the result without
guardrail regression. Same-window validation proves repair state, not later
effectiveness. If independent repair review is unavailable, record the verified
output while leaving Repair Progress pending.

Learning Capture spans multiple windows: weak evidence may legitimately be
`Unobserved` or `Not applicable`, but every supported missing or regressing
condition still requires its owner-aligned finding. For a bounded eligible
Learning Capture review, an explicit adequate clean no-candidate result is the
only no-match outcome that may remain finding-free. An unresolved evidence
boundary or inspected demand without supported coverage requires an
Agent-authored, evidence-bound fallback finding; score, counts, filenames, or
configured asset presence never create that finding.

Memory and Skill evidence materially constrains Learning Capture only when the
reviewed demand makes that owner applicable. Count, absence, installation, or
configuration earns no credit. An uncovered repeated procedure or knowledge
demand, or a confirmed active-owner conflict that blocks routing or retrieval,
keeps Loop Engineering at `Missing` or `Unobserved` and caps Learning Capture
at 59. A present owner caps it at 74, a wired owner at 84, and a current-task
exercise without a later comparison at 74. A later exercised comparison permits
94; only a later comparable improved outcome permits 100. An exercised adequate
no-candidate window may reach 94 without forcing a Memory or Skill.

The same confirmed Memory or Skill integrity problem immediately remains a
pending Asset Health / Repair Progress finding. Repair verification can advance
that progress, but cannot raise Learning Capture or any other Loop Effectiveness
dimension in the same observation window.

## 1. Task Understanding

**Reader question:** Does the agent understand the intended outcome, apply the
relevant authoritative context, and keep the work within an explicit scope and
effect boundary?

| Check | Description |
| --- | --- |
| **Intent and Acceptance** (`goal-understanding`) | The task preserves the intended outcome, definition of done, exclusions, corrections, and unresolved questions as one recoverable acceptance boundary. |
| **Relevant Context** (`relevant-context`) | Decisions use the authoritative instructions, architecture or domain owner, canonical source, and material dependent contracts instead of broad or incidental context. |
| **Scope Boundary** (`scope-boundary`) | Intended files, modules, generated artifacts, visible or external effects, risk, exclusions, and approved scope expansions remain explicit and traceable. |

### Look for

#### Intent and Acceptance

- **Assets:** Current request and corrections; issue or Story; canonical Spec or
  ADR; acceptance criteria; non-goals; reviewed Task Episode.
- **How to decide:** Reconstruct the requested outcome and definition of done
  from the same episode, then compare them with the delivered result.
  Conflicting owners or unresolved intent keep the check blocked;
  underspecification without deciding evidence stays `Unobserved`.

#### Relevant Context

- **Assets:** Scoped `AGENTS.md` or Rules; architecture and design docs;
  canonical schemas or generators; dependent contracts; sibling
  implementations; task-used Skills, Agents, MCP results, or external sources.
- **How to decide:** Follow the repository owner chain from the task to the
  canonical source and material dependents. Use `rg --files` to locate candidate
  owners, then open their contents. Inventory and read counts are leads only.
  For confirmed visual work, inspect an applicable root `DESIGN.md`; do not
  impose it on non-visual projects.

#### Scope Boundary

- **Assets:** Requested target; plan or task list; risk classification;
  `git diff --name-status`; generated outputs; external actions; recorded
  expansion decisions.
- **How to decide:** Compare intended scope and effects with the actual diff and
  external actions. A plan proves only intent. Pass only when effects stayed
  inside the boundary or every material expansion was explicitly approved and
  remains tied to the outcome.

Use [Construct Task Episode Evidence](#construct-task-episode-evidence) to keep
the source boundary safe. Rules and plans may prove a route exists; only
task-linked use proves behavior.

### Typical findings

#### Intent and Acceptance

- **Example finding:** “The task has no recoverable acceptance boundary.”
- **Emit only when:** Opened request, correction, issue, or Spec evidence shows
  conflicting or missing completion criteria that materially affected the
  result. A vague prompt alone is insufficient.

#### Relevant Context

- **Example finding:** “The change bypasses the canonical owner.”
- **Emit only when:** The opened architecture or generator contract identifies
  one owner while the observed edit uses a derived or conflicting surface. Name
  the affected dependency and re-check route.

#### Scope Boundary

- **Example finding:** “The repair silently expands beyond the requested scope.”
- **Emit only when:** Actual diff or external-effect evidence shows unrelated
  files, modules, or state changes with no retained approval or outcome link.

## 2. Controlled Execution

**Reader question:** Can the agent start and operate the project through
supported routes while remaining within enforced permission and operating
boundaries?

| Check | Description |
| --- | --- |
| **Reproducible Startup** (`instruction-led-start`) | A clean or explicitly declared starting state becomes usable through the project-owned, non-interactive setup and startup route. |
| **Supported Operation** (`supported-operation`) | The target behavior is discoverable and invocable through a supported Command, Skill, CLI, Agent, Plugin, or MCP-backed workflow with usable inputs, outputs, failures, and cleanup. |
| **Permission Boundary** (`permission-boundary`) | Filesystem, network, tools, credentials, external writes, shared state, and protected actions remain inside enforced authorization and cleanup boundaries. |

### Look for

#### Reproducible Startup

- **Assets:** Effective instructions; working directory; runtime pins; manifest
  and matching lockfile; package-manager declaration; setup, doctor, health,
  reset, fixture, and service routes; platform notes.
- **How to decide:** Run the smallest project-owned setup, doctor, or health
  route from a clean or declared state. Retain exact argv, cwd, starting state,
  exit or health result, and one precise blocker. Do not invent a runtime, port,
  or package manager.

#### Supported Operation

- **Assets:** Command or Skill description; CLI `--help`; MCP tool schema;
  Custom Agent or Plugin route; input fixture; output contract; timeout,
  failure, and cleanup semantics.
- **How to decide:** Invoke the smallest documented entrypoint with bounded
  input and inspect its result and one named failure path. Use the inventory
  route in [Agent Customize](../references/agent-customize/routing.md)
  to discover configured surfaces, but configuration alone proves only
  `Present`.

#### Permission Boundary

- **Assets:** Host permission mode; sandbox and allow/ask/deny policy; Agent
  tool list; MCP authentication and scope; secret handling; lifecycle Hooks;
  dry-run; approval; before/after state; cleanup.
- **How to decide:** Compare the requested action with the enforced host
  boundary, then inspect the pre-action decision and post-action state. A safe
  denial with escalation can pass; a policy file without an observed decision
  cannot prove exercised control.

Use [Observability for AI Debugging](../references/project-harness/observability.md)
when discoverability, runnable output, or failure visibility is the missing
operating boundary.

### Typical findings

#### Reproducible Startup

- **Example finding:** “The documented startup route cannot reproduce a usable
  workspace.”
- **Emit only when:** The project-owned route was run or its required
  prerequisite was inspected, and the blocker can be tied to a stale command,
  hidden dependency, missing runtime decision, or unusable failure output.

#### Supported Operation

- **Example finding:** “The external tool has access but no supported task
  workflow.”
- **Emit only when:** An opened MCP, Plugin, Command, or Agent surface exists,
  but inspected guidance does not define when to use it, required inputs,
  consumable output, failure handling, or cleanup.

#### Permission Boundary

- **Example finding:** “The task can cross a protected boundary without a valid
  decision.”
- **Emit only when:** Inspected tool scope, Hook, sandbox, or action evidence
  shows unauthorized effects, default-open dangerous access, credential
  exposure, unaudited bypass, or cross-task residue.

## 3. Change Validation

**Reader question:** Does the agent run verification relevant to the final
change, diagnose and repair failures with usable observability, and revalidate
the repaired result?

| Check | Description |
| --- | --- |
| **Relevant Verification** (`relevant-check`) | The final material change is mapped to and exercised by the smallest project-owned check that directly covers its behavior, invariant, and risk. |
| **Failure Diagnosis and Repair** (`failure-repair`) | An observed validation failure is reproduced, localized with attributable diagnostics, explained by a causal hypothesis, and repaired at the smallest correct owner. |
| **Post-repair Revalidation** (`validate-again`) | The same failed check, or a justified equivalent with the same behavior and scope, runs again on the repaired final state. |

### Look for

#### Relevant Verification

- **Assets:** Final diff or change set; acceptance constraints; scoped lint,
  type, unit, contract, integration, smoke, E2E, visual, accessibility,
  packaging, security, schema, migration, or artifact checks; final revision and
  fixture.
- **How to decide:** Map every material edit to the smallest target-owned check
  and run it after the last edit. Retain argv or CI identity, cwd, fixture,
  revision, result, and covered invariant. A broad unrelated suite or older
  result does not pass.

#### Failure Diagnosis and Repair

- **Assets:** Failed check identity; reproduction; project logger or
  observability facade; readable sink; stable correlation identity; causal
  hypothesis; repair diff; residual risk.
- **How to decide:** Require the ordered chain
  `failure -> reproduction -> diagnosis -> bounded repair`. For core or
  high-impact paths, inspect
  `trigger -> boundary/decision -> failure/recovery -> result` under one stable
  identity. A retry pass without diagnosis is not repair evidence.

#### Post-repair Revalidation

- **Assets:** Repaired final revision; same check identity or equivalence
  rationale; final runtime or generated artifact; residual constraints.
- **How to decide:** Rerun the original check after repair. Accept an equivalent
  only when the review records why it covers the same behavior and scope. If no
  failure or repair occurred, record `Not applicable` with the Relevant
  Verification result.

For affected core or high-impact paths, run the bounded evidence collector
described by [Core Change Watch](../references/project-harness/core-change-watch.md),
for example `<cli> core-change-watch evidence-pack --cwd <target> --json`, then
apply the six gates in
[Observability for AI Debugging](../references/project-harness/observability.md):
discoverable, runnable, readable, correlatable, verifiable, and safe/reversible.
Resolve `<cli>` through the Harness routing reference. When Relevant
Verification still depends on human enumeration, manual multi-target
comparison, or by-eye acceptance — a long-chain system with many entrypoints
and asynchronous stages, a UI or mini-program surface compared by hand, a
pipeline or model output spot-checked ad hoc — route the repair to
[Agent Verify Loop](../references/project-harness/agent-verify-loop.md) for
the verification-harness design.

#### Core and high-impact observability judgment

Classify the six gates for one smallest representative scenario and profile:

- **Ready:** all applicable gates are supported, so the focused route is
  discoverable, runnable, readable, correlatable, verifiable, and safe enough
  for the affected chain.
- **Partial:** the route exists, but at least one applicable segment is
  undocumented, unreadable, uncorrelated, unsafe, or unexercised. Keep the
  owning check unresolved and retain the precise missing segment.
- **Blocked:** no safe executable route can produce attributable evidence for
  the affected chain. The owning check is blocked and the dimension remains at
  59 or lower.
- **Not applicable:** use only after inspecting the final change and canonical
  core boundary proves that no core or high-impact chain is affected.

When no failure was observed, a missing focused diagnostic route belongs to
Relevant Verification. When a failure was observed and the route blocks
diagnosis, it belongs to Failure Diagnosis and Repair. Logger imports, call
counts, dashboards, and “few logs” are only search leads.

### Typical findings

#### Relevant Verification

- **Example finding:** “The final change has no check that exercises its
  affected behavior.”
- **Emit only when:** The final diff and project-owned validation routes were
  inspected, and available results are absent, stale, unrelated, or unable to
  cover the named invariant. For core paths, name the missing diagnostic
  segment and blocked verification outcome.

#### Failure Diagnosis and Repair

- **Example finding:** “The failed check was retried without locating the
  cause.”
- **Emit only when:** An ordered failure record exists, but diagnostics cannot
  join the trigger, decision boundary, failure or recovery, and result; or the
  repair does not address the supported cause.

#### Post-repair Revalidation

- **Example finding:** “The repaired state was never checked at the original
  scope.”
- **Emit only when:** The repair is visible, but no same-check rerun or
  evidence-backed equivalent exists on the final revision.

The valid branches are:

```text
no relevant failure -> Relevant Verification passes; repair and revalidation are N/A
relevant failure    -> all three checks must pass on the repaired final state
```

## 4. Reliable Delivery

**Reader question:** Is the current result accepted at its real delivery
boundary, with risk-appropriate approval and a usable rollback or recovery
path?

| Check | Description |
| --- | --- |
| **Delivery Acceptance** (`acceptance-evidence`) | The current result reaches the project's real review, required CI, merge, release, deployment, or equivalent acceptance boundary with revision-bound decision evidence. |
| **High-risk Approval** (`high-risk-approval`) | Every applicable destructive, privileged, external, irreversible, shared-state, credential, release, or production action receives its required decision before the effect. |
| **Rollback or Recovery** (`rollback-recovery`) | The actual side effect has a risk-proportionate rollback, restore, retry, compensation, idempotent replay, safe abort, or proven no-persistent-effect path with an owned postcondition. |

### Look for

#### Delivery Acceptance

- **Assets:** Review or PR decision; required CI and merge protection; release
  or deployment record; target branch or environment; current revision;
  bypass, stale, superseded, pending, rejected, or recovered status.
- **How to decide:** Bind the real acceptance decision to the current revision
  and target. Local tests and an agent “done” message belong to Change
  Validation, not delivery. If the external boundary cannot be opened, use
  `Unobserved` rather than inventing a missing PR or deployment.

#### High-risk Approval

- **Assets:** Risk classification; protected action; pre-action allow/ask/deny
  or approval decision; approver or policy owner; audit reference; bypass and
  escalation route.
- **How to decide:** Inspect whether the decision occurred before the effect and
  whether it came from the required human or policy owner. Safe denial plus
  usable escalation is correct control behavior. Confirmed absence of a
  high-risk action is `Not applicable`.

#### Rollback or Recovery

- **Assets:** Actual effect and blast radius; preview or dry-run; prior revision
  or backup; rollback, restore, retry, compensation, idempotency, safe abort;
  owner; entrypoint; permission scope; postcondition and result.
- **How to decide:** Apply [Rollback and Recovery Evidence](../references/project-harness/recovery-evidence.md).
  `Present` needs an owned mechanism; `Wired` binds it to the affected resource,
  entrypoint, owner, and postcondition; `Exercised` needs a safe simulation,
  rehearsal, comparable retained task, or actual recovery result. Never run a
  destructive rollback merely to raise evidence strength.

### Typical findings

#### Delivery Acceptance

- **Example finding:** “Only local validation supports the delivery claim.”
- **Emit only when:** The real acceptance boundary was inspected and has no
  current-revision decision, or the retained result is stale, bypassed, or
  attached to another target. An inaccessible host remains `Unobserved`.

#### High-risk Approval

- **Example finding:** “The protected action can execute before approval.”
- **Emit only when:** The action and required policy were inspected, and
  evidence shows self-approval, approval after the effect, unaudited bypass, or
  default-open behavior.

#### Rollback or Recovery

- **Example finding:** “The recovery route is not bound to the affected state.”
- **Emit only when:** A recovery-looking file, command, or promise exists, but
  inspection cannot connect it to the actual resource or revision, required
  permissions, owner, postcondition, and recovery validation. Filename matches
  alone are insufficient.

Delivery Acceptance is required. Approval and recovery are conditional on
inspected risk and effects; an unjustified `Not applicable` blocks the result.

## 5. Learning Capture

**Reader question:** Does the Harness detect lifecycle, recurring, and
maintenance opportunities, turn supported opportunities into reusable
improvements, and keep those improvements accurate and effective over time?

| Check | Description |
| --- | --- |
| **Lifecycle Opportunity Detection** (`lifecycle-repeat-detection`) | A bounded review distinguishes current lifecycle capability gaps, supported repeated opportunities, entropy-backed maintenance opportunities, adequate clean windows, and inadequate evidence. |
| **Loop Engineering** (`loop-engineering`) | A supported opportunity is routed through coverage inspection and Loop Discovery into the smallest durable owner with a repeatable trigger, artifact, verifier, state, safety boundary, and stop rule. |
| **Longitudinal Validation** (`later-validation`) | A reusable improvement remains accountable through either a comparable later-outcome evaluation or a recurring maintenance/freshness inspection against canonical truth. |

### Review Procedure

Follow these actions for every bounded Learning Capture review. This section
owns evidence collection, reviewed-row authoring, owner handoff, and
intervention-ledger continuity; the check sections below own state, finding,
score, and reader judgment.

#### Collect Bounded Evidence

1. Read generated `repositoryEvidence.workflowDemandDiagnostics`. Keep
   `currentHandoffs` and `repeatedCandidates` separate. A current handoff stays
   under its current Agent Work Loop dimension; only distinct comparable Task
   Episodes can support repetition. Treat `/ultraplan`, `/plan`, `/spec`,
   `/story`, `/issue-*`, and `/review` as lifecycle entry points only when user
   task events establish their intent.
2. Open the bounded Task Episodes behind supported task-family, correction,
   rediscovery, successful-procedure, and repeated-friction leads. Use
   [Learning Loop Detection Patterns](../references/loop-engineering/learning-loop-patterns.md)
   for recurrence, negative controls, provenance, and coverage reason codes.
3. Search the bounded project scope for content that could help the task. Use
   [Knowledge-Asset Review](../references/agent-customize/knowledge-assets-review.md)
   and
   [Memory Review And Learning-Loop Evidence](../references/agent-customize/memory-review.md).
   Filenames, counts, descriptions, frontmatter, inventory paths, and apparent
   reads are leads; open candidate content before retaining a claim.
4. Read generated
   `repositoryEvidence.learningCaptureDiagnostics.signals.memoryActivity` and
   `signals.memoryScan`. Session retrieval/write counts are independent of
   metadata inventory. Preserve `scanned-present`, `scanned-empty`, and
   `not-scanned`; an empty `memories[]` list does not prove a scan ran.
5. Inspect bounded local Git history for durable-asset, validation, and review
   evidence. A commit proves a visible change, not that it helped. Use connected
   GitHub, GitLab, Aone, or other host review/CI evidence only when it was
   actually opened.
6. Read the latest validated Harness `findings.json` for a restorable
   intervention ledger. Keep the current review source in temporary scratch.

Global or user-home Memory and Skills require the explicit global-capability
route. Never copy raw Memory text, transcripts, queries, result titles,
commands, absolute paths, session ids, or secrets into report source.

#### Resolve the Opportunity Class

| Review class | Required bounded evidence | Next owner |
| --- | --- | --- |
| Current capability gap | One user-originated lifecycle handoff, its Task Episode, inspected coverage, and a named missing procedure or result boundary. | The affected current-task dimension; Skill Discovery only for its coverage ladder. |
| Repeated opportunity | The same normalized intent and scope across at least two distinct comparable Task Episodes, plus repeated friction, avoidable cost, or a repeated successful procedure with result evidence. | [Loop Discovery](../references/loop-engineering/loop-discovery.md). |
| Entropy-backed opportunity | A named asset or invariant, stable inspection trigger, canonical truth, and evidence that a bounded maintenance loop can make a real decision. | Loop Discovery; Scheduled Inspection only after owner selection. |
| Adequate no-candidate window | At least two eligible Task Episodes, usable normalized lifecycle signals in distinct episodes, no supported repeated candidate, and an explicit clean recurrence decision. | Loop Engineering and Longitudinal Validation may be not applicable when no ledger exists. |

One current handoff may support an owner-aligned current-dimension finding after
coverage inspection; it cannot prove recurrence. Repeated or entropy-backed
evidence can advance to Loop Engineering. File age, churn, unresolved markers,
asset counts, unavailable sources, `insufficient-episodes`, and missing events
remain leads, not clean or repairable outcomes by themselves.

When available, `<cli> dependency-governance --json` supplies bounded
maintenance leads. Its `staleDependencyFiles` records file-touch age; it does
not prove that a resolved dependency version is outdated, insecure, or
unsupported. Compare inspected state with canonical truth before resolving
`clean`, `gap`, or `needs more evidence`.

For any fallback finding required by the model, author `missing-mechanism` or
`evidence-gap` under `lifecycle-repeat-detection`. If repeated demand informs
the decision, bind at least one real `repeatedCandidates` lead rather than a
count or invented recurrence claim.

#### Author Reviewed Rows and Findings

1. Author exactly `lifecycle-repeat-detection`, `loop-engineering`, and
   `later-validation` in `repositoryReview.reviewedChecks`. Each row uses
   `status: reviewed`, the model-resolved state, a concise summary, bounded
   `evidenceRefs`, and `findingRefs`.
2. On `loop-engineering`, include only inspected durable owners in
   `mechanisms`. When its state is `Exercised`, add non-empty
   `currentValidationEvidenceRefs` from the current packet; otherwise omit that
   field. An exercised Loop Engineering row does not require a ledger.
3. Treat generated `signals`, `episodeRecords`, `recurringIssueCandidates`,
   `coverage`, and `learningCaptureSchemaVersion` as read-only review leads under
   `repositoryEvidence.learningCaptureDiagnostics`. Generated current-handoff,
   repeated-work, coverage, and owner-review facts remain read-only under
   `repositoryEvidence.workflowDemandDiagnostics`. Do not edit them or branch
   on generated metadata versions. Reject projection while a required reviewed
   row remains unresolved. They are review leads, not canonical rows or reader
   findings.
4. Iterate all supported candidate leads. Multiple distinct repairable causal
   chains may create multiple findings; deduplicate repeated evidence for the
   same problem. Give every ordinary Learning Capture finding exactly one
   primary Learning Capture check in `subdimensionRefs`, include
   `learning-capture` in `dimensionRefs`. Require the reverse link as well: that
   check's `findingRefs` must name the same finding.
5. Use Loop Discovery for the smallest durable owner. When Loop Discovery
   selects a Skill-shaped procedure, use
   [Skill Discovery](../references/agent-customize/skill-discovery.md)
   without restating or bypassing its evidence classes or coverage precedence.
   Creation, installation, activation, scheduling, and external writes remain
   separately authorized.

Record `candidateOwner` and bounded `ownerSelectionEvidenceRefs` on the
`loop-engineering` row only for the selected current operating route. Additional
Skill findings bind their own repeated-demand and generated candidate evidence;
finding prose or `expectedArtifact` is not owner-selection evidence.

#### Preserve Intervention Continuity

After the model supports a repeated opportunity and selects one bounded
intervention, add or update the top-level `interventionLedger`. Preserve the
validated reader-safe ledger in host-owned `findings.json`; Canvas-only detail
may live in `canvas.json`, but the ledger remains source input.

A restored valid ledger preserves later-validation continuity only. It does not
synthesize current Lifecycle Opportunity Detection or Loop Engineering state.
If current Loop Engineering is not `Exercised`, keep the ledger dormant: later
validation is `Unobserved`, aggregate state is `N/A`, and no effectiveness claim
is allowed. Activate it only after the current review independently exercises
Loop Engineering.

Aggregate validated results conservatively: a regression keeps its stop/revert
blocker and forbids an aggregate effectiveness claim. Otherwise prefer an
outcome-supported comparison, then a completed improving or unchanged result,
then a bound pending comparison, then a complete unbound plan. Pending entries
never erase completed results or rewrite historical results.

### Look for

#### Lifecycle Opportunity Detection

- **Assets:** Bounded Task Episodes; user-originated specification, planning,
  setup, debugging, verification, review, branch-completion, release, or
  documentation-maintenance demand; repeated friction or successful
  procedures; documentation, command, dependency, runtime, support-policy,
  release, and repository-activity leads; repository entropy; observed and
  configured coverage; explicit no-candidate result.
- **How to decide:** Follow the [Review Procedure](#review-procedure). Run a
  bounded `session-analysis sources` and the relevant insights route when
  session evidence is available, then inspect capability inventory. Treat
  `/plan`, `/review`, missing same-name Skills, repeated prose, file age, churn,
  and counts as leads. One current handoff may produce current-dimension advice;
  only repeated, costly, or entropy-backed evidence advances to Loop
  Engineering. In an eligible bounded review, no accepted supported match is a
  decision, not an empty result: retain an evidence-gap finding when an
  inspected observation or classification boundary blocks the decision, or a
  missing-mechanism finding when observed demand has no supported durable
  coverage. Only an explicit adequate clean no-candidate result needs no
  Learning Capture finding.

#### Loop Engineering

- **Assets:** Candidate evidence; Demand Source Analysis; observed, built-in,
  and configured coverage; Loop Discovery decision; trigger; stable input;
  owner; tools and permissions; artifact; verifier; state; stop rule; current
  validation.
- **How to decide:** Run the coverage ladder before creating anything: observed
  coverage, built-in, configured, extend, create, needs evidence. Route the
  candidate through [Loop Discovery](../references/loop-engineering/loop-discovery.md),
  which selects the smallest owner. Enter Skill Discovery only for a
  Skill-shaped owner. `Exercised` requires authorized use and current
  validation, not just creation. If a supported candidate has no inspected
  owner or operating contract, retain a `loop-engineering` finding rather than
  leaving that row `Missing` or `Unobserved` without an action.

#### Longitudinal Validation

- **Assets:** Outcome mode: baseline, primary metric, guardrail, comparable
  scope, selection rule, later window, decision, stop/revert. Maintenance mode:
  named asset or invariant, owner, cadence or trigger, canonical truth,
  executed inspection, clean/gap decision, repair trail, verifier, stop rule.
- **How to decide:** For outcome mode, only a comparable later result can be
  `Outcome-supported`. For maintenance mode, use
  [Scheduled Inspection](../references/loop-engineering/patterns/scheduled-inspection.md);
  a clean no-change inspection is valid `Exercised` evidence. File age or
  missed cadence starts inspection but cannot prove drift without comparison
  to canonical truth.

#### Maintenance and freshness routing

Route confirmed drift by its observed effect, not by the artifact's age or
type:

- Guidance, architecture, or commands that conflict with an opened canonical
  owner belong to **Relevant Context** when they misdirect the current Task
  Episode. An unsupported runtime, dependency, registry route, or setup command
  that blocks the current workspace belongs to **Reproducible Startup**. Stale
  check or acceptance results stay under **Relevant Verification** or
  **Delivery Acceptance**.
- Repository-wide documentation, dependency, runtime, release, or project-
  maintenance health enters **Learning Capture** only as an entropy-backed
  opportunity with a named asset or invariant, canonical truth or support
  policy, and a runnable inspection that can return `clean`, `gap`, or
  `needs more evidence`.
- File age, last commit or release age, missed cadence, an old-looking version,
  a newer upstream release, and missing update automation are inspection
  triggers only. A repository with no recent commits may be intentionally
  stable, and a dependency that is not the latest release is not necessarily
  obsolete.
- Confirm drift with an opened mismatch or executed result: a documented path,
  command, schema, or version conflicts with current project truth; a runtime or
  dependency is unsupported or end-of-life under the project's applicable
  support policy; a known advisory or project-approved outdated/audit check
  identifies the affected resolved version; or setup, build, test, release, or
  supported-platform evidence demonstrates the maintenance cost. Without that
  comparison, keep the result as a lead or `Unobserved`, not a finding.

Repair a confirmed one-time mismatch at its current owner. Advance it through
Loop Engineering or Scheduled Inspection only when the evidence supports a
repeatable maintenance decision with an owner, trigger or cadence, verifier,
safety boundary, and stop rule.

Generated lifecycle and learning diagnostics remain read-only review inputs.
They do not create findings or choose durable owners by themselves. The Agent
authors any retained finding from bounded evidence; report projection preserves
the reviewed decision without a fallback quota or status gate. Use
the inventory and session commands routed by Agent Customize and Session Evidence rather
than copying raw prompts, commands, private paths, Memory bodies, or session ids
into the report.

### Typical findings

#### Lifecycle Opportunity Detection

- **Example finding:** “The reviewed window cannot distinguish repeated work or
  confirmed maintenance drift, or route verified demand into a reusable
  learning path.”
- **Emit only when:** The bounded source and episode construction were
  inspected, and missing task boundaries, normalized events, or coverage
  decisions prevent a repeat or clean-window conclusion, or an eligible bounded
  review inspected lifecycle or entropy demand and the coverage ladder but
  found neither a supported match nor an adequate clean no-candidate result.
  Bind real repeated demand when it supports the finding, name the smallest
  evidence or mechanism repair, and never infer the problem from a single
  episode, command token, score, count, filename, or missing same-name Skill.

#### Loop Engineering

- **Example finding:** “A new Skill is proposed before existing lifecycle
  coverage is tried.”
- **Emit only when:** A supported opportunity exists, but opened observed,
  built-in, configured, or extendable coverage was skipped, or Loop Discovery
  did not select the smallest durable owner and operating contract. The repair
  follows Loop Discovery; it does not default to a Skill or authorize creating,
  installing, activating, or scheduling a mechanism.

#### Longitudinal Validation

- **Example finding:** “The improvement has no executable later comparison or
  maintenance inspection.”
- **Emit only when:** Loop Engineering is exercised, but the applicable outcome
  or maintenance contract lacks a required baseline or canonical truth, owner,
  trigger/window, verifier, decision rule, or stop/revert condition. A future
  window that is merely unavailable stays `Unobserved`; a confirmed regression
  without stop/revert is a finding.

Learning Capture has one Agent-authored score, not three subscores. Resolve
Lifecycle Opportunity Detection and Loop Engineering from the bounded current
review; do not wait for future outcome evidence. Longitudinal Validation gates
effect claims. Without an `Outcome-supported` later result, the review must not
claim that later tasks improved. Neutral, clean, and negative completed results
remain valid evidence; a regression keeps its stop/revert finding.

## Reference ownership

The five definition tables own the reader questions and capability meanings.
Their `Look for` and `Typical findings` sections own applicability, evidence
expectations, pass/fail judgment, and finding conditions. Supporting documents
own how evidence is collected or operated:

| Concern | Owner |
| --- | --- |
| Task Episode construction and source-safe evidence | [Construct Task Episode Evidence](#construct-task-episode-evidence) |
| Agent customization routing | [Agent Customize](../references/agent-customize/routing.md) |
| Core-path expansion and evidence pack | [Core Change Watch](../references/project-harness/core-change-watch.md) |
| Logging and diagnostic inspection | [Observability for AI Debugging](../references/project-harness/observability.md) |
| Cross-stack verification harness and regression skeleton | [Agent Verify Loop](../references/project-harness/agent-verify-loop.md) |
| Project-type evidence additions | [Project Overlays](../references/project-harness/project-overlays.md) |
| Rollback and recovery inspection | [Rollback and Recovery Evidence](../references/project-harness/recovery-evidence.md) |
| Lifecycle capability coverage and Skill ladder | [Skill Discovery](../references/agent-customize/skill-discovery.md) |
| Candidate proof and durable owner selection | [Loop Discovery](../references/loop-engineering/loop-discovery.md) |
| Longitudinal ledger and reviewed-row mechanics | [Learning Capture Review Procedure](#review-procedure) |
| Recurring maintenance operating pattern | [Scheduled Inspection](../references/loop-engineering/patterns/scheduled-inspection.md) |
| Reader projection and report artifacts | [Report Output](../skills/better-harness/SKILL.md#report-output) |
| Definition and research rationale | [Agent Work Loop Rationale](../models/agent-work-loop-rationale.md) |

Runtime schemas and compatibility versions belong to their validators and
constants, not this review model. Generated detector fields remain read-only
evidence leads until a reviewer applies this model. Project overlays may add
evidence sources or stricter local gates, but they must not rename the five
dimensions, add a sixteenth check, turn configured assets into behavior, or
weaken an existing judgment or finding condition.
