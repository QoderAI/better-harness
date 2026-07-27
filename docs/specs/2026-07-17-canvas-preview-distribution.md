# Make Canvas preview installable

## Traceability

- Spec ID: canvas-preview-distribution
- Status: Implemented

## Intent

Make the existing Qoder Canvas preview usable from an installed Better Harness
package without pretending that it is a hosted sharing service. The public CLI
and source-checkout npm command must resolve to packaged code, while the server
remains local-only by default and continues to use an installed Qoder Canvas
runtime or an explicitly supplied SDK runtime.

## Acceptance Scenarios

- AC-1: `better-harness harness preview-canvas [<report.canvas.tsx>]` dispatches
  to the packaged Canvas preview server and accepts the existing preview flags.
- AC-2: The source-checkout `npm run preview` and `npm run preview:canvas`
  commands target a file that is present in the npm package and runtime ZIP;
  no published npm script points at the intentionally excluded `dev/` tree.
- AC-3: Canvas preview keeps `127.0.0.1` as its default host, discovers the
  installed Qoder runtime on Windows, macOS, and Linux, and retains explicit
  `--sdk-media` and `--sdk-root` overrides.
- AC-4: Public documentation states that Canvas preview is a local inspection
  tool, names its Qoder/runtime prerequisite, and does not present it as an
  authenticated or remotely shareable service.
- AC-5: Focused CLI, preview-server, package-manifest, doc-link, and package
  verification checks pass, followed by a live `/health` and
  `/canvas-module.js` smoke test.

## Non-goals

- Hosting or deploying Canvas previews for remote users.
- Adding authentication, authorization, TLS, tunneling, or public network
  binding.
- Bundling the Qoder Canvas SDK into Better Harness.
- Publishing a package, creating a release, pushing commits, or changing HTML
  preview into a public CLI contract.

## Plan and Tasks

1. Register a discoverable advanced `harness preview-canvas` subcommand that
   delegates to the existing Canvas preview server.
2. Point the Canvas npm scripts at that packaged server and remove the
   redundant `dev/canvas-preview.mjs` wrapper and source-only HTML preview npm
   alias so packed metadata and tests use canonical entrypoints.
3. Tighten package verification so the Canvas preview target remains present
   in both distributed artifacts.
4. Add compact README guidance for installed and source-checkout users.
5. Update focused tests for CLI discovery, npm-script ownership, package
   contents, local binding, and cross-platform runtime discovery.

## Test and Review Evidence

- AC-1/AC-3: `node --test test/better-harness-cli.test.mjs test/preview-servers.test.mjs`
- AC-2: `node --test test/plugin-manifests.test.mjs test/preview-servers.test.mjs`
- AC-2/AC-5: `npm run pack:verify`
- AC-4/AC-5: `node --test test/doc-link-graph.test.mjs`
- AC-5: start `npm run preview -- --port 0`, then require HTTP 200 from
  `/health` and `/canvas-module.js` before stopping the server.
- Risk: exposing a network listener would leak report data. Preserve the
  loopback default and document that this is not a sharing service.
- Risk: an installed package may not contain a Canvas runtime. Keep runtime
  discovery and explicit override errors visible instead of silently falling
  back to incomplete assets.

## Implementation Evidence

- The advanced `harness preview-canvas` route is present in human help,
  machine inventory, and the packaged CLI dispatch table. Its own `--help`
  exits without starting a server and documents the loopback-only boundary.
- Relative report paths resolve from the caller workspace, including when the
  CLI entrypoint itself lives outside that workspace.
- Tests import the canonical packaged Canvas preview server directly; the
  redundant source-only `dev/canvas-preview.mjs` wrapper has been removed.
- Focused CLI, preview-server, package-manifest, and documentation-link tests
  passed: 46/46 before the caller-workspace repair and 39/39 after it.
- `npm run pack:verify` passed with 241 npm package entries and 275 runtime ZIP
  entries. Both artifacts contain the npm-script target, and `dev/` remains
  intentionally excluded.
- Live smoke through both `npm run preview -- --port 0` and
  `better-harness harness preview-canvas --port 0` returned HTTP 200 from
  `/health` and `/canvas-module.js`; the transformed module was 82,438 bytes.
- The full repository suite passed 694/695 tests. The unrelated remaining
  baseline failure is `test/session-usage-summary.test.mjs`, which still reads
  `benchmark/plugin-eval/harness.json` after commit `676f1b9` deleted that
  fixture; this change does not touch that test or benchmark contract.
