# Better Harness host runtime contract

## Traceability

- Spec ID: `better-harness-host-runtime-contract`
- Status: Draft
- Story: Pi Agent and WorkBuddy plugin completion

## Intent

Provide one host-neutral contract for preparing evidence, running exactly three
independent read-only specialist passes, validating their returns, and handing
the result to the existing lead reconciliation and renderer. The contract must
keep unsupported capability and privacy boundaries visible instead of treating a
successful collector call as complete coverage.

## Acceptance Scenarios

- **HRC-AC-01:** A prepared run contains exactly three named lanes: session
  evidence, project harness, and agent customize; each lane has a distinct
  bounded input hash.
- **HRC-AC-02:** `verify-run` accepts exactly three successful structured
  results, rejects duplicate lane/context identities, and rejects a result that
  contains another lane's input or raw collection references.
- **HRC-AC-03:** Normal runs block on any unavailable or partial specialist;
  quick runs preserve the gap and lower confidence without inventing a result.
- **HRC-AC-04:** Provider coverage states and session schema diagnostics reach
  the final Evidence Boundary; unsupported and unobserved are never rendered as
  zero or absent capability.
- **HRC-AC-05:** Durable artifacts contain no raw session IDs, home paths,
  prompts, credentials, or private temporary run paths.
- **HRC-AC-06:** Temporary run data is removed on success, cancellation, timeout,
  and validation failure.

## Non-goals

- No new scoring model or replacement renderer.
- No automatic reads of WorkBuddy binary stores or private Memory bodies.
- No remote publication, npm release, Marketplace submission, or Git push.

## Plan and Tasks

1. Add a typed run-plan/result contract under `scripts/harness-analysis` with
   lane allowlists, input hashes, execution identity, coverage state, and
   quick/normal failure policy.
2. Add advanced CLI routes for host doctor, run preparation, and run
   verification. Keep private lane payloads in an explicitly supplied temporary
   output directory and keep stdout metadata-only.
3. Thread provider `coverage` and `schemaDiagnostics` through inventory,
   evidence-bundle, report-run, and report-quality without changing existing
   renderer field semantics.
4. Add contract tests for isolation, duplicate contexts, malformed results,
   coverage propagation, privacy redaction, and cleanup.

## Test and Review Evidence

- Focused unit tests must map each HRC AC to a test name.
- `npm test`, `npm run pack:verify`, `node scripts/doc-link-graph/cli.mjs skills/better-harness`,
  `node --test test/doc-link-graph.test.mjs`, and `git diff --check` are required
  before implementation is marked complete.
- Host-specific specs must provide real Pi and WorkBuddy smoke evidence for the
  execution identity and final renderer status.

## Risk

The main risk is confusing transport success with semantic coverage. The run
contract therefore carries an explicit coverage state and blocks normal reports
when an owner is unavailable.
