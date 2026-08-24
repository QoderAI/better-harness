# Checkpoint experiment example

One checkpoint, three lanes, two contrasts. This manifest shows the shape
`harness-experiment.v1` accepts and, deliberately, what it refuses to conclude.

- `history` is an `observed` lane. Its `identity` records only the harness id and
  model, so `evaluateObservedLane` reports `revisionId`, `profile`,
  `environmentReceipt`, and `promptHash` as missing. The lane is displayable
  context, not a matched baseline.
- `fresh-default` and `fresh-minimal` are `execute` lanes differing only in
  runtime profile, so `profile-effect` derives `axis: "runtime-profile"` and is
  attributable.
- `history-context` holds three lanes, so it is descriptive regardless of
  configuration. It exists to display the historical trajectory beside the fresh
  ones, not to decide anything.

No contrast declares an `axis` or a `mode`; both are derived from lane
configuration. A manifest that writes either field is rejected.

`checkpoint.json` here is a placeholder. A real experiment references a
`session-execution-plan-v1` document by path and digest.

`history/trajectory.jsonl` is a deterministic recorded ACP-style tool trace for
Studio's cross-lane Read → Edit → Test correlation demo. Studio replays it for
inspection; the observed lane is never executed.
