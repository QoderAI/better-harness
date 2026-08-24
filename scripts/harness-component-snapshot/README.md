# Harness Component Snapshot

This capability owns the read-only `HarnessComponentSnapshotV1` contract for
the first LC-02 slice. It snapshots project-owned Qoder Rules, Skills, Hooks,
Commands, and Workflows as stable identities and privacy-safe revisions.

The public import surface is `index.mjs`. Each direct CLI operation writes one
JSON document to stdout; global and leaf `--help` return help text without
reading a workspace:

```text
node scripts/harness-component-snapshot/cli.mjs create --workspace . --provider qoder
node scripts/harness-component-snapshot/cli.mjs create --workspace <relocated-clone> --population-key <opaque-project-key>
node scripts/harness-component-snapshot/cli.mjs validate --snapshot before.json
node scripts/harness-component-snapshot/cli.mjs diff --before before.json --after after.json --limit 200
node scripts/harness-component-snapshot/cli.mjs resolve --snapshot before.json --reference <reference>
```

`resolve` only proves that an exact component revision exists in the supplied
valid snapshot. Its result always sets `mutationAuthorized` to `false`; this
capability neither stores source bodies nor restores files.

`diff` counts always describe every component, while `entries` is bounded by
`--limit`. Entries list `changed`, `added`, and `removed` before `unchanged`, so
a small limit truncates redundant unchanged entries rather than the actual
differences; `truncated` and `totalEntries` report what was dropped.

Without `--population-key`, the population reference is a privacy-safe digest
of the canonical workspace boundary, so two unrelated workspaces cannot be
cross-diffed accidentally. Use the same opaque key only when two locations are
known to represent the same project population. The key itself is never emitted.

The contract, acceptance scenarios, privacy boundary, and lifecycle-control
plane separation are recorded in
[Freeze Project Harness Components for Qoder](../../docs/specs/2026-08-02-harness-component-snapshot-v1.md).
