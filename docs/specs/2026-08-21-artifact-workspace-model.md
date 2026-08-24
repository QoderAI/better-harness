# Narrow the Studio artifact catalog contract

## Traceability

- Spec ID: artifact-workspace-model
- Status: Implemented

## Intent

Replace the unpushed, cross-domain `artifact-workspace` programming abstraction
with the smallest contract that Harness Studio actually runs: a read-only,
versioned Artifact Catalog response shared by the server and both React
consumers.

The catalog must have one format registry, bind every public content reference
to exact bytes, preserve the existing Canvas viewer priority, and keep active
artifact bytes safe even when their raw content URL is opened directly. Generic
planning, execution, verification, and driver contracts must not be published
until a production domain needs them.

## Acceptance Scenarios

- **AC-1:** Artifact `kind` and `mediaType` derive from one extension registry.
  The raw content endpoint returns the same media type advertised by the
  descriptor for PDF, Office, Lottie, HTML, SVG, source, and image formats.
- **AC-2:** `/api/artifacts` returns an explicit
  `HarnessStudioArtifactCatalogV1` response. Each descriptor contains one
  required `{ uri, mediaType, digest }` content reference; it has no unused
  `role` or optional inline-data branch.
- **AC-3:** Both React consumers import that response type. Artifact View reads
  `artifact.uri`, uses the digest as its content identity, and does not rebuild
  content URLs from ids.
- **AC-4:** Presentation is joined to catalog entries by id while each entry is
  projected, never by parallel-array position. Directory failures remain a
  bounded 404; internal contract violations return a distinct 500 status.
- **AC-5:** Raw HTML and SVG responses are non-sniffable attachments with a
  deny-by-default CSP. Studio previews SVG by fetching its declared content URI
  and placing the text in a sandboxed, network-denied `srcdoc`, so direct raw
  navigation never becomes the preview execution boundary.
- **AC-6:** The package no longer exports or packs
  `@qoder-ai/harness-studio/artifact-workspace`; the generic runtime and its
  test-only driver are removed before the two local commits reach `origin/main`.
- **AC-7:** Existing direct/Canvas renderer priority, path confinement, symlink
  rejection, Office sidecars, and sandboxed Canvas runtime behavior remain
  unchanged.

## Non-goals

- Defining a cross-domain mutation, transaction, scenario, or verification API.
- Adding artifact authoring controls or a second Artifact classification model.
- Unifying packaging artifacts, checkpoint evidence references, and Studio run
  outputs under one vocabulary; those are separate namespaces until a real
  integration requires a bridge.
- Publishing packages, changing versions, or altering release metadata.
- Adding filesystem watching, retention, or a `(size, mtime)` digest cache in
  this contract correction. Full re-hashing remains a measured follow-up risk.

## Plan and Tasks

1. Replace `src/artifact-workspace/` with a browser-safe internal catalog
   response type and remove the package subpath.
2. Merge extension kind/media mappings into one registry and project complete
   typed descriptors from each entry plus its id-bound presentation.
3. Consume the shared response and content reference in `App.tsx` and
   `RunView.tsx`; keep the catalog revision visible to React state.
4. Use the catalog media resolver in the content route, classify directory and
   contract failures separately, and harden active content response headers.
5. Add behavioral tests for response shape, id binding, media parity, active
   content safety, client rendering, removed package exports, and regressions.

## Test and Review Evidence

- AC-1/AC-2/AC-4/AC-5/AC-7: 60 focused catalog, viewer, and server behavior
  tests passed across three files, including exact MIME parity and active
  response headers.
- AC-3/AC-5: all 17 Playwright tests passed. A route-level test rewrites one
  descriptor URI and proves React follows it; the SVG flow verifies sandboxed
  `srcdoc`, raw attachment/CSP headers, and no parent execution.
- AC-6: typecheck/build passed. `npm pack --dry-run --json --ignore-scripts`
  contained zero `dist/artifact-workspace/` files, and importing the removed
  subpath failed with `ERR_PACKAGE_PATH_NOT_EXPORTED`.
- Package gate: 124 tests passed across 18 files. The repository-wide run passed
  1432 of 1433 tests; its sole failure was an unrelated fixed 10-second CLI-help
  timeout for `commit-session-link render-session --help`, and the isolated
  behavior rerun passed in 5.41 seconds.
- Diff hygiene and exact commit/push readback are recorded at delivery.

## Risks

- Raw artifact access is intentionally CORS-readable by the opaque Canvas
  viewer. CSP, attachment disposition, MIME parity, and renderer sandboxing must
  therefore remain independent, tested layers.
- Exact-byte SHA-256 is still recomputed on each catalog request. The configured
  directory is operator-controlled and bounded, but a cache needs a separate
  invalidation contract rather than an untested optimization in this patch.
