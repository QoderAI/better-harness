# Monorepo and Workspace Support for Better Harness Evidence Collection

## Traceability

- Spec ID: `2026-07-25-monorepo-workspace-support`
- Status: Implemented and locally validated through AC15.
- Implementation branch: `feat/monorepo-workspace-topology`
- Story: unavailable; this is a maintainer-requested product correctness change.
- AI involvement: Codex implemented the change and used independent delegated
  reviews; all conclusions below are backed by local source and test evidence.
- Spike target: representative VS Code-fork monorepo with one Git root, no
  `package.json#workspaces`, convention packages under `extensions/*`,
  `src/product`, `native/*`, `cli`, and tracked source under `build/`.

## Intent

`/better-harness` currently treats `--workspace <target>` as one flat project.
On a monorepo the asset, session, project, and lead-report paths can disagree
about the analyzed target. That can omit inherited Agent assets, include ignored
artifact copies, attribute sibling-package activity to the target package, widen
Git evidence to the entire repository, or route a repair to the wrong owner.

Make workspace topology a frozen, versioned foundation of every Evidence Bundle.
One bundle still analyzes one requested target, but every collector and the final
lead report must use the same target identity, path scope, ownership coordinates,
coverage state, and truncation state.

## Spike Evidence

The 2026-07-25 spike found:

| ID | Probe | Observed gap |
|----|-------|--------------|
| E1 | `asset-baseline --workspace <root>` with Qoder | Nested `AGENTS.md` files were not represented in the effective asset baseline. |
| E2 | `discoverAgentEntrypoints` with Codex | The filesystem walk included ignored `.build/**` and `out*/**` copies, skipped tracked `build/**` source, and had no file cap. |
| E3 | Package-target asset baseline | Root instructions and provider assets disappeared because owner routes outside the requested workspace were discarded. |
| E4 | Provider session matching | Matching was based on direct CWD prefixes. Package targets missed root-CWD sessions, while admitting a whole mixed session would contaminate package facts. |
| E5 | `core-change-watch` | `resolveRepoRoot` widened tracked files, history, diff, drift, and companion candidates to the whole repository. |
| E6 | Evidence Bundle lead | Specialist lanes and the lead analyzer independently rescanned the same flat workspace, so fixing only the lanes would not fix the final report. |
| E7 | Finding validation | Durable finding contracts did not contain a structured target/package route, while rejecting unsupported fields. |

The representative repository contains tracked guides below `extensions/*`,
`src/product/**`, `native/*`, and `.ci/`; root `AGENTS.md`/`CLAUDE.md` and root
provider assets; ignored copies below `.build/**` and `out*/**`; and tracked
source below `build/**`.

## Contract Decisions

### Public owner

`scripts/workspace-topology/` is an atomic public capability. It owns:

- `index.mjs`: public programmatic resolver and validators;
- `contract.mjs`: versioned runtime shape and normalization;
- `cli.mjs`: parser-safe diagnostic CLI;
- capability-local discovery helpers and tests.

Consumers import only `scripts/workspace-topology/index.mjs`; they do not import
private discovery helpers. Evidence Bundle resolves topology once and freezes it
in the context. Direct diagnostic commands call the same public resolver when a
validated frozen topology was not supplied.

### Canonical path coordinates

- All Git-backed `route` values are Git-root-relative POSIX paths.
- `"."` denotes the Git root.
- `requestedWorkspace` and `gitRoot` are normalized absolute paths.
- `target.route` is the exact requested route.
- `target.memberRoute` is the owning member boundary when one exists.
- `localRoute` is relative to the requested workspace and is never substituted
  for an owner route.
- Containment uses path segments and real paths; sibling prefixes, `..`, and
  symlink escapes do not match.

### Workspace topology

The version 1 shape is:

```text
kind: better-harness.workspace-topology
schemaVersion: 1
status: complete | partial
requestedWorkspace
gitRoot: absolute-path | null
target:
  kind: repo-root | workspace-member | repo-subtree | standalone
  route: git-root-relative route | "."
  memberRoute: git-root-relative route | null
  memberMatch: exact | descendant | none
members:
  items[]:
    route
    kind: manifest | convention
    discoveredBy[]
    manifestRoute: route | null
  total
  omitted
  truncated
instructionScopes:
  items[]:
    route
    provider
    activation: effective | candidate
  total
  omitted
  truncated
discovery:
  inventoryMode: git | filesystem-fallback
  ignoreMode: git-index | static
  tracked
  untracked
  scanned
  omitted
  truncated
  warnings[]
```

`analysisScope` is derived and frozen next to topology in the Evidence Bundle
context:

```text
kind: repo | path
route
pathspecs[]
```

Lane observations such as `inheritedAssets`, `ignoredArtifacts`,
`pathScopedHistory`, and `sessionWorkspaceMatch` do not belong in structural
topology. Each lane reports a `scopeAttribution` and its own coverage envelope
against the frozen topology.

### Member discovery

Member discovery is deterministic:

1. Prefer explicit workspace manifests:
   `package.json#workspaces`, `pnpm-workspace.yaml`, `go.work`, and Cargo
   `[workspace].members`.
2. Expand only existing paths contained by the Git root. Apply manifest
   exclusions where the manifest format supports them.
3. A nested package manifest not already covered by an explicit workspace can
   provide a convention member.
4. Tracked instruction files are instruction scopes, not package boundaries.
   They provide a package fallback only inside recognized package containers
   (`packages/*`, `apps/*`, `extensions/*`, `plugins/*`, `services/*`,
   `native/*`, `src/product`, and the exact root `cli`) or a directory with a
   package manifest. Tracked `build/**` remains source but is not a member
   boundary unless a manifest establishes it.
5. Hidden operational directories such as `.ci` remain instruction scopes.
6. Normalize duplicates, prefer manifest evidence over convention evidence, and
   use the longest containing member route for target ownership.
7. A Git subdirectory without a member boundary is `repo-subtree`, not
   `standalone`.
8. `members.items` is stable-sorted. The target member is always retained when
   bounded output truncates other members.

### Inventory and ignored/generated classification

In a Git repository, discovery uses tracked files plus untracked, non-ignored
files (`git ls-files --cached --others --exclude-standard`). Inventory records
tracked versus untracked provenance. A tracked path is not classified as
generated solely because a path segment is named `build`, `dist`, or `out`.
Ignored files are excluded from normal evidence.

Filesystem fallback preserves static exclusions and emits
`inventoryMode: "filesystem-fallback"`. Every bounded collection reports stable
ordering, `total`, `omitted`, and `truncated`. If truncation can hide a member,
instruction owner, or target activity, normal-depth bundles fail closed and
quick bundles are at least partial.

### Agent asset activation

Discovery and activation are separate:

- every tracked instruction asset may be inventoried with an owner route;
- `activation: "effective"` requires provider-specific semantics;
- unsupported or unverified nested instructions remain `candidate` and cannot
  be presented as active inherited policy.

The initial capability matrix follows the current provider contracts:

| Provider | Effective instruction ancestry |
|----------|--------------------------------|
| Codex | Root-to-target `AGENTS.md` ancestry. |
| Claude | Ancestor `CLAUDE.md`; descendant instructions remain on-demand/candidate until file activity establishes their scope. |
| Cursor | Scoped `.cursor/rules`; nested `AGENTS.md` and root Copilot instructions remain candidate unless the installed provider contract proves activation. |
| Qoder | Root project `AGENTS.md` and project Rules; nested `AGENTS.md` remains candidate unless the installed provider contract proves activation. |
| Qwen Code | Root-to-target `QWEN.md` and `AGENTS.md` ancestry. |
| GitHub Copilot | Root-to-target `AGENTS.md` ancestry and root `.github/copilot-instructions.md`; path-scoped `.github/instructions/*.instructions.md` remains candidate until `applyTo` matching is represented structurally. |
| Pi | Root-to-target `AGENTS.md` ancestry. |

Assets preserve both ownership and applicability:

```text
originRoute
originScope: project | inherited
effectiveTarget
localRoute
activation
```

### Session attribution

Session bridging is fail-closed:

1. Direct package CWD matching keeps existing behavior and is labelled
   `direct-cwd`.
2. Only a session whose CWD is exactly `gitRoot` can become a root-CWD
   candidate for a package target.
3. Provider discovery includes both package and Git-root transcript identities
   before session selection.
4. A bounded preflight extracts only trusted file/tool path facts before
   selection. Prompt prose is not treated as path evidence.
5. Root-CWD candidates are included only when they contain positive target
   activity, contain no sibling-package activity, and were not truncated.
6. Hydrated events are checked again. A mixed, ambiguous, or newly truncated
   root-CWD session is omitted as a whole; version 1 does not slice events into
   package-owned facts.
7. Diagnostics expose aggregate omitted counts without leaking absolute paths
   or session identifiers.

### Durable findings and repair routing

Agent Work Loop report contract version 26 introduces the durable finding
target:

```text
target:
  kind: repo-root | workspace-member | repo-subtree | standalone
  packageRoute: route | null
  ownerRoute: route | null
```

Existing report contracts 1–25 without `target` remain readable. Version 26 or
newer package-scoped findings must carry `target` with a non-null `ownerRoute`;
validators reject partial topology and any package, kind, owner, or workspace
mismatch. A present `target`, including `null`, is never treated as legacy.
Renderers and finding-bound repair flows preserve the structure rather than
reconstructing it from prose. For structured findings, `Project`
`actualOutput.path` is Git-root-relative (standalone-workspace-relative when no
Git root exists), so an inherited root owner remains openable without `..`.

## Acceptance Scenarios

- **AC1 — Topology resolution:** Root, member, repository-subtree, and
  standalone targets resolve to the versioned topology shape with canonical
  routes and deterministic ownership.
- **AC2 — Member discovery:** Supported workspace manifests and convention
  fallback produce stable, de-duplicated members with provenance. Instruction
  scopes such as `.ci/AGENTS.md` do not create false packages.
- **AC3 — Bounded Git-aware inventory:** Tracked and untracked non-ignored
  files are considered; ignored copies are excluded; every cap reports
  `total`, `omitted`, and `truncated`; filesystem fallback is explicit.
- **AC4 — Asset ownership and activation:** Root-target discovery inventories
  nested guides with owner routes. Package-target baselines retain the ordered
  root-to-target inheritance chain without double counting and distinguish
  effective from candidate assets.
- **AC5 — Session bridging:** All supported providers retain direct-CWD behavior,
  discover root-CWD candidates before selection, include target-only activity as
  `root-cwd`, and omit mixed, ambiguous, or truncated candidates from package
  facts.
- **AC6 — Scoped project evidence:** Package and repo-subtree targets apply one
  literal path scope to project profile, history, core candidates, diff,
  untracked files, drift companions, recommendations, and returned paths.
- **AC7 — Tracked source classification:** Tracked `build/**` source remains
  eligible while ignored `.build/**` and `out*/**` copies remain excluded.
- **AC8 — Frozen composition:** Evidence Bundle resolves topology once. Session,
  project, customize, and lead analysis consume the same validated topology and
  analysis scope without independently widening it.
- **AC9 — Finding route:** Package-scoped findings preserve a structured route
  through candidate projection, validation, report rendering, persistence, and
  finding-bound repair.
- **AC10 — Coverage propagation:** Missing or truncated topology/session/asset
  ownership evidence makes normal bundles failed and quick bundles partial; no
  collector claims complete coverage after a relevant cap.
- **AC11 — Cross-platform CLI:** `workspace-topology --workspace <path> --json`
  is parser-safe and behaves consistently on Windows, macOS, and Linux path
  conventions.
- **AC12 — Skill contract:** `/better-harness` Step 1 states the resolved target
  kind and route, and instructs repairs to use the finding owner route.
- **AC13 — Canonical path and flag identity:** Analysis scope and render target
  checks treat real-path aliases, including Windows 8.3/long-name variants and
  symlinks, as one filesystem identity without changing stable public routes.
  `workspace-topology` parses `--json=<true|false>` and
  `--help=<true|false>` as booleans and rejects unsupported boolean values.
- **AC14 — Supported-host topology parity:** Every provider accepted by the
  Evidence Bundle and report pipeline retains its applicable instruction
  inventory and consumes the frozen topology for package session attribution.
  Syncing a newly supported host from `main` must not silently restore flat-CWD
  collection or return an empty topology-backed instruction graph.
- **AC15 — Frozen binding and hermetic fixtures:** Topology validation proves
  that `target.route` resolves from `gitRoot` to `requestedWorkspace`, and the
  Evidence Bundle accepts only the exact analysis scope derived from that
  topology. Git-backed fixtures produce the same tracked instruction inventory
  when a developer has global ignore rules such as `*.local.md`.

## Non-goals

- No automatic fan-out report across every member; one bundle analyzes one
  requested target.
- No event-level splitting of mixed root-CWD sessions in version 1.
- No new Coding Agent provider and no Memory/authority-model change.
- No nested Git repository, submodule ownership, or cross-repository topology.
- No general-purpose package-manager implementation beyond member discovery.
- No mutation of ignored artifacts and no inference of active provider rules
  from file names alone.

## Plan and Tasks

### Slice 0 — Contract and fixture

- Tighten this spec and remove stale provider naming.
- Add a representative temporary-Git fixture builder covering manifests,
  convention members, nested instructions, ignored copies, tracked
  `build/**`, noisy siblings, and special-character routes.
- Add topology contract and CLI tests before consumer integration.

### Slice 1 — Public topology capability

- Add `scripts/workspace-topology/{index,contract,cli}.mjs` and narrow discovery
  helpers.
- Resolve real paths, Git root, inventory, manifests, convention members,
  instruction scopes, target identity, coverage, and analysis scope.
- Register a maintainer/advanced CLI route only if the root CLI registry
  contract permits a diagnostic capability without broadening workflow help.

### Slice 2 — Static evidence integration

- Resolve and freeze topology in `evidence-bundle`.
- Pass the same context to session, project, customize, and lead analysis.
- Make Agent asset discovery Git-aware and bounded.
- Preserve origin/effective routes and inherited ancestry in inventory and
  baseline contracts.
- Thread analysis scope through every `core-change-watch` analyzer and make
  tracked provenance override basename-only generated heuristics.

### Slice 3 — Session attribution

- Add a shared workspace-match/qualification module.
- Expand provider source discovery to package and Git-root transcript
  identities.
- Run bounded target-path preflight before selection and recheck after
  hydration.
- Omit mixed/ambiguous root-CWD sessions and propagate privacy-safe diagnostics.

### Slice 4 — Finding and workflow routing

- Version the finding target contract with backward-compatible readers.
- Preserve target through specialist candidate projection, final report,
  renderer, persistence, and finding-bound repair.
- Update `skills/better-harness/SKILL.md` and routed references.
- Regenerate `docs/better-harness-doc-links.mmd`.

### Slice 5 — Verification and readiness

- Canonicalize both sides of filesystem-identity comparisons while keeping
  reader-visible workspace paths and Git routes deterministic.
- Add strict boolean parsing for the topology CLI and regression tests for
  explicit false values.
- Run AC-focused tests and all existing capability tests.
- Run `npm test`, `npm run pack:verify`, and `npm run preview`.
- Smoke-test `http://localhost:58575/health` and `/canvas-module.js`; inspect
  browser console/page errors when report rendering changes.
- Run Change Traceability Review in Review Readiness mode over the full local
  diff, including generated files and staged/unstaged separation.

### Slice 6 — Current-main review hardening

- Merge the current `main` host-adapter changes without dropping topology,
  report, fixture, or CLI contracts on either side of the conflict.
- Define topology instruction semantics for every currently supported host and
  make each session adapter bind the frozen workspace scope before discovery,
  qualification, and hydration.
- Validate topology/workspace/analysis-scope identity at the public contract
  boundary rather than relying on individual downstream consumers.
- Isolate temporary Git repositories from developer-global ignore rules when a
  fixture intentionally commits a normally local-only instruction file.

## Test and Review Evidence

| AC | Required automated evidence |
|----|-----------------------------|
| AC1–AC3, AC11 | `test/workspace-topology.test.mjs`, including root/member/subtree/standalone, manifest variants, ignored/untracked files, cap boundaries, symlink escape, special characters, and CLI JSON. |
| AC4 | Agent lint, agent customize, and asset baseline tests with root/intermediate/package assets, candidate activation, owner routes, and no duplicates. |
| AC5 | Shared matcher tests plus supported-provider root-CWD fixtures covering direct, target-only, no-target, mixed, truncated, and post-hydration foreign activity. |
| AC6–AC7 | Real temporary Git repository and command-spy tests covering history, diff, untracked, rename boundary, companions, noisy sibling, and tracked `build/**`. |
| AC8, AC10 | Evidence Bundle dependency-spy tests proving one topology resolution, object identity/binding, lead propagation, and partial/failed coverage. |
| AC9 | Finding schema, report projection, renderer, persistence, and wrong-package rejection tests. |
| AC12 | Skill contract assertions and doc-link graph validation. |
| AC13 | `test/core-change-watch-scope.test.mjs`, `test/harness-report-render-cli.test.mjs`, and `test/workspace-topology.test.mjs` covering canonical aliases, render target identity, and explicit boolean flag values. |
| AC14 | Topology-backed Agent lint and session-provider tests for Qwen Code, GitHub Copilot, and Pi, plus existing Qoder, Codex, Claude, and Cursor coverage. |
| AC15 | Negative topology/Evidence Bundle contract tests for mismatched routes and pathspecs; Git fixture tests run with a global `*.local.md` ignore rule. |

Baseline and final commands:

```bash
node --test test/workspace-topology.test.mjs
node --test test/agent-lint.test.mjs test/agent-asset-baseline.test.mjs
node --test test/core-change-watch.test.mjs
node --test test/session-workspace-match.test.mjs test/session-analysis-providers.test.mjs test/session-analysis.test.mjs
node --test test/better-harness-evidence-bundle.test.mjs
node --test test/doc-link-graph.test.mjs
npm test
npm run pack:verify
npm run preview
```

## Risks and Fail-closed Rules

- **Large repository inventory:** stream or bound discovery, stable-sort retained
  output, and surface omitted counts. Never silently claim complete coverage.
- **Provider storage drift:** isolate provider transcript-root expansion behind
  provider tests; unknown layouts remain unavailable rather than guessed.
- **Sparse path facts:** root-CWD bridging requires positive trusted activity.
  Sparse, ambiguous, mixed, or truncated evidence is omitted.
- **Path traversal and platform differences:** resolve real paths, use
  segment-safe containment, preserve argv arrays, and test Windows path
  normalization without shell strings.
- **Schema migration:** accept legacy findings for reading, emit the new target
  only when topology proves ownership, and reject cross-target repair.
- **Performance regression:** topology is resolved once per bundle and reused;
  direct diagnostic commands remain independently runnable.
- **Spec drift:** implementation slices must map changed modules and tests back
  to AC ids during Review Readiness.
- **Host drift:** the set of supported Evidence Bundle/report/session providers
  must stay aligned with topology instruction and workspace-match semantics;
  unsupported topology behavior fails unavailable instead of falling back to a
  flat workspace silently.
- **Injected context drift:** a caller-supplied topology or analysis scope is
  rejected unless its absolute target identity, route, kind, and literal Git
  pathspecs are the exact derived values.

## Evidence Log

- 2026-07-30 current-main hardening: merged `origin/main` and preserved both
  sides of the four overlapping report/session/test contracts. Topology and
  session attribution now cover Codex, Qoder, Claude, Cursor, Qwen Code,
  GitHub Copilot, and Pi. Frozen topology and analysis-scope mismatches fail
  closed, and temporary Git fixtures ignore developer-global Git configuration.
  The conflict-focused suite passed `58/58`, the expanded topology/session
  suite passed `62/62`, the broad affected suite passed `228/228`, and the
  default-environment full suite passed `977/977`. Pack verification passed
  with 331 npm and 354 runtime-zip entries, direct doc/Skill checks passed
  `18/18`, preview `/health` returned `ok`, and `/canvas-module.js` returned
  JavaScript with HTTP 200.
- 2026-07-30 review hardening: PR review identified non-canonical render target
  comparison and string-truthy boolean flags. Windows CI exposed 25 cascading
  failures where NTFS 8.3 and long-name paths represented the same temporary
  repository. AC13 now uses native real-path identity on both sides, preserves
  stable routes, and parses explicit boolean values strictly. Focused review
  and CI regressions passed `102/102`, the full suite passed `926/926`, pack
  verification passed with 316 npm and 342 runtime-zip entries, doc-link checks
  passed `6/6`, and both preview endpoints loaded. The Windows result remains
  external PR check evidence rather than a locally inferred claim.
- 2026-07-25: initial representative-monorepo spike recorded E1–E5.
- 2026-07-29: source audit added E6/E7 and found that provider session matchers
  are private, root transcript discovery precedes hydration, project scoping is
  distributed across analyzers, tracked `build/**` is still filtered, and the
  lead path independently rescans the workspace.
- 2026-07-29: three independent reviews all returned `fail` with uncleared
  P1/P2 findings. Their common blockers were root-CWD session contamination,
  missing durable owner routes, incomplete Git scoping, tracked-build
  misclassification, ambiguous member fallback, and missing truncation
  propagation.
- 2026-07-29 baseline: targeted evidence tests passed `101/101`; they validate
  existing flat-workspace behavior but do not cover AC1–AC12.
- 2026-07-29 implementation: AC-focused topology, scope, render, repair, asset,
  session, and bundle tests passed `156/156`. After syncing `origin/main`, the
  conflict-focused suite passed `34/34` and the full suite passed `924/924`.
- 2026-07-29 packaging and runtime: `npm run pack:verify` passed with 316 npm
  entries and 342 runtime-zip entries; preview `/health` returned `ok` and
  `/canvas-module.js` returned the transformed report module. The direct doc
  graph and Better Harness skill checks passed `18/18`.
- 2026-07-29 Review Readiness: Story is explicitly unavailable, this Spec maps
  AC1–AC12 to local tests, risk and AI markers are visible, `git diff --check`
  passes, no generated doc graph is stale, and the local diff remains one
  monorepo-support change without an unrelated staged/unstaged split.
