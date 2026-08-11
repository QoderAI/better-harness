# Emit a Task-Scoped Experience Trace

## Traceability

- Spec ID: `lc03-experience-trace-v1`
- Roadmap: `LC-03`
- Related external evidence: [GitHub Issue #70](https://github.com/QoderAI/better-harness/issues/70)
- AI involvement: Codex (GPT 5.6 Sol) with Terra max subagent review
- Status: Implemented

## Intent

Add the first executable LC-03 slice: a read-only command that projects one
explicit Task Episode from an already validated Qoder `report.source.json` into
a reader-safe, versioned JSONL Experience Trace.

The caller supplies opaque task, workspace, and run keys. Better Harness
projects those keys to domain-separated pseudonymous references, binds the
references to an exact allowlisted source projection, and never
guesses a task from the newest report, session, file modification time, or a
temporal-nearness heuristic. A caller with no applicable native session
evidence can explicitly emit a bound `unavailable` trace instead of allowing an
unrelated local session to look like evidence for the run.

This slice is an observation artifact for external consumers. It does not make
a gate decision, implement a runtime, persist a checkpoint, or complete every
capability in the full LC-03 roadmap row.

## Design Inputs and Evidence

- Issue #70 is related external evidence for the same consumption pain: it asks
  for parser-safe output that is bound to one task, workspace,
  and run, and that distinguishes complete, partial, and unavailable evidence.
  It explicitly keeps deterministic validation and delivery policy outside
  Better Harness. It also says that a new public schema is not requested in its
  first phase. This LC-03 proposal is therefore independently justified by the
  roadmap, does not claim to implement or close #70, and requires normal
  maintainer review as a new public contract.
- `scripts/session-analysis/episode-contract.mjs` owns Task Episode grouping,
  validation relations, repair candidates, and permission-boundary facts. Its
  public Episode object still contains session ids, timestamps, paths, and raw
  evidence locators, so it is not a reader-safe trace contract.
- `scripts/harness-analysis/task-loop-source.mjs` already projects Episode paths
  to bounded target keys and removes session ids from its Task Episode rows.
  The whole report source is still not safe to serialize: unrelated nested
  surfaces may retain private debug/session locators, and the report-source
  validator does not make every nested Episode field a closed schema.
- `scripts/harness-component-snapshot/` owns the LC-02 snapshot and can validate
  a snapshot in isolation. A report source has no comparable workspace or
  topology identity, so V1 cannot prove that an arbitrary snapshot and source
  belong to the same workspace.
- `docs/specs/2026-08-10-harness-run-checkpoints.md` is a Draft with a closed V1
  artifact and anchor set. Experience Trace must not silently become a new
  checkpoint artifact or resume capability.
- The implemented LC-05 specs defer native `repeated-rediscovery` until a
  privacy-safe work/read trace exists. This PR establishes a trace boundary but
  does not change LC-05 mining.

## Decision

Create a new atomic capability under `scripts/experience-trace/`. It consumes a
validated report source through the report-source public index, constructs a
strict allowlist projection, emits a complete JSONL stream on stdout, and can
validate a previously captured stream.

The root route has maintainer discovery audience and remains a thin dispatcher;
audience filters help/inventory visibility and is not runtime authorization:

```text
better-harness harness experience-trace create \
  --source <report.source.json> \
  --task-key <opaque> \
  --workspace-key <opaque> \
  --run-key <opaque> \
  (--episode-ref episode:<opaque> | --no-session-evidence) \
  --jsonl

better-harness harness experience-trace validate --trace <trace.jsonl>
```

`create` requires the explicit `--jsonl` stream selector and emits only JSONL
on stdout. It writes no file; callers may capture stdout using their own
process API. `validate` emits one JSON document on
stdout. Both commands complete all validation before emitting success output.

Both V1 modes require an exact Qoder report source at schema version 3 with a
session observation manifest at schema version 2. Episode mode selects one
Qoder Episode. `--no-session-evidence` is explicit rather than inferred: it
uses the same Qoder source contract but deliberately ignores unrelated retained
Episodes and produces a completely framed stream whose evidence status is
`unavailable`. It is mutually exclusive with `--episode-ref`. Supporting an
external/API-specific source producer requires a later spec.

## Identity and Binding

`taskKey`, `workspaceKey`, and `runKey` are caller-owned correlation keys, not
raw task text, paths, repository URLs, session ids, or credentials. Each input
must match `^[A-Za-z0-9][A-Za-z0-9._-]{15,95}$`; the alphabet therefore cannot
contain a path separator, URL scheme, email address, home shortcut, assignment,
or whitespace. Callers should still use randomly generated or
already-pseudonymous identifiers because a stable hash of a guessable business
label remains guessable by dictionary attack.

Raw keys are never emitted or included in stable errors. The public references
have these exact forms:

```text
task:sha256:<64 lowercase hexadecimal characters>
workspace:sha256:<64 lowercase hexadecimal characters>
run:sha256:<64 lowercase hexadecimal characters>
```

Each reference hashes UTF-8 NFC input with a domain-separated prefix:

```text
sha256("better-harness:experience-trace:binding:v1\0" + kind + "\0" + key)
```

In every digest formula in this spec, `\0` means one NUL byte (`0x00`), never
the two ASCII bytes backslash and zero. `kind` is exactly `task`, `workspace`,
or `run`. Stable hashing is a
pseudonym, not encryption or proof that a key described the correct business
object. Header binding rows therefore declare `provenance: caller-asserted`;
V1 never labels them source-verified. Consumers compare bindings by applying
the same function to their own keys.

The normative binding vector is:

| Kind | Raw test key | Required lowercase digest |
| --- | --- | --- |
| task | `task-key-00000001` | `fce82f8f9ff62cd9af044e2e21bfd2a1822d4cc506bf174a285b8fd03fb011e9` |
| workspace | `workspace-key-00000001` | `50c688560321b967e32f410e861cf64cc7af45c817bddbe466aa1f703a29850e` |
| run | `run-key-00000001` | `7522f027d7bb67cbdbb3818345249dc1f4429fe8e484f44c6330083f1292e1d0` |

For the task row, the complete SHA-256 preimage bytes in hexadecimal are
`6265747465722d6861726e6573733a657870657269656e63652d74726163653a62696e64696e673a7631007461736b007461736b2d6b65792d3030303030303031`.
The two `00` byte pairs are the required NUL separators.

The source Episode id remains a source-scoped opaque `episodeRef`. It is not a
global task id: the current Episode owner may derive it from a session id plus
ordinal or from an explicit task key. Trace identity therefore binds:

```text
schema version
+ producer platform
+ pseudonymous taskRef
+ pseudonymous workspaceRef
+ pseudonymous runRef
+ sourceProjectionDigest
+ selected episodeRef or explicit no-session marker
```

`traceId` is a SHA-256 identifier over those canonical fields. Equal raw
session/task ids in another provider, workspace, or run cannot collide unless
all caller assertions and the projected evidence are also equal. This is
namespace separation, not verification that the caller selected the right
Episode for its business task.

`sourceProjectionDigest` covers only the allowlisted reader-safe facts that
the trace uses. It does not hash the complete report source, because private
or unrelated source fields must not influence a public pseudonym.

## Source Projection

After bounded JSON parsing and an iterative structural preflight, the projector
checks the following safe top-level source markers, then runs
`validateHarnessReportSource()` as an integrity prerequisite. That validator is
not proof that the whole object is publishable. V1 requires every marker
exactly before the broader validator:

| Source field | Required value |
| --- | --- |
| `schemaVersion` | `3` exactly, not merely `>= 3` |
| `kind` | `harness-report-source` |
| `manifest.schemaVersion` | `2` exactly |
| `manifest.kind` | `session-observation-manifest` |
| `manifest.scope.platform` | `qoder` |
| `manifest.scope.workspaceScope` | `workspace` |

Marker failure classification is exact:

| Marker failure | Code |
| --- | --- |
| malformed JSON; root/manifest/scope is missing, array, null, or not an object | `INVALID_REPORT_SOURCE` |
| source or manifest `schemaVersion` is missing or not an integer | `INVALID_REPORT_SOURCE` |
| source or manifest `kind` is missing, non-string, or not its required value | `INVALID_REPORT_SOURCE` |
| an integer source or manifest schema version differs from the required value | `UNSUPPORTED_TRACE_SOURCE_VERSION` |
| platform or workspace scope is missing or non-string | `INVALID_REPORT_SOURCE` |
| a string platform or workspace scope differs from the required value | `UNSUPPORTED_TRACE_PLATFORM` |

Rows are evaluated top to bottom and the first matching row is the only emitted
failure. Thus malformed structure outranks every later marker, invalid kind
outranks unsupported integer version, and unsupported integer version outranks
unsupported platform/scope. Combined failures never produce multiple codes.

The preflight walks iteratively, without invoking recursive product validators,
and permits at most depth 64 and 100,000 total JSON values. Root depth is zero
and each property/element edge adds one. The root counts as one value; every
object-property value and array element adds one; property-name keys
do not count. Containers therefore count as the value by which they were
reached, not once again for their children. Exceeding either structural
budget is `INVALID_REPORT_SOURCE`. Only after this check may the existing broad
validator run; any thrown exception is caught and normalized to the same stable
code without its message or stack.

Supporting a later report/manifest schema is a contract change, not an
automatic forward-compatibility promise. Both Episode and no-session mode use
this same compatibility rule. An API-only producer is deferred; the V1
no-session mode models its evidence absence using a validated Qoder source and
does not pretend an API transcript was inspected.

After compatibility checks, the projector constructs this exact internal
object from scratch. It never spreads a source object:

```text
projection = {
  schemaVersion: 1,
  producer: {
    platform: "qoder",
    reportSourceSchemaVersion: 3,
    manifestSchemaVersion: 2
  },
  selection: {
    sourceFingerprint,
    strategy,
    eligibleCount,
    analyzedCount,
    sampled,
    representative,
    confidence,
    warningCodes
  },
  episode: null | {
    episodeRef,
    sessionCount,
    continuation,
    startBoundary,
    toolCallCount,
    changeSets: [{ eventCount, firstOrdinal, lastOrdinal, targetKeys }],
    validationSets: [{ category, status, sourceOrdinal,
                       checkIdentity, targetKeys }],
    permissionBoundary: null | {
      prompted, denied, escalated, protectedActions
    },
    closureStatus,
    repairStatus
  },
  absenceReason: null | "caller-declared-no-session-evidence"
}
```

Every projected value has one source owner. A missing required object, array,
or scalar; a wrong type; or a value outside the rule table below fails with
`INVALID_REPORT_SOURCE`, even when the broader report-source validator accepted
it. Nullable rows are absent only under the stated condition.

| Projection path | Exact report-source path or construction |
| --- | --- |
| `producer.*` | constants from the six compatibility markers above |
| `selection.sourceFingerprint` | `manifest.sources.fingerprint` |
| `selection.strategy` through `selection.confidence` | same-named fields under `manifest.selection` |
| `selection.warningCodes` | `manifest.warningCodes`, validated before canonical set normalization |
| `episode` | the unique `taskEpisodes[]` row whose `id` exactly equals `--episode-ref`; `null` only in no-session mode |
| `episode.episodeRef` | selected row `id` |
| `sessionCount`, `continuation`, `startBoundary`, `toolCallCount` | selected row `sessionCount`, `continuation`, `startBoundary`, and `toolCalls` |
| `changeSets[]` | selected row `changeSets[]` in source-array order |
| each change-set scalar | same-named `eventCount`, `firstOrdinal`, and `lastOrdinal` source field |
| each change-set `targetKeys` | its source row `targetKeys`, validated before canonical set normalization |
| `validationSets[]` | selected row `validationSets[]`, sorted by numeric `ordinal`; duplicate ordinals fail |
| each validation scalar | source `category`, `status`, `ordinal -> sourceOrdinal`, `checkIdentity`, and `targetKeys` |
| `permissionBoundary` | selected row `permissionSummary`, omitting only `evidenceRefs`; `null` only when that object is absent |
| `closureStatus` / `repairStatus` | selected row `closure.status` / `repair.status` |
| `absenceReason` | `null` in Episode mode; constant `caller-declared-no-session-evidence` in no-session mode |

No fallback default is applied. In particular, missing `toolCalls`, status,
count, or array fields are invalid rather than silently becoming zero, an empty
array, or `unobserved`.

The exact value rules are:

| Field | V1 rule |
| --- | --- |
| `sourceFingerprint` | exactly 16 lowercase hexadecimal characters |
| `strategy` | `stratified`, `all-eligible`, or `latest-n` |
| selection counts | `analyzedCount <= eligibleCount` in addition to the shared integer bound |
| selection booleans | JSON booleans; `sampled === (analyzedCount < eligibleCount)` and `representative === (!sampled && strategy !== "latest-n")` |
| `confidence` | `Low` when either count is zero or strategy is `latest-n`; otherwise `Medium` when sampled and `High` when not sampled |
| `warningCodes` | source array at most 32; every item is one of `missing-required-root`, `missing-optional-root`, `disabled-source-root`, `partial-secret-scan-coverage`, or `invalid-prior-learning-capture-report`; output is code-unit-sorted unique |
| every count/ordinal | safe non-negative integer at most 1,000,000 |
| `episodeRef` | `^episode:[a-f0-9]{12,64}$` and exact match to one retained source Episode |
| `sessionCount` | integer 1-1,000,000; a value over one requires `continuation: explicit` |
| `continuation` | `explicit` or `session-bounded` |
| `startBoundary` | `session-start`, `explicit-task-key`, `explicit-boundary`, `idle-gap`, `progress-handoff`, or `first-retained-boundary` |
| `changeSets` | source order, at most 16 rows; `firstOrdinal <= lastOrdinal`; each raw target-key array has at most 12 items and output is code-unit-sorted unique |
| `targetKeys` | exactly 20 lowercase hexadecimal characters |
| `validationSets` | raw source array at most 32 rows with unique source ordinals; output is numeric-ordinal-sorted; each raw target-key array has at most 12 items and output is code-unit-sorted unique |
| validation `category` | `npm test`, `pnpm test`, `yarn test`, `node --test`, `vitest`, `jest`, `pytest`, `go test`, `cargo test`, `agent-lint`, `typecheck`, `lint`, or `git diff --check` |
| validation `status` | `passed`, `failed`, or `observed` |
| `checkIdentity` | `^check:[a-f0-9]{24}$` |
| permission counts | each 0-1,000,000; prompted/denied/escalated do not exceed protected actions; the object is present only when protected actions is positive |
| `closureStatus` | `not-applicable`, `unobserved`, `closed`, or `observed-without-pass` |
| `repairStatus` | `not-applicable`, `unobserved`, `review-required`, or `repaired-and-passed` |

An allowlisted scalar or bounded row that violates those rules fails closed
rather than being cleaned, truncated, or replaced. Duplicate or unsorted input
is explicitly accepted for the set-like `warningCodes` and `targetKeys` arrays:
first validate the raw array length and every member, then deduplicate, then
sort with the code-unit comparator. Unsorted `validationSets` are also accepted
after every row and the raw bound validate; duplicate numeric ordinals fail,
and unique rows sort numerically by ordinal. No other array is reordered or
deduplicated. Source
evidence ids, adapter labels,
timestamps, elapsed duration, task routes, lifecycle/learning signals, and
session/invocation identities are not part of the projection.

When an Episode exists, `--episode-ref` is always required, even if the source
contains only one Episode. An absent or unknown Episode ref fails closed.
`--no-session-evidence` sets `episode: null` and the exact absence reason above;
it never falls through to an unrelated retained Episode.

## JSONL Contract

Every line is one exact-schema object. Unknown or missing fields fail. The
common fields are `kind`, `schemaVersion: 1`, zero-based `recordOrdinal`, and
one `traceId`. Ordinals increase by exactly one. There is exactly one header,
one or more events, and one terminal; no content may follow the terminal.

### Canonical bytes and hashes

Canonical JSON recursively sorts object keys by ascending UTF-16 code-unit
order, preserves array order, normalizes every string to Unicode NFC, permits
only JSON booleans/null, strings, and safe integers, and serializes with compact
`JSON.stringify` semantics. Each record is that UTF-8 JSON with no BOM followed
by one LF byte (`0x0a`), including the terminal. CRLF, insignificant whitespace,
non-canonical key order, duplicate JSON keys, unsafe integers, floats, negative
zero, lone surrogates, or a missing final LF are invalid.

The exact domain-separated digests are:

```text
sourceProjectionDigest = "sha256:" + hex(sha256(utf8(
  "better-harness:experience-trace:source-projection:v1\0"
  + canonicalJson(projection))))

traceId = "trace:sha256:" + hex(sha256(utf8(
  "better-harness:experience-trace:identity:v1\0"
  + canonicalJson({
      schemaVersion: 1,
      producerPlatform: "qoder",
      taskRef, workspaceRef, runRef,
      sourceProjectionDigest,
      episodeRef: selectedEpisodeRefOrNull,
      absenceReason: explicitAbsenceReasonOrNull
    }))))

traceDigest = "sha256:" + hex(sha256(utf8(
  "better-harness:experience-trace:stream:v1\0"
  + canonicalHeaderLineWithLF
  + everyCanonicalEventLineWithLF)))
```

The terminal is not included in `traceDigest`. A validator reconstructs the
safe projection from the header/events, recomputes all three digests, and
requires exact equality. This detects accidental or non-recomputed mutation;
it is not a signature and cannot authenticate a malicious producer that
recomputes the whole stream.

The normative no-session golden vector uses the three binding keys from the
Identity and Binding table, source fingerprint `0123456789abcdef`, selection
`all-eligible`, zero eligible/analyzed, `sampled: false`,
`representative: true`, `confidence: Low`, no warnings, and the fixed ten gap
events in coverage order. It must produce:

| Value | Required result |
| --- | --- |
| `sourceProjectionDigest` | `sha256:f46c5aaea639376da6fca7bfa9df215ee2a22bdad509761912a705d57d8eb9c9` |
| `traceId` | `trace:sha256:a924fb792337d1a641f2cc152a67764387d6ae0b0d04fa6ff0752469ab8d095f` |
| `traceDigest` | `sha256:e568040d4ce087a63abb593e760ea4b94b140a8da6421dad7b69ab583426956e` |
| counts | `eventCount: 10`, `recordCount: 12`, terminal ordinal `11` |

The complete byte stream is checked in beside this spec as the
[normative no-session fixture](fixtures/lc03-no-session-v1.jsonl).
Implementation tests must consume that exact file and add a second Episode
fixture. Changing a byte-affecting rule requires a schema revision or an
explicitly reviewed compatibility decision, not silently updating the vectors.

### Header record

The header has exactly this shape:

```text
{
  kind: "better-harness.experience-trace.header",
  schemaVersion: 1,
  recordOrdinal: 0,
  traceId,
  binding: {
    task: { ref: taskRef, provenance: "caller-asserted" },
    workspace: { ref: workspaceRef, provenance: "caller-asserted" },
    run: { ref: runRef, provenance: "caller-asserted" },
    episode: {
      ref: episodeRefOrNull,
      provenance: "source-projected" | "unavailable",
      reasonCode: "explicit-episode-selection"
                  | "caller-declared-no-session-evidence"
    }
  },
  source: {
    projectionDigest: sourceProjectionDigest,
    reportSourceSchemaVersion: 3,
    manifestSchemaVersion: 2
  },
  producer: {
    kind: "qoder-report-source-projection",
    platform: "qoder"
  },
  selection: {
    sourceFingerprint, strategy, eligibleCount, analyzedCount,
    sampled, representative, confidence, warningCodes
  }
}
```

`episode.ref` is a string with `source-projected` provenance in Episode mode;
it is `null` with `unavailable` provenance in no-session mode. No field implies
that caller bindings were checked against the report workspace.

### Event records

Every middle record has exactly:

```text
{
  kind: "better-harness.experience-trace.event",
  schemaVersion: 1,
  recordOrdinal,
  traceId,
  eventType,
  availability,
  evidenceRef,
  payload
}
```

The event-specific contract is:

| Event type | Availability / evidence ref | Exact payload |
| --- | --- | --- |
| `task-episode` | `observed` / `source:episode` | `{ episodeRef, sessionCount, continuation, startBoundary }` |
| `tool-observation` | `derived` / `source:tool-summary` | `{ toolCallCount, changeSets: [{ changeRef, eventCount, firstOrdinal, lastOrdinal, targetKeys }] }`; `changeRef` is `source:change:<1-based-index>` |
| `validation-observation` | `observed` / `source:validation:<1-based-position-after-sourceOrdinal-sort>` | `{ validationRef, category, status, sourceOrdinal, checkIdentity, targetKeys }`; `validationRef` equals the evidence ref and is based on normalized output position, never original array position |
| `permission-boundary` | `derived` / `source:permission-boundary` | `{ prompted, denied, escalated, protectedActions }` |
| `episode-observation-ended` | `derived` / `source:episode-end` | `{ closureStatus, repairStatus }` |
| `capability-gap` | `unavailable` / `source:gap:<capability>` | `{ capability, reasonCode }` |

Episode event order is task Episode, tool observation, validation observations
by ascending `sourceOrdinal` (ties are invalid), optional permission boundary,
Episode end, and capability gaps in terminal coverage order. No-session order is
only capability gaps in terminal coverage order. Each unavailable coverage row
has exactly one matching gap event; no non-unavailable row has one.

### Terminal record

The terminal has exactly:

```text
{
  kind: "better-harness.experience-trace.terminal",
  schemaVersion: 1,
  recordOrdinal,
  traceId,
  streamStatus: "complete",
  evidenceStatus: "partial" | "unavailable",
  coverage,
  eventCount,
  recordCount,
  policyUse: "advisory-only",
  traceDigest
}
```

`eventCount` counts middle records only; `recordCount === eventCount + 2`; the
terminal ordinal is `recordCount - 1`. `streamStatus` says only that framing is
complete. `evidenceStatus` is `unavailable` when task-Episode coverage is
unavailable and `partial` otherwise. V1 can never emit evidence status
`complete` because bindings remain caller-asserted and six required runtime
capabilities remain unavailable; a future complete producer requires a schema
revision. Neither status is a pass, approval, gate, or delivery decision.

## Capability Coverage

The terminal always contains these rows in this order:

1. `task-binding`
2. `workspace-binding`
3. `run-binding`
4. `task-episode`
5. `tool-observation`
6. `validation-observation`
7. `permission-boundary`
8. `human-approval`
9. `subagent-lineage`
10. `worktree-lineage`
11. `interruption-resume`
12. `runtime-stop`
13. `component-snapshot`

Each exact row is `{ capability, availability, provenance, reasonCode }`.
`availability` is `observed | derived | unavailable`; `provenance` is
`caller-asserted | source-projected | unavailable`. The deterministic matrix
is:

| Capabilities | Episode mode | No-session mode |
| --- | --- | --- |
| task/workspace/run binding | `derived`, `caller-asserted`, `explicit-caller-binding` | same |
| task Episode | `observed`, `source-projected`, `explicit-episode-selection` | `unavailable`, `unavailable`, `caller-declared-no-session-evidence` |
| tool observation | `derived`, `source-projected`, `source-aggregate` | `unavailable`, `unavailable`, `caller-declared-no-session-evidence` |
| validation observation | `observed`, `source-projected`, `source-observation` when rows exist; otherwise `unavailable`, `unavailable`, `not-retained-by-source` | `unavailable`, `unavailable`, `caller-declared-no-session-evidence` |
| permission boundary | `derived`, `source-projected`, `source-permission-summary` when present; otherwise `unavailable`, `unavailable`, `not-retained-by-source` | `unavailable`, `unavailable`, `caller-declared-no-session-evidence` |
| six fixed gaps below | `unavailable`, `unavailable`, capability-specific reason | same |

The six fixed gap reasons are `human-approval-not-observed`,
`subagent-parent-edge-not-observed`, `worktree-lineage-not-observed`,
`interruption-resume-not-observed`, `runtime-stop-not-observed`, and
`component-snapshot-not-bound`. Those reason codes map one-to-one, in order, to
human approval, subagent lineage, worktree lineage, interruption/resume,
runtime stop, and component snapshot. The complete closed reason-code set is
those six plus `explicit-caller-binding`, `explicit-episode-selection`,
`source-aggregate`, `source-observation`, `source-permission-summary`,
`caller-declared-no-session-evidence`, and `not-retained-by-source`.

V1 always reports these gaps rather than substituting proxies:

- permission allowed/denied is not human approval;
- `isSubagent` without a parent edge is not lineage;
- an idle gap is not interruption/resume;
- Episode validation closure is not runtime stop;
- an unbound LC-02 snapshot is not component state for this run.

## Privacy, Bounds, and Error Contract

No record or stable error may contain raw prompts, commands, transcript text,
session ids, invocation ids, timestamps, credentials, repository URLs,
absolute Windows/POSIX/UNC paths, home paths, or raw evidence locators.

Create reads at most 16 MiB of source JSON and applies the depth-64/100,000-value
iterative preflight before any recursive product validator. Both commands use one shared trace
bound: at most 1 MiB total serialized JSONL, 256 records, 65,536 UTF-8 bytes per
line, and 64 events. Projection arrays use the smaller limits above. Create
serializes into a bounded buffer, runs the same byte-level validator used by
`validate`, and only then writes stdout. Therefore every successful create
stream must be accepted byte-for-byte by validate. Bounds are checked before
success stdout is written.

After each trace line parses as JSON but before canonicalization or recursive
schema validation, validate applies the same iterative structural algorithm:
root depth zero, maximum depth 64, and at most 100,000 total JSON values summed
across all records in the stream. Structural overflow or any caught parser,
canonicalizer, or schema traversal exception maps to
`INVALID_EXPERIENCE_TRACE`; it never exposes an exception message or stack.

Help writes usage text to stdout, nothing to stderr, exits 0, and performs no
source, trace, workspace, home, Git, or network read. Successful create writes
only the complete canonical JSONL stream to stdout and nothing to stderr.
Successful validate writes this one canonical JSON document plus LF to stdout
and nothing to stderr:

```text
{
  kind: "better-harness.experience-trace.validation",
  schemaVersion: 1,
  valid: true,
  traceId,
  streamStatus,
  evidenceStatus,
  recordCount,
  eventCount,
  traceDigest
}
```

`validate --trace` checks the bytes, closed schemas, deterministic projection
reconstruction, identity, counts, ordering, and digests. It does not read the
original report source and therefore does not authenticate the source or the
caller assertions.

Only the exact argv forms `--help`, `-h`, `create --help`, `create -h`,
`validate --help`, and `validate -h` are help. They take priority over runtime
work and perform zero reads. Any help token combined with another token is not
help and follows strict argument validation.

On every usage, read, source, bounds, or validation failure the leaf buffers and
discards all candidate output, writes nothing to stdout, and writes exactly one
ASCII line `<CODE>: <stable message>\n` to stderr. It never exposes a path,
argument value, validator detail, stack, or nested `errors`. The exact V1
mapping and precedence are:

| Condition | Code | Exit | Stable message |
| --- | --- | --- | --- |
| unknown phase/flag/positional; missing or duplicate option value; missing `--jsonl` on create; help plus any extra token; both Episode modes | `INVALID_USAGE` | 64 | `invalid experience-trace arguments` |
| create has neither Episode mode after otherwise valid parsing | `MISSING_EPISODE_SELECTION` | 64 | `select exactly one episode mode` |
| a task/workspace/run key fails its exact syntax | `INVALID_TRACE_BINDING` | 1 | `trace binding key is invalid` |
| source file I/O fails | `SOURCE_READ_FAILED` | 1 | `unable to read report source` |
| source exceeds 16 MiB or the constructed trace exceeds a shared trace bound | `TRACE_BOUNDS_EXCEEDED` | 1 | `experience trace bounds exceeded` |
| source JSON parse, broad validation, or allowlist projection fails | `INVALID_REPORT_SOURCE` | 1 | `report source is invalid` |
| source/manifest version marker is unsupported | `UNSUPPORTED_TRACE_SOURCE_VERSION` | 1 | `report source version is unsupported` |
| source platform or workspace scope is unsupported | `UNSUPPORTED_TRACE_PLATFORM` | 1 | `report source platform is unsupported` |
| `--episode-ref` is malformed, absent, or non-unique in the retained Episode rows | `UNKNOWN_EPISODE_REF` | 1 | `selected episode is unavailable` |
| trace file I/O fails | `TRACE_READ_FAILED` | 1 | `unable to read experience trace` |
| trace exceeds a shared trace bound | `TRACE_BOUNDS_EXCEEDED` | 1 | `experience trace bounds exceeded` |
| trace bytes, parse, schema, reconstruction, ordering, counts, or digests fail | `INVALID_EXPERIENCE_TRACE` | 1 | `experience trace is invalid` |

Argument shape is checked first, then binding syntax, source/trace I/O and byte
bounds, source version/platform markers, broad source validation/projection, or
trace validation as applicable. Thus a future source version reports the
version code even if that version would fail the current broad validator. File
read failures never echo the private filename. Parse/source failures never echo
parser or validator messages. Root dispatch treats Experience Trace as an
owner-validated-help command and preserves the leaf argv, stdout, stderr, and
exit code, including invalid trailing-help cases.

The capability-owned command declaration is `experience-trace.v1`, audience
`maintainer`, with phases `create` and `validate`. It is `read-only`: create
reads only the explicitly named source file; validate reads only the explicitly
named trace file; neither reads the current workspace, Git, host home, user
state, environment-derived evidence roots, or network. Neither phase writes or
persists an artifact, and Better Harness retains nothing. Raw caller keys exist
only in argv/process memory for reference derivation.

## Ownership and Planned Files

- `scripts/experience-trace/contract.mjs` owns exact records, canonical JSON,
  identity/digests, bounds, parsing, validation, and JSONL serialization.
- `scripts/experience-trace/project-source.mjs` owns the strict report-source
  allowlist projection and deterministic record construction.
- `scripts/experience-trace/index.mjs` is the only cross-capability behavioral
  import surface.
- `scripts/experience-trace/cli.mjs` owns create/validate parsing, stable errors,
  and stdout behavior.
- `scripts/experience-trace/command-manifest.mjs` owns pure route metadata,
  audience, options, effects, examples, and diagnostics used by leaf help and
  indexed by the root registry without loading runtime behavior.
- `scripts/better-harness-cli/registry.mjs` indexes that metadata.
- `scripts/better-harness-cli/cli.mjs` forwards Experience Trace help argv so
  the leaf, not the facade, owns strict help validation.
- `docs/ARCHITECTURE.md` records the one-way dependency: Experience Trace may
  consume report-source public validation, but report/session/LC-05/Checkpoint
  owners do not import Experience Trace.
- Tests own golden records, adversarial privacy fixtures, root dispatch, help
  side-effect checks, and package verification expectations.

The implementation must not modify `task-loop-source.mjs`, session provider
adapters, LC-05 candidate/review owners, LC-02 snapshot owners, or the
Checkpoint Draft. This minimizes collision with open PR #72 and preserves the
existing report chain.

## Acceptance Scenarios

- **ET-AC-1 (framed deterministic JSONL):** Given one validated Qoder report
  source, explicit bindings, and an exact Episode ref, repeated create calls
  emit byte-identical JSONL with one header, canonical event order, and one
  terminal whose counts and digest validate.
- **ET-AC-2 (explicit task/run/workspace binding):** The trace id and header bind
  safe `taskRef`, `workspaceRef`, `runRef`, producer platform, safe source
  projection, and Episode ref. Reusing a source Episode id with different caller
  workspace/run keys produces a different trace id; deliberately reusing all
  caller keys remains a caller assertion, not a verified source binding. No
  newest/mtime/temporal fallback exists.
- **ET-AC-3 (explicit Episode or absence):** Episode mode requires an exact
  source Episode ref. `--no-session-evidence` is mutually exclusive and emits a
  completely framed `unavailable` trace even if unrelated source Episodes
  exist. Missing or invented selection fails before stdout.
- **ET-AC-4 (fact and capability honesty):** Tool, validation, permission, and
  Episode-end rows preserve only allowlisted observed/derived facts. Human
  approval, subagent/worktree lineage, interruption/resume, runtime stop, and
  component snapshot remain explicit gaps with closed reasons.
- **ET-AC-5 (strict privacy projection):** Private sentinels injected into raw
  prompt/command/transcript/session/invocation ids, unknown Episode fields,
  evidence paths, absolute Windows/POSIX/UNC/home paths, URLs, emails, and
  secret-like values never appear in trace stdout or stable errors. Unknown
  fields cannot enter the projection by object spread.
- **ET-AC-6 (coverage semantics):** Stream validity and evidence availability
  are independent. A terminal-complete empty stream is `unavailable`; the
  initial Qoder Episode producer is `partial`; neither produces a pass or gate
  decision.
- **ET-AC-7 (fail-closed validation):** Unsupported platform, invalid source,
  unsafe binding, oversize input, unknown record/type/field/enum, reordered or
  duplicate ordinal, missing/extra terminal content, stale counts, and digest
  tampering fail with stable no-path errors.
- **ET-AC-8 (read-only public route):** Root CLI help is zero-read; create and
  validate write no workspace, host-home, user-state, or Checkpoint data;
  machine stdout is parser-safe and root dispatch preserves it byte-for-byte.
- **ET-AC-9 (compatibility and ownership):** Existing report-source, Task
  Episode, LC-02, LC-05, and long-session trace behavior remains unchanged.
  Cross-capability imports use public indexes and the packaged artifact contains
  the complete Experience Trace owner.
- **ET-AC-10 (external consumer boundary):** A fixture representing an API
  Maker task with no applicable native Qoder Episode uses the explicit
  no-session mode against a valid Qoder source and yields unavailable coverage
  while retaining caller-asserted task/workspace/run bindings. It is not an API
  transcript producer. Output exposes the facts needed for an external consumer
  to choose advisory or human-review handling, but Better Harness does not
  define or execute its delivery gate. This PR is related evidence for Issue
  #70 and does not claim to close its findings or delivery-policy request.

## Non-goals

- Do not complete the full cross-host LC-03 roadmap row or mark it done.
- Do not add a host adapter or change Qoder/session discovery and selection.
- Do not emit raw per-tool transcripts, arguments, results, prompts, commands,
  content, paths, timestamps, session ids, or native stop text.
- Do not infer or record real human approval, subagent/worktree lineage,
  interruption/resume, runtime stop, or side-effect state.
- Do not add OTLP export.
- Do not create, validate, store, list, or resume a Harness Checkpoint, and do
  not add Experience Trace to the Checkpoint Draft's closed artifact set.
- Do not create, bind, diff, resolve, or authorize an LC-02 component snapshot.
- Do not add LC-05 `repeated-rediscovery` or alter candidate/review contracts.
- Do not add a scheduler, durable runtime, gate, apply, retry, budget, recovery,
  or release decision.
- Do not change report-source or findings schemas in this slice.

## Plan and Tasks

1. Implement the strict trace contract, canonical identity/digest, parser,
   serializer, bounds, and golden vectors (ET-AC-1, ET-AC-2, ET-AC-6, ET-AC-7).
2. Implement the allowlist report-source projector and explicit
   Episode/no-session modes (ET-AC-3, ET-AC-4, ET-AC-5, ET-AC-10).
3. Add the create/validate CLI, stable errors, and maintainer root registry leaf
   with zero-read help behavior (ET-AC-7, ET-AC-8).
4. Add architecture ownership and package/dispatch contract updates without
   touching adjacent capability owners (ET-AC-9).
5. Run focused, cross-module, documentation, package, and full regression
   checks, then perform Review Readiness and an independent adversarial review.

## Test and Review Evidence

The implementation was verified locally with the following evidence; no CI
status is claimed:

| Lane | Command | Result |
| --- | --- | --- |
| Focused contract, projection, CLI, root-dispatch, and frozen-output tests | `node --test test/experience-trace-contract.test.mjs test/experience-trace.test.mjs test/experience-trace-cli.test.mjs test/better-harness-cli.test.mjs test/scripts-refactor-contract.test.mjs` | 82 tests, 82 passed, 0 failed |
| Cross-module compatibility | `node --test test/harness-report-source.test.mjs test/task-loop-source.test.mjs test/session-episode-contract.test.mjs` | 46 tests, 46 passed, 0 failed |
| Documentation routing | `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then `node --test test/doc-link-graph.test.mjs` | graph regenerated; 6 tests, 6 passed, 0 failed |
| Package and runtime bundle | `npm run pack:verify` | passed; npm package contained 473 files and the runtime bundle contained 495 entries |
| Full regression | `npm test` | 1,323 tests total; 1,322 passed, 0 failed, 1 skipped |
| Diff hygiene | `git diff --check` | passed |

The final upstream check observed `origin/main` at `81440ba` and this branch
zero commits behind it. Three independent Terra Max reviewers received the
same final adversarial-review prompt; all three reported `verdict=pass` and
`p1_p2_clear=true`.

Earlier adversarial rounds found and closed an Episode header/event reference
mismatch, pre-parse high-line-count denial-of-service exposure, inconsistent
shared-bound error codes, the missing versioned Episode golden fixture,
invalid-UTF-8 versus bound-precedence drift, and an unterminated trailing-line
counting off-by-one. The final replay covered both golden fixtures, digest and
identity tampering, total/line/record/event bounds, high-line-count input,
invalid UTF-8 combinations, missing final LF, nonzero-offset `Uint8Array`
views, and direct/root CLI output channels without finding another P1 or P2.

External API Maker execution and native Qoder runtime proof were not performed.
ET-AC-10 is evidenced by the versioned no-session fixture and its explicit
unavailable-coverage contract, not by an external API transcript or native
runtime observation. GitHub Issue #70 remains related external evidence; this
implementation does not claim to close it.

## Risks

- A caller can bind the wrong Episode intentionally. V1 proves that the caller
  made an explicit, digest-bound selection; it does not claim to know the
  caller's business task semantics. The output labels this as caller binding.
- A valid report source may contain unrelated private nested fields. The
  projector never serializes or hashes the full source and rejects unsafe
  allowlisted values.
- Open PR #38 may overlap root registry/help fixtures, and Draft PR #72 overlaps
  broader session/report owners. Rebase from the latest main before final
  validation and keep implementation inside the new owner.
- A future Checkpoint or LC-06 runtime may reference Experience Trace. That
  requires a separate reviewed contract and must not reinterpret V1
  `unavailable` capability rows as observed history.
