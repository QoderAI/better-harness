---
model_id: factory-readiness
aliases:
  - factory-agent-readiness
  - factory-ai
status: case-study-example
purpose: preserved Factory-style criteria library and benchmark alignment example
level_scale: l1-l5
dimension_set: factory-criteria-groups
evidence_sources:
  primary:
    - ai-readiness
  supporting:
    - agent-fluency
    - harness-engineering
dimension_projection:
  style-and-validation:
    ai-readiness: [style-validation]
    agent-fluency: [constraint-fluency]
    harness-engineering: [mechanical-constraints]
  build-system:
    ai-readiness: [build-system]
    agent-fluency: [workbench-fluency]
    harness-engineering: [agent-computer-interface]
  testing:
    ai-readiness: [testing]
    agent-fluency: [feedback-fluency]
    harness-engineering: [fast-feedback, layered-validation]
  documentation:
    ai-readiness: [documentation]
    agent-fluency: [context-fluency]
    harness-engineering: [context-map]
  dev-environment:
    ai-readiness: [dev-environment]
    agent-fluency: [workbench-fluency]
    harness-engineering: [runtime-state-environment]
  debugging-and-observability:
    ai-readiness: [debugging-observability]
    agent-fluency: [feedback-fluency]
    harness-engineering: [failure-diagnosis-observability]
  security-and-governance:
    ai-readiness: [security-governance]
    agent-fluency: [operating-fluency]
    harness-engineering: [ci-review-governance, safety-side-effects]
  task-discovery:
    ai-readiness: [task-discovery]
    agent-fluency: [context-fluency]
    harness-engineering: [project-type-calibration]
  product-and-experimentation:
    ai-readiness: [product-experimentation]
    agent-fluency: [operating-fluency]
    harness-engineering: [report-confidence]
component_profile:
  - criteria-coverage-table
  - evidence-ledger
  - benchmark-comparison
  - improvement-kata
embedded_evidence_contracts:
  - ai-readiness
---

# Factory Readiness Case Study

Factory Readiness is a preserved case study for machine-checkable evidence and
benchmark comparison. It is useful for broad scans, corpus alignment, criteria
coverage, and migration context, but it is not a selectable built-in model for
Better Harness Harness reports.

## Criteria Groups

| Group                       | Purpose                                                                      |
|-----------------------------|------------------------------------------------------------------------------|
| Style and Validation        | Keep low-level code quality and consistency mechanically checked.            |
| Build System                | Make build, dependency, release, and rollback paths discoverable and stable. |
| Testing                     | Provide runnable and isolated feedback.                                      |
| Documentation               | Turn implicit project knowledge into navigable evidence.                     |
| Dev Environment             | Make setup, secrets, services, and state reproducible.                       |
| Debugging and Observability | Help agents diagnose runtime and CI failures.                                |
| Security and Governance     | Keep agent changes inside reviewable safety boundaries.                      |
| Task Discovery              | Make issues, PRs, ownership, and priority legible.                           |
| Product and Experimentation | Connect product/runtime outcomes back to engineering work.                   |

## Level Use

| Level | Label        | Typical threshold                                                          |
|-------|--------------|----------------------------------------------------------------------------|
| L1    | Functional   | Basic structure, lockfiles, lint/type/test/build entrypoints.              |
| L2    | Documented   | Agent-readable setup, test, build, and contribution paths.                 |
| L3    | Standardized | Shared governance, security, CI, and structured logs.                      |
| L4    | Optimized    | Fast feedback, runtime signals, flaky management, metrics, runbooks.       |
| L5    | Autonomous   | Agent playbooks, self-verification, orchestration, automated repair loops. |

## Reporting Rules

- Use criteria groups to gather evidence, not to inflate maturity from keyword
  matches.
- Compare against benchmark data only when the corpus and method are named.
- Keep these criteria below the visible `software-fluency` story unless
  the user explicitly asks for Factory-style reporting.

## AI Readiness Evidence Contract

This section embeds the former standalone `ai-readiness` detector contract.
Use it as case-study reference material; do not route normal readiness reports
through it as a built-in model.

```yaml
detector_id: ai-readiness
purpose: broad criteria evidence for AI readiness and Factory-style benchmark alignment
level_scale: l1-l5
evidence_fields:
  - path
  - command
  - observation
  - confidence
  - executed
primary_models:
  - factory-readiness
supporting_models:
  - software-fluency
outputs:
  - signal_id: style-validation
    maps_to: [quality-gates]
  - signal_id: build-system
    maps_to: [environment, safe-change]
  - signal_id: testing
    maps_to: [fast-feedback]
  - signal_id: documentation
    maps_to: [context-map]
  - signal_id: dev-environment
    maps_to: [environment]
  - signal_id: debugging-observability
    maps_to: [fast-feedback, safe-change]
  - signal_id: security-governance
    maps_to: [quality-gates, safe-change]
  - signal_id: task-discovery
    maps_to: [context-map, safe-change]
  - signal_id: product-experimentation
    maps_to: [safe-change, adaptive-engineering-loop]
```

### Detector Overview

| Pillar | Goal | Typical signals |
| --- | --- | --- |
| Style and Validation | Help agents catch low-level errors before submission. | linter, formatter, type checker, pre-commit, complexity, dead code, duplicate code, module boundary |
| Build System | Help agents understand how to build and ship reliably. | build command documented, single command setup, pinned dependencies, monorepo tooling, release automation, rollback, feature flag, dependency hygiene |
| Testing | Give agents a runnable feedback loop. | unit tests, integration/E2E tests, tests runnable locally, coverage thresholds, test isolation, flaky test detection, test duration tracking |
| Documentation | Make implicit knowledge explicit. | README, AGENTS.md, architecture notes, service flow, API schema, docs freshness, docs generation, run instruction validation |
| Dev Environment | Give agents a reproducible environment. | devcontainer, Docker Compose, env example, local services, database migration/schema, sandbox profile |
| Debugging and Observability | Help agents locate runtime problems. | structured logs, health checks, metrics, distributed tracing, error tracking, profiling, alerting, runbooks |
| Security and Governance | Let agents move quickly inside safety boundaries. | CODEOWNERS or host-native ownership/approval rules, branch protection, secret scanning, SAST/DAST, dependency updates, secrets management, PII/log scrubbing |
| Task Discovery | Help agents find, understand, and break down tasks. | issue template, label taxonomy, PR template, backlog health, ownership, severity/priority rules |
| Product and Experimentation | Help agents judge whether changes create value. | product analytics, feature flags, experiment infrastructure, error-to-insight, impact dashboard, usage instrumentation |

| Level | Label | What agents can do | Typical threshold |
| --- | --- | --- | --- |
| L1 | Functional | Understand the basic structure, make small changes, and run basic checks. | README, locked dependencies, lint, type check, unit test, build command |
| L2 | Documented | Follow documentation to complete local development, testing, and PR work. | AGENTS.md, setup/test/build docs, devcontainer, env template, PR/issue template |
| L3 | Standardized | Work inside shared rules and safety boundaries. | branch protection, CODEOWNERS or host-native ownership/approval rules, secret scanning, dependency updates, CI required checks, structured logs |
| L4 | Optimized | Iterate through fast feedback and runtime signals. | fast CI, flaky test detection, coverage threshold, DORA metrics, tracing, metrics, runbooks, error tracking |
| L5 | Autonomous | Break down tasks, execute, validate, release, observe, roll back, or submit fix PRs. | agent playbook, automated repair, task orchestration, experiment platform, error-to-issue, automated docs sync, self-verification eval set |

| Group | Focus | Why it matters for AI readiness |
| --- | --- | --- |
| Style and Validation | Static code quality, formatting, types, complexity, duplicate/dead code, naming, and technical debt. | Determines whether agent changes are quickly constrained by tools instead of bringing bad structure, weak types, or inconsistent style into the codebase. |
| Build System | Build entrypoints, dependencies, CI feedback, release, feature flags, rollback, and monorepo tooling. | Determines whether agents can build the project reliably and understand the path from local development to delivery. |
| Testing | Unit and integration tests, test runnability, isolation, coverage, flakiness, and performance. | Determines whether agents can use tests for trustworthy feedback instead of relying only on human review or remote CI. |
| Documentation | README, agent instructions, API docs, generated docs, docs freshness, and flow diagrams. | Determines whether agents can quickly understand the project, find entrypoints, discover commands, and avoid dangerous areas. |
| Dev Environment | Local environment, devcontainer, env templates, database schema, and local services. | Determines whether agents can create a reproducible workbench instead of depending on local machine state and implicit experience. |
| Debugging and Observability | Logs, health checks, metrics, tracing, profiling, alerts, and runbooks. | Determines whether agents or engineers can locate failures, observe system state, and understand runtime behavior. |
| Security | CODEOWNERS or host-native ownership/approval rules, branch protection, security scanning, dependency updates, secrets, PII, and log redaction. | Determines whether agent changes are constrained by safety and audit mechanisms that prevent leaks and high-risk releases. |
| Task Discovery | Issue and PR templates, labels, and backlog health. | Determines whether agents can understand task sources, task types, priorities, and PR expectations. |
| Product and Analytics | Product analytics and error-to-task loops. | Determines whether production behavior and errors can become executable engineering work. |

Security governance should recognize host-native ownership/approval rules. The
absence of `.github/CODEOWNERS` alone is not a gap for non-GitHub repositories
when equivalent host review routing is visible.

### 1. Style and Validation

**Goal**: Determine whether the codebase has enough mechanical static
constraints to correct agents quickly while they modify code.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `code_modularization` | Whether module, package, or architecture boundaries prevent agents from adding arbitrary cross-layer dependencies. | `internal/` directories, Bazel/Gradle module rules, dependency-cruiser, eslint boundaries, ArchUnit, custom import rules. |
| `cyclomatic_complexity` | Whether function or method complexity is detected so agents do not keep piling on branches. | gocyclo, cyclop, ESLint complexity, radon, lizard, Sonar complexity rules. |
| `dead_code_detection` | Whether unused code is detected so agents do not add or retain dead paths. | staticcheck, ruff, knip, ts-prune, vulture, deadcode, compiler unused checks. |
| `duplicate_code_detection` | Whether duplicate code is detected so agents do not spread copy-pasted logic. | jscpd, PMD CPD, Sonar duplication, clone detectors. |
| `formatter` | Whether a standard formatter keeps agent output stylistically stable. | Prettier, Black, Ruff formatter, gofmt, rustfmt, clang-format, biome. |
| `large_file_detection` | Whether oversized files or binaries are blocked from accidental agent commits. | Git LFS, pre-commit file size hook, CI large file check, `.gitattributes`. |
| `lint_config` | Whether lint rules catch common errors, bad patterns, and style issues. | ESLint, golangci-lint, Ruff, Pylint, Clippy, SwiftLint, Rubocop. |
| `n_plus_one_detection` | Whether ORM/database N+1 query risks can be detected. | Bullet, Django Debug Toolbar checks, query count assertions, ORM performance lints. |
| `naming_consistency` | Whether naming rules or guidance reduce inconsistent names generated by agents. | lint naming rules, language conventions, contribution guides, API naming docs. |
| `pre_commit_hooks` | Whether basic checks run before commit and give earlier feedback to agents or developers. | Husky, lefthook, pre-commit, git hooks, lint-staged. |
| `strict_typing` | Whether strict typing reduces weak types or implicit `any` generated by agents. | TypeScript strict, mypy strict, pyright, Go/Rust/Swift type systems, Java nullability checks. |
| `tech_debt_tracking` | Whether TODO/FIXME or technical debt formats are mechanically tracked. | TODO scanners, FIXME linters, ticket ID enforcement, debt dashboards. |
| `type_check` | Whether type checks can find type errors independently from tests. | `tsc --noEmit`, mypy, pyright, go test compile, cargo check, javac/maven compile. |

### 2. Build System

**Goal**: Determine whether agents can use stable entrypoints to build, verify
dependencies, understand CI feedback, and stay governed through release paths.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `agentic_development` | Whether the project has traces or configuration for agent collaboration. | `.claude/skills`, `.factory/skills`, agent docs, Co-authored-by, bot-assisted workflow. |
| `automated_pr_review` | Whether automated PR review or policy checks help agent changes get early review. | Danger, CodeQL comments, review bots, policy bots, automated checklist comments. |
| `build_cmd_doc` | Whether build commands are documented so agents do not guess how to build. | README, CONTRIBUTING, AGENTS/CLAUDE docs, Makefile/justfile notes. |
| `build_performance_tracking` | Whether build duration is tracked so agents are not forced into slow feedback. | CI timing, build cache metrics, Bazel remote cache stats, workflow duration dashboards. |
| `dead_feature_flag_detection` | Whether stale feature flags are detected so agents do not maintain dead branches. | LaunchDarkly stale flag checks, custom flag scanners, CI flag audit. |
| `deployment_frequency` | Whether deployment or release cadence is observable and shows an active delivery path. | GitHub releases, release workflows, deployment history, tags. |
| `deps_pinned` | Whether dependency versions are locked for reproducible local and CI results. | lockfiles, go.sum, Cargo.lock, pnpm-lock, requirements locks, toolchain pins. |
| `fast_ci_feedback` | Whether CI can return core signals quickly enough for agent iteration. | PR required checks, workflow timing, layered quick checks. |
| `feature_flag_infrastructure` | Whether feature flags support safer progressive delivery. | LaunchDarkly, Statsig, Unleash, internal flag systems, cluster settings. |
| `heavy_dependency_detection` | Whether heavy dependencies or bundle size regressions are detected. | bundle analyzer, size-limit, dependency size checks, cargo bloat, webpack stats CI. |
| `monorepo_tooling` | Whether a monorepo has task orchestration and affected-scope calculation. | Nx, Turborepo, Bazel, Pants, Rush, pnpm workspace scripts. |
| `progressive_rollout` | Whether progressive release reduces the risk of agent changes going directly to all users. | canary, blue/green, feature flag rollout, progressive delivery controller. |
| `release_automation` | Whether release automation reduces manual release risk. | release workflows, semantic-release, goreleaser, changesets, release-please. |
| `release_notes_automation` | Whether release notes are generated or checked automatically to preserve change context. | changesets, release-please, GitHub release drafter, commit conventions. |
| `rollback_automation` | Whether an automatic or explicit rollback path exists. | rollback workflow, helm rollback, deployment rollback docs, release revert automation. |
| `single_command_setup` | Whether one command can complete setup/check/doctor so agents can become productive quickly. | `make setup`, `./dev doctor`, `pnpm install && pnpm check`, bootstrap scripts. |
| `unused_dependencies_detection` | Whether unused dependencies are detected to avoid long-term pollution from agent changes. | depcheck, knip, cargo-machete, go mod tidy CI, unused dependency bots. |
| `vcs_cli_tools` | Whether version-control or platform CLIs support automated repo state and metadata checks. | `gh` CLI, authenticated GitHub CLI, git commands, release/issue API checks. |
| `version_drift_detection` | Whether drift across multiple version declarations is detected. | docs vs toolchain checks, package version sync, monorepo version consistency scripts. |

### 3. Testing

**Goal**: Determine whether agents can get trustworthy test feedback after a
change and locate failures.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `flaky_test_detection` | Whether flaky tests are identified or managed so agents are not misled by unstable signals. | flaky trackers, rerun strategy, quarantine lists, stress/repeat tests. |
| `integration_tests_exist` | Whether tests cover cross-module, service, API, database, or end-to-end behavior. | integration test dirs, compose-backed tests, API tests, Playwright/Cypress, roachtest. |
| `test_coverage_thresholds` | Whether coverage thresholds or reports prevent hollow test suites. | coverage config, Codecov, nyc thresholds, pytest coverage fail-under, go coverage CI. |
| `test_isolation` | Whether tests are isolated, parallelizable, or repeatable with less local state influence. | temp dirs, fixtures, parallel tests, transaction rollback, mock services. |
| `test_naming_conventions` | Whether test file naming is consistent enough for agents to find and add tests. | `*_test.go`, `.test.ts`, `test_*.py`, spec naming docs. |
| `test_performance_tracking` | Whether test duration is tracked to preserve fast feedback. | slow test reports, pytest durations, gotestsum timing, CI timing artifacts. |
| `unit_tests_exist` | Whether unit tests exist for small-scope quick validation. | test files, unit test dirs, framework config. |
| `unit_tests_runnable` | Whether a clear command can run unit tests, not just test files. | `make test-unit`, `npm test`, `pytest`, `go test ./...`, focused test docs. |

### 4. Documentation

**Goal**: Determine whether agents can understand project structure, commands,
risk areas, and API or workflow context.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `agents_md` | Whether there is an agent-facing entry document. | `AGENTS.md`, `CLAUDE.md`, Copilot instructions, `.cursor/rules`. |
| `agents_md_validation` | Whether commands and paths in agent docs are validated to reduce drift. | docs command CI, markdown command tests, doctor script, generated agent docs. |
| `api_schema_docs` | Whether API/schema information is machine-readable or easy to inspect. | OpenAPI, GraphQL schema, protobuf docs, typed client docs, SQL protocol docs. |
| `automated_doc_generation` | Whether docs can be generated from code or schemas to reduce hand-written drift. | doc generation scripts, typedoc, sphinx autoapi, protobuf doc generation, OpenAPI generation. |
| `documentation_freshness` | Whether docs have been updated recently enough to reduce stale guidance risk. | git log freshness, recent commits touching README/docs/agent docs. |
| `readme` | Whether a basic README provides a project entrypoint. | root README with setup, usage, and architecture links. |
| `service_flow_documented` | Whether key service flows or architecture flows are documented. | architecture diagrams, PlantUML, sequence diagrams, RFCs, service docs. |
| `skills` | Whether reusable task skills or workflow descriptions help agents perform common tasks. | `.claude/skills`, `.factory/skills`, agent skill Markdown, workflow playbooks. |

### 5. Dev Environment

**Goal**: Determine whether agents can set up and reset local environments,
especially services, databases, and environment variables.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `database_schema` | Whether the project has explicit database schema or migrations. | migrations, ORM models, schema.sql, Prisma schema, SeaORM entities. |
| `devcontainer` | Whether there is a standard containerized development environment. | `.devcontainer/devcontainer.json`, Dockerfile for development. |
| `devcontainer_runnable` | Whether the devcontainer is not just present but runnable. | CI validates devcontainer, documented successful startup, devcontainer CLI checks. |
| `env_template` | Whether an environment variable template prevents agents from guessing secrets or config. | `.env.example`, sample config, documented env vars. |
| `local_services_setup` | Whether local dependency services can be started. | docker-compose, localstack, testcontainers, service scripts, mock server. |

### 6. Debugging and Observability

**Goal**: Determine whether failures expose enough information to locate
problems, especially in runtime services.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `alerting_configured` | Whether alert rules or alerting config exists. | Prometheus alerts, Alertmanager, Datadog monitors, PagerDuty integration. |
| `circuit_breakers` | Whether circuit breakers protect against cascading dependency failures. | resilience libraries, retry plus breaker config, service mesh breaker policies. |
| `code_quality_metrics` | Whether code quality or coverage metrics are collected. | coverage dashboards, Sonar, CodeClimate, quality gates. |
| `deployment_observability` | Whether versions, state, and metrics are observable after deployment. | deployment dashboards, release metrics, Grafana dashboards, deployment annotations. |
| `distributed_tracing` | Whether cross-service traces are supported. | OpenTelemetry, Jaeger, Zipkin, Datadog tracing. |
| `error_tracking_contextualized` | Whether error tracking includes useful context. | Sentry, Bugsnag, Rollbar, error grouping with release/user/context. |
| `health_checks` | Whether services expose health, readiness, or liveness endpoints. | `/health`, readiness probes, liveness checks, status endpoints. |
| `metrics_collection` | Whether runtime metrics are collected. | Prometheus metrics, StatsD, Datadog metrics, custom telemetry. |
| `profiling_instrumentation` | Whether performance or resource profiling is supported. | pprof, CPU/heap profiler, runtime profiling endpoints, flamegraphs. |
| `runbooks_documented` | Whether common failures have runbooks. | runbooks directory, incident docs, on-call playbooks, troubleshooting guides. |
| `structured_logging` | Whether logs are structured for agent/tool search and diagnosis. | JSON logs, zap, logrus structured fields, tracing IDs, request IDs. |

### 7. Security

**Goal**: Determine whether agent changes are constrained by safety governance,
permissions, scanning, and data protection.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `automated_security_review` | Whether automated security review or security bots exist. | CodeQL alerts, security review workflows, policy bots, SAST comments. |
| `branch_protection` | Whether protected branches prevent agents from bypassing checks. | GitHub branch protection, GitLab protected branches, host rulesets, required reviews/checks. |
| `codeowners` | Whether repository-host ownership metadata provides responsibility and review routing. | `.github/CODEOWNERS`, GitLab CODEOWNERS, approval rules, or host-native ownership/review routing. The absence of `.github/CODEOWNERS` alone is not a finding for non-GitHub repositories. |
| `dast_scanning` | Whether dynamic application security testing exists. | OWASP ZAP, DAST workflow, web scanner CI. |
| `dependency_update_automation` | Whether dependencies are updated automatically to reduce long-term supply-chain risk. | Dependabot, Renovate, Snyk PRs. |
| `gitignore_comprehensive` | Whether local secrets, build artifacts, and IDE noise are ignored. | `.gitignore` covering `.env`, build dirs, OS/IDE files. |
| `log_scrubbing` | Whether logs have redaction mechanisms. | redaction helpers, safe logging APIs, PII scrubbers, secret filters. |
| `pii_handling` | Whether PII is labeled, handled, or protected. | privacy models, data classification, PII redaction, safe value wrappers. |
| `privacy_compliance` | Whether privacy compliance materials or mechanisms exist. | GDPR docs, privacy policy, data retention, consent tracking. |
| `secret_scanning` | Whether secret scanning is enabled. | GitHub secret scanning, gitleaks, trufflehog, pre-commit secret hooks. |
| `secrets_management` | Whether secrets are managed instead of hard-coded. | Vault, cloud secret managers, sealed secrets, env var docs. |

### 8. Task Discovery

**Goal**: Determine whether tasks are structured enough for agents to understand
task type, context, and PR expectations.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `backlog_health` | Whether issue backlog items have understandable titles, labels, and maintenance state. | issue title quality, labels, staleness, triage state. |
| `issue_labeling_system` | Whether labels are used consistently. | type/priority/area labels, release labels, component labels. |
| `issue_templates` | Whether issue templates reduce missing requirement details. | bug report, feature request, config.yml, forms. |
| `pr_templates` | Whether PR templates help agents provide context, testing notes, and risk notes. | pull request template, checklist, testing section, release note section. |

### 9. Product and Analytics

**Goal**: Determine whether production behavior and errors can become
engineering feedback instead of stopping at logs or user complaints.

| Criterion | Meaning | Typical evidence |
| --- | --- | --- |
| `error_to_insight_pipeline` | Whether production errors can be grouped, attributed, or turned into issues automatically. | Sentry-GitHub issue creation, error triage automation, incident-to-ticket workflow. |
| `product_analytics_instrumentation` | Whether product behavior analytics help evaluate change impact. | PostHog, Amplitude, Mixpanel, GA4, Statsig events, telemetry events. |
