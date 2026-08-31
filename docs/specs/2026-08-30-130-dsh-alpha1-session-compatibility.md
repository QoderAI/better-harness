# DeepSeek Harness alpha.1 Session compatibility

## Traceability

- Spec ID: `2026-08-30-130-dsh-alpha1-session-compatibility`
- Story: `#130`
- Status: `Implemented`

## Intent

Extend the existing fail-closed DeepSeek Harness (`dsh`) Session persistence
adapter from the qualified `0.1.1-rc.2` contract to the known
`0.1.2-alpha.1` persisted contract without expanding Better Harness P0
semantics.

This is forward compatibility for a candidate prerelease. It does not replace
rc.2 as the qualified baseline. The compatibility boundary is pinned to:

- original Better Harness implementation base `057ce8689a9f4f38399f2f0ff72049c37c380446`;
- final delivery base `177714970ca204ec98defcead9d1510b259202e1`;
- DSH `0.1.1-rc.2` at `b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`;
- DSH `0.1.2-alpha.1` at `cd5ef8148158c3a752a658978873241fdf8e2bbc`.

The canonical owners remain the existing DSH Session adapter and its focused
Session regression test. The change recognizes only the observed physical
provenance encoding and three required metadata events described below.

## Acceptance scenarios

### AC-1 — Alpha provenance ranges

Valid alpha.1 `Array<number | [number, number]>` `sourceEventSeqs` persistence
is validated and expanded to the existing scalar semantic representation.
Valid mixed scalar/range forms follow native alpha.1 semantics. Malformed,
unordered, overlapping, unsafe, reversed, or out-of-bound range forms remain
fail-closed where native invariants require it.

### AC-2 — rc.2 provenance compatibility

Existing rc.2 scalar provenance behavior is unchanged. Alpha range-only strict
ordering rules are not imposed on legacy pure-scalar input where rc.2 did not
require them.

### AC-3 — New required event vocabulary

Exactly these three alpha.1 persisted events are recognized:

- `model/selection`;
- `session-log-deepseek/delivery-accepted`;
- `subagent/model-selection-policy`.

Their native payload contracts are exactly validated. They remain
non-conversation, non-normalized metadata unless existing Better Harness
semantics explicitly require otherwise.

### AC-4 — Delivery invariants

`session-log-deepseek/delivery-accepted` enforces native alpha.1 relationship
semantics:

- `sessionId` is non-empty;
- `throughSeq` is a safe non-negative integer;
- `throughSeq < event.seq`;
- a non-inherited event identifies the containing Session;
- a valid inherited parent marker retains the parent Session identity.

Tests explicitly cover foreign non-inherited Session rejection, equal and
future watermark rejection, and valid inherited parent-marker acceptance.

### AC-5 — Subagent policy invariants

`subagent/model-selection-policy` requires a non-empty `allowedModels` array,
non-empty provider/model routes, and rejection of duplicate provider/model
routes. A direct duplicate-route regression exists.

### AC-6 — Fail-closed safety

Malformed known alpha events, malformed provenance ranges, genuinely unknown
required future events, and committed corrupt Session records remain rejected.
Existing rc.2 unknown-ignorable behavior remains unchanged.

### AC-7 — Persistence parity

Compatible semantics are verified for raw JSONL, Zstandard, and packed/chunked
alpha persistence. All formats converge through one canonical
physical-to-semantic normalization seam.

### AC-8 — Native compatibility evidence

At least one native alpha.1 artifact produced through first-party Session
persistence proves the new physical contract is accepted by Better Harness.
Existing qualification evidence may be used only when it remains reproducible
and tied to the exact alpha.1 SHA.

### AC-9 — Runtime matrix

Focused compatibility checks pass under Node `22.20.0` and a repository-
supported Node 24.x runtime.

### AC-10 — Scope

No changes are made to Profile, Preset, Cordis, Skill discovery, Instructions,
report rendering, Evidence Bundle schema, installation, dependencies,
capability flags, or the official qualified DSH baseline.

## Non-goals

- Full DSH `0.1.2-alpha.1` feature parity.
- Profile, Preset, or Cordis runtime evaluation.
- Reporting the new model-selection metadata.
- MCP, ACP, or plugin expansion.
- Changing DSH installation guidance.
- Promoting alpha.1 as the supported baseline.
- Generic future-event acceptance.
- A generic future-proof Session schema framework.
- Changing torn-tail semantics.

## Plan and tasks

1. Confirm Issue #130 and the pinned native upstream contracts.
2. Lock provenance range semantics in regression tests.
3. Lock the three event payload contracts.
4. Add the missing delivery relationship regressions.
5. Add the duplicate model-route regression.
6. Update the pinned known-event test catalog.
7. Verify rc.2 backward compatibility.
8. Verify alpha raw, Zstandard, and packed behavior.
9. Run focused validation under Node 22 and Node 24.
10. Run required repository gates and generated-document checks.
11. Perform the Review Readiness Check.

No additional production implementation is planned. If a new regression proves
the existing implementation wrong, work stops for a separate correctness
decision rather than silently changing the adapter.

## Risks

### Fail-open risk

Overly permissive validation could accept unknown future DSH semantics.

Mitigation: retain the exact event allowlist, exact payload schemas, and the
unknown-required-event regression.

### Backward-compatibility risk

Alpha range validation could accidentally tighten valid rc.2 scalar
provenance.

Mitigation: retain an explicit legacy scalar-order regression.

### Resource-exhaustion risk

Range expansion could allocate unbounded sequence lists.

Mitigation: bound expansion before allocation using the authoritative event
sequence and native constraints.

### Semantic-expansion risk

New metadata events could accidentally become conversation or report
semantics.

Mitigation: keep them known, exactly validated, and non-normalized.

## Test and review evidence

The implementation qualification supplied before this traceability phase is
the native evidence for AC-8: first-party alpha.1 raw, Zstandard, packed, and
metadata artifacts at exact DSH commit
`cd5ef8148158c3a752a658978873241fdf8e2bbc` were accepted after the compatibility
change, while the qualified rc.2 baseline remained green. This phase did not
recreate those native artifacts. An independent source review additionally
verified the normalization seam, range decoder, three event validators, rc.2
compatibility, fail-closed behavior, and scope against both pinned DSH commits.

Current local evidence from this phase:

| Acceptance criteria | Command or review | Observed result |
| --- | --- | --- |
| AC-3, AC-4, AC-5 | Disposable detached `upstream/main` worktree with only the five new relationship/policy assertions, then `vitest run test/sessions/session-analysis-dsh-discovery.test.mjs` | RED: 1 file ran; 62 tests passed and all 5 new regressions failed because the pre-fix adapter returned `DSH_UNKNOWN_REQUIRED_EVENT`. The disposable worktree was removed. |
| AC-1 through AC-7, AC-9 | Post-rebase Node `22.20.0`: `node ./node_modules/vitest/vitest.mjs run test/sessions/session-analysis-dsh-discovery.test.mjs test/sessions/session-analysis-dsh-fixtures.test.mjs test/sessions/session-analysis-dsh-provider.test.mjs` | 3 files passed; 112 tests passed; 0 skipped. |
| AC-1 through AC-7, AC-9 | Post-rebase Node `24.15.0`: the same three-file Vitest command | 3 files passed; 112 tests passed; 0 skipped. |
| AC-1 through AC-7 | Post-rebase `npm test` with the required local loopback access | 107 files passed; 1,613 tests passed; 2 skipped. |
| Repository documentation | `node scripts/doc-link-graph/cli.mjs skills/better-harness` | Parsed 13 seed docs; generated a 39-file/56-link graph; `docs/better-harness-doc-links.mmd` remained unchanged. |
| Repository documentation | `npx vitest run test/skills-docs/doc-link-graph.test.mjs` | 1 file passed; 8 tests passed. |
| Repository generated sources | `npm run harness:generated` | PASS; Langium generation completed and the generated-source diff was clean. |
| Repository Harness package | `npm run harness:test` | 20 files passed; 173 tests passed. |
| Repository package boundary | Post-rebase `npm run pack:verify` | PASS; npm package contained 619 entries and the runtime zip contained 881 entries. |
| AC-10 and repository hygiene | Rebase and scope review; `git diff --check`; production-diff SHA-256 before and after rebasing onto `177714970ca204ec98defcead9d1510b259202e1` | No overlapping upstream owner or out-of-scope file changed; whitespace check passed; the adapter diff remained `da4e9887eb4b418da043ac61e9f97c8127727150ab60968b2d8a5bd4476ff74b`. |

Issue #130, this Spec, the AC-mapped regressions, risk controls, and current
gate receipts form the implementation evidence chain. GitHub did not apply the
required `bug` label during Issue creation, and the authenticated account lacks
`AddLabelsToLabelable`. Maintainer phodal subsequently confirmed
`@Cobb04 welcome to PR`; the form-controlled label limitation therefore does
not block delivery and does not change the implemented AC status.

AI involvement: Codex generated the local Spec and regression additions and ran
the recorded commands. Cobb04 supplied the compatibility boundary, independent
review requirements, and final delivery authorization. The delivery commit
uses the repository's single Codex co-author marker convention.
