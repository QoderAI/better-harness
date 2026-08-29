# Admit Agentic JSON Canvas intents without execution

## Traceability

- Spec ID: agentic-json-canvas-intents
- Status: Implemented
- Builds on: `studio-artifact-surface-selection`

## Intent

Allow an exact, Provider-hosted Agentic JSON Canvas to submit a bounded intent
for Host-owned semantic selection or steering. Studio must revalidate the
current frame, Artifact revision, Host-minted binding, Provider runtime, and
intent identity before recording either effect. Steering is an observable draft
only: it is never prepared, executed, approved, or forwarded to an Agent by
this flow.

## Acceptance Scenarios

- **AC-1:** The public Artifact Provider contract exposes an optional,
  intent-only runtime and a versioned hosted envelope/outcome. The Host mints
  the route, actor, timestamp, selection id, and steering id; none is accepted
  from the iframe.
- **AC-2:** Studio exposes an exact-revision `POST` admission route only when the
  selected contribution supplies the optional runtime. The route re-resolves
  the active Provider and Host binding, rejects stale or malformed identities,
  and fresh-resolves the target before returning a selection or steering
  outcome.
- **AC-3:** Replaying one canonical intent id returns the retained outcome with
  `replayed: true`. Reusing that id with different content fails closed, and
  retained admissions are bounded.
- **AC-4:** `ExternalHostedArtifactView` forwards an envelope only from its
  current iframe and only for the current Artifact revision and binding. A
  response that arrives after navigation or rebinding cannot alter the new
  surface.
- **AC-5:** An admitted selection updates the existing shared selection. An
  admitted steering outcome records and displays a draft labelled
  “Recorded, not executed”; it may prefill the Collaboration textarea but must
  not invoke Provider preparation, decisions, Agent runs, or source mutation.
- **AC-6:** Focused server and client tests cover current-window acceptance,
  stale identity, unrelated windows, unknown targets, replay, conflicting
  replay, Provider change, response races, and zero proposal/decision/Agent-run
  effects.
- **AC-7:** The changed Studio surface uses existing semantic CSS tokens and is
  verified at 1440×900, 1024×768, and 390×844 with keyboard focus, no
  document-level horizontal overflow, and no captured browser console/page
  errors.

## Non-goals

- Adding a json-render-specific schema or action catalog to Better Harness.
- Treating an intent as approval, a proposal, a transition receipt, or mutation
  authority.
- Automatically preparing a Provider proposal or starting an Agent after
  steering.
- Persisting steering drafts across Studio restarts, multi-user presence, or
  cross-Artifact target resolution.

## Plan and Tasks

1. Add Provider-neutral intent runtime, envelope, outcome, descriptor, and
   admission-input contracts to `@qoder-ai/harness/artifacts`.
2. Include intent runtime identity in the Host binding digest and mint an
   exact-revision `intentUri` in the Artifact catalog.
3. Add a separate admission route with strict parsing, fresh Provider/runtime
   resolution, Host-owned metadata, bounded idempotency, and stable public error
   codes.
4. Forward current-frame envelopes through the generic external-hosted mount,
   revalidate async outcomes, and connect accepted effects to shared selection
   plus a non-executing steering draft.
5. Add focused contract, server, component, negative, replay, and responsive
   browser tests without changing proposal, decision, or Agent-run routes.

## Test and Risk Evidence

- **AC-1–AC-3:** Node 24.15.0 `npm test --workspace @qoder-ai/harness`
  passed 20 files / 173 tests. Studio route/catalog/replay coverage is included
  in the 63 files / 502 tests passed by
  `npm test --workspace @qoder-ai/harness-studio`. The dedicated server suite
  passed 6/6, including a concurrent duplicate with one Provider call, retained
  Host ids/time, conflicting replay, stale binding/revision, unsafe keys,
  cross-origin input, malformed targets, stable Provider rejection, source
  drift, and an identical-byte Artifact authority switch.
- **AC-4–AC-5:** `artifact-view-registry.test.ts` strictly decodes current-window
  envelopes and reconstructed exact outcomes, rejecting forged fields, stale
  bindings, overlong targets, invalid clocks, and selection/steering shape
  confusion. `external-artifact-host.spec.mjs` exercised real iframe
  `postMessage` → Host `POST` → selection/steering state, latest-response wins,
  the latest semantic target as the selected value, visible “Recorded, not
  executed” copy, steering prefill, and zero proposal/decision/Agent-run
  requests.
- **AC-6:** the server fixture observed `admit=1`, `inspect=0`, `prepare=0`,
  `decide=0` for the canonical replay scenario and identical source bytes
  before/after. This is an enforceable Host routing guarantee for a conforming
  trusted Provider; an in-process Provider that violates its read-only contract
  is outside P1b's physical isolation boundary.
- **AC-7:** Node 24.15.0
  `npx playwright test test/browser/external-artifact-host.spec.mjs` passed 1/1
  at 1440×900, 1024×768, and 390×844 with document overflow assertions and no
  captured console/page errors. Steering screenshots were inspected at
  `test-results/.../external-artifact-intent-{wide,compact,narrow}.png`; all use
  existing semantic tokens and retain readable target/address/draft state.
- Focused `oxlint --deny-warnings` passed for every changed TypeScript,
  TSX, test, and browser file (the unrelated existing
  `unicorn/no-useless-spread` diagnostic in Provider discovery was explicitly
  allowed); `git diff --check` passed. Harness and Studio builds passed as part
  of their full package test commands.
- Risk: an opaque iframe may race navigation while admission is pending. The
  client must compare Artifact id, revision, binding, and request generation
  again before applying the result; the server remains authoritative even when
  the browser drops a stale response.
