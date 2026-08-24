# Trace user inputs to workspace files

## Traceability

- Spec ID: studio-user-input-trace
- Status: Ready for Review

## Intent

Give a Studio user one workspace-scoped view of every retained user Turn and
the exact repository files observed as read or targeted by an edit operation while the agent handled
that Turn. This establishes the smallest trustworthy input-to-execution link
before Better Harness groups inputs into versioned Intents.

## Acceptance Scenarios

- AC-1: Opening a local workspace enables an `Inputs` Studio destination that
  lists every retained user Turn across the discovered providers and Sessions,
  ordered newest first, without using the capped Session prompt-summary list as
  its source of truth.
- AC-2: Each input reports only exact, repository-relative file links retained
  by its Turn's normalized tool steps. `read-files` links are classified as
  `read`; `edit-files` links are classified as `edit-targeted` because a tool
  target does not prove a content delta. Repeated calls to the
  same path aggregate call ids and counts without duplicating the path.
- AC-3: The left pane presents the linked paths as a deterministic, virtualized
  file tree with collapsible directories and standard tree keyboard navigation.
  Selecting an input highlights its files; selecting a file filters the input
  list to Turns linked to that exact file. Text, provider, and activity filters
  compose without changing the underlying evidence.
- AC-4: The API uses a versioned `UserInputTraceV1` contract, rejects malformed
  workspace evidence, never exposes an absolute path, and returns a bounded 404
  when no workspace is open.
- AC-5: Inputs or providers with incomplete retained dialogue stay honest:
  unavailable text is labelled, inputs with no exact file link remain visible,
  and missing file evidence is never synthesized from timing or text similarity.
- AC-6: Wide, compact, and narrow layouts keep the input list as the primary
  surface, bound overflow locally, preserve keyboard focus, and produce no
  unexpected browser console or page errors.
- AC-7: Current-project validation independently derives the expected input and
  file-link counts from the discovered `better-harness` Session summaries and
  matches the Studio contract exactly, including per-activity counts and zero
  absolute-path leaks.

## Non-goals

- Naming, merging, accepting, versioning, or completing an Intent.
- Semantic clustering, prompt similarity, inferred file links, or treating a
  Session as one Intent.
- Commit, Artifact, validation, authorship, or causality links.
- Persisting raw prompts or duplicating host transcripts into the repository.
- Adding a host adapter, changing Session discovery, or retaining unbounded
  prompt, tool-output, or command text.

## Plan and Tasks

1. Add a pure, versioned Input Trace projector over the existing privacy-safe
   Inspector report: one input per dialogue Turn and one aggregated edge per
   exact Turn/tool/path/activity tuple.
2. Retain the projected trace with the server-owned selected workspace and
   expose it through a read-only `/api/inputs` route.
3. Add `Inputs` before `Sessions` in Studio's Observe navigation and implement
   a docked file-tree/input-list workbench with exact-path and activity filters.
4. Cover projection, validation, API errors, navigation, filtering, keyboard,
   responsive overflow, and current-project reconciliation.
5. Replace the bespoke recursive tree markup with `react-arborist`, keep the
   existing evidence model and exact-file filtering semantics, and render
   project-owned rows with Phosphor icons and shared Studio tokens.

## Test and Review Evidence

- AC-1..AC-5: focused model and server tests over synthetic multi-Session,
  repeated-path, missing-text, and malformed/absolute-path cases.
- AC-3/AC-6: Playwright interactions at 1440x900, 900x760, and 390x844,
  including folder disclosure with pointer and arrow keys, input selection,
  exact-file filtering, activity filtering, focus, and document-width checks.
- AC-7: a read-only current-project reconciliation command that compares the
  projector result with an independent traversal of the discovered Inspector
  report and prints provider/input/read/change/unlinked totals.
- Risk: the tree library owns composite focus, disclosure, and virtualization.
  Keep file selection separate from directory disclosure, disable mutation
  affordances, and verify the rendered ARIA tree through browser behavior.
- Risk: normalized provider evidence can omit text or file paths. The view
  reports only retained facts and keeps unlinked inputs visible.
- Risk: one tool call may report several paths or the same path repeatedly.
  Deduplicate by input, path, and activity while retaining distinct call ids.
- Risk: project paths are sensitive protocol data. Accept only confined,
  repository-relative portable paths already present in the privacy-filtered
  Inspector projection and validate the final response again at the API edge.

## Observed Review Evidence

- Focused model, shell, and server tests: 52 passed after adding the Intent
  packet and endpoint contract.
- Focused Studio browser scenario passed, including input/file selection,
  proposed-claim separation, and wide, compact, and narrow screenshots.
- Latest observed `better-harness` snapshot during this work: 67 provider
  Sessions, 286 retained inputs, 79 linked inputs, 207 unlinked inputs, 257
  distinct files, 102 read operations, and 719 edit-target operations. The
  projector emitted no workspace absolute path and does not claim those edit
  targets produced a content delta.
- Current-project browser smoke: API, navigation status, rendered input rows,
  and rendered file rows matched the fixture evidence, with 0 console or
  page errors and no document-level horizontal overflow.
- `react-arborist` replacement validation on 2026-08-24: Studio build and
  typecheck passed; the focused three-case Input Trace model test and the
  Playwright Input Trace scenario passed. Pointer disclosure, ArrowLeft/Right
  disclosure, exact-file selection, wide/compact/narrow layouts, and zero
  console/page errors were also verified against the running Studio.
- The full Studio unit suite had 243 passing and 4 failing tests. The failures
  are confined to concurrent Artifact provider routing changes in
  `artifact-provider-server`, `docx-artifact-server`, and
  `xlsx-artifact-server`; no Input Trace test failed.
