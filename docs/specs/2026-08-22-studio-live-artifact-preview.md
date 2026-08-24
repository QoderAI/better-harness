# Render live code artifacts in Studio

## Traceability

- Spec ID: studio-live-artifact-preview
- Status: Implemented

## Intent

Turn the code-backed half of Artifact View into a working, Studio-owned runtime.
An operator looking at a generated React artifact should see the rendered output,
see compile or runtime diagnostics when it is invalid, and receive a newer
revision without refreshing Studio after the artifact changes on disk.

The lifecycle for this increment is:

```text
Artifact Revision
  -> confined source project
  -> ArtifactCompileRuntime
  -> immutable ArtifactBuildSnapshot
  -> sandboxed ArtifactPreviewRuntime
  -> ArtifactViewHost commit
```

This is a Studio capability. It does not depend on Qoder Canvas and does not
broaden the existing Qoder Canvas compatibility bridge.

## Decisions

### D-1: TSX and JSX use the code-backed lifecycle

Studio resolves `.tsx` and `.jsx` artifacts to the `studio.react-preview`
renderer with `backing: code`. Other code extensions remain inert source views
until their executable contract is specified. The preview pane keeps an
explicit Source view so rendered output never hides the revision that produced
it.

### D-2: The compiler owns a confined virtual project

The compile runtime bundles the selected entry plus relative imports that
resolve to regular files inside the configured artifact directory. Imports that
escape that directory, symbolic or multiply-linked sources, extensionless
ambiguous resolution, and arbitrary package dependencies fail closed. React's
runtime modules are the only package imports supplied by Studio.

Each build is bounded by source count, total source bytes, output bytes, and
diagnostic length. Build identity covers the artifact revision and compile
runtime version. Exact-revision build routes return immutable snapshots; a stale
revision still answers `409`.

### D-3: Preview execution is opaque-origin and message-driven

The server hosts a revision-scoped preview document with a restrictive CSP. The
iframe has `sandbox="allow-scripts"` without `allow-same-origin`; it receives no
credentials, network access, top navigation, forms, or parent DOM access.

The parent creates a `MessageChannel` after the frame loads and sends
`runtime.init` with the expected artifact, revision, build, and runtime ids. The
preview executes only after that handshake and reports `renderCompleted` or
`renderFailed` over the transferred port. The host validates all ids and commits
status only for the latest requested build, so a slow older build cannot replace
a newer revision.

A completed mount is not the same claim as a successful render. A concurrent
React root schedules its work, and its default handling of an uncaught render
error reports that error out of band, so a runtime that watched only the mount
call would report a ready preview over an empty frame. The preview document
therefore owns an explicit failure channel: React's `onUncaughtError`, a bundle
that will not start, a window error, and an unhandled rejection all resolve to
the first `renderFailed` the document sends, and `renderCompleted` is claimed
only when none arrived. Because a preview can break after it mounts, the host
accepts a failure that arrives after it already committed a ready state.

Silence is a third outcome the protocol has to name. The host bounds the
handshake: a preview that never answers — most often because the build it names
was evicted and the route answered with JSON the frame cannot reply from —
resolves to a runtime failure with an operator-driven retry rather than a
permanent starting state. Theme travels over the same channel, since a frame
told the theme once at startup would otherwise keep rendering against the
palette that was current when it started.

### D-4: Catalog changes are streamed, builds stay revision-scoped

`/api/artifacts/events` is a server-sent event stream. The server observes the
currently active artifact directory and emits a coalesced invalidation when an
entry or a nested project dependency changes. The browser then refetches
`/api/artifacts` and re-resolves the active build; it does not accept descriptors
or artifact bytes directly from the event. A dependency-only change may keep the
entry revision stable while producing a new build id.

The stream is advisory and reconnectable. The catalog and revision-scoped
routes remain the authority, so a missed event cannot weaken correctness.

A stream watches the directory it was opened against. Importing a new artifact
set replaces that directory, so a stream whose directory is no longer active
ends and lets the client's own reconnect re-open it against the current one.
Streams are capped, because each one holds a recursive filesystem watcher.

### D-5: Artifact reads are same-origin

Studio binds to loopback, which stops another machine from reaching it but does
nothing about a page the operator is already browsing: that page runs in the
same browser and can address `127.0.0.1` freely. Catalog, content, snapshot,
build, preview, and resource reads therefore require a same-origin request and
send no permissive CORS header. Qoder Canvas viewer documents are the single
exception, because they run at an opaque origin and must fetch their own
compiled module; they serve operator-provisioned renderer code, not artifact
bytes.

### D-6: Compilation is bounded in time and shared across callers

Source and output budgets bound what a build may read and produce, but nothing
bounded how long it took, so a pathological project held its request open
indefinitely. A build now fails with a diagnostic once it exceeds its wall
clock, and its partial record is not cached, so the next request is free to try
again. Concurrent requests for the same revision share one compilation: the
build and preview routes both compile on demand, and the key carries the
revision as well as the path so a caller asking for a newer revision is never
handed a snapshot stamped with the older one.

Viewer discovery is cached for a short interval. Live updates turn every
artifact write into another catalog request, and an uncached scan re-walked the
operator's whole viewer tree each time.

### D-7: A directory is not a declined artifact

Code-backed artifacts import their own subdirectories, so reporting one as an
omission tells an operator that a normal part of the project was refused. The
`not-a-file` reason stays for entries that really did present themselves as
candidate files.

## Acceptance Scenarios

- **AC-1:** A `.tsx` or `.jsx` descriptor is code-backed, names the Studio
  sandboxed renderer, and advertises `execute` and `live-update`; `.ts`, `.js`,
  and non-code artifacts retain their current presentation behavior.
- **AC-2:** The build endpoint returns a validated `ArtifactBuildSnapshotV1`
  bound to the descriptor revision. Repeating the same build reuses its build
  identity; changing source bytes produces a different revision and build id.
- **AC-3:** A component with confined relative TSX/CSS imports renders inside an
  opaque-origin iframe. React runtime imports work, while filesystem escapes and
  unsupported package imports produce bounded diagnostics without crashing
  other Studio routes.
- **AC-4:** Preview code cannot read the parent DOM or make network requests,
  and it starts only after a matching `runtime.init` handshake. The host exposes
  compiling, ready, compile-failed, and runtime-failed states with accessible
  text. A component that throws during render, and one that throws after it
  mounts, both reach runtime-failed with a retry rather than a ready status; an
  unanswered handshake times out into the same state, and a Studio theme change
  reaches a preview that is already running.
- **AC-5:** Rewriting a selected component emits a changed catalog revision,
  refreshes the descriptor, compiles the new revision, and visibly commits the
  new render without a page reload. A stale build completion is ignored.
- **AC-6:** Preview and Source are one tab stop with Arrow/Home/End roving
  focus over a labelled `tabpanel`, at wide, compact, and narrow layouts; the
  preview has bounded overflow, visible focus, no document-level horizontal
  overflow, and no unexpected console/page errors.
- **AC-8:** Artifact reads answer Studio's own origin and refuse another one,
  and no artifact response advertises permissive CORS. A code artifact's own
  subdirectory is not reported as a declined catalog entry, and one revision
  compiles once when two callers request its build at the same time.
- **AC-7:** Existing PPTX, SVG, image, text/diff, Qoder Canvas, immutable content,
  and stale-revision behavior remain covered and unchanged.

## Non-goals

- Changing, extending, or using Qoder Canvas as the Artifact View host.
- Session Artifact manifests, event/tool-call trace links, or semantic
  selection back-links.
- Revision retention, replay, or cross-revision comparison.
- npm installation, arbitrary third-party package imports, Node APIs, server-side
  rendering, or executing `.ts`/`.js` files that do not declare a UI contract.
- Additional native formats such as XLSX, DOCX, PDF, Mermaid, or Lottie.
- Write-back from the preview into artifact source files.

## Plan and Tasks

1. Add build snapshot and preview protocol contracts with validators.
2. Add the confined `ArtifactCompileRuntime` and focused behavior tests.
3. Resolve TSX/JSX through the code-backed plugin provider and serve build plus
   sandboxed preview routes.
4. Add the catalog SSE observer and browser refetch lifecycle.
5. Extract a Studio `ArtifactPreviewHost` path for code-backed artifacts with
   Preview/Source controls, MessageChannel sequencing, and status UI.
6. Run focused unit/server/browser verification, preview health and runtime
   smoke checks, visual review at 1440x900, 1024x768, and 390x844, and the
   required Markdown link graph update.

## Test and Review Evidence

- AC-1/AC-2: plugin resolution, catalog, build contract, cache, and
  stale-revision server tests.
- AC-3/AC-4: compiler confinement and browser runtime protocol tests.
- AC-5: browser test that rewrites the selected fixture and observes a new
  rendered revision without reloading the page.
- AC-6: Playwright screenshots, keyboard interaction, overflow assertions, and
  console/page-error capture at all three layout widths.
- AC-7: existing Artifact View focused tests plus package typecheck/build.

Implementation evidence captured on 2026-08-22:

- `npm run typecheck` and `npm run build` passed in
  `packages/harness-studio`.
- Before concurrent Git History work appeared in the same worktree,
  `npm test -- --maxWorkers=1` passed 22 files and 143 tests in
  `packages/harness-studio`, and `npm run test:browser` passed all 20 then-current
  Playwright scenarios. The Artifact suite
  covers sandboxed TSX execution, handshake-only startup, compile diagnostics,
  source access, no-refresh rebuild, PPTX/SVG regressions, keyboard focus,
  console/page errors, and wide/compact/narrow overflow.
- Live Preview screenshots were reviewed at
  `test-results/artifacts-live-wide.png`,
  `test-results/artifacts-live-compact.png`, and
  `test-results/artifacts-live-narrow.png`.
- Root `npm test -- --maxWorkers=1` passed 100 files and 1,472 tests, with one
  existing skipped test before that concurrent work expanded. The Markdown link graph passed 8 tests and
  `git diff --check` passed.
- A built Studio CLI smoke served the fixture artifact catalog and returned a
  ready `ArtifactBuildSnapshotV1` plus build-scoped Preview URI for
  `tool-mix.tsx`.
- The repository-level optional Canvas preview smoke was not runnable because
  no Canvas SDK runtime is configured. This is an external prerequisite of the
  existing Qoder Canvas preview command; the Studio-owned React runtime does not
  load it.
- After the concurrent Git History work was integrated into `HEAD`, the final
  full package rerun passed 24 files and 148 tests, and all 21 Playwright
  scenarios passed. This includes the final handshake and symlink-confinement
  hardening as well as the Git History regression surface.

Hardening pass captured on 2026-08-22, after a review of the shipped
increment found `runtime-failed` unreachable in practice:

- A `.tsx` that throws during render used to report "Preview rendered from the
  current build." over an empty root, and a throw after mount was not reported
  at all. Both now resolve to runtime-failed; `artifact-host.spec.mjs` covers
  the render-time throw, the post-mount throw, the retry control, and recovery
  to a working artifact without a page reload.
- The Preview/Source strip is one tab stop over a labelled `tabpanel`, and the
  build identity moved out of the `tablist`, which may only contain tabs. The
  narrow Explorer/Preview switcher got the same treatment.
- `artifact-access.test.ts` covers the same-origin read boundary and the absent
  CORS header, plus a code artifact whose subdirectory stays out of `omitted`.
- `artifact-compile-runtime.test.ts` covers one compilation for two concurrent
  requests against the same revision.
- `npm run typecheck`, `npm run build`, 172 package tests across 28 files, and
  all 24 Playwright scenarios passed. The root suite passed 1,472 tests, with
  the doc link graph at 8; one unrelated failure comes from an in-progress
  skills-docs test file owned by concurrent work in the same worktree.

Risk review:

- **Untrusted execution:** compilation does not make generated code trusted.
  Opaque-origin iframe sandboxing, CSP, denied dependencies, and an explicit
  handshake are required release gates.
- **Resource exhaustion:** source and output budgets limit compilation, but a
  browser component can still consume CPU after mount. This increment does not
  claim process-level isolation; runtime failure/timeout handling is evidence
  for a future worker or process boundary.
- **Watcher variance:** filesystem notifications differ across Windows, macOS,
  and Linux. The observer coalesces events and re-derives the catalog revision;
  tests assert the revision protocol rather than OS-specific event counts.
