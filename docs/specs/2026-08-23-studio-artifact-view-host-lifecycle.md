# Stabilize the Artifact View host lifecycle

## Traceability

- Spec ID: studio-artifact-view-host-lifecycle
- Status: Implemented
- ADR: [Harness Studio Artifact runtime and provider architecture](../adrs/studio-artifact-runtime-and-providers.md)

## Intent

Evolve the current browser-side `ArtifactView` dispatch boundary into a small,
stable View Host without changing the server-selected Artifact model or
rebuilding every Surface around a new protocol.

The first increment preserves every current Studio scenario while fixing three
observable lifecycle problems:

1. a new content revision currently remounts the complete React Surface even
   when its adapter, renderer, provider, and security binding are unchanged;
2. format Views cannot preserve safe presentation state such as zoom or the
   Preview/Source tab without also risking stale semantic state; and
3. several built-in capability declarations describe intended or internal
   runtime behavior rather than controls a user can actually exercise.

Artifact View remains the Studio-owned workbench surface. Canvas continues to
mean only the existing Qoder Canvas integration behind the generic
external-hosted Surface. The server remains the sole authority for adapter,
runtime, renderer, Provider, and Surface selection.

This is an evolutionary compatibility slice. It introduces one additive
binding identity and a browser lifecycle rule; it does not introduce retained
Artifact history, a general iframe RPC protocol, or a shared universal View
state schema.

## Current Scenario Baseline

The implementation must preserve these currently supported routes:

| Surface family | Current artifacts | Update behavior in this increment |
| --- | --- | --- |
| Native exact-content | source, diff, JSON, text, image | Keep the React Surface mounted for the same Artifact and binding; reload the declared exact content reference |
| Native data snapshot | Markdown, DOCX, PPTX, XLSX | Keep the React Surface mounted; load and identity-check the new immutable snapshot; reset positional navigation and semantic selection |
| Studio sandbox | authored TSX/JSX, Studio SVG, Studio Mermaid | Keep `ArtifactPreviewHost` mounted; keep its Preview/Source state; replace the inner build iframe for a new build |
| External hosted | Qoder Canvas and activated Provider-defined renderers | Keep the generic hosted Surface and opaque-origin sandbox; changing `viewUri` may navigate/reload the iframe |
| Unavailable | unknown or unselected renderer | Keep the Artifact visible with the server-provided accessible reason |

The browser must continue to follow the exact renderer and references declared
by the catalog. It does not infer a Surface from the filename, extension,
payload kind, Provider label, or a locally preferred renderer.

## Research Basis

This increment deliberately adopts only the smallest useful parts of adjacent
industry models:

- [VS Code custom editors](https://code.visualstudio.com/api/extension-guides/custom-editors)
  separate shared document data from individual editor View state. Studio uses
  the same lifetime distinction without adding edit, save, or undo behavior.
- [VS Code notebooks](https://code.visualstudio.com/api/extension-guides/notebook)
  separate serialization, execution, and rendering. Studio retains its
  Adapter, Build Runtime, and Renderer boundaries rather than moving parsing
  into the View Host.
- [Jupyter messaging](https://jupyter-client.readthedocs.io/en/latest/messaging.html)
  and the [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/overview)
  show how request identity, ordering, cancellation, and capability negotiation
  can support richer future Surfaces. This increment keeps the existing
  `runtime.init` protocol and does not generalize it before a second concrete
  Host-controlled iframe interaction exists.

## Decisions

### D-1: Artifact View owns lifecycle, not format policy

`ArtifactView` remains the browser composition root and may delegate its
implementation to an internal `ArtifactViewHost`. A file rename or new class is
not required by this spec.

The Host owns:

- resolving the exact browser Surface mount for the server-selected renderer;
- deciding whether a React Surface instance is retained or remounted;
- rendering the common unavailable state; and
- passing the selected descriptor and live-generation signal to the Surface.

The Host does not parse format payloads, rebuild content or snapshot URLs,
choose a fallback renderer, execute provider code, or own format-specific
navigation rules.

Native Views continue to own their current local UI state in this increment.
The Host owns the lifetime boundary that makes deliberate state preservation
possible; promotion of common selection into Inspector-visible state requires
a later spec with a real consumer.

### D-2: Add one explicit Surface binding identity

Add an optional `bindingId: ArtifactDigest` to
`ArtifactRendererReference`. The current Studio server emits it for every
ready renderer. Keeping it optional preserves additive V2 parsing for older or
independently constructed descriptors; when absent, the browser uses the
current conservative full-remount key.

`packages/harness-studio/src/server/artifact-catalog.ts` owns one pure,
versioned `ArtifactSurfaceBindingIdentityV1` projection from the already
resolved immutable plugin binding. The server hashes that projection to emit
`bindingId`; catalog revision calculation consumes the emitted `bindingId`
instead of maintaining a second list of the same trust and runtime fields.

The canonical projection contains:

- backing lane;
- adapter id, version, and output schema;
- selected build-runtime id and version when present;
- renderer id, provider, and type;
- the complete discriminated Surface identity: kind and renderer id, plus the
  Studio runtime id for `studio-sandbox`, or the Surface runtime id, hosted
  runtime implementation id/version, and security profile for
  `external-hosted`;
- sorted, duplicate-free effective capabilities; and
- external Provider id, contribution id, fingerprint, support level, adapter
  execution profile, and Surface security profile when present.

The digest excludes source bytes, revision id, snapshot id, build id,
revision-scoped content/snapshot/build/view URIs, labels, and current UI state.
Those values update an existing compatible Surface; they do not define its
implementation or trust boundary.

The Host receives an `authorityId`; the current directory-catalog caller passes
`catalog.snapshot.catalogId`. A future retained Session manifest must pass its
own authority identity rather than reusing a filename-derived Artifact id.

For one authority and `artifact.id`, the browser Surface instance key becomes:

```text
mount id + authority id + artifact id + renderer binding id
```

Switching authority, Artifact, adapter/schema, renderer, Provider fingerprint,
capabilities, execution profile, or security profile therefore remounts. A
content-only revision update under the same authority and binding does not.

Every `bindingId` change also changes `catalog.snapshot.revision`. A
content-only change moves the catalog revision because the descriptor changed,
but leaves `bindingId` stable. Tests vary each identity field independently so
future binding axes cannot drift between the two digests.

### D-3: Preserve presentation state, reset positional semantic state

Current DOCX paragraph, PPTX slide, XLSX sheet, and Markdown heading addresses
are positional. The same address can name a different object after insertion
or reordering, so address existence is not continuity evidence. This increment
does not add adapter schemas or cross-revision continuity keys.

After loading a new exact revision:

- DOCX keeps zoom and clears its selected address;
- PPTX keeps zoom, returns to the first available slide, and clears its selected
  address;
- XLSX returns to the snapshot-declared active sheet and clears its selected
  cell;
- Markdown introduces no selected-outline state; its exact snapshot reloads,
  and any retained pixel scroll position carries no Artifact Address or
  evidence claim; and
- `ArtifactPreviewHost` keeps the Preview/Source tab while its inner iframe is
  still keyed by immutable `buildId` and follows the existing latest-build-wins
  rule.

Changing authority, `artifact.id`, or `bindingId` resets all Surface-local state
through a remount. This spec does not persist View state across Studio reloads,
different tabs, renamed files, or independent Artifact authorities.

### D-4: Preserve the existing Surface-specific update mechanisms

This increment does not force native React Views and iframe Views behind one
new transport:

- native Views update through React props and exact snapshot/content fetches;
- the Studio sandbox keeps its existing `runtime.init` `MessageChannel`, build
  identity checks, timeout, theme update, and stale-result rejection;
- external-hosted Views keep same-origin revision-scoped `viewUri` navigation
  inside `sandbox="allow-scripts"` with `referrerPolicy="no-referrer"`; and
- unavailable Views remain inert status output.

Every retained Surface follows one ordering invariant: an asynchronous result
commits only when it still matches the latest requested artifact, revision, and
snapshot/build/content reference. Cleanup aborts obsolete work, and a request
generation or equivalent active-token check rejects a late completion even
when abort races with response resolution. This applies to exact-content and
native snapshot paths as well as the existing sandbox build path.

An external hosted document may therefore reload on a content revision. A
generic `initialize`/`updateSnapshot`/`selectionChanged` Surface protocol is
eligible only when at least one non-preview hosted integration needs a
Host-controlled interaction and can be tested without weakening the current
opaque-origin boundary.

### D-5: Capabilities describe observable Surface behavior

`ArtifactCapability` remains forward-compatible, but a built-in contribution
advertises a capability only when the selected Surface exposes that behavior
to the user. A capability may be implemented inside the Surface; it does not
imply that the Host can remotely invoke it. Host-controllable commands require
a later protocol contract.

The first increment uses this built-in baseline:

| Built-in Surface | Capabilities |
| --- | --- |
| Source, diff, JSON, text | none until explicit search or address selection UI exists |
| Image | none until explicit zoom or selection UI exists |
| Markdown | `navigate`, `outline` |
| DOCX | `navigate`, `outline`, `select`, `zoom` |
| PPTX | `navigate`, `outline`, `select`, `zoom` |
| XLSX | `navigate`, `select` |
| Authored React preview | `execute`, `live-update` |
| Studio SVG and Mermaid document previews | `live-update` |

External contribution capabilities remain receipt- and contribution-bound
Provider declarations. Studio preserves unknown capability strings, does not
invent matching Host controls, and tests any capability used for a support
claim through the selected hosted Surface.

### D-6: Preserve V2 backing semantics in this slice

The current V2 `backing` field selects the data snapshot or compile/build
lifecycle. Studio SVG and Mermaid therefore remain `backing: code` while they
continue to use Studio-owned virtual modules and the existing build/preview
route.

Whether a later catalog should separately describe Artifact payload nature
from presentation execution is a V3 or additive-contract decision. Reclassifying
these formats while changing Host lifetime would combine unrelated migrations
and put current dynamic-render regression coverage at risk.

## Acceptance Scenarios

- **AVH-AC-1:** Every ready descriptor emitted by the Studio server carries a
  valid `renderer.bindingId`. Its value is stable across a content-only
  revision and changes when any selected adapter, runtime, renderer, Provider
  fingerprint/support, capability set, execution profile, or security profile
  changes. Every binding change moves `catalog.snapshot.revision`; content-only
  changes leave `bindingId` stable. An older V2 descriptor without `bindingId`
  still validates and uses the current conservative remount behavior.
- **AVH-AC-2:** For the same authority, `artifact.id`, and `bindingId`, a new
  content, snapshot, or build revision updates the mounted Surface without
  changing its React component instance. Changing catalog authority, Artifact,
  or binding remounts it even when the filename and binding happen to match.
- **AVH-AC-3:** DOCX, PPTX, XLSX, and Markdown load only descriptor-bound,
  runtime-validated snapshots. DOCX/PPTX zoom survives a content revision;
  positional slide/sheet navigation and every semantic selection reset to the
  new snapshot defaults before they can point at a different object. Markdown
  gains no new selected-outline model.
- **AVH-AC-4:** Authored TSX/JSX still compiles and renders only in the
  opaque-origin Studio sandbox. Revision updates retain the Preview/Source tab,
  replace the build-scoped iframe, ignore stale completions, propagate theme,
  and preserve compile-failed, runtime-failed, timeout, retry, and source
  behavior.
- **AVH-AC-5:** Studio SVG and Mermaid retain their current virtual-module,
  no-parent-DOM, no-network, live-update behavior. Their built-in capabilities
  no longer imply that the Artifact source itself is an executable application.
- **AVH-AC-6:** Qoder Canvas and every activated Provider-defined renderer with
  a validated `viewUri` continue to mount through the generic external-hosted
  Surface with the current sandbox and server-selected identity. No
  provider-, renderer-, or format-specific branch is added to `ArtifactView`.
- **AVH-AC-7:** Ready source, diff, JSON, text, image, Markdown, DOCX, PPTX,
  XLSX, authored React, Studio SVG/Mermaid, and external-hosted fixtures resolve
  through the current Surface registry. Unavailable or unmountable descriptors
  terminate in the Host-owned accessible failure state. The built-in capability
  matrix matches D-5 exactly; unknown capabilities remain parseable.
- **AVH-AC-8:** An unknown renderer without a validated hosted `viewUri`, a
  malformed snapshot/build payload, or a missing renderer remains visible as
  an accessible bounded failure. The browser does not reclassify it from its
  extension or payload. A delayed response for an older exact-content or native
  snapshot request cannot replace the latest revision.
- **AVH-AC-9:** Existing Artifact keyboard behavior, visible focus, status/live
  regions, theme behavior, and document-level overflow remain valid at
  1440x900, 1024x768, and 390x844. Changed visual states have screenshots and
  no unexpected console or page errors.
- **AVH-AC-10:** Focused contract, registry, catalog, snapshot, build, Provider,
  and browser tests pass, followed by Studio typecheck/build/tests, the Markdown
  link graph, and `git diff --check`. The optional Qoder Canvas preview smoke is
  reported separately when its external SDK runtime is not provisioned.

## Non-goals

- Retained revisions, a content-addressed Artifact store, replay, compare,
  annotations, writeback, or cross-Session `ArtifactThread` identity.
- `SessionArtifactManifest`, `ArtifactTraceLink`, Inspector back-links, or
  evidence-level inference.
- A general `ArtifactSurfaceProtocolV1`, cross-iframe selection/reveal RPC,
  capability handshake, or one universal View state object.
- Reclassifying Studio SVG/Mermaid backing, replacing the V2 catalog, or
  removing Qoder compatibility wire values.
- New formats, WebContainer, Sandpack, npm installation, arbitrary package
  imports, or a new compile runtime.
- Provider activation, precedence, acquisition, receipt, or support-policy
  changes.
- Editing, save, undo/redo, formula recalculation, or Office/native-application
  fidelity claims.

## Plan and Tasks

1. Add the optional host-neutral renderer `bindingId` contract, validator, and
   compatibility fixtures under `packages/harness/src/artifacts/`.
2. Add one versioned canonical binding-identity projection in
   `artifact-catalog.ts`; compute both emitted `bindingId` and catalog revision
   from it without re-resolving descriptor strings or duplicating field lists.
3. Pass the current catalog authority into `ArtifactView`, change the browser
   Surface instance key to prefer `authorityId + bindingId`, and retain the
   existing key as the missing-`bindingId` fallback within that authority.
4. Preserve only revision-safe presentation state, reset positional semantic
   state, and enforce latest-request-wins for retained exact-content and
   snapshot Views while retaining the existing Studio sandbox build/frame
   lifecycle.
5. Align built-in capability declarations with D-5 and add behavior-level tests
   rather than source-string assertions.
6. Extend focused unit and Playwright coverage across the complete current
   scenario matrix, then run package and documentation gates serially.

## Test and Review Evidence

### Required implementation evidence

- **AVH-AC-1/2:** contract/catalog tests prove stable content-only binding
  identity, one canonical normalized field tuple, binding/catalog-revision
  drift together, authority isolation, legacy fallback, retained component
  identity, and required remounts. The `bindingId` validator and missing-field
  compatibility fixture run in the owning Harness Artifact contract suite,
  before Studio consumes the rebuilt package output.
- **AVH-AC-3/7/8:** Surface registry and component tests exercise exact
  snapshot identity, presentation-state retention, semantic-state reset,
  delayed-old-response rejection, every current Surface family, capability
  declarations, and bounded failures.
- **AVH-AC-4/5/6/9:** the existing Artifact and external-host Playwright suites
  cover sandbox identity, latest-build-wins, dynamic documents, hosted
  Providers, keyboard focus, themes, overflow, and browser error channels; add
  a content-revision case that proves compatible View state retention.
- **AVH-AC-10:** run, in order:

  ```text
  npm test --workspace @qoder-ai/harness -- --maxWorkers=1
  npm run typecheck --workspace @qoder-ai/harness-studio
  npm test --workspace @qoder-ai/harness-studio -- --maxWorkers=1
  npm run test:browser --workspace @qoder-ai/harness-studio
  npx vitest run test/skills-docs/doc-link-graph.test.mjs
  git diff --check
  ```

  If shared generated Harness output is refreshed, run
  `npm run harness:generated` before Harness/UI/Studio consumers rather than in
  parallel with them.

### Implementation evidence (2026-08-23)

- The Harness Artifact contract emits and validates the optional renderer
  `bindingId`; the owning Harness suite passed 19 files and 162 tests after a
  clean package build.
- Studio's canonical binding projection, authority-aware Host key, revision
  state policy, latest-request guards, and built-in capability matrix passed
  the complete Studio unit suite: 39 files and 235 tests, plus typecheck and a
  production app build.
- The complete Playwright suite passed all 35 tests with one worker. It includes
  new receipts for retained Preview/Source state, DOCX/PPTX zoom retention,
  DOCX/PPTX selection reset, XLSX active-sheet/cell reset, and rejection of a
  delayed older exact-content response. The existing external-host, sandbox,
  keyboard, theme, overflow, and wide/compact/narrow scenarios also passed.
- After the readiness review tightened positional state so stale addresses are
  excluded during render (rather than cleared after paint), Studio typecheck,
  production build, all 39/235 unit tests, and the five affected lifecycle
  browser scenarios passed again.
- The documentation link graph passed all 8 checks,
  `npm run harness:generated` reported no generated drift, and
  `git diff --check` passed.
- The optional standalone Qoder Canvas preview smoke could not start because no
  Canvas SDK runtime was provisioned (`Missing Canvas SDK runtime`). This is an
  external compatibility smoke boundary, not a failure of the generic hosted
  Surface exercised by the passing browser suite.

### Spec review gate

- Run the same read-only artifact through independent reviewers for
  `complexity`, `convenience`, and `evolution`.
- Normalize findings as P1/P2/P3. Amend only this owning spec for convergent
  P1/P2 issues; P3 polish remains optional.
- Keep `Status: Draft` until all requested reviewers report
  `p1_p2_clear: true`. Implementation and its evidence require a later status
  transition; spec review alone does not justify `Implemented`.

### Spec preparation and triangulated review evidence

- The pre-implementation baseline passed 28 focused Artifact registry,
  snapshot, and Provider tests across three files. The Markdown link graph
  passed all 8 checks, and `git diff --check` passed.
- The first independent three-reviewer round found five normalized blocking
  clusters: positional-address continuity, duplicated binding/catalog identity,
  missing authority scope, native async ordering, and Host-versus-registry
  unavailable ownership. The spec resolved them without adding stable-address
  schemas or a generic Surface protocol.
- A follow-up P2 added the owning Harness package build/test ahead of Studio so
  the public `bindingId` contract cannot be consumed from stale output.
- In the final same-prompt, read-only round, all three independent reviewers
  returned `verdict: pass`, `p1_p2_clear: true`, and no findings across
  `complexity`, `convenience`, and `evolution`.
- `Accepted` records spec-review readiness only. No implementation, browser
  rerun, commit, push, merge, or release claim is made by this status.

### Risks

- **Binding under-specification:** omitting a trust- or output-affecting field
  could reuse a Surface across a Provider/runtime change. Compute the digest
  from the resolved binding object and test every included identity axis.
- **False state continuity:** an address can retain the same ordinal while
  naming a different semantic object. This increment resets semantic selection
  and positional navigation on every revision; stable cross-revision selection
  requires a later adapter-owned continuity key and insertion/reorder evidence.
- **Authority collision:** filename-derived Artifact ids repeat across catalog
  roots. The Host key includes the current authority id and remounts when that
  authority changes.
- **Late native response:** retaining a component makes abort-only fetch cleanup
  insufficient as the sole correctness claim. Exact-content and snapshot Views
  reject completions that no longer match the latest requested identity.
- **Legacy descriptor behavior:** missing `bindingId` must remain conservative,
  even though that means older descriptors still remount on revision changes.
- **Hosted Surface limitations:** external iframe reloads remain acceptable and
  must not be presented as incremental protocol support.
- **Capability drift:** declarations can outrun UI behavior. Keep the built-in
  matrix explicit and require behavioral evidence for new claims.
