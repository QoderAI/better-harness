# Better Harness desktop package naming

## Traceability
- Spec ID: better-harness-desktop-rename
- Status: Implemented
- Request: commit NSXPC work, then rename harness-desktop to better-harness-desktop.

## Intent
Use better-harness-desktop consistently for the desktop workspace directory,
npm package, root commands, CI routing and internal desktop identifiers.

## Acceptance Scenarios
- AC-1: The workspace is packages/better-harness-desktop and its npm identity is
  @qoder-ai/better-harness-desktop; npm resolves the renamed workspace.
- AC-2: Root better-harness-desktop commands, desktop CI, native tests and
  documentation use the new paths and package name.
- AC-3: Desktop tests, native integration tests, packaging and packaged macOS
  smoke work after moving the directory.

## Non-goals
Changing Harness Studio product branding, application IDs, Rust service IDs,
versions, compiler behavior or the separate Studio UI changes in the worktree.

## Plan and Tasks
- Commit the completed Apple NSXPC implementation separately.
- Move the desktop package and CI file; update known references, workspace lock
  entries, desktop diagnostics/session identifiers, and documentation paths.
- Refresh npm workspace links, rebuild and validate the new entry points.

## Test and Review Evidence
- Prior NSXPC work committed separately as `49faf7c`.
- AC-1: `npm install --ignore-scripts --offline --no-audit --no-fund` refreshed
  the workspace link. `npm ls @qoder-ai/better-harness-desktop --depth=0` and
  parsed manifest/lock/realpath checks all resolve the new directory.
- AC-2/AC-3: `npm run better-harness-desktop:test`: 6 passed;
  `npm run test:native -w @qoder-ai/better-harness-desktop`: 16 passed.
- AC-3: `npm run better-harness-desktop:pack` passed. The first shared-worktree
  smoke timed out on networkidle because an active Studio dev watcher injected
  its 250ms polling script into shared build output. A detached checkout of
  `49faf7c` plus only the rename diff produced an isolated package. It reused
  dependency/Cargo caches, with independent source, app output and staging.
  The resulting app was copied into the renamed workspace's installer directory.
  `npm run smoke -w @qoder-ai/better-harness-desktop -- --packaged` then passed:
  main PID 44079, Studio PID 44128, bridge PID 44130, native service PID 44131;
  transport nsxpc, no OXC NAPI, renderer sandbox/authentication/directory flow
  and shutdown passed, with no page errors. Runtime Node was 24.20.0.
- The normal workspace build ran under Node 24.18.0. The isolated checkout's
  shell selected Node 26.8.1 and staging emitted engine warnings; packaged
  runtime validation still used Electron's supported Node 24.20.0.
- Documentation routing regeneration produced no graph diff; doc-link tests:
  8 passed. `npm run preview` health and canvas-module endpoints returned 200;
  the owned preview process was stopped. `git diff --check` passed.

## Review Readiness

The request, spec and renamed workspace/CI/test/documentation references align.
All 23 moved desktop files were compared against the prior commit with only the
specified name substitutions; Rust implementation files are byte-identical.
Lockfile changes only move workspace identity and link entries. Historical specs
receive current paths/commands so references remain usable; original command
receipts remain in git history. Separate Studio UI edits were neither changed
nor included in the NSXPC commit or isolated package. Rename changes remain
uncommitted. Windows/Linux CI execution is outside local macOS proof.
