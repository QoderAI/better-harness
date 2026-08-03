# Finding-bound Fix

Use this protocol only when the prompt contains a machine-owned
`<better-harness-fix-output>` callback.
The initiating handoff must explicitly invoke `/better-harness`; the callback
routes an already-active Skill and never replaces the slash-command trigger.
Resolve `<cli>` from the root Better Harness Skill before continuing. This route
authorizes one finding-bound repair, not a new report or a broader workspace
review.

## Validate the Callback

Require this shape before any probe, command, or edit:

```json
{
  "contract": "better-harness-fix-output/v1",
  "workspacePath": "<exact project root>",
  "findingsPath": "<exact findings.json>",
  "findingId": "<exact finding id>",
  "expectedRevision": 0
}
```

Validate the capability, existing exact paths, unique finding, report locale,
and current revision. Extra version metadata is allowed; exact label or report
version equality never selects the route. Missing, ambiguous, stale,
inaccessible, or incomplete callbacks stop before editing. Never search for a
recent run or substitute another report.

## Bind the Current Workspace Topology

Read the exact finding, then resolve the callback workspace without widening it:

```text
<cli> harness workspace-topology --workspace <workspacePath> --json
```

Require `topology.status: "complete"`. When the finding has a structured
`target`, require its complete `kind`, `packageRoute`, and `ownerRoute`; a
present-but-incomplete target is invalid and never falls back to legacy routing.
Accept only `repo-root|workspace-member|repo-subtree|standalone`; a workspace
member requires a non-null package route.
Require canonical Git-root-relative POSIX routes, reject absolute or escaping
routes, and verify any non-null `packageRoute` is a retained topology member.
For a path target, the package route must match the current member and the owner
must be that route, an ancestor owner, or inside the current target; a sibling
owner is outside authority. For a root target, the owner may be `.` or a route
inside the current topology. Standalone findings require a standalone topology.

Any kind, package, owner, containment, or topology-status mismatch fails closed
before inspection or editing. Do not infer a replacement route from finding
prose, evidence paths, expected output, or branch names. Resolve `<ownerPath>`
from `topology.gitRoot` (or `requestedWorkspace` for standalone) and the
validated `ownerRoute`, then use that smallest owner for inspection, mutation,
and verification.

For a legacy report with no `target` field at all, keep it readable: bind
`<ownerPath>` to the callback's exact `workspacePath`, do not invent
`packageRoute` or `ownerRoute`, and do not widen or narrow the repair scope.

## Load the Smallest Owner

After topology binding passes, load the smallest packaged owner before
inspecting `<ownerPath>`. For Rules, Skills, Hooks, MCP, Memory, customization,
or design findings, start from
[Agent Customize](../../../references/agent-customize/routing.md).

For `frontend-design-contract-missing`, also load the
[DESIGN.md Contract](../../../references/project-harness/design-md-contract.md)
and its [Complete Example](../../../case-studies/project-harness/design-md-complete-example.md)
as the complete packaged example before authoring. Use optional design Skills only as
augmentation and never invent brand decisions.

## Apply and Verify

Apply only the authorized fix inside `<ownerPath>` and run the smallest
owner-owned validation.
Keep the bound `findings.json` unchanged until the record command succeeds; it
is the locked pre-fix score baseline for the optional review below.
Derive 1-12 `actualOutput` rows from the real diff or configuration result, not
`expectedOutput`. Each row uses `created|updated|deleted`, the actual artifact
kind, a reader-facing name, `Project|Global`, an openable slash-normalized path
when one survives, and a concise artifact result. Any `SKILL.md` path must use
`artifact: Skill`.
For a structured finding, write every `Project` path relative to the frozen
topology Git root (or standalone requested workspace), even when the callback
workspace is a member package. This keeps an ancestor-owned result such as
`AGENTS.md` openable without `..`; the recorder validates it against
`ownerRoute`. Legacy findings keep callback-workspace-relative paths.

Author one standalone `assignmentSummary` in the report's exact locale. Its
title and body explain the finding-level verified outcome and validation
boundary; do not build it by joining artifact summaries. Write both fields to a
temporary result object outside the directory that owns the callback's
`findings.json`. Use an operating-system temporary directory or another
workspace-controlled scratch location; never add the result object as a fourth
durable report artifact beside `findings.json`, `report.md`, or `report.html`.

### Reassess the Repair Independently

After target validation, refresh the authorized provider's metadata baseline
once with `<cli> coding-agent-practices asset-integrity <provider> ... --json`
and only the previously authorized `--include-memories` / `--include-user-home` flags.
Record command failure as an unavailable `asset-integrity` marker; do not widen
scope or traverse user-home caches.

Launch exactly one fresh read-only subagent. Do not pass parent conclusions and
do not let it delegate. Require it to read the unchanged pre-fix
`findings.json` and [Agent Work Loop](../../../models/agent-work-loop.md), then
give it only the bound finding, actual outputs, changed paths, target-owned
validation results, and refreshed integrity envelope. It must not rescan the
project, author findings, change severity, rewrite Assignment Summary, edit
files, or change Agent Work Loop scores.

Ask it to judge only whether this finding's repair is `verified`, `partial`, or
`blocked`, with a concise reason, confidence, and bounded evidence references.
Put the machine-owned result at `postFixRepairReview`:

```json
{
  "modelId": "<exact summary.modelId>",
  "findingId": "<exact finding id>",
  "status": "verified",
  "summary": "<one native-locale reader sentence>",
  "reason": "<one native-locale independent judgment>",
  "confidence": "medium",
  "evidenceRefs": [
    { "kind": "fix-validation", "id": "<bounded result id>" },
    { "kind": "asset-integrity", "id": "<bounded result id or unavailable marker>" }
  ]
}
```

This review updates only Asset Health / Repair Progress. Loop Effectiveness and
the five Agent Work Loop dimension scores require a later comparable Task
Episode or independent outcome window. If delegation fails, omit the review,
record the verified Assignment Summary, and leave Repair Progress pending; the
lead must not synthesize a fallback review.

Then call:

```text
<cli> harness record-fix-output --workspace <workspacePath> --findings <findingsPath> --finding-id <findingId> --expected-revision <expectedRevision> --result <result.json> --consume-result --json
```

Report success only when the writer returns `status: pass` and the next
revision. Reuse the recorded Assignment Summary and report `repairProgress`;
`scoreRefresh` must remain unchanged for the current outcome window. If target
validation fails, no material change exists, or the writer fails, do not edit
the report artifacts; preserve the temporary result outside the report
directory for diagnosis and surface the exact blocker.
