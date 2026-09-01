# Apply task evidence end to end

## Traceability

- Spec ID: `2026-09-01-task-evidence-upload-end-to-end`
- Status: Implemented
- Refs: `2026-09-01-task-evidence-upload`, `2026-09-01-organization-harness-dashboard`

## Intent

Close the gap between the two halves that already existed: `better-harness
upload plan` prepared a reviewable packet but could never send it, and the
Dashboard rendered an upload section whose input was a hard-coded empty array.
Nothing carried evidence from one to the other, and the page itself showed a
single snapshot taken when its server process started.

This spec makes the loop real and keeps every existing consent boundary. The
prepared plan remains the only thing that names a destination, the packet
contract is unchanged, and applying a plan is a separate, explicit command
rather than a side effect of preparing one.

## Acceptance Scenarios

- **AC-1 — Apply is explicit and plan-directed:** `better-harness upload apply
  --plan <file>` posts a validated plan to the endpoint recorded inside that
  plan. The destination cannot be supplied or overridden on the command line, so
  applying cannot redirect evidence somewhere the reviewed plan did not name.
  `--help` returns without reading the plan or using the network.
- **AC-2 — Receipts are verifiable:** the destination returns a
  `better-harness.task-evidence-upload-receipt/v1` whose body is bound by a
  canonical SHA-256 digest. `apply` rejects a receipt whose digest, destination,
  or organization does not match the applied plan, and reports a rejected or
  unreachable destination as a failure with no receipt.
- **AC-3 — Idempotent acceptance:** the packet digest is the storage key and the
  idempotency key. Re-applying the same plan reports `duplicate`, preserves the
  first acceptance time, and leaves exactly one stored record.
- **AC-4 — The destination validates before it stores:** the local `/api/upload`
  route rejects non-JSON, an invalid or tampered plan, an oversized body, and an
  organization outside `BETTER_HARNESS_UPLOAD_ORGANIZATIONS` when that is
  configured. A rejected request stores nothing.
- **AC-5 — Accepted evidence reaches the Dashboard:** the collector reads stored
  records from the uploads directory and projects their packets into
  `evidencePackets`. A record that cannot be parsed or validated is reported as
  an unavailable source rather than silently dropped.
- **AC-6 — Data is current:** the collected input is reused for a bounded
  refresh window (`BETTER_HARNESS_REFRESH_MS`, default 30s) and recollected after
  it, aged from the end of a collection rather than its start. A failed
  collection is not cached. Evidence written after the server started appears
  without restarting the process.
- **AC-7 — Every analyzable host is collected:** session evidence defaults to all
  supported session platforms rather than two, `BETTER_HARNESS_PROVIDERS`
  narrows that set, and asset inventory covers only hosts with an inventory
  adapter so an unsupported host is skipped instead of reported as a failure.
- **AC-8 — A session limit actually bounds work:** an unset limit analyzes every
  eligible session with `all-eligible`; a configured `BETTER_HARNESS_SESSION_LIMIT`
  switches to `latest-n` so the limit applies instead of being ignored.
- **AC-9 — Observed context usage is shown:** `contextUsage` from the analyzed
  host is carried into the Dashboard input when its status is `observed`, and is
  absent otherwise.

## Input and Output Contract

`upload apply` consumes a prepared plan and produces:

```json
{
  "kind": "better-harness.task-evidence-upload-receipt",
  "schemaVersion": 1
}
```

carrying `acceptedAt`, `state` (`accepted` or `duplicate`), the plan's
`destination`, a `receiptId`, the `packetDigest` and `planDigest` it answers,
and a `receiptDigest` over that body.

The destination stores one `better-harness.task-evidence-upload-record/v1` per
packet digest, holding the receipt and the plan it accepted. The uploads
directory is `BETTER_HARNESS_UPLOADS`, or `<workspace>/.better-harness/uploads`.

## Non-goals

- Authentication, tenancy, RBAC, approval workflow, or a deployed control plane.
  The bundled endpoint is a local destination for the local Dashboard.
- Protobuf/Buf ingestion, PostgreSQL, or object storage.
- Changing the task evidence input, packet, or plan contracts.
- Automatic upload: preparing a plan still never sends anything, and applying
  one is always a separate command.
- Live push or websocket refresh. The page recollects on request within a
  bounded window.

## Plan and Tasks

1. Extend the upload contract with a digest-bound receipt, its validator, and a
   content-addressed storage key.
2. Add `upload apply` to the capability CLI with an injectable fetch, a bounded
   timeout, receipt verification against the applied plan, and stable
   diagnostics; register it in the root CLI.
3. Add a local upload store shared by the destination route and the collector,
   with idempotent writes and reporting reads.
4. Add the `/api/upload` route handler that validates before it stores.
5. Replace the collector's empty packet list with stored records, widen its
   provider default, make its limit meaningful, and carry observed context usage.
6. Replace the Dashboard's permanent process-lifetime cache with a bounded
   refresh window behind a testable seam.
7. Cover the chain with focused tests: contract, store, CLI, collector, the real
   route handler over a loopback port, and a browser run whose evidence is
   applied through the real CLI.

## Test and Review Evidence

- **AC-1, AC-2, AC-3:** `npx vitest run test/cli/task-evidence-upload.test.mjs`
  covers plan-directed posting, idempotency-key headers, receipt mismatch,
  rejected and unreachable destinations, tampered plans, and receipt tampering.
- **AC-3, AC-4, AC-5:** `npm test -w @qoder-ai/harness-ui` runs the upload store
  tests and an end-to-end test that drives the real CLI against the real route
  handler over a loopback port, then projects the stored packet into the
  Dashboard model.
- **AC-6, AC-7, AC-8:** focused cache, collector-argument, refresh-window, and
  workspace-resolution tests in `packages/harness-ui/test/local-data.test.mjs`.
- **AC-5, AC-9:** `npm run harness-ui:test:browser` applies fixture evidence
  through `upload plan` and `upload apply` against the running Dashboard in its
  global setup, then asserts the applied task is visible on the page.
