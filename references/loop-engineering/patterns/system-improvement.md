# System Improvement Pattern

Use this pattern when the target of change is the agent or harness itself:
prompting, Skill guidance, tool routing, graders, retry/stop policy, evaluation,
cost, or observability. Product work can be an inner goal-completion loop, but
this outer loop asks whether a versioned system change improves later outcomes.

## Composition

| Slot | Contract |
| --- | --- |
| Trigger | Failed or stalled agent run, repeated human rework, tool-routing error, grader disagreement, cost/latency anomaly, regression, or bounded periodic trace review. |
| Procedure Owner | Trace or failure analysis, eval-case construction, procedure refinement, routing calibration, stall detection, grader calibration, or controlled comparison. Use a Skill only when selected as the durable procedure owner. |
| Tools / Access | Sanitized traces and run logs, review evidence, eval runner, regression suite, holdout data, version control, token/latency records, and provider observability or connector. |
| Artifact | Failure taxonomy, reproducible eval case, versioned prompt/Skill/tool/grader change, comparison report, improvement review, or rollback decision. |
| Verifier | Baseline and candidate comparison on predeclared primary metric plus guardrails, holdout or later comparable tasks, regression checks, cost per success, and human calibration where judgment matters. |
| State | Baseline version, candidate version, dataset and selection version, experiment window, metrics, guardrails, review decision, release or rollback state, and unresolved causes. |
| Stop Rule | Adopt only when the declared improvement clears its threshold without guardrail regression; otherwise retain, revise, or roll back. Stop with insufficient evidence rather than claiming effectiveness. |

## Flow

1. Bound the trace, review, or evaluation window and sanitize sensitive data.
2. Separate observed failures from hypotheses and cluster only comparable runs.
3. Convert a production or review failure into a stable eval or regression case
   before optimizing against it.
4. Version the baseline, candidate, data selection, primary metric, guardrails,
   and stop/revert condition.
5. Change one owned surface or a clearly declared bundle.
6. Compare against holdout or a fair later window; inspect regressions and cost,
   not only the target metric.
7. Route the change through review, then adopt, retain for more evidence, or
   roll back. Continue monitoring after adoption.

## Improvement Targets

| Target | Candidate procedure shape | Useful check |
| --- | --- | --- |
| Failure understanding | `trace-failure-analyzer`, `review-feedback-miner` | Classification explains inspected failures and preserves unknowns. |
| Evaluation coverage | `eval-case-builder`, `regression-suite-curator` | The case reproduces the original failure and remains stable. |
| Procedure quality | `skill-refiner`, prompt or reference refinement | Comparable task success improves without new omissions. |
| Tool selection | `tool-routing-optimizer` | Invalid or wasteful tool calls fall without reducing success. |
| Loop control | `loop-stall-detector`, retry/stop calibration | Attempts, latency, or cost fall without hiding failures. |
| Grading | `grader-calibration`, `skill-ab-evaluator` | Automated judgment aligns better with held-out human review. |

Candidate names describe capability shapes; they are not an installed-Skill
inventory.

## Scenario Sketches

- **Self-improving procedure**: repeated instructions or mistakes become a
  bounded trigger, reusable procedure, validation, stop rule, and owner; a
  current-task success is readiness evidence, not later effectiveness.
- **Production failure to eval**: preserve the smallest sanitized inputs that
  reproduce the failure and add the case before changing the system.
- **Review rework mining**: group explicit human feedback by root cause and
  compare later rework on a declared cohort.
- **Grader calibration**: compare grader and human decisions on a held-out set;
  document disagreements instead of tuning only to the reviewed sample.
- **Cost or stall control**: optimize cost per successful outcome and keep
  success, safety, and quality guardrails visible.

## Compact Example

```md
# Issue-Triage Procedure Improvement

When: A bounded sample shows repeated false positives or missed actionable
issues from the current triage procedure.

See: Versioned procedure, sanitized labeled examples, actual decisions,
reviewer corrections, baseline metrics, and existing eval coverage.

Do: Add stable regression cases, change one owned procedure or rubric, and run
a predeclared comparison. Do not tune against private raw traces or the test set
alone.

Check: Precision and recall on holdout or a fair later cohort improve while
noise, safety, and cost guardrails do not regress.

Stop: Adopt after threshold and review evidence pass; otherwise keep the
baseline, revise the candidate, or stop with insufficient evidence.

Leave: Baseline and candidate versions, dataset/selection version, metrics,
guardrails, review decision, and rollback reference.
```

## Effectiveness Boundary

[Learning Loop Detection Patterns](../learning-loop-patterns.md) may produce
Opportunity or Readiness candidates from bounded episodes. Only the existing
Learning Capture intervention-ledger contract can support an effectiveness
claim from a comparable later or held-out result without guardrail regression.
This pattern must not create a second effectiveness ledger or call the current
task's tests proof of future improvement.

Use [Goal Completion](goal-completion.md) for the inner versioned change and
[Loop State Ledger](../loop-state-ledger.md) only for the smallest replayable
experiment state. Return to the [pattern index](README.md) or
[Loop Discovery](../loop-discovery.md) when the intervention owner is unclear.
