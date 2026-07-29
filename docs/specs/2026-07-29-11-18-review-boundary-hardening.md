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
  events/show, facets, insights, file-reads, and usage-summary. A matching
  record cannot authorize foreign-cwd records from the same home session, and
  cwd-less records require a workspace-linked session source instead of being
  assigned to the requested workspace. An explicit global-capability pass can
  retain home-only sessions only as `user-global` evidence.
- AC-03 (#13): `report --no-sessions` executes no session probe and always uses
  the static `software-fluency` route even when local sessions exist.
- AC-04 (#14): Blast-radius collection distinguishes an invalid/unavailable
  base ref from a real empty diff and returns an explicit fail-closed error.
- AC-05 (#15): review-trigger argument, Git worktree probes, and runtime
  failures exit non-zero while successful findings retain their documented
  non-blocking result.
- AC-06 (#16): `report --cwd` rejects empty, missing, and non-directory targets
  before starting evidence collectors; valid-directory fallback behavior
  remains available.
- AC-07 (#17): findings repair never lowers `Critical` or arbitrary unknown
  severity to `Medium`; unsupported values fail closed or use an explicit
  conservative mapping.
- AC-08 (#18): Git-backed cloc never follows a tracked path to a target outside
  the repository, reads a non-regular file, or reads a regular file beyond the
  configured size boundary; skipped results remain bounded and do not reveal
  the external target.
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
3. Apply workspace ownership at both Qoder home-session discovery and per-event
   hydration, keeping explicit `user-global` behavior separate.
4. Make quickstart privacy and empty/missing cwd validation explicit at its CLI
   boundary.
5. Replace Git diff ambiguity with a structured failure from blast-radius
   collection.
6. Separate review-trigger argument, Git-probe, and execution failures from
   successful non-blocking findings.
7. Make severity repair conservative and make cloc file reads type-, size-,
   and containment-aware.
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
  including mixed-cwd, cwd-less, and explicit user-global home-session cases
- AC-03 and AC-06:
  `node --test test/harness-quickstart.test.mjs test/better-harness-cli.test.mjs`
- AC-04:
  `node --test test/blast-radius.test.mjs`
- AC-05:
  `node --test test/review-trigger.test.mjs`, including a non-Git directory
- AC-07:
  `node --test test/harness-findings-repair.test.mjs test/harness-report-render-cli.test.mjs`
- AC-08:
  `node --test test/cloc.test.mjs`, including an oversized regular file
- AC-09:
  `npm test`
  `npm run pack:verify`
  `node --test test/doc-link-graph.test.mjs`

Review evidence:

- Review follow-up (2026-07-29): mixed-cwd and cwd-less home-session hydration,
  explicit user-global analysis, failed Git worktree probes, empty `--cwd=`,
  and bounded cloc reads are covered by regressions and resolved before merge.
- `npm run check` passed with the full Node suite and package verification.
- The review follow-up focused run passed 80 tests across Qoder session
  analysis, session usage summary, review-trigger, quickstart, and cloc;
  syntax and diff checks also passed.
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
