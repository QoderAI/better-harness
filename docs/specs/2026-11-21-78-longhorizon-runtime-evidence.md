# LongHorizon run records as session evidence

## Traceability

- Spec ID: longhorizon-runtime-evidence
- Story: [#78](https://github.com/QoderAI/better-harness/issues/78)
- Status: Draft
- Discussion posture: proposal to discuss, not a merge commitment
- Native LongHorizon pin: AMAP-ML/LongHorizon-Harness commit
  `634030370a9d41ac1c1c6ea7c07bc96ca1d24462` (inspected 2026-11-21)
- Local inner-executor pin: DeepTask `src/package.json` version `9.3.6`
  (`deeptask.deeptask`), inspected from `/media/kurz/aleber/vscode/deeptask`

## Intent

Answer the maintainer request in [#78](https://github.com/QoderAI/better-harness/issues/78):
say where the boundary sits between Better Harness and LongHorizon-Harness, and
how a completed LongHorizon run could be read as session evidence.

This specification does **not** add a host adapter, a plugin lifecycle, or a
runtime. It freezes a discussion boundary so later work can choose one of:

1. a read-only run-evidence source, analogous to the existing
   `harness-run` session platform;
2. a later inner-executor join against already-supported hosts (Claude, Codex,
   DSH) or a future Cline-family host;
3. a Better Harness runtime slice, which the maintainer already flagged as
   planned and which this spec must not pre-empt.

The complementary read from the issue remains the working theory: Better Harness
is a review/evidence layer; LongHorizon-Harness is an outer task-lifecycle loop
around an existing agent. A completed LongHorizon run is inspectable evidence.
It is not a Better Harness host, and it is not a replacement for Qoder, Claude,
Codex, or DSH session adapters.

## Native Contract Evidence

### LongHorizon-Harness (outer loop)

Pinned to commit `634030370a9d41ac1c1c6ea7c07bc96ca1d24462` and these owners:

1. [Project positioning, MEA loop, and run-record table](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/README.md)
2. [Paper: task state outside execution, Manage-Execute-Audit](https://arxiv.org/abs/2608.01964)
3. [Default `runs_root` and per-run `harness_dir` / `log_dir`](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/config.py)
4. [Run directory reservation and default `harness/` / `lh_harness/` layout](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/cli.py)
5. [Durable `report.json`, `events.jsonl`, and per-round task state](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/manager.py)
6. [Canonical vs legacy log-dir names and symlink rejection](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/utils/run_boundary.py)
7. [`AuditReport` / `ManagedRound` / `HarnessConfig` shapes](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/types.py)
8. [Screenshots stay in the private run record, not workspace or audit evidence](https://github.com/AMAP-ML/LongHorizon-Harness/blob/634030370a9d41ac1c1c6ea7c07bc96ca1d24462/src/lh_harness/trajectory_artifacts.py)

Later LongHorizon releases are not implicitly supported. Same-version structural
drift must fail closed.

### Better Harness (evidence layer)

Current repository contracts that this proposal must not rewrite:

1. [Host contribution workflow and capability slices](../adapters/contributing-new-coding-agent.md)
2. [Bounded host set and session-analysis registration](../adapters/README.md)
3. [Session diagnostics: supported platforms, workspace qualification](../../references/session-evidence/sessions-diagnostics.md)
4. [DSH as the closest "read-only completed-run evidence" precedent](2026-08-18-93-deepseek-harness-session-evidence.md)
5. [Harness-run JSONL as the closest "completed artifact run as a session"](2026-08-10-harness-run-checkpoints.md)
6. [Architecture: capability ownership, read-only defaults, honest evidence](../ARCHITECTURE.md)

`scripts/host-support/index.mjs` currently registers `qoder`, `codex`, `claude`,
`augment`, `cursor`, `qwen`, `copilot`, `pi`, `kimi`, `workbuddy`, `grok`, and
`dsh`. `scripts/session-analysis/analyzer.mjs` also registers `harness-run`.
There is no `longhorizon`, `deeptask`, `kilo`, `roo`, or `cline` host.

### DeepTask (local Cline-family inner executor)

Inspected only as a local coding-agent persistence contract, not as a proposed
Better Harness host and not as a current LongHorizon `AgentAdapter` backend.

Observed owners at DeepTask 9.3.6:

1. Extension identity `deeptask.deeptask` in `src/package.json`
2. Task directory `path.join(base, "tasks", taskId)` in `src/utils/storage.ts`
3. Durable files `api_conversation_history.json`, `ui_messages.json`,
   `task_metadata.json`, and disk index `taskHistory.json` in
   `src/shared/globalFileNames.ts`
4. UI transcript schema `clineMessageSchema` in `packages/types/src/message.ts`
5. Workspace-qualified history item `historyItemSchema.workspace` in
   `packages/types/src/history.ts`

Default on-disk root on this machine is VS Code/VSCodium
`User/globalStorage/deeptask.deeptask/`. `customStoragePath` can relocate the
task tree. Settings live under `~/.deeptask` and are not session evidence.

## Boundary

```text
Original goal
    -> LongHorizon Manager (outer state, next bounded contract)
        -> inner executor backend (Claude Code / Codex / OpenCode / DSH /
           a future Cline-family agent such as DeepTask)
        -> LongHorizon Auditor (read-only environment inspection)
    -> verified task state + audit report (the only cross-round memory)
    -> Better Harness session-evidence / evidence-bundle (read after the run)
```

| Layer | Owner | What it may claim | What it must not claim |
| --- | --- | --- | --- |
| Inner executor | Claude, Codex, OpenCode, DSH, or a Cline-family agent | One bounded episode's native transcript | The long-horizon task state |
| Outer loop | LongHorizon-Harness | Verified requirements, artifacts, facts, round ledger, audit reports | That it is a Better Harness host or a coding-agent platform |
| Review / evidence | Better Harness | Read-only discovery, workspace qualification, normalization, insights | That it executed, audited, or resumed the LongHorizon run |

Three separations the issue already implies, and this spec keeps:

1. **Execution vs task state.** LongHorizon stores task state outside the
   executor context. Better Harness must not treat an inner transcript as the
   task record.
2. **Self-report vs audit.** Executor claims are not progress. Only auditor
   reports and `report.json` fields derived from them are trusted completion
   evidence.
3. **Runtime vs review.** Reading a completed run is session evidence.
   Continuing, supervising, or re-planning a LongHorizon run is runtime, and
   belongs either to LongHorizon itself or to a future Better Harness runtime
   spec. [NEEDS CLARIFICATION: how far the planned Better Harness runtime
   should overlap MEA vs remaining a review/checkpoint layer.]

## Completed-run layout (qualified)

Default root: `./.lh-harness/runs/<run-id>/` relative to the launch cwd.
`runs_root` and `--runs-root` may relocate it. `workspace` defaults to the
launch directory; `harness_dir` defaults to `<run-dir>/harness`; `log_dir`
defaults to the run's own `lh_harness/`.

Canonical readable layout after a finished or failed run:

```text
<runs_root>/<run-id>/
  harness/                          # task-state directory (out of workspace)
    report.json                     # remote/orchestration copy
    orchestration/report.json
    orchestration/orchestration_transcript.txt
    orchestration/final_response.txt
    orchestration/rounds/round_NNN/
  lh_harness/                       # canonical local log dir
    report.json                     # schema_version 2 final report
    role_orchestration/
      report.json
      events.jsonl                  # append-only outer event stream
      orchestration_transcript.txt
      rounds/round_NNN/
        manager_input.txt
        manager_plan.txt
        task_state.txt
        task_contract.txt
        harness_feedback.txt
        ... executor / auditor artifacts ...
  control/                          # dashboard / supervisor boundary
  tmp/prompts/                      # generated prompts; not evidence
```

Readable legacy log dirs, in discovery order from
`src/lh_harness/utils/run_boundary.py`: `lh_harness/`, then `cua_harness/`,
then `logs/` with `role_management/` instead of `role_orchestration/`.

Rejected as a run: symlink run dirs, symlink log/role children, paths that
resolve outside `runs_root`, non-directories, and run ids containing path
separators or control characters.

`report.json` (schema_version 2, `mode: "role_orchestration"`) is the sealed
summary. Observed fields used for evidence, not an open JSON object:

- identity / control: `schema_version`, `variant`, `mode`, `status`, `task`
- progress: `rounds_run`, `elapsed_seconds`, `current_task_state`,
  `current_task_contract`, `latest_auditor_report`, `last_plan`
- outcome: `completion_satisfied`, `abort_reason`, `error`

Per-round trusted progress lives in `task_state.txt` plus the auditor report
for that round. Role trajectories and screenshots are diagnostic, not
completion evidence. Trajectory screenshots are explicitly **not** copied into
the workspace and **not** supplied to the Auditor.

## Mapping a completed run to session evidence

If this proposal is later implemented, the first slice should look like the
`harness-run` analyzer, not like a new coding-agent host.

| Session-analysis concept | LongHorizon source | Notes |
| --- | --- | --- |
| Platform id | `longhorizon-run` (proposed; not registered) | Distinct from inner hosts. Do not reuse `dsh` or `claude`. |
| Evidence root | `<workspace>/.lh-harness/runs` or `--longhorizon-run-home` | Workspace-scoped; optional. |
| Session id | run-id directory name | Fail closed if the id is not a single path component. |
| Workspace binding | `HarnessConfig.workspace_path` / launch cwd recorded in start event | Qualify with the existing workspace matcher; do not infer from inner transcripts. |
| Timeline | `role_orchestration/events.jsonl` | Outer MEA events only. |
| Completion / outcome | `lh_harness/report.json` | Prefer this over executor self-reports. |
| Task-state spine | `current_task_state` + per-round `task_state.txt` | Compact cross-round memory. |
| Audit spine | per-round auditor artifacts + `latest_auditor_report` | Independent of executor reasoning. |
| Inner tool traces | **out of scope for slice 1** | Join later by workspace + time window, never by overwriting the outer session. |

Suggested outer event vocabulary for slice 1, taken from `manager.py` rather
than invented: `role_harness_start`, `role_harness_resumed`,
`manager_round_start`, `manager_round_done`, `human_instructions_injected`,
`agent_runtime_failed`, `role_harness_cancelled`, `role_harness_done`,
`final_response_discarded`. Unknown event types fail closed, following the DSH
adapter rule.

Normalization allowlist for a first facts slice should stay smaller than the
validated set. A working proposal:

- `role_harness_start` / `role_harness_resumed` / `role_harness_done` /
  `role_harness_cancelled` -> session lifecycle
- `manager_round_start` / `manager_round_done` -> planning
- auditor completion recorded on the round -> validation / outcome
- `agent_runtime_failed` -> error
- human-gate / `ask` events -> permission or user-input, not tool execution

Do not flatten Manager/Executor/Auditor into one assistant turn. The MEA roles
are the evidence. Collapsing them would recreate the self-judging session that
LongHorizon exists to avoid.

## Inner executor join (non-goal for slice 1)

A LongHorizon run may already drive Claude Code, Codex, OpenCode, or DSH. Those
backends already have Better Harness session adapters. DeepTask, inspected
locally, persists a Cline-family task tree:

```text
<globalStorage>/deeptask.deeptask/
  taskHistory.json                  # workspace-qualified index
  tasks/<taskId>/
    ui_messages.json                # ClineMessage[] webview transcript
    api_conversation_history.json   # model I/O
    task_metadata.json              # file-context tracker, not the history item
```

`HistoryItem.workspace` is the qualification key. `parentTaskId` / `childIds`
record delegated children. `task_metadata.json` on disk was observed to hold
`files_in_context`, not the history item; do not treat it as the session index.

This is useful later as an inner-executor evidence source. It is not a reason
to register `deeptask` in this spec. [NEEDS CLARIFICATION: whether maintainers
want a Cline-family host at all; a host being locally inspectable is not
authorization to add one.]

If a later spec joins inner transcripts to an outer run, the join key must be
explicit (run-id + workspace + overlapping time range, or an adapter-written
correlation id). Inner JSONL/JSON must remain a separate platform population.
Mixing them in one session id would break admission and privacy accounting.

## Privacy and fail-closed rules

LongHorizon run records and DeepTask transcripts both contain user task text,
file contents, command output, and sometimes screenshots. Follow the existing
session-evidence privacy contract:

- Discover and normalize locally.
- Never commit raw `runs/`, `ui_messages.json`, `api_conversation_history.json`,
  or trajectory screenshots.
- Fixtures must be synthetic and redacted.
- `facts --debug` locators stay operator-only.
- Absolute paths in fixtures must be platform-constructed, not hard-coded
  POSIX strings.
- Screenshot files under a run are display diagnostics. They are not audit
  evidence and must not be copied into reports.

## Acceptance Scenarios

- LHRE-AC-1: The spec states that LongHorizon-Harness is an outer
  task-lifecycle loop and Better Harness remains a review/evidence layer. No
  public command, host id, or README Quickstart row is added by this document
  alone.
- LHRE-AC-2: A completed run is defined as a real directory
  `<runs_root>/<run-id>/` that is not a symlink and contains a readable
  `report.json` under `lh_harness/`, `cua_harness/`, or legacy `logs/`.
- LHRE-AC-3: Trusted progress is `report.json` plus per-round `task_state.txt`
  and auditor reports. Executor stdout, role trajectories, and screenshots are
  diagnostic only.
- LHRE-AC-4: Workspace qualification uses the LongHorizon workspace/launch cwd,
  not an inner Claude/Codex/DSH/DeepTask session path.
- LHRE-AC-5: A future `longhorizon-run` analyzer, if approved, registers as a
  session-evidence slice only: `SESSION_ANALYSIS` at partial-adapter level,
  no plugin lifecycle, no configured-asset provider, no Quickstart promotion.
- LHRE-AC-6: Unknown `events.jsonl` types, missing `report.json`, symlink run
  dirs, and schema_version other than `2` fail closed rather than extending
  this contract by inference.
- LHRE-AC-7: Inner executor transcripts remain separate platforms. This spec
  does not add `deeptask`, `kilo`, `roo`, or `cline` to
  `scripts/host-support/`.
- LHRE-AC-8: Implementation, if any, ships deterministic synthetic fixtures
  and a workspace-qualified `sources`/`facts` smoke. Live LongHorizon or
  DeepTask transcripts are local smoke only.
- LHRE-AC-9: Documentation, if any, is an integration note plus matrix
  limitations. It does not present LongHorizon as a Better Harness runtime or
  Better Harness as a LongHorizon replacement.
- LHRE-AC-10: GitHub issue/PR publication, fork permissions, and maintainer
  merge remain human actions. This spec is local discussion material.

## Non-goals

- Adding a LongHorizon, DeepTask, Kilo, Roo, or Cline host adapter.
- Implementing `scripts/session-analysis/platforms/longhorizon-run.mjs` in this
  change.
- Teaching Better Harness to spawn `lh-harness`, supervise MEA rounds, or
  resume a run.
- Treating Better Harness checkpoints, Git worktrees, or Studio replay as
  LongHorizon recovery.
- Claiming OSWorld / WeaveBench / Terminal-Bench numbers as Better Harness
  results.
- Replacing DSH, Claude, or Codex session adapters with an outer-loop parser.
- Shipping raw run directories, screenshots, or DeepTask globalStorage files.
- Changing `CHANGELOG.md`, README Quickstart, or host-matrix verification
  level.
- GitHub write operations (issue comment, PR, push). Those stay with the
  operator.

## Plan and Tasks

Discussion-only until a maintainer chooses a slice:

1. Keep this spec as the boundary note requested in #78.
2. If slice 1 is approved: add a read-only `longhorizon-run` session platform
   that discovers `<workspace>/.lh-harness/runs/*/lh_harness/report.json`,
   reads `role_orchestration/events.jsonl`, and normalizes the allowlisted
   outer events. Follow
   [contributing-new-coding-agent.md](../adapters/contributing-new-coding-agent.md)
   at **partial adapter** level.
3. If inner-join is approved later: correlate existing Claude/Codex/DSH
   populations to a run by workspace and time. Do not invent a combined
   session id.
4. If a Cline-family host is separately approved: write its own dated spec
   against a pinned DeepTask/Roo/Kilo native contract. Do not smuggle it into
   this LongHorizon boundary.
5. If Better Harness runtime work lands first: revisit this spec. An outer MEA
   loop inside Better Harness would change the complementarity claim and needs
   an explicit supersession note.

## Test and Review Evidence

- Issue evidence: [#78 body and maintainer comment](https://github.com/QoderAI/better-harness/issues/78)
  (phodal, 2026-08-12): complementary read accepted; spec should cover the
  boundary and how a completed run is session evidence; treat as discussion,
  not a merge commitment; runtime capabilities may arrive in Better Harness.
- LongHorizon layout evidence: README run-record table; `config.py`
  `runs_root = "./.lh-harness/runs"`; `cli.py` default `run_dir / "harness"`;
  `manager.py` writes `role_dir / "events.jsonl"`, `role_dir / "report.json"`,
  `log_dir / "report.json"`, and per-round `task_state.txt`;
  `run_boundary.py` canonical `lh_harness/role_orchestration`.
- Better Harness precedent: `scripts/session-analysis/platforms/harness-run.mjs`
  already treats a completed artifact run as a session without making that
  run a coding-agent host. DSH #93 shows how to pin an upstream format and
  fail closed on drift.
- DeepTask persistence evidence (local, not a support claim):
  `deeptask.deeptask/tasks/<id>/{ui_messages,api_conversation_history,task_metadata}.json`
  plus `taskHistory.json` `workspace` qualification.
- This document is the discussion artifact. No adapter tests are expected
  until a later implementation spec is approved.
- Risk: LongHorizon is iterating (`v0.1.8` as of 2026-10-21). Pin the commit.
  Do not scrape `runs/` from PATH `lh-harness` version drift.
- Risk: `report.json` is written on failure as well as success. `status` and
  `completion_satisfied` must be preserved; do not filter to successful runs
  only.
- Risk: a run directory can contain inner-agent homes (`DSH_HOME`, Claude
  project transcripts). Slice 1 must not recurse into those trees.

## Open questions

- [NEEDS CLARIFICATION: platform id `longhorizon-run` vs documenting an
  integration note with no analyzer.]
- [NEEDS CLARIFICATION: should `harness-run` and `longhorizon-run` share a
  generic "completed external run" substrate, or stay separate owners?]
- [NEEDS CLARIFICATION: maintainer runtime roadmap vs keeping MEA entirely
  outside Better Harness.]
- [NEEDS CLARIFICATION: whether inner-executor join is wanted in v1, later, or
  never.]
- [NEEDS CLARIFICATION: Cline-family host demand. Local DeepTask evidence is
  not a host-adapter proposal.]
