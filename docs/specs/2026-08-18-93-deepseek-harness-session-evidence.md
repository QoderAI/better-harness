# DeepSeek Harness Session Evidence

## Traceability

- Spec ID: deepseek-harness-session-evidence
- Story: #93
- Status: Implemented
- Follow-up status: Implemented (DSH 0.1.1-rc.1 compatibility; known baseline facts privacy defect unresolved)

## Intent

Add a narrowly scoped, read-only DeepSeek Harness (`dsh`) session adapter so
Better Harness can analyze durable DSH JSONL evidence after a run. The first
slice stops at session discovery, workspace qualification, validation, and
normalization into the existing session-analysis contract. It deliberately does
not present DSH as a first-class or natively integrated Better Harness host.

This specification freezes the partial boundary approved by the maintainer in
[Issue #93](https://github.com/QoderAI/better-harness/issues/93), including the
feature-detection policy approved in the 2026-08-18T13:13:05Z comment. The
supported native contract is pinned to upstream commits
`99f6f02fecdb7dff40c3fbc9470f5907c29f74ca` (`dsh-v0.1.0-rc.7`) and
`141eb6fef83422698aef7a981029e843e8161534` (`dsh-v0.1.0-rc.8`), both with
`SESSION_FORMAT_VERSION = 0`. Later upstream behavior is not implicitly
supported. The additive 0.1.1-rc.1 qualification below is an implemented
contract for the pinned optional `permission/preset.origin` extension; it does
not qualify later releases or unrelated 0.1.1 behavior.

## Native Contract Evidence

The implementation and its support claims remain bound to these five primary
upstream sources at the RC7 commit:

1. [Developer-preview status, compatibility warning, and plugin-oriented positioning](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/README.md)
2. [Base profile composition and the DSH-home sessions route](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/bundle/base/cordis.patch.yml)
3. [Session header, format version, event vocabulary, correlation fields, and turn outcomes](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/core/session/src/types.ts)
4. [JSONL layout, default Zstandard encoding, packed rows, identity checks, and discovery constraints](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-persistence-jsonl/README.md)
5. [SQLite's separate persistence and discovery contract](https://github.com/deepseek-ai/deepseek-harness/blob/99f6f02fecdb7dff40c3fbc9470f5907c29f74ca/packages/session/session-persistence-sqlite/README.md)

The RC8 requalification and RC8-only extensions are separately bound to their
corresponding source owners at the RC8 commit:

6. [`assistant/message.interrupted` and the current session event vocabulary](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/core/session/src/types.ts)
7. [Committed JSONL rows and packed-row expansion](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/session/session-persistence-jsonl/src/format.ts)
8. [Concatenated Zstandard frame scanning and torn-frame boundaries](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/session/session-persistence-jsonl/src/zstd.ts)
9. [DSH-home precedence and blank-environment handling](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/util/home-paths/src/index.ts)
10. [`team/member`, `team/task`, `team/message/queued`, and `team/message/delivered` payload contracts](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/experimental/agent-team/src/types.ts)
11. [Strict team payload schemas and replay relationships](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/experimental/agent-team/src/fold.ts)
12. [Team task dependency-graph constraints](https://github.com/deepseek-ai/deepseek-harness/blob/141eb6fef83422698aef7a981029e843e8161534/packages/experimental/agent-team/src/task-graph.ts)

The 0.1.1-rc.1 compatibility follow-up is pinned separately to commit
`528c682e061696f5a160f363f236ecbf53cbd006` and these package-owned sources:

13. [`permission/preset` payload declaration and backward-readable optional `origin`](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/interaction/permission-presets/src/index.ts#L42-L55)
14. [`origin` replay/refresh semantics for default, explicit, inferred, and origin-less selections](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/interaction/permission-presets/src/index.ts#L337-L355)
15. [The package-owned write paths for all three legal `origin` values](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/interaction/permission-presets/src/index.ts#L430-L479)
16. [RC.1 core format, header, event envelope, lifecycle, request, assistant usage, and tool-correlation contracts](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/core/session/src/types.ts#L34-L99)
17. [RC.1 known event vocabulary and unknown-event refusal policy](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/core/session/src/known-event-types.ts#L8-L68)
18. [RC.1 JSONL header, packed-row expansion, and committed-record scanning](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/session/session-persistence-jsonl/src/format.ts#L28-L108)
19. [RC.1 concatenated Zstandard frame reader](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/session/session-persistence-jsonl/src/zstd.ts)
20. [RC.1 persisted subagent descriptor contract](https://github.com/deepseek-ai/deepseek-harness/blob/528c682e061696f5a160f363f236ecbf53cbd006/packages/subagent/subagent/src/descriptor.ts#L28-L88)

Synthetic fixtures may encode only behavior supported by those pinned sources
and the approved Issue #93 boundary. A fixture passing is not evidence that a
newer DSH build remains compatible. Same-version structural drift must fail
closed rather than extending this contract by inference.

## DSH 0.1.1-rc.1 Compatibility Follow-up

### Status and qualification target

This implemented follow-up remains under Story #93 and targets only the official
DSH npm package `0.1.1-rc.1` at tag commit
`528c682e061696f5a160f363f236ecbf53cbd006`. It is temporally additive to the
implemented RC7/RC8 evidence; it does not rewrite that historical
qualification or imply support for later DSH releases.

### Current failure and upstream contract delta

A real headless DSH 0.1.1-rc.1 coding run completed and persisted a structurally
healthy format-0 session, but Better Harness at
`996fd3d3045dfe29935fc7948377416712ab2711` rejected it during public discovery
with `dsh-artifact-rejected` and `DSH_EVENT_SHAPE_DRIFT`. The rejected event was
`permission/preset`, whose package-owned payload changed from the RC8 shape:

```text
{ preset: string }
```

to the 0.1.1-rc.1 declaration:

```text
{ preset: string, origin?: "default" | "selection" | "inferred" }
```

`origin` is optional: its absence keeps logs written before origin tracking
readable. When present it is a string in exactly the closed set `default`,
`selection`, or `inferred`; `null`, other JSON types, and arbitrary strings are
not declared legal. No additional payload keys are declared by the owner, and
the pinned package write paths emit only `preset` and optional `origin`.
Therefore unrelated extra keys remain outside this adapter's qualified schema
even though the upstream package invariant independently checks preset
membership rather than acting as a generic exact-key JSON parser.

The field records provenance/intent for permission default refresh: only a
still-effective `default` selection may be refreshed for a confirmed reusable
blank session. Explicit `selection`, `inferred`, and legacy origin-less records
remain pinned. The ordinary `effectivePermissionPreset` fold still returns
only `data.preset`; `origin` does not change event identity, sequencing,
turn/step membership, tool association, or model transcript membership.

### Pinned source-diff audit

The pinned RC8-to-0.1.1-rc.1 source diff changes the permission-presets owner
above and a subagent projection implementation. The subagent change migrates
projection state/wire schema registration; the persisted
`subagent/descriptor`, its invariant and lifecycle sources are byte-unchanged.
The complete production source directories for core session contracts,
JSONL/Zstandard persistence, DSH-home resolution, and agent-team events are
also byte-unchanged. Consequently the audited format version remains `0`, and
the `HeaderLine`, event envelope and contiguous `seq` semantics, request
headers, turn/step/tool lifecycle, lineage and `seedLength`, assistant usage,
known event vocabulary, packed-row expansion, and framed-Zstandard persistence
retain their RC8 definitions. This is a scoped comparison of the existing
adapter's contract owners, not a claim of universal compatibility with every
0.1.1-rc.1 package or future event payload.

### Supported behavior

The implementation extends only the exact `permission/preset` data validator so
that a missing `origin` and each of the three pinned enum values are accepted.
It validates but does not project `origin`: the field alone creates
no fact, analytics dimension, ownership, causality, user-intent inference, or
new public output. Invalid types, `null`, invalid strings, and unrelated unknown
keys continue to fail closed with shape drift. No wildcard passthrough or
generic extra-property acceptance is permitted.

The resulting compatibility boundary is:

> Better Harness `dsh-v1` remains a partial `sessionAnalysis` adapter for
> format-0 persisted session evidence, qualified against the audited RC7/RC8
> baseline plus the pinned DSH `0.1.1-rc.1` `permission/preset` schema
> extension.

This is not "latest DSH" or full DSH 0.1.1 support.

### Native qualification evidence and diagnostic boundary

The already-completed isolated run used the official npm package
`0.1.1-rc.1` at the pinned commit. DSH completed its task and produced 31
complete Zstandard frames, 100 physical storage records, and 546 contiguous
logical events: one complete turn, five complete steps, five assistant messages
all carrying usage, and seven tool calls with seven matching results. The
session was complete, with no framing corruption or unknown event type.

A read-only, in-memory diagnostic removed only the new `origin` member. All 546
logical events then passed the existing Better Harness decoder and relationship
validation. No repository file or upstream artifact was changed. This isolates
the observed rejection but does not claim that the full public Better Harness
route passed: discovery rejected the real artifact before sessions, events,
facts, show, gated show, and selection/reference behavior could all be
re-qualified.

### Security and privacy boundary

The failed public discovery output did not expose the raw prompt, credential
name, private DSH home, or raw session id. That confirms the rejection path only.
After implementation, default and content-authorized public paths must be
re-qualified without printing or storing real content. Any later regression
fixture must be minimal, synthetic, contract-focused, and free of real
transcripts, credentials, secrets, and machine-specific paths.

During implementation, an isolated comparison at the pre-origin Better Harness
baseline `996fd3d3045dfe29935fc7948377416712ab2711` used a naturally accepted,
origin-less RC7/RC8-compatible format-0 fixture and an ephemeral equality-only
prompt oracle. It reproduced the direct-user prompt at
`candidates[0].request.summary` in default `facts`; the baseline and rc.1 branch
otherwise produced identical public sessions, events, facts, show, and gated-
show results for that fixture. This confirms a pre-existing default-facts defect,
not a privacy regression introduced by the optional-origin validator. The defect
remains unresolved and outside this compatibility follow-up; this evidence does
not claim that default-facts privacy is safe.

## Support Boundary

The delivered support claim is:

```text
DSH persisted JSONL session
  -> workspace qualification
  -> supported event normalization
  -> Better Harness session evidence
```

The Better Harness adapter metadata id is `dsh-v1`; the only supported native
DSH session format is `0`. The `dsh` host is registered only for the
`sessionAnalysis` capability. Raw `session.jsonl` and, when the running Node.js
runtime exposes the required public Zstandard API, concatenated checksummed
`session.jsonl.zstd` are the only physical encodings. SQLite and custom
persistence providers remain unavailable.

Support is JSONL-only and partial. Every artifact is read-only. Unavailable,
incomplete, malformed, ambiguous, foreign-workspace, and unsupported evidence
must remain visible as such or be rejected according to the acceptance
scenarios below; it must never be guessed, repaired, rewritten, or promoted to
a broader host capability.

## Acceptance Scenarios

### AC-1: Scope resolution

An explicit `--dsh-home` value takes precedence over inherited `DSH_HOME`,
which takes precedence over the default `~/.dsh`. A blank or whitespace-only
inherited `DSH_HOME` is unset; explicit values retain normal path validation.
The only session root is `<resolved-home>/sessions`; malformed or otherwise
unresolved values do not trigger guesses at alternate roots.

### AC-2: Artifact discovery

Discovery accepts only the fixed nested DSH JSONL layout containing
`session.jsonl.zstd` or raw `session.jsonl`. It deduplicates by canonical
artifact path and bound session identity. Conflicting encodings or identities,
flat legacy layouts, and ambiguous artifacts fail closed and contribute no
session evidence. Discovery does not follow project/session directory symlinks,
and every artifact's canonical path must remain contained by the canonical
sessions root.

### AC-3: Physical and logical validation

Before evidence is accepted, the adapter validates the tagged header's `type`,
format `version`, session `id`, `createdAt`, absolute `cwd`, and required
`delegationDepth`; artifact identity; session-id/path binding; and logical JSONL
record shape. Format `0` event `seq` values start at `0` and remain contiguous.
Default `packChunks=true` storage rows are losslessly decoded according to the
pinned upstream shape and their logical events participate in sequence
validation; a packed storage row is never treated as a `SessionEvent` itself.
Malformed records, identity or sequence mismatch, unsupported versions, and
same-version structural drift are rejected.
An uncommitted final raw row without a newline, or a malformed/sequence-broken
suffix not followed by a committed `turn/end`, is excluded while the contiguous
committed prefix remains available and explicitly incomplete. The same defect
before a later `turn/end` is committed corruption and rejects.

### AC-4: Zstandard runtime policy

A compressed artifact is treated as a concatenation of independently
checksummed Zstandard frames. The adapter scans and validates frame boundaries,
decompresses each complete frame independently, and concatenates the decoded
payloads; it must not submit the entire file to a single decompression call. A
structurally incomplete final frame is an uncommitted crash tail and is excluded
while prior complete frames remain available; invalid complete structure or a
checksum-corrupt complete frame rejects.
The public Zstandard API available in supported Node.js 22.20 and 24 runtimes is
feature-detected at runtime. Where Node.js 23.0 through 23.7 exposes no required
public API, compressed evidence is explicitly unavailable while raw JSONL
evidence remains readable. This slice adds no dependency and changes no Node.js
engine range.

### AC-5: Workspace qualification

Only the header's absolute `cwd` qualifies a session to the requested
workspace. The intentionally lossy project-directory name is never used as
workspace evidence. Qualification follows existing Better Harness workspace
topology and path, case, canonicalization, and symlink semantics across Windows,
macOS, and Linux. A foreign workspace cannot enter the result.

### AC-6: Normalization and bounded provenance

Normalization allowlists only `user/message`, `assistant/message`, `tool/call`,
`tool/result`, and turn lifecycle/outcome evidence. It preserves observed user
source distinctions, native call/result ids, turn/step/sequence coordinates,
and bounded `parentSession`, `seedLength`, `origin`, `delegationDepth`, and
`agentPreset` provenance. It does not copy arbitrary raw or plugin data and
does not infer plugin ownership, plugin causality, or faulty-plugin attribution.
RC8 interrupted assistant and team events are validated/accounted without
inventing team analytics. Inherited rows before `seedLength` validate as part
of the artifact but do not become child-owned activity. A native call id reused
after its prior lifecycle closes remains a distinct invocation occurrence.

### AC-7: Privacy and completeness

The adapter reuses the existing `includeUserText`, `includeCommandText`, and
`includeContent` gates. Credential-shaped fixture values do not leak through
facts, diagnostics, provenance, or errors. Missing token or usage fields remain
unobserved rather than becoming zero. An unknown required event rejects the
artifact; an unknown ignorable event is explicitly accounted for. An open
trailing turn is marked incomplete. Every source read is read-only, and no path
repairs or rewrites an upstream artifact.
Unknown ignorable event data may be any JSON value. An omitted native
`tool/result.isError` remains an unobserved outcome; only explicit true/false or
independent native error evidence establishes the corresponding outcome facts.

### AC-8: Capability boundary

The Better Harness adapter id is `dsh-v1` and supports only native DSH session
format `0`. The `dsh` host receives only `sessionAnalysis`; catalog projection
must not grant configured assets, plugin lifecycle, shell, output, packaging,
or another capability. The session-analysis CLI and loader support `dsh`
explicitly, and unknown hosts continue to fail closed rather than falling
through to another adapter.

### AC-9: Deterministic evidence

Synthetic fixtures and behavioral tests cover raw JSONL, concatenated
checksummed Zstandard frames, workspace acceptance and rejection, packed rows,
event correlation, every terminal outcome, RC8 interruption/team vocabulary,
unknown required and JSON-valued ignorable events, unknown tool outcomes,
inherited seed ownership, reused call ids, bad format version/header/id/sequence,
committed corruption and uncommitted crash tails, canonical path and
session-identity deduplication, sessions-root containment, privacy gates,
Zstandard API absence, and Windows/macOS/Linux path behavior. No fixture
contains a real transcript, secret, credential, or machine-specific absolute
path.

### AC-10: Honest documentation

The source host adapter matrix and published adapter matrix describe DSH as
JSONL-only partial session evidence and identify every unavailable slice. DSH is
not added to README Quickstart or Installation. Documentation does not claim a
shell, configured assets, Skills, plugin lifecycle, packaging, report output,
native invocation, SQLite, or custom-provider support.

### AC-11: Validation and readiness

Focused adapter, loader, registry, CLI, fixture, and documentation tests pass,
followed by `npm test`, `npm run pack:verify`, and `git diff --check`. Review
evidence maps Story #93 to this spec, every AC to behavioral tests or an
explicit review check, and each material risk to a fail-closed response. The
diff contains no real transcript, secret, credential, or machine absolute path.

### AC-12: Strict 0.1.1-rc.1 permission-origin acceptance

Given an otherwise valid format-0 `permission/preset` event, the exact
0.1.1-rc.1 values `origin: "default"`, `origin: "selection"`, and
`origin: "inferred"` are each accepted. An event without `origin` remains
legal, preserving the RC7/RC8 and legacy-log contract.

### AC-13: Permission-origin fail-closed boundaries

For `permission/preset.origin`, `null`, booleans, numbers, arrays, objects, and
strings outside the three-value pinned enum are rejected as
`DSH_EVENT_SHAPE_DRIFT`. An unrelated data key is also rejected. The adapter
does not enable generic unknown-field acceptance, wildcard passthrough, or any
other validator relaxation.

### AC-14: Validation without semantic projection

Accepting a legal `origin` changes only artifact validity. The adapter does not
create a new normalized field, fact, analytic, ownership or causality claim,
user-intent inference, diagnostic content, or user-visible value from it. All
existing content and privacy gates retain their current owners and behavior.

### AC-15: Real 0.1.1-rc.1 public-path qualification

After the implementation, a fresh isolated real run of the pinned official DSH
0.1.1-rc.1 package produces a discoverable and analyzable session through the
public Better Harness DSH session-analysis path. Qualification exercises
sessions, events, facts, show, explicitly content-authorized show where
applicable, and public qsr1 session selection/reference. It verifies framed
Zstandard decoding, workspace qualification, normalization, completed
turn/step relationships, assistant usage, call/result association, completion,
and zero unexpected DSH diagnostics. The rc.1 adaptation must introduce no new
privacy exposure relative to the audited pre-origin Better Harness baseline:
default events and show retain their existing content gates, explicitly gated
output exposes only content authorized by the existing contract, diagnostics
remain privacy-safe, and `permission/preset.origin` creates no public projection.
The baseline-reproduced default-facts direct-user-prompt exposure is a known,
pre-existing, unresolved defect outside this compatibility follow-up. It must
remain explicit in review evidence and is not evidence that privacy is fully
safe or that this follow-up repaired it.

### AC-16: Backward regression and readiness

Retained RC7/RC8 fixtures, all existing strict schema-drift negatives, and the
full DSH session-analysis suite remain green. Focused RED-to-GREEN evidence is
followed by the repository-required full test, package, documentation, diff,
privacy, and review-readiness gates. The resulting diff remains confined to
the existing `sessionAnalysis` capability and contains no real artifact or
transcript.

## Non-goals

- Native DSH installation, invocation, live PTY integration, or process-state
  observation.
- Configured-asset or Skill discovery.
- DSH plugin lifecycle integration.
- A shell, manifest, package integration, or packaging claim.
- README Quickstart or Installation placement.
- A report output route or a new report mode.
- SQLite or custom persistence-provider support.
- Global Node.js engine-range changes or new dependencies.
- Automatic harness optimization or self-modification.
- Faulty-plugin identification, plugin ownership, or causality inference.
- Upstream artifact mutation or repair.
- Complete first-class DeepSeek Harness support.

### 0.1.1-rc.1 follow-up non-goals

- Generic permissive event parsing, wildcard passthrough, or arbitrary
  extra-property acceptance.
- A DSH adapter redesign or `dsh-v2` absent a separately proven deeper contract
  break.
- A `SESSION_FORMAT_VERSION` change or a new Better Harness capability.
- Configured assets, plugin lifecycle, team analytics, SQLite, or custom
  persistence.
- Installation, shell, packaging, native invocation, or Quickstart work.
- Default-facts privacy work or replacement/current-surface semantics.
- Projection of `permission/preset.origin` into analytics, facts, ownership,
  causality, or new public output.
- Qualification of unrelated DSH master, later release, or package changes.
- Unrelated Better Harness cleanup.
- `CHANGELOG.md` edits unless separately authorized.

## Plan and Tasks

1. **Contracts and fixtures (AC-3, AC-4, AC-6, AC-7, AC-9):** encode the
   pinned format-0 header, logical events, packed-row shape, terminal outcomes,
   bounded provenance, privacy values, raw JSONL, and independently checksummed
   concatenated Zstandard frames as deterministic synthetic fixtures. Include
   malformed and unsupported variants without copying a real transcript.
2. **Discovery and decoding (AC-1, AC-2, AC-3, AC-4, AC-5, AC-7, AC-9):** add
   explicit DSH-home resolution, nested artifact discovery, canonical identity
   deduplication, workspace qualification, raw decoding, feature-detected
   frame-by-frame Zstandard decoding, packed-row expansion, and fail-closed
   validation. Keep all reads side-effect free.
3. **Normalization and registration (AC-6, AC-7, AC-8, AC-9):** map only the
   allowlisted event subset into existing session facts, preserve bounded
   correlation/provenance, expose incompleteness and unavailable evidence, and
   register `dsh-v1` only in session-analysis loader/CLI and the corresponding
   capability slice.
4. **Documentation and support claims (AC-8, AC-10):** update only the two
   adapter matrices and relevant session-analysis support references so their
   JSONL-only partial claim, runtime Zstandard boundary, and unavailable slices
   exactly match executable behavior. Do not widen README installation or
   Quickstart surfaces.
5. **Full validation and readiness (AC-9, AC-11):** run focused behavioral
   tests, the full suite, package verification, whitespace validation, and a
   Review Readiness Check. Inspect the complete diff for capability overclaim,
   private data, real transcripts, machine paths, generated-file drift, and a
   coherent Story -> Spec -> AC -> test/risk evidence chain.

Each module is reviewed before the next begins. A later task may tighten an
implementation detail only when it remains inside these ACs and the pinned
native sources; widening support requires a separately approved specification.

### 0.1.1-rc.1 follow-up implementation plan

The planned production owner is the existing exact event validator in
`scripts/session-analysis/platforms/dsh.mjs`; the focused regression owner is
`test/sessions/session-analysis-dsh-provider.test.mjs`. No new adapter module or
normalized owner is planned.

1. **Focused RED fixture (AC-12, AC-13):** add a minimal synthetic format-0
   event that proves each legal pinned `origin` currently fails with
   `DSH_EVENT_SHAPE_DRIFT`, plus missing-field, invalid-enum, invalid-type,
   `null`, and unrelated-key cases.
2. **Exact schema qualification (AC-12, AC-13, AC-14):** extend only the
   package-owned `permission/preset` data validator with the optional closed
   enum. Do not change generic object validation or normalization output.
3. **Focused GREEN and backward regression (AC-12, AC-13, AC-16):** pass the
   new positives and negatives, retained RC7/RC8 fixtures, existing drift
   negatives, and the full DSH/session suite.
4. **Real public-path qualification (AC-15):** use a fresh isolated home and
   disposable project with the pinned official package, then verify the public
   sessions/events/facts/show/gated-show/reference path and privacy diagnostics
   without copying content or artifacts into the repository.
5. **Repository readiness (AC-16):** run the required full tests, package and
   documentation checks, `git diff --check`, privacy/diff review, and Review
   Readiness Check before any implementation PR.

## Test and Review Evidence

| Acceptance criteria | Test or command | Expected review evidence |
| --- | --- | --- |
| AC-1 | Focused home-resolution tests | CLI override wins over environment and default; blank inherited environment is unset; the only derived root ends in `sessions`. |
| AC-2 | Focused discovery, containment, and dedupe tests | Only fixed nested raw/compressed artifacts qualify; canonical path/session collisions, symlink escapes, flat legacy, conflicts, and ambiguity fail closed. |
| AC-3 | Header, identity, sequence, packed-row, and raw crash-tail fixture tests | Format-0 records validate; committed prefixes survive uncommitted tails; drift proven committed by a later boundary rejects. |
| AC-4 | Concatenated checksummed-frame, systematic torn-tail, checksum-corruption, and API-absence tests | Complete frames decode independently; an incomplete final frame is excluded; complete corruption rejects; unavailable API disables only compressed evidence. |
| AC-5 | Workspace topology tests on Windows/macOS/Linux path forms | Absolute header `cwd` follows existing case/canonical/symlink semantics and foreign workspaces never contribute facts. |
| AC-6 | Event normalization, correlation, seed-ownership, RC8 vocabulary, and lifecycle tests | Only allowlisted owned evidence appears; interrupted/team rows validate; reused ids retain occurrences; arbitrary/plugin fields and causal claims do not. |
| AC-7 | Privacy-gate, JSON-valued ignorable, unknown-outcome, missing-usage, incomplete, and read-only tests | Content gates redact credential-shaped values; absence stays unobserved; required unknowns reject; crash/open tails stay incomplete without writes. |
| AC-8 | Catalog capability mapping, loader, CLI help, and unknown-host tests | `dsh-v1` accepts only format 0; only `sessionAnalysis` maps to `dsh`; loader/CLI route explicitly and unknown hosts reject. |
| AC-9 | Focused cross-platform synthetic fixture suite | Every enumerated encoding, validation, lifecycle, identity, privacy, runtime, and path case has deterministic behavioral evidence with no real local data. |
| AC-10 | Adapter matrix assertions plus `npx vitest run test/skills-docs/doc-link-graph.test.mjs` | Both matrices expose the same partial JSONL claim and unavailable slices; links resolve; README Quickstart/Installation remains unchanged. |
| AC-11 | Focused tests; `npm test`; `npm run pack:verify`; `git diff --check`; Review Readiness Check | All commands report their actual result; package boundaries remain valid; diff is whitespace-clean and the Story/Spec/Test/Risk chain is complete. |
| AC-12 | Focused `permission/preset` origin fixture positives plus the retained origin-less fixture | All three pinned enum members and the absent field decode; the existing preset-only shape remains legal. |
| AC-13 | Focused invalid-enum/type/null/unrelated-key negatives | Every unqualified shape fails with `DSH_EVENT_SHAPE_DRIFT`; other strict event validators are unchanged. |
| AC-14 | Normalization, facts, events, show, and snapshot assertions | Legal `origin` affects validity only and adds no normalized or public semantic claim. |
| AC-15 | Pre-origin baseline prompt-equality oracle plus fresh pinned real DSH E2E through public sessions/events/facts/show/gated-show/qsr1 paths | The baseline reproduces the known default-facts defect; the rc.1 branch adds no privacy exposure, the real session is selectable and complete, content gates behave as owned, and no unexpected DSH diagnostic appears. The known defect remains unresolved and explicit. |
| AC-16 | Retained RC7/RC8 and drift suites; full tests; package/docs checks; `git diff --check`; Review Readiness Check | Backward evidence stays green, no capability widens, the change is packaging-safe, and the diff contains no real content or machine path. |

Native smoke evidence, if available during implementation, is bounded and
redacted. It may confirm the pinned contract but cannot replace deterministic
fixtures or justify a broader support claim. Node.js runtimes without the public
Zstandard API must be exercised through deterministic feature-absence tests,
not described as a successful compressed-session smoke.

## Risks and Rollback

| Risk | Fail-closed control and review signal |
| --- | --- |
| Same-version structural drift | Validate the complete supported header and logical shapes against pinned fixtures; reject unrecognized required structure. |
| Packed rows mistaken for events | Decode only the upstream lossless packed-row shape before sequence validation; reject malformed packing and never normalize the storage row itself. |
| Multi-frame Zstandard truncation or silent tail loss | Scan every boundary, exclude only a structurally incomplete final frame, retain prior complete frames, and reject complete structural/checksum corruption. |
| Zstandard API unavailable | Feature-detect the public API, mark compressed evidence unavailable, and continue to support independent raw evidence. |
| Path alias, case, or symlink mismatch | Reuse existing workspace topology and canonical path semantics with cross-platform positive and negative fixtures. |
| Foreign workspace admitted | Require the absolute header `cwd` to qualify; do not consult the lossy directory name or another heuristic. |
| Artifact or session identity collision | Bind header id to the nested artifact path, deduplicate canonical identity, and reject conflicts or ambiguity. |
| Unknown required event silently dropped | Distinguish required from explicitly ignorable events; reject the former and account for the latter. |
| Private content or credential leakage | Apply existing content gates at normalization and error/provenance boundaries, then assert value-level non-disclosure with synthetic credential shapes. |
| Capability or documentation overclaim | Test catalog-to-implementation mapping and review both matrices against the non-goals; no catalog projection may create an unsupported slice. |
| Optional-field qualification becomes broad parsing | Add only the three-value optional enum to the exact event owner; retain invalid-type, invalid-enum, `null`, and unrelated-key rejection tests. |
| Provenance is mistaken for Better Harness semantics | Validate `origin` without normalization or projection and assert that facts and public summaries do not gain new claims. |
| Real discovery passes but downstream privacy regresses | Reproduce the pre-origin baseline with an equality-only oracle, then re-run the complete public sessions/events/facts/show/gated-show/reference path and reject any new exposure. Preserve the known default-facts defect as unresolved rather than treating baseline behavior as privacy-safe. |

Rollback removes the session-only adapter, its `sessionAnalysis` registration,
its synthetic fixtures/tests, and its two matrix claims. No user-data migration
or cleanup is needed because the adapter never writes, repairs, converts, or
owns DSH artifacts. If a runtime or upstream compatibility risk is found before
that full rollback, the affected evidence path fails closed while raw evidence
and unrelated host adapters remain unchanged.

For the 0.1.1-rc.1 follow-up, rollback removes only the exact optional-origin
qualification and its synthetic tests/documentation. The implemented RC7/RC8
adapter remains available because preset-only events retain their prior shape;
no DSH artifact, user data, migration, or cleanup is involved.
