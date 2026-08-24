# Evolve harness executors into a versioned session adapter contract

## Traceability

- Spec ID: harness-executor-session-adapter
- Status: Implemented

## Intent

The v0.2 execution layer is a one-shot batch surface: `HarnessExecutor`
exposes a single `execute(revision, bundle, task)` that runs one prompt to
completion and returns a `HarnessRunResult`. This blocks three outcomes:

- Interactive surfaces (harness-studio, TUIs) cannot hold a conversation
  against a resolved revision; every exchange pays full session startup.
- The executor interface is unversioned, so any change to its shape couples
  DSL/IR evolution to adapter evolution.
- Runtime-time capability gaps are reported as free-form `warnings[]`
  strings instead of typed signals the resolver's degradation model can
  consume.

Reshape the execution layer after the adapter design of AI SDK 7's
`HarnessV1` specification (versioned spec tag, harness/session/turn split,
capability signalling via optional-method presence plus a typed
capability-unsupported error, framework-owned working directory), while
keeping what is deliberately different: our adapters bind to natively
running hosts, so there is no sandbox-ownership requirement, and the DSL,
IR, and resolver semantics do not change.

## Acceptance Scenarios

- AC-1: A `HarnessAdapterV1` interface exists with
  `specificationVersion: "harness-adapter-v1"` (literal), a stable
  `adapterId` matching the runtime's adapter package convention, and
  `doStart(options)` returning a session. The existing `HarnessExecutor`
  batch surface remains exported and behaviourally unchanged, reimplemented
  as a wrapper that starts a session, runs one prompt turn, and stops.
- AC-2: A `HarnessAdapterSession` supports multiple sequential
  `doPromptTurn` calls against one live host session (conversation state is
  owned by the host runtime), plus `doStop()` and `doDestroy()`. Each turn
  accepts an abort signal and an event listener; per-turn events reuse the
  `HarnessRunEmitter` framing invariants (one `run-started` first, one
  `run-finished` last, framed text, paired tool calls).
- AC-3: A typed `HarnessCapabilityUnsupportedError` (carrying `adapterId` and
  `capability`) signals a behaviour that is unavailable at run time — for
  example a turn `abortSignal` on the Pi SDK, which exposes no abort surface
  (`turn-abort`). The batch wrapper degrades an unsupported graceful stop to
  a `doDestroy()` fallback plus a `warnings[]` entry on the result instead of
  failing the run; the per-turn event stream is already sealed by
  `run-finished` at that point, so the degradation is carried on the result,
  not as a late event.
- AC-4: The framework, not the adapter, owns the working directory:
  `doStart` receives a `workDir` (defaulting to the caller's cwd exactly as
  today) and adapters use it without deriving their own paths. Behavioural
  parity: for a single-prompt run, `HarnessRunResult` (receipt, metrics,
  events, exit codes) is unchanged for both existing executors.
- AC-5: The Qoder SDK and Pi SDK executors are reimplemented on the adapter
  contract, and the existing package test suites for exec and compare pass
  without weakening assertions.
- AC-6: `assertRevisionHost` still guards every turn: a session started for
  a revision rejects turns when `revision.target.runtime` does not match
  the adapter's host, with the same `HarnessHostMismatchError`.

## Non-goals

- No sandbox provider, bridge mode, or remote execution; adapters keep
  running in-process against local hosts. Sandbox contracts are a separate
  future spec if ever needed.
- No interop wrapper for `@ai-sdk/harness-*` packages in this cycle; this
  spec only makes our contract shape-compatible so such a wrapper stays
  cheap later.
- No turn suspension/continuation (`doSuspendTurn` / `doContinueTurn`
  equivalents) or durability across process restarts.
- No DSL grammar, IR version, resolver, or binding-strength change;
  materialized strength stays capped at `advisory`.
- No change to harness-studio or harness-ui in this spec; they adopt the
  session surface in follow-up work.

## Plan and Tasks

1. Add `src/exec/adapter.ts`: `HarnessAdapterV1`, `HarnessAdapterSession`,
   `HarnessAdapterStartOptions` (revision, bundle, workDir, listener),
   `HarnessCapabilityUnsupportedError`, and the `runOnce` batch wrapper
   (placed here rather than in `executor.ts` because `events.ts` already
   imports from `executor.ts`, and the wrapper needs the emitter at runtime).
2. Keep `src/exec/executor.ts` unchanged: `HarnessExecutor`,
   `HarnessRunResult`, receipt/metrics types, and the preamble builders stay
   the shared vocabulary of both surfaces.
3. Reimplement `src/exec/qoder-sdk.ts` and `src/exec/pi-sdk.ts` as
   `HarnessAdapterV1` implementations; their exported executor factories
   delegate to the wrapper. Preserve runtime profiles, receipts, redaction,
   and metrics mapping.
4. Extend `src/exec/events.ts` only if turn framing requires it; reuse the
   existing emitter invariants per turn rather than inventing a second
   event vocabulary.
5. Update `src/exec/index.ts` exports; deprecate nothing silently — the
   README section for programmatic execution documents both surfaces.
6. Port `test/exec.test.ts` coverage to the adapter path and add session
   tests: multi-turn sequencing, host mismatch per turn, capability
   unsupported mapping, abort propagation.

Decision rationale: the session split follows AI SDK 7's `HarnessV1`
(`packages/harness/src/v1` in the upstream repo) because it is the closest
proven contract for wrapping third-party coding-agent runtimes; we drop its
sandbox-ownership precondition because binding to natively running hosts is
this DSL's core scenario, and we omit suspend/continue because no current
consumer needs slice-boundary recovery.

## Test and Review Evidence

- AC-1/AC-4/AC-5: `npm run build && npx vitest run` in `packages/harness` —
  10 files, 103 tests pass; the pre-existing `test/exec.test.ts` (17 tests),
  `test/skill.test.ts`, and `test/compare.test.ts` pass against the wrapper
  without assertion changes.
- AC-2/AC-3/AC-6: new `test/adapter.test.ts` (10 tests) drives stub host
  SDKs through multi-turn sessions, asserting event framing invariants per
  turn (`expectFramedTurns`), preamble policy per host (`persistSession`
  false re-sends, true and Pi send first-turn only), typed
  capability-unsupported rejection (`turn-abort` on Pi), graceful-stop
  degradation to destroy-plus-warning, abort-signal bridging onto the Qoder
  abort controller, host mismatch before SDK load, turn rejection after
  stop, and the legacy start-failure event sequence.
- Risk: the Qoder/Pi SDK message loops move from per-run functions into
  session objects; regression risk is bounded by keeping the batch result
  shape identical and asserting receipt/metrics equality in existing tests.
- Risk: interface naming (`harness-adapter-v1`) is new public API surface in
  `@qoder-ai/harness`; the README documents the session surface as
  experimental until harness-studio adopts it.
