# Scripts Directory Cleanup

Consolidate `scripts/` layout so capability boundaries match the architecture
rules in `docs/ARCHITECTURE.md`: compose through public surfaces, keep root
entrypoints thin, and use business-named capability directories.

## Traceability

- Spec ID: 2026-07-20-scripts-directory-cleanup
- Status: Implemented

## Intent

A structure review of `scripts/` found rule violations that grow maintenance
cost:

1. Ten files across `agent-customize`, `agent-lint`, and
   `coding-agent-practices` import `session-analysis` private helpers
   (`fs.mjs`, `paths.mjs`, `cli.mjs`) directly, and
   `harness-analysis/task-loop-source.mjs` imports six more deep
   `session-analysis` modules.
2. Root `scripts/session-analysis.mjs` owns the real CLI and `SessionAnalyzer`
   while `scripts/session-analysis/` modules import the root file back —
   a reverse-layering cycle.
3. `scripts/findings-recommend.mjs` + `.json` and `scripts/doc-link-graph.mjs`
   are loose root files consumed by multiple capabilities, against the
   `scripts/<capability>/` convention.
4. `scripts/package/` and `scripts/packaging/` are near-identical names with
   different owners (npm bundle/verify vs host-plugin assembly).
5. `scripts/coding-agent-practices/checkup.mjs` is a re-export shim over
   `checkup/cli.mjs` with no external import consumers.

## Acceptance Scenarios

- AC-1: `scripts/session-analysis/index.mjs` is the only import path other
  capabilities use for session-analysis helpers; no file outside
  `scripts/session-analysis/` imports `session-analysis/<private>.mjs`
  modules directly.
- AC-2: `scripts/session-analysis.mjs` stays a thin compatibility shim
  (re-export + CLI dispatch) so documented `node scripts/session-analysis.mjs`
  commands keep working; the class/dispatch logic lives in
  `scripts/session-analysis/analyzer.mjs` and no module inside
  `scripts/session-analysis/` imports the root file.
- AC-3: `findings-recommend` moves to `scripts/findings-recommend/`
  (`index.mjs` + `findings-recommend.json`); `agent-lint`, `review-trigger`,
  and tests import the new path; behavior is unchanged.
- AC-4: `doc-link-graph` moves to `scripts/doc-link-graph/cli.mjs`;
  `AGENTS.md` and `test/doc-link-graph.test.mjs` reference the new path and
  the generated `docs/harness-doc-links.mmd` stays fresh.
- AC-5: `scripts/package/` is renamed to `scripts/npm-package/`;
  `package.json` scripts, tests, and directory-ownership docs reference the
  new name; `npm run pack:verify` passes.
- AC-6: `scripts/coding-agent-practices/checkup.mjs` is removed; the
  `harness checkup` registry entry dispatches to
  `coding-agent-practices/checkup/cli.mjs`, which owns its own CLI gate.
- AC-7: `npm test` passes with no behavioral output change from any CLI.

## Non-Goals

- No split or refactor of `scripts/harness-analysis/` internals (tracked as a
  future spec; it needs its own evidence review).
- No command renames, flag changes, or output-format changes.
- No changes to `hooks/`, `skills/`, or host plugin shells beyond path
  references.
- Historical `docs/specs/*.md` files keep their original command strings.

## Plan

1. Move root `session-analysis.mjs` logic into
   `scripts/session-analysis/analyzer.mjs`; keep the root file as shim.
2. Add `scripts/session-analysis/index.mjs` exporting the cross-capability
   surface: `parseArgs`, `parseBooleanFlag`, `pathExists`, `walkFiles`,
   `isDirectory`, `expandHome`, `normalizeWorkspace`, semantic-facet,
   episode-contract, observation-manifest, privacy-safe-text, session-ref,
   selection, selection-plan exports, `SessionAnalyzer`, `createAnalyzer`.
3. Rewrite external importers to use `session-analysis/index.mjs`.
4. Relocate `findings-recommend` and `doc-link-graph`; update importers,
   tests, and `AGENTS.md`.
5. Rename `scripts/package/` to `scripts/npm-package/`; update
   `package.json`, tests, `docs/community.md`,
   `docs/adrs/directory-structure.md`.
6. Remove the checkup shim and repoint the registry.

## Test / Review Evidence

- `npm run pack:verify` passed: npm pack and runtime zip entries include the renamed `scripts/npm-package/` and `scripts/findings-recommend/` paths.
- `NO_COLOR=1 node --test test/better-harness-cli.test.mjs test/doc-link-graph.test.mjs test/findings-recommend.test.mjs test/agent-lint.test.mjs test/plugin-manifests.test.mjs test/host-plugin-artifact.test.mjs` passed.
- `NO_COLOR=1 node --test test/session-analysis.test.mjs test/session-analysis-claude-facets.test.mjs test/coding-agent-practices-inventory.test.mjs test/harness-report-quality.test.mjs test/task-loop-repository-evidence.test.mjs` passed.
- `node scripts/better-harness.mjs --help`, `node scripts/session-analysis.mjs --help`, and `node scripts/better-harness.mjs harness checkup --help` passed.
- `npm test` currently reports 762 pass / 1 fail; the failing `test/legacy-product-names.test.mjs` reproduces on clean `HEAD` and is unrelated to this directory cleanup.
