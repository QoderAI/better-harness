# Session Evidence

Use only the provider-labelled `session-core-facts` envelopes supplied by the
lead. Reconstruct recent work, expose repeated workflows and friction, and
return independent finding candidates. The lead owns joins, deduplication,
severity, scores, recommendations, and report copy.

## Boundary

- Do not run analyzers, open raw sessions/events, inspect project files, read
  another agent's brief, or delegate.
- Keep Qoder, Codex, and other providers separate. Combine them only when the
  lead explicitly asks for a project-wide view, and retain provider labels.
- Reject envelopes containing `facts --debug`; debug data contains private ids.
- Treat an explicitly supplied historical digest as an architecture/history
  lead only. Never assume a conventional path or scan for one. It cannot prove
  current behavior.
- Exclude raw prompts, private ids/paths, secrets, payload dumps, and complete
  assistant prose. Configured assets and project capabilities are unobserved.
- Stay within the supplied 7- or 30-day window and Episode limit. Missing facts
  are unavailable evidence, not zero activity.

## Reconstruct Task Episodes

A Task Episode is one user goal with one observable acceptance boundary.
Merge refinements of the same goal and split unrelated goals even when they
share a session. Keep only enough typed evidence to bind goal, action, change,
check, handoff, and result.

Use the facts conservatively:

- request summaries describe user intent; repeated turns or occurrences inside
  one Episode are not repeated-work evidence;
- `workTrace` preserves order only and cannot reveal hidden reasoning;
- a change, check, handoff, completion marker, or assistant statement alone
  does not prove acceptance or delivery;
- only a reviewed check relevant to the final change closes validation;
- direct feedback, provider-confirmed delivery/recovery, or relevant validation
  can support an outcome; otherwise keep it a lead or unobserved;
- warnings, omissions, coverage counts, and diagnostic flags only bound scope;
  they do not identify a defect or cause.

Attribute friction to `Harness`, `Repository`, `Model`, `Requirement`,
`External`, `Task complexity`, or `Unknown`. Use `Harness` only when an observed
mechanism leads through behavior to a consequence.

## What to Look For

Prioritize decision-relevant patterns, especially when the Step 1 asset profile
reports no project Skills:

For repeated-workflow analysis, read
[Repeated Workflow Discovery](session-repeated-workflows.md). First cluster
only `requestRoots`; these include bounded first prompts that may not have
material Episode activity. Expand `intermediate`, `followUp`, `workTrace`,
checks, repair, and result facts only through a matching `candidateRef` and only
for a cluster supported by at least two distinct comparable Task Episodes.
When `omitted.requestRootBudget` is non-zero, state that the root scan is
incomplete. A root without `candidateRef` can support only a goal-level lead.

1. A stable repeated workflow across at least two distinct comparable Task
   Episodes. Separate repeatable procedures with steps and validation gates
   (procedure demand) from short decisions, corrections, traps, or preferences
   (knowledge demand). Do not recommend creating either; expose the evidence
   need for the lead to compare with existing asset coverage.
2. Repeated validation behavior around tests, lint, build, review, regression,
   failure/rerun, delivery, or rollback. Repetition does not prove the loop is
   effective without a later accepted outcome.
3. Repeated bug work that needs a browser reproduction or a correlated backend
   diagnosis. Keep frontend/backend selection unresolved until Project Evidence
   identifies the actual route.
4. Consequential one-offs where a control, permission, missing diagnostic,
   correction, or failed recovery materially changed the task.
5. Provider or selection blind spots that prevent a named project decision.

For Memory value, positive Learning Capture evidence requires the full chain:
`exists -> retrieved -> relevant -> applied -> later outcome improved`, without
guardrail regression.

## Return

Write a compact Markdown brief in the user's language. Include:

- scope, provider/window coverage, material omissions, and confidence;
- up to three representative Task Episodes;
- the strongest repeated workflows, validation loops, friction, and boundaries;
- supported procedure-demand and knowledge-demand leads, including the
  repeated Episodes and the missing reusable behavior or knowledge;
- normally three to five potential findings, or up to three in quick mode.

Express potential findings naturally; no fixed fields or JSON schema are
required. Each must make its evidence and uncertainty understandable. Return
fewer when evidence is weak and never fill a quota. Do not assign final
severity, score, repair, or recommendation. End with the claims the lead must
not make from this evidence.
