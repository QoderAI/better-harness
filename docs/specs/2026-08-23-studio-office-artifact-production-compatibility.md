# Render produced Office artifacts in Studio

## Traceability

- Spec ID: studio-office-artifact-production-compatibility
- Status: Implemented

## Intent

Close the observable gap between an agent producing a real Office document and
Harness Studio presenting that exact revision. Preserve the existing native
PPTX path and add bounded, read-only DOCX and XLSX data adapters and native
Studio surfaces so a discovered Office file is not reported as an available
Artifact without a usable renderer.

Keep compatibility claims layered. Catalog discovery, adapter parsing, Studio
rendering, editing or writeback, and browser visual evidence are separate
outcomes. The Structurizr integration Provider remains responsible only for its
declared diagram and notebook contributions; Studio must not infer Office
support from unrelated Provider or agent-runtime packages.

## Acceptance Scenarios

- **AC-1:** A real `.docx` file is cataloged as `family: documents`,
  `format: docx`, selected by a Studio-owned `studio.docx-ooxml` adapter and a
  `studio.docx-dom` native renderer. `.xlsx` is selected by the separate
  `studio.xlsx-ooxml` adapter and `studio.xlsx-grid` renderer, `.pptx` keeps its
  existing native binding, and `.pdf` remains honestly unavailable unless an
  activated external contribution matches it.
- **AC-2:** The DOCX adapter binds its snapshot to the exact source revision,
  applies bounded OPC archive/XML/snapshot limits, rejects unsafe package
  paths, and projects paragraphs, headings, text styles, tables, and embedded
  images through the common `ArtifactDataSnapshotV1` envelope. Unsupported
  Word layout features remain visible as diagnostics rather than parity claims.
- **AC-3:** Studio mounts only the server-selected `studio.docx-dom` surface and
  presents the projected document, outline, embedded resources, zoom controls,
  adapter identity, and diagnostics. The surface is explicitly read-only and
  exposes no save, mutation, or writeback command or capability.
- **AC-3a:** The XLSX adapter binds the exact source revision, applies the same
  bounded OPC and XML safety posture, and projects sheets, cached formulas,
  cells, merged ranges, row/column sizing, and basic styles. The separate XLSX
  surface provides sheet navigation, selection, and a formula bar without
  executing formulas, editing cells, or embedding an iframe.
- **AC-4:** Any ready server-selected external renderer with a validated
  same-origin `viewUri` mounts through the existing sandboxed external-hosted
  iframe, even when its provider-defined renderer `type` is not known to this
  Studio build. `qoder-canvas` remains a compatibility alias, and an external
  renderer without `viewUri` remains unavailable. A Playwright flow clicks a
  real Structurizr Provider artifact and observes the hosted SVG in the Studio
  client rather than merely checking that the viewer route returns 200. The
  generic regression also mounts an interactive provider-defined renderer for a
  real `artifact-manifest-demo.canvas.tsx` file. The server classifies that
  compound suffix as the dedicated `cursor-canvas-tsx` artifact format, and an
  activated `external-fallback` contribution scoped only by that format wins
  before Studio's protected React fallback. The provider-hosted runtime owns its
  container and bridge; the client has no Cursor, Homology, renderer-id, or
  `.canvas.tsx` branch.
- **AC-5:** Current cross-repository evidence covers the real Structurizr4js
  PPTX example and every currently declared
  `@homology/integration-harness-artifact-provider` contribution (`.dsl`,
  `.d2`, `.mmd`/`.mermaid`, and `.ipynb`) plus a real XLSX file through their
  actual Studio routes.
  The report distinguishes this evidence from the wider artifact types exposed
  by Structurizr4js agent-artifact contracts and runtimes.
- **AC-6:** Focused catalog/registry/adapter/server/browser tests, Harness and
  Studio builds/tests, the Markdown link graph, and `git diff --check` pass.
  Browser evidence covers the DOCX surface at wide, compact, and narrow widths
  with bounded overflow and no page or console errors.
- **AC-7:** A normal `.tsx` or `.jsx` artifact remains protected from external
  override. A `*.canvas.tsx` artifact falls back to Studio's pure React Preview
  when no exact-format Provider is activated; after an exact-format
  `external-fallback` activation, catalog selection exposes the Provider's
  hosted `viewUri`. TSX extension or path-glob matchers cannot enter this
  preferred container lane, and the external-override prohibition remains in
  force for both ordinary authored TSX/JSX and the dedicated compound format.
- **AC-8:** The browser Artifact composition root only selects a server-bound
  Surface. External-hosted, raw text/image, Markdown, DOCX, XLSX, and PPTX Views
  own their separate data and interaction lifecycles; shared snapshot loading,
  diagnostics, and zoom chrome have one reusable implementation. DOCX, XLSX,
  and PPTX retain distinct flow-document, spreadsheet-grid, and absolute-canvas
  projections rather than a format-branching `OfficeArtifactView`.
- **AC-9:** Built-in payloads are runtime-validated before a View consumes them;
  malformed format payloads fail as unsupported contracts rather than crashing a
  renderer. Office adapters share one exact-revision, bounded OPC archive/XML,
  relationship-path, snapshot-size, and descriptor-bound LRU foundation while
  retaining format-specific semantic projections. A server binding change for
  unchanged file bytes changes the mounted Surface identity, and identical PPTX
  bytes under different Artifact ids cannot share an envelope or resource URI.

## Non-goals

- Editing, annotating, saving, recalculating, or writing DOCX/XLSX/PPTX bytes
  back to disk.
- PowerPoint or Word pagination, theme, typography, DrawingML, field,
  tracked-change, comment, header/footer, footnote, or native-control parity.
- Adding Studio-native PDF rendering, expanding the Structurizr integration
  Provider beyond its currently declared contributions, or claiming XLSX chart,
  drawing, pivot, conditional-formatting, macro, or Excel pixel parity.
- Treating Studio's built-in pure React TSX Preview as evidence of Cursor Canvas
  container compatibility, or allowing an external Provider to take over
  ordinary authored `.tsx`/`.jsx` formats. A container Provider owns its hosted
  runtime and bridge, while the server owns the dedicated compound-format split
  and fallback precedence.
- Treating `agent-artifact-contracts`, `agent-artifact-runtime`, Office agents,
  or Office source adapters as proof that Studio can render or mutate every
  artifact those packages can produce or inspect.
- Any DSH `AGENT_CUSTOMIZE` or Issue 101 behavior; those references only locate
  this repository and are not Artifact requirements.
- Creating one generic Office renderer or moving server Provider selection into
  browser components. The refactor separates ownership without changing the
  catalog, adapter, Surface, or activation protocols.

## Plan and Tasks

1. Extend the public host-neutral Artifact kind and snapshot payload vocabulary
   with a DOCX read model while preserving forward-compatible provider values.
2. Add the server-only `*.canvas.tsx` format split and exact-format Provider
   fallback precedence without weakening ordinary authored React protection.
3. Make the browser mount the server-selected generic external-hosted surface
   from its validated `viewUri`, with unit and real Provider Playwright coverage.
4. Add a bounded Studio DOCX OOXML adapter, register it as a native data
   binding, and cover catalog, registry, snapshot, resource, and failure paths.
5. Add a read-only React document surface using existing Studio workbench and
   semantic design tokens, with responsive outline and zoom behavior.
6. Exercise a real Structurizr4js-produced PPTX and the declared external
   Provider contributions against the built Studio server.
7. Run focused and package validation, save browser screenshots, then perform a
   Review Readiness Check over the local diff without committing or pushing.
8. Reduce `ArtifactView` to host dispatch, move each mountable View behind the
   Surface registry, share exact-envelope snapshot loading and common document
   chrome, and scope DOCX native-element styles to its white document surface.
9. Add the bounded XLSX adapter and independent grid surface, create a real
   workbook with Artifact Tool, and include it in cross-repository and browser
   verification.
10. Extract the shared bounded OPC infrastructure, validate built-in payload
    shapes at the public snapshot boundary, and bind mounted Surface identity to
    the selected adapter and renderer rather than content bytes alone.

## Test and Review Evidence

- **AC-1/AC-2:** catalog, plugin-registry, DOCX adapter, and DOCX HTTP boundary
  Vitest tests use ZIP/OPC document bytes and exact-revision assertions.
- **AC-3/AC-4/AC-6:** Artifact surface registry plus Playwright tests assert the
  rendered document, outline selection, resource loading, zoom, keyboard focus,
  wide/compact/narrow overflow, browser error channels, and a clicked external
  Structurizr SVG inside the Studio-mounted iframe. A provider-owned interactive
  Canvas-like container proves the same host without client id/format cases.
- **AC-7:** catalog, registry, activation, server, and Playwright tests use a real
  `artifact-manifest-demo.canvas.tsx` file. They prove exact-format activation,
  hosted interaction, unactivated React fallback, and rejection or non-selection
  of ordinary TSX override/extension/path-glob scopes.
- **AC-8:** surface-registry and component tests assert the composition boundary
  and exact snapshot identity checks. Focused Playwright verifies DOCX table
  contrast/style isolation, zoom behavior, selection, external iframe policy,
  and unchanged Markdown/PPTX/React routing at wide and narrow widths.
- **AC-9:** snapshot-contract tests reject malformed built-in payloads;
  registry tests prove binding changes move the React Surface key; PPTX adapter
  tests cover identical bytes under distinct Artifact ids and revision drift.
  DOCX/PPTX/XLSX adapter suites exercise the shared OPC limits, safe paths, XML
  entity rejection, exact digest, and descriptor-bound cache behavior.
- **AC-3a:** XLSX adapter/server tests cover cached formulas, dates, percentages,
  rich and empty shared-string tables, merges, style projection, revision drift,
  unsafe relationships, and limits. Playwright covers tabs, selection, formula
  display, merged cells, styles, diagnostics, and the no-iframe boundary.
- **AC-5:** run the Structurizr integration Provider package check and its
  `verify-studio.mjs` script with the built local Studio module, then separately
  request a snapshot for `examples/office/project-introduction.pptx`.
- **Risk:** DOCX and XLSX are complex Office formats. Their adapters are bounded
  semantic previews, report baseline limitations, and never claim native Office
  fidelity, formula recalculation, or mutation authority.

## Implementation Evidence

- Node 24 focused Studio typecheck and 11 registry/snapshot/activation/server/
  Office-adapter files (61 tests) passed, including malformed built-in payload,
  PPTX exact-cache identity, and empty-shared-string XLSX regressions.
- Serial generated/Harness/Harness UI/Studio checks passed: 19 files and 161
  tests; 3 files and 29 tests; 39 files and 232 tests. The root Vitest run passed
  1,484 tests with one pre-existing skip.
- Full Studio Playwright passed 31 tests, including wide/compact/narrow DOCX,
  native XLSX, generic hosted Surface coverage, an unactivated `*.canvas.tsx`
  React fallback, and the exact-format interactive Provider container. XLSX
  roving focus reached an empty cell and retained its address in the formula bar;
  narrow DOCX fit the preview viewport at `scrollLeft = 0`.
- The current Structurizr Provider check passed 3 files and 11 tests plus its
  dry-run package. Its built-in Studio verifier returned 200 for six artifacts:
  catalog, external snapshot/resource/viewer routes, Notebook and Canvas runtime
  modules, and the native XLSX snapshot. Both its generated one-sheet fixture
  and the two-sheet Artifact Tool workbook passed.
- A final Node 24/Chromium cross-repository run injected the actual built
  Structurizr4js Provider into the frozen Studio server and mounted real
  Structurizr DSL, Mermaid, stored-output Notebook, and
  `artifact-manifest-demo.canvas.tsx` Surfaces. The Canvas bridge emitted
  `canvas.ready`, changed section state, and reported all four capabilities.
  Native XLSX retained keyboard selection without an iframe, and the real
  `project-introduction.pptx` opened through `studio.pptx-ooxml` /
  `studio.pptx-dom` with 10 slide thumbnails. Console errors, page errors, and
  request failures were all empty; the separate route verifier also covered D2.
- The Markdown link graph regenerated without a diff and its focused test passed
  8 checks. Both staged and unstaged `git diff --check` completed cleanly.
- `npm run preview` remains operationally blocked because this checkout has no
  Canvas SDK runtime configured, so the separate `/health` and
  `/canvas-module.js` preview-server smoke could not start. Direct built-Studio
  server and Playwright verification are complete.
