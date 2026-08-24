# Skill evaluation execution

## Traceability

- Spec ID: skill-evaluation-execution
- Status: Implemented

## Intent

Add a project-local execution protocol for evaluating the Better Harness Skill.
The protocol should combine the repository's Agent Customize evidence boundary
with Plugin Eval's deterministic JSON result, static budget analysis, and
benchmark workflow without presenting static checks as demonstrated task lift.

## Acceptance Scenarios

- AC-1: `references/agent-customize/skill-eval.md` defines the canonical command
  sequence for target resolution, Better Harness static checks, Plugin Eval
  analysis, benchmark preparation, and final evidence normalization.
- AC-2: Agent Customize routes existing-Skill evaluation requests to
  `skill-eval.md`, while `skill-review.md` remains the owner of Gates, D1-D8,
  and E0-E3 ceilings.
- AC-3: The execution protocol treats Plugin Eval JSON as its machine source of
  truth, labels static budgets as estimates, and prevents static results from
  exceeding E0.
- AC-4: The protocol matches the installed Plugin Eval script contract: starter
  benchmark scenarios are inspected before a real Codex run, and no unsupported
  dry-run command is prescribed.
- AC-5: The Better Harness Skill is evaluated with the documented static route;
  generated benchmark configuration is kept local-only, and the reported result
  distinguishes observed output from unrun dynamic evidence.
- AC-6: Focused Skill-routing and documentation-link tests pass, and the
  generated Better Harness documentation graph is current.

## Non-goals

- Implement a second scoring engine or copy Plugin Eval into this repository.
- Put Skill evaluation fields into ordinary Agent Customize coverage rows.
- Claim E1-E3, task lift, repeatability, or production safety from a static run.
- Execute generic generated benchmark scenarios as if they were project
  acceptance cases.

## Plan and Tasks

1. Add the execution protocol beside the existing Agent Customize Skill rubric.
2. Route Agent Customize and existing-Skill evaluation requests to the new
   protocol, preserving the separate rubric owner.
3. Add focused assertions for routing, evidence boundaries, and the current
   benchmark contract.
4. Regenerate the documentation graph and run the static evaluation against
   `skills/better-harness`.

## Test and Review Evidence

- AC-1..AC-4: `node --test test/better-harness-skill.test.mjs`
- AC-2, AC-6: `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`
- AC-3, AC-5: run `agent-lint` with `agent-assets-review`, then run Plugin Eval
  `start`, `analyze`, `explain-budget`, and `init-benchmark` against
  `skills/better-harness`.
- Risk: Plugin Eval is an optional external CLI. Record the resolved version and
  entrypoint; if unavailable, keep the result partial instead of inventing it.
- Risk: `benchmark` performs real Codex executions. Do not run generated starter
  scenarios until workspace, prompts, verifiers, permissions, and stop
  conditions have been reviewed.

Implemented evidence:

- `agent-lint` reported one entrypoint, five resolved references, and zero
  findings for `skills/better-harness`.
- Plugin Eval produced a static 58/D/high result with estimated budgets of 70
  trigger, 2,994 invoke, and 12,391 deferred tokens. Its broken-link check cited
  the conceptual `<renderer-path>` placeholder; the repository link resolver
  passed, so the raw check is retained but not promoted as a confirmed defect.
- Plugin Eval initialized three starter scenarios and explicitly reported that
  the current benchmark runner has no simulated dry-run. The generic scenarios
  had no project verifiers and were not executed as dynamic evidence.
- Focused Skill and documentation tests passed 19/19. Package verification
  passed with 403 npm entries and 425 runtime ZIP entries.
