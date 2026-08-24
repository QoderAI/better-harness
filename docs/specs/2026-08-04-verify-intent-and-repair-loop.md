# Verification Intent Anchors and the Post-Failure Repair Loop

## Traceability

- Spec ID: verify-intent-and-repair-loop
- Status: Implemented

## Intent

Close three gaps in the current verification references that a review against
field material on AI-driven cross-platform E2E verification made visible. All
three are conceptual gaps, not wording gaps: each one lets a loop report a
passing or clean result while a real class of defect is never checked.

1. **Coverage has no forward anchor.** The Discover plane in
   `references/project-harness/agent-verify-loop.md` crosses three machine
   sources — runtime telemetry, code contracts, real usage samples — and every
   one of them reads the system as it already exists. Behavior that a spec,
   acceptance criterion, prototype, or interface contract promised but nobody
   implemented produces no telemetry, no code contract, and no usage sample, so
   it never enters the case inventory and can never be judged `fail`. A new
   feature with no traffic history has no anchor at all.
2. **`fail` has no defined continuation.** The reference ends at the verdict
   and the aggregate rules. `models/agent-work-loop.md` scores
   `failure-repair` and `validate-again` as evaluation checks, but no reference
   states the execution sequence: reproduce, localize, repair at the smallest
   owner, rerun *the same* case, record the round, and stop at a convergence
   bound. Without a stated bound and a same-case rerun requirement, a loop can
   loosen the assertion each round until the run turns green, or retry
   indefinitely.
3. **Drivers inside one plane are treated as interchangeable.**
   `references/project-harness/ui-and-system-drivers.md` groups every
   automation-protocol driver into one D1 technology class. For an agent they
   are not equivalent: what a driver emits after a failure — a structured step
   trace, a replay, a machine-readable report, or only logs — determines
   whether the agent can localize the break at all, and therefore the cost of
   gap 2. The same reference also lacks the case where the chosen plane is
   simply unreachable because of a tool boundary, and the degradation is a
   change of *evidence type* rather than a lower drive plane.

## Recorded Field Observations

Provenance: field material on AI-assisted cross-platform E2E verification
(traditional QA regression versus an agent-driven verify chain, a per-platform
tool matrix for Web/Android/iOS/mini-program/H5, a unified testing tool surface,
and a stated advantages-and-limits list), reviewed on 2026-08-04, plus the Codex
session scan already recorded in
`docs/specs/2026-08-04-drive-plane-selection.md`. No new services or tests were
run for this spec; these are design inputs, not runtime validation.

Observations that drive the changes below:

- The reviewed material anchors its assertion path on `Spec / AC / prototype /
  interface docs` and states the limit plainly: verification quality is bounded
  by the quality of the spec and the check plan, and behavior absent from the
  spec will not be verified for you. Our Discover plane has no equivalent
  source.
- Its evidence chain names a repair record holding root cause, diff, and round
  number as a first-class output, i.e. the repair loop is expected to be
  multi-round and recorded, not implicit.
- Within one plane the material separates drivers by what the agent can consume:
  an execution trace viewer plus an official tool-surface integration, a cloud
  failure replay with flaky management, or a legacy grid where the stated
  guidance is that the agent should drive a wrapped domain command rather than
  raw WebDriver.
- Its mini-program case is an explicit tool-boundary degradation: element-level
  UI automation was limited by the vendor devtools, so that part was degraded to
  API plus database assertions, the degradation decision was recorded, and
  visual detail moved to human sampling. The stated conclusion — admitting the
  tool boundary and recording it beats forcing an unstable automation — matches
  the flaky-verdict hazard we already record.
- Its H5/WebView row verifies that the core path still completes under degraded
  runtime capability (constrained network, older engine, missing API, failing
  bridge) and explicitly does not require pixel equality. Our Fidelity Ladder
  answers how real the dependencies are and has no row for how degraded the
  target runtime is.
- Its stated limits include that aesthetic and experience judgment stays human,
  which is the residual-gap owner that a degraded case must name.

Deliberately not adopted, with reasons recorded so the boundary is reviewable:

- A concrete unified testing tool-surface inventory (test listing, page/app
  open, snapshot, cross-platform input, log and trace retrieval, case
  generation). `references/project-harness/friendly-cli.md` already owns the
  one-contract-many-surfaces rule and the MCP projection; duplicating a tool
  list would split that ownership. Only the verification-side consequence is
  adopted: cross-platform verdicts must normalize to one verdict domain and one
  result schema before the aggregate rules can run at all.
- A fixed five-file artifact set (step report, fix log, decision record,
  evidence directory, management one-pager). That is one methodology's output
  layout; prescribing filenames for other projects exceeds what a reference
  should own. Two transferable properties are adopted instead: evidence is
  addressed per run and append-only within a run, and probe output is layered
  for its three readers.
- The traditional-QA pain list and the three-way Web tool comparison. Selection
  background; the part that matters for a harness is already covered by the
  diagnostic-artifact filter.

## Acceptance Scenarios

- **VIR-AC-1 (intent as a discovery source):** The Discover plane records
  intent sources — specification, acceptance criteria, prototype or design
  contract, interface contract — alongside the three existing machine sources,
  and states that the first three read the system as built while intent states
  what was promised.
- **VIR-AC-2 (promised-but-absent behavior is a case):** The reference states
  that the difference between promised behavior and implemented contract is
  itself coverage: such a case is admitted and judged, and the absence of a
  surface to observe makes it `fail` or `blocked`, never a reason to omit the
  case. It also states that verification coverage is bounded by the recorded
  intent, so unwritten behavior is unverified behavior.
- **VIR-AC-3 (post-failure sequence):** The reference defines the sequence that
  follows a non-passing verdict — reproduce on the same correlation handle,
  localize with the cheapest sufficient diagnostics, attribute to the smallest
  correct owner, repair, rerun the same case identity, record the round — and
  requires the rerun to use the same case id, assertions, and judging mode.
- **VIR-AC-4 (round record and convergence bound):** The reference states what
  each repair round records (round number, root-cause hypothesis, change scope,
  rerun verdict), requires each round to advance a different hypothesis, and
  requires a pre-agreed round bound after which the case becomes `blocked` for a
  human rather than retried further.
- **VIR-AC-5 (same-cause sweep):** The reference requires a repaired root cause
  to be swept across other cases and surfaces that share the same pattern, with
  matches entering the skeleton through the existing human gate.
- **VIR-AC-6 (flaky registration):** The reference requires a case whose verdict
  oscillates on the same revision to be registered as flaky, states that a flaky
  case contributes as `unobserved` to the aggregate verdict until the
  nondeterminism source is pinned, and adds `flaky` to the regression-skeleton
  `status` domain.
- **VIR-AC-7 (layered probe output and append-only evidence):** The Judge-plane
  design constraints require probe output layered for its three readers
  (machine verdict, diagnostic detail, human-readable summary) and require
  collected evidence to be addressed per run and append-only within a run.
- **VIR-AC-8 (cross-platform verdict normalization):** The reference states that
  cases driven by different per-platform tools must normalize to the same
  four-valued verdict domain and result schema before the aggregate rules apply,
  and routes wrapper and surface design to `friendly-cli.md`.
- **VIR-AC-9 (diagnostic artifact as a second filter):** `ui-and-system-drivers.md`
  records that drivers within one plane differ by the failure evidence they emit
  for an agent, classifies those artifacts, states what the agent can do after a
  `fail` with each, and states that the agent should drive a wrapped
  task-oriented command rather than a raw driver API.
- **VIR-AC-10 (unreachable plane degradation):** `ui-and-system-drivers.md`
  defines what to do when a tool boundary makes the chosen plane unreachable:
  degrade by changing evidence type rather than by lowering the drive plane,
  record the forfeited evidence class, the substitute evidence, and the owner
  and cadence of any human sampling, and record the decision. It states that
  such a case is not wholesale `unobserved` — the substitute evidence carries
  its own verdict and the forfeited part is a named residual gap in
  `constraints`.
- **VIR-AC-11 (degraded runtime capability):** `verification-environment.md`
  records a claim row for core-path completion under degraded target-runtime
  capability, with its minimum credible environment and what it does not prove,
  stating that the judgment is functional completion rather than pixel equality.
- **VIR-AC-12 (anti-patterns):** New anti-patterns are recorded for
  system-only coverage, repairing until green by loosening the judge, unbounded
  repair rounds, treating an oscillating verdict as a pass, and forcing an
  unstable driver at a known tool boundary instead of degrading and recording.
- **VIR-AC-13 (link integrity):** All relative Markdown links resolve and
  `docs/better-harness-doc-links.mmd` is regenerated so the routing graph is not
  stale.

## Non-goals

- Add a new reference file. All three gaps land in existing owners; the domain
  README `Owns` list is unchanged.
- Prescribe artifact filenames, directory layouts, or a report schema for other
  projects.
- Define a testing tool-surface inventory or MCP tool list; `friendly-cli.md`
  owns surface design.
- Renumber or extend the four planes, the D0..D4 drive planes, the Fidelity
  Ladder rungs, or the four-valued verdict domain. `flaky` is added to the
  skeleton `status` field, which is an open enumeration, not to the verdict
  domain.
- Add rows to the Scenario Families table, or endorse any named tool or vendor.
- Change scoring models, report schemas, skills, scripts, templates, hooks, or
  host adapters. `models/agent-work-loop.md` keeps ownership of the Change
  Validation checks; this spec adds the reference-side execution sequence only.

## Plan and Tasks

1. `references/project-harness/agent-verify-loop.md` Discover plane: add intent
   sources as a fourth source, restate how the four sources patch each other,
   and state the promised-versus-implemented difference as coverage
   (VIR-AC-1, VIR-AC-2).
2. Same file, Judge plane: extend the output design constraint to three reader
   layers and add the per-run append-only evidence rule (VIR-AC-7).
3. Same file: add a section after Plane 4 defining the post-failure sequence,
   the round record, the convergence bound, the same-cause sweep, and flaky
   registration; adjust the existing `Rollout` failure paragraph to point at it
   instead of restating it (VIR-AC-3..VIR-AC-6).
4. Same file: add `flaky` to the regression-skeleton `status` domain
   (VIR-AC-6), add the cross-platform verdict-normalization statement with the
   route to `friendly-cli.md` (VIR-AC-8), and add the new anti-patterns
   (VIR-AC-12).
5. `references/project-harness/ui-and-system-drivers.md`: add the
   diagnostic-artifact second filter after the technology-class table
   (VIR-AC-9) and a section for an unreachable plane (VIR-AC-10), plus the
   forced-plane anti-pattern (VIR-AC-12).
6. `references/project-harness/verification-environment.md`: add the
   degraded-capability runtime row to the claim table (VIR-AC-11).
7. Verify relative-link resolution and routing-graph freshness, then run the
   focused model test and the full suite (VIR-AC-13). All three edited files sit
   outside the `skills/better-harness` seed chain, so
   `docs/better-harness-doc-links.mmd` is expected to stay unchanged; confirm
   that rather than assuming it.
8. Run a Review Readiness Check over the local diff before review.

## Test and Review Evidence

Implemented on 2026-08-04:

- `node --test test/doc-link-graph.test.mjs` — the repo-wide relative-link
  resolution check passes, covering the new routes to `friendly-cli.md` from
  both `agent-verify-loop.md` and `ui-and-system-drivers.md` (VIR-AC-13).
- `docs/better-harness-doc-links.mmd` needs no update for this change: the
  routing graph is seeded from `skills/better-harness`, and the three edited
  files are outside that seed chain (`friendly-cli.md` appears zero times in the
  committed graph). No node or edge in the graph belongs to this change.
- `node --test test/maturity-models.test.mjs` — 3/3 pass; consumer integrity for
  the edited references.
- `npm test` — 1148/1149 pass. The single failure,
  `Better Harness skill's English-first Markdown chain stays Han-script-free`,
  is **not** attributable to this change: it reports pre-existing Han text in
  `docs/specs/2026-07-30-supported-host-entrypoints.md` and
  `docs/i18n/zh-Hans/**`, pulled into the SKILL.md-reachable chain by a
  concurrent unrelated change in the same working tree that added a
  `support-bootstrap.md -> references/agent-customize/routing.md` edge. All
  three files edited here are Han-script-free and none is reachable from
  `SKILL.md`. Verified by stashing: the same test passes on `HEAD` alone.
- `git diff --check` — clean.
- VIR-AC-1..VIR-AC-12: manual contract review against the new headings, list
  items, tables, and anti-patterns in `agent-verify-loop.md`
  (`After a Non-Passing Verdict`, Discover source 1, Judge output constraints,
  Scenario Families normalization paragraph, skeleton `status` domain, four new
  anti-patterns), `ui-and-system-drivers.md`
  (`Diagnostic Artifacts Are a Second Filter`,
  `When the Chosen Plane Cannot Be Reached`, one new anti-pattern), and
  `verification-environment.md` (degraded-capability claim row plus the
  capability-degradation paragraph).
