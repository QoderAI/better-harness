# Implement external Artifact providers in Harness Studio

## Traceability

- Spec ID: studio-external-artifact-provider-runtime
- Status: Implemented
- ADR: [Harness Studio Artifact runtime and provider architecture](../adrs/studio-artifact-runtime-and-providers.md)

## Intent

Implement the immediately actionable provider migration from ADR-0007 without
expanding its evidence-bounded future lanes. Harness Studio should resolve
built-in and third-party Artifact capabilities through one server composition
root, mount hosted output through one generic surface protocol, and treat Qoder
Canvas and GPT Walnut as external providers with honest receipts, activation,
support, and trust boundaries.

Qoder keeps its V2 browser wire compatibility while losing its special fields
inside the common plugin binding. Walnut becomes observable as a
receipt-verified, locally derived provider with zero contributions; no private
Walnut invocation is inferred or executed.

## Acceptance Scenarios

- **AC-1:** The common server contract exposes plugin bindings, surface
  bindings, provider bindings, external providers, contributions, receipts, and
  hosted-runtime operations without importing `CanvasViewer`. One immutable
  composition root resolves an Artifact; common callers no longer pass
  `qoderCanvasViewers` or read `qoderViewer`.
- **AC-2:** Authored TSX/JSX runtimes resolve before every external lane and
  cannot be claimed by a Provider. SVG and Mermaid remain Studio-owned defaults,
  but an explicitly activated, fingerprint-bound external override may replace
  their virtual runtimes. Eligible data formats resolve in the order external
  override, Studio built-in, external fallback, unavailable.
  Same-lane conflicts fail closed rather than using discovery order.
- **AC-3:** Each ready Qoder viewer is translated into a receipt-covered
  external provider contribution. Its fingerprint covers the normalized
  manifest, renderer, optional sidecar, relevant static resources, and selected
  Canvas SDK/runtime assets. The binding reports
  `adapterExecutionProfile: trusted-local-process`, contribution support
  `experimental-local`, and hosted surface security profile `opaque-web-v1`.
- **AC-4:** Qoder provider migration preserves V2
  `renderer.type: qoder-canvas`, `payload.kind: qoder-canvas/v1`, and
  `adapter.schemaId: qoder-canvas/<viewer-id>/v1`. Artifact document, module,
  map, and resource requests delegate through a generic hosted-runtime contract;
  browser mounting normalizes the V2 alias into an external-hosted surface and
  contains no format or provider reclassification.
- **AC-5:** External execution requires a Studio-private activation bound to
  provider id, contribution id, fingerprint, lane, scope, contribution support,
  adapter profile, and surface profile. A bounded, atomic, portable activation
  store supports list/activate/deactivate operations. Its one-time Qoder legacy
  import is idempotent, records an import version and source fingerprint, never
  imports protected formats, and does not re-authorize a changed provider
  fingerprint.
- **AC-6:** A verified active Walnut receipt projects as
  `chatgpt-walnut`, acquisition `local-derived-experimental`, with zero
  contributions. Missing or tampered Walnut remains unavailable and cannot
  displace native PPTX. Provider status is observable without exposing app,
  archive, cache, viewer, or runtime absolute paths.
- **AC-7:** Adapter snapshot identity and catalog revision include the selected
  provider fingerprint, contribution support, execution profile, and surface
  security profile. Changing third-party executable bytes or runtime assets
  moves the catalog revision and prevents a stale binding/cache hit.
- **AC-8:** Qoder provider verification or activation failure removes its
  contribution before selection. Built-in formats continue to resolve; an
  unknown format reports an honest unavailable or activation-conflict reason.
  A runtime failure after selection reports the selected binding's bounded
  error and does not silently switch renderer identity.
- **AC-9:** Focused provider, activation, registry, catalog, server, Walnut, and
  browser-surface tests pass. Studio typecheck/build/package tests, the Markdown
  link graph, and `git diff --check` pass. Browser smoke retains source/diff,
  PPTX/Markdown, React/SVG/Beautiful Mermaid, and optional provisioned Qoder
  behavior without console or page errors.

## Non-goals

- Executing Walnut, copying additional ChatGPT assets, inferring private APIs,
  or introducing a DOCX/XLSX/PPTX Walnut contribution.
- Implementing `SessionArtifactManifest`, Artifact Trace links, retained
  revisions, compare, replay, or semantic history.
- Replacing `HarnessStudioArtifactCatalogV2` or removing its Qoder compatibility
  wire values.
- Adding a new Artifact format, renderer UI, provider-management UI, remote
  provider marketplace, or network-installed provider.
- Claiming Qoder sidecar OS sandboxing, Walnut cross-platform application
  discovery, or release support for experimental-local contributions.

## Plan and Tasks

1. Add browser-safe provider status types and server-owned provider, matcher,
   contribution, surface, hosted-runtime, and activation contracts.
2. Add the immutable plugin composition root and migrate built-ins to explicit
   protected/native/terminal plugins.
3. Translate Qoder discovery into fingerprinted provider contributions and move
   Artifact viewer routes behind the generic hosted-runtime interface.
4. Add the portable activation store, one-time legacy import, and minimal
   provider CLI/status operations.
5. Project verified Walnut receipts into the provider catalog with zero
   contributions.
6. Normalize the V2 Qoder renderer alias in the browser surface registry without
   changing the public V2 response.
7. Update catalog/cache identity and add focused behavioral and regression
   coverage.

## Test and Review Evidence

- AC-1/AC-2/AC-7: provider contract, composition-root, priority, conflict, and
  catalog-identity tests.
- AC-3/AC-4/AC-8: synthetic Qoder provider tests covering receipt assets,
  fingerprint drift, V2 identities, generic hosted operations, failure, and
  existing sidecar bounds.
- AC-5: activation-store and CLI tests covering atomic read/write, cross-platform
  paths, one-time import, protected formats, changed fingerprints, activation,
  deactivation, and conflict behavior.
- AC-6: Walnut bootstrap/provider projection tests covering active, missing, and
  tampered receipts and path-redacted status.
- AC-4/AC-9: browser surface-registry tests plus the focused Artifact Playwright
  scenarios at wide, compact, and narrow layouts.
- AC-9: run Studio typecheck, package tests, browser smoke, docs link graph, and
  `git diff --check`; record exact results before changing Status.

### Risks

- **Persistent precedence:** activation writes can change which executable
  provider wins. Writes must be explicit or one-time migration, atomic,
  fingerprint-bound, and fail closed on malformed state.
- **Trusted local process:** Qoder sidecars can access host resources. The
  implementation preserves process/time/input/output bounds but does not call
  that an OS sandbox.
- **Fingerprint cost:** hashing provider/runtime assets on every live catalog
  request is expensive. Discovery may use a bounded freshness cache, but cache
  keys and invalidation must still detect executable-byte changes.
- **V2 compatibility:** internal generic names must not leak into the existing
  browser response before a separately reviewed wire migration.
- **Path disclosure:** provider catalog, diagnostics, receipts, and activation
  output must not publish operator filesystem paths.

## Implementation Evidence

- `npm run typecheck --workspace @qoder-ai/harness-studio` passed.
- `npm test --workspace @qoder-ai/harness-studio -- --maxWorkers=1` passed with
  32 files and 201 tests.
- The local `@homology/harness-artifact-provider` smoke selected Structurizr
  DSL and D2 through `external-fallback`, Mermaid through explicit
  `external-override`, and returned HTTP 200 for all three catalog, snapshot,
  SVG resource, and opaque hosted-viewer routes under Node 24.19.0.
- `npm run test:browser --workspace @qoder-ai/harness-studio` passed all 26
  Playwright scenarios, including TSX, diff, SVG, Beautiful Mermaid, Markdown,
  PPTX, keyboard focus, and wide/compact/narrow Artifact layouts.
- Focused provider coverage proves receipt fingerprint drift, activation and
  deactivation, one-time legacy import, protected-format precedence,
  same-lane conflicts, generic hosted document/module/map/resource routes,
  V2 Qoder identities, Walnut zero-contribution projection, tamper fallback,
  provider-status path redaction, and catalog/snapshot trust identity.
