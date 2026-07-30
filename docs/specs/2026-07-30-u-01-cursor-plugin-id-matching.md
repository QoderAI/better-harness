# Fail closed for unknown Cursor plugin IDs

## Traceability

- Spec ID: U-01
- Story: roadmap.md TODO U-01
- Status: Implemented

## Intent

Prevent Cursor installed-plugin records with unknown numeric or opaque IDs from
being assigned to unrelated cached plugins. Installed status must come only from
direct plugin-manifest IDs or workspace-bound project MCP evidence, so cache
enumeration and display-name order cannot change which plugin is reported as
installed.

## Acceptance Scenarios

- **U01-AC-1 (unknown IDs fail closed):** Given one or more installed-plugin
  records whose IDs match neither a cached plugin's `cursorPluginId` nor a
  project MCP hint, the inventory reports no cached plugin as installed and
  lists every unknown record ID in `unmatchedInstalledPluginIds`.
- **U01-AC-2 (order invariance):** Reordering cache candidates without reliable
  IDs does not change the installed-plugin inventory or attach an unknown
  record's sources, scope, or install metadata to any candidate.
- **U01-AC-3 (direct ID evidence):** A record that directly equals a cached
  plugin's `cursorPluginId` remains installed with `installMatch: "id"` and
  preserves install-record order.
- **U01-AC-4 (project MCP evidence):** A record mapped by a workspace-bound MCP
  tool snapshot remains installed with `installMatch: "project-mcp"`.
- **U01-AC-5 (diagnostic compatibility):** Existing diagnostic field names
  remain available. `installedPluginFallbackCount` remains numeric and is zero
  because cache fallback assignment is no longer allowed; the matching summary
  clearly distinguishes fully matched records from records left unknown.

## Non-goals

- Change Cursor capability declarations, session evidence, checkup behavior, or
  report routing.
- Infer plugin identity from cache order, display name, cache path position, or
  numeric-ID shape.
- Add new Cursor data sources or decode undocumented state.
- Change roadmap items other than U-01 or broaden another Cursor capability
  claim.

## Plan and Tasks

1. Add focused provider regressions for unknown IDs and cache-order invariance,
   while retaining direct-ID and project-MCP positive coverage.
2. Run the focused regression against the pre-fix provider and record that the
   cache fallback behavior fails the new assertions.
3. Remove cache-order fallback assignment from
   `scripts/agent-customize/providers/cursor.mjs`; preserve existing diagnostic
   keys and report unmatched records explicitly.
4. Update the Unreleased changelog entry because installed-plugin inventory is
   observable provider behavior.
5. Mark roadmap U-01 complete and align its Cursor inventory description with
   the implemented evidence boundary.
6. Run focused provider tests, documentation link integrity, full tests,
   package verification, and whitespace checks. Record any environment-specific
   limitation without weakening the acceptance criteria.

## Test and Review Evidence

- **U01-AC-1/U01-AC-2:** focused assertions in
  `test/agent-customize.test.mjs` use plugins without manifest IDs and compare
  inventories across reversed cache names/order. Before implementation these
  must fail by exposing `cache-fallback` assignments.
- **U01-AC-3:** the existing direct-ID install-order test must continue to pass.
- **U01-AC-4:** the existing project MCP numeric-ID hint test must continue to
  pass.
- **U01-AC-5:** focused assertions verify a zero fallback count, preserved
  unmatched IDs, and diagnostic text that says unknown records remained
  unmatched.
- Provider gate: `node --test test/agent-customize.test.mjs`.
- Documentation gate: regenerate the routing graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then run
  `node --test test/doc-link-graph.test.mjs`.
- Regression gates: `npm test`, `npm run pack:verify`, and `git diff --check`.
- Primary risk: downstream consumers may have treated heuristic plugin entries
  as installed. The safe compatibility boundary keeps diagnostic keys and
  direct/hinted matches intact while deliberately removing unproven entries.
- Review readiness must confirm the diff is limited to the Cursor provider,
  focused tests, this spec, U-01 roadmap declarations, generated documentation
  routing if changed, and the changelog.

### Observed Evidence (2026-07-30)

- Pre-fix regression: the two new focused tests failed 0/2. The old provider
  assigned ID `9001` to `Future Tool` and assigned two unknown records to cache
  candidates including `Alpha Without Id` and `Hex`.
- Provider plus architecture gate:
  `node --test test/agent-customize.test.mjs
  test/agent-customize-architecture.test.mjs` passed 33/33 after rebasing
  onto `origin/main` at `686e1aa`, including direct-ID, project-MCP,
  unknown-ID, and cache-order cases.
- Documentation gate: the graph generator reported 34 files and 50 links; the
  generated graph had no semantic diff because this spec is not in the
  `skills/better-harness` routing chain. The doc-link suite passed 6/6.
- Full regression: `npm test` ran 980 tests: 973 passed, 4 failed, and 3 were
  skipped. The four failures are environment-specific Windows `EPERM`
  failures while creating symlinks in
  `test/core-change-watch-scope.test.mjs`,
  `test/harness-report-render-cli.test.mjs`, and
  `test/workspace-topology.test.mjs`; a focused rerun reproduced the same four
  failures without any Cursor provider failure.
- Package gate: `npm --cache .npm-cache run pack:verify` passed with 333 npm
  entries and 356 runtime ZIP entries. The temporary cache was removed
  afterward.
- Environment limitation: Node `v22.17.0` and npm `10.9.2` are below the
  repository minimums of Node `22.20.0` and npm `10.9.3`.
- `git diff --check` passed before this evidence update and is rerun during the
  final readiness check.
