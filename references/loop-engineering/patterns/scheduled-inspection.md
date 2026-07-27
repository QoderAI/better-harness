# Scheduled Inspection Pattern

Scheduled inspection observes a bounded target on an explicit cadence and
produces triage evidence only when the observations warrant it. It is an
operating pattern, not a runtime command or durable owner; use
[Loop Discovery](../loop-discovery.md) to select the owner.

## Trigger

Use a named cadence or one-time scheduled follow-up with a stable target and a
replayable input pack. A host-specific `/schedule` entrypoint is only an
example and is valid only when that host supports it and the
[automation-readiness gate](../automation-readiness.md) passes.

## Procedure Owner

Let Loop Discovery select one narrow owner for inspection or triage, such as a
workflow, automation, or Skill-backed playbook. Issue triage, stale-item
review, failure clustering, and release readiness are capability shapes, not
claims that named Skills are installed. A Skill-shaped owner packages the
procedure only; it does not own scheduling, state, permissions, or code changes.

## Tools / Access

Use the least-privileged repository queries, search, logs, scanners, or domain
connectors needed to inspect the target. GitHub API or `gh issue`, `gh pr`, and
`gh run` reads are examples, not required dependencies. Tools provide access;
they do not grant authority to mutate the target.

## Artifact

Leave one triageable snapshot with the target, observation window, evidence
references, classification, confidence, duplicate key, and recommended next
owner. Labels, comments, issues, patches, or other external writes require a
separate explicit authorization; discovery and classification are the default.

For document or knowledge-asset freshness, also retain the canonical truth or
invariant used for comparison, the last executed inspection, and one of
`clean`, `gap`, or `needs more evidence`. File age, churn, unresolved markers,
and item counts may select the inspection window but cannot decide that the
asset is stale. A clean no-change result is a successful inspection artifact.

## Verifier

Re-run or sample the source query and confirm scope, freshness,
classification, and duplicate handling against source evidence. The executor's
self-report is not sufficient verification.

## State

Keep the run stateless when fresh input fully determines the result. Otherwise
record only the cursor or last successful window, prior artifact references,
and disposition needed to avoid missed or repeated findings in the
[state ledger](../loop-state-ledger.md).

## Stop Rule

Stop after the bounded observation window is classified. End with a no-op when
there are no new qualifying candidates, and with `needs more evidence` when
the source or classification cannot be verified. If a candidate warrants
sustained work, request the required human or policy confirmation before
handing it to [Goal Completion](goal-completion.md); do not modify code from
this pattern by default.

## Scenario Sketches

- **Issue or review queue sweep**: identify unassigned, stale, blocked, or
  missing-information items from a bounded query and emit candidates, not code.
- **CI failure digest**: group failures only when logs support the same cause;
  preserve distinct failures and unknowns.
- **Flaky-test review**: require comparable success and failure evidence for
  the same test before creating a flaky-test candidate.
- **Release or security readiness**: compare explicit required changes, checks,
  artifacts, advisories, and affected versions; leave blockers and missing
  proof.
- **Production error sweep**: rank bounded error signatures by frequency and
  impact, deduplicate previously investigated items, and hand confirmed work to
  Goal Completion.
- **Intelligence digest**: aggregate read-only signals with source references,
  caveats, and a length budget; missing sources remain visible gaps.
- **Documentation freshness**: compare bounded claims with the named source of
  truth on a justified cadence; emit a clean result or route confirmed drift to
  its document or implementation owner.

## Example

```text
Trigger: weekly scan of unattended work items
Procedure Owner: triage playbook (`issue-triage` as an illustrative Skill shape)
Tools / Access: tracker query and item reader (`gh issue list/view` on GitHub)
Artifact: prioritized candidate list with evidence and duplicate keys
Verifier: source-query replay plus a sample of accepted and rejected items
State: last successful window and prior candidate references
Stop Rule: no new candidate, needs more evidence, or verified handoff
```
