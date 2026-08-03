# Explicit Claude config workspaces remain project-scoped

## Traceability

- Spec ID: 42-claude-config-root-asset-inventory
- Story: QoderAI/better-harness#42
- Status: Implemented

## Intent

When a caller explicitly selects the Claude config directory itself as the
analysis workspace, Better Harness currently looks for project assets under a
nonexistent nested `.claude` directory and suppresses the real root-level
assets as ambient user-home data. Treat assets physically contained by that
designated workspace as project-authorized evidence while preserving the
default exclusion for data and install paths outside the workspace.

## Acceptance Scenarios

- AC-1: With `workspace` and `claudeHome` resolving to the same directory,
  `asset-baseline --platform claude` without `--include-user-home` inventories
  root-level `skills/`, `commands/`, `agents/`, `rules/`, `CLAUDE.md`, and
  `settings*.json` assets instead of probing `<workspace>/.claude/*`.
- AC-2: The same baseline includes enabled installed Plugins whose index and
  install roots are contained by the designated workspace, including their
  public Plugin surface, without changing the reported
  `scope.includeUserHome: false` authority.
- AC-3: The overlap does not authorize adjacent Claude state or Plugin install
  roots outside the designated workspace. A state file beside the workspace
  and an installed-Plugin record whose canonical path escapes the workspace
  remain excluded unless `--include-user-home` is explicitly passed.
- AC-4: Canonically equivalent workspace and Claude-home paths, including a
  symlink alias where the platform supports it, receive the same bounded
  treatment. Normal project workspaces keep their existing
  `<workspace>/.claude/*` discovery behavior.

## Non-goals

- Do not broaden ambient user-home collection or change the public meaning of
  `--include-user-home`.
- Do not add or infer configured assets for non-Claude providers; issue #42
  provides Claude-specific path-layout evidence.
- Do not read raw state, credentials, Hook bodies, or Plugin content outside
  the existing metadata-only contracts, and do not mutate Claude configuration.
- Do not claim that a configured asset or Plugin executed successfully.

## Plan and Tasks

1. Detect canonical identity between the selected workspace and Claude config
   root in the Claude provider, using filesystem-aware path comparison.
2. Route that overlap through the existing project primitive collectors with
   the workspace itself as the Claude asset root. Read the installed Plugin
   index from the workspace, but retain only canonical install roots contained
   by it when user-home authority is absent.
3. Mark contained Plugin metadata and children as workspace-scoped so lint and
   public inventory gates include them without admitting unrelated Plugin
   assets.
4. Add a focused asset-baseline fixture covering root assets, contained and
   escaping Plugin records, adjacent state exclusion, and the normal project
   path regression. Add a provider-level symlink assertion when supported.

## Test and Review Evidence

- AC-1–AC-3: `node --test test/agent-asset-baseline.test.mjs`
- AC-4 and provider scope details: `node --test test/agent-customize.test.mjs`
- Regression: `node --test test/agent-lint.test.mjs
  test/better-harness-evidence-bundle.test.mjs`
- Full suite and package boundary: `npm test` and `npm run pack:verify`
- Risk review: inspect the final diff for canonical containment, symlink escape,
  outside-state exclusion, disabled Plugin filtering, Windows path portability,
  and unchanged normal-project behavior.

## Implementation Evidence

- `node --test test/agent-customize.test.mjs
  test/agent-asset-baseline.test.mjs test/agent-lint.test.mjs
  test/better-harness-evidence-bundle.test.mjs` passed 87/87.
- `npm test` passed 1095/1095, including the normal-project regression,
  designated-root fixture, canonical symlink alias, and symlink escape cases.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` followed by
  `node --test test/doc-link-graph.test.mjs` passed 6/6 with no generated diff.
- `npm run pack:verify` passed with 382 npm entries and 405 runtime ZIP entries
  using an isolated writable npm cache.
- Review confirmed that `scope.includeUserHome` remains false, adjacent Claude
  state stays unread, outside and symlink-escaping Plugin roots stay excluded,
  and the existing `<workspace>/.claude/*` fixture remains green.
