# Stage the unpublished Studio apps host with the desktop app

## Traceability

- Spec ID: desktop-stage-studio-apps
- Status: Implemented

## Intent

Desktop packaging installs production tarballs of `@qoder-ai/harness` and
`@qoder-ai/harness-studio`. Studio depends on
`@qoder-ai/harness-studio-apps@0.1.0`, which is a private workspace package
and is not published. The install then asks the npm registry and fails with
404 before Electron packaging starts.

## Acceptance Scenarios

- AC-1: `npm run stage -w @qoder-ai/better-harness-desktop` packs
  `harness-studio-apps` with the other local artifacts and finishes the
  production install without requesting that package from the registry.
- AC-2: The staged app can resolve `@qoder-ai/harness-studio-apps/server`.
- AC-3: The apps package stays private and unpublished. Only the desktop
  stage install changes.

## Non-goals

- Publishing `@qoder-ai/harness-studio-apps`.
- Changing the apps host protocol or the desktop smoke scenario.

## Plan and Tasks

1. Pack `packages/harness-studio-apps` in `scripts/stage.mjs` and pass that
   tarball to the same production `npm install` as Harness and Studio.
2. Run the stage command and resolve the server entry from the staged tree.

## Test and Review Evidence

- Cause: Ubuntu desktop `npm run pack` failed in `scripts/stage.mjs` with
  `404 @qoder-ai/harness-studio-apps@0.1.0` from the public registry.
- AC-1, AC-2: `npm run stage -w @qoder-ai/better-harness-desktop` packed the
  private apps package with Harness and Studio, installed 233 production
  packages, and `require.resolve('@qoder-ai/harness-studio-apps/server')`
  from the staged app returned `dist/app/node_modules/@qoder-ai/harness-studio-apps/server.mjs`.
