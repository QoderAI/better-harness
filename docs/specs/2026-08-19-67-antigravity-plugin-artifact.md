# Package Better Harness for Antigravity

## Traceability

- Spec ID: antigravity-plugin-artifact
- Story: #67
- Status: Implemented
- Scope: implemented static buildable and verifiable Antigravity plugin artifact
  slice; native Antigravity integration and support remain unverified.

## Intent

Implement the smallest static source, build, verification, and publication slice
that produces a self-contained Better Harness plugin-shaped artifact for
Antigravity. The implementation does not establish native Antigravity install,
discovery, selection, invocation, compatibility, distribution, or first-class
support.

The work follows the maintainer-authorized direction in
[Issue #67](https://github.com/QoderAI/better-harness/issues/67). The issue
conversation records phodal, a repository MEMBER, responding "Welcome to PR".
That comment authorizes a reviewable contribution; it is not a merge, release,
compatibility, Marketplace, or support commitment.

## Pinned Evidence

- The implementation base is Better Harness commit
  [`842a6b5070d401f983693d4c4d6a83b7ad1841c6`](https://github.com/QoderAI/better-harness/tree/842a6b5070d401f983693d4c4d6a83b7ad1841c6).
- The pinned [architecture owner](https://github.com/QoderAI/better-harness/blob/842a6b5070d401f983693d4c4d6a83b7ad1841c6/docs/ARCHITECTURE.md)
  places source-local artifact assembly under `scripts/packaging/` and treats
  generated artifacts as outputs rather than canonical product owners.
- The existing [generic host builder](https://github.com/QoderAI/better-harness/blob/842a6b5070d401f983693d4c4d6a83b7ad1841c6/scripts/packaging/build-host-plugin.mjs),
  [generic verifier](https://github.com/QoderAI/better-harness/blob/842a6b5070d401f983693d4c4d6a83b7ad1841c6/scripts/packaging/verify-host-plugin.mjs),
  and [Codex artifact tests](https://github.com/QoderAI/better-harness/blob/842a6b5070d401f983693d4c4d6a83b7ad1841c6/test/plugins/host-plugin-artifact.test.mjs)
  remain separate owners and regression evidence.
- The target-specific authority is the official
  [Antigravity CLI Plugins documentation](https://www.antigravity.google/docs/cli/plugins),
  observed 2026-08-20 under Antigravity CLI v1.1.14. Its full manifest schema
  requires string `name`, permits optional string `description`, and closes
  additional properties. The page's pattern is implemented as
  `^[A-Za-z0-9_-]+$`, following its stated alphanumeric, hyphen, and underscore
  intent without treating `9-_` as a character range. It also documents
  `agy plugin install`; that command was not run locally.
- The official [Antigravity Plugins documentation](https://www.antigravity.google/docs/plugins),
  observed 2026-08-19 under generic Antigravity 2.0 v2.8.1, supplies shared
  plugin-root and Skill-layout context. Its optional-name behavior is not the
  contract for the Agy CLI v1.1.14 profile implemented here.
- The official [Antigravity Skills documentation](https://www.antigravity.google/docs/skills),
  observed on the same date and generic documentation version, confirms that a
  Skill is a folder containing `SKILL.md`. The CLI page shows a plugin `skills/`
  directory but does not independently prove discovery or invocation of this
  artifact's nested Skill in a native CLI build.

The official pages are live rather than commit-addressed. Their observation
date and displayed documentation version bound the facts consumed here; static
documentation does not prove behavior in a selected IDE or CLI build.

## Official Contract Boundary

The Agy CLI v1.1.14 profile relies on these target-specific facts:

1. A plugin root contains required `plugin.json`.
2. The manifest is an object closed to `name` and optional `description`.
3. `name` is a required string using only ASCII alphanumerics, hyphens, and
   underscores, enforced as `^[A-Za-z0-9_-]+$`.
4. `description`, when present, is a string; an empty string remains valid.
5. `agy plugin install` is a documented command, not evidence that installation
   or invocation succeeded in this environment.

The generic 2.0 pages supply shared layout evidence only. Their optional-name
default is deliberately excluded from this CLI profile. The CLI page includes
an example `$schema` editor hint, while its listed full JSON Schema closes
properties to `name` and `description`; this frozen verifier follows the listed
schema and rejects `$schema` as profile drift. Static conformance does not prove
native install, Skill discovery, selection, invocation, or compatibility.

## Implemented Surfaces and Ownership

| Surface | Owner | Implemented contract |
| --- | --- | --- |
| `scripts/packaging/antigravity/plugin-manifest.json` | Agy CLI packaging source | Exact source value `{ "name": "better-harness" }`; a valid name-only subset of the official CLI schema, source-only, and never an install root. |
| `scripts/packaging/antigravity/build-antigravity-plugin.mjs` | Antigravity artifact builder | Allowlisted assembly, dependency copy, staged verification, canonical boundary checks, and transactional publication. |
| `scripts/packaging/antigravity/verify-antigravity-plugin.mjs` | Antigravity artifact verifier | Closed tree, identity, marker, package, Markdown/runtime closure, license, bounds, and runtime smoke validation. |
| `test/plugins/antigravity-plugin-artifact.test.mjs` | Artifact conformance evidence | Positive build/replace/run coverage and adversarial identity, parser, path, race, rollback, and cleanup cases. |
| `skills/better-harness/**` and Better Harness runtime | Existing canonical capability owners | Copied and validated without redirecting, renaming, or forking product judgment. |
| Native Antigravity behavior | Antigravity | Unobserved; no approved `agy` binary or selected IDE/CLI build was exercised. |

Canonical sources feed the generated host artifact in one direction. Generated
files never become canonical input and never write back to the repository.

The verifier requires an own string `name` matching the CLI pattern; absence,
blank or non-string values, invalid characters, and unknown properties fail
without a basename fallback. It accepts optional string `description` because
that field is valid in the official CLI schema, while the owned source and
builder deliberately produce the narrower exact name-only subset. Manifest
name, root basename, ownership marker, and package identity must all resolve to
the Better Harness artifact contract.

## Implemented Artifact Profile

The generated root basename is `better-harness`. Its positive allowlist is:

- root `plugin.json`, `.antigravity-plugin-artifact.json`, and private
  `package.json`;
- `README.md`, `AGENTS.md`, `DESIGN.md`, `LICENSE`, `CHANGELOG.md`,
  `CODE_OF_CONDUCT.md`, and `CONTRIBUTING.md`;
- canonical `skills/better-harness/**` only;
- `scripts/**` except `scripts/packaging/**`;
- `references/**`, `templates/**`, `models/**`, `hooks/**`, `docs/**`, and
  `case-studies/**`;
- `node_modules/@vscode/tree-sitter-wasm/**`, `node_modules/esbuild-wasm/**`,
  and `node_modules/yaml/**`, including package metadata and licenses.

The builder copies only regular files and directories reached without following
symbolic links. The verifier rejects unknown roots, other Skills and host
shells, development/test state, caches, environment files, special files,
symlinks or junctions, traversal, canonical escape, and case or Unicode
identity collisions.

The generated root `package.json` is a closed Better Harness schema with exactly
these keys: `name`, `version`, `private`, `license`, `type`, `bin`, `engines`,
and `dependencies`. It binds:

- `name` to `@qoder-ai/better-harness`, `private` to `true`, and `type` to
  `module`;
- `bin` to the singleton `{ "better-harness": "scripts/better-harness.mjs" }`;
- `engines` to exact nonblank `node` and `npm` entries projected from source;
- `dependencies` to exact version-bound `@vscode/tree-sitter-wasm`,
  `esbuild-wasm`, and `yaml` entries.

The builder projects fresh nested objects and rejects missing, extra, blank,
non-string, or wrong source runtime metadata rather than aliasing source
objects into the artifact.

## Canonical Closure and Link Integrity

The canonical artifact entry is unchanged at
`skills/better-harness/SKILL.md`; there is no wrapper, flat Skill, redirect,
generated mirror, or copied business-logic owner. `DESIGN.md` is required
because shipped `AGENTS.md` links to it as an offline dependency.

Every relative local Markdown link is an artifact hard dependency. It must
resolve uniquely to an allowlisted regular file inside the canonical root.
Repository-only navigation uses absolute upstream HTTPS URLs and is not copied
or traversed. `pathname:` is treated only as a non-local Docusaurus route;
`file:` and unknown schemes fail closed.

The verified pinned artifact contains a Markdown closure of exactly 106 nodes,
305 edges, and 109 files. Runtime analysis starts at
`scripts/better-harness.mjs` and proves a syntax-aware ESM closure of 19 modules
and 39 edges, plus the exact three packaged dependencies and their licenses.
Limits bound files, bytes, depth, nodes, and edges.

Three target-only source-integrity repair groups make that shipped closure
self-contained without changing product behavior:

1. repository-only governance links in
   `docs/adapters/contributing-new-coding-agent.md` use upstream HTTPS targets;
2. Codex and Qoder Custom Agent Review links resolve to the shared parent
   reference;
3. the observability instructions link to the canonical Agent instructions
   review reference.

Groups 2 and 3 correct links that were already broken in the repository. They
survived because `classify` in `scripts/doc-link-graph/cli.mjs` cannot tell a
slash-free `custom-agents-review.md` (a real sibling one directory up) from
`AGENTS.md` (a file convention in a repository under analysis), so it checks
neither. `test/skills-docs/doc-link-graph.test.mjs` now checks slash-free
targets written as link syntax, excluding the convention names, and checks that
repository URLs at a mutable ref still resolve — the guarantee group 1 gives up
by leaving the artifact boundary.

## Build, Boundary, and Publication Contract

`build-antigravity-plugin.mjs` stages into a unique sibling container, assembles
only allowlisted inputs, writes the manifest and ownership marker, invokes the
full verifier, and publishes only after staged verification succeeds.

Output boundary validation is read-only. It rejects invalid basenames, roots,
lexical repository overlap, and canonical overlap by resolving the nearest
existing ancestor and projecting missing suffixes. The first parent creation is
pinned to the approved preflight `canonicalParent`; the builder then rechecks
the original lexical output. Only a successful second check authorizes staging
under the post-check canonical parent and all destination operations against
the frozen post-check `canonicalOutput`. This prevents a parent symlink or
junction retarget from redirecting writes into the repository.

An existing destination is only an early ownership gate. At replacement time,
the builder atomically moves the actual live destination into a unique sibling
backup container at `better-harness`, runs the full verifier on that moved tree,
and publishes the stage only if revalidation succeeds. Concurrent unowned,
corrupt, or symlink swaps are restored without publication; rollback conflicts
retain the moved tree rather than deleting it.

Publication reports stable states:

| Outcome | State and observability |
| --- | --- |
| New or clean replacement publication | `state="published"`, `backupCleanup="complete"`. |
| New artifact live but old backup removal failed | API resolves with `state="published"`, `backupCleanup="pending"`, warning `backup-cleanup-pending`; JSON and human CLI remain successful and expose no absolute path. |
| Destination changed and was restored | `destination-changed`, `not-published-destination-restored`. |
| Changed destination rollback conflicted | `destination-revalidation-rollback-failed`, `not-published-backup-retained`. |
| Stage publish failed and verified prior artifact was restored | `publish-failed`, `not-published-destination-restored`. |
| Stage publish rollback failed | `publish-rollback-failed`, `not-published-verified-backup-retained`. |
| Initial destination-to-backup rename failed | `publish-backup-rename-failed`, `not-published-destination-unchanged`, with bounded backup-container cleanup status. |

Errors and warnings expose only stable codes, states, and safe backup basenames;
they do not disclose absolute private paths or claim that a partially cleaned
backup remains complete or recoverable.

## Acceptance Scenarios

- **AC-1 (traceability):** The implementation links Issue #67, MEMBER
  contribution authorization, pinned base, implementation paths, and the
  target Agy CLI v1.1.14 page plus generic layout pages with their observation
  dates and distinct authority boundaries.
- **AC-2 (source manifest):** The source manifest parses to exactly
  `{ "name": "better-harness" }`, a valid name-only subset of the closed CLI
  schema; no optional field or native behavior is claimed by the source.
- **AC-3 (artifact root):** The builder writes the source manifest as root
  `plugin.json`, the verifier requires its closed CLI `name`/`description`
  schema with required patterned name, and the source directory is never an
  install root.
- **AC-4 (canonical Skill):** The artifact contains only
  `skills/better-harness/**` under `skills/` and preserves the canonical
  `SKILL.md` without redirect or duplicate implementation.
- **AC-5 (allowlist):** Positive builds contain only the root files, runtime
  roots, canonical Skill, and two dependency roots in the implemented profile.
- **AC-6 (closed exclusions):** Unknown, development, host-shell, special-file,
  link, collision, traversal, and canonical-escape cases fail closed.
- **AC-7 (Markdown closure):** Verification proves the complete recursive
  93-node, 290-edge, 96-file Markdown closure and rejects missing, escaping,
  ambiguous, cyclic-over-limit, and unsupported-scheme targets.
- **AC-8 (runtime closure):** Verification proves the 19-module ESM runtime
  closure, exact dependencies and licenses, bounded parsing, and artifact-local
  Better Harness CLI `--help` smoke before publication.
- **AC-9 (identity and replacement):** Required patterned CLI manifest name,
  optional string description, root basename, ownership marker, closed package
  identity, host, and schema are bound without absent-name fallback; the actual
  moved destination passes full revalidation before replacement.
- **AC-10 (atomicity and concurrency):** Pre/post canonical boundary checks,
  concurrent swap tests, bounded rollback states, and truthful cleanup-pending
  success warnings preserve user data without accepting a partial artifact.
- **AC-11 (regression):** The generic Codex builder/verifier remain unchanged;
  their focused artifact tests pass with the Antigravity suite.
- **AC-12 (product honesty):** README, support and adapter matrices, host
  catalogs, root CLI, package scripts, release metadata, and generated graph
  content are not widened; no native or first-class support is claimed.

## Implemented Negative Evidence

| Area | Covered evidence |
| --- | --- |
| Manifest and identity | Missing/malformed/non-object manifest; required-name absence, blank/non-string/pattern-invalid/wrong name; non-string description; `unexpected`, `$schema`, and other extra fields; exact name-only source; closed marker and package schemas. |
| Filesystem safety | Invalid output, lexical/canonical overlap, missing-parent zero-write rejection, pre/post junction retarget, symlink/junction/special file, traversal, collision, and bounds. |
| Closure | Missing/escaping/transitive Markdown targets, cycles and limits, syntax-authoritative ESM parsing, missing runtime modules, forbidden packaging imports, and unexpected dependencies. |
| Dependencies and licenses | Missing/wrong dependency metadata, versions, roots, imported subpaths, licenses, and non-regular inputs. |
| Ownership and publication | Unowned/corrupt destination, real moved-tree revalidation, concurrent swaps, first backup rename fault, stage rename fault, rollback conflict, and backup cleanup fault. |
| Product boundary | Frozen generic/package/product surfaces and no native-support assertion without an approved `agy` smoke. |

## Non-goals

- Install or invoke Antigravity, mutate a native plugin home, inspect private
  host state, or select an Antigravity IDE/CLI version.
- Claim native install, discovery, selection, invocation, uninstall,
  compatibility, lifecycle, configured assets, or first-class support.
- Add an adapter, session/evidence integration, host catalog entry, support
  matrix row, README installation path, root CLI route, package script,
  Marketplace publication, release metadata, or native install receipt.
- Change the generic builder/verifier, existing host shells, package or lock
  files, generated documentation graph content, or canonical product judgment.
- Infer manifest fields beyond the target CLI's closed `name`/`description`
  schema or apply the generic 2.0 optional-name default to this profile.

## Plan and Tasks

1. **Gate 1 - source contract (complete):** Establish the exact source manifest,
   official-fact boundary, ownership, allowlist, closure, and product non-goals.
2. **Gate 2 - static build and verification (complete):** Implement the
   Antigravity-specific builder, verifier, artifact tests, source link-integrity
   repairs, canonical boundary checks, and transactional publication states.
3. **Gate 3 - static conformance and review readiness (complete):** Run focused,
   Codex regression, doc-link, real build/replace/verify/Better CLI smoke,
   package, full-repository baseline, graph, scope, and privacy checks.

Native evidence is a later, independent, maintainer-approved contribution. It
is not a completion condition for this static artifact spec and must not widen
support claims without a selected native build and explicit review.

## Risks and Controls

| Residual risk | Control and current evidence |
| --- | --- |
| No approved native binary or IDE/CLI build was tested | Keep native compatibility and support unverified; require isolated install/discovery/invocation/uninstall evidence in a separate contribution. |
| Windows lacks privileges for some symlink/junction fixtures | Capability-gated focused tests skip rather than weaken production checks; independent non-link race and parser cases still run. |
| Live CLI/generic docs, upstream `main`, Issue, and PR state can drift | Bind CLI authority to v1.1.14 observed 2026-08-20, generic layout facts to 2.0 v2.8.1 observed 2026-08-19, and implementation facts to the pinned base; recheck immediately before PR creation. |
| Upstream absolute URLs do not follow forks or topic branches | Use them only for source-only governance/navigation dependencies; keep offline artifact dependencies relative and verified. |
| Handwritten syntax-aware Markdown and ESM parsers can miss new syntax | Bound traversal, fail closed on unsupported forms, assert adversarial syntax cases, and pin real closure cardinalities. |
| Static conformance may be mistaken for native support | Keep README, matrices, catalogs, native homes, Marketplace, and release surfaces unchanged. |

## Open Questions

- [NEEDS CLARIFICATION: Should a future native smoke install Antigravity CLI
  v1.1.14 exactly or a maintainer-selected successor, and what compatibility
  drift must be accepted?]
- [NEEDS CLARIFICATION: How does the selected native CLI discover and invoke
  the generic-layout `skills/better-harness/SKILL.md`, which the CLI page does
  not independently prove for this artifact?]
- [NEEDS CLARIFICATION: Which isolated native install, discovery, selection,
  invocation, uninstall, and configured-asset evidence must pass before a
  first-class support decision?]

These questions block native-support activation, not completion of the static
buildable and verifiable artifact slice.

## Test and Review Evidence

- Antigravity artifact focused plus existing Codex artifact and doc-link tests:
  52 tests, 49 passed, 0 failed, and 3 Windows capability-gated skips, using the
  installed offline Vitest 4.1.10 runner with the issue worktree as root.
- Real unique-output sequence: build JSON, verify JSON, artifact-local Better
  Harness CLI `--help`, repeat replacement, and second verification all passed;
  publication states were `published`, replacement changed from false to true,
  and sibling stage/backup residual count was zero. This is a Better Harness
  runtime smoke, not an `agy` native smoke.
- Full repository `npm test`, executed with the same offline runner/config:
  100 files total, 94 passed and 6 failed; 1,448 tests total, 1,420 passed,
  7 failed, and 21 skipped. Six failures were Windows `EPERM` symlink fixtures;
  one governance reporter fixture expected a worktree-local
  `node_modules/vitest/vitest.mjs` that the isolated worktree did not contain.
  The full repository gate is therefore not green.
- `npm run pack:verify` passed after redirecting npm's cache from the denied
  user cache to a writable task-local cache: npm package 546 entries and runtime
  zip 575 entries.
- Builder and verifier `node --check` and direct `--help` passed. Source
  manifest exactness, the three source link-integrity groups, generated package
  schema, closure cardinalities, JSON output, and path redaction were inspected
  through behavior tests and the real artifact.
- CLI manifest behavior accepts required valid `name` with absent, empty, or
  nonempty string `description`; it rejects absent, blank, non-string,
  pattern-invalid, or wrong names, non-string descriptions, malformed/non-object
  JSON, and extra keys including `unexpected` and `$schema`.
- The canonical doc-link generator was run once after this reconciliation;
  graph content hash remained equal to `HEAD`, with quiet content diff and zero
  raw/numstat changes. The worktree may still show a same-blob line-ending `.M`.
- `git diff --check`, changed-surface privacy/absolute-local-path scan, and
  status scope inspection passed. No dependency installation, native host
  mutation, commit, push, or pull request occurred during implementation.

The local environment has no approved `agy` executable. Native Antigravity
install, discovery, selection, invocation, uninstall, configured assets, IDE or
CLI compatibility, and Marketplace behavior remain unobserved.
