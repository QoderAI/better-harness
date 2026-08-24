# Architecture Decision Records

This directory contains repository-wide architecture decisions that refine the
accepted principles in [Architecture Principles](../ARCHITECTURE.md). Filenames
remain descriptive, lowercase, and stable. ADR IDs are stable navigation labels;
adding an ID does not rename an existing file or change its acceptance status.

The status in each ADR is canonical. This index is a discovery surface and must
be updated in the same change when an ADR is added, accepted, superseded, or
deprecated.

| ID | Decision | Status | Decision date | Scope |
| --- | --- | --- | --- | --- |
| `ADR-0001` | [AI-Optimized Directory Structure](directory-structure.md) | Proposed | 2026-07-16 | Directory ownership, artifact routing, migration gates, and target-directory activation |
| `ADR-0002` | [Developer Experience System](developer-experience-system.md) | Proposed | 2026-07-31 | Journeys, federated contracts, projections, native evidence, governance, support, and DX measurement |
| `ADR-0003` | [Harness Run Evidence Bridge](harness-run-evidence-bridge.md) | Proposed | 2026-08-15 | Harness revision and run evidence ingestion into the Inspector normalization chain |
| `ADR-0004` | [Harness Checkpoint Experiment Compare](harness-checkpoint-experiment-compare.md) | Proposed | 2026-08-17 | Checkpoint-anchored mixed-origin experiments, derived treatment axes, per-contrast verdicts, and the Studio experiment lifecycle |
| `ADR-0005` | [Checkpoint-backed Compare Sources and Materialization](checkpoint-backed-compare-sources.md) | Proposed | 2026-08-17 | Source-neutral checkpoint discovery, request provenance, adapter projections, and per-lane materialization |
| `ADR-0006` | [Session Notebook Trace and Outcome Projection](session-notebook-evidence-projection.md) | Proposed | 2026-08-18 | Ordered Turn evidence, response availability, evidence-bounded outcomes, and session-scoped patch requirements |
| `ADR-0007` | [Harness Studio Artifact Runtime and Provider Architecture](studio-artifact-runtime-and-providers.md) | Proposed | 2026-08-22 | Revision-bound data and code lifecycles, renderer surfaces, external providers, and retained trace boundaries |

## Lifecycle

- **Proposed:** complete enough for architecture review, but not yet an accepted
  repository rule.
- **Accepted:** explicitly approved after the ADR's validation gate passes.
- **Superseded:** replaced by another named ADR; historical context and links
  remain available.
- **Deprecated:** retained for context but no longer governs new work.

Implementation does not happen merely because an ADR is Accepted. Non-trivial
implementation slices still require the dated Spec, acceptance scenarios, test
evidence, risk review, and activation gates required by `AGENTS.md`.
