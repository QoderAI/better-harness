---
name: change-traceability-review
description: Use for change traceability review across specs, commits, PRs, branches, local diffs, and git history, including Spec Preparation,
  Review Readiness Checks, and Review Retrospectives, to generate or verify Story-linked specs, commit-message evidence,
  test evidence, risk signals, AI involvement, and review-flow improvement suggestions.
---

# Change Traceability Review

Review the traceability behind a change, not code style: Story or issue -> Spec
-> plan/tasks -> commit/branch/PR -> diff -> tests -> risk. Default to Chinese
and keep the report compact and decision-oriented. Treat specs as the review
source of truth; code is acceptable when it clearly serves the spec.

## Modes

- **Spec Preparation**: before implementation or commit, create or tighten a
  Story-linked spec and define acceptance scenarios, plan/tasks, tests, and risk
  evidence that later commits can cite. Load [Spec Contract](references/spec-contract.md).
- **Review Readiness Check**: inspect the current diff, staged diff, PR text,
  branch, or selected commits before review/merge. Load [Mode Rules](references/mode-rules.md)
  and [Reporting](references/reporting.md).
- **Review Retrospective**: inspect recent history, usually latest 30 commits.
  Identify commit-message habits, weak traceability, missing Spec/Test/Risk
  evidence, oversized or mixed-scope commits, spec-doc patterns, and rework
  signals. Load [Mode Rules](references/mode-rules.md) and [Reporting](references/reporting.md).

## Entry and Routing

1. Identify the mode from the user's request or the current review surface.
2. Read repo instructions first: nearest `AGENTS.md`, plugin manifests, and the
   target spec or diff.
3. Gather bounded local evidence using [Evidence Commands](references/evidence-commands.md).
4. Apply the relevant contract:
   - Spec Preparation: [Spec Contract](references/spec-contract.md)
   - Commits: [Commit Contract](references/commit-contract.md)
   - Any review: [Mode Rules](references/mode-rules.md)
5. Produce the report using [Reporting](references/reporting.md).

Keep generated helpers and local experiments outside `SKILL.md` unless they are
durable resources the skill must use.
