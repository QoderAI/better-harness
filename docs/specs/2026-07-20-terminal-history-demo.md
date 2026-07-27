# Generalize the terminal history demo

## Traceability

- Spec ID: terminal-history-demo
- Status: Implemented

## Intent

Make the terminal history animation a project-neutral Better Harness development
tool. It should discover current report roots for one workspace or read
explicitly supplied host-specific roots without mixing unrelated projects.

## Acceptance Scenarios

- AC-1: The primary entrypoint and documentation use the Better Harness name;
  no pre-public compatibility wrapper remains.
- AC-2: With `--workspace <project>`, or the current working directory by
  default, discovery reads existing `.qoder/better-harness` and
  `.codex/better-harness` report roots. It may recognize the same product
  directory names below another first-level hidden host directory.
- AC-3: Repeated `--history-root <path>` arguments bypass workspace discovery,
  expand `~`, and may point directly at paths such as
  `~/.qoder/better-harness` or `~/.xx/better-harness`. Missing roots produce a
  concise diagnostic that names the attempted scope.
- AC-4: When multiple current host roots exist for one workspace, their valid
  `findings.json` runs form one chronological history with duplicate file paths
  removed. Report-contract boundaries remain visible and source artifacts are
  never rewritten.
- AC-5: `--limit` and repeatable `--omit-zero <dimension-id>` remain available.
  Omitted zero anomalies do not appear in that dimension's trend, while the scan
  and its other dimension scores remain present. The display reports the number
  of omitted values without rewriting source artifacts.
- AC-6: `--since <yyyy-mm-dd>` includes only runs dated on or after that local
  report date, composes predictably with `--limit`, and rejects malformed dates.
  A filter that matches no runs fails with a concise diagnostic instead of
  rendering an empty or misleading animation.

## Non-goals

- Adding this development demo to the packaged production CLI.
- Scanning the entire home directory or combining histories from different
  projects automatically.
- Rewriting, deleting, translating, or repairing historical report artifacts.
- Creating an averaged headline score or changing the Agent Work Loop model.

## Plan and Tasks

1. Keep `dev/terminal-demo/play-better-harness-history.mjs` as the only demo
   entrypoint.
2. Add cross-platform home expansion, workspace root discovery, repeated
   explicit roots, chronological merging, and duplicate suppression.
3. Update focused fixtures for current Qoder and Codex roots, explicit home
   paths, zero-outlier gaps, and error behavior.
4. Update recording documentation and regenerate the English `twenty` GIF from
   the generic entrypoint.
5. Add a date-bounded history selector and use `--since 2026-07-17` for the
   public Twenty recording so earlier known-bad Learning Capture scores are not
   part of the displayed trend.

## Test and Review Evidence

- AC-1/AC-3: inspect `--help`; run the generic entrypoint against the explicit
  `twenty/.qoder/better-harness` root and confirm the project name comes from the
  report rather than the script.
- AC-2/AC-4: run `node --test test/terminal-demo.test.mjs` with temporary
  current Qoder and Codex report roots; assert chronological merge and no
  duplicate files.
- AC-5: assert Learning Capture zero values are absent from its trend, their
  scans remain available to other dimensions, and the omitted count is visible;
  inspect the regenerated GIF final frame.
- AC-6: assert an inclusive date boundary, composition with `--limit`, invalid
  date rejection, and the no-matching-runs diagnostic.
- Risk: broad discovery could mix projects or traverse unrelated host state.
  Mitigate by limiting automatic discovery to one workspace's first-level
  hidden host directories and known product directory names.
- Risk: a stale recording command could point at a developer-specific path.
  Mitigate with portable documentation examples and the tracked generated GIF.

## Implementation Evidence

- The only entrypoint is `play-better-harness-history.mjs`.
- Focused tests cover workspace discovery across current Qoder/Codex roots,
  chronological merging, explicit `~` expansion,
  contract boundaries, zero-outlier omission, and inclusive date selection. All
  seven tests pass.
- A live static run with `--since 2026-07-17` selected seven `twenty` reports
  from July 17 through the latest July 20 scan. The earlier known-bad Learning
  Capture zero scores were outside the selected history, so the rendered trend
  needed no anomaly markers or omission notice.
- A fresh asciinema recording rendered through `agg` to
  `assets/demo/twenty-history.gif`; visual inspection of the final frame
  confirmed the generic Better Harness identity, v23/v24 boundary, English
  Findings, and compressed Learning Capture trend.
- The Markdown link graph regenerated successfully and all five focused
  documentation-integrity tests passed.
