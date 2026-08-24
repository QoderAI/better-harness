# Harness Run Checkpoints

## Traceability

- Spec ID: harness-run-checkpoints
- Status: Draft

## Intent

Introduce a Better Harness checkpoint as a sealed, local state anchor for one
completed Harness artifact run. Later analysis can list, inspect, validate, and
selectively load allowlisted prior context without changing project files,
restoring an agent transcript, switching a Git branch, or claiming that old
artifact bytes have been retained.

The design adopts Entire CLI's separation between a lightweight checkpoint
summary and checkpoint content, but rejects Entire's code-state and Git-history
semantics. In Better Harness, a checkpoint is a run continuity index, not a
source-code rollback mechanism.

## Read This First

- Flow: completed run -> topology/target binding -> analysis intake/validation
  adapter -> sealed envelope substrate -> Better Harness user-state store -> read-only inspect or allowlisted
  learning-context load.
- Native report/selection/component meaning stays in
  `harness-analysis/checkpoint-adapter.mjs`; generic sealing stays in
  `harness-checkpoint/`.
- The normative object is in **Envelope Contract**, path/discovery rules are in
  **Storage and Lifecycle**, callable behavior is in **Public Surface and
  Errors**, and growth rules are in **Versioning and coexistence**.
- V1 never retains artifact bytes, restores code, resumes native sessions,
  merges platform-scoped catalogs, or turns selection/component anchors into
  mutation.
- Multi-host rule (`HRC-AC-16`): implicit learning scan is Qoder-only; every
  other host must supply `--previous-checkpoint` or `--previous-findings` for
  host-correct continuity.

V1 invariants: create is explicit; one immutable envelope is written; artifacts
are referenced rather than copied; artifact kinds and four anchor rows are
closed; topology root plus target identity binds continuity; only learning
capture grants resume-context; Better Harness owns one Git-neutral state store;
platform is provenance/filter data; selection and component state never
authorize mutation; V2 is required before widening any of those semantic
boundaries.

## Design Inputs and Evidence

The reference implementation is [entireio/cli](https://github.com/entireio/cli)
at commit `caa0c9be90261fb2b64bf6cfc7147ee3981494db`, inspected from a local checkout
on 2026-08-10. It is a design input, not a runtime dependency.

Relevant Entire CLI evidence:

- `docs/architecture/sessions-and-checkpoints.md` separates an active Session,
  ephemeral full-state checkpoints, persistent summaries, and session content.
- `api/checkpoint/interfaces.go` separates checkpoint `Read`/`List` from
  session-content reads and seals persistent writes behind typed operations.
- `cmd/entire/cli/checkpoint/checkpoint.go` makes ephemeral checkpoints full
  worktree state on shadow branches, while persistent checkpoints keep
  metadata and commit linkage.
- `cmd/entire/cli/checkpoint_resume.go` and `cmd/entire/cli/resume.go` show that
  Entire resume may switch branch/worktree context and write an agent's native
  session log. Better Harness must not inherit either behavior.
- `docs/architecture/ref-checkpoint-backend.md` solves remote Git-ref storage,
  discovery, push, and migration. Those problems are outside this local MVP.

Relevant Better Harness evidence:

- `scripts/harness-analysis/run-dir.mjs` allocates collision-safe report run
  directories.
- `scripts/harness-analysis/render-report.mjs` publishes an artifact set through
  a staging directory. `scripts/harness-analysis/report-run.mjs`, in contrast,
  states that `harness analyze` normally writes no files. A checkpoint therefore
  anchors a completed artifact run, normally after `harness render`, not every
  analysis call.
- `scripts/harness-analysis/learning-capture-state.mjs` restores one validated
  field projection from an earlier `findings.json`, but its implicit fallback
  recursively scans `.qoder/better-harness` and chooses by modification time.
- `scripts/harness-component-snapshot/` already owns component identity,
  revision, digest, diff, and rollback-reference resolution. Its resolver
  explicitly returns `mutationAuthorized: false`.
- `scripts/session-analysis/selection-plan.mjs` owns the selection profile and
  private fact snapshot. Those artifacts bind an eligible population but do
  not retain the actual plan or selected subset. Profile and snapshot digests
  are therefore a drift anchor, not selection-resume state.
- [Architecture Principles](../ARCHITECTURE.md) require capability ownership,
  public imports, parser-safe output, read-only defaults, explicit mutation,
  argv-array dispatch, and honest evidence classes.

## Decision

`HarnessCheckpointV1` is an immutable envelope that records:

1. a pseudonymous topology-root, canonical target identity, and platform
   provenance scope;
2. one topology-root-relative artifact-run reference;
3. bounded list/show facts;
4. typed topology-root-relative artifact references and exact-byte digests;
5. four semantic anchor rows with explicit availability and access; and
6. a digest over the complete envelope.

Creating a checkpoint proves only that the envelope and referenced artifacts
were readable, topology-root-contained, and valid at creation time. It does not
prove report quality beyond the validators actually run and does not retain
old artifact bytes.

### Mapping from Entire CLI

| Entire CLI | Better Harness |
| --- | --- |
| Session | One analysis lifecycle that may publish an artifact run |
| Checkpoint | One sealed post-run state anchor |
| Ephemeral checkpoint | Existing process or caller-owned scratch; not persisted by the MVP |
| Persistent checkpoint | Local `HarnessCheckpointV1` envelope under Better Harness user state |
| Summary | Bounded envelope summary read without opening run artifacts |
| Session content | Typed artifact references plus digests; bodies are not copied |
| Resume | Validated loading of an allowlisted analysis-context projection |
| Rewind/restore | Unsupported; no worktree, Git, config, or native-session mutation |

### Rejected alternatives

1. **Clone Entire's shadow branches and Git refs.** Better Harness anchors
   analysis evidence; it does not intercept commits or preserve code state.
2. **Make component snapshot the checkpoint owner.** Component snapshot owns
   one evidence class. A checkpoint references it without absorbing its schema,
   diff behavior, or non-authorizing rollback contract.
3. **Inline every artifact body.** Reports and private selection snapshots can
   be large or sensitive. V1 remains a bounded index.
4. **Call profile and snapshot digests selection resume.** Reproducing the
   selected subset also needs the normalized plan or a private selected-id
   result. V1 records only the identity of the frozen population artifacts.
5. **Auto-create after `harness analyze`.** Analyze is intentionally read-only
   and often has no durable run directory.
6. **Put the store in a host namespace or accept a per-command store.** Host
   directories can dirty the worktree and turn a partial host slice into a
   checkpoint claim; arbitrary stores become undiscoverable. V1 uses one
   Better Harness state-home resolver, with a process-wide environment override
   for tests/admin policy, while custom run directories remain supported.

## Domain Model

### Run

A run is a caller-selected local artifact directory for one canonical topology
target, platform, evidence window, and report lifecycle. CLI `--workspace`
means the requested analysis target. The adapter resolves its public
workspace-topology contract; the topology root is the Git root when present and
otherwise the requested standalone directory. `run.runRef` is relative to that
topology root, so a repo-root render directory can safely anchor a member
target. A coding agent session and a Harness run are different concepts.

### Artifact

An artifact is an existing regular file beneath the canonical topology root. The
checkpoint records its portable `workspace:` reference, media type, byte size,
exact-byte digest, and detected native contract. V1 kinds are closed:

- `findings`;
- `report-markdown`;
- `report-html`;
- `canvas-data`;
- `canvas-module`;
- `report-source`;
- `component-snapshot`;
- `session-selection-profile`; and
- `session-selection-snapshot`.

Each kind appears at most once. Unknown run files are ignored, never assigned a
generic semantic role. Adding another artifact kind requires V2. The top-level
`artifacts` array is always emitted in the intake-table order below with absent
optional kinds skipped; envelope validation rejects any other order.

### Normative artifact intake

`scripts/harness-analysis/checkpoint-adapter.mjs` owns the closed intake
registry and all native-contract dispatch. Creation uses exact run-root
filenames for rendered outputs and exact CLI flags for supporting artifacts; it
does not recursively scan the run. Media type is derived from kind, never
sniffed or caller-supplied. `contract` is `null` for byte-only rows and the
listed native `{ name, version }` for structured rows.

| Artifact kind | Intake | Presence | Media type | Validation and recorded contract at create | Anchor |
| --- | --- | --- | --- | --- | --- |
| `findings` | `<run-dir>/findings.json` | Required | `application/json` | Adapter rule below; `{ name: summary.modelId, version: summary.reportContractVersion }` | `report`, `learning-capture` |
| `report-markdown` | `<run-dir>/report.md` | Optional auto-discovery | `text/markdown` | Regular-file and byte-integrity only; `null`; render validation remains separate evidence | `report` |
| `report-html` | `<run-dir>/report.html` | Optional auto-discovery | `text/html` | Regular-file and byte-integrity only; `null` | `report` |
| `canvas-data` | `<run-dir>/canvas.json` | Optional auto-discovery | `application/json` | JSON parse and positive integer `schemaVersion`; `{ name: "canvas-data", version: value.schemaVersion }`; Canvas validation remains separate evidence | `report` |
| `canvas-module` | `<run-dir>/report.canvas.tsx` | Optional auto-discovery | `text/typescript-jsx` | Regular-file and byte-integrity only; `null` | `report` |
| `report-source` | `--source <report.source.json>` | Optional explicit | `application/json` | `harness-analysis/report-source/index.mjs`; `{ name: value.kind, version: value.schemaVersion }` | `report` |
| `component-snapshot` | `--component-snapshot <file>` | Optional explicit | `application/json` | `harness-component-snapshot/index.mjs`; `{ name: value.kind, version: value.schemaVersion }` | `component-state` |
| `session-selection-profile` | `--selection-profile <file>` | Optional paired | `application/json` | `session-analysis/index.mjs`; `{ name: value.kind, version: value.schemaVersion }` | `session-selection` |
| `session-selection-snapshot` | `--selection-snapshot <file>` | Optional paired | `application/json` | `session-analysis/index.mjs`; `{ name: value.kind, version: value.schemaVersion }` | `session-selection` |

For findings, the adapter first requires
`summary.modelId === AGENT_WORK_LOOP_MODEL_ID`, a positive integer
`summary.reportContractVersion`, and arrays at `summary.dimensions` and
`findings`. It then calls `isFullTaskLoopFindings(value)` from
`task-loop-report.mjs`: `true` dispatches to `validateTaskLoopFindings`, and
`false` dispatches to `validateCompactTaskLoopFindings`. The adapter exports
this rule as `validateCheckpointFindingsDocument`. The recorded contract name
is the exact `summary.modelId` string and its version is the exact
`summary.reportContractVersion`; for the current contract these are
`agent-work-loop-v4` and `26`. Missing, unrecognized, or invalid findings fail
with `CHECKPOINT_ARTIFACT_CONTRACT_INVALID` before publication. Practice and
other historical findings families are not V1 checkpoint inputs.

The adapter imports `AGENT_WORK_LOOP_MODEL_ID` from its owner,
`fluency-dimensions.mjs`; it must not redeclare the `agent-work-loop-v4`
literal. The selected native full/compact validator is the acceptance authority:
V1 adds no minimum `FINDING_TARGET_REPORT_CONTRACT_VERSION` gate beyond the
positive version and exact model id recorded above.

Profile and snapshot must be supplied together. Explicit paths may be outside
the run directory but must remain within the same canonical topology root. Rendered
outputs are inspect-only entries in the report anchor; checkpoint validation
does not retroactively claim that render or visual validation ran.

### Anchor

V1 emits exactly four rows, in this order, so absence is explicit:

1. `report`;
2. `learning-capture`;
3. `component-state`; and
4. `session-selection`.

All rows contain `kind`, `state`, `artifactKinds`, `access`, and
`continuityPolicy`. An unavailable row additionally contains `reason` and no
digest-specific fields. An available row omits `reason` and may contain only
the kind-specific fields defined below. The two shapes are closed and mutually
exclusive.

- `report` is available when the required findings artifact validates.
  `artifactKinds` contains `findings` followed by every present report artifact
  in the intake-table order. Its access is always `inspect-only`.
- `learning-capture` is available when findings contains a valid intervention
  ledger at `/summary/learningCapture/interventions`. Its access is
  `resume-context`, policy is `validated-field-only`, and it records a
  canonical selected-state digest over the exact raw JSON array at that pointer,
  before restoration. It records
  `projectionContract: { name: "intervention-ledger", version: INTERVENTION_LEDGER_SCHEMA_VERSION }`.
  The adapter then runs `restoreProjectedInterventionLedger`, requires restored
  length to match, and runs `validateInterventionLedger` on the restored result.
  The restored array is returned to consumers but is never the digest input. A
  valid empty projected ledger remains available. If the field is present but
  restoration or validation fails, create/validate fails with
  `CHECKPOINT_ARTIFACT_CONTRACT_INVALID`; it never converts corrupt continuity
  data into an unavailable row.

The envelope records the imported constant, while V1 validation pins its value
to `1`. A source constant bump fails the V1 fixture and requires the V2 trigger
below; it never silently broadens accepted V1 envelopes.
- `component-state` is available only when a supplied component snapshot passes
  its owner validator and native digest check. Access is
  `inspect-and-diff-only`; it never grants resume.
- `session-selection` is available only when the supplied profile/snapshot pair
  passes both native validators and their profile binding. Access is
  `inspect-only`; it never grants resume or a live-population drift claim in
  V1.
- The closed unavailable-reason set is `artifact-not-supplied` and
  `field-not-present`. Component and selection use the first when their
  explicit inputs are absent. Learning capture uses the second when the valid
  findings document has no projected intervention ledger. Report is always
  available because invalid or absent findings abort creation. Host capability
  flags do not gate these rows, and an unsupported host is rejected before an
  envelope is built.

Checkpoint learning scope is bound by the cryptographic `topologyRootRef` plus
exact `targetRef`/target object, not by findings `summary.projectName`, which is
a caller-controlled display label. The
legacy explicit/implicit findings loader retains its existing project-name
filter for compatibility; the new checkpoint path neither freezes nor infers
workspace identity from that label.

Available rows have these exact kind-specific fields in addition to the common
fields. Native identity/revision details remain inside their referenced
artifacts and are not duplicated in the envelope.

| Anchor | Exact additional fields |
| --- | --- |
| `report` | None |
| `learning-capture` | `selector: "/summary/learningCapture/interventions"`; `projectionContract: { name: "intervention-ledger", version: 1 }`; `stateDigest` over the raw selected array |
| `component-state` | `nativeDigests: { snapshotDigest }`, copied from the validated `HarnessComponentSnapshotV1` |
| `session-selection` | `nativeDigests: { profileDigest, snapshotDigest }`, copied from the validated pair |

For every available row, `artifactKinds` contains exactly the present intake
rows whose Anchor column names that anchor, in intake-table order. Unavailable
rows always use an empty array.

Closed string vocabularies are:

| Field / context | Allowed values |
| --- | --- |
| Envelope `state` | `sealed` |
| Anchor `state` | `available`, `unavailable` |
| Available report `access` / `continuityPolicy` | `inspect-only` / `none` |
| Available learning `access` / `continuityPolicy` | `resume-context` / `validated-field-only` |
| Available component `access` / `continuityPolicy` | `inspect-and-diff-only` / `none` |
| Available selection `access` / `continuityPolicy` | `inspect-only` / `none` |
| Any unavailable row `access` / `continuityPolicy` | `none` / `none` |
| Unavailable `reason` | `artifact-not-supplied`, `field-not-present` |
| List result `status` | `complete`, `partial` |

The report row's `state: "available"` is an intentional uniform-row invariant,
not a state readers need to branch on in V1.

Learning-capture continuity resolution returns validated data to a caller.
Report and selection are inspect-only and component continuity remains with its
existing diff owner. No resolver writes the project, artifacts, checkpoint
store, host configuration, Git state, or native agent session.

## Envelope Contract

This example is the normative V1 shape. Values and optional artifact
rows are illustrative. Exact object fields are enforced and unknown fields are
rejected. It intentionally illustrates a findings-only report anchor; the two
selection artifacts are supporting anchors, not report artifacts.

```json
{
  "kind": "HarnessCheckpointV1",
  "schemaVersion": 1,
  "checkpointId": "hcpt_0123456789abcdef0123456789abcdef",
  "createdAt": "2026-08-10T00:00:00.000Z",
  "state": "sealed",
  "scope": {
    "platform": "qoder",
    "topologyContract": { "name": "better-harness.workspace-topology", "version": 1 },
    "topologyRootRef": "hws:local:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "targetRef": "hwt:local:sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "target": {
      "kind": "workspace-member",
      "route": "packages/app",
      "memberRoute": "packages/app",
      "memberMatch": "exact"
    }
  },
  "run": {
    "runRef": "workspace:.qoder/better-harness/2026-08-10/080000-project"
  },
  "summary": {
    "findingCount": 2,
    "interventionCount": 1,
    "artifactCount": 3,
    "availableAnchorCount": 3
  },
  "artifacts": [
    {
      "kind": "findings",
      "artifactRef": "workspace:.qoder/better-harness/2026-08-10/080000-project/findings.json",
      "mediaType": "application/json",
      "sizeBytes": 4096,
      "byteDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "contract": { "name": "agent-work-loop-v4", "version": 26 }
    },
    {
      "kind": "session-selection-profile",
      "artifactRef": "workspace:.qoder/better-harness/state/selection-profile.json",
      "mediaType": "application/json",
      "sizeBytes": 1024,
      "byteDigest": "sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "contract": { "name": "session-selection-profile", "version": 1 }
    },
    {
      "kind": "session-selection-snapshot",
      "artifactRef": "workspace:.qoder/better-harness/state/selection-snapshot.json",
      "mediaType": "application/json",
      "sizeBytes": 2048,
      "byteDigest": "sha256:2123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "contract": { "name": "session-selection-fact-snapshot", "version": 1 }
    }
  ],
  "anchors": [
    {
      "kind": "report",
      "state": "available",
      "artifactKinds": ["findings"],
      "access": "inspect-only",
      "continuityPolicy": "none"
    },
    {
      "kind": "learning-capture",
      "state": "available",
      "artifactKinds": ["findings"],
      "access": "resume-context",
      "continuityPolicy": "validated-field-only",
      "selector": "/summary/learningCapture/interventions",
      "projectionContract": { "name": "intervention-ledger", "version": 1 },
      "stateDigest": "sha256:3123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
    },
    {
      "kind": "component-state",
      "state": "unavailable",
      "artifactKinds": [],
      "access": "none",
      "continuityPolicy": "none",
      "reason": "artifact-not-supplied"
    },
    {
      "kind": "session-selection",
      "state": "available",
      "artifactKinds": ["session-selection-profile", "session-selection-snapshot"],
      "access": "inspect-only",
      "continuityPolicy": "none",
      "nativeDigests": {
        "profileDigest": "0123456789abcdef",
        "snapshotDigest": "1123456789abcdef"
      }
    }
  ],
  "capabilities": {
    "resumeContext": ["learning-capture"],
    "mutationAuthorized": false,
    "restoreWorkspace": false
  },
  "checkpointDigest": "sha256:4123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
}
```

### Derived fields

The adapter derives these values after native validation; create callers cannot
supply them, and validate recomputes them from the referenced artifacts and
anchor rows.

| Field | Normative derivation |
| --- | --- |
| `summary.findingCount` | Parsed `findings.findings.length` |
| `summary.interventionCount` | Projected intervention-array length when `learning-capture` is available; otherwise `0` |
| `summary.artifactCount` | `artifacts.length` |
| `summary.availableAnchorCount` | Number of anchor rows whose `state` is `available` |
| `capabilities.resumeContext` | Available anchor kinds whose `access` is `resume-context`, preserving anchor order |
| `capabilities.mutationAuthorized` | Always `false` |
| `capabilities.restoreWorkspace` | Always `false` |
| List row `artifactKinds` | Artifact kinds from the sealed array, preserving intake order |
| List row `availableAnchors` | Available anchor kinds, preserving the four-row anchor order |
| List `status` / `nextCursor` | Catalog scan is `complete`/null only at offset zero without diagnostics; otherwise `partial`/the next earlier fixed-record offset |

The adapter is the single derivation owner for `findingCount`,
`interventionCount`, artifact native contracts, and anchor rows. The substrate
is the single derivation owner for `artifactCount`, `availableAnchorCount`, the
capabilities object, id/time, and envelope digest. During validation, each owner
recomputes only its own fields; the other layer compares the resulting frozen
values and never maintains a second derivation algorithm.

### Identifiers and digests

- `checkpointId` is `hcpt_` plus 32 lowercase random hexadecimal characters
  from 16 cryptographically random bytes. It is not a timestamp, content
  address, Git object, or run id.
- Lists follow descending catalog commit offset. `createdAt` and the opaque id
  do not determine order.
- `topologyRootRef` hashes the normalized canonical topology-root path with the
  algorithm below. It exposes no raw path and is intentionally local. Moving a
  checkout causes `CHECKPOINT_WORKSPACE_MISMATCH`; the supported response is to
  create a fresh checkpoint, never edit the old reference.
- `targetRef` hashes the topology-root ref plus the exact public topology target
  projection (`kind`, `route`, `memberRoute`, `memberMatch`). Two members in one
  Git root therefore have distinct continuity/store scopes.
- `byteDigest` is SHA-256 of the exact bytes read once during creation. Native
  semantic digests never substitute for byte integrity.
- `stateDigest` and `checkpointDigest` use the canonical encoding and distinct
  domain prefixes below. `checkpointDigest` covers every field except itself.
- Summary counts and `capabilities.resumeContext` are derived and validated,
  not caller-authored. Both mutation fields are always false.

### Canonical encoding

`scripts/harness-checkpoint/contract.mjs` owns one `canonicalJson(value)`
implementation and all three domain-separated digest helpers. It accepts only
JSON values: null, booleans, strings, finite numbers, arrays without holes, and
plain objects. It rejects `undefined`, non-finite numbers, bigint, cycles,
non-plain objects, and unpaired Unicode surrogates. Strings and finite numbers
use ECMAScript `JSON.stringify` encoding; object keys sort ascending by Unicode
code point; array order is preserved; no insignificant whitespace is emitted.
All hash inputs are UTF-8 bytes and include the shown NUL byte (`\0`):

```text
topologyRootRef = "hws:local:sha256:" + sha256(
  "better-harness:workspace-ref:v1\0" + normalizedCanonicalWorkspace
)
targetRef = "hwt:local:sha256:" + sha256(
  "better-harness:target-ref:v1\0" + canonicalJson({ topologyRootRef, target })
)
stateDigest = "sha256:" + sha256(
  "better-harness:state:v1\0" + canonicalJson(selectedValue)
)
checkpointDigest = "sha256:" + sha256(
  "better-harness:checkpoint:v1\0" + canonicalJson(envelopeWithoutCheckpointDigest)
)
```

`normalizedCanonicalWorkspace` is the resolved topology-root identity. It starts
from `node:fs.realpathSync.native(path.resolve(topologyRoot))`; it falls back to
`realpathSync` only when `.native` is unavailable, never when native resolution
fails. It maps `\\?\C:\...` to `C:\...` and
`\\?\UNC\server\share\...` to `\\server\share\...`, applies NFC normalization,
converts separators to `/`, and removes a trailing separator except for a
filesystem root. On Windows it lowercases the complete normalized path,
matching the repository's existing filesystem-path identity convention. On
macOS/Linux it preserves the native realpath case: native realpath supplies the
on-disk spelling on case-insensitive macOS volumes, while distinct paths remain
distinct on case-sensitive volumes. The implementation fixtures include these
golden vectors (hex digest only):

| Input after domain prefix | SHA-256 |
| --- | --- |
| workspace `/workspace/demo` | `2d1595ed152363ba65867ad6b465639c4e02fd16fd2b4c76380552d0e604316f` |
| Windows workspace normalized from `C:\Users\ALICE\Demo` to `c:/users/alice/demo` | `869aa663e67a888bcad3bb106a48f4c262bf0bc24d9438c5ad1b732d3d8b7860` |
| case-preserving POSIX workspace `/Users/Alice/Demo` | `399b28208461f461b1c24bc1919b7cd7d16262c27fe6cca4d81b9db69306826a` |
| state `{"a":1,"b":["x",true]}` | `ace4cb866f47a3e12db918d5aeabffc4cdce10732bd5b501170a76874cc12860` |
| checkpoint `{"kind":"HarnessCheckpointV1","schemaVersion":1}` | `9497144b285361db56ddc4bda56ba13dcab4fe5f5fb7e172eae2cc9b583ac630` |

### Artifact-reference safety

`workspace:` references are relative to the canonical topology root and use
normalized, percent-encoded, forward-slash path
segments. They reject absolute paths, drive and UNC prefixes, NUL, empty routes,
`.` segments, and `..` segments. Creation and artifact validation resolve the
workspace and artifact through the filesystem and reject symlink or junction
escape; lexical containment alone is insufficient.

The requested target must resolve to the topology target recorded in scope. The
run must be a real directory under the topology root. Every artifact must be a
regular file under that same root. Better Harness state home is outside the
root and can never be an artifact. External temp files, host-home files, raw
transcripts, prompts, credentials, and user-global assets cannot be indexed.

## Storage and Lifecycle

### Store

`scripts/harness-checkpoint/state-root.mjs` owns one Git-neutral, provider-neutral
state home. Resolution occurs only for real commands, never help:

1. absolute `BETTER_HARNESS_STATE_HOME`, when set;
2. Windows: `%LOCALAPPDATA%/Better Harness`;
3. macOS: `$HOME/Library/Application Support/Better Harness`;
4. other platforms: `$XDG_STATE_HOME/better-harness` when absolute, otherwise
   `$HOME/.local/state/better-harness`.

Missing required environment/home values or a relative override fails with
`CHECKPOINT_STATE_ROOT_UNAVAILABLE`. The environment value is the process-wide
standard state home, not a per-command `--store` override: create/list/show use
the same resolver. Tests inject a private state home without touching real user
state. The resolved path and home path never enter an envelope or JSON output.

Platform admission lowercases the supplied id and calls
`getHostDescriptor(hostId)` over the full `HOST_DESCRIPTORS` registry. Only a
canonical descriptor id is accepted; display names and aliases are rejected.
No capability slice or host-local directory is required: platform is envelope
provenance and a list filter, not ownership of checkpoint storage. This keeps
partial/community host activation independent from the checkpoint capability.

The adapter resolves `--workspace` through `resolveWorkspaceTopology`, requires
a valid public topology contract, and derives:

- `topologyRootRef` from `gitRoot ?? requestedWorkspace`;
- the exact target projection and `targetRef`;
- topology-root-relative run/artifact references; and
- the state-store scope from the digest portions of both refs plus platform.

Both public topology statuses, `complete` and `partial`, are accepted because
the resolver preserves the requested target in either case. The exact target
projection is still sealed: if later, more complete discovery changes that
projection, validate and continuity fail with `CHECKPOINT_TARGET_MISMATCH`
instead of silently widening the target.

Before any state directory is created, the state-root resolver follows every
existing symlink/junction in the candidate's nearest existing ancestor and
projects the remaining segments from that canonical ancestor. It rejects a
candidate whose effective location is inside the canonical topology root. It
rechecks the created state root with native realpath before writing an envelope.
A relative, non-directory, unresolved, or topology-root-contained state home
fails with `CHECKPOINT_STATE_ROOT_UNSAFE`; directory creation must not be the
first operation that discovers the escape.

The only V1 envelope store is:

```text
<state-home>/checkpoints/v1/<topology-root-digest>/<target-digest>/<platform>/
  catalog.v1.log
  envelopes/<shard>/<checkpoint-id>.json
```

`<shard>` is the first two random hex characters after `hcpt_`. An absolute or
custom run directory remains valid when contained by the topology root,
including a repo-root render for a member target. The store is outside the
worktree, so create must leave Git status unchanged.

### Bounded catalog

`catalog.v1.log` is the sole list-order owner. Each committed checkpoint appends
one fixed 110-byte ASCII record in a single `O_APPEND` write:

```text
<37-byte checkpoint-id>|<71-byte sha256 checkpoint-digest>\n
```

The catalog offset is commit order and therefore list order; `createdAt` is
metadata and does not order rows. Creation opens the never-before-used envelope
path with exclusive-create semantics, writes/fsyncs/closes the complete
envelope, then issues one 110-byte append and fsyncs the catalog. An id collision
retries with fresh randomness and never overwrites a file. An append failure
before a complete record removes that process's new envelope and may leave a
torn suffix that list reports. Once a complete record has been accepted by the
OS, an append-fsync failure is publication-indeterminate: the envelope remains,
create returns `CHECKPOINT_CATALOG_APPEND_FAILED`, and a later list may expose
the valid record. A process crash before the append may leave an unlisted
orphan; no failure path reports success. Orphan repair/cleanup is outside V1.

`list` reads the catalog tail by fixed offsets, never enumerates envelope
shards. It accepts an opaque byte-offset cursor, reads at most `scanLimit`
records (default `max(100, limit * 4)`, maximum 1000), and returns at most 200
rows. A torn suffix, bad record, missing/corrupt envelope, or remaining earlier
records yields `status: partial`, safe diagnostics, and `nextCursor`; reaching
offset zero without diagnostics yields `complete`. Work per call is therefore
bounded independently of total checkpoint count. Direct show/validate derives
the sharded envelope path from the id and does not scan the catalog.

Creation resolves topology/run/artifact containment, reads every artifact into
one immutable buffer exactly once, computes the byte digest from that buffer,
parses/validates that same value, builds anchors/derived fields, publishes the
envelope, and commits its catalog record. The command never changes or copies an
artifact or writes the target worktree. User-state directories/files request
owner-only permissions where supported; permissions are defense in depth, not
the semantic containment boundary.

### Anchor validity, not retention

The envelope is immutable; artifact references are pointers. If an artifact is
later edited or deleted, the checkpoint remains listable and showable, while
validation and affected continuity loading fail. They never accept new bytes,
rewrite the digest, or fall back to another report.

This matters for `record-fix-output`, which can replace `findings.json`. Create
the checkpoint after the desired update and validation. A later update needs a
new checkpoint; the old checkpoint does not preserve the earlier findings.
Content-addressed retention needs a separate storage, retention, and privacy
spec.

V1 has no automatic retention, cleanup, remote sync, or cascade deletion.
Deleting an envelope does not delete its run; deleting a run leaves a stale
checkpoint that validation reports. A future cleanup command must preview exact
targets and requires its own spec.

### Versioning and coexistence

V1 is closed. New top-level fields, artifact kinds, anchor kinds/order, access
policies, digest algorithms, intervention projection field/restore semantics or
schema version, field removals, or semantic changes require a new
`HarnessCheckpointV2` and `checkpoints/v2/` directory. Adding a canonical
platform id through the repository's host-adapter process is provenance data
and not a checkpoint schema change; it adds no state-root metadata.

Host-specific, third-party, and newly rendered artifact kinds are deliberately
unsupported in V1: unknown run files remain ignored and there is no generic
extension slot. This is a privacy and semantic-ownership boundary, even though
it means an artifact that needs checkpoint semantics waits for a reviewed V2
schema. Adding a render output alone does not force V2 if it remains unindexed.
The contributor path for an indexed kind is a dated V2 spec that assigns its
native validator, media/contract mapping, anchor access, privacy boundary, and
tests before changing the adapter. The expected low-risk V2 shape is an
additive superset of V1 with optional new artifact/anchor rows and unchanged V1
semantics; removals or semantic reinterpretation require separate migration
justification. V2 still receives its own kind, directory, and digest domain so
the version boundary stays unambiguous.

A V1 reader enumerates only `v1/`. A wrong kind or schema version inside that
directory produces `UNSUPPORTED_CHECKPOINT_VERSION` and partial list
accounting; it is never silently skipped or interpreted as V1. Future version
directories coexist without implicit union. Migration must write a new
envelope into the new version store and leave the old envelope intact; V1 has
no in-place rewrite or portable-workspace migration.

### Upgrade path

V1 ships no speculative migration command because an index whose artifacts are
already stale cannot be faithfully upgraded. A future V2 tool must retain an
explicit read-only `--schema-version 1` compatibility mode for list/show and
V1 validation, even if its default row output targets V2. Default future list
output must also show envelope-only counts for every detected version so V1 is
visible, while returning detailed rows for only the selected version; it must
not silently union rows or interpret a V1 envelope as V2. If the V2 spec adds
migration, that command must validate the referenced artifacts, create a new V2
envelope with a new id, leave V1 intact, and report stale V1 inputs rather than
manufacturing retained state. Thus V1 remains visible after upgrade without
promising that every old checkpoint is migratable.

## Public Surface and Errors

The dependency direction is one-way:

```text
harness-analysis/checkpoint-adapter
  -> harness-checkpoint (sealed-envelope substrate)
  -> host-support, workspace-topology, report-source, session-analysis, component-snapshot
```

`scripts/harness-checkpoint/` imports only Node built-ins and its own private
modules. It never imports `harness-analysis`, `host-support`, session analysis,
or component snapshot. Its `index.mjs` exposes envelope/reference/digest/store
primitives to the adapter:

```text
validateHarnessCheckpointEnvelope(value) -> frozen envelope
sealHarnessCheckpoint({
  stateRoot, scope, runRef, artifactRecords, anchorRows, semanticCounts
}) -> frozen envelope
readHarnessCheckpointAtStore({ stateRoot, topologyRootRef, targetRef, platform, checkpointId })
  -> frozen envelope
listHarnessCheckpointsAtStore({
  stateRoot, topologyRootRef, targetRef, platform, limit, cursor, scanLimit
}) -> { status, checkpoints, diagnostics, nextCursor }
verifyHarnessCheckpointArtifacts(checkpoint, { topologyRoot, target }, consumeVerifiedArtifacts)
  -> { byteFacts, consumerValue }
```

`scripts/harness-analysis/checkpoint-adapter.mjs` is the application behavioral
surface. It resolves topology/target scope and state home, owns intake and native validation, constructs
anchors, and delegates sealing/storage to the substrate. It exports:

```text
validateCheckpointFindingsDocument(value) -> { contract, representation, findings }
createHarnessAnalysisCheckpoint(options) -> frozen envelope
readHarnessAnalysisCheckpoint({ workspace, platform, checkpointId }) -> frozen envelope
listHarnessAnalysisCheckpoints({ workspace, platform, limit, cursor, scanLimit })
  -> { status, checkpoints, diagnostics, nextCursor }
validateHarnessAnalysisCheckpoint(checkpoint, { workspace }) -> frozen envelope
resolveHarnessAnalysisCheckpointLearningCapture({ workspace, platform, checkpointId })
  -> { checkpointId, interventionLedger, evidenceRef }
```

List returns bounded projections, never full envelopes. These JSON shapes are
closed; nullable diagnostic fields are present as `null`, not omitted:

```json
{
  "status": "complete",
  "checkpoints": [
    {
      "checkpointId": "hcpt_0123456789abcdef0123456789abcdef",
      "createdAt": "2026-08-10T00:00:00.000Z",
      "state": "sealed",
      "platform": "qoder",
      "targetRef": "hwt:local:sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "target": {
        "kind": "workspace-member",
        "route": "packages/app",
        "memberRoute": "packages/app",
        "memberMatch": "exact"
      },
      "runRef": "workspace:.qoder/better-harness/2026-08-10/080000-project",
      "summary": {
        "findingCount": 2,
        "interventionCount": 1,
        "artifactCount": 3,
        "availableAnchorCount": 3
      },
      "artifactKinds": ["findings", "session-selection-profile", "session-selection-snapshot"],
      "availableAnchors": ["report", "learning-capture", "session-selection"]
    }
  ],
  "diagnostics": [],
  "nextCursor": null
}
```

A partial entry is exactly:

```json
{
  "code": "CHECKPOINT_DIGEST_MISMATCH",
  "checkpointId": "hcpt_0123456789abcdef0123456789abcdef",
  "platform": "qoder",
  "targetRef": "hwt:local:sha256:1123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "field": null,
  "catalogOffset": null
}
```

The verification primitive first reads and byte-verifies every sealed artifact
in order. Only after all byte checks succeed does it invoke
`consumeVerifiedArtifacts` exactly once with the ordered in-memory
`[{ record, bytes }]` rows. The analysis adapter parses and native-validates
those buffers and returns its reconstruction as `consumerValue`; raw bytes are
never returned through the CLI or retained by the substrate. The closed
`byteFacts` result is:

```json
{
  "checkpointId": "hcpt_0123456789abcdef0123456789abcdef",
  "topologyRootRef": "hws:local:sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "artifacts": [
    {
      "kind": "findings",
      "sizeBytes": 4096,
      "byteDigest": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      "status": "verified"
    }
  ]
}
```

Byte-fact artifacts preserve sealed intake order. Root `validate --json` wraps
the full envelope as
`{ "artifactVerification": "verified", "checkpoint": <envelope> }`; `show
--json` uses the same wrapper with `artifactVerification: "not-run"`. Neither
exposes the internal byte-facts object separately.

The primary write API has this closed options contract:

| Option | Requirement | Rule |
| --- | --- | --- |
| `workspace` | Required | Requested analysis target; resolved through public workspace topology before artifact reads |
| `platform` | Required | Canonical host id accepted by host-support; no alias is stored |
| `runDir` | Required | Existing topology-root-contained directory with required `findings.json` |
| `source` | Optional | Topology-root-contained report-source file |
| `componentSnapshot` | Optional | Topology-root-contained component snapshot file |
| `selectionProfile` | Optional paired | Topology-root-contained; must appear with `selectionSnapshot` |
| `selectionSnapshot` | Optional paired | Topology-root-contained; must appear with `selectionProfile` |

There are no caller options for id, time, state home, media type, contract,
summary, anchors, capabilities, or digests. The CLI flags are the kebab-case
forms in the intake table. Test-only clock/random injection is private to the
substrate and is not part of this API.

On create, the adapter resolves/freeze-validates the public workspace topology,
reads each artifact into one immutable buffer exactly once, hashes that buffer,
parses that same buffer, and invokes value-level native validators. It supplies
only scope, ordered `artifactRecords`, exact `anchorRows`, and semantic
`{ findingCount, interventionCount }` to `sealHarnessCheckpoint`. The substrate
generates id/time, derives artifact/available-anchor counts and capabilities,
checks structural cross-field invariants, computes the envelope digest, and
writes it. It never accepts a prebuilt summary or capabilities object.

On validate, the substrate first checks the closed envelope, digest, freshly
resolved topology scope, ordered artifact references/bytes, and structurally
derived counts/capabilities. After every byte check succeeds, the adapter's
single consume callback reruns every native validator over those same buffers,
reconstructs artifact records, anchors, and semantic counts, and requires exact
equality with the envelope. Any derived or native mismatch is
`INVALID_CHECKPOINT`, except byte/contract failures that use their more specific
codes.

The exact validation sequence is:

| Step | Owner / export | Recompute / compare | Failure |
| --- | --- | --- | --- |
| 1 | Substrate / `validateHarnessCheckpointEnvelope` | Parse closed kind/schema/field enums and artifact/anchor order | `UNSUPPORTED_CHECKPOINT_VERSION` or `INVALID_CHECKPOINT` |
| 2 | Substrate / `validateHarnessCheckpointEnvelope` | Recompute envelope digest without `checkpointDigest` | `CHECKPOINT_DIGEST_MISMATCH` |
| 3 | Substrate / `verifyHarnessCheckpointArtifacts` | Recompute canonical topology-root ref from disk plus target ref from the adapter's freshly resolved target, then validate every `workspace:` reference | `CHECKPOINT_WORKSPACE_MISMATCH`, `CHECKPOINT_TARGET_MISMATCH`, or `UNSAFE_CHECKPOINT_ARTIFACT_REF` |
| 4 | Substrate / `verifyHarnessCheckpointArtifacts` | Read exact bytes once in sealed order; compare size and byte digest for all rows before invoking the consume callback | `CHECKPOINT_ARTIFACT_MISSING` or `CHECKPOINT_ARTIFACT_DIGEST_MISMATCH` |
| 5 | Substrate / `validateHarnessCheckpointEnvelope` | Derive `artifactCount`, `availableAnchorCount`, and capabilities from sealed structural rows | `INVALID_CHECKPOINT` |
| 6 | Adapter / `validateHarnessAnalysisCheckpoint` | Parse each once-read buffer, native-validate its value, and reconstruct media/contract records | `CHECKPOINT_ARTIFACT_CONTRACT_INVALID` or `INVALID_CHECKPOINT` for record mismatch |
| 7 | Adapter / `validateHarnessAnalysisCheckpoint` | Reconstruct anchor rows, `findingCount`, and `interventionCount` from validated values | `INVALID_CHECKPOINT` |
| 8 | Adapter / `validateHarnessAnalysisCheckpoint` | Return the frozen validated envelope; write nothing | No additional failure class |

The Derived fields table defines the same ownership; this sequence defines
comparison order and error precedence.

The split intentionally pays a small derivation/comparison cost to keep the
sealed-envelope substrate free of native report and host imports. Contributors
must not collapse native semantics into `scripts/harness-checkpoint/` merely to
remove that boundary.

Only the analysis adapter imports the checkpoint index. Other analysis modules
import the adapter, never checkpoint private modules. The adapter imports
workspace-topology, report-source, session-analysis, and component-snapshot through their public
indices; its same-capability findings/ledger imports are exact named exports
from `task-loop-report.mjs`, `intervention-ledger.mjs`, and
`fluency-dimensions.mjs`. The adapter imports owner constants and must not copy
their literals. The planned refactor contract test asserts that no file under
`scripts/harness-checkpoint/` imports from another capability and that consumers
do not bypass either public surface.

To make the one-read rule implementable, `session-analysis/index.mjs` adds and
owns public I/O-free exports
`validateSessionSelectionProfile(value)`,
`validateSessionSelectionSnapshot(value)`, and
`assertSessionSelectionProfileSnapshotBinding(profile, snapshot)`. Existing
file-reading helpers delegate to these exports. The pair-binding function checks
profile digest, scope, and eligible count only; it does not rediscover or read
current sessions. Re-declaring those rules in the checkpoint adapter is
forbidden.

Stable operational codes are:

- `CHECKPOINT_NOT_FOUND`;
- `INVALID_CHECKPOINT`;
- `UNSUPPORTED_CHECKPOINT_VERSION`;
- `CHECKPOINT_DIGEST_MISMATCH`;
- `CHECKPOINT_WORKSPACE_MISMATCH`;
- `CHECKPOINT_TARGET_MISMATCH`;
- `UNSAFE_CHECKPOINT_ARTIFACT_REF`;
- `CHECKPOINT_ARTIFACT_MISSING`;
- `CHECKPOINT_ARTIFACT_DIGEST_MISMATCH`;
- `CHECKPOINT_ARTIFACT_CONTRACT_INVALID`;
- `CHECKPOINT_ANCHOR_UNAVAILABLE`;
- `CHECKPOINT_CONTINUITY_UNSUPPORTED`;
- `CHECKPOINT_STATE_ROOT_UNAVAILABLE`;
- `CHECKPOINT_STATE_ROOT_UNSAFE`;
- `CHECKPOINT_CATALOG_APPEND_FAILED`; and
- `CHECKPOINT_CATALOG_CORRUPT`.

The error precedence and caller surfaces are normative. Envelope/version/digest
checks precede workspace and artifact checks; a specific safety, missing,
byte-digest, or native-contract code takes precedence over
`INVALID_CHECKPOINT`. Safe payload fields are an allowlist; messages never add
absolute paths or artifact bodies.

| Code | Surfaces / phase | Trigger | Safe payload fields |
| --- | --- | --- | --- |
| `CHECKPOINT_NOT_FOUND` | show, id-validate, continuity | No envelope at the selected topology/target/platform/id | `checkpointId`, `platform`, `targetRef` |
| `INVALID_CHECKPOINT` | create, list diagnostic, show, validate | Closed-shape, order, derived-field, reconstructed-anchor, or semantic-count mismatch without a more specific code | `checkpointId?`, `field?` |
| `UNSUPPORTED_CHECKPOINT_VERSION` | list diagnostic, show, validate | Kind/schema does not match the selected version reader | `checkpointId?`, `kind?`, `schemaVersion?` |
| `CHECKPOINT_DIGEST_MISMATCH` | list diagnostic, show, validate, continuity | Envelope digest differs before artifact access | `checkpointId` |
| `CHECKPOINT_WORKSPACE_MISMATCH` | file/id-validate, continuity | Recomputed topology-root ref differs | `checkpointId`, `platform` |
| `CHECKPOINT_TARGET_MISMATCH` | create, validate, continuity | Recomputed public topology target/ref differs | `checkpointId?`, `targetRef` |
| `UNSAFE_CHECKPOINT_ARTIFACT_REF` | create, validate, continuity | Reference parse, topology containment, type, or symlink/junction rule fails | `checkpointId?`, `artifactKind` |
| `CHECKPOINT_ARTIFACT_MISSING` | create, validate, continuity | Required referenced regular file is absent | `checkpointId?`, `artifactKind` |
| `CHECKPOINT_ARTIFACT_DIGEST_MISMATCH` | validate, continuity | Exact current bytes differ from the sealed digest | `checkpointId`, `artifactKind` |
| `CHECKPOINT_ARTIFACT_CONTRACT_INVALID` | create, validate, continuity | JSON/native contract or present learning ledger is invalid | `checkpointId?`, `artifactKind` |
| `CHECKPOINT_ANCHOR_UNAVAILABLE` | continuity | Requested learning anchor is unavailable | `checkpointId`, `anchorKind`, `reason` |
| `CHECKPOINT_CONTINUITY_UNSUPPORTED` | adapter misuse | A non-resume anchor is requested as continuity | `checkpointId`, `anchorKind` |
| `CHECKPOINT_STATE_ROOT_UNAVAILABLE` | create, list, show, id-validate | Standard user-state home cannot be resolved safely | `platform` |
| `CHECKPOINT_STATE_ROOT_UNSAFE` | create, list, show, id-validate | State-home path is relative, non-directory, unresolved, or canonically inside the topology root | `platform`, `targetRef` |
| `CHECKPOINT_CATALOG_APPEND_FAILED` | create | Catalog append or durability confirmation failed; publication may be indeterminate only after a complete record write | `checkpointId`, `platform`, `targetRef`, `publication` |
| `CHECKPOINT_CATALOG_CORRUPT` | list diagnostic | Fixed record/torn suffix is invalid or its envelope digest disagrees | `platform`, `targetRef`, `catalogOffset` |

Every list diagnostic uses the closed projection shown above, so the selected
`platform`/`targetRef` context and nullable `field`/`catalogOffset` are allowed
even when the exception row lists fewer code-specific fields. Diagnostics never
include artifact bodies or absolute paths. `publication` is the closed string
`not-committed` or `indeterminate` and appears only on create failure.


## CLI Contract

The root registry adds one `advanced` leaf, `harness checkpoint`, backed by
`scripts/harness-analysis/checkpoint-cli.mjs`:

```text
better-harness harness checkpoint create --workspace <dir> --platform <host> --run-dir <dir> [--source <file>] [--component-snapshot <file>] [--selection-profile <file> --selection-snapshot <file>] [--json]
better-harness harness checkpoint list --workspace <dir> --platform <host> [--limit <n>] [--cursor <opaque>] [--scan-limit <n>] [--json]
better-harness harness checkpoint show <id> --workspace <dir> --platform <host> [--json]
better-harness harness checkpoint validate <id> --workspace <dir> --platform <host> [--json]
better-harness harness checkpoint validate --checkpoint <file> --workspace <dir> [--json]
```

Selection profile and snapshot flags are a required pair; supplying exactly one
is invalid usage and exits 64.

File-mode validation reads `scope.platform` from the envelope, does not access a
store, and resolves `--workspace` to verify exact topology-root/target binding
and artifact references. `--checkpoint` and a positional id are mutually
exclusive.

- `create` is the only write action; it writes only Better Harness user state:
  missing store directories, one envelope, and one catalog record.
- `list` reads a bounded catalog tail and referenced envelopes, defaults to 20,
  caps rows at 200/scan at 1000, and performs no network or artifact reads.
  Unreadable/corrupt entries or remaining cursor history produce a partial result.
- `show` reads one envelope and reports that artifact verification was not run.
- `validate` verifies envelope/digest, topology-root/target, artifact bytes/contracts,
  anchors, summary, and capabilities.
- Help performs no filesystem, workspace, Git, host-home, or network access.
- JSON mode emits one parser-safe document on stdout. Invalid usage exits 64,
  success 0, partial list 2, and operational/validation failure 1.

The command stays advanced until an end-to-end continuity journey is validated.
Continuity loading is adapter/consumer-only in V1; there is no root CLI
`resume`, `continuity`, or context-dump action.

## Consumer Integration

### Learning capture

`loadPriorLearningCaptureState` gains `platform = "qoder"` and
`previousCheckpoint`; `task-loop-source.mjs` adds
`--previous-checkpoint <id>` beside its existing `--previous-findings`. Its
already-resolved `platform` value is passed to the loader.

1. `--previous-checkpoint` and `--previous-findings` are mutually exclusive.
2. An explicit checkpoint must match the freshly resolved topology-root ref,
   exact target ref/object, and platform provenance; pass findings validation;
   expose learning capture; match the selected-state digest; and pass
   `validateInterventionLedger`. `summary.projectName` remains a display label
   and is not a checkpoint-scope binding. Two members sharing one Git root
   cannot load each other's checkpoint context.
3. Explicit-checkpoint failure is a hard error and never falls through to a
   newer findings file.
4. With neither explicit option, the current implicit findings scan remains a
   compatibility fallback. To preserve no-option behavior, its root remains the
   literal `<workspace>/.qoder/better-harness` even when the loader receives a
   different `platform`; `platform` affects only explicit checkpoint store
   resolution in V1.
5. The loader preserves its existing return shape
   `{ interventionLedger, evidenceRef, warning }`. Non-empty checkpoint success
   returns `warning: null` and
   `{ kind: "prior-harness-report", id: checkpointId, label: "N validated prior intervention(s)" }`.
   A valid empty ledger returns `[]`, `evidenceRef: null`, and `warning: null`.
   Failure throws and therefore has no warning return. The whole findings
   document is never returned.

`evidenceRef.id` is opaque to downstream report/render code. The legacy
findings path retains its current fixed id; checkpoint loading uses the safe
checkpoint id. No consumer may branch on the literal id.

The literal Qoder fallback is a documented V1 compatibility limitation, not a
claim of multi-host implicit continuity. A non-Qoder caller that wants
platform-scoped continuity must pass `previousCheckpoint` (or the legacy
explicit findings path). A future V2 may remove implicit scanning or make its
root explicit, but must not silently change the no-option search root inside
V1.

`learning-capture-state.mjs` exports the single constant
`LEGACY_QODER_LEARNING_ROOT = ".qoder/better-harness"`; all compatibility scans
use it. V2 either replaces that one symbol with an explicit parameterized root
contract or removes implicit scanning, never copies one literal per host.

`harness analyze` pass-through may land only if its no-default-write behavior
remains unchanged.

### Selection and component state

At create and each validate call, V1 reads each referenced selection file once,
hashes/parses that buffer, invokes both new public value validators, re-checks
profile/snapshot binding, and compares native digests with the recorded anchor.
This proves the frozen artifacts are intact;
it does not rediscover the host's current eligible population and therefore
makes no live drift claim. V1 exposes no selection resume or population-compare
API. A later design must include a normalized plan or private selected-id result
and explicit current-population input; that requires V2 under the closed
version rule.

Component snapshot behavior does not change. The checkpoint calls its public
validator and records its native digest. Existing diff/resolve owners continue
to interpret it, and resolve stays `mutationAuthorized: false`.

All native digest strings (component and selection) are copied verbatim from
their owner contracts and compared verbatim; checkpoint code never adds,
removes, or normalizes a digest prefix.

## Ownership and Planned Files

- `scripts/harness-checkpoint/contract.mjs` — envelope, canonical JSON, ids,
  digests, anchors, and exact validation contract.
- `scripts/harness-checkpoint/references.mjs` — workspace reference and
  topology-root/target refs and canonical containment.
- `scripts/harness-checkpoint/state-root.mjs` — cross-platform Better Harness
  user-state resolution; no worktree writes.
- `scripts/harness-checkpoint/catalog.mjs` — fixed record, cursor, bounded tail
  reads, append/fsync, and diagnostics.
- `scripts/harness-checkpoint/store.mjs` — scoped envelope paths, atomic create,
  direct read, and catalog composition.
- `scripts/harness-checkpoint/index.mjs` — substrate exports only; no native
  artifact knowledge.
- `scripts/harness-analysis/checkpoint-adapter.mjs` — closed intake table,
  topology/target binding, native validator dispatch, anchors, byte validation,
  and learning-context resolution.
- `scripts/harness-analysis/fluency-dimensions.mjs` — existing owner of the
  imported Agent Work Loop model/contract constants; no checkpoint logic.
- `scripts/harness-analysis/checkpoint-cli.mjs` — parsing, help, human output,
  and JSON over the analysis adapter.
- `scripts/better-harness-cli/registry.mjs` — metadata-only advanced command.
- `scripts/workspace-topology/index.mjs` — existing public topology resolver and
  target contract used without duplicating monorepo logic.
- `scripts/session-analysis/index.mjs` and `selection-plan.mjs` — public
  I/O-free profile/snapshot/pair validation added beside existing readers.
- `scripts/harness-analysis/learning-capture-state.mjs` and
  `scripts/harness-analysis/task-loop-source.mjs` — explicit consumer option.
- `docs/ARCHITECTURE.md` — under `## Directory Conventions`, add a checkpoint
  ownership bullet immediately before the existing `scripts/plugin-lifecycle/`
  bullet: substrate scope, its six files, its single index, analysis
  adapter/CLI ownership, and the one-way dependency rule above.
- `docs/docs/concepts/harness-run-checkpoints.md` and
  `docs/docs/troubleshooting.md` — after behavior exists, document the advanced
  CLI, its non-restore boundary, stale-artifact failures, platform namespace,
  and the Qoder-only legacy fallback limitation from `HRC-AC-16`.

Contributor and agent routing is fixed:

| Change | Owner / required version |
| --- | --- |
| Envelope/reference/store mechanics | `scripts/harness-checkpoint/` |
| Intake, native artifact, anchors, or learning continuity | `scripts/harness-analysis/checkpoint-adapter.mjs` |
| Root command behavior | `scripts/harness-analysis/checkpoint-cli.mjs` plus metadata registry |
| New host | Existing `scripts/host-support/` admission only; no checkpoint storage metadata |
| New artifact kind, anchor kind, or resume capability | A reviewed V2 spec before implementation |
| Legacy/no-option learning behavior | `scripts/harness-analysis/learning-capture-state.mjs` |
| Any anchor, summary-count, or capabilities change | Update adapter reconstruction, substrate structural derivation, the Derived fields table, validation sequence, and cross-layer equality fixture together |

## Acceptance Scenarios

- **HRC-AC-1 (semantic boundary):** Checkpoint help says it anchors analysis
  state and cannot preserve or restore code, Git, config, native sessions,
  transcripts, or prompts.
- **HRC-AC-2 (sealed create):** A contained run writes one new immutable
  envelope plus one fixed catalog commit under user state, with random id,
  derived fields, artifact/state digests, and a valid checkpoint digest;
  referenced artifacts and Git status do not change.
- **HRC-AC-3 (deterministic intake):** Only exact intake-table filenames and
  explicit flags become artifacts; findings is required, optional outputs are
  inspect-only, paired selection input is enforced, and unknown files are
  ignored.
- **HRC-AC-4 (safe references):** Absolute, traversal, NUL, cross-topology-root,
  symlink/junction escape, directory, user-state, or external-temp targets fail
  before publication on Windows, macOS, and Linux; native realpath and the
  platform case rules reproduce the workspace golden vectors.
- **HRC-AC-5 (honest anchors):** Four rows are always present; unavailable shape
  and reason are explicit; a present invalid learning ledger fails rather than
  degrading to unavailable; component and selection never grant resume in V1.
- **HRC-AC-6 (digest separation):** Byte, native, selected-state, and envelope
  digests are independently checked and never substituted.
- **HRC-AC-7 (bounded discovery):** List follows newest catalog commits, reads
  at most the fixed scan budget independent of total count, and returns an
  opaque earlier cursor; torn/corrupt/missing entries produce partial safe
  diagnostics.
- **HRC-AC-8 (show/validate):** Show does not imply artifact verification;
  validate detects corrupt envelope, topology-root/target/version mismatch,
  missing or changed artifacts, invalid native contracts, and stale derived
  fields.
- **HRC-AC-9 (learning continuity):** A valid explicit checkpoint restores only
  the ledger; explicit missing/stale/unavailable inputs fail closed without
  modification-time fallback.
- **HRC-AC-10 (selection/component honesty):** Selection validates only its
  frozen profile/snapshot identity and makes no live drift or resume claim;
  component state remains inspect/diff-only with mutation unauthorized.
- **HRC-AC-11 (CLI effects):** CLI help is zero-read; list/show/validate are
  read-only; create writes only Better Harness user-state envelope/catalog data
  and leaves the worktree unchanged; JSON stdout is one document. The
  consumer-only continuity loader is also read-only, and V1 exposes no
  continuity CLI.
- **HRC-AC-12 (platform paths):** State-home resolution follows the normative
  Windows/macOS/Linux policy; platform remains provenance/filter data; custom
  topology-contained run paths work; path/argv behavior is cross-platform.
- **HRC-AC-13 (privacy):** Envelopes contain no absolute/home paths, session ids,
  prompts, transcripts, commands, credentials, or artifact bodies. Private
  selection snapshots remain referenced, never inlined.
- **HRC-AC-14 (stale artifacts):** Changed/deleted artifacts leave the checkpoint
  listable but make validate and affected continuity fail without digest repair.
- **HRC-AC-15 (compatibility/versioning):** With no checkpoint option existing
  behavior is unchanged, including the literal Qoder implicit-learning root for
  non-Qoder callers; V1 rejects unsupported versions and never scans future
  version stores, while future readers retain explicit V1 compatibility mode.
- **HRC-AC-16 (multi-host fallback hazard):** User and troubleshooting docs say
  non-Qoder continuity requires an explicit checkpoint/findings input; tests
  prove no-option still scans only the literal Qoder root, and the V2 path is an
  explicit scan root or removal of implicit scanning rather than copying that
  literal into community hosts.

## Non-goals

- Preserve, rewind, restore, stage, commit, stash, or change workspace files.
- Store raw prompts, transcripts, reasoning, native sessions, credentials, or
  source bodies.
- Add Git refs/branches/trailers/hooks, a remote store, sync, or multi-device
  discovery.
- Replace any referenced native contract or retroactively certify render
  validation.
- Copy artifacts into a content store or guarantee continuity after they change.
- Auto-create, auto-load latest, add a per-command store override, make analyze
  write by default, implement selection resume, retention, or cleanup.
- Provide a generic extension artifact, index host-specific/third-party output,
  or union checkpoint discovery across platform namespaces in V1.
- Add a Coding Agent host or change support levels.

## Plan and Tasks

1. Implement canonical checkpoint substrate, state-home/catalog store, topology
   scope, the analysis adapter's closed intake registry, and the CLI
   (HRC-AC-1..HRC-AC-8, HRC-AC-11..HRC-AC-14).
2. Register the advanced CLI leaf and update inventory/help/side-effect fixtures
   (HRC-AC-7, HRC-AC-8, HRC-AC-11, HRC-AC-12).
3. Add explicit learning checkpoint loading while preserving the no-option
   fallback and documenting the multi-host limitation
   (HRC-AC-9, HRC-AC-15, HRC-AC-16).
4. Add I/O-free public selection validators and validate component/selection
   artifacts from the same once-read buffers through public owners
   (HRC-AC-5, HRC-AC-10).
5. Update architecture and concept/troubleshooting routes only after executable
   behavior exists. Do not edit release or version metadata.
6. Run Review Readiness Check over the implementation diff before commit.

## Test and Review Evidence

Planned tests:

- `test/harness-checkpoint-digest-vectors.test.mjs`: regenerate every normative
  workspace/state/envelope vector from the literal domain inputs above and
  compare the published hex values.
- `test/harness-checkpoint.test.mjs`: exact shape, versioning, canonical golden
  vectors and artifact ordering, digest tamper, containment/symlink and Windows
  paths, fixed catalog records/torn tails/cursors/scan budgets, atomic envelope
  plus catalog publication, stale artifacts, privacy, and substrate isolation.
- `test/harness-checkpoint-adapter.test.mjs`: exact intake/media/contract
  mapping, full/compact findings dispatch, anchor derivation, absent/empty/
  invalid learning ledgers, two-member topology target isolation, repo-root run
  for a member target, project-name independence, native owners, and one
  physical read per artifact.
- `test/harness-checkpoint-cli.test.mjs`: human/JSON actions, exit mapping,
  zero-side-effect help, OS/env state-home resolution, unchanged Git status,
  custom contained run, catalog cursor/scan flags, and file-mode validate.
- `test/learning-capture-state.test.mjs`: explicit success, option conflict,
  topology-root/target/digest/anchor/ledger failures, checkpoint platform
  plumbing, and literal `.qoder/better-harness` no-option fallback.
- `test/session-selection-plan.test.mjs`: public I/O-free profile/snapshot/pair
  validators, existing reader delegation, frozen identity, and absence of
  live-drift/resume claims.
- `test/harness-component-snapshot.test.mjs`: unchanged digest/diff/resolve and
  `mutationAuthorized: false`.
- `test/better-harness-cli.test.mjs` and
  `test/scripts-refactor-contract.test.mjs`: registry, audience, discovery,
  argv dispatch, help fixtures, and one-way import boundaries.

Planned commands:

```text
node --test test/harness-checkpoint-digest-vectors.test.mjs test/harness-checkpoint.test.mjs test/harness-checkpoint-adapter.test.mjs test/harness-checkpoint-cli.test.mjs
node --test test/learning-capture-state.test.mjs test/session-selection-plan.test.mjs
node --test test/harness-component-snapshot.test.mjs test/better-harness-cli.test.mjs
node --test test/doc-link-graph.test.mjs
node scripts/doc-link-graph/cli.mjs skills/better-harness
npm test
npm run pack:verify
git diff --check
```

The routing-graph command is expected to leave the skill-seeded graph unchanged
because this spec is not routed from `skills/better-harness`; implementation
must verify that expectation. Before acceptance, the independent spec review on
`complexity`, `convenience`, and `evolution` must have no P1/P2 findings. This
Draft does not authorize implementation.
