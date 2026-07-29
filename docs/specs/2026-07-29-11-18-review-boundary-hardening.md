# Fail-Closed Review and Privacy Boundaries

## Traceability

- Spec ID: review-boundary-hardening-11-18
- Story: #11, #12, #13, #14, #15, #16, #17, #18
- Status: Implemented

## Intent

Make Better Harness honor its declared privacy controls and fail closed when
review, filesystem, or report-integrity boundaries cannot be verified. The
change fixes eight independently reproduced High findings without expanding
the product surface or changing successful-path report semantics.

## Acceptance Scenarios

- AC-01 (#11): Secret Guard normalizes supported snake_case and camelCase tool
  payloads, scans secret-bearing Write/Edit/apply_patch content, blocks
  synthetic secrets without echoing them, and preserves existing Bash/path
  decisions.
- AC-02 (#12): Workspace-scoped Qoder analysis excludes home-only sessions that
  have no verified relationship to the requested workspace across sessions,
  events/show, facets, insights, file-reads, and usage-summary.
- AC-03 (#13): `report --no-sessions` executes no session probe and always uses
  the static `software-fluency` route even when local sessions exist.
- AC-04 (#14): Blast-radius collection distinguishes an invalid/unavailable
  base ref from a real empty diff and returns an explicit fail-closed error.
- AC-05 (#15): review-trigger argument and runtime failures exit non-zero while
  successful findings retain their documented non-blocking result.
- AC-06 (#16): `report --cwd` rejects missing and non-directory targets before
  starting evidence collectors; valid-directory fallback behavior remains
  available.
- AC-07 (#17): findings repair never lowers `Critical` or arbitrary unknown
  severity to `Medium`; unsupported values fail closed or use an explicit
  conservative mapping.
- AC-08 (#18): Git-backed cloc never follows a tracked path to a target outside
  the repository or reads a non-regular file; skipped results remain bounded
  and do not reveal the external target.
- AC-09: Focused tests, the full Node test suite, package verification, syntax
  checks, and review-readiness checks pass on Linux-compatible local tooling;
  cross-platform path behavior remains covered by portable fixtures.

## Non-goals

- Do not redesign report scoring, add a new severity level to the public
  findings schema, or alter valid High/Medium/Low findings.
- Do not add authentication or network sharing to Canvas preview.
- Do not change the Medium large-untracked-file finding or architecture
  watchlist items from the originating review.
- Do not add dependencies.
- Do not refactor unrelated session, report, or Git-analysis behavior.

## Plan and Tasks

1. Add failing regression tests for each issue before changing implementation.
2. Normalize Secret Guard tool events once, then scan only the content fields
   owned by matched write tools.
3. Apply one workspace-ownership predicate to Qoder home-session discovery and
   hydration, keeping explicit global behavior separate.
4. Make quickstart privacy and cwd validation explicit at its CLI boundary.
5. Replace Git diff ambiguity with a structured failure from blast-radius
   collection.
6. Separate review-trigger execution failure from successful non-blocking
   findings.
7. Make severity repair conservative and make cloc file reads type- and
   containment-aware.
8. Run focused tests per module, then the complete repository checks.
9. Perform independent code-review and architecture lanes, address all
   Critical/High findings and any architectural Block, then run Review
   Readiness before commit and PR.

Decision rationale:

- Fail closed only when the tool cannot establish the requested boundary;
  preserve supported fallback behavior for valid inputs with partial evidence.
- Prefer small checks at existing owner boundaries over new shared abstraction
  layers.
- Use synthetic credentials and temporary repositories only; tests must not
  retain private prompts, paths, or secrets.

## Test and Review Evidence

- AC-01:
  `node --test test/agent-guardrails-secret-scan.test.mjs`
- AC-02:
  `node --test test/session-analysis.test.mjs test/session-usage-summary.test.mjs`
- AC-03 and AC-06:
  `node --test test/harness-quickstart.test.mjs test/better-harness-cli.test.mjs`
- AC-04:
  `node --test test/blast-radius.test.mjs`
- AC-05:
  `node --test test/review-trigger.test.mjs`
- AC-07:
  `node --test test/harness-findings-repair.test.mjs test/harness-report-render-cli.test.mjs`
- AC-08:
  `node --test test/cloc.test.mjs`
- AC-09:
  `npm test`
  `npm run pack:verify`
  `node --test test/doc-link-graph.test.mjs`

Review evidence:

- `npm run check` passed with 852 tests and package verification.
- The final blocker-focused run passed 68 tests across Secret Guard,
  review-trigger, blast-radius, and cloc; syntax and diff checks also passed.
- Code-reviewer recommendation: `APPROVE` after both reported High findings
  were fixed and re-reviewed.
- Architect status: non-blocking `WATCH`; the previous fail-open `BLOCK` was
  resolved. The remaining watch is limited to the concurrent swap-to-symlink
  race on platforms where `O_NOFOLLOW` is unavailable.
- The final diff must contain no generated runtime state, credentials, or
  unrelated source changes.

Risk notes:

- Qoder home-session filtering can reduce previously over-broad results; tests
  must prove verified workspace sessions remain visible.
- Hook exit-code changes can expose previously hidden configuration errors;
  success-path non-blocking tests guard the intended contract.
- Symlink policy differs by platform; fixtures must avoid requiring privileged
  symlink creation where the platform does not support it.
