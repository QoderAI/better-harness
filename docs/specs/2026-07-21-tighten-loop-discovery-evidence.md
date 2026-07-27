# Tighten loop discovery evidence

## Traceability

- Spec ID: tighten-loop-discovery-evidence
- Status: Implemented

## Intent

Prevent Loop Discovery from treating commits, configured assets, related work
inside one task, or user-global history as proof of repeated coding-agent work.
Reuse the repository's Task Episode and evidence-state contracts, keep current
coverage separate from a proposed owner, and retain compact discovery output.

## Acceptance Scenarios

- AC-1: Observed recurrence requires at least two distinct, comparable Task
  Episodes with the same normalized intent, scope, host, trigger, procedure,
  output, and validation shape. Commits, report rows, and same-task steps remain
  supporting evidence rather than Task Episodes.
- AC-2: Explicit recurring policy or cadence, a costly single task, and
  entropy-only evidence remain separate recurrence classes and do not become
  observed repetition.
- AC-3: Discovery reports configured and observed coverage using the canonical
  evidence states, separates current from proposed ownership, and does not call
  present-only coverage exercised or effective.
- AC-4: Repository-only discovery stays repository-scoped unless the user
  includes workspace history, sessions, external records, or user-level memory.
- AC-5: A quick discovery returns at most three compact candidate decisions and
  expands only a selected new-owner or extension handoff.
- AC-6: Focused contract tests and fresh-context smoke tests against two
  representative repositories reject recurrence inflation while retaining a
  genuinely repeated command candidate.

## Non-goals

- Changing the `loop-blueprint` Skill trigger, runtime envelopes, automation
  readiness, state schema, or implementation authority.
- Creating a deterministic transcript analyzer or a new report schema.
- Requiring runtime execution when the user requested a read-only discovery.

## Plan and Tasks

1. Tighten demand-source normalization around distinct Task Episodes and source
   scope.
2. Make recurrence, coverage, and owner action explicit axes in Loop Discovery.
3. Narrow the Harness repeated-work route to previously constructed Episodes.
4. Add focused contract assertions and rerun bounded Codex CLI smoke tests.

## Test and Review Evidence

- AC-1 through AC-5: `node --test test/harness-skill.test.mjs`.
- Markdown routing: regenerate `docs/harness-doc-links.mmd`, then run
  `node --test test/doc-link-graph.test.mjs`.
- AC-6: reinstall the current plugin snapshot and run read-only, ephemeral
  Codex CLI discovery against two representative local repositories.
- Final review: run `git diff --check` and inspect the focused diff separately
  from the pre-existing Loop Blueprint worktree changes.
- Risk: added vocabulary could duplicate Task Episode construction. Keep that
  construction owned by `models/agent-work-loop.md` and link it instead of
  copying its procedure.

## Implementation Evidence

- Demand Source Analysis and Loop Discovery now preserve distinct Episode,
  evidence-scope, coverage-state, single-owner, and compact-search boundaries;
  the root Harness adds a direct inline route without expanding the Blueprint
  Skill.
- Focused Skill contracts passed 30 tests; documentation routing passed 5 tests
  with a current 17-file, 17-link Harness graph.
- Fresh read-only Codex CLI smoke tests in the representative repositories reported zero
  `Observed repeated` Loops, kept configured policies as `Declared recurring`
  plus `Try existing`, and did not use history, sessions, Memory, or target
  mutations. The final smoke also skipped Node and the Harness CLI.
