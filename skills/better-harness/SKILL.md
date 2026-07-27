---
name: better-harness
description: Use when /better-harness reviews the outer coding-agent Harness for lifecycle controls, repeated work, project feedback, agent assets, session outcomes, repair planning, durable reports, or finding-bound fixes. Invoke only via slash command.
---

# Better Harness

Review the coding-agent operating system: context, execution, control, feedback,
and learning. Sessions, project, and Agent assets stay independent until joined.

## Step 1: Resolve Scope and Collect the Evidence Bundle

If the prompt contains `<better-harness-fix-output>`, read
[Finding-bound Fix](references/finding-bound-fix.md) before any probe.

Resolve the Skill path, `<better-harness-root>` as `../..`, a supported `<node>`,
and `<cli>` as
`<node> <better-harness-root>/scripts/better-harness.mjs`. Stop if any owner is
missing; never select another cache or runtime by search order.

Resolve the absolute target, decision, acceptance boundary, risks, locale (the
user's request language unless explicitly changed), output mode, provider
scope, and evidence depth. Quick uses three assets or Episodes and the previous 7 days; normal uses five and the previous 30 days.
Default Qoder to durable Canvas and other providers to durable HTML. Only an
explicit inline or no-files request writes nothing.
Keep providers separate. Use the current provider by default; include multiple
supported providers only for an explicitly authorized project-wide review.
Qoder project Memory title metadata is part of
the selected workspace baseline. Memory bodies, Codex Memory, Qoder global
Memory, user-home, raw Session, installed-plugin, marketplace, and
historical-insight access require explicit scope.

Before delegation, collect one versioned evidence bundle per authorized
provider:

```text
<cli> harness evidence-bundle --platform <provider> --workspace <target> --language <locale> --depth <quick|normal> --since <window-start> --until <window-end> --format json [--include-memories] [--include-user-home] [--canvas-out <run-dir>/canvas.json]
```

Use `--canvas-out` only for Qoder durable-report runs. For Qoder, keep the
default project Memory-title scan; `--include-user-home`
widens it to authorized global Memory/config and other user assets. For Codex,
Memory metadata requires `--include-memories`; user/global or installed-Plugin
metadata requires `--include-user-home`. Apply both when both scopes are
authorized. Neither flag authorizes Memory bodies.

The command freezes target, provider, window, depth, evidence limit, and asset
authority once. It returns `sessionEvidence`, `projectHarness`, and
`agentCustomize` lanes plus the lead analyzer envelope. The Agent Customize
lane contains the bounded `lint`, `inventory`, and `integrity` envelopes from
one shared asset snapshot. Keep every lane and stage status and each provider
distinct. Use the individual `session-analysis facts`, `core-change-watch
evidence-pack`, `coding-agent-practices asset-baseline`, or `harness analyze`
command only to diagnose a named unavailable or truncated owner; do not
substitute diagnostic output into the bundle or rerun all owners. Counts for
Rules, Skills, MCP, Memory, Agents, Hooks, Commands, Workflows, and Plugins only
route inspection. Zero or high counts never create findings or scores. A
normal Qoder report with project Memories blocks when the integrity stage is
unavailable; do not replace the missing review with an `unobserved`
disposition.

If the provider discovers or the user supplies a historical insight source,
the lead may inspect only the few explicitly authorized architecture/history
notes. Never assume or search a conventional path. Historical notes cannot
prove current behavior, configured capability, or effectiveness.

## Step 2: Run Three Independent Evidence Passes

Launch exactly three fresh, read-only agents in parallel. In Codex use
`spawn_agent` with `fork_turns: "none"`; otherwise run the same briefs locally
and independently. No evidence agent may delegate.

### 2.1 Session Evidence

The lead takes the provider-labelled facts envelopes from
`bundle.lanes.sessionEvidence.data`, whose production collector is routed by
[Sessions Diagnostics](../../references/session-evidence/sessions-diagnostics.md),
using only the production `facts` route. Do not pass the complete bundle,
collection reference, debug output, or raw sessions to Agent 1.

Give Agent 1 only the provider-labelled facts envelopes, the compact Step 1
asset counts needed to notice zero Skills, and the resolved scope. Require it to
read [Session Evidence](references/session-evidence.md) and conditionally
read [Repeated Workflow Discovery](references/session-repeated-workflows.md)
when repeated procedure demand is in scope. It must not inspect
the project, configured assets, raw sessions, or another brief.

### 2.2 Project Harness Evidence

Give Agent 2 only the target, scoped history/current-change boundary,
`bundle.lanes.projectHarness.data`, decision, risks, and owner limit. Require it to read
[Project Harness Evidence](references/project-harness.md). It must not receive
Session or Agent Customize conclusions.

### 2.3 Agent Customize Evidence

Give Agent 3 only `bundle.lanes.agentCustomize.data` with its provider-labelled
lint, inventory, and integrity envelopes; asset authority; decision; risks;
and owner limit. Require it to read
[Agent Customize Evidence](references/agent-customize.md). It consumes
the deterministic envelopes and must not rerun their commands or receive
Session/Project conclusions.

Each agent follows its reference-local free-form return contract: normally
three to five candidates, up to three in quick mode, and fewer when evidence is
sparse. Specialists never assign final severity or scores.

While they run, use only `bundle.lead.data` as the lead analyzer result. The
bundle maps `--include-user-home` to the analyzer's global-capability boundary;
this preserves authorized MCP, Plugin, Skill, Hook, and Memory counts without
authorizing content reads or proving use.

Stop if the bundle is `failed`, the lead lane is unavailable, or its data omits
`evidence` or `summaryFacts`. In quick mode a `partial` bundle lowers confidence
and every unavailable specialist remains explicit; in normal mode any
unavailable or partial specialist lane blocks the report. This evidence pass
has a hard cap of three delegated agents.

## Step 3: Lead Reconciliation and Regrading

Read [Harness Findings Input](../../templates/reporting/harness-findings.input.json)
for field roles and [Agent Work Loop](../../models/agent-work-loop.md) for the
five dimensions, checks, evidence states, scoring, and Learning Capture rules.
Replace all example content. Never derive the contract from prior reports,
Memory, recommend files, or validators.

Perform one reconciliation. Start by retaining every specialist candidate.
Merge only candidates with the same target, observed consequence, owner, and
repair route; preserve independent consequences even when they share a broader
theme. Keep a working reason for every unsupported or deferred candidate. Never
drop an eligible finding to reach five rows, shorten the report, simplify a
score, or match the three priority moves. Then the lead alone:

- validates the consequence, cause chain, smallest owner, evidence boundary,
  confidence, and verifier;
- assigns final severity and one primary Agent Work Loop check;
- derives conservative dimension scores independently from findings count;
- retains disagreements and unavailable evidence at low confidence;
- writes every distinct supported finding and freezes final severity and
  dimension scores before shaping priority moves, repair prompts, or reader copy.

Before drafting, read [Findings Quality Gates](references/findings-review.md)
and apply its eligibility, consistency, privacy, asset, candidate-promotion,
and repair-prompt checks directly. For repeated procedure or knowledge demand, also read
[Asset Demand Reconciliation](references/asset-demand-reconciliation.md).

Do not author `summary.suggestions` in a new report. Promote a suggestion
candidate to an ordinary `Low` finding only when it passes the same consequence,
owner, evidence, output, verifier, and repair-prompt gates as every finding;
otherwise keep it deferred in the working reconciliation.

After findings and dimension scores are frozen, select exactly one support track
from the evidence and requested outcome. The parenthetical ranges are user-journey
labels, never score thresholds:

- **Bootstrap (0 -> 1):** initial guidance is explicitly requested, or retained
  findings establish a missing foundational navigation, validation, or risk route.
- **Operationalize (1 -> 60):** relevant mechanisms exist, but retained findings
  show they are not wired into ordinary work or exercised through an outcome.
- **Optimize (60 -> 100):** sufficiently complete Session evidence contains at
  least two distinct comparable Task Episodes for the repeated goal or friction.
- **Undetermined:** the evidence required to select a track is unavailable.

Read only the selected track: [Bootstrap Support](references/support-bootstrap.md),
[Operationalize Support](references/support-operationalize.md), or
[Optimize Support](references/support-optimize.md). A track may shape at most
three priority moves, repair prompts, and reader copy for already-supported
findings. It must not add a finding, change severity, rescore a dimension, add a
report field, or expand evidence and mutation authority.

For a durable report, draft `findings.json` only after the three evidence agents
finish. Do not launch a fourth review agent. The lead applies the quality gates
once, preserves all eligible findings, and fixes any machine-validation failure
before rendering.

## Report Output — Step 4: Render an Authorized Report

Inline analysis writes nothing. After lead checks pass, treat the draft as the one
final `findings.json`, then render and validate it once:

```text
Qoder: <mode>=qoder-canvas; <host-root>=<target>/.qoder/better-harness
Other providers: <mode>=html; <host-root>=<target>/.<provider>/better-harness
HTML artifacts: findings.json, report.md, report.html
<cli> harness render --findings <run-dir>/findings.json --mode <mode> --out <host-root> --run-dir <run-dir> --target <target> --validate --json
```

Qoder analysis owns adjacent `canvas.json`; do not copy its `summaryFacts` into
findings. HTML keeps analyzer `summaryFacts` verbatim. Succeed only on
`status: pass` and return the exact paths reported by render. Never hand-write
Canvas, Markdown, or HTML.

Finish with one compact sentence: `<count> findings. [Open the report](<renderer-path>).`
Link the renderer-reported primary report; never return inline-code paths, a
bare directory, or an output-file inventory.

## Step 5: Follow Up

- Finding-bound repair uses [Finding-bound Fix](references/finding-bound-fix.md).
  A separate independent post-fix agent may update verified finding state and
  Repair Progress; Loop Effectiveness waits for comparable later Task Episodes.
- Usage/model questions use `session-analysis usage-summary` once.
- Repeated work continues through
  [Loop Discovery](../../references/loop-engineering/loop-discovery.md).
- Detailed routes are available through
  [Agent Customize](../../references/agent-customize/routing.md),
  [Core Change Watch](../../references/project-harness/core-change-watch.md),
  and [Report Routing](../../templates/reporting/routing.md).

The default durable route authorizes only renderer-owned report artifacts in
the resolved host root. Other creation, activation, mutation, cleanup,
scheduling, external writes, and high-risk access require task-local authority.
When an owner or required value is unresolved, stop with the exact condition to
resume; do not invent a substitute artifact or inspect internal validators.
