# Teach agents to generate valid Harness DSL

## Traceability

- Spec ID: harness-dsl-generation-skill
- Status: Implemented

## Intent

Ship a package-local skill that teaches coding agents to author complete,
valid Harness as Code v0.1 documents. The skill must route agents to the
canonical language contract, require deterministic compiler and resolver
validation, and preserve the runtime's declared-versus-materialized strength
boundary.

The skill belongs to `packages/harness/skills/` so it evolves with the DSL and
is included in the `@qoder-ai/harness` tarball. It is generation guidance, not
an executor: it must not start Qoder or Pi sessions, handle model credentials,
or claim native enforcement without runtime evidence.

## Acceptance Scenarios

- AC-1: Invoking `$generate-harness-dsl` gives an agent a concise workflow for
  eliciting a target, declaring components, bindings, plugins, and
  compositions, and returning a complete `.harness` document.
- AC-2: The routed reference documents the v0.1 grammar, semantic constraints,
  version and identifier rules, configuration value types, and the
  declared-versus-materialized strength boundary without duplicating runtime
  ownership.
- AC-3: A portable Node script compiles a supplied `.harness` file with the
  package public API, resolves all or selected compositions, emits structured
  JSON diagnostics, and exits non-zero for invalid or unresolved input.
- AC-4: Behavior tests exercise the validator with valid and invalid files;
  the skill package passes the system skill validator and repository agent
  asset lint.
- AC-5: The npm package manifest includes the package-local skill, and an npm
  pack inspection confirms `SKILL.md`, its reference, validator, and generated
  UI metadata are present without secrets or source-local dependencies.
- AC-6: A fresh AI forward test, run outside the repository worktree, follows
  the skill to produce DSL that passes the deterministic validator and reports
  any resolution degradation honestly.
- AC-7: Relative Markdown links remain valid and the repository documentation
  link graph stays green.

## Non-goals

- Changing the Harness DSL grammar, IR, resolver, or executor behavior.
- Running Qoder or Pi SDK inference as part of DSL generation or validation.
- Storing API keys, authentication material, or other secrets in the skill or
  generated DSL.
- Installing the skill globally or adding a new Coding Agent host adapter.
- Claiming `wired` or `enforced` materialization from declarations alone.
- Publishing a package, changing versions, release notes, or the changelog.

## Plan and Tasks

1. Initialize the package-local skill with the standard skill scaffolder and
   generate its UI metadata.
2. Write a compact `SKILL.md`, a routed v0.1 contract reference, and a portable
   compiler/resolver validation script.
3. Include the skill directory in the package tarball and add behavior tests
   for the validator's success and failure contracts.
4. Run skill, package, documentation, and pack validation, then forward-test
   the instructions with a fresh AI agent from a neutral directory.
5. Record observed evidence and review the final staged/unstaged boundary.

## Test and Review Evidence

- AC-1/AC-2: `SKILL.md` routes to one focused v0.1 contract reference and the
  package example. System `quick_validate.py` accepted the skill structure and
  metadata; `agent-lint --profile agent-assets-review` reported one skill with
  zero findings, errors, warnings, or advisories.
- AC-3/AC-4: `npm run harness:build` and the 42-test package suite passed. The
  behavior tests execute the shipped Node validator against both the package
  example and invalid temporary input, asserting parsed JSON, exit status, and
  declared-versus-realized strength rather than source text.
- AC-5: package `npm pack` prepack gates passed and produced a 40-entry tarball
  containing `SKILL.md`, `agents/openai.yaml`, `references/dsl-contract.md`, and
  `scripts/validate.mjs`. A clean temporary install of that tarball ran the
  installed validator successfully against the installed Qoder example.
- AC-6: an isolated fresh agent used the skill to create
  `safe-repository-change` outside the repository. Independent validation
  compiled and resolved it with no diagnostics, satisfying repository impact
  at advisory strength and reporting verification honestly degraded from
  declared `enforced` to materialized `advisory`. An attempted Qoder CLI run
  stopped before inference because the isolated config was not logged in; it
  is not counted as forward-test evidence.
- AC-7: the focused documentation link graph passed all six assertions, and
  root pack verification passed with 524 npm entries and 546 runtime-zip
  entries. Generated Langium source verification also passed.
- Full regression: the root test run passed 1,322 of 1,324 tests. Two unrelated
  governance tests timed out at their 120-second limit; a focused rerun passed
  52 of 54 but timed out in two different test cases, indicating an unstable
  baseline timing issue rather than a deterministic assertion or changed DSL
  package behavior. Package, generated-source, documentation, validator, and
  pack gates all completed successfully when run separately.
- Risk: the validator imports `dist/` relative to the packaged skill. The clean
  tarball install smoke proves this layout; source-tree contributors must build
  before invoking it, and the failure message gives that command.
- Risk: generated DSL can overstate a host binding. The reference, workflow,
  behavior test, and fresh-agent output all preserve the v0.1 advisory ceiling
  and expose degradation in the resolution report.
