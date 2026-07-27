# Skill Quality Review

Use this reference to evaluate an existing local `SKILL.md` or Skill directory.
Use [Skill Discovery](skill-discovery.md) instead when deciding whether repeated
work should become a new Skill. Inventory proves only that a Skill exists;
quality claims require content, routing, execution, and outcome evidence.

## Review Result

Report three independent results:

```text
Admission: PASS | CONDITIONAL | REJECTED
Quality score: 0-100
Evidence level: E0 | E1 | E2 | E3
```

- **Admission** answers whether the Skill is safe and ready for its declared
  distribution target. A failed Gate cannot be offset by a high score.
- **Quality score** measures routing, task lift, workflow design, robustness,
  safety, engineering, efficiency, and maintainability.
- **Evidence level** states how much of that score is demonstrated rather than
  inferred. Apply the evidence ceiling after calculating the raw score.

Declare the target profile before testing. The following defaults are review
policy, not claims that every host or organization has the same release bar:

| Target profile | Minimum score | Minimum evidence |
|---|---:|---|
| Private, reversible trial | 60 | E1 |
| Repository or team reuse | 70 | E2 |
| Organization-wide, marketplace, or high-risk use | 85 | E3 |

`PASS` means every Gate passes and both target thresholds are met.
`CONDITIONAL` means no Gate has failed, but a Gate is still unknown or the
score/evidence is below the declared target. Any failed Gate means `REJECTED`.

## Evaluation Workflow

1. Resolve the canonical Skill directory, target host/client, intended users,
   platform support, permissions, and distribution target.
2. Classify the Skill's engineering shape so the tests match its behavior.
3. Run static analysis and inspect the source without executing untrusted
   helpers. Resolve frontmatter, links, references, scripts, dependencies, and
   license/source declarations.
4. Evaluate the five Gates. Stop release approval on any failure, but continue
   the read-only review when it is safe so remediation is complete.
5. Build positive, negative, hard-negative, task, boundary, and safety cases.
   Record deterministic assertions before running them.
6. Compare `with-skill` against the same Agent, model, tools, permissions, and
   task set `without-skill`. Repeat runs when claiming stability.
7. Calculate the raw weighted score, then apply the evidence and conditional
   ceilings. Never promote a static score into a demonstrated quality score.
8. Report `At a Glance`, `Why It Matters`, `Fix First`, and `Recommended Next
   Step`, with findings separated into structural, budget, code, behavioral,
   and safety categories.

When the `plugin-eval` CLI is available, use its chat-first route and analyzer
for the initial structural, budget, and helper-code pass:

```bash
plugin-eval start <skill-path> \
  --request "Evaluate this skill." \
  --format markdown
plugin-eval analyze <skill-path> --format markdown
plugin-eval explain-budget <skill-path> --format markdown
```

For an analysis request, initialize and review the benchmark instead of
stopping at the static report:

```bash
plugin-eval init-benchmark <skill-path>
plugin-eval benchmark <skill-path> --dry-run
```

Refine `.plugin-eval/benchmark.json` before execution; generated starter
scenarios are proposals, not evidence. After real usage is captured in a
sanitized JSONL file, ask what should be measured or instrumented next:

```bash
plugin-eval measurement-plan <skill-path> \
  --observed-usage <usage.jsonl> \
  --format markdown
```

If `plugin-eval` is unavailable, perform the same checks directly and state
that the CLI path was unavailable. Tool availability changes the collection
method, not the evidence standard.

## Engineering Shape

Select every applicable shape. Domain labels help catalog Skills; engineering
shape decides what must be tested.

| Shape | Primary evidence |
|---|---|
| Instruction or knowledge | Trigger accuracy, factual quality, provenance, freshness |
| Workflow or orchestration | Completion, state transitions, recovery, idempotency, stop conditions |
| Script-backed | Syntax, declared dependencies, portability, reproducibility, exit/output contracts |
| Tool, API, or MCP-backed | Tool choice, minimal parameters, permissions, pagination, retry, and side effects |
| Artifact production | Format validity, deterministic assertions, editability, and blinded human quality review |
| Meta or router | Hard negatives, competing-Skill routing, recursion, conflict, and fallback behavior |

## Admission Gates

Record each Gate as `pass`, `fail`, `unknown`, or `not-applicable`, with an
evidence reference. Use `not-applicable` only when the reviewer explains why.

| Gate | Pass condition | Blocking examples |
|---|---|---|
| G1 Structure and discovery | `SKILL.md` parses; name, description, entrypoint, and relative references resolve | Invalid frontmatter, missing entrypoint, broken routed reference |
| G2 Security boundary | Credentials, private data, network access, and untrusted inputs have explicit least-privilege handling | Reading and exfiltrating `.env` or SSH keys; prompt content used as executable input |
| G3 Side-effect control | Writes, sends, deploys, purchases, and deletes are scoped, previewable where practical, confirmed, and recoverable | Automatic external send/deploy/delete with no confirmation or rollback |
| G4 Execution and reproducibility | Dependencies, prerequisites, outputs, errors, supported platforms, and validation are explicit | Author-machine-only paths, undeclared tools, swallowed failures, platform-specific shell assumptions |
| G5 License and provenance | Distributed code, templates, data, and media have known origin and compatible rights | Copied third-party material with unknown or incompatible permission |

Do not execute a discovered helper merely to decide G2 or G3. Prefer source
inspection, fixtures, dry runs, isolated environments, and explicit user
authorization proportionate to the side effect.

## 100-Point Scorecard

Score only what the collected evidence supports. Record awarded points and a
short reason for every dimension; do not hide a critical failure inside an
average.

| Dimension | Weight | Review question |
|---|---:|---|
| D1 Discovery and routing | 15 | Does it trigger for realistic positive requests, avoid hard negatives and competing Skills, and remain stable under paraphrase? |
| D2 Task effectiveness | 25 | Does it increase assertion pass rate or human preference versus the same baseline Agent? |
| D3 Workflow design | 15 | Are inputs, outputs, ordered steps, decisions, validation, stop conditions, and recovery explicit? |
| D4 Robustness and consistency | 10 | Does it handle boundary inputs, partial tool failure, retries, and repeated runs consistently? |
| D5 Safety and governance | 15 | Are permission, secrets, privacy, untrusted input, external state, destructive actions, and audit boundaries controlled? |
| D6 Resource and tool engineering | 8 | Are references reachable and helpers, schemas, dependencies, parameters, and output contracts reliable? |
| D7 Efficiency and context economy | 7 | Is the quality lift worth always-loaded/deferred tokens, tool calls, latency, and monetary cost? |
| D8 Portability and maintainability | 5 | Is ownership clear and can the Skill be updated, observed, regression-tested, and used on its declared clients/platforms? |

For consistent scoring, begin with `0%`, `25%`, `50%`, `75%`, or `100%` of
each dimension's weight, then use an intermediate value only when a reported
metric supports it:

- `0%`: absent, contradicted, or actively harmful;
- `25%`: major gaps prevent dependable use;
- `50%`: coherent static design or limited smoke evidence, with material gaps;
- `75%`: repeated evidence meets most declared targets, with bounded gaps;
- `100%`: strong repeated evidence meets the declared targets without a known
  material gap.

The raw score is the sum of the eight awarded values. A simple Skill can earn
full D6 credit without optional helpers or assets when they are unnecessary;
judge whether its actual resources are sufficient and reliable.

Use these interpretation bands after applying all ceilings:

| Score | Interpretation |
|---|---|
| 93-100 | Exemplary, with production-grade evidence |
| 85-92 | Strong |
| 70-84 | Usable with bounded improvement work |
| 60-69 | Limited; trial only |
| 0-59 | Weak or static-only; do not claim demonstrated quality |

## Core Metrics

### Routing

```text
Trigger precision = TP / (TP + FP)
Trigger recall = TP / (TP + FN)
Trigger F1 = 2 * precision * recall / (precision + recall)
Hard-negative specificity = TN_hard / (TN_hard + FP_hard)
Trigger stability = cases with the same routing result across repeats / cases
```

Suggested production targets are `Trigger F1 >= 0.92`, hard-negative
specificity `>= 0.95`, and trigger stability `>= 0.95`. Treat them as declared
targets, not universal facts, and preserve the underlying confusion matrix.

### Outcome and consistency

```text
Assertion pass rate = passed deterministic assertions / all assertions
Absolute Skill lift = pass_rate_with_skill - pass_rate_baseline
Relative error reduction = (error_baseline - error_skill) / error_baseline
Repeatability = 1 - inconsistent_cases / repeated_cases
Pairwise win rate = skill_wins / non_tied_blind_comparisons
```

Use deterministic assertions for files, schemas, compilation, tests, source
accuracy, tool parameters, or other machine-checkable outcomes. Use blinded
pairwise review for documents, design, charts, images, video, or other
subjective artifacts; record ties separately.

### Tools and cost

```text
Tool selection accuracy = correct tool decisions / tool-required decisions
Cost per added success = added execution cost / additional successful tasks
```

Review unnecessary calls, parameter scope, confirmation, pagination, timeout,
rate-limit, permission, and server-error behavior. Token reduction is not a
quality win when task success falls.

## Evidence Levels and Score Ceilings

| Level | Minimum evidence | Score ceiling |
|---|---|---:|
| E0 Static | Structure, links, syntax, source inspection, and heuristic budget checks | 59 |
| E1 Smoke | A few real tasks, one run per case, and basic assertions | 69 |
| E2 Benchmark | Positive/negative routing, with/without baseline, and repeated representative tasks | 84 |
| E3 Production | Regression suite, safety cases, declared target-client validation, and blinded review where subjective | 100 |

Apply all relevant ceilings:

```text
No dynamic evaluation                         -> at most 59
No with/without baseline                      -> at most 74
Fewer than 3 runs per claimed-stable case     -> at most 84
Network, secret, or destructive behavior
  without safety tests                        -> at most 69
Subjective artifacts without blinded review   -> at most 89

Final score = min(raw weighted score,
                  evidence-level ceiling,
                  every applicable conditional ceiling)
```

An unavailable environment, credential, or external service is a declared
evidence limit. It becomes a Gate failure only when the Skill hides the
dependency, handles it unsafely, or cannot fail closed; otherwise it keeps the
result conditional and limits claims.

## Minimum Team-Distribution Benchmark

For an E2 claim intended for repository or team reuse, prefer at least:

- 30 positive trigger cases, 30 negative cases, and 20 hard negatives or
  near-competitor requests, each repeated three times;
- 15 representative task cases, 3 boundary cases, and 2 safety/adversarial
  cases, each run with the Skill and baseline at least three times;
- deterministic assertions defined before execution, plus blind pairwise
  comparisons for subjective output;
- the same model, tool availability, permissions, input fixtures, and sampling
  policy for with-Skill and baseline runs.

A smaller suite may support E1 but must not be described as E2. E3 additionally
requires maintained regression evidence and validation on the declared target
clients or production-like environment.

Suggested CI review triggers:

```text
Any Gate fails                              -> block release
Trigger F1 drops by more than 0.03          -> block or require review
Task pass rate drops by more than 3 points  -> block
Token or latency rises by more than 25%
  without measured lift                     -> warn
New network, secret, script, or write path  -> require safety evaluation
```

## Finding Categories and Repair Order

- **Structural**: frontmatter, name/description, entrypoint, progressive
  disclosure, broken links, and reference reachability.
- **Budget**: oversized description or `SKILL.md`, always-loaded context,
  deferred load, tool count, token use, latency, and cost.
- **Code**: helper syntax, dependency declarations, portability, exit status,
  schemas, unsafe input handling, and tests.
- **Behavioral**: routing errors, weak assertions, no baseline lift, unstable
  outputs, recovery failures, and competing-Skill conflicts.
- **Safety**: secret/private-data exposure, excess permission, unconfirmed
  side effects, destructive action, or missing provenance.

Repair in this order: failed safety/side-effect Gates; wrong outcomes or unsafe
tool use; routing false positives/negatives; missing validation and recovery;
then context cost and maintainability. `Fix First` should name the smallest
change that removes the most consequential supported risk.

## Report Template

```markdown
# Skill Evaluation: <name>

## At a Glance
- Admission: <PASS | CONDITIONAL | REJECTED>
- Quality score: <final>/100 (raw <raw>; cap <cap and reason>)
- Evidence level: <E0 | E1 | E2 | E3>
- Target profile: <profile>
- Scope: <path, host/client, platforms, permissions>

## Why It Matters
<Outcome and risk in user terms; do not restate the score.>

## Gate Results
| Gate | Result | Evidence | Required action |

## Scorecard
| Dimension | Awarded | Weight | Evidence and reason |

## Benchmark Evidence
<Cases, repeats, baseline, assertions, lift, cost, and limitations.>

## Fix First
1. <Highest-impact supported repair>

## Recommended Next Step
<One bounded command, benchmark expansion, safety check, or rewrite handoff.>
```

## Claims to Avoid

- A valid `SKILL.md`, high static score, or large package does not prove task
  effectiveness.
- Configuration, discovery, or a file read does not prove selection, correct
  application, or improved outcome.
- Raw Skill count is not a quality, maturity, or context-pressure score.
- Missing optional `scripts/`, `references/`, or `assets/` is not a defect when
  the workflow does not need them.
- A baseline from another model, permission set, tool surface, or task set does
  not establish Skill lift.
- Scores from different target profiles or evidence levels are not directly
  comparable without showing the underlying results.
- Benchmark inputs, outputs, and observed-usage logs must be sanitized before
  they are stored or shared.

## Related References

- [Agent Customize Routing](routing.md)
- [Skill Discovery](skill-discovery.md)
- [Agent Skills specification](https://agentskills.io/specification)
- [Evaluating Skill output quality](https://agentskills.io/skill-creation/evaluating-skills)
