# AgentReact Artifact Runtime production foundation

## Traceability

- Spec ID: agent-react-artifact-runtime-poc
- Status: Implemented locally; cross-platform CI and publication pending
- ADR: [Harness Studio Artifact runtime and provider architecture](../adrs/studio-artifact-runtime-and-providers.md)
- Related spec: [Stabilize the Artifact View host lifecycle](2026-08-23-studio-artifact-view-host-lifecycle.md)

## Intent

Prove that a React Artifact can travel the whole AgentReact pipeline as an
addressable, verifiable, transactionally committed build:

```text
Agent Source Stream
→ Artifact Revision
→ Oxc Semantic Compile
→ esbuild Link
→ Immutable Build Snapshot
→ Opaque Sandbox Staging
→ Atomic View Commit
→ Observation
```

The proof of concept only strengthens the existing ADR-0007 Code-backed
lifecycle. It does not add a third lifecycle, and it does not touch the
Data-backed adapter path.

The value being proved is not "TSX can be bundled" — Studio already bundles TSX
through `artifact-compile-runtime.ts`. The new claims are:

1. a compile stage can *refuse* code that leaves the AgentReact language
   profile, before any bundle exists;
2. a default export can declare its state and capability requests as static
   data, and the Host can grant strictly less than the code asked for;
3. every rendered DOM node can carry a deterministic address back to its source
   span; and
4. a new build can be verified in a separate staging frame and committed
   atomically, so a failing revision never replaces a working view.

The pipeline above is the target architecture. The first increment established
the production-eligible data and Host foundations. The production increment
continues in this same spec: it registers an explicit AgentReact format, moves
Oxc behind a restartable deadline-enforced Worker, and binds the build to
Studio's existing opaque-origin iframe/CSP/MessageChannel security surface.

## Production Readiness

Production readiness is assessed per boundary rather than inherited from a
passing end-to-end POC:

| Boundary | Readiness in this increment | Production rule |
| --- | --- | --- |
| Revision, compile/link contracts, Build Snapshot identity | Production-eligible foundation | Identity-owned records are deeply immutable and every effective compiler/runtime policy participates in the build identity |
| Oxc Node compiler | Implemented; macOS arm64 runtime and extracted-install verified; Intel macOS dependency closure checked | Native parsing may process untrusted source only inside a restartable Worker with an enforceable per-request deadline; direct in-process use remains verification-only |
| Profile validator | Advisory production diagnostic | It improves refusal quality but is never a security boundary; execution isolation and Host Action validation remain mandatory |
| State, capability, Action, and observation Host services | Production-eligible foundation | The Host owns immutable state copies, tokens are unguessable, approval revocation is effective immediately, and Actions are revalidated per dispatch |
| Transaction controller | Production-eligible only with an isolated FrameFactory | Concurrent stages are generation-fenced; a rejected, superseded, timed-out, or disposed frame can never act on newer controller state |
| `LocalFrameFactory` | Verification-only | It may prove compile/link/address wiring with explicit opt-in, but it is not an origin boundary and cannot support a production execution claim |
| Opaque iframe transport and Studio registration | Implemented; Chromium wide/compact/narrow verified | Reuse the existing Studio sandbox only after AgentReact adds transferred-port identity, two-frame commit, state/Action validation, cancellation, browser mount/error evidence, and responsive browser QA |

The controller therefore rejects an in-process `FrameFactory` by default.
Tests and local experiments must opt in explicitly, making it impossible to
register the verification transport accidentally as a production runtime.

## Terminology

The document under implementation renames several overloaded words. This spec
uses the same vocabulary, and the code uses it verbatim:

| Term | Meaning |
| --- | --- |
| `Artifact Revision` | Digest-addressed, immutable set of module sources |
| `Build Generation` | One monotonically numbered build attempt |
| `Build Snapshot` | Frozen, replayable compile+link result |
| `Artifact View Definition` | The `defineArtifactView` default export |
| `Artifact Surface` | Unchanged ADR-0007 presentation kind |

## Decisions

### D-1: Four layers, one narrow compiler port

The POC keeps the four-layer split from the source document, and each layer is one
directory whose barrel is its public face:

| Directory | Layer | Owns |
| --- | --- | --- |
| `contracts/` | (shared) | Layer-crossing types, plus the addressing algorithm |
| `kernel/` | Oxc Semantic Kernel | Parse, admit, extract ABI, index, erase types |
| `linker/` | esbuild Linker | Resolve modules, externalize Bootstrap, emit one bundle |
| `runtime/` | React Artifact Runtime | Render, state/action hooks, node addressing |
| `host/` | Artifact Host | Revision, state, grants, actions, commit, observation |

Dependencies point one way: `host → {kernel, linker, runtime} → contracts`. Two of
those edges are load-bearing rather than tidy:

- **`runtime` may not reach the kernel.** The runtime layer is what loads inside
  the sandbox frame. One import of `kernel/` pulls `oxc-parser`'s native binding
  into a browser bundle, which then fails to load at all.
- **`contracts` may not use Node built-ins or any package.** The runtime
  re-exports contracts into the frame, so a single `node:crypto` there breaks the
  same load. This is why hashing enters the pipeline as an injected `DigestFn`,
  and why `contracts/addressing.ts` inlines a 64-bit FNV-1a instead of importing
  one.

`contracts/addressing.ts` is the only contract module with executable code, and
that is the point: the kernel computes a JSX element's id at compile time and the
sandbox `jsxDEV` computes it again at render time. Two copies of "the same" hash
in two layers is exactly how those drift, so both layers import this one.

Business code never sees an Oxc AST; it depends only on `OxcCompilerPort`:

```ts
interface OxcCompilerPort {
  readonly compilerVersion: string;
  readonly profileVersion: string;
  compileModule(input: CompileModuleInput): Promise<CompileModuleOutput>;
}
```

Oxc answers *what the code is and whether it obeys the contract*. The Host
answers *what the code is allowed to do*. The Profile validator is therefore
documented and tested as a Semantic Firewall, not as the security authority: the
Action Gateway re-validates every single call at runtime even if a bundle
forged its declaration.

### D-2: Oxc runs through the Node bindings only behind the compiler port

The direct `createOxcCompiler()` adapter remains the deterministic test and
fixture implementation. Production uses the same port through a Node
`worker_threads` adapter because Studio's server owns the confined source root,
the exact revision route, and the immutable build cache. Moving compilation to
the browser would duplicate that authority and transfer the whole source graph
over a second protocol without improving the iframe execution boundary.

The Worker has a per-request deadline. Timeout, crash, invalid response, or
disposal terminates it; the next request starts a clean Worker. The compiler
policy fingerprint includes the deadline and Oxc limits. The stable
`limit/compile-timeout` diagnostic is produced without caching a partial build.

### D-3: The Profile is a closed list of refusals

`AGENT_REACT_PROFILE_VERSION = "1"` refuses, with a stable diagnostic code:

| Code | Refusal |
| --- | --- |
| `profile/commonjs` | `require`, `module.exports`, `exports.x` |
| `profile/node-builtin` | `node:*` and bare Node built-in imports |
| `profile/dynamic-import` | any `import()` |
| `profile/package-not-allowed` | any bare import outside the allowlist |
| `profile/react-dom-root` | `createRoot`, `ReactDOM.render`, `hydrateRoot` |
| `profile/dynamic-eval` | `eval`, `new Function` |
| `profile/worker` | `Worker`, `SharedWorker`, `ServiceWorker`, `navigator.serviceWorker` |
| `profile/network` | `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`, `sendBeacon` |
| `profile/class-component` | `class X extends React.Component/PureComponent` |
| `profile/top-level-effect` | a top-level statement that is not a declaration, an import/export, or a directive |

`profile/top-level-effect` is deliberately a hard rule rather than a budget: a
top-level `VariableDeclaration`, `FunctionDeclaration`, type declaration, import,
export, or string directive is allowed, and every other top-level statement —
expression statements, loops, conditionals, `try`, `throw` — is refused. "Some
side effects allowed" has no test that separates pass from fail, and violations
inside an allowed declaration's initializer are still caught by the other rules.

A refusal is reported as a diagnostic with module path, line, and column, and no
code is emitted for that module.

### D-4: The ABI is extracted, never inferred

`extractArtifactViewDeclaration` accepts exactly one shape:

```tsx
export default defineArtifactView({ id, state, capabilities, component });
```

- `id` must be a static string literal;
- `state` must be an object literal whose keys are `/`-rooted paths and whose
  values are `{ schema: string, version: integer }` literals;
- `capabilities` must be an array literal of string literals;
- `component` must be an identifier bound to a module-local function declaration
  or function-valued `const`, or a named/default import from another module in
  the same Revision. Package and namespace imports cannot be the root component.

Anything else — a spread, a computed key, an identifier reference for `id`, a
capability built by `.map()` — is `abi/not-static`. The validator never derives a
capability from a call the code happens to make, because a permission inferred
from behaviour would grant exactly what an attacker writes.

### D-4b: The linker re-applies the allowlist and externalizes the Bootstrap

`AllowedPackageResolver` answers three questions: is this an internal Revision
module, is it a trusted runtime package, or is it refused. A trusted package
resolves to an **external** Bootstrap specifier in the validation bundle. That
keeps the source-owned link step independent of installed package layout and
makes every trusted mapping part of `buildPolicyDigest`; the production packager
owns the later resolution into the self-contained iframe bundle.

The resolver also maps the TypeScript `./panel.js` → `./panel.tsx` convention,
since that is what a TS-aware agent writes.

The linker refuses a non-allowlisted package independently of the Profile, so
defeating one check does not produce a bundle. Note that Oxc elides an unused
import the way TypeScript does, so only a *used* forbidden import reaches the
linker at all. The production packager then resolves those trusted externals
from Studio's installed dependency closure and emits one self-contained iframe
bundle; Artifact source never controls that resolution step.

### D-5: Grants are an intersection, and the frame token carries them

```text
Granted = Declared Requests ∩ Host Policy ∩ Session Approval
```

`CapabilityBroker.computeGrant()` returns the intersection plus the two reasons a
request was dropped (`not-in-policy`, `awaiting-approval`), so the UI can explain
a missing control instead of silently omitting it. The broker issues a
frame-scoped token; `ActionGateway.dispatch()` validates the token, the
capability, and the frame's action mode on *every* call and revokes on frame
disposal. A revoked token denies even a previously granted capability.

### D-6: Addresses are deterministic within a Revision, and only within it

`@studio/agent-react/jsx-dev-runtime` accepts Oxc's development-shaped JSX call
for its source span, then delegates element creation to React's production-safe
`jsx`/`jsxs`. The automatic development transform supplies `fileName`,
`lineNumber`, and `columnNumber`, so:

```text
SourceNodeId  = fnv1a64(modulePath | line | column | elementType) → 16 hex chars
InstanceAddress = artifactDigest | SourceNodeId | React key | parent instance
```

Intrinsic elements receive `data-artifact-node`; catalog components receive the
reserved `artifactNode` prop and are expected to forward it. The runtime never
reads React internals or Fiber fields.

Cross-Revision continuity is *not* claimed from spans. The `ReactSemanticIndex`
exists for that purpose and is explicitly excluded from authorization.

### D-7: Observations reuse the AG-UI CUSTOM envelope, under their own name

The source document routes observations through `HARNESS_PROTOCOL_EVENT`. That
constant's payload type is `HarnessProtocolEvidence` with `protocol: "acp"`, and
an artifact render is not ACP traffic. The POC therefore keeps the AG-UI
`CUSTOM` envelope but introduces `HARNESS_ARTIFACT_OBSERVATION_EVENT`
(`"harness.artifact-observation"`) so a consumer cannot mistake a render failure
for a protocol receipt. Recorded kinds are the ten versioned values exported by
the AgentReact Host contract.

### D-8: Commit is transactional, and staging cannot act

`SandboxFrameController` holds at most one Current and one Staging frame.
Staging is created with `actionMode: "dry-run"` and a frozen state snapshot;
`activate()` promotes it only after `renderCompleted`. On `renderFailed`, on
timeout, or on a blocking dry-run attempt under a `blockOnDeniedAction` policy,
the Staging frame is disposed and Current is untouched.

Verification performs module load, mount, error boundary, a post-mount paint
boundary with a bounded visibility-independent fallback, and the timeout — it
never synthesizes clicks and never runs a real Action.
Promotion is a Host act, not a frame act: `activate()` revokes the dry-run token,
issues a `live` token for the same build digest, and hands it to the frame. A
frame therefore cannot grant itself live mode.

### D-8b: The transport is a port; verification and production have distinct implementations

`SandboxFrameController` depends on a `FrameFactory`, and the POC ships two
implementations of the frame side:

- `host/frames/frame-protocol.ts` — the transport-free handshake: the init message,
  identity matching, and the render reports. A frame must match protocol version,
  artifact digest, build digest, and frame token before mounting, because an
  opaque origin cannot serve as an identity and a superseded build racing a stage
  is the common case.
- `host/frames/local-frame-factory.ts` — an in-process frame that **really
  executes** the linked bundle: it loads the module, installs the runtime bridge
  into that bundle's own runtime instance, renders the component, and returns
  resolvable node addresses.

Production reuses the existing Studio sandbox response and host invariants:
`<iframe sandbox="allow-scripts">` without `allow-same-origin`,
`referrerpolicy="no-referrer"`, a no-network CSP, a transferred `MessagePort`,
parent/source and full build-identity checks, and bounded handshake time. A
dedicated AgentReact Surface owns Current and Staging iframe instances. Only a
matching `renderCompleted` report promotes Staging; compile, handshake, render,
or protocol failure removes Staging and leaves Current visible.

The opaque frame announces `runtime.ready` only after installing its message
listener and repeats that announcement until the Host transfers the one accepted
port. The Host validates the frame window and full build identity and creates at
most one session per build. Generated preview HTML is served as immutable, so
the compile runtime version participates in the build URL and must change with
the frame document or Host protocol; a new Studio release cannot reuse a
year-cached document from an incompatible protocol version.

Because the in-process factory shares a process and runtime modules with the
Host, it proves compile/link/address wiring only. It does not prove browser
mount behavior, effects, error boundaries, origin isolation, CSP, or concurrent
frame realms. Its type and controller admission policy expose that limitation.

### D-9: Registration is explicit and additive

Existing `*.canvas.tsx` keeps the current `studio.react-source` runtime. The new
compound suffix `*.agent.canvas.tsx` is the only built-in selector for
`studio.agent-react`; ordinary TSX/JSX remains source-only. This prevents
production admission from being inferred from file contents and prevents an
existing Canvas artifact from being silently reinterpreted under the stricter
ABI. The view id is the portable basename before `.agent.canvas.tsx` and must
match the static `defineArtifactView()` id.

### D-10: Production Host services are bounded and deny by default

The browser Host publishes three versioned state schemas: `json@1`, `list@1`,
and `record@1`. State is structured-cloned, validated, and retained only for the
same authority, Artifact id, path, schema, and version. Staging reads a snapshot
and cannot write. A promoted frame receives live state updates over its bound
port.

The initial Action policy grants only `studio.show-source`, a Host-owned command
that selects the existing Source tab. Every other declared capability remains
visible as refused and every dispatch is revalidated against the live port,
frame token, build identity, action mode, and current policy. Staging dispatches
return `dry-run` and never invoke a handler.

## Acceptance Scenarios

- **AR-AC-1:** `AgentStreamAssembler` only commits sealed modules; the same
  module bytes under any patch ordering produce the same `Artifact Revision`
  digest, and different bytes produce a different one. `abortGeneration()`
  discards unsealed work.
- **AR-AC-2:** For each Profile rule in D-3, a module violating it compiles to
  `code === undefined` and a diagnostic carrying that rule's code, module path,
  and a positive line number. A conforming module compiles with no error
  diagnostics.
- **AR-AC-3:** A conforming entry module yields an `ArtifactViewDeclaration`
  whose `id`, `state` schemas/versions, and sorted `capabilities` equal the
  source literals. Non-static `id`, `state`, `capabilities`, or `component`
  produce `abi/not-static` and no declaration. A module with no
  `defineArtifactView` default export produces `abi/missing-view`.
- **AR-AC-4:** `build()` on a multi-module revision returns a frozen
  `BuildSnapshot` whose `buildDigest` is stable across repeated builds of the
  same revision and compiler/profile/runtime versions, and changes when the
  revision or any of those versions changes. A superseded generation's result is
  discarded rather than returned to its caller.
- **AR-AC-5:** The linked bundle executes: loading it with a bootstrap providing
  `react` and `@studio/agent-react` yields the declared view definition, and
  server-rendering its component emits `data-artifact-node` attributes whose
  values resolve through `NodeAddressRegistry` back to the correct module path,
  element type, line, and column. Two elements of the same type on different
  lines get different `SourceNodeId`s; the same element in a re-linked build of
  the same revision keeps its `SourceNodeId`.
- **AR-AC-6:** A bare import outside the allowlist fails the *link* stage as
  well as the Profile stage, so a bypass of one check does not produce a bundle.
- **AR-AC-7:** `computeGrant()` equals the three-way intersection. A capability
  in the policy but awaiting approval is reported `awaiting-approval` and is not
  granted. `dispatch()` denies an unknown capability, an ungranted capability, a
  revoked token, and a stale frame token; a `dry-run` frame records
  `actionAttempted` without invoking the handler; a `live` frame invokes it once.
- **AR-AC-8:** `ArtifactStateStore.snapshot()` returns a frozen value that later
  `set()` calls do not mutate. A `set()` failing schema validation is rejected,
  emits `stateValidationFailed`, and leaves the previous value in place.
  `migrate()` moves a path to a new schema version and notifies subscribers.
- **AR-AC-9:** A successful stage/activate replaces Current and disposes the old
  Current exactly once. A `renderFailed`, a verification timeout, and a blocked
  dry-run attempt each leave the original Current mounted and dispose only
  Staging. `rollback()` after an activation restores the previous snapshot.
- **AR-AC-10:** Every recorded observation encodes to an AG-UI `CUSTOM` event
  named `harness.artifact-observation` carrying artifact digest, build digest
  when known, kind, and sequence; sequences are strictly increasing.
- **AR-AC-11:** The parsed import graph of `src/agent-react/**` obeys D-1: every
  relative import resolves, no cycle exists, every cross-layer edge is allowed and
  goes through the target layer's barrel (`contracts` excepted, being addressable
  file by file), `contracts` and `runtime` use no Node built-in, `oxc-*` appears
  only in `kernel`, `esbuild-wasm` only in `linker`, and `stableHash`,
  `sourceNodeId`, and `instanceAddress` are each defined in exactly one module
  that both the kernel and the runtime import.
- **AR-AC-12:** A committed Revision owns frozen copies of its descriptor and
  every module. Mutating caller-owned inputs or attempting to mutate returned
  nested records cannot change the entry, module bytes, or metadata named by its
  digest. Non-normalized descriptor and module paths fail before streaming.
- **AR-AC-13:** If two stages overlap, only the newest generation may become
  Staging. Completion or failure of the older generation cannot dispose, reject,
  activate, or return the newer frame.
- **AR-AC-14:** A render timeout or disposal aborts bundle loading where the
  loader supports cancellation and fences every post-await side effect. A late
  loader completion cannot install a runtime bridge, render, emit success, or
  mutate controller state.
- **AR-AC-15:** Artifact state stores Host-owned, deeply frozen, structured-clone
  data. A caller retaining the original object, including a shallow-frozen outer
  object, cannot mutate stored or staged state; unsupported state shapes fail
  validation without replacing the previous value.
- **AR-AC-16:** Frame tokens use cryptographic entropy by default. Revoking an
  approval immediately denies subsequent dispatches through already-issued
  tokens, and a token generator collision fails closed.
- **AR-AC-17:** A controller rejects an in-process FrameFactory unless the caller
  explicitly opts into verification-only execution. No test using
  `LocalFrameFactory` is reported as opaque-origin, browser-mount, CSP, or
  production execution evidence.
- **AR-AC-18:** The Build Coordinator owns and validates its Revision input,
  refuses non-normalized or duplicate modules, recomputes the Revision digest,
  requires the static view id to match the descriptor id, and deeply freezes all
  identity-bearing Build Snapshot data. Caller mutation cannot change bytes or
  evidence after either digest is computed.
- **AR-AC-19:** `buildPolicyDigest` changes when compiler limits, Host module or
  output limits, or any trusted Bootstrap specifier/external mapping changes,
  even when the emitted bundle bytes happen to remain identical. `buildDigest`
  includes that policy identity, so cache reuse cannot cross a permission or
  admission-policy change.
- **AR-AC-20:** Production compilation executes Oxc through a Worker. A normal
  multi-module build returns the same ABI and semantic evidence as the direct
  adapter. A deadline terminates the Worker, returns
  `limit/compile-timeout`, retains no partial result, and a later valid request
  succeeds through a fresh Worker.
- **AR-AC-21:** Only `*.agent.canvas.tsx` selects the
  `studio.agent-react` build runtime and `studio.agent-react-preview` Surface.
  Existing `*.canvas.tsx` keeps `studio.react-source`; ordinary TSX/JSX remains
  source-only. The catalog binding and build identity include the AgentReact
  runtime/profile/policy versions.
- **AR-AC-22:** The production frame has an opaque origin, `sandbox` contains
  only `allow-scripts`, referrer policy is `no-referrer`, CSP denies network,
  and initialization requires the parent window, a transferred port, the full
  build identity, action mode, and frame token. Wrong-source, stale, malformed,
  and late messages cannot commit UI or invoke Host services.
- **AR-AC-23:** A valid AgentReact build renders real browser DOM with resolvable
  `data-artifact-node` addresses. During a live revision update Current stays
  visible until Staging reports success. Compile, handshake, and render failure
  leave Current visible; a successful successor atomically replaces it.
- **AR-AC-24:** `json@1`, `list@1`, and `record@1` state survive a compatible
  successful revision, invalid values and staging writes are rejected, and a
  live write rerenders the Artifact. A staging `studio.show-source` dispatch is
  `dry-run`; after promotion the same declared and granted Action selects Source
  exactly once. Unknown, undeclared, stale-token, and refused Actions fail
  closed.
- **AR-AC-25:** Browser observations use the AG-UI `CUSTOM` envelope named
  `harness.artifact-observation`, carry strictly increasing sequence and exact
  Artifact/build identity, and cover staging render, commit, rejection, state
  validation, Action attempt/denial/completion, and runtime failure.
- **AR-AC-26:** Focused contract/Worker/server/Surface tests, a real Chromium E2E
  at wide/compact/narrow widths, Studio build/typecheck/package tests, repository
  tests, documentation links, package verification, and `git diff --check`
  pass. Windows and Linux are claimed only from their corresponding CI jobs.
- **AR-AC-27:** AgentReact initialization is frame-ready-driven rather than a
  one-shot iframe load callback, accepts only the matching frame/build, and is
  idempotent under repeated readiness. Promotion completes when paint callbacks
  are suspended, and a generated-preview protocol change advances the runtime
  version that addresses its immutable preview URL.
- **AR-AC-28:** Static module discovery follows relative sources declared by
  `ImportDeclaration`, `ExportNamedDeclaration`, and `ExportAllDeclaration`.
  A production project whose entry imports through a barrel re-export loads the
  complete Revision and links successfully.
- **AR-AC-29:** An artifact catalog invalidation that recompiles to Current's
  existing `buildId` is a no-op for the Current/Staging transaction. Repeated
  unrelated artifact changes leave the verified frame ready, preserve Host
  state, and keep its MessageChannel Actions usable.
- **AR-AC-30:** The root lockfile contains a package record for every optional
  native binding declared by the pinned `oxc-parser` and `oxc-transform`
  packages. A clean Intel macOS npm install plan includes the parser and
  transform x64 bindings; runtime execution on that platform remains unclaimed
  until exercised there.

## Non-goals

- No browser-side source compiler or browser Wasm compiler. Production compile
  authority stays in the restartable Studio server Worker; see D-2.
- No React Refresh; production updates use transactional frame replacement.
- No Oxc Semantic Diff, component-level partial rebuild, or `<Activity>`
  branch pre-render (v3 in the source document).
- No `SurfaceSpec` Data-backed adapter and no Component Catalog (v2).
- No Draft Lane, no retained Artifact history, no persisted state across reloads.
- No behavior change to the existing `*.canvas.tsx` preview lane. The shared
  compile route now dispatches the explicit AgentReact build runtime when the
  registry selects `*.agent.canvas.tsx`.
- No CSS/asset linking beyond what esbuild already does for imported CSS; the
  POC's fixtures do not exercise it.
- No cross-Revision address continuity. `InstanceAddress` accepts a parent
  instance for callers that hold one, but JSX elements are created inner-first so
  the creation-time stamp is `artifact digest + SourceNodeId + React key` only.

## Plan and Tasks

All modules live under `packages/harness-studio/src/agent-react/`:

| Increment | Modules |
| --- | --- |
| v1.1 | `contracts/{versions,revision,diagnostics,compile,build,host,index}.ts`, `host/digest.ts`, `host/stream-assembler.ts`, `kernel/ast.ts`, `kernel/profile.ts`, `kernel/compiler.ts` |
| v1.2 | `kernel/abi.ts`, `host/capability.ts` |
| v1.3 | `contracts/addressing.ts`, `runtime/address-registry.ts`, `runtime/bridge.ts`, `runtime/jsx-dev-runtime.ts`, `runtime/index.ts` |
| v1.4 | `kernel/semantic-index.ts`, `linker/allowed-packages.ts`, `linker/esbuild-linker.ts`, `host/build-coordinator.ts` |
| v1.5 | `host/frames/frame-protocol.ts`, `host/frames/local-frame-factory.ts`, `host/frames/frame-controller.ts` |
| v1.6 | `host/data-ownership.ts`, `host/observation-bridge.ts`, `host/state-store.ts`, `host/action-gateway.ts` |
| production compile | Worker compiler adapter, confined project loader, explicit AgentReact build runtime and build metadata |
| production Surface | `AgentReactPreviewHost`, opaque frame protocol, bounded browser state/Action services, transactional Current/Staging commit |
| production maintenance | re-export dependency discovery, same-build invalidation no-op, complete Oxc optional-binding lock records |

Each layer directory also carries an `index.ts` barrel that documents the layer's
job and is the only entry other layers may import.

New dependencies: `oxc-parser` and `oxc-transform`, both pinned exact, added to
`packages/harness-studio`. `esbuild-wasm` and `react` were already present.

## Test and Review Evidence

Tests live in `packages/harness-studio/test/agent-react/` and run under the
package's existing `vitest` project:

| File | Covers |
| --- | --- |
| `stream-assembler.test.ts` | AR-AC-1, AR-AC-12 |
| `oxc-compiler.test.ts` | AR-AC-2, AR-AC-3 |
| `build-coordinator.test.ts` | AR-AC-4, AR-AC-6, AR-AC-18, AR-AC-19 |
| `runtime-addressing.test.ts` | AR-AC-5, AR-AC-14, AR-AC-17; one-chain E2E for AR-AC-1, AR-AC-4, AR-AC-5, AR-AC-7 through AR-AC-10 |
| `capability-and-actions.test.ts` | AR-AC-7, AR-AC-16 |
| `state-store.test.ts` | AR-AC-8, AR-AC-15 |
| `frame-controller.test.ts` | AR-AC-9, AR-AC-13, AR-AC-17 |
| `frame-protocol.test.ts` | AR-AC-13, AR-AC-14, AR-AC-17 |
| `observation-bridge.test.ts` | AR-AC-10 |
| `layering.test.ts` | AR-AC-11 |
| `worker-oxc-compiler.test.ts` | AR-AC-20 normal, timeout, restart, and close behavior |
| `host-services.test.ts` | AR-AC-24 state schemas, grant policy, and frame-message admission |
| `artifact-compile-runtime.test.ts`, registry tests | AR-AC-20, AR-AC-21, AR-AC-27 production project compilation, explicit selection, and immutable preview runtime version |
| `browser/artifact-host.spec.mjs` AgentReact scenarios | AR-AC-22 through AR-AC-27, including CSP/sandbox, ready-driven initialization, paint-callback suspension, state, Action, observations, rejected staging, committed-runtime failure, recovery, and responsive screenshots |
| `artifact-compile-runtime.test.ts`, `oxc-compiler.test.ts` | AR-AC-28 semantic dependency discovery and production barrel re-export compilation |
| `browser/artifact-host.spec.mjs` same-build invalidation scenario | AR-AC-29 repeated unrelated changes retain Current state and Action transport |
| `worker-oxc-compiler.test.ts`, npm platform dry-run | AR-AC-30 parsed lockfile completeness and Intel macOS install-plan closure |

`pipeline-fixture.ts` holds the shared Revision fixtures, the test Trusted
Bootstrap, and the bundle loader. Linked bundles are written under
`packages/harness-studio/test/.artifacts/` because the Bootstrap externals are
relative specifiers that must resolve from the bundle's own location; the
directory is removed after the run and git-ignored.

AR-AC-5 is the load-bearing compile/link/address agreement test: it evaluates
the linked ESM bundle through the verification-only local transport, renders it
with `react-dom/server`, and asserts that each `data-artifact-node` value resolves
through `NodeAddressRegistry` to the module, line, column, and element type the
compiler indexed — not that a substring exists in the emitted code. It is not
browser mount or production execution evidence.

The original-POC E2E scenario in the same file streams and seals both modules,
builds and links them with the real Oxc/esbuild adapters, stages and activates
the linked bundle, drives state and a capability-gated Action through the active
Artifact runtime, proves a render-failing Revision leaves Current intact,
activates a valid successor, and rolls back to the first Build Snapshot. This is
one continuous in-process verification chain; it does not expand the evidence
to browser isolation or Studio registration.

AR-AC-11 is a fitness function over the real import graph: `layering.test.ts`
parses every module in `src/agent-react/**` with `oxc-parser` and asserts on the
resolved edges and exported names, not on source text. A passing architecture test
proves nothing on its own, so each rule was verified by mutation — the violation
was introduced, the suite was run, and the failure was confirmed before the
violation was reverted:

| Injected violation | Caught by |
| --- | --- |
| `runtime/bridge.ts` imports `kernel/index.js` | layer direction, runtime browser-loadability |
| `contracts/addressing.ts` imports `node:crypto` | contracts package ban, per-layer packages |
| `host/build-coordinator.ts` imports `kernel/ast.js` | barrel-only crossing |
| `linker/esbuild-linker.ts` imports `host/index.js` | layer direction |
| `kernel/ast.ts` also exports `stableHash` | single addressing definition |
| `host/digest.ts` ↔ `host/state-store.ts` | cycle detection |

Baseline before the production-hardening pass: 132 tests across the nine files;
the package suite is 423 passing across 56 files, and the repository suite 1545
passing with 2 skipped across 104 files. These results prove the checked
behaviors only; they do not satisfy AR-AC-12 through AR-AC-17 until the focused
regressions are present and passing. `tsc --noEmit` is clean for the package.
The baseline was recorded on macOS arm64 with Node 24; no Windows or Linux CI receipt
exists for this increment yet.

Production implementation evidence recorded on macOS arm64 with Node 24:

- AgentReact and production compile focused suite: 207 passing across 14 files,
  including the original-POC one-chain E2E, real emitted Worker compilation,
  deadline/restart, barrel re-export compilation, Oxc lock closure, and bounded
  Host-service scenarios.
- Harness Studio build and package suite: 466 passing across 59 files.
- Chromium production Surface suite: 47 passing, including real AgentReact DOM,
  resolvable node addresses, CSP and sandbox headers/attributes, Host state and
  Action round trips, Current/Staging commit, rejected staging retention,
  committed-runtime failure and recovery, ready-driven initialization with
  suspended paint callbacks, observation envelopes, keyboard focus,
  console/page-error inspection, and wide/compact/narrow screenshots.
- The original timeout was reproduced in the Codex in-app Browser against an
  immutable, stale preview URL. Runtime version 5 produced a new build/preview
  URL; the repaired frame committed in the same Browser with no console warning
  or error. This is enabled-host evidence for the local in-app Browser only.
- Repository `npm run check`: root 1545 passing with 2 skipped across 104 files;
  Harness 173, Harness UI 31, Studio 466; generated sources and pack verification
  passed (`npm 593 entries`, `runtime zip 863 entries`).
- `npm ci --dry-run --ignore-scripts --os=darwin --cpu=x64` selects both
  `@oxc-parser/binding-darwin-x64@0.147.0` and
  `@oxc-transform/binding-darwin-x64@0.147.0`; the parsed lockfile test confirms
  every optional binding declared by both pinned Oxc packages has a package
  record. This is install-plan evidence, not Intel macOS runtime evidence.
- `git diff --check` is clean. Existing preview regression smoke returned HTTP
  200 and `ok` from `/health`, and HTTP 200 with 100449 JavaScript bytes from
  `/canvas-module.js`.
- Studio's dry-run tarball contains the emitted Worker entry, Worker protocol,
  and production compiler route. Installing locally packed Harness, Harness UI,
  and Studio tarballs into a clean directory loaded
  `oxc-node-0.147.0+worker` and compiled a module with no diagnostics.

These receipts satisfy the local production acceptance boundary. Windows and
Linux remain unclaimed until the corresponding CI jobs pass. Publication is a
separate release action: a Studio-only install against the currently configured
npm mirror is blocked because that mirror does not contain
`@qoder-ai/harness-ui@0.1.1`; the three-package local tarball closure passes.

Risks:

- `oxc-parser` / `oxc-transform` ship platform-specific native bindings, so the
  new dependency adds optional binaries to the install graph. Both are pinned
  exact and kept behind `OxcCompilerPort` so the browser Wasm build can replace
  them without touching callers.
- Node addresses depend on the automatic development JSX transform's `__source`.
  The semantic index and the runtime compute the span independently and are
  asserted to agree; if a future Oxc release changes `columnNumber` semantics,
  that assertion fails rather than silently splitting one element into two
  identities.
- React 19's production `react/jsx-dev-runtime` deliberately exports no
  `jsxDEV` function. The trusted AgentReact JSX wrapper therefore accepts Oxc's
  development-shaped call for its source span, then creates elements through
  production-safe `react/jsx-runtime` `jsx`/`jsxs`. Unit and browser tests cover
  this exact packaged path.
- Opaque origin, no-network CSP, referrer policy, direct-open non-execution, and
  transferred-port initialization are re-proved in the production browser E2E;
  they remain sensitive to changes in the shared preview response or iframe
  attributes.
