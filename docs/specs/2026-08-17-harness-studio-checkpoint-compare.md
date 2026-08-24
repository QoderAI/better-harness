# Checkpoint-anchored multi-lane harness experiments

## Traceability

- Spec ID: harness-studio-checkpoint-compare
- ADR: [Harness Checkpoint Experiment Compare](../adrs/harness-checkpoint-experiment-compare.md)
- Source ADR: [Checkpoint-backed Compare Sources and Materialization](../adrs/checkpoint-backed-compare-sources.md)
- Status: Slices 1, 3, 4, 5, and 6 implemented; Slice 2 dirty-state replay pending

## Intent

Let a Studio user pick one Git checkpoint, replay the observed historical
trajectory beside two freshly executed lanes from that same checkpoint, and read
one attribution verdict per comparison instead of a single global verdict.

The `.harness` grammar and the `session-execution-plan-v1` checkpoint contract do
not change. A sandbox stays a per-lane materialization of the one checkpoint. The
new surface is an experiment manifest that references a checkpoint, declares N
lanes of mixed origin, and lets the runner *derive* what each comparison is
allowed to conclude.

This spec covers three slices. Slice 1 is the evidence semantics: the manifest
contract, derived treatment axes, observed-lane degradation, and per-contrast
decisions. Slices 2 and 3 add checkpoint materialization and the Studio
experiment lifecycle on top of the same contract.

## Acceptance Scenarios

### Slice 1 — experiment contract and evidence semantics

- AC-1: `harness-experiment.v1` validates a manifest holding a `checkpointRef`
  (plan path plus digest) and never a copy of checkpoint fields. Loading resolves
  manifest-owned relative paths, rejects absolute, backslash, and `..` paths, and
  rejects any path escaping the manifest directory.
- AC-2: a lane is either `origin: "observed"` (trajectory path plus the
  checkpoint digest it started from, and optional identity evidence) or
  `origin: "execute"` (harness id, trial count, and per-lane runtime profile and
  model). Host, visible tools, and the run policy stay shared across lanes, so a
  lane cannot silently move the host.
- AC-3: a contrast declares only its `id` and the lane ids it compares. A
  manifest that declares `axis` or `mode` on a contrast is rejected, because the
  axis is a derived fact about lane configuration, not an author's claim.
- AC-4: `deriveContrastAttribution` computes the moved axes by diffing the
  contrast lanes' harness id, runtime profile, and model. Exactly one moved axis
  over exactly two execute lanes yields `attributable` with that axis. Zero moved
  axes, more than one moved axis, more than two lanes, or an unmatched observed
  lane yields `descriptive` with a named reason and the full moved-axis list.
- AC-5: an observed lane is matched baseline evidence only when every identity
  fact is present and equal to the fresh lanes — harness id, revision id, runtime
  profile, model, environment receipt — its prompt hash equals the experiment task
  prompt hash, and the checkpoint completeness receipt is not `unverified`.
  Otherwise it is contextual evidence and the contrast is descriptive.
  `evaluateObservedLane` names each missing fact so a reader can see why.
- AC-6: an attributable contrast is decided by the existing
  `harness-compare.v1` ladder — `aggregateVariant`, `summarizeMatchedPairs`, and
  `decideVerdict` under `normalizeDecisionPolicy` — so the two-matched-pair floor
  still applies. A contrast whose lanes ran once each therefore reports
  `insufficient_evidence`, never `accept`. A descriptive contrast reports status
  `descriptive` and can never report `accept` or `reject`.
- AC-7: `buildExperimentCompareSet` emits `harness-compare-set.v2` with one
  aggregate per lane, one result per contrast, the shared checkpoint digest and
  completeness receipt, the task prompt and grader hashes, and the decision
  policy the contrasts were judged under. Observed lanes may carry no grade, so
  they aggregate as observed rows without inventing a score.
- AC-8: focused tests cover manifest acceptance and each rejection reason, axis
  derivation for the harness, runtime-profile, model, multi-axis, and no-axis
  cases, observed-lane degradation per missing fact, single-run contrasts
  reporting insufficient evidence, and descriptive contrasts never carrying a
  promotion status.

### Slice 2 — checkpoint materialization and parallel lanes

- AC-9: every lane clears preflight (checkpoint digest, base commit and tree,
  session digest and entry) before any lane starts executing.
- AC-10: materialization records a checkpoint completeness receipt: a clean-tree
  assertion or a captured dirty-state patch applied identically to every fresh
  lane. An `unverified` receipt keeps observed lanes contextual.
- AC-11: worktree creation is serialized to avoid Git lock contention; lane
  execution then runs in parallel and one lane's failure preserves the other
  lanes' evidence.
- AC-12: every emitted event carries `experimentId`, `laneId`, and `runId`; each
  lane persists its own revision, runtime and sandbox receipts, trajectory,
  patch, and grade under a per-lane evidence directory. Results stay on
  namespaced refs and no user branch is switched.

### Slice 3 — Studio experiment lifecycle

- AC-13: Studio creates an experiment, streams per-lane events, and supports
  cancellation, instead of the single stateless `/agui` run.
- AC-14: the configuration surface shows which axes the current lane setup moves
  and marks a comparison descriptive before it runs.
- AC-15: the three-column view synchronizes turn, tool call, file, and patch
  selection, pins the shared checkpoint and task identity, and renders one
  verdict per contrast with no global aggregate verdict.
- AC-16: live ACP-derived tool events are normalized into an inspectable
  cross-lane key (tool name, resource target, and canonical arguments). Selecting
  a tool call in any lane locates its best one-to-one match in the other lanes
  and labels the relation `exact`, `same-resource`, `same-tool`, or `none`; a
  numeric similarity score alone is never presented as provenance.
- AC-17: Studio visualizes the local tool chain around the selection — previous,
  selected, and next call — so a reviewer can distinguish “both read the same
  file” from “both followed the same read → edit → test path.” Matching remains
  monotonic within a lane, preventing one repeated `Read` call from being reused
  as the apparent counterpart of several calls.
- AC-18: the experiment view defaults to monitoring-console density. At a
  1200×900 viewport the shared identity, attribution preview, all three lane
  headers, and at least six tool rows are visible without page-level horizontal
  scrolling. At narrower widths, horizontal scrolling is contained by the trace
  matrix rather than widening the document. Shared identity and lane runtime
  facts are each rendered once; the selected local chain is an inline inspector,
  not a second full-size comparison board.
- AC-19: Studio may replay a real imported trajectory whose starting Git
  checkpoint was not recorded. Such a lane omits `startCheckpointDigest`, is
  labelled `checkpoint unknown`, and is always contextual evidence with a named
  `startCheckpointDigest` gap. A recorded digest that differs from the shared
  checkpoint remains a manifest error. The UI must never turn an absent digest
  into a claim that history and fresh lanes share a start.
- AC-20: the experiment surface adopts the Inspector Workbench information
  architecture rather than stacking independently floating cards: a fixed or
  collapsible context rail owns checkpoint, task, lane, and contrast setup; a
  42 px workspace header owns navigation and aggregate metrics; and one
  continuous workbench owns the selected call, three adjacent lanes, local
  chain, and contrast results. At 1024×576, the workbench begins within 12 px of
  the workspace header, lane rows are at most 30 px high, adjacent lanes have no
  card gap or separate shadow, and the document does not scroll horizontally.
  At narrow widths, the context rail collapses and horizontal scrolling remains
  inside the lane board.
- AC-21: the comparison object bar gives every lane an evidence role instead of
  presenting three interchangeable columns. An imported trajectory is
  `Context`; the first fresh lane is the default `Baseline`; the second fresh
  lane is the default `Candidate`. The baseline and candidate can be selected
  without mutating the manifest or creating another sandbox.
- AC-22: a persistent comparability summary classifies the focused pair as
  `Controlled`, `Partial`, `Observational`, or `Incomparable`, and names the
  decisive limitation. One trial per fresh lane is therefore `Partial` even
  when exactly one treatment axis moved; an unmatched historical trajectory is
  `Observational`, never a baseline claim.
- AC-23: the focused comparison exposes five working views — `Summary`,
  `Activities`, `Calls`, `Changes`, and `Evidence` — while preserving the live
  ACP stream. Switching views does not reset lane data or selection. Summary
  keeps outcome, process, efficiency, and evidence confidence above the raw
  trace rather than below a long log wall.
- AC-24: Calls defaults to the focused baseline/candidate pair and provides a
  call-name/resource filter, synchronized selection, `Diff only`, and a compact
  overview strip. Rows retain one-to-one monotonic alignment and expose the
  relation basis (`exact`, `same-resource`, `same-tool`, or `none`). The UI does
  not invent timestamps, duration, token, or cost fields that the ACP evidence
  did not record.
- AC-25: multi-lane context remains reachable from the object bar, but the
  detailed work area compares one pair at a time. Choosing a different
  baseline or candidate recomputes the focused relations from existing lane
  evidence and does not change the experiment contract, checkpoint, or run.
- AC-26: Activities groups observable tool calls into derived engineering
  phases (`Orient`, `Discover`, `Change`, `Execute`, `Diagnose`, `Recover`,
  `Verify`, and `Deliver`) and highlights the first divergent phase. A phase is
  a UI projection from tool names, resources, statuses, and commands; it is not
  presented as agent intent or causal proof.
- AC-27: Changes and Evidence separate observed facts from explanations and
  conclusions. Shared file/resource access states its matching basis and
  limitation; verdicts retain their per-contrast status and reason. A shared
  path never becomes an authorship, correctness, or causality claim.
- AC-28: at 1024×576 the object roles, comparability, view tabs, focused pair
  headers, and at least six call rows are reachable without document-level
  horizontal scrolling. At 390 px the rail collapses, controls wrap without
  clipping, and horizontal overflow is contained by the focused comparison.
  Primary controls are semantic buttons or inputs with visible focus states,
  and trace text is at least 11 px.

### Slice 4 — checkpoint-backed Compare Builder

- AC-29: Studio introduces a Builder before the Workbench. It presents
  `Historical Replay` and `New Request Compare` as distinct scenarios, shows the
  locked request and variants, and enters the existing compact Workbench only
  after the user reviews and locks the draft. A scenario choice never creates a
  sandbox or isolated copy.
- AC-30: the server derives a source-neutral checkpoint preview from the
  validated checkpoint adapter. The browser receives display-oriented adapter,
  resource, revision, optional history, and materialization facts; it does not
  receive or require a Git-shaped checkpoint schema.
- AC-31: the first adapter projects the current session execution plan as a
  repository resource, commit/tree revision, session/entry history position,
  and detached-worktree materialization. Studio renders those facts through the
  generic projection and contains no `source.kind === "git"` layout branch.
- AC-32: Builder preflight names how many isolated lane materializations will be
  created and states that they are created only on Run. It exposes missing
  historical checkpoint or identity facts before execution and never promotes
  an unmatched observed lane to a baseline.
- AC-33: the Variant matrix exposes every lane's evidence role, origin, harness,
  model, profile, and trial count in one dense table. The current slice reviews
  the loaded locked definition; authoring arbitrary providers and persisting a
  new manifest remain follow-up work and are not simulated by controls that do
  not affect execution.
- AC-34: focused model tests prove scenario derivation, generic source rendering
  inputs, materialization counts, and historical identity gaps. Server tests
  prove the projected setup contract, and Playwright proves Builder -> lock ->
  Run -> live Workbench against the real project fixture without console or page
  errors.

### Slice 5 — history discovery, resolve, and durable lock

- AC-35: Studio consumes history through a server-side checkpoint history
  adapter. The browser sees opaque item ids, adapter-owned labels, request
  previews, and timestamps; it never receives source filesystem paths or a
  Git-, session-, or PPTX-shaped discovery record.
- AC-36: `GET /api/checkpoint-history` lists bounded project history and
  `POST /api/checkpoint-history/resolve` resolves one opaque id into a generic
  checkpoint projection plus request provenance. Resolve validates the
  checkpoint digest and referenced prompt/trajectory bytes but creates no
  worktree, sandbox, document copy, result ref, or experiment evidence.
- AC-37: `POST /api/experiment/lock` is same-origin and locks the selected
  resolved item against the currently loaded experiment template. It writes an
  immutable, content-addressed lock directory containing the manifest,
  checkpoint plan, request, observed trajectory, harness, grader contract, and
  source-backed skill trees required by the harness. A partial write never
  becomes active.
- AC-38: Studio switches its active experiment only after the locked manifest
  passes the existing `harness-experiment.v1` loader. Subsequent preview and Run
  requests use that locked manifest; a failed resolve or lock leaves the prior
  experiment active.
- AC-39: the compact Builder exposes loading, empty, resolving, resolved,
  locking, locked, and error states for the History picker. Selecting another
  item updates checkpoint and request previews before lock, while the Variants
  matrix remains the loaded template. The primary action names the selected
  lock operation and remains disabled until preflight is ready.
- AC-40: a history adapter explicitly marks whether its request bytes and
  starting checkpoint were verified by the source. Studio sets `promptHash`
  and `startCheckpointDigest` on the observed lane only for the respective
  verified facts; unverified imports retain named evidence gaps.
- AC-41: the first file-backed catalog adapter accepts
  `checkpoint-history.v1`, enforces portable catalog-owned paths, unique ids,
  bounded item count, SHA-256 checkpoint identity, and readable prompt and
  trajectory sources. `--history-catalog` enables it without making that file
  format the generic adapter contract.
- AC-42: focused tests cover catalog traversal rejection, resolve without
  materialization, verified and unverified provenance, atomic lock output,
  active-manifest switching, same-origin mutation guards, Builder selection and
  lock interaction, and a non-Git injected adapter projection.

### Slice 6 — compare vocabulary and browser boundary hardening

Slice 6 supersedes the presentation-specific portions of AC-21, AC-23, AC-26,
and AC-27: `Reference` replaces `Context`, and the five top-level views become
three views with phase and resource projections inside Trace. Their evidence
semantics and limitations remain unchanged.

- AC-43: Studio names the checkpoint-backed workflow `Compare` and the frozen
  `harness-compare-result.v1` reader `Results`; it never presents adjacent
  `Experiment` and `Compare` tabs whose relationship is unexplained.
- AC-44: one role vocabulary spans Builder and Workbench: the imported run is
  `Reference`, the first focused fresh run is `Baseline`, and the other is
  `Candidate`. Primary UI copy says `run` or `comparison`; `lane`, `contrast`,
  `materialization`, and provider adapter identifiers stay in technical details.
- AC-45: Builder's visible setup summary names the actual derived treatment
  axis and values, such as `Profile · default vs minimal`. Equal harness ids are
  not presented as the difference between fresh runs. If no single axis is
  isolated, the summary says so before Run.
- AC-46: Builder behaves as a compact confirmation surface rather than a false
  multi-step authoring wizard. A history-backed draft has one primary choice,
  one comparison summary, and one truthful action. A disabled history adapter
  may open an already loaded definition; loading or failed history cannot expose
  an action labelled as a lock that performs no lock request.
- AC-47: Workbench exposes `Summary`, `Trace`, and `Evidence`. Trace groups calls
  by observable phase and offers `Calls` and `Resources` lenses without losing
  selection, filters, or one-to-one tool alignment. The removed Activities and
  Changes tabs do not retain duplicate projections elsewhere.
- AC-48: one title-bar control owns Run and Cancel. Run identity is rendered
  once per visible run, checkpoint identity once in the shared context, and
  role cards themselves select the focused Baseline and Candidate without a
  second pair of dropdowns.
- AC-49: provider-specific observed trajectory shapes are normalized on the
  server. The browser receives only canonical tool-call projections for loaded
  history and canonical stream events for fresh runs; React code contains no
  ACP, AG-UI, or Anthropic provider-shape branches.
- AC-50: comparability, role selection, pair-result lookup, relation counts,
  resource ledgers, and canonical event folding live in pure tested modules.
  The React controller reuses the shared SSE parser rather than owning another
  blank-line framing implementation, and Builder and Workbench are separate
  reviewable components.

## Non-goals

- Extending `harness-compare.v1`. It stays the frozen-fixture, two-variant path,
  and its persisted `harness-compare-result.v1` consumers are untouched.
- Changing the `.harness` grammar, the IR, or the checkpoint contract.
- Defining Git as the generic checkpoint source contract. Git/worktree is the
  first adapter; versioned PPTX and other resource adapters retain their own
  canonical checkpoint and materialization formats.
- A `host` treatment axis. A single experiment runs one host; cross-host
  comparison needs its own confounding analysis.
- Reconstructing environment state the historical trajectory depended on beyond
  what the completeness receipt can capture as a patch.
- Promoting or adopting any lane's result commit. Adoption stays an explicit
  later user action against the namespaced ref.
- Grading observed trajectories that predate the grader contract.
- Scanning raw Qoder, Codex, or other host-private session stores inside the
  Studio package. Host/session analyzers may produce a catalog or implement the
  adapter interface; Studio owns selection and locking, not provider storage.
- Editing the locked historical prompt in place. Any edited request becomes a
  New Request Compare with a new request identity.
- Removing evidence degradation, the matched-pair floor, per-contrast verdicts,
  or the frozen `harness-compare-result.v1` reader. Slice 6 reduces presentation
  duplication; it does not weaken comparison semantics or migrate old results.

## Plan and Tasks

1. Split the contract by runtime need. `packages/harness/src/experiment/contract.ts`
   owns the `harness-experiment.v1` TypeBox schema, lane types, and pure lane
   predicates with no Node imports;
   `packages/harness/src/experiment/manifest.ts` owns
   `loadHarnessExperimentManifest` and the validation that needs real paths —
   unique lane and contrast ids, contrast lane references, at least one execute
   lane, observed lanes starting from the referenced checkpoint, and portable
   manifest-owned paths.
2. Add `packages/harness/src/experiment/axis.ts` with the derived
   `ExperimentTreatmentAxis`, `deriveContrastAttribution`, and
   `evaluateObservedLane`. Keep the axis derived from lane configuration so a
   manifest cannot label a multi-axis comparison as single-axis.
3. Add `packages/harness/src/experiment/compare-set.ts` with
   `ExperimentTrialResult`, per-lane aggregation, contrast projection onto the
   existing baseline/candidate pair shape, `decideContrast`, and
   `buildExperimentCompareSet`. Reuse the `compare/aggregate.ts` ladder rather
   than restating thresholds, so the matched-pair floor cannot drift.
4. Add `packages/harness/src/experiment/checkpoint.ts` with the
   `CheckpointCompleteness` receipt union that slice 2 will produce and slice 1
   already consumes in the observed-lane rule.
5. Export two entries: `@qoder-ai/harness/experiment/evidence` for the
   browser-safe semantics Studio will render, and `@qoder-ai/harness/experiment`
   for the same surface plus the Node loader. Mirror the boundary
   `compare/verdict` already draws, and extend `test/module-graph.test.ts` to
   enforce it. Ship an example manifest under
   `packages/harness/examples/checkpoint-experiment/`.
6. Add `packages/harness/test/experiment.test.ts` covering AC-1 through AC-8 by
   calling the exported functions and asserting returned shapes and statuses.
7. Add a Studio experiment stream with lane-scoped lifecycle and ACP events.
   Normalize tool calls in a pure browser module, align calls monotonically, and
   render the selected cross-lane relation and local chain in a three-column
   trace matrix before showing per-contrast result cards.
8. Add a Node experiment runner that verifies the referenced plan bytes and
   `session-execution-plan-v1` contents before materialization, creates detached
   worktrees serially, executes prepared jobs through an injectable executor in
   parallel, and persists lane-scoped evidence and namespaced refs. The current
   implementation records a dirty source workspace as `unverified`; applying a
   captured dirty-state patch identically to every fresh lane remains open.
9. Tighten the Studio information hierarchy into one compact experiment bar,
   one three-lane trace matrix, an inline selection inspector, and compact
   per-contrast result rows. Add viewport measurements to the browser test so
   “compact” is a behaviour contract rather than a screenshot impression.
10. Permit checkpoint provenance to be absent on imported observed lanes,
    propagate that absence into observed-lane eligibility, and exercise the UI
    with a real Better Harness Qoder transcript. Keep external transcript paths
    as demo/runtime input rather than shipping user history in the repository.
11. Recompose the experiment view from the Inspector Workbench primitives: one
    collapsible context rail, one 42 px workspace header, and one continuous
    lane board with divider-separated columns and an integrated evidence
    footer. Verify the source and implementation at the same 1024×576 viewport.
12. Replace the fixed equal-weight three-lane board with an object-role bar and
    a focused pair model. Derive `Context`, `Baseline`, and `Candidate` from the
    existing manifest; keep role changes local to the Studio view.
13. Add a source-neutral checkpoint setup projection at the Studio server
    boundary. Keep provider-specific plan validation in Node and pass only
    adapter-owned labels, revision values, history position, capabilities, and
    materialization timing to the browser.
14. Add a pure Builder model and compact setup surface before the Workbench.
    Derive the initial scenario from observed history, expose the loaded request
    and Variant matrix, name preflight gaps, and require an explicit Lock action
    before Run without pretending the first slice can persist arbitrary drafts.
15. Add Summary, Activities, Calls, Changes, and Evidence projections over the
    same normalized ACP calls. Calls owns filtering, synchronized selection,
    diff-only alignment, and the overview strip. Activities and Evidence must
    label their derivation and limitations rather than claiming hidden intent.
16. Add behaviour tests for role selection, comparability, view persistence,
    filtering, diff-only alignment, focused synchronization, semantic phases,
    evidence boundaries, and responsive overflow. Repeat visual QA against the
    selected W&B Weave comparison reference while retaining Better Harness
    checkpoint and attribution semantics.
17. Add a browser-safe history-list and resolved-draft model plus a server-only
    `CheckpointHistoryAdapter` interface. Implement the first bounded
    `checkpoint-history.v1` catalog adapter without exposing its paths to the
    browser.
18. Add list, resolve, and lock endpoints. Keep resolution read-only; make lock
    content-addressed and atomic, copy the template's executable assets and
    source-backed skills, validate the resulting manifest, and only then switch
    the server's active experiment path.
19. Add the compact History picker to the existing Builder. Preserve the
    current template's Variants matrix, project the selected checkpoint/request
    before lock, and reinitialize lane evidence from the locked preview before
    opening Workbench.
20. Add catalog, lock, server, CLI, and browser behavior tests, then repeat the
    real-project browser run with an actual catalog item and verify that no lane
    materialization exists before Run.
21. Rename the checkpoint-backed navigation entry to Compare and the frozen
    evidence reader to Results. Use Reference/Baseline/Candidate consistently
    and move implementation vocabulary out of primary labels.
22. Derive a Builder treatment summary from the server-projected contrasts and
    lane runtime values. Collapse the setup to history selection, comparison
    summary, and a state-truthful action.
23. Extract Builder, Workbench, shared view types, and pure comparison helpers
    from the React controller. Add behavior tests for comparability and display
    roles instead of matching source text.
24. Normalize imported and live provider events at the server boundary, return
    canonical calls/events, and consume the existing SSE parser in the browser.
25. Merge Activities and Changes into Trace lenses, remove duplicate run
    controls and identity strings, make role cards select the focused pair, and
    repeat real-project browser QA at the compact viewport.

## Test and Review Evidence

- AC-1 through AC-8 and AC-19: `npm test -w @qoder-ai/harness` — 17 files and
  156 tests pass. The experiment tests load real manifest fixtures from a temporary
  directory and assert loader results, derived attribution objects,
  observed-lane missing-fact lists, and contrast statuses. AC-6 is proved by a
  counterfactual: one set of trial rows judged twice, reaching `accept` when the
  lanes move one axis and `descriptive` when they move two.
- Repository suite: `npm test` — 95 files and 1325 tests pass, so the new
  subpath exports do not disturb CLI, governance, or doc-link checks.
- Module boundary: `test/module-graph.test.ts` asserts the emitted
  `dist/experiment/evidence.js` graph reaches neither `node:` builtins nor the
  manifest loader, so slice 3 can import the evidence semantics into Studio's
  browser bundle. It asserts the built artifact deliberately, because `import
  type` is indistinguishable from a real import when lexing TypeScript source.
- Packaging: `npm pack --dry-run --ignore-scripts -w @qoder-ai/harness --json`
  includes `dist/experiment/*` with declarations and the
  `examples/checkpoint-experiment/` manifest.
- Risk: a second manifest schema invites drift from `harness-compare.v1`. The
  mitigation is that slice 1 owns no thresholds of its own; every promotion
  decision is delegated to `decideVerdict` under `normalizeDecisionPolicy`.
- Risk: an experiment with one run per lane looks like a comparison but is a
  smoke test. The mitigation is structural rather than documentary: the shared
  ladder returns `insufficient_evidence` below two matched pairs.
- Risk: an observed trajectory is easy to mistake for a matched baseline. The
  mitigation is that eligibility requires every identity fact including prompt
  hash equality, which historical sessions almost never satisfy, and the missing
  facts are reported rather than silently ignored.
- Risk: slice 1 validates the `checkpointRef` digest and path but does not open
  the referenced plan, so a manifest can name a checkpoint that no longer
  resolves. Slice 2's preflight (AC-9) is where that becomes an error; until
  then the reference is a recorded claim, not a verified one.
- Risk: fuzzy matching can look like causal proof. Studio therefore exposes the
  matching basis (`tool`, `resource`, canonical arguments, and neighbouring
  calls), reserves `exact` for identical normalized inputs, and renders `none`
  rather than forcing every call into a pair.
- AC-9, AC-11, and the clean-tree portion of AC-10/AC-12:
  `packages/harness/test/experiment-runner.test.ts` creates a real temporary Git
  repository and Pi checkpoint plan, proves two prepared lanes overlap in
  execution, reads the persisted compare set, checks namespaced result refs, and
  confirms temporary worktrees were removed. The dirty-state-patch branch of
  AC-10 remains pending; dirty workspaces deliberately produce `unverified`.
- AC-13, AC-14, AC-16, and AC-17: Studio tests cover preview, same-origin SSE,
  lane identity fields, cancellation, exact/same-resource/same-tool/none
  normalization, one-to-one monotonic alignment, and local chain projection.
  The Playwright flow starts a scripted two-lane executor, correlates both fresh
  traces against the recorded history trace, inspects per-contrast results, and
  asserts no console or page errors at 1200 px. AC-15 is complete for tool and
  resource synchronization; turn and patch-detail synchronization remain open.
- AC-18, AC-20, and AC-28: `npm test -w @qoder-ai/harness-studio` passes 5 files and 41
  tests; `npm run test:browser -w @qoder-ai/harness-studio` passes three flows.
  The 1024×576 flow measures the 230 px context rail, 42 px workspace header,
  compare surface at y=52 or above, adjacent focused-lane gap at most 1 px,
  a tool row no taller than 30 px with at least 11 px text, and more than six-row
  viewport capacity. The 390 px flow crosses the responsive breakpoint, proves
  the rail collapses to 46 px, and keeps the 720 px compare surface inside the
  workspace scroller without widening the document. A successful run also
  proves that completion metadata is not rendered as an error detail.
- AC-21 through AC-27: the browser flow asserts `Context`, `Baseline`, and
  `Candidate` object roles; the `Controlled` focused pair; two-column Calls;
  synchronized resource selection; filtering from six visible calls to one;
  `Diff only` reducing the pair from six rows to four; and working Summary,
  Activities, Changes, and Evidence tabs. It changes the candidate to history
  and observes `Observational`, then restores the fresh pair without rerunning.
  Unit tests prove phase projection for Discover, Change, Verify, Deliver,
  Diagnose, and Recover from recorded call facts.
- In-app browser QA repeated the completed deterministic experiment in the
  user's visible Studio surface. The core interaction readback matched the
  automated flow (`Diff only`: four rows; `npm test` filter: one row), all five
  views retained the same stream state, the history focus exposed its
  observational limitation, and the browser log contained no errors.
- Real-project runtime smoke: `test/fixtures/real-project-experiment-server.mjs`
  built a checkpoint plan at Better Harness commit
  `1a6b0a134f229a786e0338d86de440fc50dc05a0`, imported 84 real Qoder Tool Calls
  with unknown checkpoint provenance, and executed the default and minimal
  Qoder profiles in parallel detached worktrees. The final visual-QA run
  finished with 26 and 33 Tool Calls. The one-pair profile contrast correctly returned
  `insufficient_evidence`; the historical contrast remained `descriptive`.
  This live smoke supplements rather than replaces the credential-independent
  deterministic browser test.
- Real-project compare-workbench revalidation: the same Better Harness fixture
  streamed 84 imported historical calls while the redesigned Calls view updated
  both fresh lanes live. The final fresh traces contained 27 and 24 calls; both
  lanes finished, the focused pair remained `Partial` because it had one trial
  per lane, failure/recovery phases and same-resource links were visible, and
  the in-app browser log contained no errors.
- AC-29 through AC-34: `npm test -w @qoder-ai/harness-studio` passes 6 files and
  45 tests. The pure setup tests derive Historical Replay versus New Request
  Compare, count one materialization per fresh trial, retain unverified request
  provenance, and accept a PPTX-shaped versioned-file projection without any Git
  fields. Server tests cover the source projection in the experiment preview;
  the browser flow covers Builder -> Lock -> Workbench -> Run.
- Checkpoint-backed real-project smoke: the in-app browser loaded the current
  Better Harness checkout at `b80dccd3e3cc`, rendered repository, commit/tree,
  session position, and two detached-worktree materializations through generic
  adapter-owned labels, then ran the default and minimal Qoder lanes. Both lanes
  finished with two and three fresh calls beside 84 imported historical calls;
  the browser log contained no warnings or errors. Evidence persisted complete
  per-lane revision, materialization, runtime, sandbox, trajectory, patch, grade,
  and Git receipts on namespaced refs `cc89096` and `7759fc6`. No temporary
  experiment worktree remained. Because the source checkout was dirty and each
  lane had one trial, the compare set correctly retained `unverified`,
  `insufficient_evidence`, and `descriptive` limitations instead of promotion.
- Builder layout QA at 1024×576 measured document width 1024 px, content bottom
  492 px, and fixed footer top 509 px, so Scenario, Checkpoint, Request, Variants,
  historical gaps, and the Lock action remain visible without document-level
  horizontal scrolling. At the narrow in-app viewport, document width matched
  viewport width and the Variant matrix kept its overflow inside its section.
- Visual QA: the source-to-implementation comparison was repeated at the same
  1024×576 viewport. The Inspector source and Studio both use the fixed
  context rail, 42 px header, and one workbench beginning at y=52. The real run
  additionally exercised streaming status/count updates, a selected shared
  resource and its local chain, collapse behavior, and completed verdicts.
- AC-43 through AC-50: `npm test -w @qoder-ai/harness-studio` passes 9 files and
  59 tests, including pure treatment/comparability/role/resource projections,
  ACP/AG-UI/Anthropic server normalization, canonical browser folding, and the
  source-neutral lock/server cases. A run completion settles only the calls of
  the run that finished, so one lane's parallel trials cannot mark each other's
  in-flight calls unavailable. `npm run test:browser -w @qoder-ai/harness-studio`
  passes three flows. `npm test` passes 95 files and 1325 tests;
  typecheck, doc-link graph, and `git diff --check` also pass. In-app browser QA
  against the real Better Harness catalog showed `Profile · qoder-default-v1 vs
  qoder-minimal-v1`, one Run control, Reference/Baseline/Candidate roles, three
  top-level views, Calls/Resources lenses, and no console errors or document
  overflow. Both Qoder runs finished with canonical exact/same-resource links
  and a visible failed-read recovery chain.
- Known gap: `roleFor` labels a fresh run that is neither the focused baseline
  nor the focused candidate as `Candidate`. Every shipped manifest has exactly
  two fresh runs, so the case is unreachable today; a third fresh run needs its
  own unfocused role before that configuration is offered.
