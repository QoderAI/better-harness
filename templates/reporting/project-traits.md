# Project Traits

## Contract

Classify one bounded context by two independent axes:

- **Application surface**: `Touchpoint`, `Process`, or `Core`
- **Evolution cadence**: `Run`, `Deliver`, or `Explore`

Use the smallest meaningful unit available: deployable, package, module,
bounded context, or repo. The matrix is MECE only for the primary trait; record
clear overlaps as secondary traits.

## Axis Definitions

### Surface

- **Touchpoint**: UI, content, portals, forms, dashboards, or interaction flows.
  Primary risk is user confusion or task failure.
- **Process**: workflows, state transitions, roles, approvals, exceptions, or
  handoffs. Primary risk is state or coordination failure.
- **Core**: foundational or enabling capability: critical rules, money,
  permissions, security, platform APIs, data, SDKs, runtimes, infra, CI/CD, or
  observability. Primary risk is contract, correctness, reliability, or reuse.

### Cadence

- **Run**: preserve existing behavior. Signals: maintenance, fixes, support,
  hardening, incident stabilization, or deprecation.
- **Deliver**: ship known roadmap work. Signals: features, integrations,
  migrations, refactors, or incremental improvement.
- **Explore**: validate uncertainty. Signals: hypotheses, pilots, A/B tests,
  prototypes, model tuning, or unknown acceptance criteria.

## Classification Rules

- Classify surface and cadence separately, then combine them.
- If UI supports a workflow, choose `Process` unless user comprehension is the
  main risk.
- If workflow touches money, permissions, security, critical data, platform
  contracts, infra, or SDK/runtime compatibility, choose `Core`.
- If UI exposes a platform or developer capability, choose `Core` and keep
  `Touchpoint` as secondary.
- Omit secondary traits when the unit fits a single cell without ambiguity.
- Choose `Run` for preservation, stabilization, or sunset work; add a qualifier
  such as `incident` or `deprecation` when needed.
- Choose `Deliver` for known work, including intentional refactors that ship
  structural change on a known plan. Choose `Explore` when rules, metrics, or
  acceptance criteria are still being discovered.
- Confidence: `high` when both axes have strong unambiguous signals; `medium`
  when one axis is ambiguous or evidence is thin; `low` when both axes are
  unclear.

## Trait Index

| Code | Trait              | Common Signals                                         |
|------|--------------------|--------------------------------------------------------|
| TR   | Touchpoint Run     | stable sites, docs, help centers, knowledge portals    |
| TD   | Touchpoint Deliver | admin consoles, customer portals, forms, mobile apps   |
| TX   | Touchpoint Explore | campaign pages, growth experiments, experience tests   |
| PR   | Process Run        | ticketing, approvals, ITSM, recurring operations       |
| PD   | Process Deliver    | order fulfillment, supply chain, BPM, MES workflows    |
| PX   | Process Explore    | pilot workflows, new operations, business prototypes   |
| CR   | Core Run           | payments, billing, IAM, CI/CD, observability, SDKs     |
| CD   | Core Deliver       | data platforms, gateways, rule engines, open platforms |
| CX   | Core Explore       | AI agents, search, recommendation, pricing strategies  |

## Output Shape

```json
{
  "classificationUnit": "module",
  "primaryTrait": "PD",
  "secondaryTraits": ["TD"],
  "confidence": "medium",
  "qualifiers": [],
  "evidence": [
    "workflow state and exception handling dominate the code structure",
    "regular feature delivery appears in recent change patterns",
    "admin UI exists but mainly supports the process"
  ]
}
```
