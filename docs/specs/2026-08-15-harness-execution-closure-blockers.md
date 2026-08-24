# Harness Execution Closure: Revision, Materialization, Session, Evidence

## Traceability

- Spec ID: `SPEC-2026-08-15-harness-execution-closure`
- Story: none (review-driven blocker fix on `feat/harness-as-code-package`)
- Status: Implemented

## Intent

A source-level review of `feat/harness-as-code-package` accepted the v0.2 resource model but
blocked the merge on four contracts that were not closed between
`Authored Harness → Locked Revision → Runtime Materialization → Execution Evidence`.

This spec covers only those four blockers. The reviewer's larger restructuring asks — a separate
`HarnessLock` artifact, splitting `@qoder-ai/harness` into core/adapters/devtools packages, moving
binding strength out of the core DSL, and bridging `HarnessRevision` to
`HarnessComponentSnapshotV1` — are explicit non-goals here.

## Non-goals

- Introducing a standalone `HarnessLock` artifact between IR and Revision.
- Splitting the package boundary along runtime dependencies.
- Removing `binding strength` / `runtime execution` claims from the core DSL grammar.
- Making Qoder or Pi materialize MCP connections, multi-session agents, or programmatic workflows.
- Unifying Studio/Compare evidence with the existing Inspector normalized trace.
- Hardening the `harness-ui` bind address (the review's separate High item on non-loopback serving
  requiring explicit auth or an unsafe flag).

## Blocker 1 — `HarnessRevision` must be an execution closure

Problem: `execute(revision, bundle, task)` re-reads workflows and capabilities from whatever bundle
the caller passes, without checking them against the hashes recorded in the revision. A revision
resolved from bundle A could drive execution content from bundle B while still reporting A's
`revisionId`. The revision was also a plain mutable object, `assertRevisionHost` ignored
`target.adapter`, and capability `source` paths were never content-locked.

### Acceptance

- AC1.1 `validateRevisionAgainstBundle(revision, bundle)` recomputes the harness, workflow, and
  every resolved capability content hash from the bundle and throws
  `HarnessRevisionBundleMismatchError` on any drift, naming the drifted entities.
- AC1.2 `assertRevisionIntegrity(revision)` recomputes `revisionId` from the revision body and
  throws `HarnessRevisionTamperedError` when a field was mutated after resolution.
- AC1.3 `resolveHarness` returns a deep-frozen revision; a mutation attempt does not change the
  observed value (and throws in strict mode).
- AC1.4 `assertRevisionAdapter(revision, adapterId)` throws `HarnessAdapterMismatchError` when
  `revision.target.adapter` names a different adapter package.
- AC1.5 `doStart` on both shipped adapters runs host, adapter, integrity, and bundle validation
  **before** the host SDK is loaded.
- AC1.6 Source locking: `lockCapabilitySources(bundle, { root })` digests each declared
  `skill.source` file or directory tree; a source-backed revision is verified at `doStart` and
  fails closed when the on-disk content drifted.
- AC1.7 A revision cannot resolve while a resolved source-backed capability lacks exactly one
  matching source lock. Locks digest raw bytes and are verified against an explicit source root,
  independent from the task working directory.
- AC1.8 Every public materializer runs revision integrity, adapter, bundle, and source-lock
  preflight before writing output; a Pi package cannot carry bundle B content under bundle A's
  `revisionId`.
- AC1.9 The revision locks the adapter contract version, implementation version, and descriptor
  hash; execution fails before SDK load when any of those facts drift.

## Blocker 2 — Declared run semantics must not exceed adapter materialization

Problem: `materializeV02()` mapped every non-`unsupported` binding to `advisory` /
`prompt-preamble`, so `require tool`, `connect mcp`, and programmatic workflows all resolved
successfully while the executor only emitted a prompt line — and Qoder/Pi passed no tools at all.

### Acceptance

- AC2.1 Materialization is capability-kind aware and adapter-owned. An
  `AdapterRealizationDescriptor` declares skill delivery, the DSL-tool → host-tool exposure map,
  MCP support, drivable workflow modes, agent isolation, and consumed setting keys.
- AC2.2 A `tool` requirement is never satisfied by prompt guidance. Without descriptor-declared
  exposure it realizes `unsupported` and resolution fails; with exposure it realizes `wired`
  through mechanism `host-tool:<name>`.
- AC2.3 `connect mcp` fails closed: no shipped adapter opens MCP connections in v0.2.
- AC2.4 A programmatic workflow fails resolution against a descriptor that can only drive
  declarative workflows, instead of resolving into a silent no-op.
- AC2.5 The Qoder adapter really exposes the host tools its revision requires (visible `tools` plus
  the run-time receipt), so an exposed tool requirement has a runtime effect.
- AC2.6 A multi-agent harness on a single-session adapter is recorded as an explicit workflow
  degradation with a run warning, not as satisfied orchestration.
- AC2.7 `revision.permissions` is renamed `revision.requestedPermissions`; a
  `HarnessMaterializationReceipt` records, per capability, `materialized | degraded | unsupported`
  plus mechanism, and separates requested from enforced permissions and consumed from ignored
  settings. Executors attach the receipt to `HarnessRunResult.materialization`.
- AC2.8 Public validators resolve against the selected built-in adapter descriptor. Published
  examples target only adapters that can realize their required capabilities.

## Blocker 3 — Qoder adapter must be a real multi-turn session

Problem: every `doPromptTurn` called `sdk.query()` again with a fresh string prompt and no
`resume`/`session_id`, so `persistSession: true` only suppressed the preamble; there was no proof
turn 2 saw turn 1. There was also no in-flight turn mutex, `doStop`/`doDestroy` never closed or
interrupted the query, and `runOnce` skipped `doDestroy` when `doStop` failed with a non-capability
error.

### Acceptance

- AC3.1 `doStart` opens exactly one `query({ prompt: AsyncIterable<SDKUserMessage> })`; each turn
  pushes a user message onto that queue and drains the shared stream to its `result` message.
- AC3.2 A fake SDK that models the official Query lifecycle proves turn 2 can answer with
  information supplied only in turn 1, with a single `query()` call for the whole session.
- AC3.3 Concurrent `doPromptTurn` calls are rejected with `HarnessConcurrentTurnError`; the
  contract's "turns are sequential" claim is enforced, not documented.
- AC3.4 `doStop` ends the queue and awaits `query.close()`; `doDestroy` interrupts best-effort and
  then closes. A per-turn `abortSignal` calls `query.interrupt()`.
- AC3.5 The session exposes the host `sessionId`; a turn that arrives after the host terminated the
  query reopens it with `resume: sessionId` and is delivered once, instead of being reported as a
  turn nobody ran or replaying a fresh context.
- AC3.6 `runOnce` destroys the session best-effort when `doStop` throws any error.
- AC3.7 The Qoder session does not impose a one-turn default on the whole query. Tests assert that
  an omitted `maxTurns` stays unbounded while explicit limits remain visible in the runtime receipt.

## Blocker 4 — Compare must not `accept` on insufficient evidence

Problem: `decideVerdict()` accepted on any pass-rate or 5-point score improvement with no minimum
sample size, compared two independent aggregates instead of paired trials, excluded infrastructure
errors from the denominator (so one lucky completed trial could beat 20 real ones), compared total
cost across unequal completed counts, allowed a manifest to move harness *and* runtime profile at
once, and re-validated persisted verdicts without recomputing aggregates from trial rows.

### Acceptance

- AC4.1 `CompareStatus` gains `insufficient_evidence`.
- AC4.2 A manifest must move exactly one treatment axis (harness *or* runtime profile); moving both
  is rejected at load. The verdict records the axis.
- AC4.3 Verdicts are decided on matched pairs (same trial index, both variants completed).
  Fewer than the required pairs → `insufficient_evidence`. A single matched pair can never
  `accept`, whatever the configured policy.
- AC4.4 An infrastructure error ratio above the policy threshold → `infrastructure_error`.
- AC4.5 Aggregates report `costPerAttemptedTrialUsd`, `costPerCompletedTrialUsd`, and
  `costPerPassedTrialUsd`; the cost guardrail compares cost per completed trial.
- AC4.6 `parseHarnessCompareVerdict()` recomputes `completedTrials`, `passedTrials`,
  `infrastructureErrors`, `passRate`, `meanScore`, `totalCostUsd`, `totalCredits`, the per-trial
  cost fields, and the matched-pair counts from the trial rows, and rejects any hand-edited
  aggregate that disagrees.
- AC4.7 Persisted `status` and `reason` are also recomputed from the validated policy and trial
  rows; a two-pair result cannot be relabelled `accept` under a five-pair policy.

## Plan

1. `src/ir/revision.ts` — integrity, bundle validation, deep freeze, adapter assertion.
2. `src/resolver/source-lock.ts` — mandatory capability source digests and explicit-root
   verification for source-backed revisions.
3. `src/resolver/adapter-descriptor.ts` — adapter realization facts and the shipped descriptors.
4. `src/resolver/resolve.ts` — kind-aware materialization, `requestedPermissions`, receipt input.
   `ResolveOptions.adapter` also accepts a lookup keyed by the selected runtime, for callers that
   let the bundle choose its target; `src/exec/built-in.ts` exposes `describeBuiltInAdapter`.
5. `src/exec/*` — descriptor-driven preflight, materialization receipt, Qoder Query session,
   turn mutex, `runOnce` teardown.
6. `src/compare/*` — treatment axis, decision policy, paired verdict, recomputed parse.
7. `packages/harness-ui` resolves against the descriptor of the adapter that will run the revision;
   `packages/harness-studio` renders the treatment axis, matched-pair evidence with its threshold,
   and cost per completed trial, and styles `insufficient_evidence`.

## Test evidence

The four tests the review asked for first, each failing before the change:

1. `refuses execution against a bundle the revision was not resolved from`
   (`packages/harness/test/revision.test.ts`).
2. `detects a mutated revision before the host SDK loads`
   (`packages/harness/test/revision.test.ts`).
3. `answers the second turn from first-turn context inside one query`
   (`packages/harness/test/adapter.test.ts`).
4. `reports insufficient_evidence when a single matched pair is all the evidence there is`
   (`packages/harness/test/compare.test.ts`).

Follow-ups also covered: a programmatic workflow fails resolution on a declarative-only adapter and
a tool requirement cannot be satisfied by prompt-only realization
(`packages/harness/test/resolve.test.ts`); missing/incomplete locks, raw-byte drift, bundle swaps at
the public Pi materializer, adapter contract drift, and locked-source drift all fail closed before
SDK load or package output (`packages/harness/test/revision.test.ts`,
`packages/harness/test/resolve.test.ts`); the Qoder adapter refuses a tool exposure it cannot
reproduce (`packages/harness/test/exec.test.ts`); concurrent turns, stop/destroy close and
interrupt, `resume` after a terminated query, an unbounded omitted `maxTurns`, and a non-capability
stop failure still tearing the session down (`packages/harness/test/adapter.test.ts`); and a
persisted verdict whose aggregate, status, reason, or policy the trial rows do not support
(`packages/harness/test/compare.test.ts`, `packages/harness-studio/test/compare-model.test.ts`).

Verified on 2026-08-15:

- Harness focused tests: 101 passed; full Harness tests: 120 passed; Harness build and typecheck
  passed.
- Harness UI: 20 passed; Harness Studio: 29 passed; repository suite: 94 files / 1,324 tests
  passed; doc-link graph: 6 passed and regenerated without stale output.
- Root preview returned `ok` from `/health` and served a 100,449-byte `/canvas-module.js`.
- Harness Studio production build and Playwright browser test passed. The Compare fixture was also
  opened at 1440x1000: the derived verdict, two matched pairs, cost guardrail, and trial rows
  rendered with zero console or page errors.
- A live Qoder SDK smoke kept the nonce `cobalt-7319` across two `doPromptTurn()` calls in one
  adapter session and exposed one host session id.

## Risk

- Resolution now fails closed for `require tool` on adapters without exposure and for
  `connect mcp`. Harnesses that previously resolved into a prompt-only no-op now need an adapter
  that really exposes the capability. This is the intended semantic correction.
- `revision.permissions` → `revision.requestedPermissions` is a breaking IR field rename inside the
  unreleased v0.2 surface.
