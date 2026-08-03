# Keep secret-scan file identity checks portable

## Traceability

- Spec ID: windows-file-identity
- Review: QoderAI/better-harness#39 CI follow-up after rebasing onto main
- Status: Implemented

## Intent

Keep the secret scanner's open-time file identity guard fail-closed while
accepting an unchanged regular file on Windows, where `lstat` can expose an
unavailable zero device id and the opened handle can expose the real device id.

## Acceptance Scenarios

- AC-1: A clean explicit regular file scans with complete coverage and exit 0
  on Windows, macOS, and Linux when its non-zero inode remains unchanged.
- AC-2: Different non-zero inodes fail identity validation.
- AC-3: When both observations expose non-zero device ids, different devices
  fail identity validation; a zero device id on only one observation is treated
  as unavailable rather than contradictory.
- AC-4: When inode identity is unavailable, the existing conservative metadata
  comparison remains required.
- AC-5: Symlink, containment, no-follow, and coverage-gap behavior remains
  unchanged.

## Non-goals

- Relax path containment or follow symbolic links.
- Treat mismatched non-zero identity fields as equivalent.
- Change secret detection rules or public diagnostics.

## Plan and Tasks

1. Compare non-zero inode identity first and compare device ids only when both
   observations provide them. (AC-1..AC-3)
2. Preserve the metadata fallback when inode identity is unavailable. (AC-4)
3. Run the focused secret-scan suite, complete repository suite, and Windows CI.
   (AC-1..AC-5)

## Test and Review Evidence

- Focused regression:
  `node --test test/agent-guardrails-secret-scan.test.mjs` must restore the clean
  explicit-file case without changing link and containment expectations.
- Complete validation: `npm test`, `npm run pack:verify`, and `git diff --check`.
- Baseline evidence: on the current Windows host, one unchanged file reported
  the same non-zero inode through both observations while `lstat.dev` was `0`
  and the opened handle's `stat.dev` was non-zero; the pre-change CLI exited 3
  with `scan target changed while it was being opened`.

## Implementation Evidence

- `sameFileIdentity` now rejects different non-zero device ids, then requires
  matching inodes whenever either observation exposes one, so a zero inode on
  only one side stays contradictory. A zero device id on one observation no
  longer contradicts the matching inode. The existing metadata fallback applies
  only when neither observation exposes an inode.
- `node --test test/agent-guardrails-secret-scan.test.mjs` passed 18 tests with
  0 failures and 3 symlink-permission skips. The formerly failing clean explicit
  file case now reports complete coverage and exit 0.
- The full repository run also passed the clean-file regression; its only 4
  remaining failures are separate tests whose symlink fixtures cannot be
  created under this local Windows permission profile.
