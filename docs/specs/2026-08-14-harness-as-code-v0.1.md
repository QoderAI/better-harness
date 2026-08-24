# Make Harness as Code safe to install and execute

## Traceability

- Spec ID: harness-as-code-v0.1
- Status: Implemented

## Intent

Ship the first production-ready `@qoder-ai/harness` package as a parseable,
lockable, and explainable assembly language for coding-agent harnesses. A
resolved revision must distinguish the strength declared by a host binding from
the strength the v0.1 executor can actually materialize, reject unsafe or
ambiguous assemblies before execution, and install, build, test, and pack from
the repository's normal dependency and CI workflow.

The v0.1 executors materialize components as prompt instructions. They may
therefore realize at most `advisory` strength. Bindings may declare future
`wired` or `enforced` host mechanisms, but those declarations are reported as
degraded rather than presented as observed runtime guarantees.

## Acceptance Scenarios

- AC-1: One or more `.harness` sources compile into schema-valid versioned IR,
  with stable diagnostics for parser, linker, semantic, and cross-file
  declaration conflicts.
- AC-2: Duplicate component ids, composition ids, exact plugin versions, or
  component/host bindings fail compilation even when the conflicting
  declarations are split across source files. Invalid exact semantic versions,
  duplicate plugin includes, and repeated component inputs/outputs also fail
  before resolution.
- AC-3: Resolution records both declared and materialized strength. The v0.1
  runtime caps materialized strength at `advisory`, applies `minimum`,
  `preferred`, and `on-degrade` to that effective strength, and never describes
  an unmaterialized `wired` or `enforced` mechanism as realized.
- AC-4: An executor rejects a revision whose target host differs from the
  executor host before starting an SDK session or child process.
- AC-5: Qoder execution uses the official Agent SDK with explicit authentication,
  cwd, streaming output, and tool-authorization seams. Pi execution uses the
  current non-deprecated SDK and `ModelRuntime` API, honors the task working
  directory, disables native tools in the advisory-only v0.1 path, and reports
  a missing optional runtime dependency with actionable guidance. Pi model
  failures propagate through the run result and sessions are disposed after a
  run. Qoder streams that terminate without a result message fail closed.
- AC-6: Pi package materialization emits `SKILL.md` only for advisory
  skill-kind contracts, produces valid front matter for arbitrary DSL string
  descriptions, stamps revision provenance, and fails closed when the target
  directory already contains files.
- AC-7: The repository's root install and CI workflow installs this workspace,
  regenerates the Langium sources, type-checks/builds the package, runs its
  behavior tests on Windows, macOS, and Linux, and detects stale generated
  artifacts.
- AC-8: `npm pack` contains the documented public exports, declarations,
  example, README, and license without source-local dependencies, caches, or
  absolute paths; a clean temporary install can import and exercise the public
  API.
- AC-9: The package development guide describes supported Node and Pi SDK
  versions, the declared-versus-materialized strength boundary, focused
  commands, and current v0.1 limitations without claiming native host evidence.

## Non-goals

- Installing or managing native Qoder hooks or Pi extensions in v0.1.
- Claiming `wired` or `enforced` runtime strength without a future native
  materialization and evidence-receipt contract.
- Adding another Coding Agent host adapter.
- Publishing the package to the npm registry in this change.
- Changing Better Harness release notes, versions, roadmaps, or changelog.
- Providing a full CLI, language server, editor extension, remote registry, or
  dependency solver beyond the in-bundle semver selection API.

## Plan and Tasks

1. Tighten compiler semantic validation across the complete source set and
   keep diagnostics source/line-qualified.
2. Extend realization IR with declared strength and make the v0.1 resolver
   compute effective advisory materialization before applying degradation
   policy.
3. Add shared executor host validation, integrate the official Qoder and Pi
   SDKs, and make Pi skill materialization kind-safe and front-matter-safe.
4. Add the package as a root npm workspace, refresh the lockfile, expose root
   build/test/generated-source gates, and wire them into the OS matrix CI.
5. Expand behavior tests for every repaired failure mode, public exports,
   clean-pack import, and generated artifacts.
6. Validate a clean install, build, focused tests, root gates, package contents,
   temporary consumer import, and locally available host surfaces.

## Test and Review Evidence

- AC-1/AC-2: package compiler tests use multi-source duplicate fixtures and
  assert structured diagnostics; they pass as part of the 38-test package run.
- AC-3: resolver tests cover satisfied, degraded-report, degraded-fail, and
  below-minimum paths against declared and materialized strengths.
- AC-4/AC-5: executor tests assert that mismatched hosts never invoke SDK
  loaders, that Qoder uses explicit auth/tool options, and that Pi uses
  `ModelRuntime.create` with the task cwd, selected model, and `noTools: "all"`.
  Installed-package contract tests load both SDKs. A native Qoder SDK smoke
  returned exactly `HARNESS_QODER_REVIEW_OK`; native Pi inference was not run
  because this process had neither `DEEPSEEK_API_KEY` nor configured DeepSeek
  authentication.
- AC-6: temporary-directory tests inspect the returned file set and parse-safe
  generated front matter for skill and non-skill contracts.
- AC-7: `npm ci --ignore-scripts --registry=https://registry.npmjs.org`, an
  explicit Qoder SDK rebuild to restore its intentionally skipped worker
  postinstall, and `npm run check` passed. The final run covered 1,324
  repository tests, 38 package tests, generated-source verification,
  TypeScript build, and pack verification. CI runs package gates on Windows,
  macOS, and Linux with Node 22.20.0 plus Linux with Node 24.
- AC-8: `npm pack --workspace @qoder-ai/harness` ran the package prepack gate
  and produced a 36-file, 27.2 kB tarball without the removed executor or
  source-local artifacts. A clean temporary install audited 160 dependencies
  with zero vulnerabilities and completed a Node ESM import/compile/resolve
  smoke through the public API.
- AC-9: README review against the package manifest and observed validation
  commands.
- Full regression: `npm run check` passed; root pack verification reported 523
  npm entries and 545 runtime-zip entries. The focused documentation link graph
  passed all six assertions, and `npm audit --audit-level=high` reported zero
  vulnerabilities after upgrading Pi to 0.84.2.
- Risk: generated Langium output can drift from its grammar. CI regenerates and
  rejects a non-empty generated-source diff.
- Risk: adding a root workspace changes the lockfile and install graph. Review
  the final lockfile diff and keep package dependencies scoped to the workspace.
- Risk: native host and model availability vary by machine. Deterministic tests
  remain authoritative; native smoke is reported separately and never replaces
  package or fixture evidence.
