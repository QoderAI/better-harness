# Manage Better Harness Across Coding Agent Hosts

## Traceability

- Spec ID: `better-harness-plugin-lifecycle`
- Status: Draft
- AI involvement: Codex (GPT 5.6 Sol), implementation and review
- Related decision: [ADR-0002 Developer Experience System](../adrs/developer-experience-system.md)
- Related roadmap: `LC-01`, `LC-06`, `LC-12`, and `HA-04`

## Intent

Give operators and automation one read-only CLI surface for discovering,
planning, and verifying the Better Harness plugin lifecycle across Claude Code,
Codex, Qoder, Cursor, Qwen Code, GitHub Copilot, and Pi. Keep WorkBuddy visible
as an explicit unsupported lifecycle boundary. Reuse host-native installation
mechanisms and configured-asset evidence without adding MCP, writing host
configuration, contacting remote services, or executing lifecycle mutations.

The first version must preserve host differences. A missing, stale, manual,
session-only, bundled, or unsupported host contract remains visible instead of
being converted into a generic install command.

## Acceptance Scenarios

- **PLG-AC-1 (host profile parity):** A validated host-support registry covers
  Claude, Codex, Qoder, Cursor, Qwen, Copilot, Pi, and WorkBuddy, including
  surface, scope, distribution, identity, lifecycle disposition, and evidence
  metadata. Seven hosts are managed and WorkBuddy reports
  `PLUGIN_LIFECYCLE_UNSUPPORTED`.
- **PLG-AC-2 (normalized status):** `better-harness plugin status` uses the
  public agent-customize inventory to report every matching Better Harness
  installation independently, including host discovery, installation,
  enablement, observed-version relation, verification, and bounded evidence.
  Display-name-only matches are rejected and multi-scope installs are not
  collapsed. Inventory entries outside the selected workspace are excluded,
  unknown or unsupported source scopes fail closed instead of falling back to
  a default scope, and one surface cannot borrow discovery, version, Skill, or path
  evidence from another surface. Pi persistent user/project package inventory
  and transient `pi -e` session activation are separate surfaces: empty
  persistent settings cannot report the session-only surface as not installed,
  and persistent package evidence cannot prove session activation. Provider
  inventories preserve native user/project/local scope when the host exposes
  that distinction. Qwen scope
  comes from the v2 extension-store activation policy rather than UI grouping
  preferences; missing, corrupt, unmatched, or foreign activation state stays
  visible as unresolved evidence.
- **PLG-AC-3 (deterministic plans):** `plugin plan install|update|remove`
  requires an explicit host and produces a stable, content-addressed plan with
  preconditions, typed steps, verification, blockers, retention boundaries,
  and no side effects. Install is a no-op when already installed, update fails
  closed when absent, and remove never removes a marketplace, report, cache,
  CLI package, or source checkout. Project/local plans bind their observation,
  plan identity, rendered instructions, and external command working directory
  to the requested workspace; isolated-host plans retain their host-home
  boundary. Inventory failure, an absent required host executable, or an
  unrepresentable native scope blocks mutation planning rather than being
  treated as not installed. Native steps carry a typed, evidenced home binding;
  an actionable isolated-home plan is blocked when every native root cannot be
  represented. An unobserved desktop installation remains a manual UI plan for
  update or removal rather than being collapsed into an absent-install blocker
  or no-op. A host with one shared artifact across activation scopes blocks
  cross-scope reinstallation while same-scope install remains a no-op. Blocked
  plans are operational failures. Multi-surface Pi plans require `cli` for
  persistent user/project packages or `cli-session` for one transient session;
  session update and removal are not applicable. Sorting and digests are
  locale-independent. Human rendering preserves executable argv as explicitly
  non-shell JSON data and neutralizes shell expansion syntax in local paths;
  it never degrades typed steps into a copy-paste shell string.
- **PLG-AC-4 (bounded verification and doctor):** `plugin verify` validates
  local install evidence, manifest identity, Skill routing, version, and
  enablement without claiming runtime activation. `better-harness doctor`
  reports product/runtime versions, host discovery, authorized inventory roots,
  and stable diagnostics without reading raw sessions or exposing full user-home
  paths. Doctor keeps the selected host separate from the runtime operating
  system, honors Windows `PATHEXT`, and requires executable permission for
  POSIX command discovery. Pi doctor output keeps persistent package inventory
  and bounded session-only activation as distinct rows, including when the
  persistent inventory collector fails. Each surface declares executable,
  diagnostic, or unobserved discovery ownership; Qoder Desktop does not inherit
  `qodercli` discovery, while selected bundled/session-only surfaces do not read
  unrelated persistent provider state.
- **PLG-AC-5 (command contract):** The new commands provide help-only discovery,
  strict parsing, human output, one `command-contract.v1` JSON document, and
  portable exits `0` for ok, `2` for partial, `1` for operational failure, and
  `64` for invalid usage. The root command inventory and OpenCLI schema describe
  each leaf command, including multi-segment `command describe <group> <leaf>`
  lookup and exact unknown-path diagnostics already present on the target
  branch.
- **PLG-AC-6 (read-only privacy boundary):** Status, plan, verify, and doctor do
  not write files, spawn lifecycle commands, use shell strings, read transcript
  content, send telemetry, or make network calls. Absolute user-home paths are
  redacted from diagnostics and evidence views. A supplied `--host-home`
  relocates every provider-specific primary and secondary inventory root; no
  implicit state file or shared cache may fall back to the real user home, and
  doctor reports the effective bounded roots rather than a fixed label.
- **PLG-AC-7 (surface consistency):** English, Chinese, and site installation
  or troubleshooting guidance distinguish lifecycle planning from apply and
  preserve host-specific unsupported, bundled, manual, or session-only states.
  Documentation links, package boundaries, and generated routing remain valid.
  No troubleshooting or adapter page recommends a native flag that the current
  fail-closed host contract records as unavailable, including Cursor
  `--plugin-dir`.
- **PLG-AC-8 (apply remains gated):** No `plugin apply` command, hidden executor,
  config writer, or generic third-party plugin input is shipped. Apply remains
  gated on accepted readiness, durable runtime, native mutation, journal,
  verification receipt, and compensation contracts.
- **PLG-AC-9 (extensible ownership without parser duplication):** Each host
  profile is independently owned and composed by one validated registry, while
  shared profile constructors enforce typed steps and evidence fields. Plugin
  and doctor commands use one strict option parser and one read-only command
  runner for help, timeout, JSON envelope, diagnostics, and exit behavior;
  adding a lifecycle leaf or doctor option does not require copying a parser or
  machine-output control flow.
- **PLG-AC-10 (cohesive lifecycle core):** Plugin identity/digests, bounded
  runtime and path discovery, status/verification, and plan generation have
  separate capability-private owners. `plugin-lifecycle/index.mjs` remains the
  stable public import surface and contains no lifecycle implementation, so
  extending one concern does not require editing an unrelated core path.
- **PLG-AC-11 (declarative host observation):** Inventory home routing and
  surface observation semantics are validated host-profile data. Status and
  verification interpret those declarations without canonical host-id tables
  or host-specific branches, so adding a host or a second surface does not
  require modifying the lifecycle status core.
- **PLG-AC-12 (single target resolution owner):** Host aliases, all-host
  selection, explicit-plan-host requirements, multi-surface ambiguity, surface
  lookup, and scope validation have one lifecycle-private owner. Status and plan
  cores consume resolved targets without importing host-support lookup APIs or
  duplicating target-related diagnostics, while existing error codes, hints,
  JSON envelopes, and exit codes remain stable.
- **PLG-AC-13 (declarative plugin leaf dispatch):** Each plugin leaf has one
  validated runtime definition for its name, usage synopsis, allowed options,
  positional contract, executor, and human renderer. The plugin CLI performs
  generic lookup, parsing, preparation, and read-only dispatch without
  command-name branches; the root registry projects the import-free command
  manifest without loading lifecycle runtime modules, while root help and
  OpenCLI output stay unchanged.
- **PLG-AC-14 (single status-row model):** Observed installs and inventory
  failures use one lifecycle-private `PluginLifecycleStatusV1` row factory and
  validator. Identity, target, discovery, installation, enablement, version,
  verification, activation, checks, evidence, and diagnostics are constructed
  once and checked against controlled state vocabularies, so a new observation
  policy cannot create a structurally divergent row.
- **PLG-AC-15 (single lifecycle-plan model):** Plan transition policy, typed
  step materialization, deterministic digests, and complete
  `PluginLifecyclePlanV1` validation have one lifecycle-private owner. Mutation
  steps declare external host-plugin-state effects, verification steps declare
  read-only host-observation effects, and every emitted plan proves that its
  target observation, summaries, blockers, status, and digests remain
  internally consistent, including target/row distribution parity and exact
  blocker/state invariants. The plan core only resolves a target, observes local
  status, and delegates construction; it does not own plan schema or lifecycle
  state transitions.
- **PLG-AC-16 (fail-fast host profile model):** Each host profile, surface,
  lifecycle operation, evidence record, and typed step is validated and deeply
  frozen when its module is constructed, before the aggregate registry loads.
  One host-support model owns the local `HostSurfaceProfileV1` vocabulary and
  invariants; aggregate validation delegates to it and owns only cross-profile
  host-id and alias conflicts. Invalid manual/UI/host-command payloads,
  undeclared lifecycle keys, mutable nested declarations, and executable steps
  without evidence fail at their local module boundary.
- **PLG-AC-17 (shared lifecycle contract primitives):** Status-row and plan
  validation share one lifecycle-private owner for base assertions, Better
  Harness plugin identity/version fields, host/surface/scope/distribution
  targets, expected-source identity, and diagnostic shape/severity. Status and
  plan modules retain only their domain-specific state vocabularies and
  invariants; they cannot copy or independently weaken the shared contract, and
  the stable public lifecycle export surface does not grow.

## Non-goals

- Managing arbitrary third-party plugins, publishing a plugin registry, or
  defining Loop Packs, signatures, permissions, dependencies, or trust policy.
- Adding an MCP server, MCP tool, MCP configuration, or alternate runtime.
- Executing install, update, remove, marketplace, Git, package-manager, desktop,
  slash-command, or session-launch steps.
- Querying a remote latest version or treating the local package version as a
  remote freshness claim.
- Deleting user reports, host data, configuration, caches, CLI binaries, or
  source checkouts.
- Promoting ADR-0002 target owners without explicit maintainer acceptance and an
  activation decision; new declarations remain a shadow parity surface.
- Generalizing the shared lifecycle command runner into the repository-wide
  authoritative command-contract owner while ADR-0002 remains proposed.
- Declaring lifecycle profiles for Kimi Code and Grok. Both host adapters landed
  after this spec was written and have no validated native lifecycle contract
  yet, so `plugin` and `doctor` targets reject them with `UNKNOWN_HOST` instead
  of inheriting another host's install route.

## Plan and Tasks

1. Add capability-owned host-support profiles and validation, with structured
   lifecycle steps stored as argv arrays or explicit manual/UI/session steps.
2. Add a plugin-lifecycle public module that composes host profiles with
   `agent-customize`'s public inventory, performs strict Better Harness identity
   matching, normalizes status, builds deterministic plans, and verifies local
   plugin artifacts.
3. Add strict `plugin` and `doctor` CLI entrypoints, register their leaf
   contracts in the root CLI, and keep the root facade free of behavior.
4. Add isolated-home fixtures and contract tests for every host, unsupported and
   stale capability behavior, cross-platform paths, machine output, no-write
   behavior, and the absence of apply.
5. Update curated installation and troubleshooting routes, regenerate the
   documentation graph, and verify package/runtime boundaries.
6. Run a Review Readiness Check over Story/Spec/Test/Risk, changed modules,
   generated files, AI involvement, and staged/unstaged state before handoff.
7. Split the monolithic host declaration into per-host profile modules backed
   by shared typed constructors, and replace the duplicated plugin/doctor CLI
   parsing and envelope flow with one lifecycle-owned read-only command runtime.
8. Split the lifecycle implementation into identity, runtime, status, and plan
   modules while preserving `index.mjs` exports and public command behavior.
9. Move provider home-option routing and inventory/bundled/session/desktop-cache
   observation policy into validated host profiles, then make status collection
   a host-neutral interpreter of those policies.
10. Extract host, surface, and scope resolution into one private lifecycle
    module, migrate status and plan composition to it, and preserve the public
    lifecycle export surface and command behavior.
11. Extract human rendering and declarative plugin leaf definitions, replace
    command-specific CLI branches with one descriptor dispatcher, and enforce
    parity with the root command registry.
12. Extract status-row construction, local verification, evidence shaping, and
    model validation; route both inventory success and failure through the same
    factory and leave status core responsible only for collection, ordering,
    aggregation, and command-level summaries.
13. Extract lifecycle-plan transition policy, typed step materialization,
    deterministic summaries, and complete model validation into one private
    plan-model factory; leave plan core responsible only for action validation,
    target resolution, local observation, and delegation.
14. Extract the local host-profile vocabulary and validator, make every builder
    fail fast and deeply freeze its result, and reduce aggregate registry
    validation to delegation plus cross-profile identity uniqueness.
15. Move shared lifecycle plugin, target, diagnostic, and assertion primitives
    into the existing private model owner; migrate status-row and plan-model
    validators without changing their emitted JSON or public exports.

## Test and Review Evidence

- **PLG-AC-1/2/3/4/6/8:** run focused host-support, plugin-lifecycle, doctor,
  agent-customize, and no-write fixture tests using isolated homes and injected
  host discovery. Include secondary-root isolation, foreign-workspace records,
  unsupported scopes, per-surface evidence, provider project scope, inventory
  failure, independent static-surface collection and discovery, absent
  executable, workspace-bound plans, locale-independent plan
  ids, Windows `PATHEXT`, and POSIX executable-permission regressions.
- **PLG-AC-5:** run root CLI tests for help-only behavior, strict arguments,
  leaf metadata, JSON bootstrap positions, stdout purity, exit mapping, and
  unknown command/surface/scope diagnostics. Rebase the command registry and
  fixtures on the target branch's leaf-path contract before regenerating root
  inventory hashes.
- **PLG-AC-7:** run support-declaration, plugin-manifest, docs-entrypoint, docs
  site, and documentation-link tests; regenerate
  `docs/better-harness-doc-links.mmd` with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness`. Assert that
  installation, troubleshooting, adapter matrix, and Chinese mirrors do not
  advertise lifecycle commands marked unavailable by native evidence.
- **PLG-AC-1 through PLG-AC-8:** run `npm run pack:verify`, `npm test`,
  `git diff --check`, diff-stat inspection, and separate staged/unstaged checks.
- **PLG-AC-9:** test that each canonical host has exactly one independently
  importable profile module, profile construction remains validated, plugin and
  doctor parsers share one strict implementation, and all existing help/JSON/
  timeout/exit snapshots remain byte-compatible.
- **PLG-AC-10:** enforce an implementation-free public `index.mjs`, prohibit
  cross-capability imports of private lifecycle modules, and rerun identity,
  status, verification, plan, doctor, and root CLI contract suites.
- **PLG-AC-11:** assert that every surface declares a supported observation
  kind and discovery source, profile home routing is validated, and
  `status-core.mjs` contains no
  canonical host ids or provider-home lookup table; preserve frozen status,
  verify, doctor, JSON, exit, and plan behavior.
- **PLG-AC-12:** cover aliases, all/auto/missing hosts, multi-surface hosts,
  unknown surfaces, valid and invalid scopes, and exact usage diagnostics;
  statically prevent status/plan cores from importing host-support lookup APIs
  or owning target-resolution error codes.
- **PLG-AC-13:** snapshot the definition set against root plugin subcommands,
  validate every executor/renderer/positional contract, prohibit command-name
  conditionals in `plugin-lifecycle/cli.mjs`, allow only the root registry to
  import the metadata-only manifest directly, and rerun help, strict parsing,
  human rendering, JSON, OpenCLI, and failure-channel contracts.
- **PLG-AC-14:** validate every emitted row from all hosts, corrupt each
  controlled state family in isolation, compare observed and inventory-failure
  row shapes, and statically prevent `status-core.mjs` from owning row-level
  verification, evidence, or complete schema literals.
- **PLG-AC-15:** validate install plans for every host surface and each
  install/update/remove policy lane, corrupt controlled plan states, digests,
  summaries, targets, diagnostics, and step effects independently, and
  statically prevent `plan-core.mjs` from owning transition policy, step
  materialization, or complete plan schema literals.
- **PLG-AC-16:** directly construct invalid host, surface, lifecycle, evidence,
  shell, host-command, manual, and desktop-UI declarations and require local
  failure; attempt nested mutation in strict modules; independently import all
  host modules; corrupt aggregate ids and aliases; and statically prevent the
  registry facade from duplicating local profile schema validation.
- **PLG-AC-17:** validate both plugin version-field variants, base and
  expected-source targets, diagnostic shape/severity, and controlled values;
  rerun status/plan corruption suites and statically require both validators to
  import the shared primitives while prohibiting private helper copies and new
  public lifecycle exports.
- The redacted native help summary in
  `test/fixtures/plugin-lifecycle/native-help-contracts.v1.json` is supporting
  macOS contract evidence, not a cross-platform native smoke receipt. Pi native
  executable evidence remains unobserved. The fixture separately records the
  installed, versioned, redacted `@earendil-works/pi-coding-agent@0.83.0`
  package-source contracts for persistent settings and temporary `-e` loading;
  that source inspection is not a live native smoke. Cursor/Qoder command drift
  stays fail-closed where their complete install contracts are not independently
  verified.

### Observed implementation evidence

- `node --test` focused lifecycle, doctor, root CLI, support-declaration, and
  frozen-contract suites passed after implementation.
- Documentation, bilingual site, manifest, and host-artifact focused suites
  passed; the generated Skill documentation graph is current.
- Pi persistent/session surface separation, per-surface discovery ownership,
  lifecycle/profile/doctor/CLI architecture, and provider regressions passed
  `171/171`; documentation, link, and frozen script contracts passed `32/32`.
- Focused lifecycle, architecture, root CLI, support-declaration, and doc-link
  suites passed `213/213` after the final Pi surface, discovery-isolation,
  provenance, and shell-neutral rendering regressions landed; the regenerated
  documentation graph passed `6/6`.
- `npm test` passed `1163/1163`; `npm run pack:verify` passed with 401 npm
  entries and 424 runtime zip entries; `git diff HEAD --check` passed.
- Local read-only smoke checks returned one JSON document for status, verify,
  and doctor across eight hosts (`11` surface rows and `8` doctor targets), with
  expected partial exit `2` and no absolute `/Users/phodal` output. The Qwen
  install-plan smoke separately proved mutation steps use
  `external/host-plugin-state`, verification steps use
  `read-only/host-observation`, and command-envelope side effects remain
  `read-only`.
- Review Readiness found no Story token or external tracker evidence; this spec
  is the confirmed local intent/acceptance source. ADR-0002 remains proposed,
  so the host-support declarations remain shadow profiles.
- Review Readiness initially found that the staged snapshot predated the
  working-tree refactor and failed `git diff --cached --check`. The intended
  working tree was explicitly restaged, the staged check passed, and the
  delivery branch was rebased onto the current `origin/main` before PR
  creation. The upstream leaf-command-path contract remains integrated and
  covered by the root CLI tests.
- PLG-AC-9 focused tests prove one importable module per host, fail-fast profile
  constructors, and one parser/runner shared by plugin and doctor while frozen
  help, command inventory, and OpenCLI outputs remain unchanged.
- PLG-AC-10 focused tests prove the lifecycle public index contains only stable
  re-exports, private concern modules stay behind that boundary, and external
  capabilities do not couple to lifecycle implementation modules.
- PLG-AC-11 focused tests prove every host home option and surface observation
  policy is validated profile data, while status contains no canonical host id,
  provider-home table, or provider-specific discovery diagnostic.
- PLG-AC-12 focused tests prove all seven target-related usage codes have one
  private owner, aliases/surfaces/scopes preserve exact diagnostics, and invalid
  status targets fail before host inventory collection.
- PLG-AC-13 focused tests prove one import-free manifest projects directly into
  root discovery without loading the lifecycle runtime and into exact runtime
  bindings, the plugin CLI has no leaf-name conditionals, and extracted human
  status/plan output remains byte-stable.
- PLG-AC-14 focused tests prove observed and inventory-failure paths share one
  complete status-row factory and validator, every controlled state family is
  rejected when corrupted, all eleven host-surface rows validate, and the status
  core no longer owns row-level schema, evidence, or verification construction.
- PLG-AC-15 focused tests validate all 66 host-surface/action/precondition
  combinations, reject controlled state, summary, target, diagnostic, step,
  recovery, and digest corruption, enforce manifest/action parity, and prove
  the plan core no longer owns transition, step-materialization, or schema
  construction.
- PLG-AC-16 focused tests prove malformed evidence and every typed instruction
  fail locally, actionable/manual operation evidence is mandatory, lifecycle
  keys and scopes are exact, structural fields cannot be overridden, nested
  declarations are frozen, all eight host modules validate independently, and
  aggregate validation owns only duplicate host-id and alias conflicts.
- PLG-AC-17 focused tests prove both version-field variants and base/expected-
  source targets share one validator, diagnostic arrays use one severity
  vocabulary, status-row and plan-model contain no private assertion or
  diagnostic-severity copies, and the exact public lifecycle exports remain
  unchanged.

## Risks and Review Focus

- Host inventories use different identifiers and scopes; false-positive
  display-name matching could report or plan against the wrong plugin.
- Installed files do not prove a host loaded the Skill. Verification must remain
  partial unless activation evidence exists.
- Native argv contracts can become stale as host CLIs evolve. Human output must
  preserve them as non-shell JSON data, and a plan step is executable only when
  its declared native-contract evidence is current.
- The new host-support surface must not silently replace the canonical adapter
  matrix while ADR-0002 remains proposed.
- Paths and command rendering must remain portable across Windows, macOS, and
  Linux without shell-string execution.
