# Demand Source Analysis Reference

Use this before `loop-discovery.md` when the input is a raw demand source,
session signal, report row, repository entropy hint, or repeated-work suspicion.
This reference turns loose demand into a bounded evidence pack. It does not
choose the durable owner, create a Skill, wire automation, mine broad sessions,
or render report output.

## Core Rule

Demand is not a loop. A source becomes a loop candidate only after the agent can
name the target, scope, repeated or costly intent, observed/configured boundary,
existing coverage, stable input, missing proof, and risk boundary.

Use `needs more evidence` when the source cannot be reduced to one candidate
demand. Do not promote from file age, line count, churn, keyword hits, global
counters, loaded Skill text, static asset presence, or a single vague complaint.

## Triage Workflow

1. **Pin the target**: name the repository, path, report row, workflow, issue,
   PR, session set, external object, or user-provided artifact.
2. **Bound the source window**: name the dates, session limit, report run,
   commit range, CI window, or user-provided note set. If there is no bound,
   say so and lower confidence.
3. **Classify source families** using the table below. Use `mixed` only after
   naming the primary source and the supporting source.
4. **Separate evidence layers**:
   - configured presence: files, settings, Skills, hooks, commands, CI, specs
   - observed behavior: session events, command output, reports, CI/review
     records, opened external data
   - local entropy: drift, pressure, or missing validation that may explain
     repeated work
   - user intent: explicit request, correction, priority, or acceptance signal
5. **Collapse duplicates**: merge variants only when the same trigger, input,
   procedure, output, and validation would handle them.
6. **Check existing coverage** before calling the demand uncovered. Observed
   Skill, hook, script, command, CI, or automation use usually means the next
   question is extension, repair, validation, or scheduling, not creation.
7. **Rate demand strength** with the ladder below.
8. **Write the evidence pack** and hand it to `loop-discovery.md`, or stop with
   `needs more evidence` and the exact missing proof.

## Source Families

| Source | Strong signal | Check before promotion | Evidence refs |
| --- | --- | --- | --- |
| User repetition | Similar asks, corrections, follow-ups, or explicit "do this every time" language recur | Is the repeated ask the same workflow, or only the same topic? | prompt ids, provided notes, issue text, review comments |
| Costly single demand | One setup, release, migration, security, or review task is expensive or high-risk enough to recur | Is future recurrence likely and bounded, or just speculative? | user statement, incident note, release checklist, risk record |
| Session behavior | `actionCandidates`, `planningSignals`, active long sessions, repeated validation gaps, observed hook/tool failures, or repeated repair loops | Are sessions workspace-scoped and active, not wall-span-only or global noise? | `sources`, `facets`, `insights`, bounded `show` samples |
| Report rows | Repeated findings, low-readiness patterns, schedule handoffs, missing validation, or repeated owner gaps appear in artifacts | Is the report row evidence-backed, or a projection/caveat? | report path, finding id, source JSON, quality check |
| Repo-local entropy | Documentation drift, dependency drift, code shape pressure, validation entropy, guardrail drift, or sensitive-boundary drift clusters around a target | Is it a confirmed defect, or only maintenance pressure? | files, commands, diffs, scan output, validator output |
| Existing coverage friction | A Skill, hook, script, command, rule, CI job, or automation exists but agents repeatedly repair, reconfigure, explain, or bypass it | Is the surface observed in use, and what manual step remains? | asset path, invocation evidence, failure logs, repair diffs |
| External workflow | CI, review, issue, PR, tracker, deployment, incident, or MCP-backed evidence repeats around the same target | Was the external record actually opened or provided? | opened records, copied logs, CI output, review ids |
| Strategic demand | The user names a recurring maintenance, triage, onboarding, review, monitoring, or governance need | Does the user also provide a stable input, cadence, target, or acceptance signal? | explicit user statement plus proposed stable input |

## Demand Strength Ladder

Use one of these labels in the evidence pack:

- **Observed repeated**: two or more bounded observations share trigger, input,
  procedure, output, and validation shape.
- **Costly/high-risk**: one observed demand is expensive, sensitive, release
  critical, or likely to recur because the same target will be revisited.
- **Covered but manual**: an owner exists, but evidence shows repeated setup,
  repair, validation, context collection, handoff, or scheduling work.
- **Entropy-backed candidate**: local drift or pressure suggests recurrence,
  but observed repetition is missing or weak.
- **Weak**: one-off, broad, topic-only, sampled too narrowly, or missing stable
  input.
- **Unknown**: source boundary is unavailable, external evidence was not opened,
  or the target cannot be named.

Only the first three normally proceed to owner selection. `Entropy-backed
candidate` can proceed only when the missing proof is small and named. `Weak`
and `Unknown` stop with `needs more evidence`.

## Coverage Matrix

Before recommending any new durable surface, inspect enough coverage to avoid a
duplicate:

| Coverage surface | Counts as coverage when | Common next action |
| --- | --- | --- |
| Skill | The Skill exists and observed use covers the workflow | Extend instructions, validation, examples, or schedule handoff |
| Hook / rule | A lifecycle point can warn, block, log, or enforce the check | Tune deterministic guardrail, not a Skill |
| Script / command | A repeatable extraction, check, transform, or shortcut already exists | Improve script output, docs, or invocation path |
| Automation / schedule | A stable cadence or event already runs or is approved | Add triage, state, stop, or validation evidence |
| Custom agent / subagent | Specialist role isolation or maker/checker split is already used | Tighten role prompt or review checklist |
| MCP / connector | External access exists and the missing part is workflow judgment | Keep MCP as access; route workflow owner separately |
| CI / external policy | Checks run on protected events or review gates | Fix check coverage or reporting, not agent memory |
| Docs / specs / rules | The durable decision exists but agents miss or reinterpret it | Improve routing, trigger wording, or reference placement |

If coverage is configured but not observed, keep it as presence evidence. If
coverage is observed but incomplete, name the manual residue instead of saying
"no coverage."

## False Positive Patterns

Do not promote these directly:

- A popular file, large file, old file, or high-churn file without repeated
  demand or validation pain.
- Multiple prompts about the same area that require different triggers,
  procedures, or outputs.
- A loaded Skill, config file, hook setting, or plugin cache entry with no
  observed use.
- Wall-span-only long sessions, idle/resume artifacts, or sampled sessions
  treated as representative without proof.
- A report recommendation that lacks source JSON, finding id, validation
  command, or acceptance boundary.
- A global user-home pattern applied to the current workspace without matching
  workspace evidence.
- A sensitive or destructive workflow without a human gate, approval point, and
  risk boundary.
- A request to "make it proactive" without trigger, input, verification, state,
  and stop condition.

## Evidence Pack

Build the smallest pack that lets `loop-discovery.md` run its decision gate:

- **Target**: repository, path, report, workflow, issue, PR, session set, or
  external object.
- **Scope/window**: date range, session limit, report run, commit range, CI
  window, or user-provided note set.
- **Candidate demand**: one sentence naming the repeated or costly work.
- **Primary source family**: one of the source families above.
- **Supporting source family**: optional second source, or `none`.
- **Evidence refs**: exact files, commands, session ids, report rows, issue/PR
  ids, scan output, CI output, or user-provided notes.
- **Observed/configured boundary**: what actually happened versus what is only
  configured, present, inferred, or sampled.
- **Demand strength**: observed repeated, costly/high-risk, covered but manual,
  entropy-backed candidate, weak, or unknown.
- **Existing coverage**: Skills, hooks, scripts, commands, rules, agents, MCP,
  automation, CI, specs, docs, or plugins already covering the work.
- **Manual residue**: repeated setup, repair, validation, handoff, triage,
  context collection, approval, or scheduling that remains outside coverage.
- **Stable input**: the repeatable evidence or event a future run can start
  from.
- **Risk boundary**: files, credentials, external systems, approvals, or broad
  changes that need a human gate.
- **Missing proof**: the exact evidence needed before a durable owner can be
  selected.

Do not include raw transcript dumps, secrets, credentials, private prompts,
large logs, or global home activity that is not tied to the target workspace.

## Handoff Criteria

- Continue to `loop-discovery.md` when demand strength is observed repeated,
  costly/high-risk, covered but manual, or a narrowly bounded entropy-backed
  candidate.
- Continue to `../agent-customize/skill-discovery.md` only after Loop Discovery selects
  `Create Skill` or `Extend Skill`.
- Continue to `automation-readiness.md` only after Loop Discovery selects
  automation, `schedule-ready`, or scheduled/background follow-up.
- Continue to `loop-state-ledger.md` when the candidate may pause, resume,
  recur, run in the background, or compare results across runs.
- Stop with `needs more evidence` when stable input, observed recurrence,
  verification, stop condition, coverage boundary, or safety boundary is
  missing.

## Output

```markdown
### Demand source analysis
- **Target**: ...
- **Scope/window**: ...
- **Candidate demand**: ...
- **Primary source family**: ...
- **Supporting source family**: ...
- **Evidence refs**: ...
- **Observed/configured boundary**: ...
- **Demand strength**: observed repeated | costly/high-risk | covered but manual | entropy-backed candidate | weak | unknown
- **Existing coverage**: ...
- **Manual residue**: ...
- **Stable input**: ...
- **Risk boundary**: ...
- **Missing proof**: ...
- **Next gate**: loop-discovery.md | needs more evidence
```

Keep the output compact enough that Loop Discovery can consume it as an
evidence pack. Do not turn it into a second Loop Discovery report.
