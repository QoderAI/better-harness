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
this flow. An operator-configured Provider may additionally resolve a
projection-local element to one exact domain-native target. Studio keeps the
Canvas source and native destination identities separate and requires explicit
human adoption before opening the destination Collaboration workflow.

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
- **AC-8:** A Provider-native outcome carries both the projection-local source
  target and an exact destination Artifact claim. The Host requires a portable
  destination label, resolves its current Artifact id/revision/renderer binding,
  inspects the exact interaction workspace, matches the complete native target,
  then re-resolves source and destination identities before recording.
- **AC-9:** A native steering outcome first renders as `Recorded, not executed`
  with source, target, Artifact, and draft evidence. Only the trusted
  `Use draft in Collaboration` control opens the destination workspace. It
  starts no proposal, decision, Agent run, or mutation; a generic Canvas
  instruction may be compiled into native Provider grammar only by the existing
  configured Agent path.
- **AC-10:** A native outcome atomically carries `sourceTarget`, `destination`,
  and a Host-minted `originRef`. The reference is accepted only for the exact
  retained outcome, current Artifact authority, destination binding, native
  target, and unedited draft. It is correlation evidence, not execution
  authority.
- **AC-11:** Explicit adoption mints a digest-bound Host provenance record
  outside Provider proposal IR. Direct Provider proposals, ACP evidence and
  proposals, decision responses, and canonical decision replay carry the same
  provenance. A stale source or destination blocks a new decision before the
  Provider mutation gate.

## Non-goals

- Adding a json-render-specific schema or action catalog to Better Harness.
- Treating an intent as approval, a proposal, a transition receipt, or mutation
  authority.
- Automatically preparing a Provider proposal or starting an Agent after
  steering.
- Persisting steering drafts across Studio restarts, multi-user presence,
  arbitrary/model-authored cross-Artifact mappings, or a universal Artifact IR.
- Providing atomic source/destination locking, treating `originRef` as a secret
  capability, or inserting Studio provenance into Provider-native proposal
  digests.

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
6. Admit an optional Provider-owned native target claim, revalidate its exact
   destination workspace in the Host, and expose a separate trusted adoption
   gate that reuses the existing destination Collaboration workflow.
7. Bind explicit adoption to a Host-owned, canonical provenance record retained
   alongside the native proposal and returned unchanged through Agent evidence,
   decision settlement, and replay.

## Test and Risk Evidence

- **AC-1–AC-3, AC-10–AC-11:** Node 24.15.0 `npm test --workspace
  @qoder-ai/harness` passed 20 files / 173 tests. `npm test --workspace
  @qoder-ai/harness-studio` passed 63 files / 507 tests. The focused intent,
  registry, and interaction suites passed 3 files / 43 tests, including
  canonical replay, stale source/binding/authority, unsafe JSON, Provider
  timeout/rejection, atomic native outcome fields, forged origin references,
  exact provenance digesting, and strict client decoding.
- **AC-4–AC-5, AC-9–AC-11:** `external-artifact-host.spec.mjs` passed 2/2. The
  original three-viewport flow exercised iframe `postMessage` → Host `POST` →
  native-target record → explicit `Use draft in Collaboration` → destination
  prefill and asserted zero proposal, decision, or Agent-run requests. The P3
  flow then required a second explicit `Prepare with Provider`, forwarded the
  exact `originRef`, displayed Canvas provenance on the proposal and rejected
  receipt, and observed no Agent run or source/destination mutation.
- **AC-6:** the canonical replay fixture observed `admit=1`, `inspect=0`,
  `prepare=0`, `decide=0` and identical source bytes before/after. The native
  path inspected only the exact destination workspace; escaped labels, missing
  targets, and changed revisions failed closed before preparation or decision.
- **AC-7:** the focused Playwright run covered 1440×900, 1024×768, and 390×844
  with document overflow assertions and no captured console/page errors.
  Screenshots at `test-results/.../external-artifact-intent-{wide,compact,narrow}.png`
  retain the Canvas source, native target, destination, draft, and trusted
  adoption control. A separate real in-app Browser review observed
  client/scroll widths of 1440/1440, 1024/1024, and 390/390 with zero warnings
  or errors; the narrow layout kept the adopted draft and Agent control visible
  under the Preview tab.
- **AC-8–AC-9:** the cross-repository real Host smoke returned 201 for select
  and steer from Canvas revision `603a8d2c…d22ab3` / binding
  `73708778…d72d2df9`, normalized `json-render://element/plan-card` to exact
  Draw.io revision `bb301843…e133031e` / binding `fb2f5699…b660a8fe`, and
  recorded both as `not-executed` with zero Canvas source mutations. The
  existing governed Draw.io flow then rejected once without mutation and
  approved once with authoritative readback `bb301843…e133031e →
  5fae91d3…cfdd26c`, verification `passed`, one evidence item, replay success,
  and catalog convergence.
- **AC-10–AC-11:** direct Provider and real ACP fixtures carried one identical
  Host provenance record through proposal, Agent evidence, decision, and
  canonical replay. Forged origins and edited message/native grammar failed
  before Provider preparation; source drift after preparation failed before
  Provider decision. An independently recomputed canonical digest matched the
  retained record, and proposal settlement remained governed by proposal TTL
  rather than the shorter-lived intent lookup.
- Focused `oxlint --deny-warnings` passed for every changed TypeScript, TSX,
  test, and browser file. Harness and Studio builds passed as part of their full
  package test commands. Dry-run packs were 150378/647711 B/143 entries for
  `@qoder-ai/harness` and 7059704/38408933 B/1156 entries for Studio. Homology's
  Provider suite passed 7 files / 46 tests; root build and 4-worker Vitest passed
  266 files / 2327 tests with 1 skipped. Package naming reported 91 packages,
  89 workspaces, 2 exceptions, 12 families, 107 scripts, 2863 tracked files,
  239 allowlisted files, and zero machine-local path hits. Both repositories'
  `git diff --check` passed.
- Risk: an opaque iframe may race navigation while admission is pending. The
  client must compare Artifact id, revision, binding, and request generation
  again before applying the result; the server remains authoritative even when
  the browser drops a stale response.
