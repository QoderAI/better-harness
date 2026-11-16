# Reading Deployment Rollback Evidence

Use this example when a review finds a rollback mechanism but needs to explain
what its records actually prove. The inspection rules remain in
[Rollback and Recovery Evidence](../../references/project-harness/recovery-evidence.md);
the model retains ownership of scoring and pass/fail judgment.

## Scope and Evidence Boundary

This is a fictional deployment example, not an incident report. All service
names, revisions, and receipts below are invented teaching material. No
deployment, rollback, or rehearsal was executed to produce this document.

It is reference material only: it installs no hook, registers no command, and
changes no runtime policy. Its example receipts cannot establish `Exercised`
evidence for Better Harness or any reviewed project. A real review needs that
project's own inspected records.

## Scenario

An isolated rehearsal environment runs the fictional `sample-catalog` service
at `rev-b`. The release introduced a regression in a read-only catalog journey.
The intended recovery is to reactivate the retained `rev-a` artifact without
changing stored data.

The affected resource is this environment's active deployment. Its recovery
owner is the release operator. The rehearsal must have explicit authority for
this isolated target; it has no production authority. A real inspection would
also need to verify that reactivating the old artifact is compatible with the
current data and dependencies.

## Compare Three Evidence Snapshots

Hypothetical snapshots requiring equivalent project-owned records.

| Snapshot | Available project evidence in the scenario | Supported conclusion | Remaining gap |
| --- | --- | --- | --- |
| Present | An owned rollback mechanism names the release operator and deployment revision as its effect class. | A recovery mechanism exists for this effect. | No connected target, authority, or postcondition has been inspected. |
| Wired | The supported rollback entrypoint binds `sample-catalog`, the isolated target, retained `rev-a`, scoped permission, and postcondition checks. | The recovery route is connected to the affected deployment and validation route. | No execution record shows an attempt or its result. |
| Exercised | A retained rehearsal receipt binds the before state, recovery decision, actual attempt, final active revision, and acceptance checks. | A recovery attempt was observed for this target and scenario. | Its outcome still needs judgment; production and data restoration remain outside scope. |

A configured rollback job alone cannot support the third row. Likewise, a
successful exercise of this deployment route would not prove that a database
backup can be restored.

## Illustrative Exercise Receipt

The following is a synthetic receipt shape, not a required schema. In an actual
review, each evidence reference must resolve to an authorized, inspected record
for the same target and attempt. Copying this table supplies no execution proof.

| Field | Fictional receipt content |
| --- | --- |
| Target and operation | `sample-catalog`, isolated rehearsal target, attempt `rehearsal-01` |
| Before state | Active revision `rev-b`; read-only catalog journey fails with a server error. |
| Decision | Release operator selects the retained `rev-a` artifact for a deployment rollback. |
| Authority | Approval covers only this isolated target and deployment change; credential material is omitted. |
| Entrypoint | Project-owned rollback operation with explicit target and revision inputs. |
| Actual attempt | Operation reports completion for `rehearsal-01`; its record is correlated with the deployment observation. |
| After identity | Independent deployment observation reports active revision `rev-a`. |
| Postconditions | Health check passes; the same catalog journey returns the expected response and known fixture content. |
| Residual effects | No data repair was attempted; compatibility and residual effects require their own inspected evidence. |
| Evidence references | Operation record, before/after deployment observations, and acceptance-check output, all bound to `rehearsal-01`. |

The operation's exit status is only one part of the receipt. A completion
message without the final active revision and journey result leaves the recovery
outcome unresolved. A health check alone may miss the original regression.

## Judge Outcome Separately

Suppose a real rehearsal has complete attempt records, but the final active
revision remains `rev-b`, or the catalog journey still fails after `rev-a` is
active. The attempt is still `Exercised`; the recovery did not achieve its
postcondition. Preserve both facts instead of treating an exercise as success.

If the approval or target observation is unavailable, name that exact gap. Keep
external production evidence `Unobserved` rather than describing it as missing
or running a real rollback to improve the report. The isolated rehearsal cannot
establish production recovery time, production permissions, or data integrity.

`Not applicable` needs evidence that the reviewed task has no persistent or
externally visible effect requiring recovery. This scenario changes an active
deployment, so the label is not justified merely because the target is isolated.

## Example Review Return

An inspector with real records of the successful variant could return:

> The release operator's rollback route was exercised on the isolated
> `sample-catalog` deployment in attempt `rehearsal-01`. The observed active
> revision changed from `rev-b` to `rev-a`, and the same catalog acceptance
> journey passed afterward. Evidence references bind the operation and checks
> to that attempt. This supports that deployment recovery under the rehearsal
> conditions; production recovery and data restoration remain unobserved.
