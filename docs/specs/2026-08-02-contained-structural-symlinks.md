# Contained Structural Symlinks

## Traceability

- Spec ID: `contained-structural-symlinks`
- Status: Implemented

## Intent

Let workspace topology inspect tracked structural files reached through a symbolic link when the canonical file remains inside the topology root. This supports repositories that expose one canonical agent guide through provider-specific adapter links without downgrading otherwise complete evidence collection.

## Acceptance Scenarios

- AC-1: Given a tracked root `CLAUDE.md` link whose canonical target is the tracked root `AGENTS.md`, resolving workspace topology returns complete coverage and discovers the linked Claude instruction scope. The same holds for a tracked link inside a package directory.
- AC-2: Given a tracked structural link whose canonical target is outside the topology root, resolving workspace topology remains partial and emits `structure-entry-unsafe` for that route.
- AC-3: Given a tracked structural link whose in-root target is ignored, untracked, not itself a tracked structural inventory entry, reached through another symlink hop, written as an absolute path, a manifest route rather than an instruction adapter, or an instruction route owned by a different directory scope, resolving workspace topology remains partial and emits `structure-entry-unsafe` for that route.
- AC-4: A normal Evidence Bundle for a repository using an in-root agent-guide link can complete when its other required lanes and lead evidence are available.
- AC-5: Given a tracked structural link whose target does not exist, resolving workspace topology remains partial and emits `structure-entry-unavailable` rather than `structure-entry-unsafe`, because the entry cannot be inspected at all.
- AC-6: Structural route identity folds case only on Windows, so an ordinary tracked file whose on-disk casing differs from its inventory route is not reported as `structure-entry-unsafe`; safety decisions never depend on a non-canonical topology root.

## Non-goals

- Do not follow links whose canonical target escapes the topology root.
- Do not use a tracked structural link to admit ignored, untracked, or non-structural target content.
- Do not alias workspace or package manifests, borrow instructions from another ownership scope, or traverse a symlink chain: redirected structural links are limited to one relative hop between tracked instruction routes in the same directory.
- Do not accept cross-directory adapter links, such as a tracked `.github/copilot-instructions.md`, `.claude/CLAUDE.md`, or `.cursor/rules/*.mdc` entry that links up to the canonical root agent guide in a parent directory, and do not accept absolute link targets even when they stay inside the root. Those routes keep emitting `structure-entry-unsafe`, which keeps topology partial and therefore fails a normal-depth Evidence Bundle. Widening the accepted hop is tracked separately.
- Do not change source-mutation, secret-scan, or backup-path symlink policies.
- Do not change workspace topology, finding, or report schemas.

## Plan and Tasks

1. Add a real-filesystem topology regression for an in-root tracked instruction link.
2. Resolve each structural candidate before deciding whether it is a safe file, retaining canonical-root containment and requiring redirected targets to be tracked instruction inventory entries.
3. Compare structural routes and link targets through a shared `pathIdentityKey` helper that folds case only on Windows, and validate the link target against the canonical directory so the decision does not depend on how the caller spelled the topology root.
4. Re-run the contained-link test, ignored/non-structural target tests, the existing escaping-link test, the complete topology suite, and the real Evidence Bundle command.

Route containment and real-path identity follow the workspace topology contract in
[monorepo workspace support](2026-07-25-monorepo-workspace-support.md) (AC13).

## Test and Review Evidence

- AC-1: `node --test --test-name-pattern='contained tracked structural symlink' test/workspace-topology.test.mjs`
- AC-2: `node --test --test-name-pattern='does not follow a tracked structural symlink outside' test/workspace-topology.test.mjs`
- AC-3: `node --test --test-name-pattern='across ownership scopes|untracked hop|ignored in-root file|non-structural file|tracked manifest symlink|as an absolute path' test/workspace-topology.test.mjs`
- AC-5: `node --test --test-name-pattern='dangling tracked structural symlink' test/workspace-topology.test.mjs`
- AC-6: `node --test --test-name-pattern='folds case only on Windows' test/workspace-topology.test.mjs`, plus a manual `discoverWorkspaceStructure` call against a deliberately non-canonical root (`/tmp` symlink on macOS) that accepts the alias with no warnings.
- AC-1 and AC-2: `node --test test/workspace-topology.test.mjs`
- AC-4: the frozen `harness evidence-bundle` command recorded in the general-tasks ultrawork evidence ledger.
- Risk: accepting a link before canonical containment would expose external files; accepting an in-root redirect without direct, tracked, same-scope instruction target proof would expose ignored local content or let one route fabricate another route's ownership. Review must verify every check before the item enters structural discovery. Case-sensitive route comparison is itself a risk in the other direction: on Windows `realpath` reports on-disk casing, so a case-only divergence from the inventory route would otherwise mark an ordinary tracked file unsafe and fail the whole bundle.

Local evidence on 2026-08-02: the complete topology test file passes, including contained structural links plus chained-hop, cross-owner, outside-root, ignored-target, non-structural-target, absolute-target, and manifest-alias rejection, and dangling-link unavailability; the frozen normal Evidence Bundle for `general-tasks` exits 0 with complete topology and every required owner available.

Local evidence on 2026-08-03: `node --test test/workspace-topology.test.mjs` passes 20 tests, and the full `npm run check` suite passes with the nested-package alias, absolute-target rejection, dangling-link warning code, and route-identity cases added.
