# Bootstrap

## Purpose

Use this domain for the 0 -> 1 move: a project that has no coding-agent harness
yet needs its first navigation, specification, validation, and risk routes. It
describes the shape of the artifacts a team should establish first; it does not
own instruction taxonomy, verification runtime, or repeated-work owner
selection.

## Best-Practice Baseline

An agent fails at the start of a task far more often than at the end of one. The
usual cause is not a weak model but an underspecified request: no scope, no data
contract, no rule ids, no acceptance boundary. Bootstrap therefore treats the
specification as the first harness asset, ahead of any tooling.

A specification is agent-executable when an implementer never has to guess. Each
behavior carries a stable id, each exception names the surfaced message and the
error code behind it, and each acceptance criterion states an observable
`Given / When / Then` a reviewer can run. Prefer one complete specification for
a narrow scope over a broad document that leaves every third decision open.

## Load When

- The user explicitly asks for initial coding-agent project guidance and the
  project has no established navigation, validation, or risk route.
- A requirement is about to enter implementation and its written form is not yet
  complete enough for an agent to build against.
- A team disagrees about what "the spec is done" means, or reviews keep
  rediscovering the same missing sections.
- A specification exists for one delivery surface and a second surface is being
  added.

## Owns

- `spec-structure.md`: the required specification sections, stable `BR-*`,
  `E-*`, and `AC-*` id schemes, per-surface repetition, traceability rules,
  completeness gates, and anti-patterns.
- `examples/README.md`: stack-specific calibration examples for a backend
  service, a frontend web console, and a mobile application.

## Does Not Own

- Agent instruction files, host asset taxonomy, or instruction quality; use
  `../agent-customize/routing.md` and `../agent-customize/agents-md-review.md`.
- Verification harness design, acceptance controls, observability, or recovery
  evidence; use `../project-harness/` and
  `../project-harness/agent-verify-loop.md`.
- Durable owner selection for repeated work; use `../loop-engineering/`.
- Support-track selection, finding eligibility, severity, or report authority.
  Those stay with the Better Harness skill and its findings gates.
- Design documents that describe an existing system. A specification states the
  intended behavior of a change; use `../project-harness/design-md-contract.md`
  for durable system design.

## Read Next

- Start with `spec-structure.md` whenever the question is what a complete
  specification must contain.
- Use `examples/README.md` after the contract is understood and a concrete
  section needs calibration against a comparable stack.
- Continue to `../agent-customize/routing.md` once the specification shape is
  settled and the project needs its instruction and asset owners.
- Continue to `../project-harness/agent-verify-loop.md` when acceptance criteria
  need an executable verification path rather than a written boundary.
