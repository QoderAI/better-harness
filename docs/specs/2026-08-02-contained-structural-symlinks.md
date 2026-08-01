# Contained Structural Symlinks

## Traceability

- Spec ID: `contained-structural-symlinks`
- Status: Implemented

## Intent

Let workspace topology inspect tracked structural files reached through a symbolic link when the canonical file remains inside the topology root. This supports repositories that expose one canonical agent guide through provider-specific adapter links without downgrading otherwise complete evidence collection.

## Acceptance Scenarios

- AC-1: Given a tracked root `CLAUDE.md` link whose canonical target is the tracked root `AGENTS.md`, resolving workspace topology returns complete coverage and discovers the linked Claude instruction scope.
- AC-2: Given a tracked structural link whose canonical target is outside the topology root, resolving workspace topology remains partial and emits `structure-entry-unsafe` for that route.
- AC-3: Given a tracked structural link whose in-root target is ignored, untracked, or not itself a tracked structural inventory entry, resolving workspace topology remains partial and emits `structure-entry-unsafe` for that route.
- AC-4: A normal Evidence Bundle for a repository using an in-root agent-guide link can complete when its other required lanes and lead evidence are available.

## Non-goals

- Do not follow links whose canonical target escapes the topology root.
- Do not use a tracked structural link to admit ignored, untracked, or non-structural target content.
- Do not change source-mutation, secret-scan, or backup-path symlink policies.
- Do not change workspace topology, finding, or report schemas.

## Plan and Tasks

1. Add a real-filesystem topology regression for an in-root tracked instruction link.
2. Resolve each structural candidate before deciding whether it is a safe file, retaining canonical-root containment and requiring redirected targets to be tracked structural inventory entries.
3. Re-run the contained-link test, ignored/non-structural target tests, the existing escaping-link test, the complete topology suite, and the real Evidence Bundle command.

## Test and Review Evidence

- AC-1: `node --test --test-name-pattern='contained tracked structural symlink' test/workspace-topology.test.mjs`
- AC-2: `node --test --test-name-pattern='does not follow a tracked structural symlink outside' test/workspace-topology.test.mjs`
- AC-3: `node --test --test-name-pattern='ignored in-root file|non-structural file' test/workspace-topology.test.mjs`
- AC-1 and AC-2: `node --test test/workspace-topology.test.mjs`
- AC-4: the frozen `harness evidence-bundle` command recorded in the general-tasks ultrawork evidence ledger.
- Risk: accepting a link before canonical containment would expose external files; accepting an in-root redirect without tracked structural target proof would expose ignored local content. Review must verify both checks before the item enters structural discovery.

Local evidence on 2026-08-02: the complete topology test file passes, including contained structural links plus outside-root, ignored-target, and non-structural-target rejection; the frozen normal Evidence Bundle for `general-tasks` exits 0 with complete topology and every required owner available.
