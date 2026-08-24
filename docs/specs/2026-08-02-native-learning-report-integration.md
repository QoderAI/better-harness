# Native Learning Review in Report Evidence

## Traceability

- Spec ID: `native-learning-report-integration`
- Roadmap: `LC-05`
- AI involvement: Codex (GPT 5.6 Sol)
- Status: Implemented

## Intent

Make the already validated native recurring-correction method usable through
the standard Harness review packet, lead-decision, and source-apply path. A
normal source must surface a bounded nested packet; the existing lead decision
may carry only its native decisions; source apply projects only validated
matches into canonical Learning Capture diagnostics and reader evidence.

## Acceptance Scenarios

- **AC-1: Reviewable source packet.** When ordinary report Task Episodes form
  native candidate groups, generated diagnostics retain a privacy-safe packet
  and declare that a decision is required. The packet is deterministic and
  contains no raw session, prompt, command, transcript, credential, or path.
- **AC-2: Validated report projection.** Given exact native decisions in the
  normal lead decision, source apply validates them and projects accepted signals,
  candidates, match/abstain counts, and binding digests into canonical Learning
  Capture diagnostics.
- **AC-3: Fail closed across the review lifecycle.** A pending source validates
  its generated packet against current Episodes. Review compile/apply rejects
  stale packet/source digests, invented aliases, and incomplete decisions.
  A persisted reviewed source independently revalidates its stored packet,
  decision allowlists, and result aggregates, so tampering fails validation
  even after legitimate outer review fields have changed the current Episodes.
- **AC-4: No-group compatibility.** A source with no native groups has no new
  native review diagnostic and preserves the existing Learning Loop output.
- **AC-5: Reader visibility.** The neutral evidence brief reports whether a
  native review is pending or validated, and reports bounded group/match/
  abstain counts without exposing packet aliases or private source data.
- **AC-6: Standard review binding.** The outer Harness packet carries the
  optional native subpacket but does not merge its opaque aliases into
  `allowedEvidenceRefs`, including when another packet is built from a persisted
  reviewed source.
- **AC-7: Public local review route.** A registered, parser-safe
  `harness source-review` command exposes explicit `create`, `decision`, and
  `apply` phases. `create` writes the bounded packet and a packet-bound decision
  template, `decision` compiles only the caller-edited template, and `apply`
  requires explicit non-interactive confirmation before atomically replacing
  the selected source. The route does not call a model or author a decision.
- **AC-8: Strict persisted contract.** Stored Episode facts, groups, coverage,
  decisions, matches, abstentions, and result metadata reject unknown fields,
  unsafe values, cross-reference drift, and decision/result disagreement even
  when packet digests are recomputed. The complete stored Learning Loop result
  must equal deterministic reconstruction from the packet, review, final
  Episodes, signals, interventions, and asset coverage. A packet with groups
  requires complete native decisions before outer review apply; omission cannot
  leave a stale pending packet after Episode review mutation.

## Non-goals

- Do not call an AI model or choose a provider/model.
- Do not create, alter, or apply a Skill, Rule, Memory, Hook, ledger entry, or
  other Harness asset.
- Do not infer native `repeated-rediscovery` or another pattern.
- Do not claim intervention effectiveness, transfer, causality, or savings.
- Do not make unreviewed native candidates into canonical candidates.

## Plan and Tasks

1. Extend generated Learning Capture diagnostics with a tightly validated,
   pending privacy-safe native review packet.
2. Add that packet as an independent nested contract in the Harness review
   packet, without mixing its opaque aliases with source evidence references.
3. Require and compile native decisions when a nested packet is present, then
   apply them only through `applyReportSourceReview` after both packet contracts
   validate.
4. Surface aggregate native-review state in the neutral evidence brief.
5. Add the registered `harness source-review create|decision|apply` owner under
   `report-source/`, with a packet-bound decision template, local JSON files,
   parser-safe output, refusal to overwrite intermediate files, and explicit
   confirmation for source apply.
6. Cover the standard outer packet -> lead decision -> apply path for positive,
   abstain, stale/invented, dedupe, no-group, privacy, and stored-result
   tampering behavior.

## Test and Review Evidence

- AC-1 to AC-8: native candidate, report-source review, public CLI, task-loop
  source, analyzer, Learning Loop, Episode, and report-source contract tests.
- Public-path evidence invokes the root `scripts/better-harness.mjs` facade for
  create, decision, refused unconfirmed apply, and confirmed atomic apply.
- Documentation and frozen-contract evidence covers Skill routing, generated
  doc links, human help fixtures, command inventory, schema, and packaging.
- Regression and package evidence: `npm test` and `npm run pack:verify`.

## Implementation Evidence

- AC-1 and AC-4: `task-loop-source.mjs` emits the pending packet only when
  bounded native groups exist; native and cross-module fixtures retain the
  no-group behavior.
- AC-2, AC-3, AC-6, and AC-8: the outer packet -> lead decision -> apply test
  rejects omitted decisions, stale digests, recomputed-digest nested packet
  injection, invented or duplicate aliases, unknown nested result fields, and
  decision/result drift. Synchronized edits to stored canonical candidates,
  costs, or scores fail deterministic full-result reconstruction. Rebuilt outer
  packets exclude every `native-learning-evidence` reference.
- AC-5: `evidence-brief.mjs` emits only pending/reviewed aggregate counts.
- AC-7: the registered root CLI E2E passed create, caller-authored decision,
  unconfirmed-apply refusal, and confirmed atomic apply by editing the generated
  template. Machine output and read errors omit absolute paths and raw validator
  details, intermediate files use create-only writes, bare decision documents
  are rejected without writing a review, and malformed help combinations fail
  instead of hiding invalid arguments.
- Focused native/report-source run: 63/63. Cross-module source/analyzer/
  Learning Loop/Episode run: 81/81.
- CLI, Skill, frozen CLI, and doc-link contract run: 66 passed with one Windows
  package-bin symlink test skipped.
- Final full regression on the merged `main`: 1267 passed, 0 failed, 0 skipped
  on macOS. The authoring environment had previously reported four Windows
  `EPERM` symlink-creation failures in analysis-scope, render, and
  workspace-topology tests outside the changed modules; those are environment
  restrictions, and CI passed on ubuntu (Node 22 and 24), macOS, and Windows.
- Package verification passed: 450 npm entries and 472 runtime ZIP entries.
- `git diff --check` passed.

## Privacy and Risk

- A review can become stale between runs. Rebuilding the packet and requiring
  both digests fail closes stale input.
- Packets are source-visible data. Only the existing bounded, privacy-safe
  packet projection is retained; the brief emits aggregate counts only.
- Existing unreviewed provider candidates remain unchanged. Native candidates
  are added only after an exact validated match.
- The outer review packet schema advances from v2 to v3 because it gains an
  optional nested field. Sources without native groups omit the field; v2
  packet fixtures remain valid only against their historical contract and are
  not silently reinterpreted as v3 packets.
