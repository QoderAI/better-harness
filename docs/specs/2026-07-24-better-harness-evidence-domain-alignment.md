# Align Better Harness evidence domains

## Traceability

- Spec ID: better-harness-evidence-domain-alignment
- Status: Implemented
- Builds on: [Better Harness runtime parity](2026-07-23-better-harness-runtime-parity.md)

## Intent

Align the public knowledge and orchestration names with the three independent
Better Harness evidence specialists: `session-evidence`, `project-harness`, and
`agent-customize`. Replace the mixed `coding-agent-practices`,
`reliable-delivery`, and `ai-friendly` reference buckets with specialist-owned
domains while preserving lead-only Loop Engineering and shared runtime support.

Keep `skills/better-harness/references/` flat, but rename the four specialist
files so the Skill route, shared reference domain, evidence-bundle lane, tests,
and package inventory use the same canonical vocabulary. The underlying
`session-analysis`, `core-change-watch`, `agent-customize`, `agent-lint`, and
`coding-agent-practices` executable capabilities remain reusable owners.

## Acceptance Scenarios

- BHEA-AC-1: Session Evidence consistently uses
  `skills/better-harness/references/session-evidence.md`,
  `session-repeated-workflows.md`, `references/session-evidence/`, and the
  `sessionEvidence` evidence-bundle lane.
- BHEA-AC-2: Project Harness consistently uses
  `skills/better-harness/references/project-harness.md`,
  `references/project-harness/`, and the `projectHarness` evidence-bundle lane;
  the separate `models/software-fluency.md` model id and filename remain stable.
- BHEA-AC-3: Agent Customize consistently uses
  `skills/better-harness/references/agent-customize.md`,
  `references/agent-customize/`, and the `agentCustomize` evidence-bundle lane.
- BHEA-AC-4: `references/session-evidence/` owns session diagnostics, insights,
  and usage guidance. `references/project-harness/` owns repository capability,
  observability, design, CLI, core-change, acceptance, recovery, review-trigger,
  Git-hook, and sensitive-code guidance. `references/agent-customize/` owns
  Rules, Skills, MCP, Memory, Custom Agents, Hooks, global assets, and
  provider-specific configured-asset guidance.
- BHEA-AC-5: `references/loop-engineering/` remains the lead-only durable-owner
  selection domain and `references/tool-runtimes/` remains shared infrastructure.
  Agent Work Loop rationale moves beside its model, and named examples move to
  `case-studies/` instead of remaining policy references.
- BHEA-AC-6: The old active `references/coding-agent-practices/`,
  `references/reliable-delivery/`, and `references/ai-friendly/` owners are
  removed after all active consumers move. Historical specs may retain old paths
  as lifecycle evidence, but architecture, models, skills, templates, scripts,
  tests, and package verifiers use only the new owners.
- BHEA-AC-7: `scripts/harness-analysis/evidence-bundle/` exposes a public import
  surface and three canonical lane projectors. The workflow command returns one
  versioned JSON envelope with frozen target/provider/window/depth/authority,
  separate lane status, and lead analyzer output without changing the existing
  individual diagnostic commands.
- BHEA-AC-8: The bundle fails closed when a required lane or the lead analyzer
  fails, keeps debug/raw-session and Memory-body data outside specialist lanes,
  and preserves provider and authorization boundaries.
- BHEA-AC-9: All relative Markdown links resolve, the generated Better Harness
  routing graph is current, package/runtime artifacts contain the new owners and
  omit retired active paths, and bounded stale-path scans pass.
- BHEA-AC-10: The same canonical names and domain ownership are applied to
  the distribution checkout while preserving its local Canvas,
  report-source, packaging, and frozen-contract adaptations. Adding the public
  `harness evidence-bundle` workflow is an intentional, reviewed extension of
  its frozen CLI help, inventory, schema, and command-description baselines.

## Non-goals

- Renaming reusable script capabilities such as `session-analysis`,
  `core-change-watch`, or the stable `software-fluency` model id.
- Changing finding eligibility, scoring, report schemas, renderer output,
  provider semantics, or repair authorization.
- Moving `skills/better-harness/references/` into subdirectories.
- Rewriting historical specs merely to erase former paths.
- Publishing, pushing, or changing package versions.

## Plan and Tasks

1. Rename the flat Skill specialist references and update first-hop routing.
2. Split shared references into the three canonical evidence domains, relocate
   model rationale and examples, and update active consumers and architecture.
3. Add the versioned evidence-bundle owner and register its workflow command
   while retaining individual commands for diagnostics.
4. Update package inventories, link-graph routing, CLI/Skill/model tests, and
   stale-path assertions.
5. Apply the same domain and lane contract to the distribution checkout, adapting its
   package path, preview/report-source owners, and frozen CLI baseline.
6. Run focused tests, full tests, package verification, link generation,
   plugin/runtime smoke where applicable, and Review Readiness Checks before
   committing each repository.

## Test and Review Evidence

- BHEA-AC-1..AC-5: focused Skill/model tests plus direct inspection of the new
  directory tree and one-hop routing.
- BHEA-AC-6: bounded active-path `rg` scan excluding historical specs and the
  generated graph, followed by graph regeneration.
- BHEA-AC-7..AC-8: evidence-bundle unit/CLI tests covering lane names, frozen
  context, partial/failure status, privacy boundaries, and unchanged diagnostic
  commands.
- BHEA-AC-9: `node --test test/doc-link-graph.test.mjs`, relevant focused suites,
  `npm test`, `npm run pack:verify`, and `git diff --check`.
- BHEA-AC-10: the corresponding focused/full/package gates in
  the distribution checkout, its updated frozen CLI snapshots and hashes, plus its
  Review Readiness Check.
- Compatibility risk: external users may have copied old reference paths.
  Package each Skill with its matching references and do not keep duplicate
  active compatibility documents that can drift.
- Refactor risk: bulk path replacement can collapse Session, Project, and Agent
  Customize ownership. Review the move manifest and run lane-specific tests.
- Cross-platform risk: keep CLI dispatch on argv arrays and use path utilities;
  do not add shell-string orchestration.

## Verification Evidence

- Evidence-bundle, Skill routing, CLI, platform-note, maturity-model,
  session-analysis, doc-link, and frozen scripts-contract suites passed.
- `npm test` passed 816 of 819 tests. The remaining three preview-server tests
  were blocked only by sandbox loopback binding (`listen EPERM 127.0.0.1`);
  the requested elevated rerun was not authorized by the execution policy.
- `npm run pack:verify` passed from a `/tmp` mirror of the current worktree,
  with 295 npm-package entries and 329 runtime-zip entries, because the source
  checkout was read-only to the verifier's temporary archive write.
- `git diff --check`, generated doc-graph validation, relative-link validation,
  frozen CLI snapshots and hashes, and the bounded active-path scan passed.
