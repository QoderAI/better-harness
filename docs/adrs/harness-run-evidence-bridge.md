# Harness Run Evidence Bridge

## Traceability

- ADR ID: `ADR-0003`
- Status: Proposed
- Decision date: 2026-08-15
- Spec: [Harness as Code Architecture Hardening](../specs/2026-08-15-harness-as-code-architecture-hardening.md)

## Context

Harness as Code owns immutable configuration and execution evidence through
`HarnessRevision`, `MaterializationReceipt`, `HarnessRunEvent`, and persisted
compare artifacts. The Inspector already owns the provider-neutral historical
analysis contract `NormalizedToolActivityV1`. Merging those schemas would blur
configuration provenance, live event transport, and historical observation.

## Decision

- `packages/harness` remains the canonical owner of revisions,
  materialization receipts, run events, compare verdicts, and the on-disk
  harness evidence directory.
- `scripts/session-analysis` and `scripts/harness-inspector` remain the canonical
  owners of normalized historical activity and report projections.
- The bridge direction is one-way: persisted `trace.jsonl` harness events are
  ingested by the `harness-run` session adapter and normalized into
  `NormalizedToolActivityV1`. Inspector schemas never flow back into revision
  resolution or execution.
- A compare evidence directory is self-contained: variant directories retain
  the revision, resolution report, and materialization receipt; trial
  directories retain trace, runtime, sandbox, and permission receipts.
- `componentSnapshotRef` is an optional hashed cross-reference on a revision.
  It links configuration provenance to project inventory without merging the
  `HarnessRevision` and `HarnessComponentSnapshotV1` contracts.
- Studio uses live `HarnessRunEvent` transport while a run is active and reads
  the same persisted evidence directory for history. It does not own another
  persistence schema.

## Consequences

Harness runs can enter the existing Inspector evidence chain without inventing
a second report model. The adapter must map only facts retained in the trace;
missing timing, input, or tool-family evidence remains unobserved. Any future
evidence consumer must preserve the same owner and bridge direction.
