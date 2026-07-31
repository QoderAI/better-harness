# Define the Developer Experience System

## Traceability

- Spec ID: `developer-experience-system`
- Status: Implemented

## Intent

Define one product-level architecture decision for the Better Harness developer
experience system. The decision must turn the repository's existing strengths in
documentation, command discovery, cross-platform validation, host adapters, and
review evidence into an explicit control plane for journeys, contracts,
projections, native evidence, governance, and improvement metrics.

The system serves evaluators, operators, first-time contributors, experienced
contributors, Coding Agent adapter authors, maintainers, releasers, and support
or security responders. It applies the five pillars described by the external
DX Fluency Model to those journeys, but it is not a new report-scoring model and
does not replace the repository's `software-fluency` runtime model.

## Acceptance Scenarios

- **DXS-AC-1 (bounded decision):** The ADR defines the problem, decision
  drivers, scope, non-goals, terminology, status, decision owner, and acceptance
  gate. It distinguishes current behavior from target architecture and does not
  claim that proposed registries, commands, evidence, governance, or metrics
  already exist.
- **DXS-AC-2 (role and journey contracts):** The ADR identifies the developer
  and operator levels in scope and defines observable completion for evaluation,
  installation, first report, recovery, upgrade or removal, first contribution,
  capability or host extension, release, and support or security journeys.
- **DXS-AC-3 (federated ownership):** The ADR selects federated,
  capability-owned declarations plus deterministic validation and projection.
  It names canonical owners and prohibits a central DX file or compiler from
  taking over host, CLI, documentation, privacy, release, or report judgment.
- **DXS-AC-4 (command and recovery contract):** The ADR defines typed command
  metadata, side-effect and privacy declarations, side-effect-free help, strict
  option parsing, machine-safe output, stable diagnostics, workspace validation,
  and distinct `ok`, `partial`, `failed`, and unobserved outcomes. It includes a
  read-only diagnostic route and a compatibility policy for command changes.
- **DXS-AC-5 (support and evidence lifecycle):** The ADR separates host
  capability slices, deterministic fixture evidence, package evidence, native
  host evidence, installed application or browser evidence, and deployed-site
  evidence. Public support promotion requires sanitized, fresh evidence and
  automatically loses its verified state when that evidence becomes stale.
- **DXS-AC-6 (complete experience surfaces):** The ADR covers curated and
  projected documentation, cross-platform Quickstarts, Preview, CI, release,
  security, support, privacy, accessibility, localization, and first-contribution
  paths without requiring all prose or translations to be generated.
- **DXS-AC-7 (privacy and measurement):** The ADR keeps the default system
  local-first and telemetry-free, defines diagnostic redaction and explicit
  upload boundaries, and measures task completion and recovery rather than
  document, command, or test counts. Unknown or unobserved values remain
  distinct from zero and failure.
- **DXS-AC-8 (migration and reversibility):** The ADR provides incremental,
  independently reversible migration phases with activation gates, compatibility
  windows, advisory-to-blocking promotion, rollback behavior, and explicit
  implementation owners. Each non-trivial implementation slice requires its own
  dated spec and evidence.
- **DXS-AC-9 (trade-offs):** The ADR records positive and negative
  consequences, operational costs, risks and mitigations, rejected alternatives,
  and the conditions under which the decision must be revised or superseded.
- **DXS-AC-10 (discoverability):** The ADR and this spec link to each other, an
  ADR index gives the decision a stable identifier without renaming existing
  paths, and the architecture and contribution entrypoints route relevant
  changes to the decision.
- **DXS-AC-11 (review evidence):** All relative Markdown references resolve,
  the required generated documentation graph remains current, focused document
  tests pass, package boundaries remain valid, and at least two independent
  architecture reviewers report no P1 or P2 findings across complexity,
  convenience, and evolution.

## Non-goals

- Implementing the target registries, schemas, compiler, `doctor`, support
  bundle, native-smoke runners, telemetry, release automation, or branch rules
  in this documentation change.
- Publishing an npm package, creating a tag or GitHub Release, changing public
  host support levels, or claiming new native-host evidence.
- Renaming or changing the semantics of the current `software-fluency` model or
  adding a new maturity model to report routing.
- Generating or translating explanatory prose, replacing capability ownership
  with a central registry, or creating a generic `scripts/core/` boundary.
- Collecting remote telemetry, uploading diagnostics, reading raw transcripts,
  or changing current user data, reports, configuration, or caches.
- Making every native-host smoke check block every pull request; promotion from
  advisory evidence to a required gate belongs to the relevant implementation
  spec.

## Plan and Tasks

1. Create `docs/adrs/developer-experience-system.md` as the complete target
   architecture, with current and target owners explicitly labeled.
2. Create `docs/adrs/README.md` so ADR identifiers, paths, dates, and statuses
   remain discoverable without renaming the existing directory ADR.
3. Link the DX decision from `docs/ARCHITECTURE.md`,
   `docs/adrs/directory-structure.md`, and `CONTRIBUTING.md` at the points where
   ownership, directory placement, or public experience contracts are selected.
4. Run the repository documentation graph and focused tests, then inspect the
   final diff for scope, broken links, accidental generated-file drift, and
   staged or unstaged changes from other work.
5. Run the repository's triangulated spec-review workflow with the same
   read-only prompt for at least two independent reviewers. Resolve every
   convergent P1 or P2 finding in the owning ADR section and repeat until the
   acceptance gate is clear or record the unresolved blocker.
6. Change this spec from Draft only when the authored decision, routing,
   validation, and review evidence support the new status. Keep the ADR itself
   Proposed until maintainers explicitly accept the decision.

## Test and Review Evidence

- **DXS-AC-1 through DXS-AC-10:** inspect the ADR against this spec, the
  repository architecture principles, the directory-structure ADR, and the
  five external DX Fluency pillars.
- **DXS-AC-10/11:** regenerate the Harness documentation graph with
  `node scripts/doc-link-graph/cli.mjs skills/better-harness` and run
  `node --test test/doc-link-graph.test.mjs`.
- **DXS-AC-11:** run the focused documentation baseline with
  `node --test test/docs-dx.test.mjs test/docs-entrypoints.test.mjs test/docs-site.test.mjs`.
- **DXS-AC-11:** run `npm run pack:verify` because canonical `docs/` content is
  included in public package and runtime bundle boundaries.
- **DXS-AC-11:** run
  `.agents/skills/triangulate-spec-review/scripts/run-triad-review.mjs` against
  the ADR and require at least two successful reviewers with no P1 or P2
  findings. If configured provider CLIs are unavailable, use the same read-only
  prompt and rubric with independently isolated reviewers, record that fallback
  here, and remove path-bearing temporary review state before the full suite.
- **All ACs:** run `git diff --check`, inspect `git diff --stat`, and compare
  staged and unstaged state separately before handoff.

## Observed Review and Validation Evidence

- The final reviewed ADR bytes have SHA-256
  `9b9c3c71dc8a49c147885497857e99bfe5eae866c09b264ca76e9decb808950f`.
- The configured triad launcher was attempted first. Its local Claude provider
  reported expired authorization, Qoder reported no authenticated session, and
  the bundled Codex invocation used an obsolete `-p` interface. These are
  reviewer-availability failures, not architecture verdicts.
- The same complexity, convenience, and evolution rubric was then applied by
  two independently isolated read-only reviewers. Earlier rounds identified and
  resolved P1/P2 issues in activation authority, per-slice host/evidence state,
  machine-output boundaries, accessibility, journey ownership, evidence trust,
  deterministic aggregate reduction, and metric ownership. Both reviewers
  passed the final bytes with no P1 or P2 findings.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` parsed 11 seed
  documents and produced the current 34-file, 50-link graph.
- The focused documentation command passed 28 of 28 tests.
- The full `npm test` command passed 1004 of 1004 tests after temporary review
  state was removed.
- `npm run pack:verify` passed with 347 npm-package entries and 370 runtime-bundle
  entries.

## Risks

- **Architecture without adoption:** A broad ADR can become aspirational prose.
  Mitigation: define small migration slices, activation gates, explicit owners,
  and task-level metrics; require a dated spec for each implementation slice.
- **Central-registry gravity:** Cross-surface consistency can tempt the DX
  compiler to absorb business judgment. Mitigation: keep declarations with
  capability owners and restrict the compiler to schema validation, comparison,
  and deterministic projection.
- **False verification:** Synthetic tests can be mistaken for native or
  deployed evidence. Mitigation: use typed evidence receipts and prevent one
  evidence class from satisfying another class's gate.
- **Generated-doc damage:** Fact projection can overwrite authored explanation
  or translations. Mitigation: generate only structured facts and validate
  curated prose semantically.
- **Privacy regression:** Diagnostics or metrics can expose source, session, or
  credential data. Mitigation: remain telemetry-free by default, plan support
  bundles before writing them, and test redaction with credential-shaped values.
- **Migration burden:** Running manual and generated surfaces in parallel costs
  time. Mitigation: use bounded dual-run phases, drift reports, reversible
  cutovers, and explicit removal gates.

## Source References

- [DX Fluency Model](https://dx.phodal.com/docs/dx-fluency-model.html)
- [Documentation Experience](https://dx.phodal.com/docs/factor/documentations.html)
- [Error Presentation](https://dx.phodal.com/docs/factor/error-handling.html)
- [Usability](https://dx.phodal.com/docs/factor/usability.html)
- [Interaction Design](https://dx.phodal.com/docs/factor/interactive-design.html)
- [Touchpoints and Support](https://dx.phodal.com/docs/factor/touch-point.html)
