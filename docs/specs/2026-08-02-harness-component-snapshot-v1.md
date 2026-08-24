# Freeze Project Harness Components for Qoder

## Traceability

- Spec ID: `harness-component-snapshot-v1`
- Roadmap: `LC-02`
- Status: Implemented
- AI involvement: Codex (GPT 5.6 Sol), implementation; Codex (GPT 5.6 Terra), independent review

## Intent

Give maintainers and later loop capabilities a deterministic, privacy-safe way
to identify the exact project-owned Qoder Rules, Skills, Hooks, Commands, and
Workflows that existed at one observation boundary. A versioned snapshot and
bounded diff must distinguish component identity, content revision, and
activation evidence so later evaluation or intervention work can bind to facts
without treating configured presence as observed use.

This is the first read-only `LC-02` slice. It establishes one complete host
contract before generalizing across providers.

## Acceptance Scenarios

- **HCS-AC-1 (bounded Qoder inventory):** Given a workspace, snapshot creation
  uses Qoder's public project inventory for Rules, Skills, Hooks, and Commands,
  plus only `.qoder/workflows/` and `.agents/workflows/` for Workflows. User,
  plugin, inherited, runtime-cache, Memory, MCP, and subagent assets are out of
  scope and are neither collected nor completeness gates. The Qoder inventory
  request explicitly allowlists only Rules, Skills, Hooks, and Commands. Every
  supported kind reports `observed` coverage even when its result is empty.
  Malformed Hook JSON, user-home/project-root aliasing, unsupported
  symlinks, or a collector depth/count/probe overflow fails closed instead of
  silently claiming complete observation.
- **HCS-AC-2 (stable component identity):** Every component receives a stable,
  provider-, scope-, and population-qualified ID from `qoder`, `project`, a
  privacy-safe population reference, its kind, and a normalized
  workspace-relative route. Hook identity adds a digest of its event, matcher,
  and handler type plus an ordinal only for duplicate routing identities;
  declaration position belongs to revision evidence. Collector/component output
  ordering and host path separators do not affect identity. The safe default
  binds population to a hash of the canonical workspace boundary; callers use
  an explicit opaque population key when the same project must retain identity
  across relocation, drive letters, or operating systems.
- **HCS-AC-3 (separate evidence dimensions):** Content revision, identity, and
  activation are independent fields. File content, a bounded Skill tree, or a
  bounded hook configuration plus its workspace script determines a SHA-256
  revision. Hook command/script content and declaration order do not enter its
  routing identity; a routing tuple change is an identity change. Activation
  remains explicitly `unknown` with `unavailable` runtime evidence. File-backed
  provenance is `observed` and never claims execution.
- **HCS-AC-4 (privacy-safe frozen contract):** `HarnessComponentSnapshotV1` is
  deeply frozen, canonically ordered, versioned, content-addressed, and contains
  no raw component content, command text, secret values, or absolute workspace
  or user-home paths. Symlink or relative-path escapes fail closed. Evidence
  reads reuse one canonical workspace boundary scoped to the current snapshot;
  they do not retain caller paths in a process-lifetime cache.
- **HCS-AC-5 (minimal graph):** Each component has one typed `declared-in`
  relationship to its privacy-safe workspace artifact reference. Relationship
  validation rejects unknown component IDs, absolute targets, and mismatched
  provenance instead of inferring semantic dependencies. In v1 this set is fully
  derivable from `components`; it stays a serialized, validated field because the
  typed relationship shape is the extension point for later relationship types,
  so adding one must not be a breaking schema change.
- **HCS-AC-6 (tamper-safe validation):** Validation recomputes component
  identity, relationship integrity, rollback references, ordering, and the
  snapshot digest. Stale or edited snapshots fail with stable diagnostic codes.
- **HCS-AC-7 (bounded diff):** Two valid snapshots from the same provider and
  scope and exact population reference produce deterministic `added`, `removed`, `changed`, and `unchanged`
  counts. Revision changes are named `content`; route identity changes appear
  as one removal and one addition. Activation and provenance remain fixed,
  explicit evidence dimensions in this v1 producer and therefore cannot be
  reported as changed without a future contract revision. Counts always describe
  every component, while returned entries obey an explicit bounded limit and
  report truncation. Entries order `changed`, `added`, and `removed` before
  `unchanged`, then by canonical component ID, so a small limit cannot hide the
  actual differences behind redundant unchanged entries. Different populations
  fail closed.
- **HCS-AC-8 (non-authorizing rollback reference):** Every component exposes a
  parseable reference binding provider, scope, population-qualified component
  ID, and revision.
  Resolution requires a valid matching snapshot and returns
  `mutationAuthorized: false`; it does not read prior content or execute a
  restore.
- **HCS-AC-9 (public automation surface):** A capability-owned public
  `index.mjs` exports create, validate, diff, parse, and rollback-resolution
  functions. A strict `cli.mjs` exposes `create`, optional opaque
  `--population-key`, `validate`, `diff`, and `resolve` with parser-safe JSON
  stdout and usage/runtime failures on stderr. Runtime diagnostics expose a
  stable code without echoing caller-selected paths or untrusted snapshot
  fields. Usage diagnostics name the specific failure reason and may name an
  allowlisted flag, but never echo an unrecognized command, unrecognized option,
  or any option value, because those are caller-supplied argv that can hold a
  private path. Public API failures use stable sanitized messages without
  appending filesystem or parser error details. Global and leaf help remain
  help-only human text and do not inspect a workspace.
- **HCS-AC-10 (portable evidence):** Fixtures cover Windows, macOS, and Linux
  route forms, stable input ordering, provider/scope isolation, secret and home
  sentinels, hook activation, tampering, bounded diff states, and rollback
  resolution. Package verification and the full test suite remain green apart
  from already-known environment-specific failures recorded as evidence.

## Non-goals

- Supporting providers other than Qoder, user/global assets, installed plugins,
  inherited assets, MCPs, Memories, or subagents.
- Inferring runtime activation, observed use, causal impact, semantic
  dependencies, or cross-component invocation from configured presence.
- Storing raw component bodies, hook commands, environment values, absolute
  homes, transcripts, prompts, or private Memory content.
- Creating a graph database, trace runner, scheduler, evaluator, automatic
  reviewer, mutation planner, apply command, or rollback executor.
- Registering a new root `better-harness` command. The v1 slice remains an
  atomic capability-owned direct CLI; root command naming, audience, and
  discovery integration are an explicit follow-up decision.
- Reusing `plugin-lifecycle` identity, contract, runtime, or host-support APIs.
  A future adapter may project accepted lifecycle observations into this
  component contract only after their evidence semantics are reviewed.

## Plan and Tasks

1. Add `scripts/harness-component-snapshot/` as the atomic owner, with a
   versioned capability-private contract, canonical hashing, path safety,
   snapshot assembly, bounded diff, rollback-reference resolution, public
   exports, and a direct CLI.
2. Compose Qoder Rules, Skills, Hooks, and Commands through an explicit project
   collection allowlist on `scripts/agent-customize/index.mjs`. Add a narrow
   Qoder workflow collector locally because the existing cross-provider
   practices inventory groups unrelated host workflow roots and has no
   workflow-only public API.
3. Use one snapshot-scoped canonical workspace read context, workspace-relative
   artifact references, population references, and SHA-256 digests only. Keep
   activation unavailable and provenance file-backed; make unsupported or
   escaped evidence a hard failure.
4. Add fixture-driven contract and CLI tests. Test route normalization as a pure
   boundary so Windows/macOS/Linux behavior is reproducible on every CI host.
5. Run focused tests, documentation-link validation, package verification, and
   the full suite. Perform a Change Traceability Review Readiness Check before
   handoff.

### Boundary with the plugin lifecycle control plane

The merged plugin lifecycle control plane describes installation, discovery,
enablement, version relation, and read-only mutation plans for the Better
Harness plugin itself across multiple hosts. This spec instead snapshots
project-owned Qoder harness assets. It does not reuse plugin identity, expose
host-support profiles, claim lifecycle/runtime state, or modify the root CLI
registry. The only intentional conceptual seam is a future explicit adapter
from accepted host evidence to the component snapshot contract.

## Test and Review Evidence

- **HCS-AC-1..5:** `node --test test/harness-component-snapshot.test.mjs`
  validates inventory filtering, IDs, revisions, graph edges, privacy, deep
  freezing, ordering, and path fixtures.
- **HCS-AC-6..8:** The same focused test injects stale digests, edited fields,
  unknown relationships, population mismatch, all diff states, limits, and
  rollback-reference mismatches.
- **HCS-AC-9:** `node --test test/harness-component-snapshot-cli.test.mjs`
  verifies help, strict parsing, JSON stdout, path-safe stderr failures, and all
  four direct CLI operations. A dedicated case asserts that usage failures name
  an allowlisted flag while never echoing an unrecognized command, unrecognized
  option, or option value. Contract tests also verify that malformed Hook
  input cannot expose parser details, caller paths, or private sentinels through
  the public API error message.
- **HCS-AC-10:** `node --test test/doc-link-graph.test.mjs`,
  `npm run pack:verify`, and `npm test` provide documentation, distribution, and
  repository-wide regression evidence.
- **Observed evidence (2026-08-05):** On the rebased final tree, the focused
  contract/CLI run passed 21 tests with 0 failures and 0 skips; documentation-
  link validation passed 6/6. The repository-wide run passed 1,288, failed 0,
  and skipped 1 existing platform-specific case. Package verification passed
  with 458 npm and 480 runtime-zip entries. An independent Terra contract and
  adversarial review ended with no P1/P2 findings after the Qoder collection
  allowlist, path-safe CLI diagnostics, tilde-home alias guard, architecture
  routing, and Windows drive-relative route fixes were applied. Copilot review
  follow-up additionally replaced per-read workspace-root resolution with a
  snapshot-scoped boundary and removed parser/filesystem details from public
  Hook configuration errors.
- **Post-merge review follow-up (2026-08-05):** A maintainer review after the
  merge of pull request 69 corrected the observed repository-wide count above: on
  the merged tree the run reports 1,289 passing with 0 failures and 0 skips on
  macOS, not 1,288 passing with 1 skip. Four review findings were then applied on
  `main`: bounded diff entries
  now order significant statuses before `unchanged`; usage diagnostics name their
  reason and any allowlisted flag; the v1 relationship redundancy and its
  extension-point rationale are recorded in `contract.mjs` and HCS-AC-5; and
  `.gitignore` re-includes `test/fixtures/**/.qoder/` so fixture assets are no
  longer invisible to `git status`. Re-verification passed 1,290 tests with 0
  failures and 0 skips, documentation links 6/6, and package verification at 458
  npm and 480 runtime-zip entries.
- **Deferred review findings (2026-08-05):** Two findings remain open rather than
  fixed here, because each is a design decision beyond this slice. Symbolic-link
  tolerance is inconsistent: probed collector roots and Skill trees reject any
  symlink, while `workspaceFileEvidence` accepts one whose realpath stays inside
  the workspace. `assertProjectReadBoundaries` also hard-codes the read surface of
  `qoderWorkspaceRuleSources`, so a new rule source added in `agent-customize`
  would silently narrow the fail-closed guarantee without failing a test.
- **Risk — privacy:** A route or source field could expose an absolute home.
  Mitigation: accept only normalized workspace-relative routes and serialize
  no inventory path fields.
- **Risk — false activation:** Configured assets could be presented as used.
  Mitigation: freeze `activation.state = unknown` and
  `activation.evidenceState = unavailable` in this version.
- **Risk — unstable hook identity:** Hook array reordering changes registration
  positions but retains each distinct routing identity; revisions change because
  order can affect execution. Editing the event, matcher, or handler type is an
  identity change. Inserting or removing indistinguishable duplicate routing
  declarations may renumber only those duplicates. Tests separately cover
  irrelevant collector ordering and meaningful hook declaration reordering.
- **Risk — project relocation:** Default population identity deliberately binds
  to the canonical workspace boundary so unrelated projects with identical
  files cannot cross-diff or resolve rollback references. Repositories that
  relocate or compare across operating systems must provide the same opaque
  population key; only its domain-separated digest enters artifacts.
- **Risk — line-ending normalization across operating systems:** A revision is a
  digest of raw file bytes, so the same commit checked out with `core.autocrlf`
  on Windows and with LF on Linux produces different revisions for every text
  component. A cross-operating-system diff that shares one explicit
  `--population-key` would then report each component as a `content` change.
  Mitigation for this repository: `.gitattributes` pins `eol=lf` for `.md`,
  `.json`, `.mjs`, `.js`, `.yaml`, and `.yml`. Snapshotted consumer projects
  carry no such guarantee, so cross-operating-system comparison requires a
  matching checkout normalization; byte-identical revisions are not claimed
  across differing line-ending configurations.
- **Risk — incomplete rollback:** A privacy-safe snapshot cannot itself restore
  omitted source bytes. The v1 reference is resolvable and non-authorizing;
  executable restore remains gated on a future content-store or Git provenance
  contract.
- **Risk — boundedness:** Snapshot assembly rejects more than 20,000 component
  descriptors before starting evidence reads and processes accepted populations
  with eight workers. All evidence workers share one canonical workspace root
  scoped to that snapshot, so an input near the limit cannot create unbounded
  root-resolution I/O, process-lifetime cache growth, or in-flight content
  buffers.
- **Risk — root CLI drift:** The merged lifecycle work established a richer root
  command registry after this slice was designed. Mitigation: keep the v1
  entrypoint capability-local and leave root registry/help untouched until a
  separately reviewed command name, audience, and discovery contract is chosen.
