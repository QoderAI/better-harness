# LongHorizon Run Evidence Boundary

## Traceability

- Spec ID: longhorizon-run-evidence-boundary
- Story: #78
- Status: Draft

## Intent

Define a small cross-repository integration proposal for how a future Better
Harness source profile could read completed or otherwise terminal
LongHorizon-Harness run artifacts as read-only session evidence. This document
does not add an adapter, declare LongHorizon-Harness support, or make Better
Harness part of LongHorizon-Harness execution.

The proposal follows the scope invited by the
[`phodal` MEMBER comment on Story #78](https://github.com/QoderAI/better-harness/issues/78#issuecomment-5262439512):
describe the boundary and how a completed run could be read as evidence. That
comment authorizes a proposal for discussion, not a merge commitment or a
support commitment.

## Pinned Evidence

This Draft uses only facts visible at these two immutable commits:

- Better Harness main:
  [`72594cca8046d914dcf5e00f4da1f36bf0900021`](https://github.com/QoderAI/better-harness/commit/72594cca8046d914dcf5e00f4da1f36bf0900021).
  Its [architecture](https://github.com/QoderAI/better-harness/blob/72594cca8046d914dcf5e00f4da1f36bf0900021/docs/ARCHITECTURE.md)
  and [proposed ADR-0003](https://github.com/QoderAI/better-harness/blob/72594cca8046d914dcf5e00f4da1f36bf0900021/docs/adrs/harness-run-evidence-bridge.md)
  are the Better-side evidence.
- LongHorizon-Harness main:
  [`be2e7b42523c4f35291f1ed57b683f6c03a29cdc`](https://github.com/AMAP-ML/LongHorizon-Harness/commit/be2e7b42523c4f35291f1ed57b683f6c03a29cdc).
  The inventory below cites its
  [`manager.py`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py),
  [`types.py`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/types.py), and
  [`control_bus.py`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/control_bus.py).

Better Harness main can also own Harness-as-Code runtime capabilities. The
phrase "Better Harness is the evidence layer" in this proposal describes only
the owner boundary for ingesting evidence from the external
LongHorizon-Harness project. It is not a general restriction on Better Harness.

LongHorizon-Harness PR #53, including commit `c2605bd`, is unmerged and is not
an authoritative input. Its routing fields may be considered only as an
optional future extension after merge and versioned conformance; they are not
required by this proposal.

## Ownership Boundary

| Concern | LongHorizon-Harness owns | Better Harness owns |
| --- | --- | --- |
| Execution | Starting and running Manager, GUI/CLI Executor, and Auditor roles | No execution or role control |
| Mutable state | Task state, task contract, round progress, operator control, and all run mutations | No writes to LongHorizon-Harness state |
| Lifecycle | Terminal-status production and the meaning of retry, resume, cancellation, failure, and completion inside LongHorizon-Harness | Read-only qualification of an already-produced artifact set; no lifecycle commands |
| Artifacts | Local and remote artifact production, file layout, schemas, and compatibility | Source-profile validation, normalization, and report projection for accepted inputs |
| Product claims | LongHorizon-Harness behavior and artifact guarantees | Whether a validated projection is presented as Better Harness session evidence |

The bridge is one-way: LongHorizon-Harness artifacts may flow into a future
Better Harness reader, but Better Harness never writes normalized data,
decisions, annotations, or control commands back into LongHorizon-Harness.

## Architecture Precedent

[ADR-0003](../adrs/harness-run-evidence-bridge.md) has `Status: Proposed`. It is
an architecture precedent for owner-preserving, one-way evidence normalization,
not an accepted or implemented decision for this integration. The existence of
the current
[`harness-run` analyzer](https://github.com/QoderAI/better-harness/blob/72594cca8046d914dcf5e00f4da1f36bf0900021/scripts/session-analysis/platforms/harness-run.mjs)
does not change the ADR status. That analyzer reads Better Harness native
HarnessRun artifacts; its file layout and `NormalizedToolActivityV1` mapping
must not be imposed on LongHorizon-Harness artifacts.

## Current LongHorizon Evidence Inventory

The pinned Manager establishes a local log directory, writes run-level and
round-level artifacts beneath it, and separately attempts remote mirror writes.
Local terminal records remain authoritative when a later remote synchronization
fails. Remote directory creation and writes catch errors and log that the trace
write was skipped, so the remote copy is best-effort rather than a replacement
authority.

| Owner | Path at the pinned source boundary | Observed semantics | Versioning gap | Candidate input |
| --- | --- | --- | --- | --- |
| LongHorizon-Harness Manager | `<log_dir>/report.json` (also written to `<log_dir>/role_orchestration/report.json`) | Terminal run record. The success path [writes both local copies before attempting its two final remote mirrors](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L943-L953). [`_final_report`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L1449-L1496) and the [crash boundary](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L1547-L1636) establish `schema_version: 2`, a harness-level `status`, separate `completion_satisfied`, abort/failure fields, task state/contract, and serialized rounds. An existing local terminal report is preserved if a later operation fails. | Version 2 is explicit, but the pinned source does not publish a cross-project compatibility profile for Better Harness. | Required candidate authority, subject to the future source-profile qualification rules. |
| LongHorizon-Harness Manager | `<log_dir>/role_orchestration/rounds.jsonl` | [Append-only local ledger](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L2164-L2178). Each line is `asdict(ManagedRound)` and contains the [route, plan text, executor output, auditor report text, state, contract, related refs, and role status dictionaries](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/types.py#L92-L104). | `ManagedRound` and the ledger have no independent explicit schema-version field at this commit. | Conditional supporting input after exact shape, bounds, and privacy validation. |
| LongHorizon-Harness Manager | `<log_dir>/role_orchestration/events.jsonl` | Append-only event stream. Each [emitted event record](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L2251-L2284) includes `schema_version: 1`, an event id, timestamp, event name, and event-specific payload. | The record version is explicit, but no profile-level whole-file or run-segmentation contract is observed. | Excluded from V1. A future event extension requires a separate approved versioned contract. |
| LongHorizon-Harness Manager | `<log_dir>/role_orchestration/rounds/round_NNN/manager_input.txt`, `auditor_input.txt`, and `auditor_report.txt` | Selected orchestration text files with direct write sites for [Manager input](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L306-L343), [Auditor input](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L726-L741), and [Auditor report](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L847-L904). These files can contain natural-language task or role content. | The files have no shared versioned envelope or independent schema marker. | Excluded from the initial profile because raw prompt/task/report text is outside the privacy boundary. |
| LongHorizon-Harness Manager | `<log_dir>/role_orchestration/rounds/round_NNN/<role>_raw_trajectory.jsonl`, trajectory-derived screenshot artifacts, and `<role>_metadata.json` | [`_save_role_result`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L1742-L1829) persists role diagnostics and metadata. Screenshot artifacts are conditional on trajectory content and successful extraction; they are not guaranteed for every role or round. | These debug artifacts have role-specific formats and no common per-round schema version. | Excluded from the initial profile as sensitive debug evidence. |
| LongHorizon-Harness environment mirror | `<harness_dir>/report.json`, `<harness_dir>/orchestration/report.json`, and `<harness_dir>/orchestration/rounds/round_NNN/round.json` plus selected round files | The success path names the [two final report mirrors](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L948-L953); round recording [mirrors `ManagedRound` as `round.json`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L2165-L2178). The [remote helpers catch write/setup failures](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/manager.py#L2181-L2221), so a missing mirror does not invalidate an existing local terminal record. | Delivery is best-effort and has no separate mirror-completeness manifest at the pinned commit. | Not an independent authority. A future profile may use it only under an explicit, validated discovery rule. |
| LongHorizon-Harness Supervisor | `<run_dir>/control/owner.json` and `status.json` | The Supervisor [reserves a run with the source run id and workspace in both records](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/service.py#L1465-L1489), while the ControlBus provides [atomic owner/status persistence](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/control_bus.py#L672-L708). | These files have no profile-specific version field at the pinned commit. | Required only as the V1 qualification envelope for run identity, workspace, and lifecycle binding. Raw task, command, path, agent, and model values are not session evidence. |
| LongHorizon-Harness control bus | `<run_dir>/control/commands.jsonl` and `command_receipts.jsonl` | [Separate control-plane records](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/control_bus.py#L1-L5). A receipt is the terminal authority for a control command, not for task success or run completion. | Control-bus revision and receipt semantics are owned by LongHorizon-Harness and are not a session-evidence schema. | Excluded from V1. |

The following meanings stay distinct:

- A **terminal run** is a local terminal report with a terminal `status` under
  LongHorizon-Harness semantics.
- **Artifacts available** means candidate files exist and pass the future
  source-profile validation. It does not imply completion.
- An Auditor `complete` result is one role-level judgment. `ManagedRound`
  persists `auditor_report` as natural-language text, so that text alone is not
  structured proof of success.
- `completion_satisfied` is a separate harness-level field. Its presence does
  not let Better Harness redefine LongHorizon-Harness lifecycle semantics.
- **Task success** is a product-level interpretation that this inventory does
  not infer from file presence, a natural-language report, or one status field.

## Proposed Source Profile

The normative proposal name is `longhorizon-supervisor-run-v1`. It is a Better
Harness reader profile tied to the pinned LongHorizon-Harness commit and its
observed artifact shapes. It is not a producer feature or a claim that
LongHorizon-Harness publishes this profile.

### Selection Boundary

The future reader MUST accept one explicitly selected, Supervisor-managed,
run-local directory. The selected directory basename is the candidate source
run id. The reader MUST NOT scan a user home, enumerate a runs root, select a
latest directory by modification time, guess a run from a fuzzy name, or adopt
a shared direct-CLI log directory. Direct CLI output is outside V1 because it
does not carry this Supervisor qualification envelope.

This is a deliberate profile restriction. The pinned Supervisor's
[`_run_dir`, `_run_logs_dir`, and run-id checks](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/service.py#L655-L704)
support run-local selection, but do not constitute an upstream promise that
future releases preserve this Better Harness profile.

### Qualification Set

| Class | Fixed run-local input | V1 rule |
| --- | --- | --- |
| Required qualification | `control/owner.json` | MUST parse as an object and bind the selected directory basename and requested workspace. It is not projected as session content. |
| Required qualification | `control/status.json` | MUST parse as an object, repeat the same run/workspace binding, and contain a documented terminal Supervisor lifecycle status. It is not the native report-status authority. |
| Required evidence authority | `logs/report.json` | MUST pass the exact V1 version, shape, terminal, and consistency rules below. It is the only native terminal-report authority. |
| Conditional duplicate | `logs/role_orchestration/report.json` | MAY be absent. If present, it MUST parse and be canonical-JSON identical to `logs/report.json`; otherwise the set is `invalid`. The root report always wins by authority, never by guessing between conflicting copies. |
| Optional supporting source | `logs/role_orchestration/rounds.jsonl` | MAY establish only allowlisted structural round consistency after the complete file validates. Absence makes an otherwise valid set `partial`; malformed or conflicting presence makes it `invalid`. |
| Excluded | `logs/role_orchestration/events.jsonl`; remote `<harness_dir>` mirrors; `control/commands.jsonl`; `control/command_receipts.jsonl`; per-round text, state, contract, output, report, trajectory, screenshot, and metadata files; orchestration transcripts; `worker.log`; `tmp/task.md` | MUST NOT be read by V1. Owner/status qualification is the only control-plane exception. |

Canonical JSON equality means equality after strict JSON parsing and recursive
object-key ordering, while preserving array order, primitive types, and exact
string values. It does not trim, coerce, repair, or discard unknown fields
before comparing the two report copies.

Within owner/status, V1 consumes only `run_id` and `workspace`, plus
`status.status` for lifecycle qualification. Raw task, process id, command,
agent, model, role configuration, idempotency, failure text, and other fields
MUST be discarded after the bounded parse and MUST NOT affect evidence.

### Identity, Workspace, and Path Safety

Before any evidence projection, V1 MUST verify all of the following:

1. The selected directory basename, `owner.run_id`, and `status.run_id` are
   identical strings accepted without normalization or coercion. The string
   MUST be 1-128 characters, not `.` or `..`, and contain no separator, NUL, or
   control character, matching the pinned Supervisor validator.
2. The canonical identity of the explicitly requested workspace equals both
   `owner.workspace` and `status.workspace` after platform-correct canonical
   path resolution. Only the match result and a privacy-safe opaque target
   reference may leave qualification; the source paths MUST NOT.
3. Every fixed descendant resolves beneath the exact selected run directory.
   Every path component MUST be opened without following links, and every
   selected file MUST be a regular file. Traversal, NUL, symlink/junction,
   special-file, containment, or identity failure is fail-closed.

The qualification result MAY use a deterministic opaque alias derived from the
profile version and qualified source identity for safe internal diagnostics. It
MUST NOT expose the raw source run id or workspace path, and it MUST NOT be
interpreted as source retry lineage. This Draft does not map that alias to the
existing Better Harness `sessionId`; any durable identity mapping belongs to a
separately approved owner-extension or adapter spec.

### Version and Shape Contract

V1 accepts only the pinned LongHorizon-Harness shape with root report
`schema_version` exactly integer `2`, `variant` exactly
`lh_harness_role_managed`, and `mode` exactly `role_orchestration`. The report
MUST carry typed `status`, `completion_satisfied`, `rounds_run`, `max_rounds`,
and `rounds` fields. Native report status is closed to `complete`, `incomplete`,
`blocked`, `cancelled`, or `failed`; booleans are not integers for numeric
validation. `rounds_run` MUST equal the array length. `max_rounds` remains an
observed native value only: the pinned human gate can extend the active round
budget, so `rounds_run > max_rounds` MUST NOT by itself make the set invalid.
`complete` and `completion_satisfied: true` MUST occur together.

Each embedded round MUST have a strictly increasing one-based `round_index`, a
`next_step` in the pinned `gui`, `cli`, `done`, `blocked`, `invalid`, or `ask`
set, and object-valued role-status fields. V1 may validate bounded string fields
for type and size, but MUST discard their contents rather than project them.
Unknown unconsumed report fields MAY be ignored only after the required shape
passes; they MUST NOT be projected or treated as support for a capability.

The pinned report has no producer-version field. Consequently, V1 is specified
only from the pinned commit, while runtime qualification can observe only the
explicitly selected profile, schema 2, and exact conformance shape. It cannot
verify or claim a broader LongHorizon-Harness release range. A future schema
version is `unsupported`; same-version missing fields, type drift, new status
values, or failed invariants are `invalid`, never loosely coerced into support.

`rounds.jsonl` has no independent version. If present, V1 MUST parse the entire
bounded file. Its non-empty line count MUST equal both root-report `rounds_run`
and `len(report.rounds)`; when that count is zero, only an empty ledger is
valid. Ledger `round_index` values MUST be unique, in file order, and exactly
`1..N`. Each line MUST pair one-to-one with the report round at the same index,
with exact type and value equality for every profile-allowlisted structural
field, including `round_index`, `next_step`, and the object presence/type of
the three role-status fields.

Free text and role-status contents are never compared as evidence or
persisted. If bounded parsing must inspect them to establish JSON shape, they
remain in memory only until that line is validated and are then discarded. An
empty ledger for a nonzero report, truncated prefix, extra suffix, duplicate,
gap, reorder, or structural type/value mismatch makes the whole set `invalid`,
not `partial` or `validated-terminal`.

V1 does not read `events.jsonl`. Although the pinned records carry a schema
version, the stream has no profile-level whole-file or unambiguous run-segment
contract. Event support requires a separate approved versioned extension with
its own complete event and sequence contract.

### Authority and Lifecycle Consistency

Within the profile, `logs/report.json` is the only authority for the native
terminal-status and completion-satisfied qualification facts.
`control/status.json` is a separate Supervisor process-lifecycle qualification
fact. V1 MUST accept only a terminal status from the
pinned Supervisor vocabulary: `completed`, `failed`, `cancelled`, `blocked`, or
`incomplete`. A Supervisor `completed` status requires report `complete` plus
`completion_satisfied: true`. `blocked` and `incomplete` require the
corresponding report status. Supervisor `failed` or `cancelled` may override a
different Manager report outcome because process failure or an operator action
has higher lifecycle authority; the reader preserves both observations and
MUST NOT relabel either as task success.

This distinction follows the pinned Supervisor, where a clean process exit is
not sufficient and a `complete` report without completion evidence becomes a
protocol failure. The
[terminal-status projection](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/service.py#L413-L458)
is evidence for the distinction, not a schema imported into Better Harness.

### Evidence States

`evidenceState` is a closed profile-internal qualification value:

| State | Meaning | Eligible for a separately approved future projection? |
| --- | --- | --- |
| `unavailable` | A required file is absent or cannot be read through the safe fixed path. | No |
| `unsupported` | The explicitly selected profile or report schema version is outside V1. | No |
| `invalid` | Present input is malformed, unsafe, identity-mismatched, internally inconsistent, or conflicts with another selected input. | No |
| `partial` | The required terminal envelope is valid, but optional `rounds.jsonl` is absent. | Yes, for the internal required facts only, with a safe reason code. |
| `validated-terminal` | The required envelope and present `rounds.jsonl` pass complete validation. | Yes, for the internal terminal and structural round facts. |

No state means task success, and no state writes to a current Better Harness
session/evidence owner. `partial` does not silently hide a malformed present
ledger: malformed or ambiguous presence is `invalid`.

### Failure and Decision Matrix

| Condition | State | Future eligibility; current owner | Required decision |
| --- | --- | --- | --- |
| Required owner, status, or root report missing/unreadable | `unavailable` | Not eligible; none | Report a safe missing/unreadable code. |
| Future report schema or non-V1 profile | `unsupported` | Not eligible; none | Require a separately reviewed profile revision. |
| Present required file malformed or required field/type/status drifted | `invalid` | Not eligible; none | Fail closed; do not coerce or repair. |
| Conditional report copy malformed or canonically different | `invalid` | Not eligible; none | Keep root authority but reject the artifact set. |
| Any traversal, NUL, link, special file, or containment failure | `invalid` | Not eligible; none | Stop before parsing evidence. |
| Directory, owner, or status run id/workspace mismatch | `invalid` | Not eligible; none | Stop before qualification; do not expose raw values. |
| Valid required envelope with ledger absent | `partial` | Eligible internal required facts; none | Retain only a safe internal absent-ledger reason. |
| Ledger present but empty for nonzero rounds, truncated, extra, duplicated, gapped, reordered, malformed, unsafe, or mismatched | `invalid` | Not eligible; none | Never downgrade malformed presence to absence. |
| Status, report, or ledger qualification facts conflict | `invalid` | Not eligible; none | Retain no eligible result and use a safe conflict code. |
| Required files and ledger valid for a non-success terminal status | `validated-terminal` | Eligible internal terminal/round facts; none | Preserve the internal native status; task success remains unobserved. |
| Required files and ledger valid with report `complete` and completion satisfied | `validated-terminal` | Eligible internal source-reported completion facts; none | Do not upgrade source-reported completion to independent task success. |

### Normalization Allowlist

At the pinned Better Harness main, the existing `NormalizedToolActivityV1` and
episode owners do not define LongHorizon terminal status, completion, round,
workspace-match, evidence-state, abort-category, or task-success fields.
ADR-0003 remains Proposed. Therefore V1 keeps every fact below inside
qualification and projects none of them into a current provider-neutral owner.
It also MUST NOT reuse the native HarnessRun file schema merely because the
current `harness-run` analyzer exists.

| Classification | Profile-internal fact | Current Better owner treatment |
| --- | --- | --- |
| Observed | Supervisor lifecycle status; root-report native terminal status and completion-satisfied; round count and native max-round value | Unobserved and not projected. |
| Observed | Valid ledger round index and route labels | Unobserved and not projected. |
| Derived | Opaque diagnostic alias, workspace-match result, opaque target reference, `evidenceState`, and closed safe reason | Unobserved and not projected. |
| Derived | Closed abort/failure category: `none`, `user-cancelled`, `provider-failure`, `manager-blocked`, `round-limit`, `worker-failure`, or `other-redacted` | Unobserved and not projected; free-form text is discarded. |
| Unobserved/excluded | Task, plan, output, Auditor report/result, state, contract, commands/receipts, error text, paths, model/provider credentials, tool payload, token/cost data | Never projected. |
| Unobserved | Independent task success | Always unobserved; Manager done, Auditor text, file presence, or source-reported completion cannot change it. |

This Draft defines only the qualification/validation boundary and future
eligibility. Turning any internal fact into durable Better Harness evidence
requires a separate maintainer-approved owner-extension or adapter spec that
selects the canonical owner, schema, compatibility rules, and tests. That spec
MUST preserve unobserved facts and MUST NOT create a parallel generic report
schema.

### Read and Privacy Policy

V1 is read-only and fixed-allowlist. It MUST perform one bounded read per
selected file, enforce fixed tested limits for total bytes, record count, line
size, JSON depth, and string length, and reject unsafe or over-limit input. It
MUST NOT repair, truncate-and-accept, rewrite, touch timestamps, create indexes,
or modify any LongHorizon-Harness file. Exact numeric limits are an
implementation-spec decision that MUST be frozen and tested before code lands;
unbounded defaults are forbidden by this contract.

Diagnostics MUST contain only a closed code, safe field name, evidence state,
and opaque alias where needed. They MUST NOT contain a source path, raw run id,
workspace, task, command, prompt, error/failure body, transcript, credential,
or rejected input body.

### Retry and Resume Boundary

The pinned Supervisor `resume` creates a new run from saved task/config and
writes `resumed_from` plus `resume_kind: retry`; its source comment explicitly
says round state was not resumed
([source](https://github.com/AMAP-ML/LongHorizon-Harness/blob/be2e7b42523c4f35291f1ed57b683f6c03a29cdc/src/lh_harness/supervisor/service.py#L2067-L2121)).
V1 qualifies every selected run independently and does not consume or project
that relation. It does not merge rounds, restore routing state, or call a retry
a checkpoint resume. A future lineage feature requires separately validated
source lineage and a reviewed profile revision.

Post-merge PR #53 routing metadata remains an optional future extension. It
requires separate versioned conformance and cannot widen V1.

## Resolved Design Questions

| Former question | V1 decision | Evidence or rationale |
| --- | --- | --- |
| Producer/report versions | Specify V1 from pinned commit `be2e7b42523c4f35291f1ed57b683f6c03a29cdc`, then qualify only explicit profile selection, report schema 2, and exact conformance shape. | No producer-version field exists in the pinned report, so runtime cannot verify or claim a broader release range. |
| Conflicting local reports | Root `logs/report.json` is authority; a present duplicate must be canonical-JSON identical or the set is `invalid`. | This closes ambiguity without choosing by time or convenience. |
| Stable event/round fields | Validate the ledger as an exact, complete, one-to-one structural companion to report rounds; exclude events entirely. | Ledger has no version, while the event stream lacks a profile-level whole-file/run-segmentation contract. |
| Per-round file intake | No per-round file is an input to V1. | The files are unversioned and contain sensitive natural-language/debug content. |
| Evidence available versus task success | `partial` and `validated-terminal` establish only future projection eligibility; current owners receive nothing and task success stays unobserved. | Artifact validity and source-reported completion are not independent success proof. |
| Run identity and retry lineage | Qualify with private source run id/workspace, retain at most an internal opaque diagnostic alias, and treat every run independently. | Pinned resume is a new retry run, not restored round state; V1 does not join its optional relation. |

## Conformance Scenarios

These scenarios are the closed V1 conformance set for a future implementation.
They are design requirements, not fixtures or tests implemented by this Draft.
"Projection: none" means every profile-internal fact remains unobserved in the
current Better Harness owners.

| ID | Input | Expected qualification state | Current Better projection | Security or honesty signal | Future implementation evidence |
| --- | --- | --- | --- | --- | --- |
| C-1 | Valid matching owner/status and schema-2 root report; ledger absent; conditional duplicate absent or matching | `partial` | None | Safe `ledger-absent` internal reason; root remains authority | Sanitized required-envelope fixture with both duplicate-presence variants |
| C-2 | `rounds_run: 0`, empty report rounds, present empty ledger, and matching duplicate when present | `validated-terminal` | None | Empty means zero records, not one blank/malformed record | Zero-round golden fixture and exact empty-file assertion |
| C-3 | `rounds_run: N > 0` with exactly N ledger lines, indexes `1..N`, and one-to-one structural matches | `validated-terminal` | None | Only structural fields survive qualification in memory | Multi-round golden fixture with exact count/order/value assertions |
| C-4 | Required owner, status, or root report absent or unreadable through the fixed safe path | `unavailable` | None | Closed missing/unreadable code without source values | One fixture per required file and read-failure class |
| C-5 | Non-V1 explicit profile or report schema other than integer 2 | `unsupported` | None | No best-effort downgrade or version coercion | Future-schema and wrong-profile negative fixtures |
| C-6 | Present required JSON malformed; required type or terminal enum invalid; run id or workspace binding mismatched | `invalid` | None | Closed invalid/type/identity code; no raw value | Table-driven malformed, type, enum, identity, and workspace fixtures |
| C-7 | Conditional duplicate absent, matching, malformed, or canonically different | Absent/matching follows C-1..C-3; malformed/different is `invalid` | None | Never select a copy by timestamp or convenience | Canonical-key-order positive fixture plus malformed/value/type mismatch negatives |
| C-8 | Present ledger is a truncated prefix, extra suffix, empty for N>0, duplicate, gap, reorder, malformed record, or allowlisted structural mismatch | `invalid` | None | Present corruption never degrades to optional absence | One mutation fixture for every listed ledger failure |
| C-9 | All required invariants pass and `rounds_run > max_rounds` | C-1 or C-3 according to ledger presence | None | Native max is observed internally but does not reject human-extended runs | Positive extended-budget fixture proving this fact alone is not invalid |
| C-10 | Selected path has a symlink/junction, traversal, special file, canonical escape, NUL, or fixed bound exceeded | `invalid` (missing/unreadable required input remains C-4) | None | Fail closed with only safe code/field/opaque alias | Cross-platform path attacks and over-limit fixtures after numeric limits are frozen |
| C-11 | Excluded events, per-round text/state/output/report, trajectories, screenshots, remote mirrors, receipts, task file, or worker log exist | State is determined only by required inputs and ledger | None | Excluded files are not opened and cannot change qualification | Read-spy fixture proving zero opens for every excluded path |
| C-12 | Any pinned native report terminal status; `complete` paired with either valid or invalid completion-satisfied value | Valid enum follows C-1..C-3; inconsistent completion pair is `invalid` | None | Status/completion remain internal; task success stays unobserved | Enum matrix plus complete/boolean cross-field negatives |
| C-13 | Owner/report contain raw task, command, error/free text, paths, run id, provider/model, or credential-shaped values | State follows structural rules | None | Durable result and diagnostic contain none of the raw values | Canary-secret and private-path non-retention assertions |
| C-14 | A direct CLI/shared log directory is selected | `unsupported` as outside `longhorizon-supervisor-run-v1` | None | No fuzzy adoption of a directory missing the Supervisor envelope | Direct-CLI/shared-log rejection fixture |
| C-15 | A Supervisor retry/resume produces a new run with `resumed_from` and `resume_kind: retry` | Each selected run is a separate qualification instance | None | No round merge, lineage projection, or checkpoint claim | Two-run fixture proving independent aliases/state and zero joins |
| C-16 | PR #53 routing fields are absent, or appear only as otherwise unconsumed extra fields in a conforming set | Base qualification does not require them; extras grant no capability | None | No routing projection or support upgrade | Base fixture without fields and inert-extra-field fixture with duplicate consistency preserved |
| C-17 | Qualification reaches `partial` or `validated-terminal` while no approved Better owner extension exists | Internal state is retained only for the qualification call | None | No session evidence, durable report field, or support declaration | Negative contract test over every current owner serialization surface |

Any future implementation MUST realize this table with sanitized fixtures and
must not weaken a negative row by treating it as a warning-only success.

## Acceptance Scenarios

- **AC-1 (traceability):** The final proposal names Story #78, both pinned
  commits, and source permalinks for every required artifact claim. Unmerged
  PR #53 fields are absent from the required profile.
- **AC-2 (ownership):** A review can assign execution, role behavior, state
  mutation, lifecycle, and artifact production to LongHorizon-Harness, while
  assigning only read-only qualification, validation, normalization, and report
  projection to Better Harness. No path writes back to LongHorizon-Harness.
- **AC-3 (source profile):** The normative contract identifies the local
  terminal report separately from the round ledger, event stream, per-round
  files, and best-effort remote mirror, with explicit required, optional, and
  excluded inputs.
- **AC-4 (semantic honesty):** Tests and documentation keep terminal status,
  artifact availability, Auditor status, `completion_satisfied`, and task
  success as separate facts. Natural-language Auditor output alone cannot
  produce a structured success claim.
- **AC-5 (normalization):** A future source profile emits a bounded,
  profile-internal qualification result only. Every LongHorizon-specific fact
  remains unobserved and unprojected in current Better owners; a separate
  approved owner-extension/adapter spec is required before durable evidence,
  instead of borrowing the native HarnessRun schema or fabricating fields.
- **AC-6 (trust and privacy):** Validation fails closed on unsupported versions,
  malformed or oversized records, unsafe paths, and disallowed sensitive
  fields. The projected evidence contains no raw prompt, task, transcript,
  credential, trajectory, or absolute home path.
- **AC-7 (lifecycle and retry):** Related LongHorizon-Harness attempts remain
  distinct candidate artifact sets. Better Harness does not consume
  `resumed_from`, label a retry as checkpoint resume, or reconstruct mutable
  round, routing, or lifecycle state.
- **AC-8 (future conformance):** A later implementation supplies pinned,
  sanitized conformance fixtures for each accepted schema version and proves
  missing, partial, malformed, and future-version inputs fail with bounded
  diagnostics. Optional post-merge routing metadata is tested separately from
  the base profile.
- **AC-9 (product honesty):** README support tables, adapter matrices, host
  catalogs, CLI help, and package metadata remain unchanged until an adapter is
  implemented and its conformance and privacy checks pass. This Draft never
  appears as a support declaration.
- **AC-10 (validation):** Review evidence maps every normative claim to a pinned
  source, every acceptance scenario to an executable or documentary check, and
  verifies links, repository status, privacy scans, and the final diff before
  acceptance.

## Risks and Controls

| Risk | Fail-closed control | Review signal |
| --- | --- | --- |
| Schema 2 drifts without changing its version | Exact required types, enums, and invariants; same-version drift is `invalid` | Mutation fixtures for every required field and invariant |
| No producer-version field exists | Scope V1 only to pinned evidence plus exact conformance; claim no release range | Pinned commit remains explicit in Traceability and version tests |
| The two local reports conflict | Root report is authority, but any present duplicate must be canonical-JSON identical | Canonical-order positive and value/type mismatch negative fixtures |
| Ledger is truncated or append state is ambiguous | Whole-file exact count, `1..N` ordering, and one-to-one structural comparison | Prefix/suffix/empty/duplicate/gap/reorder mutation fixtures |
| Direct CLI or shared logs are mistaken for a supervised run | Explicit one-directory selection plus required owner/status envelope; no scanning or guessing | Direct-CLI/shared-log rejection fixture |
| Filesystem paths escape or change type | Canonical containment, no-follow component walk, regular-file requirement, and fixed bounds | Windows/macOS/Linux link, traversal, special-file, and over-limit cases |
| Owner/report fields expose private content | Bounded internal parse, fixed allowlist, immediate discard, safe diagnostics, and zero current projection | Canary task/path/run-id/provider/model/credential non-retention checks |
| Native completion is presented as independent success | Separate lifecycle/report facts; task success always unobserved | Every terminal-status fixture asserts zero success projection |
| Existing Better owners cannot represent these facts honestly | Current projection is none; owner extension requires separate maintainer-approved spec | Negative serialization tests over `NormalizedToolActivityV1` and episode owners |
| Unmerged PR #53 changes optional source fields | Ignore unconsumed extras, require duplicate consistency, and grant no capability | Base-without-routing and inert-extra-field conformance fixtures |
| Numeric safety bounds are not yet frozen | This Draft forbids unbounded reads; implementation is blocked until a follow-up spec fixes tested values | Maintainer-approved numeric table and boundary tests before code |

## Non-goals

- Add an adapter, runtime behavior, test fixtures, or production code.
- Start, stop, control, resume, retry, or otherwise modify a
  LongHorizon-Harness run.
- Change README support declarations, the adapter matrix, host catalog, CLI,
  package metadata, release metadata, or generated documentation.
- Claim that Better Harness currently supports LongHorizon-Harness.
- Design Story #63's generic completion model or define task success for every
  provider.
- Copy raw prompts, tasks, transcripts, trajectories, credentials, secrets, or
  absolute home paths into Better Harness evidence.
- Depend on PR #53 routing fields or treat them as part of the pinned base
  contract.
- Describe a retry as checkpoint resume or claim that Better Harness can
  rehydrate LongHorizon-Harness routing or lifecycle state.
- Define a new generic report schema or copy the upstream schema into this
  repository.

## Plan and Tasks

1. **Gate 1 - inventory and ownership:** Pin both repositories, record the
   observed LongHorizon-Harness artifacts and gaps, define the one-way owner
   boundary, and freeze the acceptance-scenario skeleton in this Draft.
2. **Gate 2 - normative contract:** Close the six inventory questions with the
   narrow V1 decisions above; define source qualification, version handling,
   normalization, semantic labels, trust/privacy limits, and lifecycle
   treatment without implementation or support claims.
3. **Gate 3 - conformance and validation:** Specify sanitized conformance cases,
   map acceptance scenarios to checks, run documentation validation and final
   independent review, and decide whether the proposal is ready to authorize a
   separately scoped implementation.

## Forward Path and Rollback

This Draft is a maintainer discussion artifact only. It does not authorize an
implementation, adapter, runtime integration, evidence owner extension, or
support declaration.

If maintainers accept the direction, the next change MUST be a separate
owner-extension/adapter spec. That spec must freeze numeric bounds, select the
canonical Better Harness owner and schema, define sanitized fixtures, require
cross-platform filesystem tests, and set an explicit support-claim gate before
implementation starts.

If maintainers reject the direction or pinned upstream facts drift, rollback is
limited to deleting or revising this one spec. There is no runtime, stored
Better evidence, migration, or cleanup obligation.

This single-file diff does not overlap PR #94 at the file level. It changes no
LongHorizon-Harness file, so it does not overlap PR #53 at the file level;
conceptually, PR #53 remains only a possible future optional extension. These
observations do not guarantee GitHub mergeability or remove the need to review
concurrent changes.

## Test and Review Evidence

This Draft adds no executable conformance fixtures. The future-test column is
an implementation gate, not a claim that those tests exist in this change.

| AC | Current document-review evidence | Future executable evidence | This Draft's validation |
| --- | --- | --- | --- |
| AC-1 | Traceability and Pinned Evidence name Story #78, both immutable commits, and claim-level source links; PR #53 is optional only. | Link and pinned-fixture checks remain required in any follow-up. | Documentation link graph plus manual pinned-link/source review. |
| AC-2 | Ownership Boundary and Read and Privacy Policy make the bridge one-way and prohibit control or mutation. | Read-spy and unchanged-files tests around every qualification state. | Single-file diff review confirms no LongHorizon or runtime file changed. |
| AC-3 | Selection Boundary and Qualification Set define required, conditional, optional-ledger, and excluded inputs; C-1..C-11 cover their decisions. | Sanitized qualification fixtures for every input class and state transition. | Cross-section review of inventory, input table, states, and decision matrix. |
| AC-4 | Authority and Lifecycle Consistency separates Supervisor lifecycle, native report status, completion, evidence state, and unobserved task success. | Terminal-enum/completion matrix and conflict mutation fixtures. | Pinned Manager/Supervisor source review plus semantic-label sweep. |
| AC-5 | Normalization Allowlist records the negative proof: pinned `NormalizedToolActivityV1` and episode owners have none of these fields, so current projection is always none. | Negative serialization tests across every current owner; a separately approved owner-extension spec before any positive projection test. | Pinned Better owner/analyzer source inspection and stale-projection-claim scan. |
| AC-6 | Identity, Workspace, and Path Safety plus Read and Privacy Policy define fail-closed paths, bounded reads, discard, and safe diagnostics. | Cross-platform filesystem attacks, numeric boundaries after freeze, and canary secret/path non-retention tests. | Spec privacy scan for local paths, key shapes, private-key markers, and raw-transcript claims. |
| AC-7 | Retry and Resume Boundary treats each run as a distinct qualification instance and forbids lineage joins or checkpoint claims. | Two-run retry fixture proving independent qualification and zero state merge. | Pinned `_resume_once` review and lifecycle terminology sweep. |
| AC-8 | Version and Shape Contract, Failure and Decision Matrix, and C-1..C-17 define the future conformance suite. | Every scenario row becomes a sanitized positive or negative fixture; no warning-only weakening. | Scenario-to-contract review and marker/stale-claim scans. |
| AC-9 | Product honesty remains gated; Forward Path requires a separate approved spec before implementation or support. | Support-surface snapshot must change only in the later support-gated contribution. | Status/name-only checks show only this new spec; README, matrix, catalog, CLI, package, and ADR remain unchanged. |
| AC-10 | Plan, scenarios, risks, future tests, and this matrix complete the Story-to-review chain. | Follow-up readiness must run its executable conformance, package, and cross-platform suites. | Generator hash/diff check, focused link test, whitespace checks, privacy scans, and independent global review. |

Actual Draft-validation commands:

```text
node scripts/doc-link-graph/cli.mjs skills/better-harness
npx vitest run test/skills-docs/doc-link-graph.test.mjs
git diff --check -- docs/specs/2026-08-19-78-longhorizon-run-evidence-boundary.md
```

The direct `npx` command cannot start in this independent worktree because its
local `node_modules` does not contain Vitest. No dependency is installed or
upgraded. The same repository's existing Vitest binary and config are therefore
also run with `--root` fixed to this worktree; that is the focused executable
result reported for this Draft.

Review Readiness requires: Draft status; Story and pinned-source traceability;
stable AC and conformance IDs; explicit non-goals; risks tied to controls and
future tests; no implementation/support claim; one-file status/diff; and no
commit, push, pull request, or issue comment. Until the independent global
review passes, this document remains a Draft proposal and does not authorize
implementation.
