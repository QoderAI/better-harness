# Truthful Git History Window Coverage

## Traceability

- Spec ID: 195-history-window-coverage
- Story: [Issue #195, defect 1](https://github.com/QoderAI/better-harness/issues/195)
- Status: Implemented

## Intent

Keep bounded hotspot evidence from claiming complete time-window coverage when
Git history has not been exhausted. Coverage is separate from ranking confidence
and from similarity between hotspot arrays.

## Acceptance Scenarios

- AC-1: For real commits aged 150/75/10/5/1 days, a cap of 3 preserves the
  bounded counts [3,3,3], exposes additional history, marks the 90/180-day
  windows capped, and makes history-window-coverage review rather than ready.
  The 30-day window remains unknown: an older next commit cannot prove that
  later unscanned commits have older timestamps. A cap of 10 yields [3,4,5]
  with complete coverage and ready, even though ranking confidence can be low.
- AC-2: Naturally identical windows and history exactly equal to the cap remain
  complete when Git has no additional commits. Neither equality nor reaching
  the cap alone proves truncation. Only the requested number of commits
  contributes hotspot statistics; the extra probe is not analyzed.
- AC-3: The range exposes whether more scoped commits exist, whether the
  repository is shallow, and the minimum/maximum analyzed commit timestamps
  (ISO strings, null for empty history). Each window adds coverage status and
  reasons. Shallow history is unknown unless an omitted in-window commit proves
  capping. Non-monotonic timestamps must never establish false completeness.
- AC-4: Unborn repositories retain valid empty history-profile results; their
  coverage can be complete but the matrix requires observed scoped commits.
  The evidence pack's existing HEAD requirement is outside this fix. Skipped history retains
  stable window fields with skipped coverage and a review matrix result.
  Custom positive window sizes use their own coverage, including a single
  requested window, without requiring three default windows.
- AC-5: Coverage uses the same Git scope/pathspec as statistics. File ignores
  and language filters do not erase commit-limit evidence. Existing output
  fields and trend labels remain available; interpretation and canonical
  guidance explicitly qualify capped/unknown/skipped windows. A zero-count
  analyzed window describes the observed sample, not the absence of commits
  in unscanned history; this also holds for non-monotonic timestamps.

## Non-Goals

- Other defects or follow-up comments in issue #195; changes to scoring,
  project discovery, asset inventory, or existing PR #202.
- Fetching/deepening history, unbounded history scans, reconstructing omitted
  hotspots, or proving that all later commits predate a time boundary.
- Removing fields, new dependencies, UI changes, release metadata, pushing,
  publishing, creating a PR, or committing on the user's behalf.

## Plan and Tasks

1. Convert the supplied reproduction into behavior tests through the public
   analyzeGitHistoryProfile and buildEvidencePack seams in
   test/governance/core-change-watch.test.mjs; retain a real failing run.
2. In scripts/core-change-watch/git-history-profile.mjs, read at most cap + 1
   commits with the existing scoped Git argv, retain only cap for analysis,
   and inspect shallow state. The next commit can prove capping for a window;
   otherwise any remaining or shallow history leaves completeness unknown.
3. In scripts/core-change-watch/evidence-pack.mjs, require complete coverage
   and observed history for ready; expose coverage in matrix evidence and
   preserve the no-history schema fallback with skipped status.
4. Update the canonical [Core Change Watch guidance](../../references/project-harness/core-change-watch.md),
   regenerate the routing graph, run the focused, documentation, full test,
   and package gates, then perform standards/spec and traceability review.

## Test and Review Evidence

- Baseline: upstream/main 840ff549; supplied real-Git reproduction failed again
  on 2026-10-15 with truncated windows must not claim ready coverage.
- AC-1 red/green: `npx vitest run test/governance/core-change-watch.test.mjs
  -t 'capped history windows'` first failed with ready instead of review, then
  passed after the fix. The original reproduction also passed against the
  new worktree's modules (only its import paths changed).
- AC-1 through AC-5: `npx vitest run test/governance/core-change-watch.test.mjs`
  passed 34/34, including all seven new real-Git behavior regressions.
- AC-5 follow-up: independent review found that a capped/unknown zero-count
  sample still claimed no commits landed in the window. The new real-Git
  regression failed on that wording before the fix, then passed with observed
  sample wording for unknown/0 and capped/0, while a full scan found one commit.
  Incremental Standards and Spec reviews reported 0 new findings and confirmed
  the P2 closed.
- Documentation: `node scripts/doc-link-graph/cli.mjs skills/better-harness`
  regenerated an unchanged graph (39 files, 56 links);
  `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed 8/8.
- Full suite: `npm test -- --maxWorkers=4` passed 1789 tests, with 7 skipped
  (119 files passed, 1 skipped). The first default run failed two Node
  permission tests because a temporary dependency symlink escaped the
  worktree. With physical local dependencies, a second default run failed an
  unchanged Skill watcher's 3-second deadline; its isolated suite passed 9/9.
  These failures are retained in the local delivery logs, not counted as passes.
- Packaging: `npm run pack:verify` passed (747 npm entries, 1008 runtime ZIP
  entries). `git diff --check` passed. Commands above ran on macOS through
  `mise exec node@24.21.0 --`; Windows/Linux execution remains unverified.
- Independent read-only Standards and Spec AI reviews each reported 0 findings.
  The over-engineering review found no actionable deletion. Review Readiness
  confirmed this issue/spec/AC chain, five changed files, no generated graph
  drift, no staged changes, no unrelated metadata, and no new commit.
- Risk: one extra numstat commit is bounded overhead, not hotspot evidence.
  Unknown is intentionally conservative when a cap hides older traversal
  entries; no monotonic timestamp assumption is made. Scope and shallow
  restrictions describe accessible Git history, not remote completeness.
- Compatibility: additive coverage/range metadata; ready can become review.
  Existing labels describe requested horizons, not independent corroboration.
  No dependency or CLI flag changes. Revert the focused diff to recover.
- AI: Generated by Codex; independent AI review and local runtime receipts
  will be recorded here. No human technical review or three-platform execution
  is implied by local macOS checks.
