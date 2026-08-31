# Make commit files easier to scan

## Traceability

- Spec ID: harness-inspector-commit-file-browser
- Status: Implemented

## Intent

Make the Harness Inspector `Commits / files` pane readable when a commit changes
many files. File rows should use the familiar colored diff-stat convention,
keep correlation evidence at commit or activity scope instead of repeating it on
every path, and let readers switch between a flat file list and a collapsible
directory tree.

## Acceptance Scenarios

- AC-1: Every retained text-file row shows additions as a green `+N` value and
  removals as a red `-N` value; binary or unavailable stats remain explicitly
  labelled without implying numeric changes.
- AC-2: File rows do not repeat `edited before commit`, `same path`, or `commit`
  evidence labels. Commit/session evidence remains visible in the commit header
  and Checkpoint activity bridge.
- AC-3: The pane exposes keyboard-reachable `List` and `Tree` view controls with
  an announced selected state. List view shows full repository-relative paths;
  Tree view groups every directory level and allows branches to be collapsed.
- AC-4: A long commit file collection scrolls inside the `Commits / files` pane
  while the pane toolbar remains visible, so it does not make the adjacent
  prompt and activity lanes grow into large empty regions.
- AC-5: Wide, compact, and narrow layouts retain readable paths, visible focus,
  no document-level horizontal overflow, and no browser console or page errors.

## Non-goals

- Change commit-to-session correlation, attribution strength, or the report
  schema.
- Render file contents or a line-by-line patch.
- Persist the selected file view outside the current generated report page.
- Change Session View commit events or other repository browsers.

## Plan and Tasks

1. Replace the current first-directory grouping helper with shared diff-stat
   row rendering plus independent flat-list and recursive-tree renderers.
2. Add a pane-scoped List/Tree segmented control and preserve the selected view
   while the current report page rerenders its workbench scope.
3. Bound the delivery content height and make it an independent scroll region,
   with responsive behavior for stacked layouts.
4. Extend the Inspector browser visual gate to exercise the view switch,
   directory disclosure, diff-stat semantics, and long-list scroll boundary.

## Test and Review Evidence

- AC-1/AC-2: focused Inspector HTML/browser assertions verify semantic diff-stat
  classes and the absence of repeated per-file evidence labels.
- AC-3: Playwright activates Tree view, checks `aria-pressed`, and collapses a
  nested directory branch.
- AC-4: Playwright compares the delivery scroll extent with its bounded client
  height and confirms adjacent lanes are not stretched by the full file list.
- AC-5: `node scripts/harness-inspector/visual-contract-check.mjs --out <dir>`
  checks 1440x900, 1024x768, and 390x844 screenshots, keyboard focus, overflow,
  and browser errors.
- Risk: deeply nested or unusual Git paths can break visual hierarchy. Keep Git
  paths as portable `/`-separated report data, escape every rendered segment,
  and expose each full path through the row title.

Implemented evidence on 2026-08-31:

- `npx vitest run test/skills-docs/doc-link-graph.test.mjs test/reporting/harness-inspector.test.mjs`
  passed 47 tests.
- The visual contract gate passed all reachable surfaces at 1440x900, 1024x768,
  and 390x844 with zero overflow, clipped text, sub-12px text, or page errors.
- A freshly generated 2026-08-27 workspace report rendered the reported
  73-file commit in a 468px local scroller over 1,915px of content at 1440x900;
  it retained zero per-file evidence badges and zero document overflow.
