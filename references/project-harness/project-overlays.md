# Agent Work Loop Project Overlays

Use this reference after Agent Work Loop is selected and the reviewed task scope
identifies a concrete project shape. An overlay adds relevant evidence sources
or stricter project-owned gates to the existing fifteen checks. It never adds a
dimension or check, weakens a model condition, or turns a project type into a
finding.

## Select only inspected overlays

Open the task target, canonical architecture owner, manifests, and generated or
delivery boundaries before selecting an overlay. Combine overlays when the task
crosses project shapes, but keep each piece of evidence mapped to the narrowest
Agent Work Loop check.

| Project shape | Evidence additions to inspect |
| --- | --- |
| Library or SDK | Public API and type compatibility, package contents, clean-consumer import, supported runtime matrix, release impact, and rollback. |
| Frontend or visual application | Applicable root `DESIGN.md`, component behavior, accessibility, browser or page errors, responsive states, screenshot review, and focused E2E. |
| Backend or multi-service system | API and schema contracts, fixtures and reset, health, correlated diagnostics, dependency failure, partial recovery, and cleanup. |
| Generator, DSL, or schema owner | Canonical source ownership, regeneration, golden drift, compatibility, generated-file boundaries, and clean-checkout reproduction. |
| Infrastructure, migration, release, or external automation | Plan or dry-run, least privilege, explicit approval, audit evidence, rollback or restore, and external-state confirmation. |
| Documentation, template, or plugin package | Link graph, schema or manifest checks, packaging, clean install and discovery, example currency, and preview or render validation. |

Project-owned instructions and validators outrank this generic routing. When an
expected source is unavailable, retain `Unobserved` or the precise access
boundary; do not infer a missing capability from the overlay alone.

## Map additions to the model

- Intent, canonical owner, design context, and generated-source selection map
  to **Task Understanding**.
- Startup, clean-consumer use, tool entrypoints, permissions, and cleanup map to
  **Controlled Execution**.
- Focused behavior, compatibility, accessibility, diagnostics, regeneration,
  and preview checks map to **Change Validation**.
- Review, CI, release, external-state confirmation, approval, and recovery map
  to **Reliable Delivery**.
- Repeated overlay gaps, reusable procedures, and scheduled freshness checks
  map to **Learning Capture** only after its evidence gates are satisfied.
