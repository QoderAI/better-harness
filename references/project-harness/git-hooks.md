# Git Hooks

## Purpose

Git hooks provide early, local feedback during the development lifecycle. Use
them to catch mechanical issues close to the moment a change is made, before
the developer waits for CI.

Hooks are not the authority for merge safety. Most local hooks require setup
and commit or push hooks can be bypassed with `--no-verify`, so CI and branch
protection must remain the final enforcement layer.

## Lifecycle Placement

```text
clone / setup
  -> install or activate hooks
edit / stage
  -> optional editor checks and manual local commands
commit
  -> pre-commit and commit-msg checks
push
  -> pre-push checks
pull request / merge request
  -> CI reruns critical checks and adds heavier validation
merge / checkout
  -> optional post-merge or post-checkout maintenance
```

The best lifecycle design is layered: local hooks optimize feedback speed; CI
optimizes authority and reproducibility.

## Setup Stage

Make hook activation explicit and repeatable. A repository should document one
supported setup path, such as:

- `pre-commit install --hook-type pre-commit --hook-type pre-push`
- `git config core.hooksPath .githooks`
- a package-manager setup command that installs hook tooling

Best practices:

- Keep hook definitions versioned in the repository.
- Do not depend on untracked local hook files under `.git/hooks`.
- Prefer a standard hook runner for mixed-language repositories.
- Keep setup cross-platform; avoid Unix-only shell assumptions unless the
  repository is explicitly Unix-only.
- CI should not depend on local hook installation. It should run the same
  commands directly.

## Edit And Stage Stage

Do not wait until commit for every signal. Editors, language servers,
formatters, and manual commands can catch issues before files are staged. Git
hooks should then act as a second local guard.

Best practices:

- Keep formatting and lint commands available outside hooks.
- Let developers run the same commands manually when diagnosing a hook failure.
- Avoid hiding important behavior inside hook-only scripts.
- If a formatter modifies files in a hook, fail clearly and ask the developer
  to review and restage the changed files.

## Pre-Commit Stage

Use `pre-commit` for checks that are fast, deterministic, local, and cheap.
This stage should usually finish in seconds.

Good `pre-commit` candidates:

- whitespace and end-of-file checks
- merge-conflict markers
- large-file checks
- JSON, YAML, TOML, or Markdown shape checks
- formatting and linting on staged files
- secret-pattern checks that do not require remote services
- small repository-contract checks

Avoid in `pre-commit`:

- full test suites
- remote API calls
- Docker pulls or container builds
- live service integration tests
- LLM review
- flaky checks
- long-running dependency installation

If developers often bypass `pre-commit`, treat that as a design failure. Move
the slow or unstable check to `pre-push` or CI.

## Commit Message Stage

Use `commit-msg` to validate collaboration metadata. It should inspect the
message, not the whole codebase.

Good `commit-msg` candidates:

- Conventional Commit shape
- minimum subject quality
- required issue or ticket token when the project explicitly requires one
- disallowed vague summaries such as `update`, `fix stuff`, or `changes`

Avoid inference-heavy checks. A commit-message hook should not guess author
intent, risk level, reviewer state, or tracker status.

## Pre-Push Stage

Use `pre-push` for checks that are still local and deterministic but too costly
for every commit.

Good `pre-push` candidates:

- targeted test runs for changed areas
- typecheck or build checks when reasonably fast
- generated artifact validation
- package or plugin validation that does not require remote state
- ref-range checks such as files changed since the branch base

Avoid in `pre-push`:

- full CI matrices
- production or staging calls
- slow security scans with remote feeds
- non-repeatable checks
- destructive operations

`pre-push` should reduce obvious CI failures, not replace CI.

## CI And Merge Stage

Every critical fast hook check should also run in CI. CI is the reproducible
backstop for skipped hooks, web edits, clean machines, different operating
systems, and branch protection.

Best practices:

- Keep the local hook set a fast subset of CI.
- Run `pre-commit run --all-files` or equivalent in CI when using
  `pre-commit`.
- Add heavier tests, builds, integration checks, and policy checks only in CI
  when they are unsuitable for local hooks.
- Require the CI status through branch protection or repository rules.
- When CI catches a deterministic issue that a hook could have caught, add or
  repair the local hook.

## Post-Merge And Checkout Stage

Post hooks are useful for maintenance, but they should be conservative because
they run after Git state has changed.

Reasonable uses:

- remind the developer to install dependencies after lockfile changes
- refresh generated indexes that are safe and deterministic
- print next-step instructions after branch checkout
- clear local caches that are known to be safe

Avoid:

- hidden dependency installation
- destructive cleanup
- changing tracked files without a clear message
- network calls that surprise the developer
- anything required for merge safety

Post hooks should help the next local action, not enforce correctness.

## Script Design

Hook files should be thin wrappers. Put real behavior in versioned scripts that
can be run directly by developers, hooks, and CI.

Best practices:

- Use stable entrypoints such as `scripts/<capability>/...`.
- Make scripts accept explicit paths, staged-file lists, or ref ranges.
- Print actionable failure messages with the command to rerun.
- Return non-zero only for real blocking failures.
- Keep output concise; hooks run in a high-friction moment.
- Handle spaces in paths and platform path separators.
- Avoid relying on global tools unless setup documents them.
- Keep secrets out of hook config and hook output.

## Review Trigger Hook Pattern

Review-trigger hooks are advisory sensors. They should turn local change
signals into a short recommendation, then route the change to self-check,
fresh Agent review, human review, split-work, or more evidence.

Use `references/project-harness/review-trigger.md` for the recommendation
rules. Keep hook scripts focused on deterministic signal collection.

A blast-radius analyzer is a good reusable example:

```text
hooks/git-scripts/blast-radius.mjs
hooks/git-scripts/blast-radius/
```

Recommended lifecycle wiring:

- On write/edit events, show feedback without blocking immediately.
- On task stop/completion, block only when a recent write occurred and the
  analyzer recommends review.
- In CI or pre-push, run the JSON mode and translate `shouldReview`, `severity`,
  `reasons`, `coreHits`, `testGaps`, and `securityRemovals` into review
  requirements.
- Keep thresholds and core-path rules in analyzer config; keep recommendation
  wording in the review-trigger reference.

## Stage Selection Rule

Use this rule of thumb:

```text
Can it run in a few seconds, offline, and deterministically?
  yes -> pre-commit
  no
Can it run locally before push without surprising the developer?
  yes -> pre-push
  no
Does it need clean machines, matrices, services, or authority?
  yes -> CI
```

## Review Questions

Before adding or changing a hook, ask:

- Which lifecycle stage should catch this issue first?
- Is the check deterministic on Windows, macOS, and Linux?
- Can a developer run the same command manually?
- Does CI run the same check or a stricter superset?
- Is the failure message short and actionable?
- Will this hook make `--no-verify` more common?
- Does the hook only observe or validate, rather than hiding product behavior?
- Could the check damage files, leak secrets, or call external systems
  unexpectedly?

## External Anchors

- Git `githooks` documentation: hook events, parameters, and bypass behavior.
- `pre-commit` documentation: standard hook installation and CI reuse.
