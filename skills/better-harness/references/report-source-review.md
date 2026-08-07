# Report Source Review

Use this maintainer route only when the task needs the deterministic Harness
report source to pass through a reviewable local decision boundary before
projection. It is not a substitute for the ordinary evidence-bundle and
renderer workflow.

Create the source, then freeze its bounded review packet and create-only
decision template:

```text
<cli> harness source --workspace <target> --source <run-dir>/report.source.json --language <locale>
<cli> harness source-review create --source <run-dir>/report.source.json --packet <run-dir>/review.packet.json --decision <run-dir>/lead.decision.json --json
```

Edit only the generated template's `decision` object. Fill
`sourceCandidate.evidenceRefs` and `readerOverview`; retain every generated
framework, check, capability, and score row; add a summary and exact outer
packet evidence to each row; and assign each score, confidence, reason, and
reader summary. Keep packet aliases opaque and local.

For every generated native group, choose exactly one `match` or `abstain`.
A match copies the group's exact Episode refs, selects evidence aliases owned
by every Episode, and uses only supported pattern/reason codes. An abstention
omits `patternId` and keeps Episode/evidence arrays empty. The template omits
optional Episode and delivery mutations; copy an item from `optionalShapes`
into `decision.episodeReviews` or `decision.deliveryReviews` only when that
evidence is being reviewed. The command does not call a model or choose a
decision.

Compile the caller-authored decision, then explicitly confirm source
replacement:

```text
<cli> harness source-review decision --source <run-dir>/report.source.json --packet <run-dir>/review.packet.json --decision <run-dir>/lead.decision.json --review <run-dir>/review.json --json
<cli> harness source-review apply --source <run-dir>/report.source.json --packet <run-dir>/review.packet.json --review <run-dir>/review.json --yes --json
```

Stop on any non-zero status. Do not repair a stale packet, missing native
decision, or digest mismatch by editing generated packet or review JSON. Re-run
`create` from the current source and author a fresh decision. The apply phase is
the only phase that replaces the source, and it requires `--yes`.

After a successful apply, project the reviewed source through its existing
owner:

```text
<cli> harness task-loop-report --source <run-dir>/report.source.json --findings <run-dir>/findings.json --json
```
