# Harness Checkpoint Experiment Compare

## Traceability

- ADR ID: `ADR-0004`
- Status: Proposed
- Decision date: 2026-08-17
- Related specs: [Harness Coding Compare](../specs/2026-08-15-harness-coding-compare.md),
  [Session Checkpoint Executor PoC](../specs/2026-08-16-session-checkpoint-executor-poc.md),
  [Harness UI Studio](../specs/2026-08-15-harness-ui-studio.md)
- Implementation spec: [Checkpoint-anchored multi-lane harness
  experiments](../specs/2026-08-17-harness-studio-checkpoint-compare.md)
- Source abstraction: [Checkpoint-backed Compare Sources and
  Materialization](checkpoint-backed-compare-sources.md)

## Context

Two evidence systems exist today and neither can express a mixed-origin,
multi-lane experiment:

- `harness-compare.v1` freezes a fixture, runs exactly two variants
  (`baseline`/`candidate`) serially against a synthetic Git repository, and
  derives a single verdict. The manifest carries one global `runtime.model`,
  so per-lane model variation is inexpressible, and the treatment axis is
  limited to `harness | runtime-profile`.
- The session executor owns the checkpoint contract
  (`session-execution-plan-v1`): base commit and tree plus session file
  digest, entry id, and branch digest. Execution results land on
  `refs/better-harness/session-executions` namespaced refs and never switch
  the user's branch.

Studio users want to pick a checkpoint, replay the observed historical
trajectory, run two fresh agents (different harness or different model) from
the same checkpoint in parallel, and compare the three trajectories side by
side. The first executable adapter resolves a Git commit and materializes
detached worktrees, but ADR-0005 keeps those mechanics out of the generic
product contract. The temptation is to add a "sandbox checkpoint" type, copy
source-specific fields into a new experiment schema, or let a single global
verdict summarize a three-lane view. Each of those blurs provenance or
fabricates attribution.

## Decision

- **One checkpoint definition per adapter.** The current session-executor plan
  is the first checkpoint contract. Future source adapters may own other
  versioned checkpoint formats under ADR-0005. A sandbox is a materialization
  of the referenced checkpoint for one lane's execution, never a new checkpoint
  type. Experiment documents hold a `checkpointRef` (path plus digest) and never
  copy or reinterpret checkpoint fields.
- **The `.harness` grammar does not change.** The upgrade lives entirely in
  the experiment and compare layer. `harness-compare.v1` remains the frozen
  fixture, two-variant path; it is not extended to cover checkpoints.
- **New `harness-experiment.v1` manifest.** The version starts at v1; no
  prior experiment schema exists. It declares one shared task (prompt hash,
  grader) and N lanes. A lane has `origin: "observed"` (a recorded trajectory
  reference plus its starting checkpoint digest; no sandbox is created) or
  `origin: "execute"` (a harness id plus a per-lane runtime profile and model;
  a sandbox is materialized from the shared checkpoint). The host, the visible
  tool set, and the run policy are shared across lanes rather than per-lane, so
  a lane cannot move the host and confound every contrast at once.
- **Treatment axes are derived, never author-declared.** A contrast names
  only the lanes it compares. The runner computes the axis by diffing the
  lanes' harness id, runtime profile, and model. Exactly one differing axis
  (`harness`, `runtime-profile`, or `model` — extending the existing
  taxonomy) permits an attribution verdict; more than one yields
  `multi-axis`, which is descriptive only and can never produce a harness
  accept/reject.
- **The statistical evidence bar is preserved.** Execute lanes carry a trial
  count, and per-contrast verdicts are decided by the existing matched-pair
  decision policy, including the two-matched-pair floor. A contrast whose
  lanes ran once each is attributable in principle but reports
  `insufficient_evidence`, never a promotion; the experiment schema is not a
  bypass for the compare evidence bar.
- **An identically configured pair is descriptive, not invalid.** Where
  `harness-compare.v1` rejects a manifest whose variants move nothing, an
  experiment accepts it and reports `no-axis-moved`. Two identical lanes from
  one checkpoint measure run-to-run variance, which is the noise floor every
  other contrast is read against.
- **Checkpoint completeness is a gate, not an assumption.** A checkpoint
  anchors a commit and tree, not the untracked files or dirty state the
  historical trajectory may have started from. Materialization records a
  completeness receipt: either a clean-tree assertion or a captured
  dirty-state patch applied to every fresh lane. Without it, fresh lanes may
  not claim to share the historical lane's starting condition.
- **Observed lanes are contextual evidence by default.** A historical
  trajectory participates in an attribution verdict only when its runtime,
  model, harness revision, environment receipts, and task identity (prompt
  and prior session context) all match the fresh lanes. Absent any of those
  — and the prompt almost never matches — it is displayed as context in a
  descriptive contrast. Grades are optional on observed lanes.
- **Execution discipline for parallel lanes.** All lanes pass preflight
  (checkpoint digest, base commit/tree, session digest) before any lane
  starts. Worktree materialization is serialized to avoid Git lock
  contention; execution then runs in parallel with `Promise.allSettled`, so
  one lane's failure never discards another lane's evidence. Every event
  carries `experimentId`, `laneId`, and `runId`. Each lane persists its own
  `HarnessRevision`, runtime/model receipt, sandbox receipt, trajectory,
  patch, and grade. Results stay on namespaced refs; adopting a result is a
  later explicit action.
- **Studio hosts experiments, not one global verdict.** The stateless
  run-per-request `/agui` endpoint is insufficient. Studio gains a
  server-side experiment registry (create an experiment, subscribe to
  per-lane event streams, cancel), persists evidence per experiment
  directory, previews which axes a configuration moves before running, and
  renders one verdict per contrast. A three-lane view never shows a single
  aggregate verdict.
- **Tool-chain correlation is explicit evidence, not a similarity score.**
  Studio normalizes each ACP-derived tool call into tool name, resource target,
  and canonical arguments, then aligns lane sequences one-to-one and in order.
  The UI labels a counterpart `exact`, `same-resource`, `same-tool`, or `none`
  and shows the neighbouring calls around it. This makes a shared file read and
  a shared Read → Edit → Test path visible without presenting fuzzy similarity
  as provenance or causal proof.

## Consequences

Mixed-origin comparison becomes expressible without expanding the core
`.harness` DSL or forking the checkpoint contract. The compare aggregate
taxonomy gains a `model` axis and per-contrast decisions; consumers of
`harness-compare-result.v1` are unaffected because `harness-compare.v1`
remains frozen. Observed trajectories gain a principled, limited role:
context by default, baseline only under full identity. The cost is a second
manifest schema to maintain, a Studio server that now holds run state, and
the obligation to keep the derived-axis rule and evidence floor enforced in
the runner rather than trusted from the document. Implementation still
requires the dated spec, acceptance scenarios, and test evidence mandated by
`AGENTS.md`.
