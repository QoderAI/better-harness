# Learning Loop Research Basis

Use this reference only when reviewing or changing Learning Capture, Loop
Discovery, intervention-ledger, or Skill-evolution behavior. It records the
external research basis behind those contracts. It is not an evidence source
for scoring a project and never substitutes for opened local instructions,
code, tests, delivery state, or reviewed Task Episodes.

This file owns the primary-source rationale and the known stability conditions
for evolving a durable asset from experience. It does not own pattern
signatures, recurrence thresholds, or coverage codes; use
[Learning Loop Detection Patterns](learning-loop-patterns.md). It does not own
owner selection; use [Loop Discovery](loop-discovery.md).

## Load When

- A Learning Capture, Loop Discovery, or intervention-ledger contract change
  needs a primary-source rationale.
- A proposal wants automatic Skill generation, asset merging, or unattended
  self-revision, and the review needs the published stability conditions.
- A reviewer must keep `opportunity` and `readiness` claims separate from an
  `effectiveness` claim and needs the comparison designs that support each.

## Improvement axes

[Self-Improvements in Modern Agentic Systems](#references) models an agent as a
foundation model coupled to an operational scaffold of prompts, memory, tools,
and control logic, and formalizes self-improvement as a self-induced update
operator that commits changes to one of those targets. The two axes are
orthogonal:

| Axis | Update target | Repository position |
| --- | --- | --- |
| Foundation model improvement | Parameters, driven by self-generated demonstrations, self-evaluation, or environment exploration | Out of scope. This repository never updates model weights. |
| Scaffolding improvement | Prompts, memory, tools, workflows, or the full scaffold | In scope. Every durable owner (Memory, Rule, Skill, Hook, Gate, Workflow, Agent, Eval) is a scaffold component. |

Keep the boundary explicit in reader-facing output. Repository-side evolution
changes reviewable scaffold artifacts; it does not change model capability, and
a scaffold gain must never be reported as a capability gain.

## Distillation shape

Skill-artifact work converges on the same progression, which is why the
repository's stage vocabulary (`capture`, `generalize`, `codify`, `route`,
`exercise`, `evaluate`, `maintain`) can carry these findings without a new
model.

| Stage | Research position | Repository owner |
| --- | --- | --- |
| capture | Raw trajectory stores are redundant and noise-heavy; distill instead. Successful runs become strategic patterns, failed runs become concise lessons (SkillRL). | Normalized Task Episodes and learning signals. |
| generalize | Recurring lessons are induced across many traces in parallel, not from one trace (Trace2Skill). | Two comparable episodes as the default recurrence threshold. |
| codify | Lessons consolidate hierarchically into one unified, conflict-free skill directory (Trace2Skill); failures materialize into structured skill folders (EvoSkill). | `recommendedOwner` selection. Consolidation is reported, not performed. |
| route | Retrieval separates general heuristics from task-specific ones (SkillRL); guidance splits into task-level and step-level granularity (D2Skill). | Smallest-durable-owner selection in Loop Discovery. |
| exercise | An artifact only counts once the agent actually runs under it. | `routed-but-not-applied` and `asset-updated-not-reexercised`. |
| evaluate | A held-out or paired comparison decides whether the artifact is kept. | Intervention ledger. |
| maintain | Prune by measured utility, not by age (D2Skill). | `stale-or-conflicting-asset` freshness review. |

## Stability conditions

Every published result that reliably improves over its starting point adds an
acceptance gate. Loosely controlled self-revision is reported as the failure
mode, not the baseline. Treat the following as review questions for any
evolution proposal.

| Condition | Source | Current repository state |
| --- | --- | --- |
| Accept an edit only when a held-out score strictly improves | SkillOpt | Absent. `stopOrRevertCondition` records a revert trigger; there is no held-out acceptance gate. |
| Retain only artifacts that stay on a validation Pareto frontier | EvoSkill | Absent. |
| Keep the verifier isolated from ground-truth test content while it still returns actionable feedback | CoEvoSkills | Partial. Read-only specialist passes are separated from Lead reconciliation, but the verifier does not co-evolve. |
| Compare paired baseline and artifact-injected runs under one policy, and use the gap as the update signal | D2Skill | Absent. `comparisonWindow.taskMix` compares observation windows, not controlled pairs. |
| Bound each edit and buffer rejected edits so the optimizer stops re-proposing them | SkillOpt | Absent. Related patterns (`unvalidated-intervention`, `correction-not-promoted`) detect the symptom only. |
| Assign credit below episode granularity before blaming a step | GiGPO | Absent. Findings attribute to a primary check at Task Episode level. |
| Generate held-out tasks rather than assuming a fixed suite exists | AgentEvolver | Absent. The `eval` owner may be recommended but is not produced. |

The paired-comparison gap explains a current honest limit: with only window
comparison available, `improving` and `unchanged` ledger results project
`later-validation` to `Exercised`, not `Outcome-supported`. Closing that gap
requires a controlled comparison, not a scoring change.

## Transfer

Evolved skill artifacts retain value across model scales, across model
families, across execution harnesses, and on out-of-distribution tasks, with
the underlying model frozen and without test-time retrieval. Human-authored
skills can also underperform because of human-machine cognitive misalignment
rather than missing content.

Both findings support treating a repository-local artifact as a durable asset
rather than model-specific tuning, and they justify reviewing a human-written
asset against observed agent behavior instead of assuming authorship implies
fitness. Neither finding licenses a claim about a specific asset in a specific
repository.

## Interpretation boundary

These sources explain the shape of the contracts. They do not freeze
terminology, provider features, thresholds, or numeric scores.

- Do not cite a published gain as evidence about this repository. Reported
  numbers come from bounded benchmark suites under a fixed harness.
- Do not raise `later-validation` above `Exercised` without a comparable
  held-out or paired result recorded in the intervention ledger.
- Do not auto-merge, auto-rewrite, or auto-delete a named durable asset from a
  single observation window. Consolidation findings stay advisory until an
  acceptance gate exists.
- Do not convert an absent eval suite into a low score. Without a comparison
  set the honest state is `Unobserved`.
- Weight-space methods stay out of scope even when cited here; they are
  recorded to mark the boundary, not to widen it.

## References

Scaffolding improvement, skill artifacts:

- Ni et al., *Trace2Skill: Distill Trajectory-Local Lessons into Transferable
  Agent Skills*, 2026. <https://arxiv.org/abs/2603.25158>
- Alzubi et al., *EvoSkill: Automated Skill Discovery for Multi-Agent Systems*,
  2026. <https://arxiv.org/abs/2603.02766>
- Yang et al., *SkillOpt: Executive Strategy for Self-Evolving Agent Skills*,
  2026. <https://arxiv.org/abs/2605.23904>
- Zhang et al., *CoEvoSkills: Self-Evolving Agent Skills via Co-Evolutionary
  Verification*, 2026. <https://arxiv.org/abs/2604.01687>

Skill banks coupled to policy training:

- Xia et al., *SkillRL: Evolving Agents via Recursive Skill-Augmented
  Reinforcement Learning*, 2026. <https://arxiv.org/abs/2602.08234>
- Tu et al., *Dynamic Dual-Granularity Skill Bank for Agentic RL*, 2026.
  <https://arxiv.org/abs/2603.28716>

Credit assignment, task generation, and supervision, recorded as the
out-of-scope boundary:

- Feng et al., *Group-in-Group Policy Optimization for LLM Agent Training*,
  NeurIPS 2025. <https://arxiv.org/abs/2505.10978>
- Zhai et al., *AgentEvolver: Towards Efficient Self-Evolving Agent System*,
  2025. <https://arxiv.org/abs/2511.10395>
- Zhao et al., *Self-Distilled Reasoner: On-Policy Self-Distillation for Large
  Language Models*, 2026. <https://arxiv.org/abs/2601.18734>

Umbrella framing:

- Ren et al., *Self-Improvements in Modern Agentic Systems: A Survey*, 2026.
  <https://arxiv.org/abs/2607.13104>
