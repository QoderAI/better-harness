# Project Harness

## Purpose

Use this domain for the project's static operating surface: entrypoints,
core-change evidence, diagnostics, design contracts, fast feedback,
acceptance, change safeguards, and recovery boundaries.

## Load When

- A project evidence pass needs static repository, history, diff, or core-path
  context.
- Agent Work Loop Project Harness needs reproducible startup, supported
  operation, feedback, observability, acceptance, approval, or recovery
  evidence.
- A report, hook, or review flow needs sensitive-code handling.
- Git, CI, or local lifecycle checks need review-trigger guidance.
- Harness-analysis output needs to separate static presence, configured policy,
  and observed execution evidence.

## Owns

- `core-change-watch.md`: project profile, history, core-path, diff, and
  recommended-read evidence.
- `observability.md`: diagnostic routes and correlated runtime evidence.
- `project-overlays.md`: project-type additions to the common evidence model.
- `design-md-contract.md`: design source-of-truth boundaries.
- `friendly-cli.md`: agent-friendly command contracts.
- `git-hooks.md`: Git hook lifecycle placement and evidence.
- `recovery-evidence.md`: rollback and recovery presence, wiring, safe exercise,
  applicability, and validation evidence.
- `review-trigger.md`: recommendation and review-trigger policy.
- `sensitive-code.md`: sensitive-code review and reporting boundaries.

## Does Not Own

- Agent instruction, host asset, or provider feature taxonomy; use
  `../agent-customize/routing.md`.
- Session-derived Task Episode evidence; use `../session-evidence/`.
- Combined Agent Work Loop evidence mapping; use
  `../../models/agent-work-loop.md#construct-task-episode-evidence`.
- Repeated-work owner selection; use `../loop-engineering/`.

## Read Next

- Use `review-trigger.md` for recommendation and review-trigger policy.
- Use `core-change-watch.md` for static project evidence and changed-core
  routing.
- Use `observability.md` for diagnostic coverage and runtime evidence.
- Use `project-overlays.md` for scoped project-type evidence additions.
- Use `design-md-contract.md` for `DESIGN.md` ownership and verification.
- Use `friendly-cli.md` for command interface design.
- Use `recovery-evidence.md` for rollback and recovery inspection.
- Use `sensitive-code.md` for sensitive-code review boundaries.
- Use `git-hooks.md` for Git hook lifecycle placement and evidence.
