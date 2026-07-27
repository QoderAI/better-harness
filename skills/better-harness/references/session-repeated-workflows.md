# Repeated Workflow Discovery

Use this reference when Session Evidence must decide whether recent requests
contain repeated procedure demand. It is semantic comparison, not a keyword
detector or a request to open raw sessions.

## Analysis Model

- A **session** is a transport container, not one workflow or several runs.
- A **Workflow Run** is one root goal plus its ordered follow-ups, work trace,
  checks, recovery, delivery, and acceptance boundary.
- A **root candidate** is a repeated goal and stable first-prompt input shape.
- A **workflow candidate** also repeats ordered stages and a stop boundary.

Keep `goalConfidence` separate from `procedureConfidence`. First prompts may
support high goal confidence while procedure confidence remains unknown.

## Phase 1: First-Prompt Pass

Read only each `requestRoots` entry's `request.summary`, `ref`, `contextGroup`,
optional `candidateRef`, and provider label. Treat the summary as the root of a
possible Workflow Run, not as proof of later actions or results.

Cluster roots semantically using all of these dimensions:

1. the user's underlying goal;
2. the target or artifact type;
3. the stable input shape, such as an issue, screenshot, log correlation id,
   failing test, or review link; and
4. the requested acceptance boundary, when one is stated.

Shared words, repositories, paths, product names, or generic verbs such as
fix, analyze, review, test, and submit are insufficient. Keep a cluster only
when at least two distinct comparable Task Episodes support it.

Count independence conservatively:

- prefer roots from different `contextGroup` values;
- `occurrences`, repeated turns, retries, or copied history count as one run;
- several Episodes in one context group do not establish independent demand;
- identical forked roots without independent later traces must be deferred;
- keep provider evidence separate unless the lead explicitly joins it.

If `omitted.requestRootBudget` is non-zero, set `scanStatus: incomplete` and
state that discovery covers only the emitted root portfolio. Never claim that
the full 7- or 30-day population was clustered. Bound the result to the three
strongest clusters and retain at most three representative root refs per cluster.

## Phase 2: Candidate Expansion

Only after a root cluster passes Phase 1, follow each available `candidateRef` to
inspect matching trace, checks, repair, result, and mechanism facts. Never expand
unrelated candidates. Without two linked candidates, keep procedure confidence unknown.

Normalize observed actions into stages such as intake, prepare, inspect,
reproduce, diagnose, approve, modify, verify, recover, deliver, and review.
Preserve their order. A follow-up such as "still wrong" or "submit it" has
meaning only relative to its root and is never a standalone workflow.

Call a stage **core** only when at least two independent runs support it. Keep
a one-run stage **optional**. Promote `level: goal` to `level: workflow` only
when at least two runs repeat both an ordered core and a verification or
stopping boundary. Missing trace or result evidence stays unknown.

## False-Positive Firewall

- Repeated commit, publish, or review requests alone are a thin delivery tail,
  not proof of the workflow that preceded them.
- Repeated user corrections show friction, but not necessarily a stable
  procedure or the correct reusable intervention.
- Explicit use of an existing Skill is coverage evidence. It is not evidence
  that another Skill should be created.
- A recurring log-inspection step may be a backend diagnosis component without
  proving a complete hotfix workflow.
- Missing checks, outcomes, or assets are unknown; absence in the supplied
  facts is not evidence that the practice is absent.

## Return Contract

Report `scanStatus: complete|incomplete`. For each retained lead, report `candidateId`, `level: goal|workflow`, normalized goal, stable input shape,
provider-labelled root refs, core and optional stages,
`goalConfidence`, `procedureConfidence`, evidence limits, next evidence to
inspect, and `decision: candidate|defer|reject`. Explain the semantic match in
plain language. Do not expose raw prompts, local paths, or Session ids.

Do not recommend `Create Skill` or `Extend Skill`. The lead must first join the
candidate with Project and Agent Customize evidence, compare existing asset
coverage, and route uncovered repeatable work through Loop Discovery.

## Calibration Examples

- Independent roots asking to repair visible UI defects from screenshots or
  symptoms can form a `frontend-ui-bug-repair` goal candidate. Only repeated
  reproduce -> modify -> verify -> deliver promotes it to workflow.
- Bug roots that repeat correlated log inspection support a backend diagnosis
  component, not necessarily a whole hotfix flow.
- Roots that invoke `skill-creator` form a covered demand lead; they do not
  justify creating another Skill.
