# Studio desktop release pipeline for downloadable installers

## Traceability

- Spec ID: studio-desktop-release-pipeline
- Status: Implemented

## Intent

Harness Studio's Electron distribution (`packages/better-harness-desktop`) already
has packaging scripts and a pull-request build, but no pipeline turns a version
tag into downloadable installers. `npm run dist` is documented as a local-only
target, and `packages/better-harness-desktop/README.md` still lists a release
pipeline as separate work. Add a tag-driven workflow that builds the macOS ZIP,
Windows NSIS and Linux AppImage on their native runners and attaches them to the
GitHub Release for that tag, so a released tag is a real distribution receipt
instead of a source-only pointer.

## Acceptance Scenarios

- AC-1: Pushing a `v*` tag starts the release workflow; pull requests do not.
- AC-2: The build matrix covers `macos-latest`, `windows-latest` and
  `ubuntu-latest`, and each runner produces its own native installer through the
  desktop package's existing `dist` script.
- AC-3: A platform whose build produces no installer fails the workflow
  (`if-no-files-found: error`) rather than publishing an empty release.
- AC-4: The collected installers are attached to the GitHub Release for the
  pushed tag; tags whose name contains `-` (for example `v0.7.0-alpha1`) are
  marked as prereleases.
- AC-5: Distribution stays unsigned: CI never discovers a signing identity.
- AC-6: The pipeline bounds its own cost: both jobs declare `timeout-minutes`,
  the unprivileged build job restores cargo and Electron/electron-builder caches
  before the build, the privileged release job caches nothing, and uploaded
  installers expire after 7 days.
- AC-7: The pipeline only runs for version tags, so ordinary pull requests and
  branch pushes incur no desktop build cost.

## Non-goals

- Code signing, notarization, auto-update feeds and reproducible-build receipts.
- Publishing the npm packages or host plugin artifacts; `release.yml` owns those.
- Universal macOS binaries. Each runner builds the architecture it runs on, so a
  single macOS job yields one architecture.
- Building `box-service`, which stays optional and requires `protoc`.

## Plan and Tasks

1. Add `.github/workflows/studio-desktop-release.yml` with an `installers` matrix
   job that runs `npm run dist -w @qoder-ai/better-harness-desktop`, uploads the
   electron-builder output directory, and a `release` job that downloads every
   platform artifact and creates the tagged GitHub Release.
2. Disable identity discovery (`CSC_IDENTITY_AUTO_DISCOVERY: 'false'`) so the
   macOS build stays unsigned.
3. Add `test/release/studio-desktop-release-workflow.test.mjs` to keep the
   workflow aligned with the desktop manifest's installer targets and output
   directory, and to lock the unsigned, fail-closed behavior.
4. Bound the build cost: job timeouts, cargo and Electron caches in the
   unprivileged build job (the privileged release job keeps the project's
   no-cache-in-privileged-job rule), and 7-day artifact retention.

## Test and Review Evidence

- AC-1/AC-2/AC-4/AC-5: `test/release/studio-desktop-release-workflow.test.mjs`
  parses the workflow and cross-checks it against
  `packages/better-harness-desktop/package.json`.
- AC-3: the workflow's `if-no-files-found: error` is asserted in the same test.
- AC-6/AC-7: the same test asserts the tag-only trigger, both job timeouts,
  caches ordered before the build, a zero-cache release job, and the 7-day
  retention.
- Risk: caches live only in the unprivileged `installers` job; the release job
  holds `contents: write` and keeps `release.yml`'s no-cache rule to avoid
  cache-poisoning into a privileged context.
- Risk: tag builds may be weeks apart, so caches can expire between releases;
  the timeout and tag-only trigger still bound the worst case.
- Risk: uploading from a single aggregated job concentrates the release, but it
  avoids concurrent release creation races from three matrix jobs.
- Risk: without signing, macOS/Windows show an "unidentified developer" prompt;
  this is an explicit non-goal and is called out in the README already.
