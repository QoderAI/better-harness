# Host Capability Registry

## Traceability

- Spec ID: `host-capability-registry`
- Status: Implemented

## Intent

Reduce the shotgun surgery required to add or change a Coding Agent host. Stable
host identity and option metadata should have one owner, while session analysis,
agent customization, report rendering, and asset practice support remain
independently composed capabilities.

The refactor must preserve existing public CLI contracts and explicit adapter
module registration. It should remove repeated host-home plumbing and make host
gates derive from declared capability support without turning the registry into
a service locator or dynamically discovering executable modules.

## Acceptance Scenarios

- AC-1: A pure-data host catalog owns the stable id, display name, home override
  option/property, and capability claims for every currently supported host.
- AC-2: Existing host order, CLI help text, legacy `--<host>-home` flags, and
  fail-closed unknown-host behavior remain compatible.
- AC-3: Orchestration boundaries normalize the selected host's home override to
  `home`; selection-profile collection honors explicit Kimi, WorkBuddy, and Grok
  homes without falling back to their default user-home roots.
- AC-4: Task-loop practice inventory dispatch is data-driven for declared asset
  hosts, while host-specific exceptional options remain explicit. Generated
  review commands retain every supported host identity, including Grok.
- AC-5: Asset-integrity validation accepts Kimi and every host declared for asset
  practice support, and rejects unknown hosts before collection.
- AC-6: Each capability is checked against its own declared support slice. A host
  may be absent from one capability without a fake adapter registration or a
  repository-wide equality requirement.
- AC-7: Parameterized regression tests cover catalog-to-composition mappings,
  host-home routing, asset-integrity gates, and report host projection while
  existing help snapshots remain unchanged.
- AC-8: Focused tests, the full test suite, documentation link validation, package
  verification, and whitespace checks pass on the resulting local diff.

## Non-goals

- Add, remove, or change the advertised maturity of any Coding Agent host.
- Dynamically scan the filesystem to load adapter modules.
- Replace capability-local executable registries with a global `HostAdapter`
  interface or service locator.
- Refactor provider-native parsers, evidence schemas, output modes, or package
  assembly behavior.
- Remove or rename any public CLI flag.
- Generate README, localization, or adapter documentation from the catalog in
  this phase.
- Update changelogs, releases, versions, or roadmap metadata.

## Plan and Tasks

1. Activate `scripts/host-support/` as the owner of stable host descriptors,
   capability slices, home normalization, and display formatting.
2. Keep executable module imports in the existing agent-customize and
   session-analysis registries; assert that their keys match only their declared
   capability slices.
3. Replace repeated host lists in runtime gates and orchestration code with
   catalog projections, preserving the current ordering and messages.
4. Normalize selected-host home options at selection-profile, report, task-loop,
   and asset-inventory boundaries. Preserve exceptional Qoder cache, Codex app,
   and Claude state options as explicit capability-owned fields.
5. Remove host-by-host task-loop inventory branches and fix the Kimi integrity
   gate, Grok review-command fallback, and Grok report-scope recognition.
6. Replace repository-wide support equality tests with capability-specific
   mapping tests and add focused behavioral regressions.

The catalog is intentionally declarative. Capability modules continue to own
construction and execution so host metadata cannot accumulate runtime behavior
or cross-capability dependencies.

## Test and Review Evidence

- AC-1, AC-2, AC-6: run the host-support and support-declaration tests; inspect
  public help snapshot diffs for unintended contract changes.
- AC-3: run selection-profile tests with injected analyzers for every declared
  session host and both camel-case and dashed home overrides.
- AC-4: run task-loop source/report tests, including Grok command projection and
  exceptional-option preservation.
- AC-5: run the asset-integrity CLI regression against isolated empty roots for
  each declared asset host and an unknown-host rejection case.
- AC-7: run focused session, agent-customize, report, and rendering tests.
- AC-8: run `node scripts/doc-link-graph/cli.mjs skills/better-harness`,
  `node --test test/doc-link-graph.test.mjs`, `npm test`,
  `npm run pack:verify`, and `git diff --check`.

Risk review must pay particular attention to help-only paths (which must remain
free of home or adapter I/O), Windows-safe option/path handling, catalog and
composition drift, and accidental widening of user-home collection.

Implementation evidence on 2026-08-03:

- `node --test test/host-support.test.mjs test/support-declarations.test.mjs
  test/task-loop-report.test.mjs test/harness-report-quality.test.mjs` passed
  164 tests.
- Host/catalog/report/docs contract tests passed 122 tests after the review fixes.
- Provider, inventory, session, selection, report, render, and evidence-bundle
  focused suites passed 285 tests; Checkup plus host-support passed 34 tests.
- `node --test test/scripts-refactor-contract.test.mjs` passed all seven frozen
  help, output, failure-channel, and installability checks.
- `npm test` passed 1,148 tests after the installed-like Canvas fixture was
  updated to carry the new packaged host-support dependency.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` reported 35 files
  and 51 links; `node --test test/doc-link-graph.test.mjs` passed six tests.
- `npm run pack:verify` passed with 394 npm entries and 416 runtime ZIP entries.
- English and Chinese Docusaurus production builds passed. Playwright verified
  10 host cards, the Kimi matrix anchor, loaded image assets, responsive desktop
  and 390 px layouts, and no browser console errors or card overflow.
- `git diff --check` passed.
