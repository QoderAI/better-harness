# Converge the Harness DSL on a standard resource model

## Traceability

- Spec ID: harness-dsl-v0.2-resource-model
- Status: Implemented

## Intent

Replace the v0.1 authored surface (`component` / `binding` / `plugin` /
`composition`) with a resource model whose core semantics are host-neutral:

- `harness` — the complete assembly of how an agent run works: workflow,
  agent roles, capability requirements, and configuration.
- `workflow` — control flow, part of a harness, not the harness itself.
  Either a declarative graph (`author -> verifier`, `on verifier.failed ->
  author`, `stop when verifier.passed`) or a programmatic controller
  (`program deno "./flows/coding-loop.ts"`).
- `agent` — a logical role inside a harness (`author`, `reviewer`). Qoder
  and Pi are not agents; they are runtimes.
- `runtime` — a concrete host (Qoder, Pi, DeepSeek Harness, Prime Agent)
  with an adapter package and an execution style: `tool-calling` or
  `programmatic.<language>` (Prime's persistent IPython, DeepSeek's
  TypeScript plugin runtime).
- `skill` / `tool` / `mcp` — the three standard capability kinds. A skill is
  progressive knowledge (Agent Skills standard, `source` directory) or
  inline guidance (`description` only). A tool is an atomic callable with
  input/output identifiers. An MCP entry is a connection (transport +
  endpoint), not a tool itself.
- `target` — deployment statement selecting a runtime (`target qoder uses
  adapter.qoder`).
- `binding` — adapter-layer mapping of one capability onto one runtime,
  carrying `mechanism` (now a dotted name so host-native assets such as
  `qoder.plugin`, `pi.extension`, `deepseek.plugin`, `prime.python-skill`
  are expressible), `strength`, and `notes`.

The core DSL no longer defines a generic `plugin`. Host plugin/extension
concepts live behind adapters as binding mechanisms in a host namespace.
"Everything is a Plugin" (DeepSeek/Cordis) and "Package vs Extension" (Pi)
remain host implementation details, isolated behind the adapter boundary.

What is deliberately kept from v0.1: the strength ladder
(`unsupported < advisory < wired < enforced`), requirement degradation
policy (`preferred` / `minimum` / `on-degrade`), the declared-versus-
materialized strength boundary (v0.x executors still materialize prompt
guidance capped at `advisory`), permission merging with deny-wins, canonical
hashing, and the immutable resolved revision.

## Acceptance Scenarios

- AC-1: `.harness` sources using the v0.2 surface (`harness`, `workflow`,
  `agent`, `skill`, `tool`, `mcp`, `runtime`, `target`, `binding`) compile
  into schema-valid versioned IR (`irVersion` 0.2.0); the tokens `plugin`
  and `composition` are no longer part of the grammar and fail to parse.
- AC-2: Compilation rejects, with source/line-qualified diagnostics:
  duplicate capability ids across skills/tools/mcps, duplicate
  harness/workflow/runtime ids, duplicate agent names in a harness,
  duplicate requirements per agent, duplicate capability/runtime bindings,
  verb–kind mismatches (`use skill` on a tool, `require tool` on an MCP,
  `connect mcp` on a skill), workflow statements naming agents a using
  harness does not declare, workflows mixing `program` with graph
  statements, empty declarative workflows, skills with neither `source` nor
  `description`, and `target ... uses adapter.X` conflicting with a declared
  runtime's adapter.
- AC-3: Resolution of a harness for a runtime records declared and
  materialized strength per (agent, capability). The v0.2 executors still
  cap materialization at `advisory`; `minimum`, `preferred`, and
  `on-degrade` apply to the effective strength exactly as in v0.1.
- AC-4: A programmatic workflow only resolves against a runtime whose
  execution is `programmatic` in the same language; the resolution error
  names external driving (ACP) or a matching runtime as the fix.
  Declarative workflows resolve against any runtime.
- AC-5: The revision captures the harness content hash, the target runtime
  (id, adapter, execution style), the workflow mode and hash, each agent's
  resolved capability list, per-(agent, capability) realizations, merged
  permissions (deny wins; MCP transports contribute implicit `network` /
  `process` grants), and settings. Revision ids remain `hr_<sha256/32>`.
- AC-6: Executors, Pi skill materialization, and the compare runner operate
  on the new bundle/revision shapes: host checks compare
  `revision.target.runtime`, the run preamble derives from agent roles,
  workflow guidance, and capability text, and compare manifests name
  harness ids in `variants`.
- AC-7: Examples, the `generate-harness-dsl` skill contract, the TextMate
  highlight grammar, and the package README describe only the v0.2 surface;
  `npm run build` and the package test suite pass with regenerated Langium
  sources.

## Non-goals

- Implementing real adapter packages (`@harness/adapter-qoder` etc.) or
  executing programmatic workflows; v0.2 records execution style and
  enforces deployability only.
- Wiring native MCP connections, host plugins, or extensions; materialized
  strength stays capped at `advisory` until an evidence-receipt contract.
- A migration tool for v0.1 sources; v0.1 documents fail to parse and are
  rewritten by hand (the surface shipped in one prior spec cycle).
- Registry, versioned capability distribution, or a dependency solver
  (removed together with `plugin`; distribution returns via `bundle` later).
- Changing root-level scripts (`harness-component-snapshot` uses an
  unrelated "component" notion) or release metadata.

## Plan and Tasks

1. Rewrite `harness.langium` to the v0.2 declarations and regenerate.
2. Replace the IR entities and bump `IR_VERSION` to 0.2.0.
3. Rewrite compiler lowering and cross-file semantic diagnostics.
4. Update Langium validator checks (preferred≥minimum, verb–kind match,
   unique bindings per runtime).
5. Rewrite the resolver as `resolveHarness(bundle, harnessId, runtime?)`
   with the execution-model deployability check.
6. Update executors, Pi skill materialization, compare runner/manifest,
   highlight grammar, examples, skill contract, and README.
7. Rewrite package tests against the new behavior with equivalent coverage.

## Test and Review Evidence

- AC-1/AC-2: `test/compile.test.ts` compiles v0.2 fixtures to schema-valid
  IR and asserts each rejection listed above via structured diagnostics.
- AC-3/AC-4/AC-5: `test/resolve.test.ts` covers satisfied, degraded-report,
  degraded-fail, below-minimum, programmatic-mismatch, runtime synthesis
  from `target`, permission merging with MCP transport grants, and revision
  shape/id stability.
- AC-6: `test/exec.test.ts` and `test/skill.test.ts` assert host checks and
  preamble/skill output from the new shapes; `test/compare.test.ts` runs the
  compare pipeline over a rewritten two-harness experiment.
- AC-7: `npm run build && npm test` in `packages/harness`, plus
  `npm run check:generated`.
