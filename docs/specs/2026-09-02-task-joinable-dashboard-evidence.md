# Make Dashboard evidence joinable to a task, and lead with closure

## Traceability

- Spec ID: `2026-09-02-task-joinable-dashboard-evidence`
- Status: Implemented

## Intent

The Dashboard reports activity volume prominently and reports whether that
activity closed only behind a collapsed disclosure. It also reduces its two
strongest task-facing signals — which asset version ran, and which commit a
session produced — to counts that nothing can be joined against.

Report closure beside the volume it qualifies, and stop discarding the two
identifiers a Task evidence packet could later be matched on.

## Acceptance Scenarios

- **AC-1 — Closure is a first-screen fact:** the Validation and closure card
  renders as a top-level section positioned after the usage totals and before
  the supporting repository and Agent-source disclosure. It is never nested
  inside that disclosure.
- **AC-2 — Declared asset revisions survive:** an inventoried asset whose host
  declared a version and publisher carries them as `revision` and `publisher`.
  An asset whose host declared neither omits both fields rather than being given
  an invented value, and a host that declares an empty revision is rejected. A
  revision too long to report intact is omitted rather than shortened, because a
  shortened revision is a different version than the host declared; the asset is
  still inventoried and still carries its publisher.
- **AC-3 — Attributed commits carry their session:** each attributed commit that
  names both a commit and a session contributes one bounded reference naming the
  commit, the session that earned the attribution, its platform and its
  confidence. A `low` match contributes none, a commit missing either half of
  the key contributes none rather than a blank one, and the reference list never
  exceeds the attribution count it came from.
- **AC-4 — Existing Dashboard behavior remains stable:** project isolation,
  refresh caching, current metrics, responsive rendering, the collector contract
  boundary and the local-only upload flow retain their current behavior.

## Non-goals

- Deriving a Task evidence packet from observed sessions.
- Joining `evidenceDeliveries` to `usageActivity` or `commitAttribution` in the
  renderer; this change supplies the keys, it does not perform the join.
- Adding cost, retry, or intervention fields.
- Defining cross-machine project, member, machine, or publisher identities.
- Discovering a version for assets whose host declares none.

## Plan and Tasks

1. Surface a host-declared revision and publisher from `assetIdentity` in
   `scripts/agent-lint/index.mjs`, reporting neither when the host declared
   neither, and omitting a revision that cannot be reported intact.
2. Keep one bounded commit-to-session reference per attributed commit in
   `projectCommitAttribution`, skipping any commit that names neither side.
3. Extend `AssetIdentity` and `CommitAttribution`, and validate both new shapes
   in the Dashboard input contract, including the rule that references cannot
   outrun `attributedCommits` and that neither half of a reference key is blank.
4. Project declared revisions once per distinct asset in the Dashboard model.
5. Move the Validation and closure card out of the operational disclosure to a
   top-level position after the usage totals, and rename the disclosure to the
   evidence it still holds.
6. Surface both new fields in the page captions, then run the complete gates.

## Test and Review Evidence

- **AC-1:** `test/browser/dashboard.spec.mjs` asserts the delivery card is
  visible without opening a disclosure, precedes `.operational-evidence` in
  document order, and has no instance inside `.operational-disclosure`. The
  wide-layout screenshot shows the card between the usage totals and Harness
  footprint.
- **AC-2:** an `agent-lint` case installs a versioned Qoder plugin, a plugin
  whose declared version is too long to report, and a plain project Skill, then
  asserts `revision` `1.4.2` and publisher `Qoder Marketplace` on the first, the
  absence of `revision` with the publisher retained on the second, and the
  absence of both fields on the Skill. The temp root is resolved with `realpath`
  because plugin scope resolution compares real paths and the platform temp
  directory can be a symlink. The Dashboard model test asserts one revision entry
  for a plugin two hosts both read, and the contract test rejects a
  whitespace-only revision.
- **AC-3:** `test/collector-signals.test.mjs` asserts the two attributing
  commits produce references naming their sessions while the `low` and unmatched
  commits produce none, that a commit missing a hash or a session id stays
  counted but contributes no reference while a short hash alone is a usable key,
  and that a 225-commit run keeps all 225 attributions with 200 references. The
  contract test rejects references exceeding `attributedCommits`, a `low`
  confidence on a reference, and a blank `commit` or `sessionId`.
- **AC-4:** `npm test` passes at 109 files / 1641 tests, `npm run
  harness-ui:test` at 6 files / 54 tests including TypeScript validation, and
  `npm run harness-ui:test:browser` passes after `next build`. `harness`,
  `harness-studio` and `pack:verify` are unaffected: no module outside
  `harness-ui` imports `agent-lint`, `repository-signals` or
  `dashboard-input-contract`.
- **Observed effect:** on this workspace the promoted card immediately reports
  0 of 196 eligible episodes closed against 21,211 model responses and 6,206
  active minutes — the distinction the previous layout kept collapsed.
- **Risk:** `revision` and `publisher` are only as good as the host index that
  declared them. Assets configured as plain workspace files stay unversioned,
  so a consumer must treat an absent revision as undeclared rather than as a
  version mismatch. `attributedCommitRefs.length` can trail `attributedCommits`
  for two different reasons — the 200-reference bound, or a commit that named
  neither side — so the gap alone does not identify which occurred.
- **Contract note:** `attributedCommitRefs` is a required field on the existing
  `better-harness.dashboard-input` schema version 1 rather than a version bump.
  This is safe only because the collector and the validator ship in the same
  package and the server cache is in-memory; an out-of-tree producer of a v1
  document would need the field added.
