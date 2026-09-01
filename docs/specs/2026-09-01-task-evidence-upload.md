# Prepare a task evidence upload

## Traceability

- Spec ID: task-evidence-upload
- Status: Implemented
- Extended by: `2026-09-01-task-evidence-upload-end-to-end`, which adds
  `upload apply`, a verifiable receipt, and a local destination. The input,
  packet, and plan contracts below are unchanged, and preparing a plan still
  performs no network request.

## Intent

Give a developer an explicit, reviewable local step for preparing task evidence
before any organization service receives it. The command must turn a bounded
task description, validation observations, and Skill/MCP usage observations into
a versioned evidence packet and upload plan while preserving uncertainty and
excluding high-risk raw data by default.

This is the first vertical slice between the local Builder Harness and a future
Team/Org control plane. It establishes the local evidence contract and consent
boundary without implying that a remote service, authentication flow, or upload
receipt already exists.

## Acceptance Scenarios

- **AC-1 — Safe command discovery:** `better-harness upload`,
  `better-harness upload --help`, and `better-harness upload plan --help` explain
  the local planning workflow without reading task inputs, writing files, or
  making network requests.
- **AC-2 — Local plan preparation:** Given a valid task evidence input,
  destination URL, organization identifier, and workspace, `upload plan`
  produces a `better-harness.task-evidence-packet/v1` inside a
  `better-harness.task-evidence-upload-plan/v1`. The command performs no network
  request and labels the plan as prepared rather than uploaded.
- **AC-3 — Allowlisted and redacted evidence:** The input validator rejects
  unknown fields and unsupported enum values. The packet contains only the
  documented task, acceptance, asset-usage, and observation fields. Workspace
  and home paths plus common credential forms are redacted from accepted string
  values. Raw source bodies, prompts, transcripts, tool inputs, tool outputs,
  credentials, and absolute paths are named as excluded evidence classes.
- **AC-4 — Honest observation state:** Asset identity match states
  (`exact`, `ambiguous`, `unresolved`), execution stages, outcomes, and
  acceptance/validation states retain `failed` and `unobserved` values instead
  of being normalized into success.
- **AC-5 — Reviewable integrity:** The packet and plan use canonical JSON for
  SHA-256 digests and byte counts. A validator accepts an unchanged plan and
  rejects a plan whose packet or digest-bearing content was changed.
- **AC-6 — Explicit local write:** Without `--out`, the command only previews
  the plan. With `--out`, it atomically writes one JSON artifact and reports that
  local write. Human output and `--json` output both state that no network
  request was made.
- **AC-7 — Root CLI ownership:** The root CLI discovers `upload` as a workflow
  command and delegates `plan` to a business-named capability owner. The later
  end-to-end extension registers `apply` explicitly; every other unknown
  subcommand fails closed rather than performing a best-effort action.
- **AC-8 — Portable behavior:** Path handling, output creation, and command
  invocation use Node APIs and behave consistently for Windows, macOS, and Linux
  path semantics covered by focused tests.

## Input and Output Contract

The local input is a strict JSON document with this identity:

```json
{
  "kind": "better-harness.task-evidence-input",
  "schemaVersion": 1
}
```

It may contain only these evidence families:

- `task`: a stable task id, title, intent, scope, non-goals, and acceptance
  observations;
- `assets`: Skill, MCP, tool, hook, plugin, or Agent identities plus revision,
  identity-match state, observed execution stage, and outcome;
- `observations`: bounded validation, human-review, artifact, change, or runtime
  summaries with an optional non-path evidence reference.

The command output is an upload plan that embeds the allowlisted packet,
destination metadata, integrity metadata, the redaction/exclusion summary, and
the explicit effect state `network: none`. An output plan is not an upload
receipt and must not be interpreted as evidence that an organization service
accepted the packet.

## Non-goals

Scoped to this slice. The first item was lifted by
`2026-09-01-task-evidence-upload-end-to-end`; the rest still hold.

- Sending network requests, implementing `upload apply`, or issuing remote
  receipts.
- Designing authentication, tenancy storage, RBAC, policy evaluation, approval
  workflows, dashboards, or the Team/Org service deployment.
- Automatically collecting source code, prompts, transcripts, tool request or
  response bodies, environment variables, credentials, or full filesystem paths.
- Changing Harness Studio UI, package boundaries, release metadata, or published
  package versions.
- Claiming that a configured, discovered, or selected Skill/MCP was successfully
  executed or that a failed task was caused by a particular asset.

## Plan and Tasks

1. Add a `scripts/task-evidence-upload/` capability owner with strict input and
   packet schemas, canonical serialization, redaction, digest calculation, plan
   validation, and atomic local persistence.
2. Add a side-effect-free capability CLI for `plan`, including human help,
   human preview, a single-document JSON result, stable usage errors, and an
   injectable clock for behavior tests.
3. Register `upload plan` in the root CLI as a workflow command while keeping the
   root dispatcher free of evidence-domain logic.
4. Add focused behavior tests for strict validation, redaction, uncertainty,
   tamper detection, explicit writes, root dispatch, and no-network help/preview.
5. Run the repository CLI and documentation-link checks, then perform a Review
   Readiness Check against this spec and the local diff.

The capability remains outside `packages/harness-studio`: Studio is a local
workbench consumer, while preparation of portable task evidence is a CLI/domain
boundary that can later be consumed by Studio or a separately deployed control
plane without coupling their release lifecycles.

## Test and Review Evidence

- **AC-1, AC-6, AC-7:** run the focused task-evidence upload CLI tests and the
  root CLI test suite; inspect help, preview, JSON, explicit-write, and unknown
  subcommand results.
- **AC-2, AC-3, AC-4:** construct valid and invalid fixtures, assert parsed
  object shapes and enum behavior, and assert that fixture secrets and native
  absolute paths are absent from serialized packets.
- **AC-5:** validate a generated plan, mutate packet content and digest-bearing
  metadata independently, and assert deterministic rejection.
- **AC-8:** exercise POSIX and Windows-style path values through the sanitizer
  and use temporary directories plus Node filesystem APIs for write behavior.
- Run `npx vitest run test/cli/task-evidence-upload.test.mjs`.
- Run `npx vitest run test/cli/better-harness-cli.test.mjs`.
- Run `npx vitest run test/skills-docs/doc-link-graph.test.mjs`.
- Run `npm test` if the focused suites expose shared-surface risk or before the
  change is proposed for merge.

Risk review must verify that serialized plans contain no fixture secret or full
workspace/home path, that `--help` and preview mode do not write, and that no
code path in this slice opens a network connection. The spec status may move to
`Implemented` only after the mapped local evidence passes.

### Observed local evidence

- `npx vitest run test/cli/task-evidence-upload.test.mjs`: 10 tests passed,
  covering AC-1 through AC-8.
- `npx vitest run test/cli/better-harness-cli.test.mjs`: 50 root CLI tests
  passed after registering the workflow command.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs`: 8 documentation
  link and routing tests passed.
- `npx vitest run test/governance/scripts-refactor-contract.test.mjs
  test/cli/task-evidence-upload.test.mjs`: 17 tests passed after review of the
  intentional root help, command inventory, and OpenCLI baseline changes.
- `npm test`: 109 test files passed; 1,629 tests passed and 2 were skipped.
- `npm run pack:verify`: the npm package and runtime bundle manifests passed,
  including the newly registered capability owner.
- `git diff --check`: passed. A bounded source scan found no Node network
  module, `fetch`, XHR, or WebSocket use under `scripts/task-evidence-upload/`.

These are local source/package checks. No remote Team/Org service, CI run,
Windows runner, upload attempt, or receipt was observed or claimed.
