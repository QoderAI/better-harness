# Compact contextual commits in the Inspector

## Traceability

- Spec ID: inspector-contextual-commit-compaction
- Status: Implemented
- Extends the evidence presentation contract in
  [inspector-evidence-selection](2026-08-12-inspector-evidence-selection.md).

## Intent

Date view can contain many local Git commits that have no directly linked
coding-agent session. Merge commits commonly have no retained changed paths,
so rendering every contextual commit as a fully open card spends most of the
delivery lane on empty file panels and pushes useful evidence below the fold.

Keep those commits visible, but present weak contextual evidence in a compact
form by default. Directly linked delivery evidence remains open so the default
layout continues to prioritize what the Inspector can actually attribute.

## Acceptance Scenarios

- AC-1: A commit whose lane evidence is `contextual` or `file-context` starts as
  a one-line disclosure containing its hash, subject, evidence kind, and stats;
  this includes ordinary unlinked and merge commits without relying on subject
  text to classify them.
- AC-2: Opening a compact commit reveals the same retained file tree or bounded
  empty state that the existing full card exposes.
- AC-3: Selecting the compact commit still selects that commit and opens its
  explainable evidence path; disclosure state does not change evidence meaning.
- AC-4: Direct, observed, candidate, and declared commit evidence starts
  expanded, but every commit card can be collapsed independently so a long
  changed-file list cannot dominate the delivery lane.
- AC-5: The compact disclosure exposes native keyboard and expanded-state
  semantics, and the delivery lane labels how many commits start compact.
- AC-6: Opening Checkpoint Activity automatically collapses that workbench's
  delivery lane so the timeline receives the available width. The reviewer can
  reopen Commits / files while Activity stays open, and closing Activity does
  not force another layout change.
- AC-7: While the page scrolls, the sticky workspace header paints above the
  workbench lanes with an opaque surface, so lane dividers and resizers never
  show through or overlap the header boundary.

## Non-goals

- Inferring the current developer's identity from a Git author name.
- Hiding, deleting, or filtering contextual commits from the report.
- Changing commit-session correlation or upgrading contextual evidence.
- Remembering disclosure state across page reloads.

## Plan and Tasks

- Keep evidence classification in the existing delivery-lane projection.
- Render every commit card as a `details` disclosure: contextual and same-file
  evidence starts closed, while stronger evidence starts open.
- Add compact layout styles and a visible compact-count label.
- Reuse the delivery-lane collapse owner when Checkpoint Activity opens; keep a
  manual delivery-lane toggle authoritative after that open transition.
- Give the sticky workspace header a higher stacking layer than workbench lane
  resizers and an opaque background that cannot reveal scrolled content.
- Add focused behavior coverage for the evidence-kind presentation policy and
  verify the real self-contained report in a browser at desktop width.

## Test and Review Evidence

- AC-1/AC-4: focused tests call the commit presentation policy with contextual,
  same-file, direct, observed, candidate, and declared evidence kinds.
- AC-2/AC-3/AC-5: browser verification inspects the generated report's native
  disclosure state, expansion, commit selection, Evidence Drawer, and layout.
- AC-7: browser verification scrolls a three-lane workbench beneath the sticky
  header and checks the visible boundary plus computed stacking/background.
- Regression: run the focused Inspector test file, the documentation-link graph
  test, `npm test`, and `git diff --check`.

## Risks

- Discoverability: every compact row retains hash, subject, evidence label, and
  stats, while the delivery header reports the compact count.
- Evidence semantics: compaction follows the evidence kind, not merge-subject or
  author-name heuristics, so presentation cannot imply authorship.
- Accessibility: native `details`/`summary` behavior supplies keyboard toggling
  and the expanded-state contract without a parallel custom state machine.
