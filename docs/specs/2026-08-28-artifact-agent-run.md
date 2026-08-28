# Run a real Agent inside the Artifact collaboration loop

## Traceability

- Spec ID: artifact-agent-run
- Status: Implemented
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

- Contract and route verification: Node 24.15 Studio focused
  `test/artifact-interaction-server.test.ts` passed 1 file / 4 tests. It covers
  real ACP fixture execution, zero permission grant, strict-plan rejection,
  sanitized internal failure, unavailable Agent, interrupt, simultaneous
  five-run admission with a four-run cap, disconnect cleanup, and the existing
  reject/approve/replay/conflict/stale gate.
- Regression verification: Node 24.15 Harness passed 20 files / 173 tests;
  Studio build, typecheck, and 62 files / 494 tests passed. The first attempted
  parallel run was discarded because Harness cleanup raced Studio imports and
  child scripts used Node 26; the recorded result is the dependency-ordered run
  with Node 24 pinned for every child process.
- Provider verification: `@homology/integration-harness-artifact-provider`
  build and focused 1 file / 12 tests passed; focused `oxlint` passed; dry-run
  pack produced 21 entries, 2,940,287 packed bytes / 11,140,892 unpacked bytes.
  Repository package naming checked 88 packages / 86 workspaces / 2 exceptions,
  100 scripts, and 2,779 tracked files with 0 machine-local path hits.
- Real executor smoke: Qoder CLI 1.1.32 ran through `AcpSdkExecutor`, returned
  `HarnessStudioArtifactAgentPlanV1`, and compiled the human request into
  `Rename to Agent Runtime Group` for
  `drawio://complex-features.drawio/page/rich/cell/runtime-group`. Evidence
  bound ACP session `84537291-1501-4e57-9229-8e992c0b9db5`, Harness revision
  `hr_7d337eaa5cf81f8935770cc3877b141e`, exact source revision `bb301843`, and
  `end_turn`. The Provider retained proposal digest `2fc4801a`; source SHA-256
  remained `bb301843` before and after the run, proving zero pre-approval write.
- Browser verification: the real Qoder + Draw.io flow showed shared semantic
  selection, running/Interrupt, explicit plan, executor/session evidence,
  proposal preview, and both `Approve once` / `Reject`. Reject preserved the
  revision; interrupt retained no proposal and allowed rerun. Manual checks at
  1440×900, 1024×768, and 390×844 had document/body scroll width equal to the
  viewport and 0 captured console warnings/errors. Screenshots are
  `.verification/agentic-artifact-agent-run-{wide,compact,narrow}.png`.
- Review Readiness tightened two issues found after implementation: admission is
  rechecked atomically at active-run registration, and raw Harness warnings or
  Agent-supplied tool names are no longer projected to the browser. Internal
  ACP stderr/error text is regression-tested as absent from the SSE stream.
- The installed `codex-acp` 0.15.0 executable did not complete this real smoke;
  it failed closed behind the generic public error. Only the observed Qoder ACP
  lane is claimed as live on this host. No CI or release certification was run.

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
