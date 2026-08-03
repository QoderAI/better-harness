# Manual Direct Fix

Use this route only when an explicitly invoked `/better-harness` request has no
`<better-harness-fix-output>` callback and its first instruction is an explicit
`fix`, `repair`, or `\u4fee\u590d` (Chinese `fix`) directive. It is a task-local repair, not a Harness
review or report-bound Finding repair. A review, evaluation, reporting, or
mixed request such as `review my harness and fix issues` remains on the ordinary
Harness review route.

## Validate the Repair Brief

Require a concrete problem or requested outcome in the current workspace.
Treat named files, observed behavior, acceptance conditions, and validation
commands as the task boundary. If neither the problem nor requested outcome is
concrete enough to locate the smallest relevant owner, ask for that missing
repair brief. Do not ask the user to provide `workspacePath`, `findingsPath`,
`findingId`, or `expectedRevision`.

## Apply and Verify

Follow the target repository's instructions. Diagnose the stated problem,
inspect the smallest relevant owner, apply only the authorized change, and run
the smallest relevant validation. Do not collect a Harness evidence bundle,
launch the three review agents, reconcile findings, or render a new report.

This route must not search for or discover a recent `findings.json`. It must not read
or update `findings.json` as report state, and must not call
`record-fix-output`. It must not claim an Assignment Summary, Repair Progress,
revision update, score change, or any other report result.

Report only the concrete files changed and validation actually completed. If
the repair cannot be made safely within the supplied task boundary, stop with
the exact missing target, authority, or validation evidence.
