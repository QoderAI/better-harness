# Contributing a New Coding Agent Host

Adding a Coding Agent is not one manifest or one transcript parser. It is a set
of independently evidenced support claims: native discovery, configured assets,
session evidence, shared workflow activation, output routing, and packaging.
Implement only the slices the host can support, and mark every other slice as
partial or unavailable.

This guide is the canonical contribution workflow for a new host. Before editing,
read the repository [agent instructions](../../AGENTS.md),
[contribution guide](../../CONTRIBUTING.md),
[architecture principles](../ARCHITECTURE.md),
[directory ownership ADR](../adrs/directory-structure.md),
[community extension map](../community.md), and
[host adapter matrix](README.md). Current repository contracts take precedence
over the worked pull requests at the end of this guide.

## 1. Define the Support Claim

Start with a dated spec under `docs/specs/` as required by `AGENTS.md`. Give each
claimed slice a stable acceptance id and an evidence route. Use
`[NEEDS CLARIFICATION: ...]` instead of guessing a host contract.

| Slice | Decide explicitly | Canonical owner | Minimum evidence |
| --- | --- | --- | --- |
| Native contract | Host/version, primary source, supported lifecycle | Spec and PR evidence | Versioned official docs or host source |
| Shell and discovery | Native manifest, source-local shell, generated shell, or none | Thin host metadata root; generated artifacts under `scripts/packaging/` | Native install/link/discovery smoke or unavailable note |
| Configured assets | Available, partial, or unavailable scopes | `scripts/agent-customize/providers/<host>.mjs` | Sanitized fixtures plus bounded real-host inventory smoke |
| Session evidence | Available, partial, or unavailable fields/events | `scripts/session-analysis/platforms/<host>.mjs` | Deterministic fixtures plus workspace-qualified source/facts smoke |
| Shared registration | Which public commands accept the host | `scripts/host-support/` support slices plus capability-owned registries and CLIs | Catalog mapping, help, unknown-host, delegation, and bundle tests |
| Plugin lifecycle | Better Harness install/status/verify dispositions by native surface | `scripts/host-support/profiles/<host>.mjs` plus `scripts/plugin-lifecycle/` | Profile validation, redacted native-help evidence, deterministic plan, and read-only fixture tests |
| Output | Existing Canvas, HTML, Markdown, or a justified new mode | `templates/reporting/` and report routing | Validated render for the claimed mode |
| Packaging | npm metadata root, runtime bundle, source-only, or none | `package.json` and `scripts/npm-package/` | `npm run pack:verify` when shipped files change |
| Documentation | Positioning, paths, coverage, smoke, limitations | [host adapter matrix](README.md) and capability references | Link checks and commands matching observed behavior |

A shell does not prove configured-asset or session support. A session parser does
not prove the Skill is natively discoverable. Do not register one slice merely
to make another slice appear complete.

### Capability levels

Not every host lands with full end-to-end support. Be explicit about which of
these levels the contribution reaches, and do not promote a host to the next
level until the corresponding evidence exists:

| Level | What it means | Minimum evidence | Public visibility |
| --- | --- | --- | --- |
| Partial adapter | Some slices work (often shell, configured assets, or sessions) while others are partial or unavailable. | Spec names claimed, partial, and unavailable slices; provider/session tests pass for the claimed subset. | Matrix and docs list the host with explicit limitations; do not add to the public Quickstart list. |
| Verified install/discovery | The native install, link, or discovery command is smoke-tested and the Skill loads. | Native CLI smoke in an isolated home/config when possible; fallback is a pinned official doc reference plus a recorded evidence boundary. | README Installation section may list the host; still not Quickstart unless the report loop is validated. |
| Public Quickstart-ready | Full report loop works: install/discovery, configured assets, session evidence (when claimed), output routing, and a validated report render. | End-to-end report generation on a real or representative repository; tests cover the public-entrypoint set. | Host appears in the README Quickstart list, Docusaurus home-page cards, and installation tabs. |

A host can be merged at the partial or verified level and later promoted to
public Quickstart-ready once the report loop evidence is complete.

## 2. Verify the Native Host Contract

Do not derive a new host contract by renaming another adapter. Record the host
version and primary evidence in the spec or pull request, then verify the parts
that affect the proposed support:

- the native manifest filename, schema, discovery order, install/link command,
  and version rules;
- configuration, runtime, cache, and session roots, including environment and
  CLI override precedence;
- every primary and secondary configured-asset root the provider reads, such as
  a state database, shared client cache, or user-level compatibility directory,
  plus a redacted fallback label and its relocation below an isolated
  `--host-home`;
- workspace identity and path normalization for spaces, Unicode, punctuation,
  Windows drive letters, case differences, symlinks, and case-insensitive file
  systems;
- trust, extension enablement, configuration precedence, and inline settings
  that can add Skills, hooks, MCP servers, rules, or commands;
- session event shape, call/result correlation, terminal statuses, unknown
  event handling, compaction, subagent, permission, and usage fields;
- privacy boundaries: which fields are required for evidence, which may contain
  credentials or user content, and which must never leave the local machine.

Use real host data only for a bounded local smoke. Commit deterministic,
synthetic, and redacted fixtures; never commit raw transcripts, prompts,
credentials, tokens, or machine-specific absolute paths.

## 3. Keep the Host Shell Thin

Add a host metadata root only when the native host needs one. The shell may own
install and discovery metadata and pointers to canonical root Skills. It must
not copy product judgment, scoring, evidence rules, or report contracts out of
`skills/`, `models/`, `references/`, `templates/`, or capability-owned scripts.

When the shell ships in the public package, align its version with the package,
add it to the package whitelist and verifier, and prove native discovery with
the actual host CLI. Generated host artifacts remain validation/install output;
their canonical source belongs under `scripts/packaging/` after the matrix split
triggers justify a builder.

## 4. Add Configured-Asset Evidence

A provider under `scripts/agent-customize/providers/` should:

- keep Plugin, user, project, and inherited scopes distinct;
- follow native precedence and effective enablement rather than only checking
  whether a file or directory exists;
- include native inline configuration sources when the host supports them;
- honor documented CLI and environment overrides, including empty and malformed
  values, without silently falling back to unrelated data;
- emit metadata needed for review without serializing secret values or private
  file contents;
- remain deterministic and fail closed when identity, trust, or ownership is
  ambiguous.

Register the provider through its capability-owned index. Then trace the host id
through every public inventory, lint, evidence-bundle, help, and report path that
claims configured-asset support.

## 5. Add Session Evidence Only When It Is Defensible

A platform adapter under `scripts/session-analysis/platforms/` should qualify a
session to the requested workspace before it can influence a report. Normalize
only observed fields into the existing session contracts:

- preserve or explicitly account for unknown events instead of silently
  dropping them;
- represent missing token usage or lifecycle fields as unobserved, not zero;
- map cancelled, rejected, failed, and successful operations according to the
  host's native states;
- correlate calls and results with native ids and deterministic fallbacks;
- deduplicate canonical paths and session identities without double-reading the
  same file on a case-insensitive filesystem;
- keep partial transcript, metadata, and audit coverage visible in output.

If local sessions are unavailable, unstable, encrypted, or cannot be matched to
the workspace safely, document session evidence as unavailable. Shell or asset
support can still land independently.

## 6. Propagate the Host Identity Deliberately

Add stable identity, display, home-option, and independently evidenced support
slices to `scripts/host-support/index.mjs`. Do not claim every capability by
default: Kimi and Grok, for example, can remain absent from Checkup while their
configured-asset and session adapters are available.

Executable imports remain explicit in each capability. Register only the
provider, analyzer, report, or packaging slices backed by the spec and tests,
then search for host-specific native behavior that cannot be projected from the
catalog:

```bash
rg -n "<host-id>|<Host Display Name>" scripts test references templates docs package.json
```

Use the results as an inventory, not a replacement template. Typical capability
composition surfaces include:

- `scripts/host-support/profiles/<host>.mjs` for the lifecycle shadow profile;
  use `profile-builders.mjs` constructors, let `profile-model.mjs` validate and
  deeply freeze the declaration locally, and keep `profiles.mjs` as an
  import-only composition root. Do not defer a malformed profile to aggregate
  registry validation. Declare every provider primary and secondary
  `inventoryHomeRoutes` entry there with its option, isolated relative path, and
  redacted safe fallback; do not let a state file, shared cache, or compatibility
  root fall back to the real user home when `--host-home` is supplied. Declare
  the surface observation kind and discovery source (`executable`, `diagnostic`,
  or `unobserved`) there as well; do not let one surface inherit another
  surface's executable or provider-state evidence. Use `scopeArtifactPolicy: shared`
  only when versioned native evidence proves that scopes mutate one artifact,
  and declare `nativeHomeBinding` only when the cited native contract proves the
  environment or config override applies to the emitted steps. Otherwise an
  isolated mutation plan must fail closed and must not emit an unbound native
  verification step. Do not add a host-id branch to lifecycle status or a second
  target resolver to status/plan. Host work must not copy plugin leaf metadata
  into either the root registry or lifecycle CLI, or construct status rows
  outside the shared status-row factory. Do not construct lifecycle plans,
  duplicate transition policy, or label verification as a mutation outside the
  shared plan-model factory;
- `scripts/agent-customize/providers/index.mjs` and its public inventory CLI;
- `scripts/session-analysis/analyzer.mjs` and the platform loader/help contract;
- `scripts/harness-analysis/evidence-bundle/` provider validation and routing;
- report and output-mode composition roots whose support differs by host;
- host-native defaults, environment variables, state files, cache roots, and
  privacy predicates that do not belong in the stable identity catalog;
- package whitelists and manifest-version checks, when a shell ships;
- deterministic help snapshots and tests that intentionally lock the public
  host list.

Do not add a capability claim unless its executable composition and tests are
present. Catalog-derived gates must fail closed, and capability-mapping tests
must detect both a claimed slice without an implementation and an implementation
without a claim. Prefer a visible unsupported error over a host id that falls
through to another provider.

## 7. Build an Evidence Ladder

Map tests to the spec acceptance ids. At minimum, cover the risks that apply to
the host:

| Risk | Fixture or check |
| --- | --- |
| Invented native contract | Pinned source/doc reference plus native CLI smoke |
| Path mismatch | POSIX and Windows paths, spaces, Unicode, punctuation, case, symlink/canonical identity |
| Wrong home or precedence | CLI override, environment override, default, empty, and malformed cases |
| Foreign workspace evidence | Positive and negative workspace qualification fixtures |
| Lost or inflated events | Unknown events, missing fields, call/result correlation, every terminal status |
| Duplicate evidence | Canonical-path and case-insensitive deduplication fixture |
| Secret leakage | Credential-shaped fixture with value-level non-disclosure assertions |
| Packaging drift | Manifest presence/version assertions and `npm run pack:verify` |

During development, run focused provider, session, manifest, bundle, and CLI
tests. Before review, run the full repository suite. When Markdown is added or
moved, regenerate and verify the link graph:

```bash
node scripts/doc-link-graph/cli.mjs skills/better-harness
npx vitest run test/skills-docs/doc-link-graph.test.mjs
npm test
npm run pack:verify
git diff --check
```

Run `npm ci` and `npm run build` from `docs/` when the published site changes.
CI must cover Windows, macOS, and Linux for cross-platform paths or filesystem
behavior. A real-host smoke should separately prove native discovery, configured
assets, session source/facts when claimed, evidence-bundle propagation, and a
validated report render. Record unavailable checks honestly.

## 8. Document and Review the Delivered Boundary

Update the [host adapter matrix](README.md) with positioning, shell, configured
assets, session evidence, default output, rules/prompts, and a reproducible smoke
route. Add or update capability references for host-specific paths and evidence
limits. Add README installation instructions only after the native command has
been verified. Use a host-specific adapter page only when the matrix's split
triggers are met.

Before commit or review, use the
[Change Traceability Review](https://github.com/QoderAI/better-harness/blob/main/.agents/skills/change-traceability-review/SKILL.md)
in Review Readiness Check mode. The pull request should state:

- the host/version and primary contract evidence;
- the claimed and unavailable support slices;
- spec and acceptance ids, changed canonical owners, and explicit non-goals;
- exact focused, full-suite, native-smoke, cross-platform, and packaging results;
- privacy, compatibility, generated-file, rollback, and residual risks;
- AI involvement and the human verification performed.

Use the repository [pull request template](https://github.com/QoderAI/better-harness/blob/main/.github/pull_request_template.md).
Do not infer Story ids, AI involvement, CI status, or native compatibility from
branch names, prose, passing synthetic tests, or similarity to another host.

## Worked Pull Request Examples

These examples are review material, not templates to copy verbatim. Re-check
their latest diff and status before citing them.

- [PR #6: Qwen Code host adapter](https://github.com/QoderAI/better-harness/pull/6)
  shows why native source verification matters. Its review and follow-ups cover
  manifest identity, config/runtime roots, path sanitization, effective
  enablement, inline MCP/hooks, terminal statuses, environment precedence,
  credential boundaries, and case-insensitive filesystem deduplication. The key
  lesson is that a green suite can consistently encode the wrong host contract.
- [PR #22: GitHub Copilot as a first-class host](https://github.com/QoderAI/better-harness/pull/22)
  shows a spec-led decomposition across shell, configured assets, sessions,
  shared registries, docs, and fixtures. Its evidence model keeps missing usage
  fields explicit, rejects foreign-workspace sessions, and accounts for unknown
  event types. Because review can change the PR, treat it as an evolving example,
  not proof that a capability is merged or released.

## Definition of Done

- [ ] The spec names each claimed, partial, and unavailable support slice.
- [ ] Native host/version evidence backs every discovery and data-layout claim.
- [ ] Shell metadata is thin and independently smoke-tested when present.
- [ ] Configured assets and sessions keep scopes, workspace identity, and private
  data boundaries explicit.
- [ ] Registration matches implemented capabilities; no unrelated host fallback
  is possible.
- [ ] The host has one independently importable lifecycle profile whose
  supported steps use argv arrays and current contract evidence; unavailable
  operations remain explicit. Every primary and secondary inventory home route
  has an isolated relative path and redacted safe fallback, and every surface
  observation kind and discovery source are declared and pass profile
  validation. Shared artifact
  policy and native home bindings cite versioned native evidence; without that
  evidence, isolated mutation and verification steps fail closed.
- [ ] Deterministic fixtures cover applicable path, precedence, status, dedupe,
  foreign-workspace, unknown-event, and secret-boundary risks.
- [ ] Focused, full-suite, cross-platform, native-smoke, documentation, and
  packaging results are recorded accurately.
- [ ] The matrix, capability references, installation docs, and published site
  match the behavior actually delivered.
- [ ] The Review Readiness Check finds a coherent Story/Spec/Test/Risk chain and
  a clean staged/unstaged split.
