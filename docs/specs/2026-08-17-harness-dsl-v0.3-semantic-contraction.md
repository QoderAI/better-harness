# Make the Harness DSL state only executable contracts

## Traceability

- Spec ID: `harness-dsl-v0.3-semantic-contraction`
- Status: Implemented

## Intent

Replace the v0.2 authoring surface that mixes executable requirements with
prompt-only intent. The v0.3 language keeps the existing
`Source -> IR -> Revision -> Materialization -> Receipt` trust chain, but makes
the authored contract smaller and falsifiable:

- source files identify their language version;
- deployments bind one harness to one runtime in source;
- a workflow either describes the single session the shipped adapters really
  run, names a programmatic controller, or declares a state machine that only a
  proven orchestration adapter may accept;
- capability requirements are satisfied in their native dimension
  (`delivered`, `exposed`, or `connected`) instead of sharing a synthetic
  strength ladder; and
- tool contracts have an identity that an adapter exposure must match.

Author-facing permissions, free-form settings, capability bindings, and tool
input/output name lists are removed because no shipped adapter enforces or
consumes them. Runtime permission callbacks and executor options remain owned by
the runtime APIs that actually apply them.

## Acceptance Scenarios

- **AC-1 — Versioned source:** every v0.3 source starts with `language 0.3`.
  Compilation rejects a missing or unsupported source version with a structured,
  source-qualified diagnostic, and the lowered bundle uses `irVersion: 0.3.0`.
- **AC-2 — Honest workflow modes:** `workflow x { session coder }` is the
  portable single-session form. It must name exactly the one agent in every
  using harness. A state-machine workflow declares an entry agent and typed
  outcomes; compilation rejects unknown outcomes, missing entries, unreachable
  agents, and stop-free graphs. Shipped Qoder and Pi descriptors support only
  `session`, so a state machine fails resolution instead of becoming prompt
  prose. Programmatic workflows retain descriptor-owned language gating.
- **AC-3 — Kind-specific satisfaction:** requirement syntax contains no
  `preferred`, `minimum`, or `on-degrade`. A skill resolves only when delivered,
  a tool only when an exact tool contract is exposed, and an MCP only when
  connected. Missing realization fails resolution. Revision, report, and receipt
  entries record dimension, state, mechanism, and reason without a cross-kind
  strength value.
- **AC-4 — Explicit composition:** a named `deployment` references exactly one
  harness and one declared runtime. Compilation rejects duplicate deployment ids
  and duplicate harness/runtime pairs. Resolution accepts only a pair declared
  by a deployment and records the deployment id/hash in the revision.
- **AC-5 — Tool contract identity:** the standard tool ids have frozen builtin
  contract ids and may be referenced without a local declaration. Any other tool
  must declare a non-empty `contract` string. Adapter tool exposure states both
  the host tool and contract id; a missing or mismatched contract fails
  resolution. The removed input/output identifier lists no longer imply a schema
  the runtime does not validate.
- **AC-6 — Removed inert syntax:** v0.3 rejects `binding`, `target`, runtime
  `execution`, requirement strength/degradation blocks, capability `permissions`,
  harness `configure`, and tool `input`/`output`. No v0.3 IR or materialization
  receipt carries author settings or requested/enforced permission claims.
- **AC-7 — Trust-chain preservation:** revisions remain deeply frozen and bind
  harness, deployment, runtime/adapter descriptor, workflow, capabilities,
  source locks, and optional component snapshot provenance. Executor preflight
  still rejects revision, bundle, adapter, or source drift before SDK load.
- **AC-8 — One teaching contract:** package examples, README, highlighting,
  generation skill, validator, tests, and current in-repo consumers describe
  only v0.3 syntax and distinguish core, adapter, and devtool ownership.

## Non-goals

- Implementing a state-machine scheduler, per-agent host sessions, structured
  outcome extraction, or handoff payloads. The language may describe that
  contract, but shipped adapters must reject it until an executor proves it.
- Adding MCP support, new host adapters, or new standard tool contracts.
- Designing a general policy language, adapter configuration language, package
  registry, dependency solver, or JSON-Schema transport for custom tools.
- Migrating persisted v0.2 revisions or compare evidence. Their `irVersion`
  remains the discriminator; v0.3 code must reject them rather than reinterpret
  them.
- Changing npm package versions, release metadata, changelog, roadmap, or
  publication workflow.

## Plan and Tasks

1. Change the Langium grammar and generated artifacts: add the language header,
   session/state-machine workflow forms, agent outcomes, tool contracts, and
   deployment; remove target, binding, strength, permissions, settings, and
   tool input/output syntax.
2. Bump the IR contract to 0.3.0. Replace target/binding/strength data with
   deployments, kind-specific realization state, tool contract ids, and the
   deployment-bound revision shape.
3. Update compiler validation/lowering for source version, workflow outcome and
   reachability checks, standard tool synthesis, custom tool contracts, and
   deployment uniqueness.
4. Update resolver and adapter descriptors so exact capability facts decide
   availability. Preserve source locks, adapter identity/hash checks, deep
   freezing, and component snapshot provenance.
5. Update executor materialization and preamble generation. Session workflows
   add no fake control-flow prompt; unsupported workflow modes fail before SDK
   load.
6. Migrate all package examples, the generation skill and validator, package
   docs, highlighting grammar, compare/experiment/UI consumers, and fixtures.
7. Regenerate Langium sources and validate focused behavior, package gates,
   module boundaries, documentation links, and the repository test surface
   proportionate to the changed public contract.

## Test and Review Evidence

- **AC-1/AC-2/AC-4/AC-5/AC-6:** compiler tests assert parsed IR and structured
  diagnostics from behavior, including missing version, invalid workflow
  outcome/reachability, undeclared custom tool, contract mismatch, undeclared
  deployment pair, and removed v0.2 syntax.
- **AC-3:** resolver tests cover delivered skill, exposed exact-contract tool,
  connected MCP, and each unavailable/mismatched path. Receipt tests assert the
  dimension/state/mechanism shape with no strength fields.
- **AC-7:** existing revision, source-lock, adapter drift, executor preflight,
  and source-delivery tests remain green after fixture migration.
- **AC-8:** compile and resolve every shipped `.harness` example, run the
  generation-skill tests, `npm run check:generated`, package build/typecheck/test,
  targeted package consumers, and the Markdown doc-link graph after docs move or
  link changes.
- **Risk — breaking source language:** all v0.2 files fail under v0.3. Mitigate
  with the explicit header, actionable diagnostics where parsing permits, a
  before/after README example, and migration of every in-repo source in the same
  change.
- **Risk — false orchestration claim:** a descriptor could claim state-machine
  support before an executor implements it. Mitigate by keeping shipped
  descriptors session-only and preserving registry/live-descriptor drift tests;
  adding support requires its own execution spec and runtime evidence.
- **Risk — consumer shape drift:** UI/compare/experiment fixtures may embed
  revision or receipt shapes. Validate parsed persisted artifacts and consumer
  tests rather than relying on TypeScript compilation alone.
- **Risk — cross-platform generated output:** regenerate through the repository
  Langium command and run existing Windows-portable behavior tests; do not add
  shell-dependent runtime behavior.

## Implementation Evidence

- **AC-1/AC-2/AC-4/AC-5/AC-6:** `packages/harness/test/compile.test.ts`,
  `resolve.test.ts`, and `sugar.test.ts` exercise the language header, workflow
  modes/outcomes/reachability, explicit deployments, exact tool contracts, and
  rejection of removed v0.2 syntax through compiler/resolver behavior.
- **AC-3/AC-7:** resolver, revision, materialization, executor, adapter, and
  skill-delivery tests cover kind-specific facts, deployment/content hashes,
  descriptor drift, source locks, deep freezing, and pre-SDK failure.
- **AC-8:** examples, README, Shiki grammar, generation skill/reference/
  validator, harness-ui fixtures, and compare/experiment fixtures use v0.3.
- `npm run harness:test`: 17 test files, 156 tests passed.
- `npm run harness-ui:test`: 3 test files, 29 tests passed.
- `npm test`: 95 root test files, 1325 tests passed.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs`: 1 test file,
  6 tests passed after regenerating the routing graph (no graph diff).
- `npm run pack:verify`: npm and runtime-zip verification passed.
- `node skills/generate-harness-dsl/scripts/validate.mjs` resolves both
  `minimal.harness` and `standard-coding.harness`; `full-surface.harness` exits
  non-zero with explicit state-machine, MCP, custom-tool, and program-controller
  limitations, as intended.
- Two consecutive `npm run langium:generate` runs produced identical SHA-256
  hashes for all generated files. The repository `check:generated` wrapper
  compares against `HEAD`, so it reports the intended uncommitted generated
  diff until this change is staged or committed.
- Current harness-studio verification is unavailable because unrelated
  concurrent checkpoint-history edits changed `/api/config` without updating
  its existing exact-shape assertion: the build passes and 44 of 45 tests pass,
  while `test/server.test.ts` still expects no `historyEnabled` field. Before
  those edits changed during this work, all 45 tests passed.
