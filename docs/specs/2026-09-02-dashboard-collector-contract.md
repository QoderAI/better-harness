# Version the Dashboard collector boundary

## Traceability

- Spec ID: `2026-09-02-dashboard-collector-contract`
- Status: Implemented

## Intent

Make the private Harness Dashboard fail clearly when its out-of-process local
collector returns an unsupported or malformed document. The collector output
must identify its own contract version, and the server must validate that
contract before caching or projecting it into the UI.

## Acceptance Scenarios

- **AC-1 — Versioned collector document:** every successful local Dashboard
  collection emits `better-harness.dashboard-input` schema version 1 while
  preserving the existing workspace, evidence, usage, asset, and delivery
  projections.
- **AC-2 — Runtime boundary validation:** the server validates parsed collector
  stdout before it enters the project cache. Invalid JSON, an unsupported
  kind/version, missing or unknown top-level fields, incompatible nested source
  versions, and misaligned dated series fail collection instead of reaching the
  renderer through a TypeScript assertion.
- **AC-3 — Public capability composition:** the Dashboard collector imports
  Session Analysis and Agent Customize through their public `index.mjs`
  surfaces. Capability-private adapter registries are not imported directly.
- **AC-4 — Existing Dashboard behavior remains stable:** project isolation,
  refresh caching, current metrics, responsive rendering, and the local-only
  upload flow retain their current behavior.

## Non-goals

- Persisting, digesting, signing, or remotely uploading Dashboard snapshots.
- Defining cross-machine project, member, machine, or publisher identities.
- Making Harness Studio consume the Dashboard projection or introducing a new
  collector package.
- Adding cost, retry, intervention, or inferred Task-to-Session fields.
- Changing Dashboard hierarchy, charts, drill-down behavior, or visual design.

## Plan and Tasks

1. Add a capability-local JavaScript contract module that owns the Dashboard
   input kind/version and validates its bounded projection shape.
2. Emit the envelope from `collect-local-data.mjs` and validate parsed stdout in
   `local-data.server.ts` before caching it.
3. Export the required host/provider metadata and usage-summary builder through
   the existing Session Analysis and Agent Customize public surfaces, then
   route Dashboard imports through those surfaces.
4. Add focused contract tests and run the complete Harness UI test and build
   gates.

## Test and Review Evidence

- **AC-1, AC-2:** focused contract coverage validates the script-shaped empty
  aggregation plus rejection of invalid JSON, unknown versions, top-level
  drift, incompatible nested versions, and dated-series length mismatches. A
  live `codex` collection bounded to one Session passed the V1 validator.
- **AC-3:** the production build and complete test run resolve Session Analysis
  and Agent Customize through their public capability indexes; the Dashboard
  collector no longer imports their analyzer or provider registry paths. Three
  focused public-surface suites pass 108 Session Analysis and Agent Customize
  tests.
- **AC-4:** `npm test -w @qoder-ai/harness-ui` passes 46 tests across six files,
  including TypeScript validation. `npm run build -w @qoder-ai/harness-ui`
  succeeds with the existing 13 dynamic-filesystem tracing warnings.
- **Documentation:** the Better Harness routing graph remains at 39 files and
  56 links; `test/skills-docs/doc-link-graph.test.mjs` passes all eight tests.
- **Risk:** a strict boundary can expose previously tolerated fixture or source
  drift. The validator therefore owns only the Dashboard projection contract;
  capability-specific semantic validation remains with its existing producer.
