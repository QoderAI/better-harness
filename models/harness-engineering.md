# Harness Engineering

Harness Engineering is a supporting model for detailed repository
assessment. It answers:

```text
What agent work is this project fluent enough to support?
```

Use it under `software-fluency` when a report needs submetric-level
evidence, confidence calibration, or a clear work-radius judgment.

## Levels

| Level | Meaning    | Evidence boundary                                                       |
|-------|------------|-------------------------------------------------------------------------|
| F0    | Missing    | No usable evidence or only human memory.                                |
| F1    | Present    | A file, command, or rule exists, but quality and freshness are weak.    |
| F2    | Usable     | A normal agent can discover and use the capability with bounded effort. |
| F3    | Repeatable | The capability is documented, local, and repeatable across tasks.       |
| F4    | Enforced   | The capability is mechanically verified, automated, or governed.        |

## Internal Evidence Lenses

These are diagnostic lenses, not a second reader-facing scorecard. They answer
how the Harness is built; the default model answers five conventional software
capability questions.

| Internal evidence lens | What it inspects | Software capability it supports |
| --- | --- | --- |
| Context Fluency | Route, boundary, and risk context. | Context Map |
| Workbench Fluency | Stable commands, setup, tools, and permissions. | Environment Readiness |
| Feedback Fluency | Fast, actionable signals and repair paths. | Fast Feedback |
| Constraint Fluency | Mechanically enforced rules and policy. | Quality Gates |
| Operating Fluency | Review, acceptance, observability, and recovery. | Change Safety |

## Use With Harness Engineering

The sections below are the `harness-engineering` detector checklist. This model
converts those observations into F0-F4 fluency levels and visible work-radius
language. Use the dimensions and signal names below to merge supporting detector
signals without treating them as separate maturity scores.

## Reporting Rules

- Use this model as an evidence contract, not as a second independent maturity
  score, unless the user asks for a comparison.
- Keep branch protection, required checks, CI status, runtime health, and
  ownership claims marked `UNVERIFIED` unless directly inspected or provided.
- Reserve F4 for mechanical proof, not just well-written docs.

### Summary Contract

Evaluate whether the project lets an AI coding agent complete a bounded,
recoverable engineering loop: understand context, make a scoped change, choose
the right validation, diagnose failures, repair, re-run checks, and state
residual risk. Strong harness evidence is executable, repeatable, observable,
auditable, and portable across agents. Do not score a project highly for having
many docs or CI files unless those artifacts connect to actionable feedback and
mechanical guardrails.

This is not a general code quality review and not a README summary. Judge
whether the project lets an AI coding agent complete this loop in a real
repository:

```text
understand context -> make a bounded change -> choose the right validation ->
interpret failures -> repair -> re-run validation -> know whether residual risk
needs human review
```

Strong Harness Engineering is not "many docs" or "many CI files". It makes agent
work repeatable, verifiable, recoverable, and auditable.

#### 1. Context Map

Check whether an agent can quickly understand project boundaries, directory
structure, technology stack, task entrypoints, and risk areas.

Look for:

- Root-level agent instructions, contribution guides, architecture notes, or
  development guides.
- Entry documents that act as navigation maps instead of long, scattered
  encyclopedias.
- Guidance on which directories to inspect, which commands to run, and which
  areas to avoid for common changes.
- Clear separation between normal source code, generated code, schemas,
  migrations, fixtures, contracts, and release configuration.
- Paths, commands, and versions that match the repository's current state.
- Instructions that are not locked to one specific agent tool in ways that make
  reuse difficult for other agents.

Do not treat the presence of `AGENTS.md`, `CLAUDE.md`, Copilot instructions, or
a README as strong harness evidence by itself. They are context entrypoints; keep
checking whether they connect to executable feedback.

#### 2. Agent-Computer Interface

Check whether the project gives agents a clear, stable, low-ambiguity operating
surface.

Look for:

- Unified command entrypoints such as a Makefile, package scripts, bin wrappers,
  Gradle or Maven tasks, Rake tasks, justfile, or Taskfile.
- Focused tests that can run by scope instead of only full-suite validation.
- Setup doctors, preflight checks, environment checks, or dependency checks.
- Script names that communicate intent, such as `check`, `test:unit`,
  `test:e2e`, `lint`, `typecheck`, or `verify-generated`.
- Tool output that agents can read, including failure locations and next-step
  clues.
- Interactive, implicit, or experience-dependent steps that block automation.

#### 3. Fast Feedback

Check whether an agent can get a trustworthy red/green signal quickly after a
small change.

Look for:

- Low-cost smoke, lint, typecheck, unit, or focused tests.
- A way to choose the right command from the changed files.
- Distinct validation paths for small, medium-risk, and high-risk changes.
- Cases where slow full-stack Docker, full e2e, or remote CI is the only
  feedback.
- Flakiness, timeouts, excessive resource use, platform restrictions, or
  external dependencies that make feedback unreliable.
- Local commands that approximate key CI checks.

Slow e2e is not inherently bad. It becomes a problem when it is the only
feedback. A project with fast smoke checks, focused tests, and slower e2e layers
has stronger harness evidence.

#### 4. Layered Validation

Check whether validation layers progress from local to end-to-end and from cheap
to expensive.

Look for:

- Layered format, lint, typecheck, unit, contract, integration, e2e, visual
  regression, security, and release checks.
- Separate validation entrypoints for different stacks such as frontend,
  backend, mobile, infrastructure, docs, and generated code.
- Coverage of core business invariants, not just build success.
- Pass-to-pass and fail-to-pass regression validation.
- Compatibility checks for API, schema, protobuf, OpenAPI, or database
  migrations.
- Critical paths that can only be validated through manual QA.

Do not only count tests. The stronger signal is whether tests cover areas agents
commonly change, run quickly enough, and fail with locatable evidence.

#### 5. Mechanical Constraints

Check whether architecture, style, module boundaries, generated artifacts,
dependency direction, and domain rules can be captured by tools.

Look for:

- Linting, type systems, module boundary checks, dependency graphs,
  architecture tests, or static analysis.
- Generated-code consistency checks, golden files, snapshots, fixture
  regeneration, or schema diffs.
- Contract tests, API compatibility checks, or migration checks.
- Domain-specific verifiers such as DSL checkers, policy engines, or compiler
  and codegen golden tests.
- Security scanning, secret scanning, or dependency scanning.
- Rules that are only written in documentation and still rely on human review.

Do not treat a custom linter as the only standard. The key question is whether
the rule can be mechanically verified, not whether the tool is named "linter".

#### 6. Runtime, State, and Environment

Check whether an agent can reliably set up, start, reset, and observe the
project environment.

Look for:

- Pinned runtime versions for Node, Ruby, Python, Go, Java, Rust, or other
  stacks.
- Lockfiles, package-manager constraints, toolchain files, devcontainers,
  Dockerfiles, Nix, asdf, or mise.
- Deterministic seeds, fixtures, database reset, migration reset, and snapshot
  update policy.
- Requirements for secrets, private images, external SaaS, root, systemd,
  AppArmor, real cloud resources, or production data.
- Health checks, default configuration, example env files, mock services, or
  sandboxes.
- Cold-start steps that can be inferred and are not overly dependent on local
  machine state.

Docker Compose or a devcontainer is positive evidence, but it does not prove the
environment is reproducible. Also inspect state, secrets, health checks, seeds,
reset paths, and external dependencies.

#### 7. Failure Diagnosis and Observability

Check whether an agent can locate the problem after a failure and understand
runtime state.

Look for:

- Test failures with assertions, files, line numbers, and input/output diffs.
- Lint, typecheck, and architecture checks that name the violated rule and give
  repair direction.
- E2E artifacts such as screenshots, video, traces, DOM snapshots, or HTML
  reports.
- Structured service logs, health endpoints, debug endpoints, metrics, or
  traces.
- CI logs that are grouped, searchable, and traceable to the failing job and
  step.
- An auditable agent execution trace: commands, tool calls, outputs, file
  changes, and final evidence.

If failure only appears as a timeout, environment crash, noisy log dump, or
external service error, agents will struggle to recover reliably.

#### 8. CI, Review, and Governance

Check whether validation becomes a team-level gate instead of only advice for
local developers.

Look for:

- CI coverage for critical paths.
- Consistency between CI and local commands, or clear documentation of the
  differences.
- Which checks appear required and which are optional.
- Branch protection, repository-host ownership/review routing such as
  CODEOWNERS or approval rules, review policy, or merge queue evidence.
- Release gates, migration gates, or gates for security-sensitive changes.
- Flaky-test management, known failures, quarantine, or retry strategy.
- Whether the evidence is visible from the repository itself or requires
  platform permissions to confirm.

Workflow files do not prove required checks. In static analysis, mark these
conclusions as `UNVERIFIED`.

#### 9. Safety and Side Effects

Check whether agent actions are constrained to a controllable range.

Look for:

- Secret scanning, dependency scanning, SAST, or license checks.
- Default commands that connect to production services, real databases, real
  payments, real email, real notifications, or real cloud resources.
- Dry-run, rollback, approval, sandbox, or least-privilege mechanisms.
- Extra protection for migrations, deploys, data deletion, queue processing,
  cron, billing, auth, or permission-related operations.
- Prompt injection, tool injection, supply-chain, sensitive data disclosure, or
  unauthorized write risks.
- Guardrails around inputs, outputs, tool calls, or external actions.

Documentation that tells agents "do not do dangerous things" is not strong
harness evidence. Better harnesses make dangerous paths unreachable by default,
auditable, or explicitly approval-gated.

#### 10. Project-Type Calibration

Calibrate judgment by project type instead of applying one standard to every
repository.

Look for:

- Small libraries: API contracts, unit tests, type/lint checks, release
  packaging, and backward compatibility.
- Frontend applications: component tests, visual regression, accessibility,
  Playwright or Cypress, Storybook, screenshots, and traces.
- Backend services: API contracts, database migrations, integration tests,
  fixtures, observability, and local services.
- Multi-service systems: compose or dev environments, service contracts,
  seed/reset, network dependencies, and orchestration.
- System-level projects: platform permissions, kernel/systemd/root requirements,
  VM or spread tests, mockability, and local-vs-CI gaps.
- Codegen or DSL projects: golden files, generated diffs, compiler checks, and
  schema compatibility.
- Template projects: distinguish "easy for agents to edit" from "complete
  harness engineering maturity".

For large projects, split the judgment: code-level feedback may be strong while
runtime or integration support is weak. For small projects, avoid overrating
harness maturity just because the project is simple.

#### 11. Tool Portability

Check whether agent instructions are bound to a specific tool or portable across
agents.

Look for:

- Tool-neutral entry documentation.
- Cases where the only instructions are `CLAUDE.md`, `.cursor/rules`, Copilot
  instructions, Aider config, or a vendor-specific skill or prompt.
- Critical rules captured in the engineering toolchain instead of only in one
  agent prompt.
- Whether different agents can discover the same validation paths and risk
  boundaries.

#### 12. Report Confidence

Check the confidence of the report itself.

Look for:

- Specific file, script, CI configuration, and documentation paths.
- Clear separation between commands discovered as entrypoints and commands that
  were actually executed.
- Recorded uncertainty and items requiring human confirmation.
- Separation between project readiness and report evidence confidence.
- Avoiding model inferences presented as facts.

Static reports can still be valuable, but they must honestly state when commands
were not executed. Do not write conclusions such as "tests passed", "build
succeeded", or "CI required" unless they were verified.
