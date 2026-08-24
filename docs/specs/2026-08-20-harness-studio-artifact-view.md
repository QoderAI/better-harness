# View AI-generated artifacts inside Harness Studio

## Traceability

- Spec ID: harness-studio-artifact-view
- Status: Implemented
- Acquisition: Superseded by `harness-studio-local-web-workspace`; Artifact View
  is session-scoped rather than the root directory-selection workflow.

## Intent

Harness Studio should render files produced by an AI run without asking the
reviewer to leave the evidence workbench. Code, patches, JSON, text, images, and
SVG use bounded Studio-owned renderers. Rich formats such as PPTX, XLSX, DOCX,
GLB, and Lottie reuse provisioned Qoder Canvas format viewers.

Artifact bytes are untrusted data. They are never promoted to executable React
modules merely because their extension is `.tsx` or `.jsx`. Executable viewer
code comes only from the operator-controlled Canvas viewer root.

The first implementation commit (`a8922dc`) inverted that boundary by executing
TSX artifacts while leaving the requested formats unrendered. This revision
replaces that proof-of-concept contract rather than extending it.

## Decisions

- **D-1: data and renderer ownership are separate.** The configured artifact
  directory owns files to inspect. The provisioned Canvas directory owns trusted
  renderer extensions.
- **D-2: direct renderers are independent.** Missing Canvas resources do not
  disable code, diff, JSON, text, image, or SVG previews.
- **D-3: viewer discovery follows the Qoder contract.** The default viewer root
  is `$QODER_HOME/canvas/canvases`, falling back to
  `~/.qoder/canvas/canvases`. Tests may override it explicitly.
- **D-4: viewer caches are not inputs.** Studio runs the selected viewer's
  `scripts/index.mjs` with a request-scoped data file; it never treats retained
  `index.target-*.canvas.data.json` files as current output.
- **D-5: Studio reuses the host contract, not Electron-only recovery.** Viewer
  TSX is transformed with esbuild-wasm while preserving ESM imports for the
  Canvas runtime import map. The Lingma Electron node shim and Sucrase fallback
  are not needed in the plain Node Studio server.
- **D-6: artifact acquisition is a Studio workflow.** `--artifacts` remains an
  optional preload for automation, but a reviewer can start with no inputs and
  choose files or a directory in the browser. Browser-selected bytes are copied
  into a bounded Studio-owned temporary session because browsers do not expose
  a portable server-readable absolute path.

## Renderer Resolution

For every indexed artifact, Studio resolves one presentation:

1. A Canvas viewer whose manifest sets `overrideBuiltIn` or
   `overridesBuiltIn` and matches the artifact.
2. A Studio direct renderer for code, diff, JSON, text, image, or SVG.
3. Any matching provisioned Canvas viewer.
4. An unavailable metadata state; unknown bytes are never executed.

Canvas viewer manifests are read from
`<viewer-root>/<format>/manifest.json`. Resolution supports `id`, `label`,
`extensions`, `pathGlobs`, `dataKey`, and the two built-in
override spellings used by the provisioner. A viewer must also contain
`index.canvas.tsx`; target-backed viewers must contain `scripts/index.mjs`.

## Acceptance Scenarios

- **AC-1:** `.tsx` and `.jsx` resolve to `code`, not an executable module.
  Selecting either renders escaped, syntax-highlighted source.
- **AC-2:** Code, JSON, and text are fetched only after selection and render
  through `HighlightedCode`. Unified patches render through the existing
  `@pierre/diffs` surface with split lines and word changes.
- **AC-3:** SVG renders in an iframe with no sandbox privileges. An SVG script
  cannot execute or reach the Studio document. Bitmap images render without
  being decoded in the Studio JavaScript context.
- **AC-4:** `deck.pptx` resolves through a matching provisioned manifest under
  `~/.qoder/canvas/canvases/pptx` when present. Its artifact path is passed as
  `targetFilePath`; the viewer directory is never mistaken for the artifact
  directory.
- **AC-5:** The viewer sidecar receives both `AICODING_*` and `QODER_*` data and
  script-argument variables, runs in a request-scoped temporary directory, has
  a bounded timeout and input/output limits, and leaves no temporary directory.
- **AC-6:** Sidecar success is decided from the manifest `dataKey` payload.
  `payload.error` or an error diagnostic is surfaced even when the process exits
  zero. The payload source path must match the requested artifact when a
  `sourcePath` is present.
- **AC-7:** Viewer `index.canvas.tsx` is compiled without deleting its React or
  `qoder/canvas` imports. Canvas `index-canvas.html` supplies one import-mapped
  SDK runtime, request-scoped data, and the artifact target path.
- **AC-8:** Viewer HTML runs in `sandbox="allow-scripts"` without
  `allow-same-origin`. Viewer modules and the Canvas SDK carry the CORS and
  no-sniff headers required by the iframe's opaque origin.
- **AC-9:** Artifact ids are opaque. Catalog indexing rejects symbolic links,
  junction-like non-files, and any real path outside the configured root.
- **AC-10:** Invalid percent-encoded route components return 400. Every async
  route rejection is converted into a bounded 500 response rather than ending
  the Studio process.
- **AC-11:** An artifact directory that disappears after startup produces a
  path-redacted error while other Studio routes remain available.
- **AC-12:** The Session Debugger artifact tab lists the configured artifact
  catalog when available and otherwise shows an honest empty state. It never
  displays fabricated filenames.
- **AC-13:** The Artifact workspace remains usable with keyboard focus and no
  document-level horizontal overflow at 1440×900, 1024×768, and 390×844.
- **AC-14:** A real provisioned PPTX viewer renders a representative deck in a
  browser with no page or console errors. Unit-only transform evidence is not
  sufficient for this acceptance scenario.
- **AC-15 (superseded):** `harness-studio` can start without CLI-provided inputs. Overview
  and Artifacts expose an enabled **Analyze artifacts** action rather than a
  disabled “artifact directory required” state.
- **AC-16 (superseded):** Analyze artifacts supports choosing multiple files or a directory
  in the browser. Studio copies selected bytes into a bounded server-managed
  import session, commits the catalog only after every file succeeds, and never
  writes into the selected source directory.
- **AC-17 (superseded):** Manual imports require same-origin requests, opaque session ids,
  portable flattened labels, bounded file count and aggregate bytes, and
  cleanup on failure, replacement, or server shutdown. Successful commit
  refreshes navigation, Artifact View, and the Debugger artifact endpoint.

## Non-goals

- Editing, regenerating, or writing back to artifacts.
- Treating arbitrary AI-authored JavaScript or TSX as a viewer plugin.
- Bundling concrete `viewer-*` packages into Harness Studio.
- Reusing stale Qoder `index.target-*.canvas.data.json` files.
- Remote or authenticated artifact sharing.
- Simulator-backed mobile project viewers in this increment.

## Plan and Tasks

### 1. Harden the artifact catalog

Classify source files as data, add bounded direct content routes, reject
symbolic links before following them, and verify real-path confinement. Keep
absolute paths server-side.

### 2. Add compatible Canvas viewer discovery

Load provisioned manifests from the explicit viewer root or the Qoder default.
Match extension and path glob. Return only viewer ids and labels to the browser.
Content-probe-only manifests remain a follow-up because direct JSON/text
renderers intentionally win unless a viewer explicitly overrides them.

### 3. Add the request-scoped viewer host

Run `scripts/index.mjs`, validate its data-key payload, compile the trusted
`index.canvas.tsx` while preserving ESM imports, derive HTML from the Canvas SDK
runtime template, and serve viewer runtime assets under the artifact route.

### 4. Render direct and Canvas presentations

Reuse `HighlightedCode` and `StudioDiff`, isolate SVG/image content, and mount
Canvas viewers in an opaque-origin iframe. Keep unavailable artifacts visible
with a concrete reason.

### 5. Remove fabricated Debugger artifacts

Pass the bounded artifact endpoint into the recorded Session Debugger and show
the real configured catalog or an empty state.

### 6. Add a manual analysis entry (superseded)

This artifact-root workflow was replaced by the workspace-root workflow in
`harness-studio-local-web-workspace`. Artifact files remain scoped below a
selected Session; the loose catalog is compatibility-only.

## Test and Review Evidence

Implementation evidence captured on 2026-08-20:

- `npm test` in `packages/harness-studio`: 17 files, 113 tests passed.
- `npm run test:browser` in `packages/harness-studio`: 15 Playwright tests
  passed, including a real `pptx-parity.pptx` rendered with the provisioned
  `~/.qoder/canvas/canvases/pptx` viewer.
- `node dist/server/cli.js --port 0`: started an empty Studio at an ephemeral
  loopback URL without any data flags.
- Root `npm test`: 99 files, 1,412 tests passed.
- Markdown link graph: 6 tests passed after regeneration.
- Screenshots: `packages/harness-studio/test-results/artifacts-wide.png`,
  `artifacts-compact.png`, `artifacts-narrow.png`, plus
  `artifact-intake-wide.png`, `artifact-intake-compact.png`, and
  `artifact-intake-narrow.png`.

- AC-1/AC-2/AC-9: focused catalog and direct-renderer model tests.
- AC-4/AC-5/AC-6/AC-7: viewer registry, sidecar, compiler, cache, and payload
  validation tests using a self-contained fake viewer.
- AC-10/AC-11: HTTP tests for malformed encoding, disappearing directories,
  and continued `/api/config` service.
- AC-3/AC-8/AC-13: Playwright tests at wide, compact, and narrow widths with
  console/page-error capture and saved screenshots.
- AC-12: Session Debugger tests with empty and populated artifact catalogs.
- AC-14: Playwright against the currently provisioned
  `~/.qoder/canvas/canvases/pptx` and a real PPTX fixture. The scenario is
  environment-gated: where that viewer, the `canvas-sdk` runtime, or the deck
  fixture is absent (a clean CI runner has none of them), the deck is left out
  of the artifact directory and the scenario reports as skipped with its stated
  requirement rather than failing the artifact suite on a missing external file.
- AC-15/AC-16/AC-17: superseded by the workspace-root acceptance scenarios in
  `harness-studio-local-web-workspace`.
- Regression: package tests, root tests, `git diff --check`, and the Markdown
  link graph.

### Risks

- **Trusted extension execution:** Canvas viewer roots contain executable Node
  and browser code. Only operator-configured or provisioned roots are trusted;
  browser input can select an artifact id but never a viewer path.
- **Parser cost:** Office parsing and runtime materialization can be expensive.
  Source size, timeout, abort, and temp cleanup remain bounded.
- **Large sidecar payloads:** media may be encoded into JSON. The current
  sidecar contract remains transitional and must not be widened silently.
- **Runtime availability:** an installed viewer without a compatible Canvas SDK
  runtime is presented as unavailable for that artifact; direct renderers stay
  operational.
