# Browse workspace commit history

## Traceability

- Spec ID: studio-commit-view
- Status: Implemented (automatic pagination follow-up; Windows CI receipt pending)

## Intent

Better Harness Studio organizes evidence around Intent, Session, Commit, and
Artifact. Add a read-only Commit workbench for the currently opened local
workspace so a reviewer can trace Session activity and produced Artifacts back
to repository history without leaving Studio.

The interaction is based on the Git Log panel in `/Users/phodal/ai/routa-js`:

- `git-log-panel.tsx` owns the docked refs, log, and detail layout;
- `refs-tree.tsx` exposes HEAD, local branches, remote branches grouped by
  remote, and tags as reachability filters;
- `commit-list.tsx` exposes a graph, ref labels, summary, author, date, hash,
  selection, and incremental loading;
- `commit-detail-panel.tsx` exposes the full message, author, timestamp,
  parents, changed-file states, and line totals;
- `use-git-log.ts` owns refresh, search debounce, branch-filter state,
  selection, detail loading, and pagination;
- `/api/git/refs`, `/api/git/log`, and `/api/git/commit` provide the real Git
  adapter contract.

Routa's April 2026 incident record also establishes required failure guards:
commit records must not be split by multiline messages, workspace/ref changes
must not create reload loops, and local/remote branch filters must use the same
contract. Better Harness retains those behaviors but binds every Git read to
the server-owned open workspace instead of accepting an arbitrary client path.

## Acceptance Scenarios

- AC-1: When the opened local workspace is a Git repository, Studio navigation
  presents a Commit workbench and identifies the current branch without
  exposing the absolute repository path.
- AC-2: The refs pane lists current HEAD, local branches, remote branches
  grouped by remote, and tags. Selecting any combination filters the log to
  commits reachable from those exact refs; clearing filters restores all refs.
- AC-3: The commit table renders date-ordered history with a stable topology
  graph, ref labels, summary, author, relative date, and short hash. It loads a
  bounded first page and can request later pages without duplicates.
- AC-4: Search matches commit hash, subject, author name, or author email and is
  safe for multiline commit bodies. Empty repositories and zero matches render
  an explicit empty state instead of an indefinite loader.
- AC-5: Selecting a commit renders its full message, immutable author/time/hash
  metadata, parents, changed-file status, rename origin, additions, and
  deletions. Selecting a changed text file renders that commit's patch; binary
  or unavailable patches retain an honest no-diff state.
- AC-6: All Git operations are read-only, workspace-scoped, argv-based, bounded,
  and work on Windows, macOS, and Linux. Invalid refs, revisions, limits, or
  unavailable repositories return stable client errors without leaking the
  workspace's absolute path or raw Git stderr.
- AC-7: The wide layout uses refs, log, and detail panes; compact and narrow
  layouts preserve the log as the primary decision surface and expose refs and
  detail through bounded responsive panes. Keyboard focus, selection semantics,
  overflow, and loading/error states remain usable.
- AC-8: Opening another workspace invalidates Commit state and reloads refs and
  history for the new repository without carrying prior filters or selection.
- AC-9: A workspace selected anywhere inside a Git worktree resolves one
  canonical repository root. Commit paths, repository labels, details, and
  patches use that root consistently without broadening any non-Git Studio
  capability.
- AC-10: Merge commit details and patches compare against the first parent by
  default, so a merge never reports zero changed files merely because Git's
  default combined-diff presentation omitted them.
- AC-11: History pagination uses an opaque continuation cursor, keeps the graph
  stable across pages, exposes an honest 5,000-row presentation cap, and leaves
  already loaded commits usable when a later page fails. A failed automatic page
  load pauses further attempts until the user explicitly retries.
- AC-12: The ordinary refs -> first history page -> commit -> patch flow reuses
  workspace refs and commit detail instead of repeating full Git reads. Git
  execution failures remain sanitized errors and are never converted into an
  empty repository result.
- AC-13: The commit table virtualizes accumulated rows and automatically requests
  the next cursor page as the final loaded rows enter the viewport at wide,
  compact, and narrow widths. It exposes loading progress without a manual Load
  more action, keeps an explicit Retry action after failure, and labels search
  according to its actual subject/hash/author contract.
- AC-14: Git repository labels and their test fixtures derive native filesystem
  basenames with the host path implementation. Windows drive-letter and
  backslash paths never become the full repository label, while browser-facing
  payloads still redact the absolute repository root on every platform.
- AC-15: Commit topology uses the fixed categorical scale without assigning the
  primary interaction blue to the default lane. A lane keeps one recognizable
  color across its line and node, merge nodes remain distinguishable without
  color alone, and the node cutout follows normal, hover, and selected row
  surfaces in both dark and light themes.

## Non-goals

- Checking out, creating, renaming, merging, rebasing, resetting, deleting, or
  pushing branches.
- Staging files, editing the working tree, creating commits, or resolving merge
  conflicts.
- Fetching from remotes or claiming that locally cached remote refs are current.
- Multi-repository selection inside one Studio workspace. Studio's existing
  workspace chooser remains the repository boundary.
- Mapping individual Session events to commits without explicit retained
  evidence that establishes that relation.
- Reproducing Routa's Tailwind styling or its simplified two-lane merge graph.

## Plan and Tasks

1. Define a versioned, browser-safe Git history model for refs, paged commits,
   graph edges, commit details, changed files, and per-file patches.
2. Add one capability-owned server module that executes `git` with argv arrays,
   parses NUL/unit-separated records, validates refs and SHAs, applies bounded
   pagination/search, and computes graph lanes from parent topology.
3. Mount workspace-scoped read routes for repository status, refs, log, commit
   detail, and file patch. The server resolves the repository from its own
   selected-workspace state; browser requests never send a filesystem path.
4. Add a Commit destination and workbench to the existing Studio shell. Keep
   the central log primary, use Phosphor icons and shared semantic tokens, and
   preserve current Artifact Preview worktree changes.
5. Add behavior tests for Git parsing, ref filtering, pagination, multiline
   messages, rename/binary stats, invalid input, workspace switching, shell
   availability, and UI-visible model helpers.
6. Run focused type/build/tests, the repository's preview smoke checks, and
   Playwright review at wide, compact, and narrow widths with console/page-error
   inspection and screenshots outside tracked source.
7. Resolve and retain the canonical Git root when a workspace opens; define
   first-parent merge comparison once and reuse it for status, stats, and patch.
8. Replace offset pagination with a query-bound continuation cursor carrying
   graph lane state. Reuse the refs snapshot and a bounded commit-detail cache,
   stop cleanly at 5,000 visible rows, and preserve prior pages on failure.
9. Virtualize commit rows with the existing TanStack dependency, trigger cursor
   pagination when the virtualized viewport reaches the final loaded rows, retain
   explicit retry after a page failure, give the log grid stable
   toolbar/status/content/footer rows, and make search copy honest.
10. Remove POSIX-only path splitting from the Git history fixture and document
    the repository-wide boundary between native filesystem paths, portable
    protocol paths, line endings, and shell execution.
11. Reorder existing categorical tokens for Git lanes, make segment opacity
    consistent around nodes, render a redundant merge ring, and bind the node
    cutout to the actual row state rather than the workspace background.

## Test and Review Evidence

- AC-1, AC-6, AC-8: server tests using temporary Git repositories and two
  independently initialized workspaces; assert response shapes, redaction, and
  workspace rebinding.
- AC-2, AC-3, AC-4: Git history unit tests with local branches, a bare remote,
  tags, a merge, multiline bodies, search, and page boundaries.
- AC-5: server/model tests for modified, added, deleted, renamed, and binary
  files plus exact file-patch selection.
- AC-1, AC-7: Studio shell model tests and Playwright navigation, keyboard,
  responsive-overflow, console, and screenshot evidence.
- Focused commands:
  - `npm run build --workspace @qoder-ai/harness-studio`
  - `npm exec --workspace @qoder-ai/harness-studio -- vitest run test/git-history.test.ts test/git-history-server.test.ts test/studio-shell-model.test.ts`
  - `npm exec --workspace @qoder-ai/harness-studio -- playwright test test/browser/git-history.spec.mjs`
  - `npm run preview`, then request `http://localhost:58575/health` and
    `http://localhost:58575/canvas-module.js`
- Risk: Git output is adversarial structured data. Delimiter-safe parsing,
  exact ref allowlisting, bounded buffers/results, revision validation, and
  stderr redaction are required before the route can be considered implemented.
- Risk: the base branch includes separately committed Artifact Preview work in
  the Studio shell and server. Keep Commit View review evidence scoped to the
  files and tests listed here rather than treating adjacent history as proof.
- AC-9, AC-10: add nested-worktree and merge-first-parent fixtures that assert
  non-empty, exact patches.
- AC-11, AC-12: assert cursor query binding, page uniqueness, the 5,000-row
  terminal receipt, cached HTTP reads, and sanitized Git execution failures.
- AC-11, AC-13: scroll the virtualized browser table to trigger the next page
  without a manual action, inject one page failure, explicitly retry, and inspect
  DOM bounds at wide, compact, and narrow widths.
- AC-14: run the Git history fixture on the host-native path implementation and
  retain the GitHub Actions Windows job as the authoritative backslash/drive
  receipt; local non-Windows runs are supporting evidence, not Windows proof.
- AC-15: inspect computed SVG fill/stroke and merge-node structure in Playwright,
  then review wide, compact, and narrow screenshots plus a light-theme wide
  screenshot for lane identity, row-state cutouts, contrast, and console/page
  errors.

## Implementation Evidence

- AC-1 through AC-6 and AC-8 through AC-12: `git-history.test.ts`,
  `git-history-server.test.ts`, and the full Harness Studio Vitest suite pass
  with real temporary Git repositories (`24` files, `151` tests). The focused
  Git contract suite passes `8` tests, including nested worktrees, first-parent
  merge detail/patch, signed cursor binding, Git failures, and the 5,000-row
  terminal cap.
- AC-2 through AC-5, AC-7, AC-11, and AC-13: `git-history.spec.mjs` passes a
  real browser flow for ref filtering, author search, automatic cursor pagination
  at the virtualized scroll boundary, explicit retry after an injected page
  failure, bounded virtual rows, commit/file selection, and patch rendering at
  `1440x960`, `900x760`, and `390x844` with no unexpected console/page errors or
  horizontal overflow. The injected 422 page failure produces one expected
  browser resource error and leaves prior rows usable.
- The current `better-harness` repository was paged through all `326` reachable
  commits: order exactly matches `git log --date-order`, all SHAs are unique,
  `59` merges retain valid graph edges, and no commits are omitted.
- A fresh local HTTP run measured refs at `21.1 ms`, first 40-row history at
  `33.4 ms`, the next page at `16.8 ms`, commit detail at `34.5 ms`, and the
  cached-detail patch route at `11.0 ms` on this checkout. These timings are
  observational, not a cross-machine performance threshold.
- AC-14: the Git fixture now derives the expected repository label with native
  `node:path.basename` instead of POSIX-only string splitting. The focused Git
  history suite passes (`7` tests), Studio typecheck passes, the full Studio
  suite passes (`24` files, `151` tests), and the doc-link suite passes (`8`
  tests). A post-change Windows Actions run has not yet been observed, so this
  is implemented locally but not claimed as fresh Windows CI proof.
- AC-15: the browser verifies that lane zero resolves to categorical amber
  rather than the primary interaction blue, active and outgoing segments keep
  at least `0.8` opacity, merge commits render a redundant double ring, and the
  node cutout exactly matches selected-row backgrounds in dark and light
  themes. Wide dark/light, compact, and narrow screenshots were reviewed. The
  clean candidate passes the full Studio suite (`24` files, `151` tests), the
  focused Git browser scenario, the doc-link suite (`8` tests), and
  `git diff --check`.
- The automatic pagination follow-up passes Studio typecheck/build, the focused
  Git contract and shell suite (`3` files, `14` tests), the focused Git browser
  scenario, preview smoke checks for `/health` and `/canvas-module.js`, and
  `git diff --check`. The full Studio unit suite was also run: `37` files and
  `233` tests pass, while two unrelated DOCX/XLSX artifact-server descriptor
  expectations fail against the configured Qoder Canvas adapters.
- Windows CI remains pending; the local macOS verification does not establish a
  fresh cross-platform receipt.
