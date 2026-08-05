# Skill Evaluation Execution

Use this reference to run an evaluation of an existing Skill. Load
[Skill Quality Review](skill-review.md) for the Gates, D1-D8 scorecard, target
profiles, and E0-E3 evidence ceilings. Use
[Skill Discovery](skill-discovery.md) instead when the question is whether to
create or extend a Skill.

This protocol joins two complementary sources:

- Better Harness `agent-lint` supplies repository-aware, explicit-target E0
  evidence for frontmatter, descriptions, routed references, size, and
  progressive disclosure.
- Plugin Eval supplies a deterministic local `evaluation-result` document for
  structure, estimated context budgets, helper-code checks, and benchmark
  preparation.

Neither source proves selection, task lift, repeatability, safety in use, or a
later improved outcome by itself.

## Resolve the Evaluation Envelope

Record these fields before running commands:

- canonical absolute Skill directory and `SKILL.md` entrypoint;
- target host/client, users, distribution profile, and supported platforms;
- requested mode: static analysis, benchmark preparation, or measured run;
- model, tools, permissions, workspace fixture, and allowed side effects;
- Better Harness commit and Plugin Eval version or resolved script entrypoint.

Use `plugin-eval` when it is on `PATH`. When the plugin is installed but the
command is not linked, invoke its shipped Node entrypoint as
`node <plugin-eval-root>/scripts/plugin-eval.js`. Do not commit a machine-local
plugin root. If neither entrypoint is available, mark Plugin Eval evidence
`unavailable` and continue only with the repository-local static checks.

In the commands below, `<plugin-eval>` means either resolved entrypoint.

## Stage 1: Collect Static E0 Evidence

From the Better Harness repository root, run the explicit Skill-target scan:

```text
node scripts/better-harness.mjs agent-lint --profile agent-assets-review --skill <skill-path> --json
```

Then use the Plugin Eval chat-first route and preserve JSON as the machine
source of truth:

```text
<plugin-eval> start <skill-path> --request "Evaluate this skill." --format markdown
<plugin-eval> analyze <skill-path> --format json --output <scratch>/evaluation-result.json
<plugin-eval> report <scratch>/evaluation-result.json --format markdown --output <scratch>/evaluation-report.md
<plugin-eval> explain-budget <skill-path> --format markdown --output <scratch>/budget-report.md
```

Classify every reported item as structural, budget, code, behavioral, or
safety. Plugin Eval's summary score is its own static engine output; do not
substitute it for Better Harness Admission, D1-D8 quality, or evidence level.
Apply the E0 ceiling of 59 to any combined quality statement until dynamic
evidence exists. Preserve `budgets.method`, because `estimated-static` and
`estimated-static-policy-aware` are estimates rather than host telemetry.

Reconcile cross-tool disagreements against the smallest owning evidence. For
example, retain a Plugin Eval broken-link check in its raw JSON, but do not
promote it as a confirmed defect when its evidence is a documented placeholder
and the repository link resolver proves all authored relative links resolve.
Record the check as rejected or deferred with the competing command evidence;
never edit the canonical Plugin Eval result to make the tools agree.

For the repository's own `skills/better-harness` target, also run:

```text
node --test test/better-harness-skill.test.mjs test/doc-link-graph.test.mjs
node scripts/doc-link-graph/cli.mjs skills/better-harness
npm run pack:verify
```

Run `npm test` when the requested confidence or change risk requires the full
repository gate. A package or test result supports G1, G4, D6, and D8 only; it
does not prove D1 routing accuracy or D2 task effectiveness.

## Stage 2: Prepare Dynamic Evidence

An analysis request should prepare the benchmark rather than stop at the static
report:

```text
<plugin-eval> init-benchmark <skill-path> --output <scratch>/benchmark.json --format markdown
```

Treat generated scenarios as editable proposals. Before any live run:

1. replace generic prompts with representative positive, negative,
   hard-negative, boundary, and safety cases;
2. point `workspace.sourcePath` at a disposable fixture or copy;
3. define observable outputs and executable verifiers before execution;
4. confirm the model, tools, permissions, approval policy, side effects, and
   stop conditions;
5. design a same-environment `without-skill` baseline and repeat policy when
   claiming lift or stability.

The current Plugin Eval benchmark command performs real Codex executions and
has no simulated dry-run mode. Inspect the generated configuration, then run
only when its cases and authority are ready:

```text
<plugin-eval> benchmark <skill-path> --config <scratch>/benchmark.json --usage-out <scratch>/usage.jsonl --result-out <scratch>/benchmark-result.json --format markdown
```

Keep generated `.plugin-eval/` runs and usage logs local unless their inputs and
outputs have been reviewed for secrets, private prompts, absolute home paths,
and stable session identifiers. A single starter run can support at most E1;
it cannot establish E2 without the benchmark and baseline requirements in
`skill-review.md`.

## Stage 3: Reconcile Observed Usage

When a sanitized usage log exists, feed it back into the same engine:

```text
<plugin-eval> analyze <skill-path> --observed-usage <scratch>/usage.jsonl --format json --output <scratch>/evaluation-with-usage.json
<plugin-eval> measurement-plan <skill-path> --observed-usage <scratch>/usage.jsonl --format markdown --output <scratch>/measurement-plan.md
```

Token telemetry calibrates cost estimates. It does not prove that the Skill was
selected correctly, applied to the task, or improved the accepted outcome.
Record those claims only from task-linked execution artifacts and verifiers.

## Normalize the Result

Lead with the four Plugin Eval reader sections, then report the independent
Better Harness results:

```markdown
## At a Glance
- Admission: PASS | CONDITIONAL | REJECTED
- Quality: <final>/100 (raw <raw>; cap <reason>)
- Evidence: E0 | E1 | E2 | E3
- Plugin Eval: <score>/<grade>; <risk>; <budget method>
- Scope: <skill, host, platform, permissions, commit>

## Why It Matters
<Observed outcome or bounded risk; do not restate scores.>

## Fix First
1. <Smallest supported repair with owner and verifier.>

## Recommended Next Step
<One command, benchmark addition, safety case, or evidence request.>

## Evidence Boundary
- Observed: <commands, artifacts, checks, task outcomes>
- Estimated: <static tokens, heuristic scores>
- Unobserved: <routing lift, baseline lift, repeatability, production outcome>
```

Keep Plugin Eval's JSON intact as an input artifact. Do not let a renderer,
coverage row, or prose summary recompute its score, and do not let extension
metrics overwrite its core summary. The Lead applies the separate Better
Harness Gates and evidence ceilings and owns the final reader-facing claim.

## Stop and Failure Conditions

- Broken entrypoint, unresolved local links, unsafe helper behavior, or an
  Admission Gate failure blocks release approval but not safe read-only review.
- Missing Plugin Eval, Codex CLI, credentials, or benchmark fixtures yields
  `unavailable` or `partial`; it is not silently converted to pass.
- Do not execute untrusted Skill helpers merely to gather static evidence.
- Do not run a live benchmark against a real worktree when a disposable copy is
  required or when generated scenarios have not been reviewed.
- Do not report E1-E3, lift, stability, or outcome improvement without the
  corresponding observed task evidence.

## Related References

- [Agent Customize Routing](routing.md)
- [Skill Quality Review](skill-review.md)
- [Skill Discovery](skill-discovery.md)
