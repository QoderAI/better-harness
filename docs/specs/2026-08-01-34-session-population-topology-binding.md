# Session population freeze must share the facts workspace qualification

## Traceability

- Spec ID: 34-session-population-topology-binding
- Story: QoderAI/better-harness#34
- Status: Implemented

## Intent

`harness evidence-bundle` freezes one shared Session population and then
requires the Session facts lane to report exactly the frozen eligible count.
The population is discovered through the `sources` command without the frozen
`topology`/`analysisScope`, so it admits Sessions through the lenient legacy
workspace match, while the facts lane re-qualifies the same frozen inventory
with the strict topology-scoped rules (`classifyWorkspaceCwd` plus
`qualifyWorkspaceSessionInventory`). Any Session admitted leniently but
rejected strictly (for example a transcript with conflicting workspace CWDs)
makes the two counts disagree deterministically, and the bundle fails closed
with `SESSION_POPULATION_BINDING_MISMATCH` even though every Session file is
valid. Both discovery and hydration must apply one identical qualification
policy so the frozen binding and the facts lane always agree.

## Acceptance Scenarios

- AC-1: `collectSessionPopulation` passes the frozen bundle `topology` and
  `analysisScope` to its `sources` discovery, so population discovery and the
  facts lane qualify Sessions under the same workspace-match policy.
- AC-2: A Claude evidence-bundle Session lane over a fixture home containing
  one clean workspace Session and one conflicting-CWD Session reports
  `eligibleSessions` and `selectedSessions` equal to
  `population.binding.eligible.count` instead of throwing
  `SESSION_POPULATION_BINDING_MISMATCH`; the conflicting Session is omitted
  from both paths.
- AC-3: The binding check itself remains fail-closed and unchanged; existing
  population, selection, and admission bindings keep their public shapes.

## Non-goals

- Relaxing or removing the `SESSION_POPULATION_BINDING_MISMATCH` fail-closed
  contract.
- Changing provider discovery formats, workspace qualification rules,
  fingerprints, or the active-Session omission policy.
- Changing lead selection, scoring, report schemas, or renderer behavior.

## Plan and Tasks

1. Add a focused red regression test in
   `test/better-harness-evidence-bundle.test.mjs` that drives
   `collectSessionPopulation` and `collectSessionEvidence` against a real
   Claude fixture home with one clean and one conflicting-CWD Session under a
   frozen repo-root topology.
2. Pass `topology` and `analysisScope` from the frozen context into the
   `sources` discovery inside `collectSessionPopulation`, mirroring the facts
   call in `collectSessionEvidence`.
3. Run the focused evidence-bundle and Session population suites, then the
   full repository gate.

## Test and Review Evidence

- Red run: the new regression test fails on the unfixed code with
  `SESSION_POPULATION_BINDING_MISMATCH` (population 2 vs facts eligible 1).
- AC-1/AC-2: `node --test test/better-harness-evidence-bundle.test.mjs`
- AC-3: `node --test test/session-population.test.mjs test/session-workspace-provider.test.mjs`
- Regression gate: `npm test`
