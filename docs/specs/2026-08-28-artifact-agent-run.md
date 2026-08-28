# Run a real Agent inside the Artifact collaboration loop

## Traceability

- Spec ID: artifact-agent-run
- Status: Draft
- Architecture input: `docs/adrs/studio-artifact-runtime-and-providers.md`
- Depends on: `studio-agentic-artifact-interaction`

## Intent

Replace the Collaboration pane's response-centric `Prepare change` path with
an observable, interruptible Agent run when Studio has a real server-configured
ACP Agent. The human and Agent remain bound to the same exact Artifact revision
and semantic target. The Agent turns natural-language steering into the
Provider's bounded steering contract; the Provider still owns format-specific
proposal construction and the Host still owns approval, mutation routing, CAS,
readback, and receipts.

This increment makes the distinction between an Agent run and deterministic
Provider preparation visible. It does not label a static Provider response as
Agent activity and does not expose model chain-of-thought or raw protocol
payloads.

## Acceptance Scenarios

- **AC-1:** An interaction-capable Artifact exposes a same-origin, exact-
  revision `POST interaction/agent-runs` SSE route only when a real ACP Agent is
  configured. The browser supplies one current semantic target, one bounded
  natural-language instruction, one human actor, and one run id; it cannot
  supply an executable, argv, filesystem path, Provider identity, model, or
  Harness source.
- **AC-2:** The Host invokes the server-selected Agent through the existing
  `AcpSdkExecutor` and a controlled Artifact-planning Harness prompt. The run
  streams bounded observable phases (`observing`, `planning`, `validating`,
  `proposal`) plus explicit Agent-authored summary and plan items. Raw ACP
  envelopes, model reasoning, system prompts, and unvalidated output are not
  sent to the browser.
- **AC-3:** Agent output must match a strict versioned plan schema and the
  current Provider steering kind and size limits. The Host passes only the
  validated steering message to the already-selected Provider runtime, with an
  Agent actor and the original exact revision/target. Provider preparation
  remains read-only and returns the existing digest-bound proposal and preview.
- **AC-4:** The Agent has no Artifact write capability and every ACP permission
  request during this planning run is cancelled. A cancelled, disconnected,
  failed, malformed, stale, or unsupported run creates no proposal. Active runs
  are bounded, revision-scoped, individually interruptible, and aborted during
  server shutdown.
- **AC-5:** The Collaboration pane shows the selected target and natural steering
  before the run, the active phase and `Interrupt` while running, the explicit
  plan and executor-observed evidence after validation, then the existing
  preview and Host-owned `Approve once` / `Reject` gate. Users can revise and
  rerun after cancellation or failure. When no ACP Agent is configured, the
  pane names the Provider-only fallback instead of presenting it as Agent work.
- **AC-6:** Approval, reject, stale, replay, authoritative readback, catalog
  convergence, and receipt behavior remain governed by the existing proposal
  decision route. The Agent run cannot call that route or settle its own
  proposal.
- **AC-7:** Focused server and component tests cover a successful real-executor
  seam, strict output rejection, unavailable Agent, cancellation, disconnect,
  bounded concurrency, zero permission grant, and the unchanged decision gate.
  Studio typecheck/build/tests pass under supported Node 24. Wide, compact, and
  narrow browser checks show the active run, interrupt, plan, proposal, and
  decision states without document overflow or console/page errors.

## Non-goals

- A universal Artifact IR, a generic model loop inside every Provider, or
  format-specific operations inside Harness Studio.
- Giving the Agent direct filesystem mutation, Provider selection, proposal
  settlement, approval, or durable credentials.
- Exposing raw prompts, chain-of-thought, ACP protocol payloads, or arbitrary
  Agent response text as collaboration evidence.
- Multi-turn retained Agent sessions, branching, cross-process durable runs or
  proposals, remote hostile-Agent sandbox certification, distributed CAS, Undo,
  DSH approval UI, publication, or release certification.

## Plan and Tasks

1. Add bounded Agent-run state and a server module that validates the exact
   Artifact workspace/target, starts the configured ACP executor, emits a small
   SSE projection, validates the Agent plan, and calls Provider `prepare` through
   the existing retained-proposal path.
2. Add revision-bound cancellation and shutdown cleanup. Cancel all ACP
   permission requests for proposal-only runs and retain only non-secret runtime
   evidence needed to prove which host session completed.
3. Update the Collaboration pane to select Agent or Provider-only preparation
   from Studio capability state, render observable phases and explicit plan
   items, support interrupt/revise/rerun, and preserve the existing human
   decision gate.
4. Add focused route and UI behavior tests, then run supported-Node builds and
   regression suites, a real local ACP smoke, and three-width browser review.
5. Run Change Traceability Review in Review Readiness mode over the final diff;
   update this spec and `AGENTS.md` only with evidence that actually occurred.

## Test and Review Evidence

- Pending implementation and verification.

### Risks

- **False agency:** a deterministic Provider proposal must never be relabelled
  as a completed model run; executor/session evidence must be observed.
- **Authority drift:** Agent output is usable only for the Artifact id, revision,
  target, Provider fingerprint, and steering contract inspected before the run.
- **Tool escape:** the planning Agent receives no Artifact path or capability and
  all ACP permission requests are cancelled, but this does not certify an
  untrusted local ACP executable as a production sandbox.
- **Output ambiguity:** model prose, fences with extra content, unknown fields,
  wrong steering kinds, and over-budget plans fail closed before Provider
  preparation.
- **Streaming races:** disconnect, interrupt, server close, and terminal result
  must converge on one cleanup path without retaining a proposal from a
  cancelled run.
