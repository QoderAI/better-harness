# Owning concurrent experiment runs

## Traceability

- Spec ID: experiment-run-ownership
- Status: Implemented
- Request: prevent concurrent Studio experiment requests from sharing one run id

## Intent

Harness Studio must admit at most one in-process experiment run for a given
experiment id. Concurrent HTTP requests must not both pass asynchronous
preflight, replace each other's cancellation controller, or remove a newer
owner's registration during cleanup. A rejected or failed request must release
its own ownership so the same id can be retried.

## Acceptance Scenarios

- **AC-1:** Given two overlapping `POST /api/experiment/runs` requests with the
  same explicit experiment id, exactly one receives the SSE `200` response and
  starts the experiment runner; the other receives `409`, and the runner is
  invoked exactly once.
- **AC-2:** Given a request owns an experiment id but manifest, readiness, Agent
  selection, or runner setup fails, ownership is released by that request so a
  later request with the same id can be admitted.
- **AC-3:** Given two overlapping requests with different experiment ids, both
  are admitted and may execute concurrently.
- **AC-4:** Given an admitted run is cancelled through its lifecycle endpoint
  or its HTTP stream disconnects, the cancellation reaches that run's own
  controller; its eventual cleanup removes only its own registration, and the
  id becomes retryable after the run settles.

## Non-goals

- Queuing duplicate runs or automatically retrying them.
- Coordinating ownership across Studio processes, machines, or restarts.
- Changing experiment ids, output-directory semantics, SSE payloads, or the
  lifecycle endpoint contract.
- Serializing runs that have different experiment ids.

## Plan and Tasks

1. In `packages/harness-studio/src/server/experiment/routes.ts`, construct the
   request's cancellation controller and synchronously claim the experiment id
   before the first manifest/readiness/Agent-selection await.
2. Keep asynchronous preflight inside the ownership lifetime. Release the claim
   on every preflight return or exception, and retain the existing HTTP status
   and error responses.
3. In final cleanup, compare the map's current controller with the request's
   controller before deleting so an older request cannot clear another owner.
4. Extend `packages/harness-studio/test/server.test.ts` with real HTTP requests
   covering same-id rejection, retry after preflight and runner failures,
   different-id concurrency, and cancellation/disconnection ownership.

The map remains the server-local ownership registry. JavaScript executes the
check and insertion synchronously, so no queue or additional lock is required
inside one Studio process.

## Test and Review Evidence

- **AC-1:** Pause the first real HTTP POST inside `buildExperimentPreview`,
  after admission but before runner startup, then send a second POST with the
  same id. Assert statuses `200` and `409` and a single runner invocation. On
  the baseline implementation this interleaving produced two `200` responses.
- **AC-2:** Force a preview exception, an Agent-selection early return, a
  synchronous runner throw, and an asynchronous runner rejection, reusing the
  same HTTP id after each failure. Assert every next request reaches its
  expected phase rather than receiving stale `409`.
- **AC-3:** Hold two controlled runners opened through distinct ids and assert
  both requests receive SSE `200` before either runner is released.
- **AC-4:** Cancel an admitted run through HTTP and separately destroy a raw
  HTTP client while preflight is paused. Observe the server-side response
  `close` directly, assert no runner starts for the disconnected request, and
  admit the settled id on retry without using DELETE to clean it up.
- Run the focused Studio server test file and Studio typecheck. The behavioral
  tests must fail against the baseline race and pass after the route change.

Implemented evidence on Windows with Node `22.20.0` and npm `10.9.3`:

- The focused ownership group passed 5/5 after the same-id race test first
  failed on the baseline with `[200, 200]` instead of `[200, 409]`.
- `packages/harness-studio/test/server.test.ts` passed 61/61.
- The Harness Studio package build and test suite passed 736 tests across 93
  files, with 1 skipped; `npm run typecheck -w @qoder-ai/harness-studio`
  completed cleanly.
- The regenerated doc-link graph passed its focused suite, 8/8.
- Package verification passed with 735 npm entries and 996 runtime entries.

Evidence boundaries: the repository-wide local suite reported 1767 passing, 1
failing, and 8 skipped. The only failure was the unchanged local DSH baseline
at `test/agents/agent-customize-dsh.test.mjs:397` (`expected other`, received
`user`); its focused rerun reproduced the same 15 passing / 1 failing result,
while all four checks on baseline commit `aafae64` were green. Preview smoke
could not run because the local Canvas SDK runtime is absent, so no Preview
claim is made from this environment.

Risk is limited to the in-process run lifecycle. The important regression
risks are retaining ownership after an early return, aborting the wrong run,
and serializing unrelated ids; AC-2 through AC-4 cover those boundaries.

AI involvement: Codex prepared the spec, implementation, and local validation.
