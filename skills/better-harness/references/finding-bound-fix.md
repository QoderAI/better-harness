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

## Load the Smallest Owner

Read the exact finding, then load its smallest packaged owner before inspecting
the target. For Rules, Skills, Hooks, MCP, Memory, customization, or design
findings, start from [Agent Customize](../../../references/agent-customize/routing.md).

For `frontend-design-contract-missing`, also load the
[DESIGN.md Contract](../../../references/project-harness/design-md-contract.md)
and its [Complete Example](../../../case-studies/project-harness/design-md-complete-example.md)
as the complete packaged example before authoring. Use optional design Skills only as
augmentation and never invent brand decisions.

## Apply and Verify

Apply only the authorized fix and run the smallest target-owned validation.
Keep the bound `findings.json` unchanged until the record command succeeds; it
is the locked pre-fix score baseline for the optional review below.
Derive 1-12 `actualOutput` rows from the real diff or configuration result, not
`expectedOutput`. Each row uses `created|updated|deleted`, the actual artifact
kind, a reader-facing name, `Project|Global`, an openable slash-normalized path
when one survives, and a concise artifact result. Any `SKILL.md` path must use
`artifact: Skill`.

Author one standalone `assignmentSummary` in the report's exact locale. Its
title and body explain the finding-level verified outcome and validation
boundary; do not build it by joining artifact summaries. Write both fields to a
temporary result object.

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
`findings.json`; preserve the temporary result for diagnosis and surface the
exact blocker.
