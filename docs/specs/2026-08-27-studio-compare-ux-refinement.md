# Clear and responsive live comparison

## Traceability

- Spec ID: studio-compare-ux-refinement
- Status: Implemented

## Intent

Make the default live Compare surface answer three user questions in order:
which project and Agents will run, what variable the run can honestly compare,
and what observable differences the two runs produced. Preserve the existing
resource-linked Tool Call evidence while making the setup and results usable at
390px without clipped controls or character-wide text.

## Acceptance Scenarios

- AC-1: At 390x844, Current project, both Agent selectors, Prompt, comparison
  scope, Advanced details, and Run compare remain fully inside the viewport,
  readable, and keyboard reachable. No paragraph or textarea collapses to a
  character-wide column.
- AC-2: Before Run, the surface names the selected Agent and effective model
  policy for each lane and states the observable comparison variables. Two
  effectively identical selections are labelled as a repeatability comparison;
  multiple changed variables are labelled descriptive rather than controlled.
- AC-3: A single checkpoint-bound project is presented as fixed context rather
  than as a one-option selector. The UI does not claim arbitrary project
  rebinding.
- AC-4: Run compare is the only visually primary action in the composer.
  Advanced details remains available as a lower-weight disclosure, and status
  copy explains readiness instead of saying only `Ready`.
- AC-5: Lane headers lead with the selected Agent, then show the effective model
  separately. `Agent default` is never presented as the Agent's primary name.
- AC-6: Completed results lead with a factual delta summary derived only from
  retained lane state and projected operations: lane outcome, shared/run-only
  resources, edits, and verification activity. It does not emit an aggregate
  quality score or single-trial winner.
- AC-7: Wide and compact resource comparison retains the symmetric three-column
  map. Narrow comparison renders each resource as one row header followed by
  full-width AI 1 and AI 2 operation sections, keeping inline Tool Call results
  owned by their originating lane.
- AC-8: Browser regression checks assert bounding rectangles for critical
  controls, meaningful minimum Prompt width, primary-action visibility,
  keyboard tab semantics, no document-level overflow, and screenshots at
  1440x900, 1024x768, and 390x844 with no console/page errors.

## Non-goals

- Add filesystem project discovery or implement the workspace chooser in this
  change.
- Rank an Agent or model from one comparison, add a composite score, or infer
  hidden intent from Tool Calls.
- Replace Messages or Advanced evidence, redesign Evidence results, or change
  experiment execution and ACP permission semantics.
- Add new Agent adapters or installation actions.

## Plan and Tasks

1. Add pure comparison-scope and factual-result projections beside the existing
   resource comparison model, with focused unit coverage.
2. Refactor the Simple Compare composer into fixed project context, explicit
   Agent/model lanes, one comparison-scope row, and one primary Run action.
3. Add the factual result summary above Resources/Messages and correct lane
   header hierarchy.
4. Override every Agent-catalog grid placement at the narrow breakpoint and
   stack each resource's two lane sections vertically.
5. Strengthen Playwright assertions around actual element bounds and retain
   screenshots for wide, compact, and narrow review.

## Test and Review Evidence

- AC-2/AC-6: comparison-model tests cover identical Agent-default lanes,
  lane-model changes, mixed Agent/model-policy attribution, shared/run-only
  resources, edits, verification, and failed lane state.
- AC-1/AC-3/AC-4/AC-5/AC-7/AC-8: built Studio Playwright checks inspect control
  bounds, Prompt width, action visibility, headers, resource stacking, tab
  keyboard behavior, overflow, screenshots, and console/page errors at all
  three design widths.
- Validation target: `npm run harness-studio:test`, the complete Studio browser
  spec, `npm run check`, documentation link-graph validation, and
  `git diff --check` under Node 24.
- Risk: a concise scope label can still overstate attribution. Derive it only
  from selected Agent ids, model policies, and lane models; call any multi-axis
  movement descriptive.
- Risk: stacking lanes can obscure cross-lane alignment. Keep a single resource
  header and stable AI 1 then AI 2 ordering, with full-width operation controls.
- Risk: summary copy can turn observations into a verdict. Use factual verbs
  such as observed, edited, verified, passed, failed, or cancelled and retain
  Advanced evidence for sufficiency and controlled attribution.

## Implementation Evidence

- `PATH="/opt/homebrew/opt/node@24/bin:$PATH" npm run check` passed: 1,545
  root tests with 2 skips, 172 Harness tests, 31 Harness UI tests, 293 Studio
  tests, generated-source checks, and package verification.
- `npx playwright test packages/harness-studio/test/browser/tool-call.spec.mjs`
  passed all 10 browser scenarios with empty console/page-error collections.
- Wide, compact, and narrow `bench-*.png` and
  `compare-resource-map-*.png` screenshots were inspected for hierarchy,
  clipping, overflow, and resource-to-lane association.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed all 8 link
  graph checks after regenerating `docs/better-harness-doc-links.mmd`; the
  graph remained unchanged.
- `git diff --check` passed, and the change adds no generated or package
  artifacts to the worktree.
