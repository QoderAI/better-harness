# Restore the Dashboard contract and Node 24 generation gate

## Traceability

- Spec ID: ci-dashboard-contract-node24
- Status: Implemented

## Intent

Restore the cross-platform CI gate after the latest Dashboard change removed
fields still consumed by the joinable-evidence model, and keep Harness DSL
generation working on the Node 24 release selected by GitHub Actions.

## Acceptance Scenarios

- AC-1: The Dashboard contract exposes the optional asset revision and
  publisher fields consumed by the aggregation model, and exposes the bounded
  commit-to-session references required by the joinable-evidence projection.
- AC-2: Harness DSL generation succeeds on Node 24.20.0 without weakening or
  skipping generated-source validation.
- AC-3: The repository's complete local check passes on a supported Node 24
  runtime, including Dashboard tests and package verification.
- AC-4: The pushed commit reaches terminal success in every GitHub Actions CI
  matrix job.

## Non-goals

- Change Dashboard layout or outcome-distribution behavior.
- Change the generated Harness DSL sources.
- Publish a package or release.
- Claim that dependency audit warnings are resolved.

## Plan and Tasks

1. Restore the contract fields removed while editing the outcome-distribution
   types, preserving their existing optional and bounded semantics.
2. Apply the minimal upstream `jsonschema` fix for local-fragment resolution
   from [tdegrunt/jsonschema#424](https://github.com/tdegrunt/jsonschema/pull/424)
   inside the Harness generator process until an upstream release contains it.
3. Add an executable Node-version regression test for Langium generation so
   Node 24.20.0 remains an explicit acceptance surface.
4. Run focused tests, the complete repository check, and the review-readiness
   evidence pass before committing and pushing.

## Test and Review Evidence

- AC-1: `npm run typecheck -w @qoder-ai/harness-ui` and
  `npm test -w @qoder-ai/harness-ui`.
- AC-2: run `langium generate` with Node 24.20.0 and verify generated sources
  remain unchanged.
- AC-3: `npm run check` on the repository-supported Node 24 installation.
- AC-4: wait for the pushed GitHub Actions workflow and inspect failed logs if
  any matrix job is not successful.
- Risk: the `jsonschema` repair modifies a transitive validator prototype only
  inside the generator process. Pin the compatibility layer to version 1.5.0,
  retain the upstream behavior, and fail generation if the installed version
  no longer matches.

Local evidence on 2026-09-03:

- AC-1: Dashboard typecheck passed and 6 files / 57 tests passed.
- AC-2: Node 24.20.0 generated the Harness DSL without a source diff; the
  focused compatibility suite passed 2 tests.
- AC-3: `npm run check` passed: root 1,667 passed / 2 skipped, Harness 181,
  Studio 507, Dashboard 57, and package verification 647/909 entries.
- Additional CI parity: Dashboard production build, both native DSH smoke
  suites, and the documentation link graph test passed.
- AC-4: pending the pushed GitHub Actions receipt.
