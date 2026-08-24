# Harness as Code Architecture Hardening: Sandbox, Grammar, Boundaries, Evidence

## Traceability

- Spec ID: `SPEC-2026-08-15-harness-as-code-architecture-hardening`
- Story: none (review-driven follow-up on `feat/harness-as-code-package`)
- Status: Implemented

## Intent

The source-level review of `feat/harness-as-code-package` raised four High
findings beyond the four merge blockers. The blockers are closed by
[Harness Execution Closure](2026-08-15-harness-execution-closure-blockers.md),
which explicitly deferred these four items as non-goals:

1. **Execution boundary** — the compare pipeline claims "network deny", but only
   the Quick Start example and export probe run under `node --permission` with a
   scrubbed environment; the `npm test` validation step inherits the full host
   `process.env` with no permission flags.
2. **Adapter facts in the core DSL** — `binding strength` (other than
   `unsupported`) and `runtime execution` claims are author declarations about
   adapter implementation facts; today they are silently ignored or trusted.
3. **Package boundary** — the main `@qoder-ai/harness` entry re-exports
   exec/compare/highlight, so a consumer that only parses `.harness` must
   install the Qoder SDK and Shiki; `harness-ui` imports concrete executors.
4. **Second evidence platform** — `HarnessRevision` / receipts / run traces /
   compare verdicts have no bridge to the existing
   `HarnessComponentSnapshotV1` / `NormalizedToolActivityV1` / Inspector chain.

The outcome of this spec: safety claims become recorded evidence rather than
prose, the DSL cannot state facts it does not own, the dependency direction
`core ← adapters ← devtools` is enforced by tests, and harness runs land in the
same evidence chain the Inspector already reads.

## Non-goals

- Publishing new npm packages (`@qoder-ai/harness-core`, `adapter-qoder`, …).
  This spec fixes the dependency **direction** inside the existing package;
  physical package splitting is a later, mechanical step.
- A container/VM sandbox implementation. This spec defines the `TrialSandbox`
  seam and ships the trusted-fixture policy; an isolated-container policy is a
  separate deliverable behind the same interface.
- Changing verdict statistics (matched pairs, `insufficient_evidence`,
  cost-per-trial) — already implemented by the execution-closure spec.
- Making Qoder/Pi adapters materialize MCP, multi-session agents, or
  programmatic workflows.
- Migrating existing Inspector reports or session-analysis storage formats.
- A `HarnessLock` artifact between IR and Revision (still deferred).

---

## High 1 — Execution boundary: `TrialSandbox` and `SandboxReceipt`

### Problem

`packages/harness/src/compare/grader.ts` hardens the Quick Start example and
the export probe (`node --permission --allow-fs-read=<trialRoot>` plus
`safeExampleEnvironment()`, a 7-key env allowlist), but the `package-tests`
check calls `runCommand(npmTest.command, …)` with no `env` option, and
`runCommand` in `packages/harness/src/compare/process.ts` defaults to
`env: process.env`. Package scripts run with full host credentials, network,
and filesystem. The agent-facing allowlist in `compare/permissions.ts` bounds
the *tool surface*, not the *process capability surface*. The honest current
claim is "bounded tool surface over a trusted fixture", not "network denied".

### Design

Promote the execution boundary to a first-class seam owned by the compare
runner, not scattered options inside the grader:

```text
Grader / Runner
      │ never spawns directly
      ▼
TrialSandbox (interface)
  └── run(command, args, { cwd, timeoutMs }): Promise<CommandResult>
  └── describe(): SandboxReceipt
Policies:
  trusted-fixture  → env allowlist + node --permission where applicable
  (future) isolated → disposable container / clean fs + network namespace
```

`SandboxReceipt` is persisted into the trial evidence and surfaced in the
verdict:

```ts
interface SandboxReceipt {
  policy: "trusted-fixture" | "isolated";
  envPolicy: "allowlist" | "inherited";
  envKeys: string[];                       // exact keys passed through
  networkPolicy: "denied" | "unverified";  // never claim more than enforced
  fsScope: "trial-root" | "host";
  permissionFlags: string[];               // e.g. ["--permission", "--allow-fs-read=…"]
}
```

Rules:

- The trusted-fixture policy runs **every** subprocess (including `npm test`)
  with the env allowlist. `npm`/`node` operational keys (`PATH`, `TEMP`/`TMP`/
  `TMPDIR`, `SystemRoot`, `ComSpec`, `PATHEXT`, `HOME` for npm cache resolution,
  and explicit `npm_config_*` needed for offline install) are the whitelist;
  everything else — tokens, cloud credentials, proxy settings — is dropped.
- `node --permission` is applied where the command is a direct `node`
  invocation; `npm test` cannot carry it (npm spawns arbitrary scripts), so its
  receipt records `networkPolicy: "unverified"` — which is the honest fact.
- The verdict gains a `sandbox` field carrying the receipt. Report rendering
  must label any `networkPolicy: "unverified"` run as
  **"trusted-fixture only — network not denied"**. `README.md` and package
  README wording is corrected to match.
- `runCommand` loses its `process.env` default: `env` becomes a required
  option, so a future call site cannot silently reintroduce inheritance.

### Acceptance

- AC1.1 Every subprocess spawned during a compare trial goes through a
  `TrialSandbox`; a direct `runCommand` call from grader/runner without an
  explicit `env` fails to compile.
- AC1.2 Under the trusted-fixture policy, the env passed to `npm test` contains
  only allowlisted keys; a canary variable (e.g. `AWS_SECRET_ACCESS_KEY`,
  `GITHUB_TOKEN`) set in the parent env is absent from the child env.
- AC1.3 Each trial directory contains `sandbox-receipt.json`; parsing a verdict
  whose trials lack a sandbox receipt fails schema validation.
- AC1.4 The verdict HTML/CLI rendering shows the sandbox policy and labels
  `networkPolicy: "unverified"` runs as trusted-fixture only; no rendered
  output uses the phrase "network denied" for such runs.
- AC1.5 The Quick Start example and export probe keep their existing
  `node --permission` hardening and now also produce receipt entries with
  `permissionFlags` recorded.

---

## High 2 — Remove adapter facts from the core DSL

### Problem

The grammar (`packages/harness/src/language/harness.langium`) lets authors
declare `binding … { mechanism <QualifiedName> strength <Strength> }` and
`runtime … { execution programmatic.<lang> }`. Since the execution-closure
work, `materializeAgainstAdapter` (`resolver/resolve.ts`) only honors
`strength unsupported` as an author veto; any other declared strength is
ignored and the adapter descriptor decides. That makes `strength enforced` a
silent no-op — the worst kind of grammar surface. Similarly, whether a runtime
can execute `programmatic.deno` is an adapter observation, not an authoring
decision, yet the resolver trusts the DSL's `execution` claim
(`resolve.ts` workflow checks).

Ownership model (from the review, already partially realized):

```text
Harness DSL        → declares what a run needs (requirements, veto)
Adapter descriptor → declares what a runtime can provide (facts)
Receipt            → records what this run actually got (observations)
```

### Design

1. **Binding becomes veto-only.** Grammar keeps `binding <capability> for
   <runtimes> { unsupported? notes? }`. `strength` and `mechanism` are removed
   from the binding rule. During a deprecation window the validator reports a
   **compile error** (not a silent drop) for `strength`/`mechanism` with a
   fix-it message pointing at the adapter descriptor; the tokens are removed
   from the grammar in the following minor version.
2. **`execution` moves to the descriptor.** `AdapterRealizationDescriptor`
   (`resolver/adapter-descriptor.ts`) gains
   `programmaticLanguages: readonly string[]` alongside `workflowModes`. The
   resolver's programmatic-workflow gate reads the descriptor, not
   `runtime.execution`. The DSL keeps only the requirement side: a workflow may
   declare `program deno "./loop.ts"`, and resolution fails closed when no
   descriptor supports that language (behavior already tested for unsupported
   adapters; the source of truth moves).
3. **Descriptor registry.** A pure-data registry
   (`resolver/adapter-registry.ts`) maps adapter package id → descriptor,
   loadable **without importing any host SDK**. `QoderSdkAdapter.describe()` /
   `PiSdkAdapter.describe()` return the same frozen descriptor objects the
   registry ships, and `doStart` asserts registry/instance descriptor equality
   so the two cannot drift.
4. `RuntimeDeclaration.adapter` stays: choosing which adapter package to bind
   is a deployment decision the author legitimately owns.

Affected v0.2 example files and `skills/` DSL snippets are migrated in the same
change.

### Acceptance

- AC2.1 Compiling a `.harness` source containing `strength wired` or
  `strength enforced` in a binding produces a compile **error** whose message
  names the adapter descriptor as the owner of realization strength.
- AC2.2 `binding <cap> for <rt> { unsupported }` still vetoes the capability on
  that runtime (existing behavior preserved; regression-tested).
- AC2.3 A programmatic workflow resolves only when the registry descriptor for
  the target adapter lists the language in `programmaticLanguages`; a DSL
  `runtime … execution` claim alone can no longer satisfy the gate. During the
  deprecation window, `execution` in a runtime block compiles with a
  deprecation diagnostic and has no resolution effect.
- AC2.4 `resolveHarness` can produce a revision for the built-in Qoder and Pi
  targets in a process that has never loaded `@qoder-ai/qoder-agent-sdk` or
  `@earendil-works/pi-coding-agent` (registry is pure data).
- AC2.5 For each shipped adapter, the registry descriptor deep-equals the
  live `describe()` output (drift test), and `doStart` fails closed on
  mismatch.

---

## High 3 — Enforce the `core ← adapters ← devtools` dependency direction

### Problem

`compiler/`, `resolver/`, `ir/` already avoid host SDK imports, and
`package.json` already exposes `./ir`, `./exec`, `./compare`,
`./compare/verdict`, `./highlight` subpaths. Four leaks defeat the layering:

1. `src/index.ts` re-exports `./exec/index.js`, `./compare/index.js`, and
   `./highlight/shiki.js`, so the main entry's module graph pulls in the Qoder
   SDK, `node:child_process`, and Shiki. `@qoder-ai/qoder-agent-sdk` and
   `shiki` are hard `dependencies`.
2. `packages/harness-ui/src/run.ts` imports `QoderSdkExecutor` /
   `PiSdkExecutor` as **values** from the main entry, hard-binding the AG-UI
   layer to both hosts.
3. Adapter descriptors live in the same modules as adapter implementations
   (resolved by High 2's registry).
4. `resolver/source-lock.ts` imports `node:fs/promises`, so the core entry is
   not browser-safe.

### Design

Fix the direction inside the existing package; do not split npm packages yet.

```text
"."            core only: grammar, compile, IR, revision, canonical hash,
               resolver, adapter-descriptor types + registry   (browser-safe)
"./lock"       source locking (node:fs)                        [moved out of core]
"./exec"       adapter contract + Qoder/Pi adapters (host SDKs via dynamic import)
"./compare"    runner, grader, sandbox, verdict (node:child_process)
"./compare/verdict"  verdict parsing only (pure, browser-safe — Studio reads it)
"./highlight"  shiki
```

- `src/index.ts` drops the `exec`/`compare`/`highlight` re-exports and the
  `source-lock` value exports; consumers use subpaths. `./lock` is added as a
  new subpath export for `lockCapabilitySources` / `verifyRevisionSourceLocks`.
- `@qoder-ai/qoder-agent-sdk` moves from `dependencies` to an **optional
  peerDependency** (mirroring the existing Pi arrangement); `exec/qoder-sdk.ts`
  already loads it by module id at runtime. `shiki` stays a dependency but is
  reachable only via `./highlight`.
- `harness-ui` becomes injection-only: it keeps the existing
  `HarnessUiExecutorFactory` seam and stops importing concrete executors; the
  built-in Qoder/Pi factory moves to `harness-studio`'s server (which already
  owns host wiring) and to the `harness-ui` CLI entry, both of which import
  `@qoder-ai/harness/exec` explicitly.
- An import-graph invariant test (see Test Evidence) makes the direction
  survivable. Per the repository test convention it must assert on the
  **resolved module graph** of the built entry points, not grep source text.

### Acceptance

- AC3.1 Resolving the module graph of the built `.` entry
  (`dist/index.js`) reaches no module from `dist/exec/`, `dist/compare/`
  (except nothing), `dist/highlight/`, `shiki`, `@qoder-ai/qoder-agent-sdk`,
  `@earendil-works/pi-coding-agent`, `node:child_process`, or `node:fs`.
- AC3.2 The graph of `./compare/verdict` is equally pure (Studio can bundle it
  for the browser).
- AC3.3 `npm install` of `@qoder-ai/harness` without the Qoder SDK peer
  succeeds, and `compileHarness` + `resolveHarness` work; loading `./exec` and
  constructing a Qoder adapter without the peer fails with the existing
  actionable module-load error.
- AC3.4 The module graph of `@qoder-ai/harness-ui`'s main entry contains no
  concrete executor module; `handleAguiRun` requires an injected
  `HarnessUiExecutorFactory` and its tests pass with a fake factory only.
- AC3.5 `harness-studio` continues to run end-to-end (its server provides the
  factory), verified by the existing studio Playwright suite.

---

## High 4 — One evidence chain: bridge runs into the Inspector platform

### Problem

Two disjoint evidence platforms exist. Existing chain (canonical owners per
ADR-0002 federation): `HarnessComponentSnapshotV1`
(`scripts/harness-component-snapshot/`), `NormalizedToolActivityV1` + report
model (`scripts/harness-inspector/`), session platform adapters
(`scripts/session-analysis/platforms/{claude,codex,cursor,qoder}.mjs`),
commit-session-link. New chain: `HarnessRevision`, materialization receipt,
`HarnessRunEvent`, per-trial `trace.jsonl` / `runtime-receipt.json`, compare
`verdict.json`, Studio. No bridge code exists in either direction, and a
compare evidence directory is not self-contained (trials record `revisionId`
but the directory holds no revision or resolution report).

### Design

Converge at the persistence layer; do not merge schemas.

```text
HarnessRevision + MaterializationReceipt   (config provenance; owner: packages/harness)
        ↓ run
HarnessRunEvent                            (live streaming only; owner: packages/harness)
        ↓ persisted as
trace.jsonl  ──ingested by──▶  NormalizedToolActivityV1   (owner: session-analysis/inspector)
        ↓
Inspector / Controlled Eval reports
```

1. **Self-contained evidence directory.** The compare runner writes
   `revision.json` (the full deep-frozen revision), `resolution-report.json`,
   and `materialization-receipt.json` at the variant level; each trial keeps
   `trace.jsonl`, `runtime-receipt.json`, `sandbox-receipt.json` (High 1), and
   `permission-decisions.json`. `parseHarnessCompareVerdict` gains a
   directory-level validation mode that fails when the revision file is absent
   or its `revisionId` disagrees with the trials.
2. **New platform adapter.** `scripts/session-analysis/platforms/harness-run.mjs`
   ingests a harness evidence directory the same way `claude.mjs` ingests
   Claude session files: it maps `trace.jsonl` events to
   `NormalizedToolActivityV1` (tool calls, families, segments, timeline) and
   exposes the run as one more provider. The Inspector then reports harness
   runs with zero new report surface.
3. **Cross-reference, not schema merge.** `HarnessRevision` gains an optional
   `componentSnapshotRef` (snapshot id + digest) and
   `HarnessComponentSnapshotV1` consumers may record `revisionId` in their
   population references. The snapshot answers "what exists in the project";
   the revision answers "what this run was configured with".
4. **Studio positioning.** Studio remains the authoring/run workspace; live
   views consume `HarnessRunEvent` over SSE, historical views read the
   persisted evidence directory. Studio grows no second persistence format.
5. A short ADR under `docs/adrs/` records the canonical owners of the two
   contracts and the bridge direction, extending the ADR-0002 federation, so a
   third platform does not appear later.

### Acceptance

- AC4.1 After a compare run, the evidence directory contains `revision.json`,
  `resolution-report.json`, and `materialization-receipt.json` per variant;
  directory-level verdict validation fails on a missing or mismatched
  `revision.json`.
- AC4.2 The `harness-run` platform adapter converts a fixture `trace.jsonl`
  into a `NormalizedToolActivityV1` whose call counts, tool families, and
  timeline match the fixture events (asserted on the parsed structure, not on
  rendered text).
- AC4.3 An Inspector report generated over a workspace containing a harness
  evidence directory lists the run as a session from provider `harness-run`,
  linked to the `revisionId`.
- AC4.4 A revision carrying `componentSnapshotRef` round-trips through
  canonical hashing and revision-integrity checks (the ref is part of the
  hashed body).
- AC4.5 The ADR exists, names both contracts, their owners, and the bridge
  direction, and is reachable from `docs/adrs/README.md`.

---

## Plan and Tasks

Order chosen so grammar breaks land early and evidence contracts freeze last:

1. **High 3 first** (mechanical, unblocks High 2):
   - move source-lock exports to `./lock`; trim `src/index.ts`; add subpath;
     demote Qoder SDK to optional peer; adjust `harness-ui` to injection-only;
     move built-in factory to studio server + `harness-ui` CLI.
   - add the import-graph invariant test.
   - files: `packages/harness/src/index.ts`, `packages/harness/package.json`,
     `packages/harness-ui/src/run.ts`, `packages/harness-ui/src/cli.ts`,
     `packages/harness-studio/src/server/server.ts`.
2. **High 2** (breaking grammar change, cheapest now):
   - grammar: veto-only binding, deprecation diagnostics for
     `strength`/`mechanism`/`execution`; regenerate Langium artifacts
     (`npm run langium:generate`, `check:generated` stays green).
   - `programmaticLanguages` on the descriptor; registry module; drift test;
     migrate examples and `skills/` snippets.
   - files: `packages/harness/src/language/harness.langium`,
     `language/harness-validator.ts`, `resolver/adapter-descriptor.ts`,
     `resolver/adapter-registry.ts` (new), `resolver/resolve.ts`,
     `exec/qoder-sdk.ts`, `exec/pi-sdk.ts`, `examples/`, `skills/`.
3. **High 1** (verdict schema addition — before evidence freeze):
   - `TrialSandbox` interface + trusted-fixture policy; make `env` required on
     `runCommand`; thread sandbox through grader/runner; `sandbox-receipt.json`;
     verdict schema + rendering labels; README wording fix.
   - files: `packages/harness/src/compare/sandbox.ts` (new), `process.ts`,
     `grader.ts`, `runner.ts`, `verdict.ts`, `aggregate.ts`, report templates,
     `packages/harness/README.md`, root `README.md` (compare claims paragraph).
4. **High 4 last** (consumes contracts from 1–3):
   - self-contained evidence directory + directory validation; `harness-run`
     platform adapter; `componentSnapshotRef`; Studio historical view reads the
     directory; ADR.
   - files: `packages/harness/src/compare/runner.ts`, `verdict.ts`,
     `packages/harness/src/ir/index.ts` + `ir/revision.ts`,
     `scripts/session-analysis/platforms/harness-run.mjs` (new),
     `scripts/harness-inspector/` (provider registration),
     `docs/adrs/` (new ADR), `docs/adrs/README.md`.

Each step remains independently reviewable so the cross-platform Node matrix,
package tests, and the Studio browser suite can serve as merge evidence.

Decision rationale:

- Dependency direction before grammar work: the registry (High 2) must live in
  a core that provably does not load host SDKs, so the graph invariant comes
  first.
- Deprecation-diagnostic window instead of instant token removal: existing
  `.harness` sources in examples, skills, and early adopters get one actionable
  compile error before the tokens disappear; silent acceptance is the failure
  mode being removed, so the diagnostic is an error, not a warning.
- Bridge at `NormalizedToolActivityV1` rather than a new shared schema: the
  Inspector's platform-adapter seam already absorbs four providers; adding a
  fifth is the lowest-cost, lowest-risk convergence and keeps ADR-0002
  federation intact.

## Test and Review Evidence

Repository conventions apply: assert on behavior and parsed structures, never
on source text patterns; no repo-wide literal scans.

| AC | Evidence |
| --- | --- |
| AC1.1 | TypeScript compile: `env` required on `runCommand`; grader/runner call-site test with a fake sandbox recording every spawn |
| AC1.2 | Trial test sets `GITHUB_TOKEN` in parent env, asserts child env (captured by fake sandbox / echo probe) lacks it and matches the allowlist exactly |
| AC1.3 | Verdict schema test: verdict without sandbox receipts fails `parseHarnessCompareVerdict` |
| AC1.4 | Render test parses the generated report model (not HTML text) and asserts the policy label field for an `unverified` receipt |
| AC2.1–AC2.3 | Compiler tests: fixture sources with `strength wired`, veto binding, programmatic workflow with/without registry support; assert diagnostics and resolution results |
| AC2.4 | Test spawns a child Node process that imports only the core entry, resolves the Qoder target, and asserts `require.cache`/loaded-modules contains no host SDK |
| AC2.5 | Deep-equal test between registry descriptor and `describe()` per adapter |
| AC3.1–AC3.2 | Import-graph test: resolve the built entry's ESM graph (e.g. `node --experimental-import-meta-resolve` walker or `es-module-lexer` walk over `dist/`) and assert the forbidden-module set is unreachable |
| AC3.3 | CI job (or test with temporarily hidden peer) exercising compile+resolve without the Qoder SDK installed |
| AC3.4 | `harness-ui` tests run with fake factory only; module-graph assertion on its entry |
| AC3.5 | Existing `packages/harness-studio` Playwright suite |
| AC4.1 | Runner integration test over a fake executor; assert directory contents and directory-level validation failure on deleted `revision.json` |
| AC4.2 | Fixture `trace.jsonl` → adapter → assert `NormalizedToolActivityV1` fields |
| AC4.3 | Inspector report-model test over a workspace fixture containing a harness evidence directory |
| AC4.4 | Revision canonical-hash round-trip test including `componentSnapshotRef` |
| AC4.5 | Doc-link test (`npx vitest run test/skills-docs/doc-link-graph.test.mjs`) after adding the ADR |

Risk notes:

- **R1 (High 1)**: over-tight env allowlist can break `npm test` on Windows
  (`SystemRoot`, `ComSpec`, `PATHEXT`) or on npm cache resolution (`HOME`,
  `LOCALAPPDATA`). Mitigation: allowlist is platform-aware and CI runs the
  compare suite on the existing four-platform matrix.
- **R2 (High 2)**: grammar break invalidates existing `.harness` files.
  Mitigation: deprecation diagnostic with fix-it text; examples and skills
  migrate in the same commit; `check:generated` guards Langium artifacts.
- **R3 (High 3)**: demoting the Qoder SDK to an optional peer changes install
  behavior for current consumers. Mitigation: `./exec` keeps the existing
  actionable module-load error; README installation snippet updated in the
  same PR.
- **R4 (High 4)**: `trace.jsonl` event vocabulary may not cover everything
  `NormalizedToolActivityV1` expects. Mitigation: the adapter maps only what
  the trace proves and leaves absent fields empty rather than inventing them;
  gaps are recorded in the adapter's fixture tests.
- **R5 (cross-cutting, deferred policy decision)**: whether `npm test`
  validation must eventually require the isolated-container policy before a
  compare verdict may render `accept`. This implementation preserves the
  specified trusted-fixture behavior and labels network denial as unverified.

## Implementation Evidence

- `npm test`: 95 files and 1325 tests passed, including the new harness-run
  provider and Inspector integration coverage.
- Harness packages: build plus 127 harness, 21 harness-ui, and 29
  harness-studio tests passed.
- `npm run harness-studio:test:browser`: the Studio Playwright interaction test
  passed in Chromium.
- `npm run pack:verify`: npm and runtime package contents passed verification.
- Cold install: the packed `@qoder-ai/harness` installed with `--omit=peer`;
  core compile and resolve succeeded without the Qoder SDK.
- `npm run preview`: `/health` and `/canvas-module.js` both returned
  successfully from `http://127.0.0.1:58575`.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs`, generated Langium
  checks, module-graph invariants, and `git diff --check` passed.
