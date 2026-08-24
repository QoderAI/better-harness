# Harness Studio Artifact runtime and provider architecture

## Traceability

- ADR ID: `ADR-0007`
- Status: Proposed
- Decision date: 2026-08-22
- Related specs:
  - [View AI-generated artifacts inside Harness Studio](../specs/2026-08-20-harness-studio-artifact-view.md)
  - [Narrow the Studio artifact catalog contract](../specs/2026-08-21-artifact-workspace-model.md)
  - [Model revision-bound artifacts in Harness Studio](../specs/2026-08-21-studio-artifact-view-model.md)
  - [Unify code and diff rendering through Artifact View](../specs/2026-08-22-studio-artifact-code-diff-view.md)
  - [Render live code artifacts in Studio](../specs/2026-08-22-studio-live-artifact-preview.md)
  - [Render Markdown artifacts as native React documents](../specs/2026-08-22-studio-markdown-artifact-view.md)
  - [Render SVG and Mermaid artifacts through the React preview runtime](../specs/2026-08-22-studio-react-document-artifacts.md)
  - [Keep Walnut bootstrap receipts portable across platforms](../specs/2026-08-21-walnut-cross-platform-paths.md)
  - [Implement external Artifact providers in Harness Studio](../specs/2026-08-22-studio-external-artifact-provider-runtime.md)
  - [Extract the Artifact provider SDK and prove it with Structurizr](../specs/2026-08-22-artifact-provider-sdk-and-structurizr.md)

## Context

Harness Studio started with a bounded directory catalog and several direct file
previews. It now has the beginnings of a real Artifact runtime:

- exact-byte revisions and revision-scoped URLs;
- data-backed adapters and immutable data snapshots;
- Studio-native React renderers for source, diff, Markdown, PPTX, and images;
- code-backed React previews compiled by `esbuild-wasm` into immutable build
  snapshots and run in an opaque-origin iframe;
- Studio-owned virtual React modules for SVG and Mermaid, with Mermaid rendered
  by `beautiful-mermaid` rather than the larger Mermaid runtime;
- advisory live invalidation followed by an authoritative catalog refetch;
- a Qoder Canvas compatibility bridge; and
- a content-addressed, locally derived Walnut installation receipt.

These capabilities were introduced by separate implementation slices. Their
boundaries are individually useful, but the overall architecture is not yet
explicit. In particular:

- server-side format resolution and browser-side renderer mounting are both
  called registries even though they have different authority;
- Qoder-specific viewer values still leak through the shared server contract;
- Qoder has an executable adapter and hosted renderer without a common provider
  receipt, while Walnut has a strong provider receipt but no reviewed Artifact
  adapter contract;
- a live directory revision is sometimes discussed as if it were retained
  history; and
- Session events, Artifact revisions, semantic addresses, comparison, and
  replay do not yet have an evidence-backed bridge.

Without an explicit decision, adding DOCX, XLSX, PDF, more diagram formats, or
another third-party runtime would put new vendor and format branches into the
catalog, server routes, and React host. It would also make an installed external
runtime appear more trusted or capable than the evidence supports.

## Current and target boundaries

This ADR distinguishes implemented foundations from target boundaries. A target
boundary becomes runtime behavior only through a dated implementation spec and
its validation evidence.

| Concern | Current evidence | Decision target |
| --- | --- | --- |
| Catalog | `HarnessStudioArtifactCatalogV2` with exact content digests | Preserve the server-owned catalog as the browser's sole authority and project every selected runtime through one binding |
| Data lifecycle | Raw, Markdown, PPTX, and Qoder data adapters | Format adapters produce immutable, schema-valid snapshots or exact content references |
| Code lifecycle | TSX/JSX plus Studio-owned SVG and Mermaid virtual modules | One bounded compile/build/preview lifecycle for executable presentation |
| Browser host | Ordered `ArtifactView` providers | Mount the exact server-selected surface; never reclassify by extension |
| Qoder | Provider-specific discovery, sidecar, routes, and renderer type | Translate Qoder into a generic external provider contribution and hosted surface |
| Walnut | Verified local bootstrap receipt; no Artifact execution | Register a receipt-verified, locally derived provider with zero contributions; any future contribution starts `experimental-local` |
| Revision history | Current bytes are revision-bound but not retained | Retention, compare, and replay require a separate immutable Artifact authority |
| Session trace | No canonical Artifact trace link | Add an evidence-backed manifest and trace projection in a later spec |

## Decision

### Use one Artifact domain model

The following terms have one meaning throughout Studio:

- **Artifact Thread** identifies one logical Artifact within an authority scope.
  The current path-derived `threadId` is only catalog-local identity; it is not
  cross-session identity and does not survive a rename.
- **Artifact Revision** identifies exact source bytes by digest. A revision URL
  never serves different bytes after the source moves on.
- **Artifact Descriptor** is the browser-safe catalog projection of a revision,
  its selected adapter, renderer, capabilities, and revision-scoped references.
- **Artifact Data Snapshot** is an immutable, schema-versioned semantic
  projection produced from one revision.
- **Artifact Build Snapshot** is an immutable result of compiling one
  code-backed revision with one selected build runtime.
- **Artifact Surface** is the presentation boundary mounted by Artifact View:
  native React, Studio sandboxed web, external hosted web, or unavailable.
- **Artifact Trace Link** is future retained evidence connecting a Session
  event or tool call to an exact Artifact revision and optional semantic
  address. It is not inferred from the current worktree.

Packaging outputs, checkpoint evidence, report attachments, and Studio Artifact
revisions remain separate namespaces unless an explicit bridge records their
identity and provenance.

An **authority scope** is the namespace and retention owner that can prove an
Artifact identity: currently one live directory catalog, and later potentially
one retained `SessionArtifactManifest`. Catalog-local and Session-stable Thread
ids are distinct namespaces until an explicit provenance bridge relates them.

### Keep catalog authority on the server

The server owns discovery, format classification, revision hashing, plugin
selection, provider verification, and reference construction. Artifact bytes
may select a registered format through bounded inspection, but they never select
a module path, command, package permission, security profile, or provider root.

The browser follows the descriptor returned by the catalog. It does not infer a
renderer from an extension, MIME type, payload kind, or provider label. Unknown
renderer identities and capabilities fail closed into an accessible unavailable
state.

All browser-visible content, snapshot, build, resource, and hosted-view
references remain same-origin, revision-scoped Studio API paths. Absolute host
paths, provider roots, cache locations, and executable entry points remain
server-private.

The catalog revision covers more than file bytes. It also moves when the
selected adapter, build runtime, renderer surface, capability set, omission set,
or external provider fingerprint changes. A catalog identity therefore names
the complete presentation decision visible to a client.

### Separate plugin selection from surface mounting

Studio has two registries with deliberately different responsibilities:

1. The **server Artifact Plugin Registry** selects one immutable binding for an
   indexed revision.
2. The **browser Artifact Surface Registry** mounts the exact renderer identity
   and surface declared by that binding.

This ADR reserves **provider** for a third-party acquisition and trust boundary
such as Qoder or Walnut. A server **plugin** contributes format behavior. A
browser **surface mount** binds a renderer protocol to a React component. The
current `ArtifactRendererProvider` and `ArtifactViewProvider` type names are
legacy names to migrate; they do not create additional provider concepts.

The server registry owns ordered format and provider policy. The browser
registry is a composition table, not a second policy engine. A browser surface
mount may match an exact renderer id or a generic surface protocol such as the
Studio sandboxed preview, but it must not override a server decision by
inspecting the filename again.

The conceptual internal binding is:

```ts
interface ArtifactPluginBinding {
  backing: "data" | "code";
  adapter: ArtifactAdapterImplementation;
  buildRuntime?: ArtifactBuildRuntimeImplementation;
  surface: ArtifactSurfaceBinding;
  capabilities: readonly ArtifactCapability[];
  provider?: ArtifactProviderBinding;
}

interface ArtifactProviderBinding {
  providerId: string;
  contributionId: string;
  fingerprint: ArtifactDigest;
  contributionSupport: "reviewed" | "experimental-local";
}

type ArtifactSurfaceBinding =
  | { kind: "native"; rendererId: string }
  | { kind: "studio-sandbox"; rendererId: string; runtimeId: string }
  | {
      kind: "external-hosted";
      rendererId: string;
      runtimeId: string;
      securityProfileId: "opaque-web-v1";
    }
  | { kind: "unavailable"; reason: string };
```

The host-neutral descriptor, snapshot, source-entry, adapter, surface, and
external Provider shapes are a public package API under
`@qoder-ai/harness/artifacts`. Studio keeps compatibility re-exports while the
core subpath is their sole source owner. React views, catalog discovery and
classification, HTTP routes, activation storage, provider selection, compile
execution, CSP, and iframe hosting stay in `@qoder-ai/harness-studio`; they are
not SDK abstractions. The current V2 catalog continues to project the public
contract through `backing`, `build`, and `renderer`. A later wire-format
revision is justified only when a client needs information that cannot be
represented safely and additively.

The V2 compatibility projection is explicit:

| Current `renderer.type` | Internal surface kind | V2 rule |
| --- | --- | --- |
| `native` | `native` | Unchanged |
| `sandboxed-web` | `studio-sandbox` | Unchanged on the wire |
| `qoder-canvas` | `external-hosted` | Retained as a Qoder compatibility alias in V2 |
| `unavailable` | `unavailable` | Unchanged |

New Studio code normalizes that legacy wire value at the protocol edge and then
uses the generic surface mount. A Qoder provider migration removes
`qoderViewer` and the Canvas-typed plugin context from the generic internal
binding, but it continues to emit `renderer.type: "qoder-canvas"` and the
provider-owned `payload.kind: "qoder-canvas/v1"` discriminator to V2 clients.
For every migrated viewer it also preserves the current
`adapter.schemaId: "qoder-canvas/<viewer-id>/v1"`; a provider refactor alone
cannot rename or generalize that value. A new Qoder adapter schema requires a
new versioned schema id and compatibility negotiation rather than silently
replacing the selected V2 contract. Removing any of these wire aliases requires
a dated V3 or negotiated compatibility spec; it is not an additive V2 change.

Renderer implementations compose under `ArtifactView`; they do not inherit from
PPTX, Canvas, or another concrete View. `ArtifactCodeView` is the shared source
and diff presentation primitive. PPTX and Markdown are native document views.
SVG, Mermaid, and authored React projects use the shared sandboxed preview host.
An external hosted renderer uses the same host-level surface contract without
becoming the abstraction for other renderers.

### Preserve two explicit runtime lifecycles

Data-backed and code-backed Artifacts have different security and caching needs
and remain explicit in the descriptor.

```text
Data-backed

Artifact Revision
  -> selected Artifact Adapter
  -> immutable Artifact Data Snapshot or exact raw content reference
  -> selected native or external-hosted surface
  -> Artifact View commit
```

```text
Code-backed

Artifact Revision
  -> confined source project or Studio-owned virtual module
  -> selected Artifact Build Runtime contribution
  -> Artifact Compile Runtime execution
  -> immutable Artifact Build Snapshot
  -> Studio sandboxed Preview Runtime
  -> Artifact View commit
```

A data adapter owns parsing, semantic addresses, resources, diagnostics, and its
format payload schema. It does not return React elements or browser HTML. A
native renderer consumes a known payload schema or the exact content reference
of the identity raw adapter.

A build runtime owns trusted executable presentation code and compile options.
Artifact bytes remain input data unless the selected Studio plugin explicitly
classifies the Artifact as authored code. Virtual document runtimes import the
exact Artifact source through `artifact-source`; the Artifact cannot choose
runtime packages or build configuration.

Build runtimes are registry-selected contributions. The single compile runtime
executes the selected contribution and enforces project, dependency, time, and
output bounds. Adding an SVG-like virtual document edits the build-runtime
composition, not the compiler implementation.

Numeric compile limits are Studio host policy. An embedder may lower them or
raise them within Studio-owned hard ceilings; the effective policy participates
in cache and build identity. Package permissions are not a numeric limit and
remain owned by the selected trusted build-runtime contribution. A Provider
that needs repository libraries performs a declared adapter transform instead
of granting artifact-authored source arbitrary workspace imports.

Build and snapshot identities include the source revision, adapter or build
runtime id and version, schema version, and any external provider fingerprint
that can affect output. Cache hits therefore cannot cross a meaningful runtime
change.

### Make dynamic rendering a Studio-owned React capability

Dynamic Artifact rendering uses the Studio compile and preview lifecycle. It is
not delegated to Qoder Canvas and it is not executed in the Studio document.
Authored TSX/JSX are protected code-backed plugins: they resolve before every
external lane and are not eligible for external override. SVG and Mermaid use
Studio-owned virtual runtimes by default, but are document formats rather than
artifact-authored programs; an explicit fingerprint-bound `external-override`
may therefore select a Provider projection for them. Without that consent the
Studio runtime remains ahead of every external fallback.

- Authored `.tsx` and `.jsx` projects compile from a confined Artifact root.
  Relative imports cannot escape the root; symlinks, hard links, ambiguous
  imports, excessive files, excessive bytes, and non-allowlisted packages fail
  closed.
- SVG uses a Studio-owned React virtual module. Source bytes become a Blob URL
  displayed as an image; raw SVG markup is not injected into the parent DOM.
- Mermaid uses a Studio-owned React virtual module and
  `beautiful-mermaid`. The generated SVG is displayed through a Blob image
  boundary. The full Mermaid runtime is not part of this architecture.
- Each successful compile produces a revision-bound `ArtifactBuildSnapshotV1`.
  The browser runs the retained build in an opaque-origin
  `sandbox="allow-scripts"` iframe with a no-network CSP.
- The host transfers a fresh `MessageChannel` only after a matching
  `runtime.init` handshake. Artifact id, revision id, build id, and runtime id
  must all match before `renderCompleted` or a runtime failure can commit UI
  state.
- Theme changes use the same channel. Stale requests, builds, frames, and
  messages cannot replace a newer selection.

The `/api/artifacts/events` stream is advisory invalidation, not revision
authority. A client refetches the catalog, follows its new revision-scoped
references, and ignores asynchronous results for an older revision.

### Model Qoder and Walnut as external Artifact providers

Qoder Canvas and GPT Walnut are third-party local providers. The shared core
consumes provider contributions; it does not contain vendor-specific fields or
routes in its plugin binding.

Provider acquisition remains source-specific:

- a Qoder provider source reads an operator-provisioned Canvas directory and
  translates its existing manifest, renderer, sidecar, and SDK runtime into the
  common provider contract;
- a Walnut provider source probes a locally installed ChatGPT application,
  derives approved assets into a content-addressed Studio-private cache, and
  verifies the existing receipt and active pointer; and
- neither provider's installation layout becomes the Artifact plugin format.

Discovery and verification produce an immutable receipt before contributions
can enter resolution. Conceptually:

```ts
interface ExternalArtifactProvider {
  id: string;
  label: string;
  version: string;
  acquisition: "operator-provisioned" | "local-derived-experimental";
  fingerprint: ArtifactDigest;
  receipt: VerifiedExternalProviderReceiptV1;
  contributions: readonly ExternalAdapterContribution[];
}

interface VerifiedExternalProviderReceiptV1 {
  kind: "HarnessStudioExternalArtifactProviderReceiptV1";
  providerId: string;
  providerVersion: string;
  providerDescriptorDigest: ArtifactDigest;
  assets: readonly {
    relativePath: string;
    role: string;
    size: number;
    digest: ArtifactDigest;
  }[];
  driverVersions: Readonly<Record<string, string>>;
  sourceReceipt?: { kind: string; digest: ArtifactDigest };
}

interface ArtifactMatcher {
  formats?: readonly string[];
  extensions?: readonly string[];
  pathGlobs?: readonly string[];
}

interface ExternalAdapterContribution {
  id: string;
  match: ArtifactMatcher;
  lane: "external-override" | "external-fallback";
  adapter: ArtifactAdapterImplementation;
  surface: ArtifactSurfaceBinding;
  outputSchemaId: string;
  capabilities: readonly ArtifactCapability[];
  support: "reviewed" | "experimental-local";
  adapterExecutionProfile?:
    | "trusted-local-process"
    | "confined-wasm";
}
```

The normalized receipt is a Studio-owned verification projection, not a
replacement for source-specific evidence. The existing Walnut receipt remains
the source receipt and is referenced by digest; Qoder gains an equivalent
source receipt during migration. The provider fingerprint is derived from the
canonical normalized receipt, every asset digest, and selected driver versions.
For Qoder, `providerDescriptorDigest` covers its normalized manifest. A
manifestless source such as Walnut uses a Studio-generated canonical provider
descriptor derived from the verified source receipt; implementations do not
invent an empty or synthetic manifest digest.

External matchers are declarative. At least one selector is required; a match
occurs when any declared normalized format, lowercase extension, or portable
POSIX relative-path glob matches. External manifests cannot supply matcher code
or a content probe. A Studio-owned built-in plugin may use a separately
registered bounded inspector, but Artifact bytes still cannot select its module
or permissions.

Receipt verification proves provider asset identity. Support belongs to each
adapter contribution because one provider can expose several schemas, drivers,
and trust profiles at different maturity levels. `reviewed` means that specific
invocation and output contract has passed its implementation and validation
gate; `experimental-local` remains explicitly local and unsupported for release
claims. A provider may therefore be receipt-verified and contribute zero
adapters. The selected contribution's support level is copied into
`ArtifactProviderBinding.contributionSupport`; the provider as a whole is never
upgraded by one reviewed contribution.

#### Qoder Canvas mapping

Qoder currently contributes a Node sidecar data adapter and a hosted Canvas
renderer. Its provider fingerprint must cover the manifest, renderer module,
optional sidecar, relevant static resources, and selected Canvas SDK/runtime
identity. The translation layer preserves the current request-scoped artifact
copy, payload validation, size limits, timeout, path redaction, and cleanup.

The current sidecar is trusted local Node code in a bounded child process; it is
not an operating-system sandbox. Its `adapterExecutionProfile` must say so.
Separating the process and limiting request input/output do not justify claims
that the sidecar cannot inspect the host filesystem or use the network.

The hosted Canvas document remains an opaque-origin iframe. Generic hosted-view
routes serve the selected contribution; the browser and common server path do
not branch on `qoder-canvas` after the V2 protocol edge has normalized the
compatibility alias. One Qoder contribution therefore binds two explicit trust
layers: `adapterExecutionProfile: "trusted-local-process"` for its sidecar and
`securityProfileId: "opaque-web-v1"` for its external-hosted surface. Activation
records the complete adapter-plus-surface combination rather than one ambiguous
execution profile.

Migrated Qoder contributions start with `support: "experimental-local"`.
Promotion to `reviewed` requires the receipt/fingerprint migration tests,
bounded sidecar and hosted-surface security tests, cross-platform portable-path
tests, a real provisioned-runtime browser smoke, and explicit maintainer
approval. Existing operational behavior alone does not make a release support
claim.

During migration, an existing Qoder manifest's `overrideBuiltIn` or
`overridesBuiltIn` value may be imported once into a Studio-private activation
record. That compatibility import binds the receipt-covered provider fingerprint,
contribution id, declared format/path scope, and `external-override` lane. After
the import, changing or adding the manifest flag cannot grant precedence; a new
fingerprint requires explicit operator approval. This preserves already
provisioned behavior without leaving precedence under manifest control. Only
Studio-declared data-backed formats are imported; a legacy override flag that
matches protected TSX/JSX, SVG, or Mermaid is ignored with a provider
diagnostic. The first provider spec must persist an atomic migration marker with
an import version and source fingerprint. Restart, partial failure, or a later
manifest change cannot import the flag again or grant new precedence.

#### GPT Walnut mapping

Walnut currently contributes a receipt-verified, content-addressed provider
receipt and no Artifact adapter:

```ts
{
  id: "chatgpt-walnut",
  acquisition: "local-derived-experimental",
  receipt: verifiedReceipt,
  contributions: [],
}
```

No private ChatGPT API, application IPC, hashed chunk, protobuf, or inferred
entry point is treated as a parser contract. A future Walnut contribution
requires a separately reviewed, stable invocation boundary and must emit an
existing Studio-owned schema such as `pptx/v1` or a new versioned DOCX/XLSX
schema. Studio then renders the result through a native React View; Walnut UI
does not become an Artifact surface.

The portable native PPTX adapter remains the default baseline. Missing,
unreviewed, inactive, or tampered Walnut assets never disable it. Walnut may
override a built-in adapter only after explicit per-format activation binds an
exact provider fingerprint.

Current real ChatGPT/Walnut application discovery is macOS-only. Windows and
Linux evidence covers portable receipt, cache, and path semantics; it does not
claim native ChatGPT application discovery on those platforms.

#### External execution profiles

External manifests describe relative, receipt-covered assets and select only a
core-known driver id. They cannot contain an arbitrary shell command or grant
themselves permissions. The activation policy binds the selected adapter
execution profile and surface security profile. Adapter execution profiles are:

- `trusted-local-process`: explicit operator trust, a separate process, bounded
  request input/output, timeout, diagnostics, and cleanup, but no claim of OS
  filesystem or network isolation;
- `confined-wasm`: only verified modules and supplied buffers, with no host
  filesystem or network access exposed by the driver.

An `external-hosted` surface separately and necessarily binds the core-owned
`opaque-web-v1` profile: an opaque-origin iframe, core-selected CSP, and generic
message protocol. A native surface has no external browser execution profile.

Environment variables are allowlisted per driver. Provider and artifact paths
are never accepted from browser input. Diagnostics are bounded and scrubbed.
Receipt verification rejects path traversal, absolute portable paths, symlink
escapes, missing assets, size changes, and digest changes before activation.

### Use deterministic resolution and explicit activation

The server resolves one contribution through named lanes:

1. a matching protected Studio authored-code plugin;
2. an explicitly activated `external-override` contribution for an eligible
   data-backed format;
3. a matching Studio built-in plugin;
4. a matching `external-fallback` contribution; and
5. an unavailable terminal binding.

There is no arbitrary numeric priority and vendor identity does not imply
precedence. Every executable external contribution requires an operator
activation that selects one exact provider and contribution for a format or
path scope and lane. If multiple same-lane contributions match without one
explicit selection, none of those external contributions is eligible: a
matching built-in still wins, otherwise the terminal binding reports the
configuration conflict. Directory order, discovery timing, and lexical provider
id are never tie-breakers.

Overlapping activation scopes do not gain a specificity rule. If two activation
records make multiple external contributions eligible for the same Artifact and
lane, all conflicting external contributions are ineligible until the operator
removes or narrows an activation. This keeps a broad path glob from silently
stealing precedence from a format activation.

The activation record is Studio-private, server-owned operator configuration;
it is not part of the browser catalog or an external manifest. It records
provider id, contribution id, fingerprint, contribution support, scope, lane,
adapter execution profile, surface security profile, and user consent. The
first external-provider implementation spec must select its portable
persistence location and atomic update contract. A provider update invalidates
the activation until the new fingerprint is receipt-verified and approved.

Provider verification failure removes its contributions before resolution, so
the next catalog can select the native or another fallback plugin. A runtime
failure after a binding was published does not silently change renderer identity
inside the same catalog revision. Studio reports the bounded failure and may
offer an explicit native fallback; an authoritative catalog refresh performs
any new selection.

### Add retained Session artifacts through a separate authority

The current directory catalog answers “what exact files are readable here now?”
It does not retain previous bytes and must not claim history, replay, or
session-scoped provenance.

A later implementation may add a `SessionArtifactManifest` as a separate
Artifact authority. It records stable thread identity within that Session,
retained revision content or an immutable content locator, adapter and runtime
receipts, and evidence-backed links such as:

```text
Session event or tool call
  -> created | read | updated | validated
  -> Artifact Thread
  -> exact Artifact Revision
  -> optional adapter-owned semantic address
```

Trace links come from retained host/tool evidence or an explicit adapter
receipt. Filename similarity, current worktree state, timestamps, and prose
claims are not sufficient evidence. Semantic addresses such as a PPTX slide or
shape remain adapter-owned, versioned values.

Revision compare and replay operate only on retained revisions. A future
format-specific comparator may consume two compatible snapshots and produce a
separate comparison result; it does not become a renderer branch and it does
not mutate either revision. Until retained content and provenance exist, Studio
must show that compare or replay is unavailable.

### Keep ownership narrow and discoverable

Current source ownership is:

| Concern | Owner |
| --- | --- |
| Host-neutral descriptor, snapshot, source-entry, adapter, surface, and Provider contracts | `packages/harness/src/artifacts/`, published as `@qoder-ai/harness/artifacts` |
| Browser-safe compatibility re-export | `packages/harness-studio/src/artifact-model.ts` |
| Directory discovery, classification, revision hashing, and catalog projection | `packages/harness-studio/src/server/artifact-catalog.ts` |
| Ordered server selection, receipt verification, activation, and embedded Provider injection | `packages/harness-studio/src/server/artifact-plugin-registry.ts`, `artifact-provider-discovery.ts`, and `artifact-provider-activation.ts` |
| Format parsing and semantic projection | Format-owned adapter modules such as `pptx-artifact-adapter.ts` and `markdown-artifact-adapter.ts` |
| Studio compile/build lifecycle | `artifact-build-runtimes.ts` and `artifact-compile-runtime.ts` |
| Browser renderer composition | `packages/harness-studio/src/app/ArtifactView.tsx` |
| Opaque-origin Studio preview lifecycle | `packages/harness-studio/src/app/ArtifactPreviewHost.tsx` |
| External acquisition and verification | Provider-owned server modules, currently `packages/harness-studio/src/server/artifact-viewers.ts`, `qoder-canvas-viewer-bridge.ts`, and `walnut-bootstrap.ts` |

External-provider implementations keep vendor translation and execution behind
a provider-owned boundary rather than creating a global service locator. An
embedding application supplies installed Providers explicitly to server
startup; activation still binds one contribution, fingerprint, lane, matcher,
adapter profile, and surface profile. Core catalog, common server routes, and
browser mounting do not gain another vendor branch when a provider is added.

After that migration, `artifact-plugin-registry.ts` is the server composition
root: a `createArtifactPluginRegistry({ builtIns, externalProviders })`-shaped
factory receives dependencies from server startup and returns an immutable
registry. It is not process-global discovery. `ARTIFACT_VIEW_PROVIDERS` in
`ArtifactView.tsx` remains the browser surface composition table until its
legacy “provider” name is migrated.

The contributor edit map is:

| Contribution | Required edit targets after migration | Must not change |
| --- | --- | --- |
| Studio-native data format | Declarative format table, format-owned adapter/schema, server plugin registration, and a browser surface-mount entry only when it introduces a new surface | Generic server routes and `ArtifactView` dispatch logic |
| Studio virtual document format | Declarative format table, build-runtime contribution, package allowlist when justified, and focused tests | Artifact compile-runtime implementation and sandbox protocol |
| External provider source | Provider-owned discovery/receipt translation, approved driver binding, contributions, and one server composition-root registration | Catalog projection logic, generic hosted routes, and browser surface dispatch |
| Renderer sharing an existing surface protocol | Server plugin contribution and tests | Browser composition table |

Adding one declarative table or composition entry is registration, not a
forbidden host branch. The prohibited change is embedding vendor- or
format-specific control flow inside catalog projection, generic routes, or the
`ArtifactView` dispatch function.

## Consequences

- Artifact View becomes one composition boundary without forcing all formats
  through one renderer technology or one inheritance hierarchy.
- Data snapshots, build snapshots, hosted views, and native React Views retain
  distinct trust and caching semantics.
- SVG and Beautiful Mermaid can share the React/esbuild preview lifecycle
  without making arbitrary document bytes executable in Studio origin.
- Qoder compatibility remains available but no longer defines the host model.
- Walnut can be discovered and receipt-verified honestly before it has a supported
  Adapter; capability follows reviewed contributions rather than installation.
- Adding a format requires a plugin contribution, schemas, renderer surface,
  limits, and tests. It may add declarative classification and composition
  entries, but it should not require a new control-flow branch in the catalog,
  server router, or `ArtifactView` host.
- Provider receipts, fingerprint-aware catalog revisions, activation state,
  adapter execution profiles, and surface security profiles add implementation
  and operational complexity.
- The current Qoder trusted-process boundary remains weaker than a true sandbox
  and must stay labeled accordingly until a stronger driver is implemented.
- Session trace, retention, compare, and replay remain unavailable until their
  separate authority and evidence contracts are implemented.

## Rejected alternatives

- **Use Qoder Canvas as the Artifact host abstraction.** Rejected because it
  couples Studio-owned formats and dynamic rendering to one external provider.
- **Make every renderer inherit from the PPTX or code View.** Rejected because
  renderer reuse is composition of host lifecycle and smaller primitives, not a
  class hierarchy.
- **Let the browser choose by extension or payload kind.** Rejected because it
  duplicates server policy and permits selection/execution drift.
- **Treat a receipt-verified Walnut installation as a working Adapter.** Rejected
  because asset identity does not prove an invocation or output contract.
- **Allow external manifests to run arbitrary commands.** Rejected because the
  manifest would become a self-authorizing code execution API.
- **Run authored React, SVG script, or Mermaid output in the Studio document.**
  Rejected because untrusted Artifact content would inherit Studio origin and
  privileges.
- **Use the current directory as revision history.** Rejected because a mutable
  path cannot replay bytes that have already changed.
- **Silently fall back after a selected runtime fails.** Rejected because the UI
  would no longer represent the binding named by its catalog revision.

## Migration sequence

Each non-trivial slice requires its own dated Spec, acceptance scenarios, and
review evidence.

1. Introduce generic internal surface and external-provider bindings plus the
   V2 compatibility normalization table without changing V2 wire behavior.
2. Translate Qoder discovery, sidecar adaptation, hosted routes, and runtime
   assets into one receipt-covered provider contribution. Remove Canvas-typed
   values from generic internal contracts, retain the V2 wire aliases, import
   existing data-format override flags once into fingerprint-bound activation,
   and preserve fallback/browser behavior. Protected Studio code-backed formats
   are not override-eligible.
3. Project a receipt-verified Walnut installation as a locally derived external
   provider with zero contributions. Expose installed, receipt-verified,
   inactive, and unavailable states without weakening native PPTX. Any future
   Walnut contribution starts with `support: "experimental-local"`.
4. Add a Walnut format contribution only after its invocation, output schema,
   execution profile, licensing boundary, and cross-platform evidence have been
   reviewed.
5. Define the retained `SessionArtifactManifest` and `ArtifactTraceLink`
   contracts before adding Session navigation, semantic trace, compare, or
   replay claims.
6. Add future formats through contributions and existing surface protocols;
   revise the public catalog only when an additive V2 projection is insufficient.
7. Remove the Qoder V2 renderer and payload aliases only through a dated V3 or
   negotiated compatibility migration with old-client evidence.

## Validation gates

- Contract tests prove one server-selected binding projects consistently into
  catalog, snapshot/build, resource, and hosted-view routes.
- Browser tests prove exact renderer dispatch, unknown-renderer failure,
  Code/Diff shared rendering, native PPTX/Markdown behavior, and Studio
  React/SVG/Beautiful Mermaid sandbox behavior.
- Dynamic preview tests prove confined imports, package allowlists, compile and
  output budgets, timeout, opaque origin, no-network CSP, handshake identity,
  theme updates, and stale-result rejection.
- Qoder migration tests preserve explicit override, native-before-fallback,
  request-scoped copies, bounded sidecar behavior, path scrubbing, iframe
  isolation, legacy V2 wire behavior, one-time override import, protected
  code-backed formats, initial `experimental-local` contribution support, and
  real provisioned-runtime smoke coverage where available.
- Provider tests prove receipt portability on Windows, macOS, and Linux;
  relative-path confinement; full asset fingerprinting; tamper invalidation;
  explicit activation; and catalog revision movement.
- Walnut tests prove that a receipt-verified installation with zero
  contributions does not advertise a renderer and cannot displace the native
  PPTX adapter.
- Session trace tests, when that slice exists, prove exact retained revision and
  event/tool evidence identity and explicitly reject current-worktree inference.
- Visual verification covers wide, compact, and narrow Artifact surfaces,
  keyboard focus, bounded overflow, console/page errors, and screenshots.
- Adding a synthetic external provider requires only its provider translation,
  approved driver/contribution, composition-root registration, schemas, and
  tests; common catalog and browser dispatch remain unchanged.
