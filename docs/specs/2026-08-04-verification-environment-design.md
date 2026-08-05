# Verification environment design guidance

## Traceability

- Spec ID: verification-environment-design
- Status: Implemented

## Intent

Add a companion reference for `references/project-harness/agent-verify-loop.md`
that teaches an AI coding agent how to discover, construct, and calibrate the
smallest trustworthy test environment when the real environment is unavailable,
unsafe, expensive, or too slow. The guidance must make substitution a
claim-driven decision: keep the system under test and the behavior needed by
the verification claim real, replace only explicit boundaries, and preserve
honest evidence gaps rather than treating a convenient mock as proof of the
real system.

The reference will be grounded in read-only `qodercli -p` studies across
different repositories under `/Users/phodal/eval/harness` plus primary
documentation and research on hermetic environments, service virtualization,
contract verification, ephemeral real dependencies, browser isolation, and
coding-agent evaluation environments.

## Acceptance Scenarios

- **VED-AC-1 (discovery before construction):** The reference tells an agent
  to inventory repository-owned setup commands, fixtures, fakes, emulators,
  containers, contract tests, CI services, and existing test seams before
  inventing a new environment.
- **VED-AC-2 (explicit environment contract):** The reference defines a
  durable environment contract that records the verification claim, system
  under test, dependency boundary, real-versus-substituted decisions, pinned
  versions and inputs, start/readiness/reset/stop commands, isolation rules,
  supported platforms, collected evidence, and known fidelity gaps.
- **VED-AC-3 (fidelity by claim):** The selection rules distinguish in-process
  doubles, protocol/service virtualizers, emulators, ephemeral real
  dependencies, and sandbox/staging checks. A dependency stays real whenever
  its semantics are part of the claim; an unavailable required boundary yields
  `blocked` or `unobserved`, not a mock-backed `pass`.
- **VED-AC-4 (progressive bootstrap):** The construction loop starts with one
  tracer-bullet case and progresses from cheap deterministic checks to higher
  fidelity only where the claim requires it; every level has a runnable
  readiness probe, reset path, bounded execution, and machine-readable verdict.
- **VED-AC-5 (independent oracle):** The environment is not accepted merely
  because an AI-authored test passes. It must have an oracle derived from an
  existing contract, reviewed fixture/baseline, provider verification, or
  externally observed invariant, plus a negative control that proves the
  harness fails when the relevant behavior is broken.
- **VED-AC-6 (drift and calibration):** Recorded or generated substitutes carry
  provenance and freshness metadata, and are periodically calibrated against a
  real provider, contract-verification job, or authorized sandbox observation.
  Calibration gaps remain visible.
- **VED-AC-7 (safety and portability):** The default environment uses no
  production credentials or unsanitized production data, constrains network
  and filesystem effects, cleans up deterministically, and avoids
  platform-specific paths or shell assumptions so Windows, macOS, and Linux
  remain supported.
- **VED-AC-8 (cross-stack evidence):** The reference includes a compact set of
  evidence-qualified patterns derived from at least three materially different
  repositories, and labels repository observations separately from general
  design inference.
- **VED-AC-9 (routing and link integrity):**
  `references/project-harness/agent-verify-loop.md` routes environment-bootstrap
  questions to the new reference, the project-harness index registers it, all
  relative Markdown links resolve, and the routing graph is current.

## Non-goals

- Build a generic mock server, container runtime, fixture generator, or test
  orchestration CLI.
- Promise that a mock, emulator, container, or local clone proves production
  behavior, performance, concurrency, security, or vendor-specific semantics.
- Prescribe one vendor or framework across all stacks; concrete tools are
  evidence-backed examples of a substitution class.
- Run or modify repositories under `/Users/phodal/eval/harness`; those targets
  are read-only research inputs for this change.
- Change report schemas, scoring models, hooks, templates, or host adapters.

## Plan and Tasks

1. Inspect the existing Agent Verify Loop ownership and routing, and preserve
   unrelated local changes.
2. Run bounded, read-only `qodercli -p` studies over contrasting repositories
   under `/Users/phodal/eval/harness`, using one stable output schema.
3. Review primary sources for reproducible coding-agent environments,
   hermetic isolation, service virtualization, contract verification,
   ephemeral real dependencies, and UI isolation.
4. Add `references/project-harness/verification-environment.md` with the
   discovery procedure, environment contract, substitution decision rules,
   fidelity ladder, oracle/sensitivity checks, calibration policy, safety
   boundary, cross-stack patterns, and anti-patterns.
5. Route `agent-verify-loop.md` and `references/project-harness/README.md` to
   the new reference without expanding unrelated owner surfaces.
6. Regenerate the documentation routing graph, run focused link/model tests,
   run the full suite, and complete a Review Readiness Check over the local
   diff.

## Test and Review Evidence

- Four bounded `qodercli 1.1.12 -p` studies completed against
  `braintree-web`, `delve`, `sample-spring-microservices-transactions`, and
  `nimara-ecommerce`. The prompts allowed only read/search tools and prohibited
  edits, installs, network access, service startup, and test execution.
- Primary-source review covered SWE-bench/SWE-agent execution environments,
  Testcontainers, Pact provider verification, WireMock service virtualization,
  Playwright isolation, and Docker version/digest pinning.
- `node --test test/doc-link-graph.test.mjs test/maturity-models.test.mjs` —
  9/9 passed after regenerating `docs/better-harness-doc-links.mmd`.
- `npm test` — 1149/1149 passed, with zero failures and zero skips.
- `git diff --check` — passed before the final readiness review.

- VED-AC-8: retain the four Qoder reports in command output and cite exact
  repository paths in the reference; treat missing or conflicting evidence as
  `unobserved`.
- VED-AC-1..VED-AC-7: manual contract review against the reference headings,
  decision tables, example manifest, and anti-pattern list.
- VED-AC-9: `node scripts/doc-link-graph/cli.mjs skills/better-harness`, then
  `node --test test/doc-link-graph.test.mjs`.
- Consumer integrity: `node --test test/maturity-models.test.mjs`.
- Repository regression gate: `npm test`.
- Final hygiene: `git diff --check` and a Review Readiness Check that separates
  this change from the pre-existing Agent Verify Loop work in the dirty tree.

## Risks

- **False confidence:** an AI may choose the easiest double and silently
  overstate fidelity. Mitigate with claim-first selection, explicit gaps, and
  `blocked/unobserved` verdicts.
- **Self-validating tests:** the same agent can encode its implementation bug in
  the test oracle. Mitigate with independent sources and a negative control.
- **Mock drift:** recorded responses and hand-built fakes age. Mitigate with
  provenance, expiry/calibration metadata, and provider verification.
- **Overfitting:** four repositories cannot prove a universal taxonomy.
  Separate observed examples from the cross-stack inference and keep the
  decision model open-ended.
- **Portability:** container-first advice can exclude hosts without a container
  runtime. Define containers as one fidelity option, not the universal base.
