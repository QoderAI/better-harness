# Rollback and Recovery Evidence

Use this reference to inspect the operating evidence for Agent Work Loop
`rollback-recovery`. The model owns the judgment; this file owns the bounded
inspection procedure. Do not perform a destructive rollback merely to improve
the evidence state.

## Start from the actual effect

Name the affected resource, data, revision, environment, or external action and
its blast radius. Then inspect the project's owned recovery shape: rollback,
restore, retry, compensation, idempotent replay, safe abort, prior revision,
backup, dry-run, or a proven no-persistent-effect boundary. A recovery-looking
filename or prose promise is only a discovery lead.

## Evidence progression

| Level | Required evidence |
| --- | --- |
| Present | Owned mechanism, responsible owner, and intended effect class. |
| Wired | Affected resource or revision, supported entrypoint, required permission or credential scope, postcondition, and validation route are connected. |
| Exercised | Safe simulation, rehearsal, comparable retained task, or actual recovery ran and recorded the before state, decision, result, and postcondition. |
| Not applicable | Inspection proves the task has no persistent or externally visible effect that needs recovery. |
| Unobserved | Recovery depends on external state, credentials, environment, or history that the review cannot safely inspect. |

An exercised recovery can fail; evidence strength does not replace the model's
pass/fail judgment. Prefer a project-owned dry-run or isolated rehearsal. For a
real recovery, require explicit authority, least privilege, and risk-appropriate
approval before the effect.

## Validation by recovery shape

- **Revision rollback:** bind the previous and current revision, target
  environment, rollout owner, health or acceptance check, and final active
  revision.
- **Backup and restore:** bind the backup to the affected data and time, verify
  readability or restore in a safe target, and check integrity after restore.
- **Retry or idempotent replay:** preserve operation identity, attempt history,
  duplicate protection, terminal result, and residual partial effects.
- **Compensation:** name the original effect, compensating action, ordering,
  unrecoverable residue, and business or state invariant after compensation.
- **Safe abort or no persistent effect:** show the transaction, sandbox,
  temporary workspace, preview, or cleanup boundary that prevents lasting
  effects.

## Return

Return the actual effect, mechanism owner, entrypoint, permission boundary,
before/after identity, exercise type, validation result, and precise blocker.
Keep external or unsafe evidence `Unobserved`; do not downgrade it to `Missing`
or substitute a matching filename.
