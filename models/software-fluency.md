# Software Fluency

**Software Fluency** owns the traditional software-engineering question: what
repository capabilities are strong enough to support reliable agent work?

## Uses

- **Standalone static scan:** when the user explicitly requests a repository-only
  or static score, Software Fluency owns the visible scored output.
- **Quick-scan lens:** the project Harness subagent reads Software Fluency to
  find bounded project engineering problems using the tighter quick-scan owner
  limit.
- **Agent Work Loop engineering walkthrough:** when Agent Work Loop is active, inspect the
  same five project capabilities without producing Software Fluency scores or a
  second taxonomy. Record concrete repository strengths and problems in the
  reviewed Agent Work Loop evidence packet, then map them to its five questions.

During that walkthrough, each capability review may return zero or more
concrete candidate findings with a natural title, concrete user cost and cause,
expected outcome, repair artifact and outputs, dimension links, and repository
evidence. In an Agent Work Loop report, the lead reconciles these
project-subagent candidates with the session evidence subagent and authors every
retained row in the final `findings.json`. Finding count, capability status,
severity, artifact vocabulary, prose patterns, and output count do not decide
eligibility in JavaScript. Multiple independent findings from one capability
remain independent, and a High issue stays High when the evidence supports it.

A low score, `Present`, `Wired`, `Unobserved`, inventory count, or generic
recommendation is not a finding by itself. That is an evidence-discipline rule
for the reviewing Agent, not a projection filter: the Agent must explain the
concrete problem and cite the bounded evidence, while JavaScript retains only
structural, privacy, link, and rendering validation.

In all uses, the Agent must open the owning files and commands. Generated
inventory and `report.source.json` are evidence maps, not substitutes for this
walkthrough.

## Trigger Is Not Evidence

Recurring agent errors, repeated user corrections, skipped review, setup
failure, or validation failure are good reasons to inspect Software Fluency.
They are not Software Fluency scores. Score only opened repository evidence:
guidance, setup/run paths, feedback checks, enforced quality rules, and safe
acceptance or delivery mechanisms.

For “the agent repeatedly skipped review,” keep the claims separate. Linked
session episodes may show that review was not observed; Software Fluency may
show whether review guidance, executable review checks, and acceptance gates
exist. Neither alone proves whether the agent, user, task, or repository caused
the pattern. When the repetition instead points to Skills, MCPs, plugins,
instructions, or Hooks, route to Customization Checkup; when it points to task
behaviour, route to Agent Work Loop.

## Required Problem Signals

Apply dimension-scoped problem signals before projecting the ladder or the five
project capabilities; the detailed checks live under each capability section so the
broken handoff has one clear owner (for example, capability-overload gaps belong to
Context Map). Report triggered signals as natural readiness problems, not minor
caveats, using direct labels such as `validation not observed`, `agent guidance lacks
an execution loop`, `change assurance exists but enforcement is unverified`, or
`evidence boundary blocks the judgement`. Keep them readable even when the output
style has no numeric scores.

## Natural Recommendation Families

Natural recommendation families for `software-fluency`. Consolidate
repeated findings into reader-facing problems, not score formulas, detector ids,
or visible category labels. These families are model-owned, not score formulas.
Prefer the family closest to the broken handoff:
Context Map -> Environment Readiness -> Fast Feedback -> Quality Gates ->
Change Safety.

| Family | Use when evidence shows... | Primary capability |
| --- | --- | --- |
| Agent entrypoint and task route | Missing compact entrypoint, command map, task scope, risk route, or deeper guidance links. | Context Map |
| Agent customization evidence | Inspected Rules, Hooks, Skills, Custom Agents, MCP, Plugins, or `references/agent-customize/` evidence shows missing content quality, execution proof, source boundaries, or overloaded current capability menus. | Context Map |
| Loop-engineering lifecycle | Repeated work, session friction, schedule candidates, or `references/loop-engineering/` evidence shows no trigger, state, validation path, safety boundary, stop condition, or selected owner. | Change Safety |
| Agent lifecycle guardrails | Agent runtime hooks, Git hooks, permissions, sandboxing, Stop gates, or evidence requirements are absent, unobserved, or confused with prompt guidance. Hooks are strongest when they make lifecycle decisions, not when they merely exist. | Change Safety |
| Test surface and feedback proof | Tests, coverage, focused commands, failure artifacts, duration, or change-to-check routing are missing or too generic. | Fast Feedback |
| Artifact route integrity | Docs, scripts, plans, generated assets, config paths, or workflow references are missing, stale, or unchecked as navigation or source-of-truth routes. | Context Map |
| Artifact enforcement integrity | Generated assets, schema outputs, lockfiles, migrations, or design-contract artifacts are referenced but not checked for drift or regeneration. | Quality Gates |
| Environment Readiness reproducibility | Runtime pins, package manager, dependency access, service or resource declarations, fixtures, cache, reset flow, sandbox/container path, network/web access assumptions, credential templates, diagnostic logs, doctor repair hints, or platform limits are not reproducible. | Environment Readiness |
| Security rule enforcement | Security scans, secret hygiene, dependency checks, auth lint, or SQL/XSS rules are absent, unopened, optional, or not blocking relevant changes. | Quality Gates |
| Agent permission boundary | Agent tool allowlists, automation permissions, production credential isolation, sandboxing, or least privilege are absent, unopened, or too broad. | Change Safety |
| Merge acceptance path | The route that takes a current change into the default/base branch is absent, unopened, or confused with post-merge automation. GitHub Actions, GitLab CI, Aone CI, Jenkins, CircleCI, and similar platforms are examples, not defaults; do not prescribe host-specific paths unless evidence names that host. | Change Safety |
| Side-effect and recovery boundary | Release automation, production access, destructive commands, credentials, or external writes are reachable without dry-run, approval, rollback, audit, sandbox, or least-privilege evidence. | Change Safety |
| Risk-path acceptance controls | High-risk paths, concrete changed files, or agent-completed work lack acceptance-time hooks, validation, approval rules, evidence capture, or escalation boundaries. | Change Safety |
| Plan-execute-verify phase gates | Agent workflows collapse planning, execution, and verification into one generate-and-check pass, or lack plan acceptance criteria, execution/tool-call bounds, pre-execution checks, and plan-alignment verification. | Change Safety |
| Agent workflow lifecycle | Agent loops lack retry cap, allowed tools, validation path, stop condition, or escalation owner after Loop Engineering selects the missing owner. | Change Safety |

## AI Readiness Ladder

| Level | Label | Human-AI collaboration | SDLC coverage | Engineering harness | Governance and quality | Context engineering |
| --- | --- | --- | --- | --- | --- | --- |
| L1 | Awareness | Humans ask; AI answers. | Information lookup, explanation, snippets. | Isolated chat or ad hoc tools. | Manual review. | Single-turn context. |
| L2 | Assisted Coding | Human-led coding with AI completion. | Coding, debugging, basic unit tests. | IDE plugin or basic CLI integration. | Lint/format/test plus manual anti-hallucination review. | File or tab-level context. |
| L3 | Structured AI Coding | Humans define scoped tasks and specs. | Refactor, scaffold, test generation, CI feedback. | Agent workflow plus repeatable local or CI feedback. | Static checks, test gates, and documented review boundaries. | Repo search, work-item/session memory, reusable instructions. |
| L4 | Spec-Governed Agent Delivery | Humans shape goals as specs/tasks; agents work through reusable skills, rules, or specialist workflows. | Spec-to-implementation-to-validation delivery enters scope. | Spec artifacts, repeated agent workflows, and validation gates are connected. | Mechanical constraints plus review and validation contracts. | Progressive disclosure, spec records, session-backed workflow reuse, and durable knowledge. |
| L5 | Closed-Loop Agent Delivery | Humans focus on leverage while agent workflows self-verify and improve. | End-to-end bug reproduction, fix, validation, review, release, and repair loops are observed. | High-throughput subagent loops with self-verification and repair. | Continuous cleanup, risk governance, autonomous review cycles, and feedback into rules/specs/tests. | Self-maintained project memory and knowledge evolution backed by observed sessions. |

## Five Project Capabilities for Agent-Ready Engineering

| Dimension              | Core Question                                                                          | Typical Evidence                                                                                                                                 | Evolution Goal                                                        |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| **Context Map**       | Can the agent follow the task to the right context, boundary, risk area, and next step? | README, AGENTS.md, architecture map, risk map, domain map, task routes, deeper-context links                                                  | From scattered context to validated progressive disclosure            |
| **Environment Readiness**     | Can the agent enter a versioned, bounded, diagnosable environment and get the project running without guessing?   | Setup scripts, package scripts, lockfiles, environment templates, service/resource declarations, dev containers or sandboxes, network/credential templates, reset flows, doctor checks, diagnostic logs | From machine-specific environments to reproducible, diagnosable operating environments |
| **Fast Feedback**    | After the agent makes a change, do lint, tests, and similar checks quickly return actionable feedback on that change?      | Linting, type checks, unit tests, focused tests, smoke tests, affected-scope checks, clear failure output                                        | From slow full-suite feedback to change-aware fast feedback paths     |
| **Quality Gates**     | Are architecture, security, schema, migration, generated-drift, and design rules enforced by mechanisms? | Architecture tests, schema/API diffs, generated-code drift checks, security scans, migration linting, design-token contracts for visual projects | From rules on paper to quality gates that preserve invariants         |
| **Change Safety**   | Can agent-produced changes be constrained at runtime, checked before acceptance, and prevented from unsafe side effects or uncontrolled delivery? | Agent lifecycle hooks, permission or sandbox rules, review-trigger or Stop hooks, merge acceptance paths, required validation, approval flows, release gates, rollback docs, audit trails | From human trust to hook-backed, pre-merge delivery assurance        |

## Evidence Routing and Score Discipline

Do not score by simply averaging every observed detail. Route evidence to one
primary capability first, then apply confidence and blockers before naming the
ladder posture.

1. **Capability Score**: score each of the five capabilities independently from
   the three submetrics under that capability.
2. **Evidence Confidence**: distinguish inspected, observed, and declared-only
   evidence. Named files, badges, workflow labels, or agent summaries reduce
   confidence until their source or result is opened.
3. **Blocker Override**: aggregate blockers cap the headline posture even when
   other capabilities look strong.

L5 evidence may be satisfied by instrumented or automated observation, not only human session transcripts: opened CI records, cache or affected-check logs, audit trails, and generated artifacts count as observed. Treat instrumented observation as equivalent to a watched session.

Evidence ownership:

- Environment Readiness owns setup/install, run/start, reset/clean/doctor,
  runtime/service/resource/network/credential discovery, environment health
  checks, and diagnostics for setup or run failures. Permission decisions,
  approval, and production access boundaries belong to Change Safety.
- Fast Feedback owns test, lint, typecheck, focused test, smoke, and E2E
  commands: they must exist, run quickly, fail actionably, and map to changes.
- Change Safety owns agent lifecycle guardrails, merge acceptance, and
  side-effect or recovery boundaries for agent-produced changes. Do not require
  a specific repository host, change-request model, protected-branch setting, or
  queue-based acceptance gate unless inspected evidence shows that is the
  repository-host workflow.
- Context Map owns whether risk is explained and routed. Risk
  areas are connected to explicit check routes and responsible references;
  mechanical enforcement belongs to Quality Gates, and approval policy belongs
  to Change Safety.
- Quality Gates owns rule execution such as SAST, secret scan, dependency scan, auth lint, and SQL/XSS rules.
- Change Safety owns agent permission, production credential isolation, dangerous
  command confirmation, sandboxing, and least privilege.
- Git hooks and Agent hooks route by what they decide. Fast local lint/test
  feedback belongs to Fast Feedback; mechanical rule enforcement belongs to
  Quality Gates; lifecycle decisions that ask, block, require evidence, gate
  Stop, protect a change before merge, or deny dangerous tools, credentials,
  production access, external writes, or release operations belong to Change
  Safety. For Change Safety, Agent lifecycle hooks usually carry more weight than
  PR/MR presence because they sit closer to tool use, file edits, and task
  completion; static hook configuration still needs policy content, tests,
  observed runtime, or a backstop before it proves enforcement.
- Reliability-oriented effectiveness metrics may support L5 claims only when
  observed or instrumented: task resolution rate, pass@1, rework or churn after
  agent changes, verification tax, constraint effect from constrained versus
  unconstrained runs, and defect escape rate. Do not use lines accepted, prompt
  count, suggestion count, or raw generated-code volume as primary readiness
  proof.

Follow-up workflow:

- After scoring and recommendation-family routing, pass low-score and stale artifact-route findings through the existing follow-up gates before final actions. A headline Readiness score `< 50`, or `AI Readiness` fallback `< 50`, uses the low-score follow-up gate. Stale docs, scripts, plans, config paths, or workflow references route first as Artifact route integrity; only repeated or schedulable staleness with stable input, cadence or trigger, validation, risk boundary, and stop condition becomes a Loop Discovery `schedule-ready` outcome.
- Emit `/schedule` only as a row-scoped `Schedule follow-up` on the concrete finding, with the harness command, cadence or trigger, validation, risk/safety, acceptance check, and stop condition. If those slots are missing, keep the action as verify, investigate, or `needs more evidence`, not a generic recurring reassessment.

Blocker examples:

- With no observable validation, do not project beyond L2 / Assisted readiness.
- With no agent lifecycle guardrail or merge acceptance path where delivery governance is in scope, do not project into L4 governed delivery.
- With many commands but no inspected test surface, describe the repo as command-rich, not feedback-ready.
- With agent docs but no execution loop, credit Context Map, not Agent Delivery.
- With release automation but no review or security evidence, do not call the project governed; call it not governed delivery.

Aggregate posture blockers (apply before naming ladder posture):

- **When several high-impact surfaces are unverified**: if validation results, required checks, acceptance controls, security scanning, release rollback, or migration/design-contract gates are unverified at once, read the posture as `declaration-heavy` or `evidence-limited`, not broadly ready. Do not let a long strengths list average away repeated `not observed`, `not inspected`, `unverified`, and `absent` signals.
- **Check breadth before density**: strong build scripts, release workflows, or agent docs do not compensate for empty or uninspected feedback, observability, security/assurance, task-discovery, or product/runtime evidence; when several work-cycle areas are blank, describe a narrow harness island, not end-to-end readiness.
- **Claim structured agent delivery only with connected evidence**: claim it only when opened evidence connects the route from context flow, to execution path, to validation signal, to at least one rule or review mechanism. With no opened pre-merge validation path and no inspected test surface, describe documented or assisted work with unproven feedback, and avoid phrases such as `upper L3` or `isolated L4 signals`. After-acceptance or release-only test steps do not satisfy this merge acceptance blocker. When a blocker applies, Context Map or Environment Readiness strengths may appear as strongest evidence but must not drive the headline posture.
- **Escalate low-readiness when blockers coincide with blank areas**: with no inspected test surface, no security scan, no change-acceptance control, review/evidence route, task discovery, observability, or product/runtime feedback, call the posture low-readiness and loop-incomplete; avoid `well-instrumented harness` or `high L2/low L3` framing for a command-rich project whose delivery loop is mostly uninspected.
- **Treat generic hosted validation as necessary but not sufficient evidence**: GitHub Actions, GitLab CI, Aone CI, Jenkins, CircleCI, or another platform running lint, tests, or security scans on proposed changes is a real signal, but must not dominate when agent-readable routing, task discovery, change-acceptance controls, development environment, source/test surface, observability, agent lifecycle guardrails, and release safety are mostly absent or uninspected; describe a conventional validation island instead.
- **Reserve middle-readiness conventional harness language**: a conventional harness stays middle-readiness only when opened evidence spans pre-merge lint/test, integration or coverage, pinned dependencies, and a plausible release or security path; the validation-island language is for narrow generic hosted checks only, and never applies when the visible validation is only post-merge/release workflow plus bypassable local hooks and unopened test surfaces.

### Dimension 1: Context Map

**Core question**: Can an agent follow a task to the right context, boundary,
risk area, and next step without relying on verbal context from a human?

#### Problem Signals

- **Agent guidance stands alone**: `AGENTS.md`, skills, templates, prompts, MCP/plugin manifests, or
  Qoder/Codex settings help only when their content is inspected and connected to concrete workflows,
  acceptance checks, or validation habits; otherwise this is a Context Map gap without
  an execution loop.
- **Current capability menu overload**: when the current model-visible context
  exposes more than 20 tools, more than 30 MCP tools, or more than 50 Skills,
  report a High-impact Context Map problem. Treat this as task-routing and
  progressive-disclosure debt, not a neutral inventory detail; do not wait for
  runtime execution failure to report it.
- **Treat rich agent instructions as navigation evidence only**: long or policy-heavy root instructions
  are context debt when they replace a short route into scoped docs, checks, owners, and stop
  conditions; treat them as navigation evidence until connected to a runnable feedback loop.
- **Treat conventional project harnesses fairly**: a repo may satisfy Environment Readiness,
  Fast Feedback, or Quality Gates through Makefiles, manifests, CI definitions, and test
  frameworks even without `AGENTS.md`; keep the missing agent entrypoint as a
  Context Map gap instead of collapsing the whole readiness judgement.
- **Do not require explicit AI-agent workflows for conventional harness credit**: Missing agent-specific review, prompts, or session loops is a Context
  Map and adoption gap, not a reason to erase strong conventional engineering evidence.
- **Rules loading semantics are missing**: rules files, `AGENTS.md`, `CLAUDE.md`,
  Cursor rules, Copilot instructions, Qoder/Codex rules, or Augment-style rules
  are stronger when the runtime or docs state whether they always load, load
  when agent-requested, or load only manually, and how parent/child rules
  compose. Without that loading route, treat the asset as Context Map evidence,
  not deterministic enforcement.
- **Tiered behavior boundaries are absent**: Always / Ask First / Never style
  guidance helps agents know what to do automatically, what needs approval, and
  what is forbidden. Missing tiers are Context Map routing debt; mechanical
  blocking belongs to Quality Gates or Change Safety permission boundaries.

#### Submetric 1.1: Task Entrypoint

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No agent entrypoint, or only a generic README that does not consider agent reading paths. | No `AGENTS.md`, `CLAUDE.md`, copilot instructions, or equivalent file. |
| L2 | Agent guidance exists but is stale, tool-bound, or too long to function as a route. | Only `.cursor/rules` exists, content is more than 150 lines, or paths and commands do not match the repo. |
| L3 | A short navigation-style entrypoint stands alone and points to the common task path. | 80-150 line entrypoint with project positioning, directory route, command pointers, high-risk areas, and deeper links. |
| L4 | Progressive disclosure routes agents into spec, issue, execution-plan, skill, or domain documents with explicit when-to-load rules. | Links to `.qoder/specs`, `docs/exec-plans`, `docs/issues`, ADRs, project skills, or domain references and explains when to use them. |
| L5 | Entrypoint freshness and routing improve from observed work. | Session evidence, automation, or CI updates specs, skills, rules, or quality/risk maps after repeated failures or workflow patterns. |

#### Submetric 1.2: Context & Boundary Map

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No map of project structure, domain boundaries, or responsibility boundaries. | Agents must traverse the entire repository to infer shape. |
| L2 | A simple directory list exists but does not explain responsibility. | README lists `src/`, `tests/`, or `docs/` without when-to-inspect guidance. |
| L3 | Top-level directories and major subsystems have clear responsibilities and agent attention guidance. | Directory table explains what each area owns and where agents should start. |
| L4 | Source, generated files, schemas, migrations, fixtures, and configuration are distinguished. | Docs identify generated files, files that require generator updates, and files that should not be hand-edited. |
| L5 | Domain map, responsibility map, dependency graph, or impact map supports impact-based routing. | Architecture diagrams, domain boundary docs, dependency graphs, or change-impact maps. |

#### Submetric 1.3: Risk & Next-Step Route

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No risk or task route. | No high-risk areas, task scope guide, or validation route. |
| L2 | Vague warnings such as "be careful" or "pay attention to safety". | Generic warnings without concrete files, operations, or task routes. |
| L3 | High-risk areas and common task routes are explicitly listed. | "What NOT To Do", "High Risk Areas", or task-route section for migrations, auth, billing, generated code, or production operations. |
| L4 | Risk and task routes point to relevant checks without claiming those checks are enforced. | "When changing X, run Y" mapping or linked check route. |
| L5 | Risk areas are connected to explicit check routes and responsible references. | Route names the check path and the responsible team, role, doc, or escalation reference. |

Do not give Context Map extra credit for mechanical rules, approval
policy, or protected delivery settings. Those belong to Quality Gates and Safe
Change.

### Dimension 2: Environment Readiness

**Core question**: Can an agent enter a versioned, bounded, diagnosable
operating environment and get the project running—setup, run, reset, doctor,
and resource discovery—without guessing, interaction, or implicit environment
knowledge?

Environment Readiness applies environment engineering as platform engineering
for agent work: evaluate whether runtime, resources, services, network
assumptions, credential templates, setup feedback, and isolation are explicit,
versioned, and diagnosable. Tool authorization, human approval, least
privilege, production access, and side-effect boundaries remain Change Safety;
post-change validation failures remain Fast Feedback.

#### Problem Signals

- **Implicit environment dependencies**: services, ports, network/web access,
  private registries, credential templates, fixtures, and system packages that
  exist only in local machine state or oral knowledge are Environment Readiness
  gaps; do not let agents infer them from ecosystem defaults.
- **Undiagnosable setup or run failures**: setup/run/doctor commands that return
  generic errors without health checks, logs, traces, or repair hints force
  agents into exploration instead of task execution.
- **Unbounded resource exposure**: read-only resources, side-effecting resources,
  compute-expensive actions, and external services need discoverable scope,
  cost/latency/impact, and read/write semantics. Environment Readiness owns
  missing resource declarations; Change Safety owns permission and side-effect
  risk.
- **Workflow environments are not separated**: planning, implementation,
  validation, and release workflows may need different resources, write access,
  and runtime assumptions. If one undifferentiated environment mixes
  exploration, edits, and side effects, record the environment-layering gap here
  and route approvals or denials to Change Safety.
- **Sparse checkout or inaccessible runtime paths block judgement**: sparse checkout, partial clone,
  missing generated artifacts, or inaccessible runtime paths constrain the evidence boundary; state
  the boundary and reduce confidence instead of filling gaps with project reputation or ecosystem
  assumptions.
- **Partial evidence bundles**: when evidence is partial, do not turn unopened named files into
  absence claims. If a README, badge, contributing guide, or workflow comment references a core setup,
  CI, release, or security path that was not opened, call it `not inspected`, reduce confidence, and
  avoid collapsing a conventional harness to ad hoc readiness solely because the file was omitted from
  the evidence bundle.
- **Soften aggregate blockers when the core validation path is named**: a badge, contributing guide,
  or workflow reference to an external CI system is `not inspected`, not absent. Lower confidence and
  say evidence-limited conventional harness instead of treating the project as low-readiness solely
  because the bundle omitted the core CI.
- **Promote a conventional harness only with opened cross-path evidence**: opened setup, feedback, and
  at least one rule or assurance mechanism can justify conventional harness credit. Without
  agent-readable routing, present it as a strong engineering
  harness with an agent-readability gap, not as spec-governed agent delivery.

#### Submetric 2.1: Environment Readiness Entry

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No runtime pinning, dependency access path, or environment/resource contract; setup depends on oral knowledge or local machine state. | No lockfile, runtime pin, system dependency list, service/port declaration, `.env.example`, registry note, or credential template. |
| L2 | Basic dependency and environment declarations exist but services, network, credentials, or platform assumptions remain implicit. | Lockfile, `.env.example`, or package manager is present, but registry access, system packages, ports, or external services require manual inference. |
| L3 | Runtime version, package manager, lockfile, dependency access, required services, and credential template are explicit. | `.nvmrc` plus `packageManager`, `go.mod`, `Gemfile.lock`, `.env.example`, service list, port list, or equivalent one-command dependency setup. |
| L4 | Versioned cache, container, devcontainer, compose, Nix, or mise path makes setup repeatable across supported machines. | `.devcontainer/`, Docker Compose, Nix, mise, or CI/local cache with documented service health checks and network assumptions. |
| L5 | Per-worktree, per-task, sandboxed, or prebuilt setup lets agent tasks start independently without cross-task pollution. | Isolated ports, services, databases, caches, credentials, network policy, and cleanup policy; cold start to working state is under two minutes or prebuilt. |

#### Submetric 2.2: Run & Doctor Command Surface

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Setup, run, reset, and doctor commands are missing, scattered, contradictory, or require interactive manual assembly. | The same operation is written differently across README, CI, and scripts, or fails without hidden prompts. |
| L2 | Basic command entrypoints exist but common operations and failure diagnosis still require manual assembly. | Some package scripts, Make targets, or Taskfile tasks exist, but no single route names setup, run, reset, health, and repair. |
| L3 | One command surface covers setup/install, run/start, reset/clean/doctor, and basic resource health checks. | `make setup`, `npm run dev`, `make clean`, `make doctor`, health check endpoint, service probe, or equivalent. |
| L4 | Commands are named by intent, documented by help output, cross-platform, and return actionable setup/run errors. | `make help`, `npm run doctor`, `task --list`, cross-platform scripts, port/service checks, and repair hints. |
| L5 | Commands include preflight, dry-run, self-diagnosis, logs/traces, and model-friendly repair guidance for agent use. | Doctor command checks runtime, ports, services, credentials, network access, caches, and common repair steps with concise failure output. |

Validation commands are not scored here. Test, lint, typecheck, focused test,
smoke, E2E, and post-change runtime assertions belong to Fast Feedback. Setup,
run, doctor, service health, and environment diagnostics stay here.

#### Submetric 2.3: State Reset & Isolation

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No state or resource lifecycle management; tests and local runs depend on real external data, shared services, or manual preparation. | No seed, fixture, reset command, service reset, cache cleanup, or data boundary. |
| L2 | Basic fixtures, sample data, environment templates, or read-only resource notes exist. | `fixtures/`, `.env.example`, sample database, static data dump, or read-only resource prose exists. |
| L3 | Explicit state and resource reset commands exist for database reset, seed, cache cleanup, service cleanup, or workspace cleanup. | `make reset-db`, `npm run db:seed`, `make clean`, compose teardown target, cache cleanup, or equivalent. |
| L4 | Fixtures are deterministic, read/write semantics are clear, snapshot update policy is documented, and local runs are isolated from shared external state. | Versioned fixtures, documented snapshot update flow, read-only data sources, isolated state, and teardown notes. |
| L5 | State and resource lifecycle is automated: create, use, validate environment health, and clean up from a known state. | testcontainers, per-test databases, per-task containers, automatic seed plus teardown, or resource lifecycle logs. |

### Dimension 3: Fast Feedback

**Core question**: After the agent makes a change, do lint, test, typecheck,
smoke, affected-check, or runtime checks quickly return actionable feedback?

#### Problem Signals

- **Validation is declared but not observed**: package scripts, CI/CD YAML, hooks, README commands, and
  issue templates do not prove that build, test, lint, typecheck, release, runtime, or UI checks
  passed; only executed results count as feedback evidence.
- **A model or agent second opinion is treated as validation**: `qodercli -p`, Codex, Claude, or
  another reviewer can challenge judgement, but cannot replace executed project commands, CI results,
  runtime evidence, or reviewer-visible artifact checks.
- **Static evidence conflicts with observed behavior**: prefer the executed command, validator result,
  runtime error, generated artifact, or opened file over a README claim or model summary.
- **Treat dense command inventories as intent, not closure**: package scripts, Make targets, CI/CD YAML
  such as GitHub Actions workflows, `.gitlab-ci.yml` or `.gitlab-ci.yaml`,
  `.aoneci/*.yml` or `.aoneci/*.yaml`, Jenkinsfile, or CircleCI config,
  pre-commit hooks, and release workflows may support Environment Readiness or Fast Feedback
  capability, but they must not lift conclusions unless observed run evidence or opened test surfaces
  show what is checked.
- **Separate command shells from validation evidence**: a script named `test`, `lint`, `build`, or a
  document that tells agents to run it proves a runnable entrypoint only; it does not prove testing
  or feedback depth unless the underlying test files, configs, workflow steps, or results were opened
  and show what is checked.
- **Treat local Git hooks as early feedback, not complete change assurance**: Husky, lint-staged, pre-commit, or
  pre-push hooks can be bypassed and must not stand in for required review or protected merge
  evidence unless an observed required gate or unbypassable policy enforces them.

#### Submetric 3.1: Validation Signal Layers

Behavior-level checks such as contract, integration, E2E, component, browser,
or runtime smoke tests count as validation layers when they are runnable and
produce inspectable artifacts.

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No automated validation, or only manual QA. | No test, no lint, no CI. |
| L2 | Single validation path, such as only `npm test` for the full suite. | Tests exist but cannot be selected by scope. |
| L3 | Fast and slow paths are separated: lint/typecheck/unit plus integration/E2E/CI. | Docs or commands explicitly separate fast and full validation. |
| L4 | Three or more layers are mapped to task/spec delivery and agents can choose the right layer. | `test:fast`, `test:unit`, `test:integration`, `test:e2e`, or equivalent layers exist, and specs/AGENTS/session evidence maps changes to those checks. |
| L5 | Validation layers evolve with delivery: all relevant layers run, emit inspectable artifacts, and the layer strategy is updated as new surfaces ship. | Layer coverage map, contract/integration/E2E artifacts kept in sync with new features, or documented additions of validation layers over time. |

#### Submetric 3.2: Signal Speed & Actionability

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No local validation or behavior check; agents can only wait for remote CI or manual QA. | No locally runnable check command. |
| L2 | Local validation exists but is slow, remote-only for key behavior, or emits raw log walls. | Full lint plus test takes more than five minutes, or failures are only stack traces. |
| L3 | Fast path under two minutes exists and failures identify file, line, rule, or failing behavior. | Lint/typecheck/focused test output is localizable. |
| L4 | Frequent small changes have a smoke path under 30 seconds, and failures include repair direction or artifacts. | Single-file test, diff lint, Playwright screenshot, trace, or "run make format" repair hint. |
| L5 | Incremental caching or warm reuse keeps feedback near-instant even as the repo grows. | Nx/Bazel/Turbo cache, persistent test or dev servers, or warm watch-mode feedback observed during agent work. |

#### Submetric 3.3: Affected Check Routing

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Agents cannot tell what to validate after a change. | No mapping documentation. |
| L2 | Docs only say "run tests after changes". | Generic instruction with no segmentation. |
| L3 | Validation path is documented by area, such as frontend vs backend. | Entrypoint includes area-to-command mapping. |
| L4 | Validation is automatically routed by file type or directory. | GitHub Actions, GitLab CI, Aone CI, Jenkins, CircleCI, or another CI/CD surface uses path filters, changed-file logic, or pipeline rules. |
| L5 | Agents can query a dependency graph to get impact scope and minimum checks. | Nx affected, bazel query, or custom impact analysis. |

### Dimension 4: Quality Gates

**Core question**: Are architecture, security, schema, migration,
generated-drift, and design-contract rules enforced by mechanisms rather than
convention?

#### Problem Signals

- **Constraint or security evidence named but not opened**: file presence, workflow names, or a
  rule / scan / architecture / schema / migration / generated-artifact / design-contract reference
  proves existence only; it stays a Quality Gates gap until the source, result, or blocking
  behavior is opened and inspected.
- **Constraint exists but enforcement is unverified**: documented rules, scan names, migration gates,
  generated-artifact checks, or design-contract gates are useful leads, but they remain unverified
  until opened evidence shows that the rule actually blocks, alerts, or requires repair.
- **Local hooks treated as enforcement mechanisms**: hooks such as Husky, lint-staged, or pre-commit
  can be bypassed and must not stand in for mechanically enforced required gates; treat them as
  optional early checks unless observed required-gate evidence confirms enforcement.
- **Guardrail suppression is unchecked**: hard gates are weakened when agents can
  add inline disables such as `eslint-disable`, `# noqa`, `// @ts-ignore`,
  scanner ignore comments, warning-only lint rules, or unchecked exception
  lists. Credit suppression paths only when evidence shows they are blocked,
  audited, require approval, or fail CI for relevant changes.

#### Submetric 4.1: Rule Coverage

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Important rules are neither declared nor checked. | No architecture, API, schema, migration, generated artifact, security, or design-contract rules. |
| L2 | Rules are documented but not mechanically checked. | `ARCHITECTURE.md`, style guide, schema notes, or migration policy only. |
| L3 | Standard tooling covers a relevant subset of rules. | Type systems, module visibility, lockfile drift, basic secret scanning, migration tool, or schema compiler. |
| L4 | Project-specific checks cover relevant rules across the active surface. | Architecture lint, API/schema diff, migration lint, generated artifact drift, design contract lint, SAST, secret scan, dependency scan, auth lint, and SQL/XSS rules. |
| L5 | Rule coverage is tracked and updated from recurring failures. | Coverage map, scheduled scans, trend tracking, or rule updates after repeated violations. |

Use applicable evidence items instead of forcing every project through every
scenario plugin:

- Enable API/schema checks only when the repo owns a public or cross-service
  contract.
- Enable migration checks only when the repo owns database migrations.
- Enable generated artifact drift checks only when generated output is committed
  or distributed.
- Enable design contract checks only when the repo owns UI, visual reports,
  generated interface artifacts, or a reusable design system.

#### Submetric 4.2: Enforcement Gate Strength

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Rules are convention only. | Prose says "do not" without a command, hook, or gate. |
| L2 | Optional local checks exist but are bypassable or unobserved. | Husky, lint-staged, or pre-commit runs locally but required gate evidence is absent. |
| L3 | Local or CI checks enforce a meaningful subset of rules. | Lint, type, security, schema, migration, or drift checks fail on violations. |
| L4 | Enforcement is connected to CI or required gate evidence for relevant changes. | Required status, path filter, or CI workflow blocks rule violations. |
| L5 | Enforcement is hard to bypass and is paired with approval or policy for sensitive changes. | Protected checks, policy-as-code, protected intake gate, or required approval for breaking changes. |

#### Submetric 4.3: Rule Repair Path

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Guardrail failures are raw logs or generic denials. | No file, rule, or fix direction. |
| L2 | Failures identify the file or rule but not the repair path. | Standard linter or scanner output only. |
| L3 | Failures include concrete repair direction. | Rule message says what to move, regenerate, rename, pin, or update. |
| L4 | Repair commands or autofix paths exist for common violations. | `make generate`, `npm run lint -- --fix`, migration dry-run, or token export repair command. |
| L5 | Repairs are tracked or automatically proposed and fed back into rules. | Repair changes, scheduled cleanup, trend tracking, or rule updates after recurring failures. |

### Dimension 5: Change Safety

**Core question**: Can agent-produced changes be constrained at runtime,
checked before acceptance, and prevented from unsafe side effects or
uncontrolled delivery?

Change Safety is the widest capability: several recommendation families route here, mapping onto three submetrics—5.1 Agent Lifecycle Guardrails (lifecycle guardrails, plan-execute-verify phase gates, agent workflow lifecycle), 5.2 Merge Acceptance Path (merge acceptance, risk-path acceptance controls), and 5.3 Side-Effect, Permission & Recovery Boundary (agent permission boundary, side-effect and recovery boundary).

#### Hook-first score calibration

Score agent safety before generic PR/MR maturity. Agent lifecycle guardrails
carry the most weight; merge acceptance supports them only when the base branch
and pre-acceptance path are inspected. Side-effect and recovery controls become
required when release, production, credential, destructive-command, or external
write surfaces are reachable. Static configuration proves presence, not
enforcement; distinguish configured, policy-content, tested, observed, and
backstopped evidence.

- PR/MR or CI files without lifecycle Hook, permission, sandbox, or runtime
  guardrail evidence normally cap Change Safety around 55-65.
- Inspected Hook policy or fixtures without an observed runtime decision may
  support roughly 60-70.
- Observed ask, deny, block, Stop, or tool-use decisions plus a merge review
  path may support roughly 70-80.
- Scores above 80 require observed lifecycle guardrails, required
  pre-acceptance checks or approval, and a relevant side-effect or recovery
  boundary.
- Direct work on the default/base branch, no reviewable base diff, or reachable
  destructive/production effects without a boundary cap Change Safety below 60
  even when CI exists.

#### Submetric 5.1: Agent Lifecycle Guardrails

This submetric also scores agent workflow discipline: plan-execute-verify phase gates (plan acceptance criteria, pre-execution checks, bounded execution scope, plan-alignment verification) and agent-loop lifecycle (retry cap, allowed tools, validation path, stop condition, escalation owner) read as part of the guardrail levels below—declared-only guidance is L1-L2, inspected policy or tests L3, observed enforcement L4, and audited/backstopped enforcement L5.

Problem signals:

- **Hook, acceptance, or release evidence named but not opened**: file presence,
  workflow names, or hook configuration prove existence only. Separate
  configured hooks, inspected policy content, tested fixtures, observed runtime
  events, and CI/sandbox/policy backstops before claiming enforcement.
- **Agent lifecycle has no deterministic guardrail**: if prompt submission, tool
  use, file edits, Stop/handoff, commit, or push can proceed without a hook,
  permission rule, sandbox, or evidence requirement, agent changes remain
  convention-heavy even when PR/MR CI exists.
- **Repeated agent work has no owner, trigger, validation path, or stop condition**: treat this as a
  loop-engineering problem even when the project has many instructions, generated examples, or
  one-off automations.
- **Plan-execute-verify phases are collapsed**: a generate-and-check workflow is
  not the same as a gated agent loop. Look for explicit plan acceptance
  criteria, pre-execution checks before tool use, bounded execution scope or
  allowed tools, runtime checks for sensitive actions, post-execution validation,
  and plan-alignment verification such as "did the implementation use the
  existing auth middleware instead of adding a parallel one?".
- **Failure response lacks an owner**: spec violations should route to agent or
  author repair, integration regressions should identify the owning provider or
  dependent team, and unavailable verification tooling should route to a
  platform or harness owner. If failure types only produce generic retry advice,
  Change Safety remains incomplete.
- **Hooks count by lifecycle decision, not by existence**: Agent hooks count for
  Change Safety 5.1 when they inspect prompt, tool, edit, Stop, or handoff events
  and return a narrow allow, deny, ask, feedback, or evidence-required decision.
  Git hooks count for 5.1 when they guard commit or push lifecycle points, but
  bypassable local hooks remain weaker than observed Agent hooks or CI/policy
  backstops. Hooks that only provide fast local feedback belong to Fast Feedback;
  hooks that mechanically enforce source rules belong to Quality Gates.

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | No deterministic guardrail surrounds agent prompt, tool, edit, Stop, commit, or push lifecycle points. | No Qoder, Codex, Claude Code, Cursor, Git, permission, sandbox, or Stop-gate evidence for agent-produced changes. |
| L2 | Hook, permission, or sandbox configuration exists, but policy content or runtime behavior is unverified. | `hooks.json`, `.codex` hooks, `.qoder` hooks, Husky, pre-commit, pre-push, allowlist, or sandbox notes exist but scripts, matchers, tests, and event samples were not inspected. |
| L3 | Inspected policy content or tests show the guardrail can give actionable feedback. | PreToolUse, PostToolUse, Stop, review-trigger, secret scan, mapping gate, or Git hook policy was opened and has fixture/unit tests, deterministic allow/deny logic, or clear next-step output. |
| L4 | Observed hook or permission evidence asks, blocks, or requires evidence for high-risk agent actions. | Hook event sample, Stop finding, pre-tool denial, post-edit scanner result, permission prompt, or pre-push block shows the agent receives a specific repair, evidence, or approval path. |
| L5 | Lifecycle guardrails are observed, auditable, maintained, and backstopped by another enforcement layer. | Observed hook plus CI, branch/ruleset protection, policy service, sandbox, least-privilege permission, structured audit metadata, acceptance route, and drift check for the hook or policy. |

#### Submetric 5.2: Merge Acceptance Path

Evaluate whether a proposed or agent-completed change can move from its current
workspace state into the repository's default/base branch through a validated
merge or acceptance path. PR/MR is one host-native evidence form, not the center of the
dimension. Git hooks, Agent hooks, repository-host rules, required checks,
approval policies, automation bots, and evidence requirements can all be evidence
when they participate in that merge acceptance decision. Score only
acceptance-time validation, approval, evidence, and escalation controls. Use host-neutral
acceptance-control wording unless the host-specific workflow was actually
inspected. Do not recommend creating `.github/` policy files unless the host and
workflow are confirmed as GitHub-specific.

**Evidence hierarchy for 5.2**: host-side controls (branch protection, required checks, approval history) live outside the repo, but the agent can still operate them, so do not floor documented or integrated evidence. A Skill or host MCP (GitHub, GitLab, Aone, and similar) gives the agent a live channel into the PR/MR and acceptance path: score it L4 when the integration is present and configured, and L5 when session or API evidence shows it actually driving change -> validation or approval -> acceptance. Enforcement-as-code such as `.github/settings.yml` or Terraform branch rules is likewise L4-L5. A high volume of real merge requests or pull requests against the base branch is observed working practice, not mere declaration: read it as L3 (a proposed-change diff path is actually in use), rising to L4 only when those requests show required validation or approval policy before merge rather than self-merge. Documentation of an acceptance flow reaches L3 when a code-visible base comparison also exists, and is never treated as absent. Keep L1-L2 only when there is no host integration, no enforcement-as-code, no observed request flow, and no documented path.

Problem signals:

- **PR/MR presence overclaimed as agent safety**: a PR, MR, merge request, or
  hosted workflow helps only when the default/base branch is clear and the
  current change can enter that merge acceptance path. Push-only,
  default-branch, tag, or manual release workflows are not agent lifecycle
  guardrails by themselves.
- **Host mechanism absence is not a standalone recommendation**: do not turn
  missing PR/MR, branch protection, host integration, or people-routing into a
  finding or top next step. When evidence is missing, say the merge
  acceptance path is `not inspected`, `unverified`, or `unresolved`, then route
  the next step to validation, approval, evidence, or escalation closure.
- **Host-specific recommendations require host evidence**: do not recommend
  `.github/` files, host-specific workflow settings, protected-branch
  documents, or host-specific change-request rules unless a GitHub repository
  was actually inspected or the user requested GitHub-specific policy. Prefer
  host-neutral validation, approval, evidence, and acceptance-gate language. If evidence names
  another host or CI/CD surface, such as `.gitlab-ci.yml`,
  `.gitlab-ci.yaml`, `.aoneci/ci.yml`, `.aoneci/ci.yaml`,
  `aone_build.sh`, Jenkinsfile, or `.circleci/config.yml`, recommend changes
  in that native surface instead.
- **Merge path is unresolved**: do not infer Change Safety strength from CI
  files alone. Identify the default/base branch, whether the current work is
  direct-on-base or represented as a diff against base, and whether validation,
  approval, evidence capture, or escalation runs before the change is accepted.
- **Post-merge or release-only workflows claimed as acceptance evidence**: only
  review-time, acceptance-time, or protected-intake checks qualify as
  merge acceptance evidence; a workflow on push to the default branch or
  manual release does not prove agent changes receive acceptance-time
  validation.

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | The default/base branch is unclear, current work appears direct-on-base, or no diff against base or acceptance route exists. | No default branch evidence, no branch/base comparison, direct edits on `master`/`main`, or no host-native validation, policy, hook, approval, or CI path before acceptance. |
| L2 | Hosted CI, PR/MR, hook, or review configuration exists, but the base relationship or pre-acceptance behavior is unverified. | GitHub Actions, `.gitlab-ci.yml`, `.gitlab-ci.yaml`, `.aoneci/ci.yml`, `.aoneci/ci.yaml`, Jenkinsfile, CircleCI config, review bot, or policy note exists but may only run on push, default branch, tags, or release. |
| L3 | The current change can be compared against a known base with a pre-acceptance validation or evidence path, or a high volume of real MRs/PRs against the base shows that acceptance path is in active use. | Current branch or worktree can be compared to `origin/HEAD`, `master`, `main`, or host default branch; PR/MR, merge request, review-trigger, pre-push, or CI evidence names checks before base acceptance; or many merged merge/pull requests against the base branch are observed. |
| L4 | Changes targeting the default/base branch are required to pass validation, approval, evidence capture, or escalation before acceptance, or a configured host Skill/MCP gives the agent a mechanized channel into that acceptance path. | Required status docs, branch/ruleset protection, merge policy, approval rule, blocking hook, MRs/PRs that require validation or approval before merge, a configured GitHub/GitLab/Aone Skill or MCP, or host-native required validation or approval gates acceptance. |
| L5 | The acceptance loop is observed and auditable with explicit checks and policy, including observed use of a host Skill or MCP to drive it. | Session, hook result, PR/MR/API evidence, observed Skill/MCP acceptance actions, repository-host settings screenshot, infrastructure-as-code rule, audit trail, or signed policy shows change -> trigger -> evidence or approval request -> repair -> recheck/acceptance. |

#### Submetric 5.3: Side-Effect, Permission & Recovery Boundary

| Level | Decision rule | Concrete evidence |
| --- | --- | --- |
| L1 | Agent work can reach production, credentials, destructive commands, release actions, or external writes without an assessed boundary. | Default commands connect to production services, real databases, payments, email, cloud resources, data deletion, migrations, or publish/deploy paths without dry-run, approval, rollback, or permission evidence. |
| L2 | Warnings, release scripts, or manual checklists exist, but operational safety remains convention-heavy. | `release.yml`, `npm publish` script, "do not run X" checklist, owner note, or manual rollback prose without executable dry-run, approval, or permission controls. |
| L3 | Dangerous operations have safe defaults, confirmations, dry-run paths, or are outside the default agent path. | Changeset, version check, changelog generation, `--force` confirmation, `--production` confirmation, `release:dry-run`, migration dry-run, or command defaults that avoid production. |
| L4 | Side-effecting or release operations require approval, rollback, audit, or isolated credentials. | Canary, rollback docs, required deployment approval, command audit, audit trail, environment-scoped credentials, protected deployment, or explicit release owner approval. |
| L5 | Dangerous or production paths are unreachable to default agent work and recovery is observed. | Sandbox, least privilege, production credential isolation, tool allowlist, dangerous command denial, audited approval, and observed rollback or recovery evidence are enforced by system design. |
