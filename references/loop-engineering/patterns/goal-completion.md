# Goal Completion Pattern

Use this pattern when an approved objective has observable acceptance criteria
and the work should continue through execution, verification, and delivery.
An issue, manual request, event-response handoff, or inspected candidate can
start the pattern. `/goal` is only a host expression when the active host
supports it.

## Composition

| Slot | Contract |
| --- | --- |
| Trigger | Approved issue or change request, explicit user goal, confirmed event handoff, or accepted inspection candidate with bounded completion criteria. |
| Procedure Owner | Let one selected orchestrating owner compose small understanding, execution, verification, and delivery procedures. Use Skills only when Loop Discovery selected them; do not create one universal issue-solving Skill. |
| Tools / Access | Repository search, source control, isolated worktree, build/test tools, issue or review access, profilers, scanners, and provider CLI or connector as the target requires. |
| Artifact | Scoped patch, tests, docs, migration, benchmark, release candidate, draft pull request, investigation report, or explicit blocked handoff. |
| Verifier | Original reproduction, acceptance checks, targeted tests, diff-scope review, security or performance checks, and independent review where risk warrants it. |
| State | Objective, acceptance checklist, plan, worktree or branch, attempts, validation results, budget, linked issue/review objects, and unresolved decisions. |
| Stop Rule | Stop on verified completion; pause on required product or risk decision; stop on exhausted budget, explicit cancellation, or repeated attempts without new evidence. |

## Flow

1. Restate the objective, acceptance criteria, non-goals, authority, and risk.
2. Inspect enough current evidence to reproduce or bound the requested change.
3. Select the smallest procedure owner and isolate writes when parallel or
   background work could collide.
4. Make one scoped change or investigation pass.
5. Run the predeclared verifier; do not substitute the executor's summary.
6. Retry only with a new hypothesis or new evidence.
7. Leave a reviewable artifact and update the external object only when that
   write is authorized.

## Procedure Shapes

These names are examples of reusable capabilities, not proof of installed
Skills:

| Stage | Candidate procedure shapes | Expected evidence |
| --- | --- | --- |
| Understand | `issue-understanding`, `requirements-clarification` | Reproduction, acceptance criteria, constraints, and open decisions |
| Execute | `bug-fix`, `feature-implementation`, `docs-sync`, `dependency-upgrade`, `code-migration` | Scoped changes tied to the approved objective |
| Verify | `test-verifier`, `diff-scope-checker`, `security-verifier`, `performance-verifier` | Commands, results, comparison, and residual risk |
| Deliver | `pull-request-preparation`, `release-preparation`, `issue-status-update` | Reviewable handoff with artifact references and status |

## Scenario Sketches

- **Issue refinement**: turn a vague bug or feature into scope, acceptance
  criteria, validation, and a clarification boundary before implementation.
- **Static feedback repair**: fix the highest-signal compiler, typecheck, lint,
  or analyzer failure first; rerun the same command before broader checks.
- **Runtime debugging**: reproduce from logs, stack traces, responses, or
  screenshots; stop when access, credentials, or product decisions block proof.
- **Review follow-up**: group review comments by root cause, resolve every valid
  item, and leave an accept, explain, defer, or blocked decision for each.
- **Docs sync**: update only documentation affected by visible API, CLI,
  configuration, schema, example, or user-behavior changes.
- **Dependency or security repair**: bound the upgrade set, migration, advisory,
  rollback, and required build, test, or scan evidence.
- **Release preparation**: verify version, changelog, required changes, tests,
  docs, and package contents before producing a release candidate.

## Compact Example

```md
# Agent-Ready Bug Goal

When: A confirmed issue is approved for implementation with reproduction steps
and acceptance criteria.

See: Current issue state, reproduction output, relevant code and tests, recent
related diff, permissions, and linked review state.

Do: Work in an isolated checkout when needed, reproduce first, make the
smallest fix, add regression coverage when behavior was wrong, and prepare a
draft handoff. Do not broaden the change from topic similarity.

Check: Rerun the original reproduction and targeted tests; inspect the diff
against every acceptance criterion and the approved scope.

Stop: Stop on verified completion. Stop or pause on missing product decisions,
unavailable access, risk beyond scope, exhausted budget, or two attempts
without new evidence.

Leave: Patch, changed-file list, validation commands and results, draft review
reference when authorized, and residual risk.
```

## Boundaries

- Event response owns validation and routing of the incoming event; this pattern
  owns sustained work toward the approved result.
- Scheduled inspection and proactive discovery may nominate work, but they do
  not grant mutation authority.
- External writes, release, deployment, security-sensitive changes, and broad
  migrations require the selected owner and human gate.
- Use [Loop Primitives](../loop-primitives.md) for worktree, subagent, connector,
  and state support; use [Loop Spec Card](../loop-spec-card.md) for the canonical
  card syntax.

Return to the [pattern index](README.md) or
[Loop Discovery](../loop-discovery.md) when the objective or owner is not yet
proven.
