# Architecture Principles

This file is the accepted repository-wide owner of architecture principles,
ownership boundaries, and AI-facing routing rules. Detailed decisions are
indexed in [Architecture Decision Records](adrs/README.md). The
[directory-structure ADR](adrs/directory-structure.md) owns directory status;
the [developer-experience-system ADR](adrs/developer-experience-system.md) owns
the target journey, contract, evidence, governance, and DX-measurement system.

- Build minimum runnable atomic capabilities: each `scripts/<capability>/` should be copyable, executable, testable, and distributable.
- Put command execution in `cli.mjs`; add `index.mjs` only when other modules need a public import surface.
- The primary root CLI `scripts/better-harness.mjs` must stay a thin facade: it
  dispatches to capability-owned commands with argv arrays and must not own
  product logic, schemas, fixtures, or host adapters.
- Compose through public surfaces; do not import another capability's private helpers, fixtures, or provider modules.
- Keep product judgment in canonical owners such as `skills/`, `scripts/`, `hooks/`, `models/`, `schemas/` (a target owner, not yet created), `templates/`, and `references/`; host shells stay thin.
- Use business-named boundaries, not generic umbrellas such as `scripts/core/`.
- Runtime behavior needs a contract plus validation evidence: fixtures, tests, smoke commands, or parser-safe output. CLI facades need help, unknown-command, and delegated-output coverage.
- Reader-facing prose produced by an AI mutation workflow stays owned by that AI.
  Deterministic writers may validate, revision-check, persist, and project the
  supplied copy, but they do not compose or translate it; host UIs render the
  persisted semantic copy instead of rebuilding it from structural metadata.
- Keep host evidence adapters separate from packaging, and keep all automation cross-platform.
- Keep stable host identity, display, home-option, and support-slice metadata in
  `scripts/host-support/`. Executable adapter imports and construction remain in
  capability-local registries; do not introduce a global host service locator.
- Keep source-local host artifact assembly under `scripts/packaging/`; generated
  host artifacts are validation/install outputs, not canonical product owners or
  public package or Qoder runtime inputs.

## Directory Conventions

- `scripts/` is for automation entrypoints used by hooks, Qoder, Codex, or other non-interactive workflows. Put ad-hoc debugging and preview helpers in `dev/`.
- Keep helper `.mjs` directories modular: one narrow concern, small entrypoints, and no catch-all modules.
- New analyzers, scoring signals, and hook helpers should own modules when they represent distinct concerns.
- Executable behavior belongs in business-named `scripts/<capability>/`; do not create `scripts/core/`.
- Existing `scripts/core-change-watch/` and `scripts/session-analysis/` remain live owners until a tested migration lands.
- `scripts/plugin-lifecycle/` owns read-only Better Harness lifecycle status,
  deterministic plans, and verification. It composes only the public
  `agent-customize` inventory and never executes a planned host mutation. Its
  `read-only-command.mjs` is the shared strict parser/envelope/timeout runtime
  for lifecycle and doctor commands; it is capability-scoped, not the
  repository-wide authoritative command-contract owner. Identity/digest,
  bounded runtime/path discovery, target resolution, status/verification, and
  planning live in separate private modules; `target-resolution.mjs` is the
  single owner for host, surface, and scope selection used by status and plan.
  `model.mjs` owns the shared lifecycle schema version, Better Harness plugin
  identity/version, base target, diagnostic, and assertion primitives used by
  both status and plan validation; domain modules retain only their own state
  vocabularies and invariants.
  `status-row.mjs` is the single `PluginLifecycleStatusV1` row factory and
  validator for both observed inventory and inventory-failure paths; status
  core owns only collection, ordering, aggregation, and command summaries.
  `plan-model.mjs` is the corresponding single `PluginLifecyclePlanV1`
  transition, step-materialization, digest, and validation owner; plan core
  only resolves the target, collects status, and delegates construction.
  Planned mutations are typed as external `host-plugin-state` steps, while
  post-apply verification is typed as read-only `host-observation` so consumers
  never mistake a verification command for a mutation performed by the CLI.
  `command-manifest.mjs` is the pure, read-only leaf metadata owner projected
  into the root CLI registry; `command-definitions.mjs` binds that manifest to
  lifecycle executors and `human-output.mjs` renderers. The plugin CLI performs
  generic descriptor dispatch and must not branch on leaf names.
  `index.mjs` is the only cross-capability behavioral import surface and
  contains exports rather than implementation; the root registry's direct,
  metadata-only manifest projection is the sole allowed exception so root help
  does not load lifecycle runtime owners.
- `scripts/host-support/` currently provides the validated shadow profiles used
  by plugin lifecycle. While ADR-0002 remains proposed, the adapter matrix,
  capability providers, manifests, and installation documentation remain
  authoritative for their existing slices; the new profiles may detect drift
  but do not silently replace those owners. Each host owns one module under
  `scripts/host-support/profiles/`; `profile-model.mjs` is the single local
  `HostSurfaceProfileV1` vocabulary and validation owner. Profile modules fail
  during their own construction and are deeply immutable before registry
  composition; the registry facade delegates local validation and owns only
  cross-profile host-id and alias conflicts. `profile-builders.mjs` owns typed
  construction helpers for evidence, operations, surfaces, and steps rather
  than duplicating their invariants, and `profiles.mjs` only composes the
  registry. Every provider-specific filesystem root read outside the selected
  workspace must have an explicit `inventoryHomeRoutes` entry, including state
  files, shared caches, and compatibility roots such as a user-level
  `.agents/` directory. Each primary and secondary route declares its provider
  option, an isolated path relative to `--host-home`, and a redacted safe
  fallback label; providers return the effective resolved roots so doctor can
  report them without exposing absolute user paths. Per-surface inventory,
  bundled, session-only, or desktop-cache observation semantics are profile
  data. Each surface also declares whether host discovery comes from its
  executable, a provider diagnostic, or remains unobserved; bundled and
  session-only surfaces do not read unrelated persistent inventory. Scope-
  artifact ownership and native home binding are profile data as well. A shared
  `scopeArtifactPolicy` or `nativeHomeBinding` requires versioned, traceable
  native evidence. Without an evidenced binding that can represent every
  emitted native step, an isolated-home mutation plan fails closed and omits
  unbound native verification steps. Lifecycle status must not branch on
  canonical host ids.
- `scripts/harness-doctor/` owns the bounded host/plugin diagnostic view and
  reuses plugin-lifecycle status rather than reimplementing host discovery.
- `scripts/harness-analysis/canvas-preview/` owns reusable local Canvas serving,
  runtime discovery, transforms, the Harness preview fixture, and cross-platform
  browser helpers. Keeping it below `harness-analysis/` preserves the tested
  copy/install boundary; the historical `canvas-preview-server.mjs` path is a
  thin compatibility entrypoint.
- `scripts/harness-analysis/report-source/` owns the report-source contract and
  its bounded human-review integrity chain: packet binding, episode/delivery
  normalization, and review application. Non-facade consumers import its public
  `index.mjs`; historical flat paths remain compatibility entrypoints.
- `scripts/experience-trace/` owns bounded, read-only Experience Trace JSONL:
  its exact wire contract, Qoder report-source allowlist projection, and
  create/validate command. It may consume report-source validation only through
  that capability's public `index.mjs`; report-source, session-analysis,
  Learning Capture, Harness Run Checkpoints, and component snapshots do not
  import Experience Trace. Its `index.mjs` is the sole cross-capability
  behavioral import surface; the root registry may project only its pure command
  manifest so root help does not load runtime behavior.
- `scripts/harness-component-snapshot/` owns the versioned, read-only Qoder
  project component snapshot, validation, bounded diff, and non-authorizing
  rollback-reference contracts. It composes only allowlisted public
  `agent-customize` project collections, keeps its direct CLI capability-local,
  and does not claim runtime activation or mutation authority.
- `schemas/` is a target owner, not yet created, for versioned public runtime contracts consumed by multiple repo surfaces or packaged hosts; see the directory-structure ADR for adoption criteria. Capability-private schemas stay under `scripts/<capability>/`.

## AI Directory Routing

- Start from the [ADR index](adrs/README.md). The directory-structure ADR is
  this file's detailed AI-optimized directory-status reference, while the DX
  system ADR governs cross-surface experience contracts and activation gates.
- For open-source community extensibility, start from `docs/community.md` and route intent -> owner -> contract -> evidence -> activation -> validation -> packaging before adding surfaces.
- Put shared user workflows in root `skills/`; use `.agents/skills/` only for host-local skills, generated mirrors, or wrappers.
- Use each `.agents/skills/<skill>/SKILL.md` as the host-local entrypoint; do not add mirror sidecar metadata.
- Put reusable role/persona prompts in `agent-roles/` (a target directory, not yet created; see the directory-structure ADR for adoption criteria) only when they contain no workflow steps and have a second skill/host consumer.
- Keep skill-specific evidence, artifact, output, and validation rules under `skills/<skill>/references/`.
- Treat `knowledge-base/` as a candidate directory, not yet created (see the directory-structure ADR for adoption criteria), until schema, fixtures, registry compilation, explicit consumer binding, and mapping tests pass.
- Put prose guidance in `references/`, examples and operating models in `case-studies/`, and runtime behavior in `skills/`, `scripts/`, `hooks/`, or `templates/` with tests.
- For shared reference placement, start from `references/README.md`: session
  evidence lives under `references/session-evidence/`, static project and
  delivery evidence under `references/project-harness/`, Agent asset guidance
  under `references/agent-customize/`, and repeated-work owner selection under
  `references/loop-engineering/`.
- Keep detector and signal contracts with the selected model, executable
  capability, or skill-local owner. Promote shared prose only for two visible
  workflow consumers; do not create a generic detector or signal umbrella.
- Keep `.claude-plugin/`, `.qoder-plugin/`, `.cursor-plugin/`,
  `.codex-plugin/`, `.agents/skills/`, and future host shells thin: they expose,
  wrap, mirror, or package canonical behavior; they do not own product judgment.
  The Claude Code shell owns native install/discovery metadata and exposes the
  canonical root skills; Claude configured-asset and session evidence remain
  in the capability-owned agent-customize and session-analysis providers. The Codex shell
  owns local install/discovery metadata only; Codex evidence collection remains
  in the capability-owned provider and session-analysis modules. The public npm
  package ships all seven plugin metadata roots, while the Qoder runtime bundle
  includes only `.qoder-plugin/`.

## Developer Experience Routing

- Read the
  [Developer Experience System ADR](adrs/developer-experience-system.md) before
  changing public product routes, Quickstarts, CLI/help/error contracts,
  Preview prerequisites, host support declarations, diagnostics, support or
  privacy behavior, release claims, or DX metrics.
- Treat the DX system as a federated control plane. Capability owners retain
  behavior and judgment; cross-surface tooling may index, validate, compare,
  and project their public declarations.
- Keep curated prose and translations author-owned. Generate or validate only
  structured facts unless an accepted spec establishes a narrower deterministic
  ownership boundary.
- Keep fixture, package, native-host, installed-application, deployed-site, and
  post-publish evidence distinct. One evidence class does not satisfy another
  class's acceptance gate.
- Do not route Better Harness's own DX governance through the runtime
  `software-fluency` report model. Changes to report-model routing require their
  own spec and validation.

## Template Boundaries

- Keep report-generation contracts under `templates/reporting/`: `routing.md` owns report/style/output selection, `report-structure.md` owns Markdown structure, and the mode files own runtime and validation contracts.
- Style templates own visual grammar, not runnable skeletons. Keep `templates/style/*.md` directive and style-specific; do not add style-specific TSX examples or shared Canvas skeletons.

## Agent-Friendly CLI Contracts

- Design CLI entrypoints as human-first defaults with machine-first contracts: readable help and summaries by default, plus explicit JSON, JSONL, or schema surfaces for agents and automation.
- Keep stdout parser-safe in machine modes. JSON/JSONL output must not include spinners, colors, progress text, or human diagnostics; logs, warnings, and errors belong on stderr unless they are part of a documented JSON error envelope.
- Make command surfaces discoverable without source reading. Root facades may expose command inventory and schema metadata, but delegated behavior, capability-private output schemas, fixtures, and product judgment stay under capability-owned directories.
- Classify every registered command and subcommand as `workflow`, `advanced`, or
  `maintainer`. Human help defaults to workflow routes and expands explicitly;
  machine inventory stays complete by default and reports the audience metadata.
- Preserve argv-array dispatch across platforms. Use Node and Git portability primitives such as `process.execPath`, `spawn`/`spawnSync` argument arrays, `path.join`, and `path.resolve`; avoid shell-string dispatch.
- Treat non-interactive execution as a first-class path. Agent-safe commands should support explicit flags such as `--json`, `--no-color`, `--quiet`, `--no-input`, `--dry-run`, `--yes`, `--limit`, `--output`, and `--timeout` when those modes apply.
- Separate planning from mutation. Destructive or externally visible actions need a plan/dry-run/draft phase before apply/publish, and the write phase must require explicit confirmation in non-interactive workflows.
- Keep CLI, MCP, hooks, skills, and host shells on the same core behavior. MCP exposes tools, hooks enforce lifecycle checks, skills own repeatable workflows, and the CLI remains the stable human/CI/agent command protocol.
