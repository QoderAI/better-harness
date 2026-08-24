# Route explicit manual fixes without requiring a report callback

## Traceability

- Spec ID: manual-direct-fix-routing
- Review: QoderAI/better-harness#39
- Status: Implemented

## Intent

Let ChatGPT Desktop users invoke an explicit command such as
`/better-harness fix this issue` with a concrete problem, bounded change
request, and validation instructions without first generating a Better Harness
report. Preserve the Skill's existing review trigger surface and keep the
manual route separate from report-bound repair and ordinary Harness reviews.

The manual route may change only the task-local workspace authorized by the
prompt. It must not discover, update, or claim repair progress for a
`findings.json`.

## Acceptance Scenarios

- AC-1: A callback-free slash-command request selects Manual Direct Fix only
  when its first instruction is an explicit `fix`, `repair`, or `修复`
  directive and the prompt identifies a concrete problem or requested outcome.
  The agent inspects the smallest relevant owner, applies the bounded change,
  and runs the smallest relevant validation without requesting report callback
  fields or starting a new Harness review.
- AC-2: A request containing a machine-owned
  `<better-harness-fix-output>` callback takes precedence and continues to use
  the existing Finding-bound Fix protocol, including exact path, finding, and
  revision validation plus `record-fix-output`.
- AC-3: Requests whose first instruction is review, evaluation, reporting, or
  another Harness-review intent continue to use the evidence-bundle,
  reconciliation, and durable-report workflow. A mixed request such as
  `review my harness and fix issues` does not grant direct mutation authority.
- AC-4: Manual direct fixes never search for a recent report, infer a Finding,
  read or update `findings.json`, run `record-fix-output`, or claim Assignment
  Summary, Repair Progress, revision, or score changes.
- AC-5: If an explicit manual repair request does not identify a concrete
  problem, requested outcome, or target-local scope, the agent asks for the
  missing repair brief; it does not ask the user to hand-author machine callback
  fields.
- AC-6: The root Skill retains its established review-trigger keywords and
  appends only `manual direct fixes` for discoverability. Step 5 continues to
  route Finding-bound repair through its reference and preserves the separate
  independent post-fix reassessment constraint.

## Non-goals

- Treat fuzzy repair intent or a repair clause inside a review request as direct
  mutation authority.
- Weaken callback validation or add fallback inference to report-bound repair.
- Convert ordinary `/better-harness` reviews into code-changing tasks.
- Backfill or migrate existing reports.
- Change Qoder Canvas, HTML action transport, report schemas, or renderer
  artifacts.

## Plan and Tasks

1. Restore the root Skill's original description and append
   `manual direct fixes`; restore the Step 5 Finding-bound route and independent
   reassessment language without exceeding the root prompt budget. (AC-6)
2. Add a deterministic entry router before the evidence workflow: a valid
   callback selects Finding-bound Fix; an explicit leading manual-fix directive
   selects Manual Direct Fix; all other invocations retain the review/report
   route. (AC-1..AC-3)
3. Tighten the Manual Direct Fix reference around explicit instruction,
   task-local authority, minimal owner inspection, validation evidence, and
   strict separation from report state. (AC-1, AC-4, AC-5)
4. Add positive and negative routing coverage for English and Chinese explicit
   fixes, callback-bound repair, vague fixes, ordinary reviews, and mixed
   review-and-fix requests. (AC-1..AC-6)
5. Regenerate the documentation routing graph and verify packaged artifacts.
   (AC-1..AC-6)

## Test and Review Evidence

- Root contract and route coverage:
  `node --test test/better-harness-skill.test.mjs`.
- Fresh-context behavior:
  - explicit English `fix` and `repair`, plus Chinese `修复`, select Manual
    Direct Fix without callback fields;
  - callback-bearing input selects Finding-bound Fix;
  - ordinary review and `review my harness and fix issues` retain the
    evidence/report route;
  - vague explicit fixes request only the missing task-local brief.
- Documentation integrity:
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then
  `node --test test/doc-link-graph.test.mjs`.
- Complete validation: `npm test`, `npm run pack:verify`, and
  `git diff --check`.
- Risk: fuzzy routing could broaden mutation authority. The explicit leading
  directive and negative mixed-intent AC keep review requests on the read-only
  evidence route.
- Risk: root guidance could lose trigger recall or independent repair review.
  Preserve the original keywords and reassessment language and enforce both in
  the focused Skill contract test.

## Revision Baseline

- PR #39 review confirmed that the previous description rewrite removed
  established trigger keywords and that the `repair intent` predicate was too
  broad.
- The same review confirmed that Step 5 dropped an independent post-fix
  reassessment guarantee without matching acceptance coverage.
- Earlier environment-specific backup movement is not acceptance evidence for
  this revision. Validation must come from the current worktree and CI.

## Implementation Evidence

- The root description retains all established review keywords and appends only
  `manual direct fixes`. The root stays within its contract budget at 217 lines
  and 11,997 UTF-8 bytes.
- Callback-bearing input routes first to Finding-bound Fix. Without a callback,
  only an explicit leading `fix`, `repair`, or Unicode-literal Chinese `fix`
  directive routes to Manual Direct Fix; review/evaluation/reporting and mixed
  review-and-fix requests remain on Step 1.
- Step 5 again requires the Finding-bound reference and a separate independent
  post-fix agent before verified finding state or Repair Progress can change.
- `node --test test/better-harness-skill.test.mjs` passed 13/13 and enforces the
  original trigger keywords, explicit positive route, mixed-intent negative
  route, report-state boundary, independent reassessment, and prompt budget.
- The regenerated documentation graph passed 6/6 integrity tests. Package and
  full-suite results are recorded in the paired HTML callback spec.
