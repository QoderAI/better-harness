# Checkpoint-backed Compare Sources and Materialization

## Traceability

- ADR ID: `ADR-0005`
- Status: Proposed
- Decision date: 2026-08-17
- Related ADR: [Harness Checkpoint Experiment Compare](harness-checkpoint-experiment-compare.md)
- Implementation spec: [Checkpoint-anchored multi-lane harness
  experiments](../specs/2026-08-17-harness-studio-checkpoint-compare.md)

## Context

The first Harness Studio experiment runner uses a
`session-execution-plan-v1` checkpoint. That plan happens to identify a Git
repository, commit, tree, and agent-session position, and its current
materializer creates detached Git worktrees. Those facts are sufficient for the
first executable adapter, but they are not the product boundary.

Compare must also be able to start from other resources that retain historical
state. A presentation can have a versioned PPTX checkpoint and isolated file
copies; a document, design, notebook, or remote workspace can expose different
revision locators and materialization mechanisms. Naming the product or its
browser contract `git-backed` would leak the first adapter into every future
source and force non-Git histories to pretend to be repositories.

The experiment layer also needs to keep three facts distinct:

- the immutable checkpoint shared by the experiment;
- the user request that fresh lanes execute, whether imported from history or
  entered for a new comparison;
- the runtime-owned isolated materialization created for each fresh lane.

## Decision

- **Harness Studio Compare is checkpoint-backed.** A Compare locks one
  checkpoint and one request before execution. Git is the first checkpoint
  source adapter, not the product identity or a required field in the generic
  Studio model.
- **`checkpointRef` remains opaque and authoritative.** The experiment manifest
  continues to store the checkpoint plan reference and digest. It does not copy
  repository, document, revision, slide, session, or worktree fields. The
  checkpoint-owning adapter validates and interprets the referenced bytes.
- **Source adapters project a generic descriptor for Studio.** A validated
  adapter may expose display-oriented `adapter`, `resource`, `revision`,
  optional `history`, and `materialization` facts. Labels and values belong to
  the adapter: the Git adapter can say `Repository`, `Commit`, `Session
  position`, and `Detached worktree`; a PPTX adapter can say `Presentation`,
  `Version`, `Edit history`, and `Isolated document copy`. Studio renders the
  descriptor and does not branch on those labels or require Git-shaped fields.
- **The descriptor is a projection, not a second checkpoint.** It is derived
  from a validated checkpoint for selection and preflight UX. Evidence and
  execution continue to cite the checkpoint digest and adapter receipts rather
  than trusting browser-authored display values.
- **Discovery, lock, and materialization are separate phases.** A source adapter
  may browse projects or document histories and resolve a mutable selection
  into an immutable checkpoint. Locking creates no sandbox, worktree, document
  copy, or result ref. Only execution invokes the adapter's materializer for
  each fresh lane.
- **Materialization is capability-based.** An adapter describes whether it can
  create isolated copies, replay an observed history, preserve a result, and
  clean up. The current Git adapter materializes a detached worktree at the
  locked commit. A future PPTX adapter may copy a versioned file plus required
  sidecars into an isolated directory. Neither mechanism changes what a
  checkpoint means.
- **Request provenance is independent of checkpoint provenance.** Historical
  Replay locks the exact imported user request and its source locator; New
  Request Compare locks newly entered request bytes. Editing an imported
  historical request creates a new request identity instead of silently
  rewriting the historical episode.
- **Studio follows `Draft -> Lock -> Materialize -> Execute -> Evaluate`.** The
  mutable Builder selects a scenario, checkpoint source, request source, and
  variants. Lock produces the existing experiment/checkpoint references and a
  comparability preview. The compact Workbench starts after lock and retains the
  source identity while it streams ACP and result evidence.
- **Comparison semantics remain those of ADR-0004.** Every fresh lane starts
  from a materialization of the same checkpoint; observed history is contextual
  unless its identity is complete; treatment axes and verdict strength remain
  derived from evidence.

## First Adapter Boundary

The first implementation projects `session-execution-plan-v1` as:

| Generic field | Git adapter value |
| --- | --- |
| Adapter | Git + agent session |
| Resource | Repository display name |
| Revision | Base commit, with tree as secondary identity |
| History | Session id and selected entry |
| Materialization | One detached worktree per fresh trial, created on Run |

The projection deliberately does not become `GitCheckpointSourceV1` in the
browser. Provider-specific validation, absolute paths, Git commands, locks, and
cleanup stay in the Node adapter and runner.

## Consequences

Studio can explain the real Git/worktree plan today without making Git a
permanent product dependency. Future versioned resources can join by supplying
the same descriptor and lifecycle capabilities, while their canonical
checkpoint formats remain adapter-owned. The extra boundary requires an
adapter registry, explicit unsupported-checkpoint errors, and tests proving the
browser UI contains no Git-specific branching. A generic projection cannot by
itself guarantee that two historical environments are reproducible; checkpoint
completeness and runtime receipts remain required evidence.

## Rejected Alternatives

- **Call the product Git-backed.** Rejected because it makes repository
  vocabulary part of product identity and excludes versioned non-code
  resources.
- **Add a universal checkpoint object containing every source field.** Rejected
  because optional Git, PPTX, document, design, and remote-workspace fields
  would duplicate adapter contracts and weaken validation.
- **Create one checkpoint per lane.** Rejected because it removes the shared
  starting condition. Lanes receive separate materializations of one checkpoint.
- **Create worktrees or file copies while the Builder is edited.** Rejected
  because mutable selection is not execution authority and abandoned drafts
  would leak resources.
