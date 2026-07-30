# ADR: AI-Optimized Directory Structure

## Status

Proposed. Revision: 2026-07-16. Renamed from
`docs/specs/directory-structure.md`. If local host instructions still name the
old path, this ADR is the canonical successor.

This ADR is the detailed directory-status reference under
`docs/ARCHITECTURE.md`, the accepted repository-wide owner. Formal acceptance
of this ADR still requires the validation gate below.

## Scope

This ADR owns directory ownership and contribution routing. It does not define
knowledge-base registry schemas or host package generation internals.

Rejected direction: top-level `packs/`. A pack is a lifecycle state, not a
source directory.

Legend:

- `[active]`: exists or can be edited now.
- `[generated]`: package output; may be absent from the source checkout because
  the generator is source of truth.
- `[target]`: future owner; create only when the inline gate is satisfied.
- `[candidate]`: may be created as docs-only evidence; does not affect runtime.

## Directory Structure

```text
# host and agent surfaces
.claude-plugin/                        # [active] thin Claude Code shell
  plugin.json marketplace.json         # native install/discovery metadata only

.qoder-plugin/                         # [active] hand-maintained Qoder shell
  plugin.json                          # thin discovery/install metadata only

.cursor-plugin/                        # [active] thin Cursor shell
  plugin.json marketplace.json         # install/discovery metadata only

.codex-plugin/                         # [active] thin Codex shell
  plugin.json                          # thin discovery/install metadata only

.github/plugin/                        # [active] thin GitHub Copilot shell
  plugin.json marketplace.json         # native install/discovery metadata only

qwen-extension.json                    # [active] thin Qwen Code shell

.agents/
  skills/<skill>/                      # [active] host-local only; shared logic -> root skills/
    SKILL.md
    references/ scripts/               # host-only depth for this skill

skills/<skill>/                        # [active] canonical shared workflows
  SKILL.md
  references/

models/                                # [active] maturity models and embedded detector contracts
  routing.md
  <model>.md

agent-roles/<role>.md                  # [target] create only for role-only prompts
                                        # no workflow steps/tools/evidence contracts
                                        # reused by 2+ explicit consumers

# executable automation; split by business capability, never scripts/core/
scripts/
  harness-analysis/                 # [active] Harness evidence and report mechanics
    canvas-preview/                 # [active] local Canvas preview subcapability
      cli.mjs                       # executable command owner
      index.mjs                     # public import surface inside/outside the capability
    report-source/                  # [active] report-source and bounded review integrity
      index.mjs                     # public contract/review import surface
      apply-review.mjs              # review application and compatibility CLI owner
  core-change-watch/               # [active] static structure/core-path/history evidence
  session-analysis.mjs                 # [active] thin shim; new exports -> scripts/session-analysis/
  session-analysis/                    # [active] session evidence collection/normalization
    platforms/<host>.mjs               # Qoder/Codex/Claude/Cursor/Qwen/Copilot host adapters
    ides/<ide>/                        # target editor-local evidence not covered by host adapters
  <business-capability>/               # [target] new capability owner
    cli.mjs                            # use cli.mjs for new capabilities
    schema.json
    fixtures/
    lib/                               # helpers scoped to this capability
  knowledge-base-registry/             # [target] compiler; requires matching spec
  runtime-smoke/<host>/                # [target] host runtime health checks
  npm-package/                         # [active] current bundle and verify tooling
  packaging/                           # [active] source-local generated host artifacts
    build-host-plugin.mjs              # assemble an existing thin host shell plus runtime roots
    verify-host-plugin.mjs             # reject host/package/state leakage and non-portable links

schemas/                               # [target] versioned public runtime contracts
  <contract>.v<major>.schema.json       # shared by 2+ repo surfaces or packaged hosts

hooks/
  hooks.json.template                  # [active] copyable hook wiring template
  git-scripts/<hook>.mjs               # [active] existing wrapper; new wrappers need target gate
  git-scripts/<hook>/                  # [active] existing owner; new owners need target gate

# structured knowledge; docs-only until registry compile + binding tests exist
knowledge-base/                        # [candidate] not runtime-active
  NOTICE.md                            # must say assets do not execute by default
  official/{practices,languages,frameworks,contracts,scenarios}/<asset>/
    knowledge.md
    schema.json
    fixtures/
  community/<namespace>/{practices,languages,frameworks,contracts,scenarios}/<asset>/
    knowledge.md
    schema.json
    fixtures/

references/                            # [active] human guidance without fixtures
  README.md                            # redirects historical names and topic roots
  session-evidence/                    # bounded session and usage evidence
  project-harness/                     # static project and delivery evidence
  agent-customize/                     # agent assets and Skill guidance
  loop-engineering/                    # repeated-work owner selection
  tool-runtimes/                       # runtime lookup support contracts
  recommend/                           # [target] recommendation examples

case-studies/                          # [target] examples, not runtime policy
  projects/<project-id>.md
  scenarios/<scenario-id>.md
  private/<company>/operating-models/  # local-only; exclude from packaging

templates/                             # [active] runtime-selected contracts
  reporting/                           # [active] report-generation template family
    routing.md                         # [active] report/style/output route selection
    report-structure.md                # [active] Markdown report skeleton
    qoder-canvas.md                    # [active] Qoder Canvas output contract
    html-visual.md                     # [active] HTML visual contract
  style/                               # visual grammar and style routing
  components/                          # [target] reusable component profiles, 2+ consumers
  common/                              # [target] shared fragments, 2+ consumers

docs/
  adrs/
    directory-structure.md             # [active] this directory ownership ADR
  specs/
    knowledge-base-registry.md         # [target] required before KB runtime activation
  adapters/                            # [active] matrix first; split notes by trigger
    README.md                          # [active] host matrix and split triggers

dev/                                   # [active] local preview/debug helpers, not hooks/CI
test/                                  # [active] tests for scripts/hooks/skills/templates
```

## Routing Rules

Use the tree first. These rules resolve common collisions:

| Artifact | Canonical owner |
| --- | --- |
| Shared workflow | `skills/<skill>/SKILL.md` |
| Host-local wrapper or mirror | `.agents/skills/<skill>/` |
| Maturity model and embedded detector contract | `models/<model>.md` |
| Executable detector or scoring signal | `scripts/<business-capability>/` |
| Skill-specific signal interpretation | `skills/<skill>/references/` |
| Role/persona prompt | `agent-roles/<role>.md` |
| Single-consumer role/persona text | `skills/<skill>/references/` |
| Single-file executable script | `scripts/<name>.mjs` only until a second support file is needed |
| Executable capability | `scripts/<capability>/cli.mjs` |
| Harness Canvas preview runtime | `scripts/harness-analysis/canvas-preview/` |
| Harness report-source and review integrity | `scripts/harness-analysis/report-source/` |
| Capability-specific host adapter | `scripts/<capability>/platforms/<host>.mjs` |
| Versioned public runtime schema | `schemas/<contract>.v<major>.schema.json` |
| Current package builder and verifier | `scripts/npm-package/` |
| Source-local generated host artifact | `scripts/packaging/` |
| Hook wiring | `hooks/hooks.json.template` |
| Hook implementation | `hooks/git-scripts/<hook>/` |
| Host matrix entry | `docs/adapters/README.md` |
| Split adapter note | `docs/adapters/<host>.md` only after matrix split triggers |
| Local debug helper | `dev/` |
| Automated test | `test/` |
| Human prose guidance | `references/` |
| Prose-only community guidance | `references/<topic>/community/` |
| Named examples or operating models | `case-studies/` |
| Report skeleton | `templates/reporting/report-structure.md` |
| Report output-mode contract | `templates/reporting/<mode>.md` |
| Template component profile | `templates/components/<component>.md` |
| Shared template fragment | `templates/common/<fragment>.md` |
| Structured knowledge candidate | `knowledge-base/{official,community}/...` |

- Prose guidance goes to `references/`.
- Prose-only community guidance goes to `references/*/community/`.
- Community content stays in `references/<topic>/community/` unless the same
  change includes `knowledge.md`, an interim `schema.json`, and at least one
  fixture. Promotion from `references/` to `knowledge-base/` is a migration-gated
  move.
- Named examples and operating models go to `case-studies/`.
- Runtime behavior goes to `skills/`, `scripts/`, `hooks/`, or `templates/`.
- Versioned public runtime contracts shared by multiple repo surfaces or
  packaged hosts go to `schemas/`. Capability-private schemas stay under the
  owning `scripts/<capability>/` directory.
- Role/persona text goes to `agent-roles/` only when it has no workflow steps,
  tool instructions, evidence rules, artifacts, or validation contract. A
  single-consumer role stays under `skills/<skill>/references/` until the second
  explicit consumer lands in the same change as the promotion.
- Structured knowledge with `knowledge.md`, `schema.json`, and fixtures goes to
  `knowledge-base/{official,community}/` as docs-only candidate content until
  `docs/specs/knowledge-base-registry.md`, compiler, and binding tests exist.
  Prose-only drafts stay in `references/*/community/` until they have schema
  and fixtures. Community namespaces are lowercase and unique under
  `knowledge-base/community/`; the registry spec owns final collision policy.
  Until then, namespace uniqueness is a Review Readiness Check item: list the
  existing immediate child directories under `knowledge-base/community/`, confirm
  the exact name is unused, and reject renames unless the same change adds a
  deprecation redirect. This manual check expires when
  `scripts/knowledge-base-registry/` provides an equivalent validation command.
- Shared workflows go to root `skills/`; host-local wrappers or generated
  mirrors go to `.agents/skills/`.
- Host plugin directories such as `.claude-plugin/`, `.qoder-plugin/`,
  `.cursor-plugin/`, `.codex-plugin/`, and `.github/plugin/` are
  install/discovery shells for one host. Existing active shells may be
  hand-maintained narrowly, but the Qoder
  public npm package ships all six plugin metadata roots, while the Qoder
  runtime bundle ships only `.qoder-plugin/`. New host shells start from the
  `docs/adapters/README.md` matrix; split to `docs/adapters/<host>.md` and add a
  source-local `scripts/packaging/` builder only for an accepted host-artifact
  contract. New host identities still require the matrix split triggers.
  `.agents/` is the generic host-local skill/wrapper/mirror surface and is not a
  product owner.
- New executable capabilities use `scripts/<capability>/cli.mjs`. The root
  `<name>.mjs` facade pattern is reserved for compatibility shims, existing
  owners, or an accepted spec that needs a stable root API. Product logic,
  helpers, capability-private schemas, fixtures, and adapter depth live under
  `scripts/<capability>/`; adding any second support file for a flat script
  triggers a directory owner or a documented facade migration. A grandfathered
  facade delegates to its directory owner. Existing compatibility wiring may
  stay in the facade; any new export, option, helper, schema, fixture, adapter,
  or output mode lands in the directory.
- Reusable Canvas preview serving, transform, runtime discovery, fixture, and
  platform helpers live under `scripts/harness-analysis/canvas-preview/` and are
  imported through its `index.mjs`. This keeps the whole Harness analysis owner
  copyable for installed-like consumers. The repository preserves the
  historical `scripts/harness-analysis/canvas-preview-server.mjs` command as a
  compatibility facade while public CLI metadata still exposes that path.
- Report-source creation/validation, review-packet binding, episode/delivery
  review normalization, and review application live under
  `scripts/harness-analysis/report-source/`. Non-facade consumers import the
  contract through `index.mjs`; the historical `report-source.mjs`,
  `report-review-packet.mjs`, `episode-evidence-review.mjs`, and
  `apply-source-review.mjs` paths remain compatibility facades. The apply-review
  facade delegates to the private command owner without widening the public
  Harness command registry.
- Host shells are thin. Existing active shells may be assembled into generated
  artifacts through `scripts/packaging/`; new host identities still require a
  matrix entry and the split triggers before host-specific builders land.
- `scripts/<capability>/platforms/<host>.mjs` collects or normalizes
  per-capability host evidence. `scripts/npm-package/` owns current repository
  package assembly and verification. `scripts/packaging/` owns source-local
  generated host artifacts and stays excluded from public package/runtime
  outputs. Do not collapse these concerns.
- Report skeletons and output modes live under
  `templates/reporting/`. Keep `report-structure.md` and the runtime contracts
  at the family root; update consumers to canonical paths
  instead of adding compatibility files.
- `templates/components/` owns named reusable component profiles with their own
  contract, such as a scorecard component profile. `templates/common/` owns
  shared fragments included by other templates, such as a repeated metadata
  block. Do not add language-specific report skeletons beside the base report by
  default; keep language choice in source data, prompts, and rendered content
  unless a separate skeleton has explicit active consumers and cannot be
  represented by the shared report template.
- Countable consumers are explicit local references that load, invoke, select,
  package, or test an asset. Casual prose mentions do not count toward the 2+
  consumer rule.

Repo-local `.agents/skills/<skill>/` directories use `SKILL.md` as their
entrypoint. Host-only ownership, wrapper routing, and generated-file provenance
belong in the skill instructions or beside the generator; this repository does
not require a separate mirror sidecar schema.

Knowledge-base activation stages:

- Stage 0: no registry spec. Community prose stays in `references/`; structured
  candidates need the interim schema, fixtures, namespace check, and migration
  note.
- Stage 1: `docs/specs/knowledge-base-registry.md` accepted. Candidate assets
  may accumulate against the accepted schema.
- Stage 2: compiler exists and passes representative fixtures for the accepted
  schema. Candidate assets may become discoverable output.
- Stage 3: binding tests pass for every active kind and explicit consumer
  mapping. Assets may become runtime-active.

Minimum `knowledge-base/**/schema.json` shape until the registry spec exists:

```json
{
  "schemaVersion": 0,
  "kind": "practice|language|framework|contract|scenario",
  "status": "candidate",
  "runtimeActive": false,
  "owner": "repo-or-community-namespace",
  "fixtures": ["fixtures/<fixture>.json"]
}
```

## New Host Checklist

Adding support for a new host must route every artifact to an owner:

- `docs/adapters/README.md`: host matrix row with boundary, discovery paths,
  evidence sources, smoke command, default output, rules/prompts, and packaging
  status. Split to `docs/adapters/<host>.md` only when the README matrix split
  triggers are met.
- `.host-plugin/` or equivalent generated shell: install/discovery metadata
  only; default to no new shell unless an independent install or release
  lifecycle exists.
- `.agents/skills/<skill>/`: host-local skills, wrappers, or generated mirrors
  only; promote shared workflow judgment to root `skills/`.
- `scripts/<capability>/platforms/<host>.mjs`: only when a capability needs
  host-specific evidence collection or normalization.
- `scripts/npm-package/`: current package bundle and verification owner.
- `scripts/packaging/`: source-local generated host artifact builder and
  verifier; generated output remains ignored and is never a canonical owner.

## Migration Gates

- Target directories need a first real asset plus the entry-specific gate below.
  If no entry-specific gate exists yet, the default minimum is validation
  evidence named in the change. For prose-only targets, validation evidence is a
  link/path check plus consumer-grep proof for any 2+ consumer claim. Runtime,
  parser, generator, and packaging surfaces also need tests or fixtures.
- `knowledge-base/` needs `NOTICE.md`, `knowledge.md`, an interim
  `schema.json` matching the minimum shape above, fixtures, a namespace
  uniqueness check for community assets, and a migration note until the registry
  exists.
- `docs/adapters/README.md` must keep the host matrix scan-friendly, name
  canonical roots, and include smoke commands or "not yet available" notes. A
  split `docs/adapters/<host>.md` must link back to the matrix and explain which
  split trigger it satisfies.
- `templates/reporting/`, `templates/style/`, `templates/components/`, and
  `templates/common/` require routing/parser tests and path-reference checks in
  the same migration.
- Renaming established paths such as `references/agent-customize/`
  requires `rg` evidence for imports/references, redirect or deprecation notes
  where needed, and fixture or consumer updates in the same change.
- Old owners may be deleted only after parity fixtures pass and
  `rg` shows no remaining imports/references outside a deprecation note.
- Do not move files only for symmetry.

## Validation Gate

Before accepting this ADR, run the host-local
`.agents/skills/triangulate-spec-review/scripts/run-triad-review.mjs` in this
repo or an equivalent manual review. Equivalent means the same prompt contract,
the `complexity`, `convenience`, and `evolution` dimensions, JSON output from at
least two available independent reviewers, and recorded timeout/error evidence
for unavailable reviewers.

Acceptance requires no `P1` or `P2` findings in the recorded review output.
Store review JSON under `.harness/state/` or paste the structured summary in
the change evidence. The runner is currently a host-local `.agents/skills/`
workflow; promotion to root `skills/` requires a separate promotion change.
