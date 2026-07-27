# Skill Discovery Reference

Use this reference after `../loop-engineering/loop-discovery.md` decides `Create Skill` or
`Extend Skill`, when the user explicitly asks to evaluate known repeated work as a
Skill, or when the user asks for a session-informed profile of their
software-lifecycle Skill coverage. This reference does not choose among
automation, hooks, commands, custom agents, MCP, scripts, rules, or project
policy. Return new durable-owner questions to
`../loop-engineering/loop-discovery.md`. Use [Skill Quality Review](skill-review.md)
when the Skill already exists and the question is whether it is well written,
safe, efficient, or demonstrably effective.

## Contents

- [Core Idea](#core-idea)
- [Executable Onboarding Documentation](#executable-onboarding-documentation)
- [Inputs](#inputs)
- [Skill Coverage Check](#skill-coverage-check)
- [Session-Informed Lifecycle Coverage](#session-informed-lifecycle-coverage)
- [Bug-Diagnosis Skill Examples](#bug-diagnosis-skill-examples)
- [Analysis Loop](#analysis-loop)
- [Candidate Score](#candidate-score)
- [Skill Package Shape](#skill-package-shape)
- [Output Template](#output-template)
- [Quality Bar](#quality-bar)
- [Platform Notes](#platform-notes)

## Core Idea

A good Skill candidate has repeated or costly demand, or one current bounded
SDLC handoff with direct need or behavior evidence. It still needs a stable
trigger, reusable input context, repeatable steps, clear output, failure modes,
and a validation path. Do not create broad Skills from noisy clusters or from
a loop that is already covered by an existing Skill.

Treat a Skill as packaged procedural knowledge for an agent to load at the
right time. A Skill can describe how to run a loop, collect evidence, validate
output, and hand off to automation, but it is not by itself runtime
persistence, tracing, approval handling, background scheduling, or external
system access.

Default to read-only analysis. Do not modify selected-platform user-home state,
project settings, auth files, model catalogs, plugin caches, transcripts, or
repository files unless the user explicitly asks for implementation.

## Executable Onboarding Documentation

Treat onboarding as a strong Skill candidate when the repeated work is more
than a deterministic install command or static README. A setup Skill can combine
README orientation, `go.sh`-style command sequencing, and agent-run judgment for
steps that depend on the current repository, environment, platform, local
configuration, generated artifacts, or validation failures.

Evaluate this pattern at three levels:

- codebase-local setup, run, test, and repair workflows, often exposed as a
  `/_setup` or project setup Skill
- library or API adoption guidance shipped by maintainers through internal or
  external Skill registries
- internal platform or design-system onboarding that lowers adoption friction
  and captures team conventions

Prefer a Skill when onboarding requires state-aware branching, current-context
inspection, or cross-tool instructions that a script cannot fully encode. Keep
deterministic setup commands in scripts that the Skill references, and return
purely scriptable or purely explanatory flows to scripts, README files, or
ordinary documentation.

## Inputs

Start from the Loop Discovery evidence pack:

- target workspace, platform, and time window
- candidate loop name and repeated intent
- evidence refs such as session ids, reports, artifacts, prompts, commands, or
  changed files
- proposed decision: `Create Skill` or `Extend Skill`
- existing coverage and the missing Skill-owned behavior
- trigger, input context, output, verification, stop condition, and failure
  modes

For Agent Work Loop review, generated
`repositoryEvidence.workflowDemandDiagnostics` may supply a normalized current
handoff or repeated-work lead. Treat `/ultraplan`, `/plan`, `/spec`, `/story`,
and `/issue-*` user task entries as specification/planning demand, and treat
`/review` as review/acceptance demand. Treat an
explicit `$spec-review`, namespaced lifecycle Skill, or `skill://` UI invocation
the same way only when its bounded identity maps to a known workflow intent;
do not infer lifecycle demand from arbitrary Skill names. Keep the diagnostic
read-only and open its bounded Skill capability evidence before
choosing a coverage step. A current handoff may enter the coverage ladder
directly; a repeated candidate still returns to Loop Discovery for owner
selection before `Create Skill` or `Extend Skill`. `owner-review` means the
smallest owner is unresolved; it is not by itself approval to create a Skill.
Bind a Skill proposal to reviewed owner-selection evidence, and never bypass a
matching built-in, configured, observed, or extendable capability.

If no evidence pack exists, run `../loop-engineering/loop-discovery.md` first unless the user
explicitly asked for the session-informed lifecycle profile below. That profile
may return `Try platform built-in`, `Try configured Skill`, or
`Needs more evidence` without proving a new loop. Send uncertain owner or new
durable-workflow questions back to Loop Discovery before creating or extending
a Skill.

## Skill Coverage Check

Inspect only enough existing assets to avoid duplicate recommendations:

- repository-local shared and selected-platform Skill stores
- user or plugin Skill packages when the task is about installed/global assets
- command or prompt aliases that invoke an existing Skill
- Skill references, scripts, assets, templates, and validation notes
- mirror metadata such as `.agents/skills/*/mirror.json` when present

Treat observed Skill use as coverage. Recommend `Extend Skill` only when the
evidence shows repeated manual setup, repair, validation, context collection,
or schedule handoff around that Skill.

## Session-Informed Lifecycle Coverage

Use this path only when the user asks to inspect their Skill use across
projects, find software-lifecycle coverage gaps, or recommend Skills from
global session history. It may recommend trying or creating a Skill, but it
does not turn every unobserved lifecycle stage into a new durable loop.

### Freeze the evidence boundary

1. Run `scripts/session-analysis.mjs sources` for each requested supported
   platform with the target workspace first. Add
   `--include-global-capabilities` only because this workflow explicitly asks
   for a user-global profile.
2. Run bounded `facets` or `insights` with an explicit `--since`/`--until`
   window when available, `--selection stratified`, and a stated `--limit`.
   Record the eligible/analyzed counts and source gaps; do not silently present
   a latest-N sample as a complete history.
3. Load the selected Platform Notes before classifying analyzer Skill signals,
   inferred reads, built-ins, or configured stores. Keep all of them separate
   from prose mentions.
4. Run `scripts/agent-customize/cli.mjs inventory` or
   `scripts/coding-agent-practices/inventory.mjs <platform> --workspace
   <absolute-target-path> --include-user-home --format markdown` to collect
   configured personal, project, plugin, and built-in coverage.
5. Label each claim `workspace`, `user-global`, or `configured`. A capability
   absent from the bounded sample is `not observed`, not `missing`.

Do not expose raw prompts, commands, absolute home paths, or stable session ids
in the reader-facing profile. Cite bounded evidence refs in internal or review
artifacts only.

### Use two coverage axes

Do not rebuild a flat SDLC stage list. Map normalized capability aliases onto
two orthogonal axes:

| Axis | Coverage families | Common comparison vocabulary |
|---|---|---|
| Lifecycle artifacts | brainstorm/research, specify/clarify, plan/tasks, architecture/UX, release/incident, retrospective/standards | Spec Kit, OpenSpec, BMAD, and Agent OS workflows |
| Engineering disciplines | isolate/worktree, execute/delegate, TDD, systematic debugging, review, verification, branch completion | Superpowers and equivalent discipline Skills |

Treat those ecosystems as comparison vocabularies. A session using
`test-driven-development`, `/opsx:propose`, `speckit-plan`, or an equivalent
team Skill can cover a family without requiring a same-named platform Skill.
Look for observable workflow behavior and artifacts, not exact brand strings
alone.

### Project lifecycle coverage into Agent Work Loop

For the default Agent Work Loop combined review, inspect the practical handoffs
from goal/clarification through specification/planning, setup/isolation,
debugging/testing/verification, and review/acceptance/branch completion. Do not
require a generic coding or implementation Skill: the base agent already owns
ordinary code generation, and a Skill is useful only for non-obvious reusable
procedure.

Apply the observed -> platform built-in -> configured -> extend -> create ->
needs evidence ladder below. Enter it from either repeated or costly demand, or from
one bounded current SDLC handoff whose need or behavior is directly observed.
Keep confirmed project activation, unscoped observed activation, apparent
reads, and configured presence as separate evidence classes; none substitutes
for another. Likewise, count built-in coverage only from an inspected,
host-scoped built-in catalog entry that matches the normalized workflow; the
presence of a slash-command token does not establish coverage.
The current-task route is sufficient only when the review can name a reusable
non-coding procedure, stable trigger and output, validation or stop boundary,
and an inventory-confirmed coverage gap. When at least two comparable episodes
support the same repeated opportunity and inspected session plus inventory
evidence leaves such a family uncovered, project a supported, deduplicated
Learning Capture finding under `loop-engineering`. Without recurrence, keep the Skill recommendation
under the affected current-task dimension. Group lifecycle gaps by causal chain
rather than emitting one finding per stage.
`Not observed`, an unavailable source, or a merely configured asset does not by
itself prove a gap. Covered or weak-evidence profiles create no finding.

Treat these as positive review leads, not automatic findings:

- observed planning or a non-trivial change with no canonical Spec workflow,
  when opened Skill coverage has no specification and acceptance-traceability
  procedure;
- observed branch/worktree setup, rebase or conflict recovery, review handoff,
  or branch completion with no matching Skill or built-in procedure.

The missing Spec document alone is not a Skill, and a lone `git status`, commit,
or other ordinary Git command is not a Git workflow. Recommend a new Skill only
for the smallest reusable procedure behind the evidenced handoff; never
recommend a generic `git`, `coding`, or whole-SDLC Skill.

### Select coverage before creation

Use this priority order for every coverage family:

1. **Covered — observed**: keep the observed Skill or equivalent platform
   capability and cite its evidence.
2. **Try platform built-in**: when a matching built-in is available but no similar
   workflow was observed, recommend one concrete trial and its success check.
3. **Try configured Skill**: when no platform built-in matches but an installed
   personal/project/plugin Skill already covers the family, recommend a bounded
   trial before declaring a gap.
4. **Extend existing Skill**: when personal/project/plugin coverage is partial,
   name the exact Skill and missing trigger, step, output, or validation.
5. **Create Skill**: when no built-in or installed Skill covers a stable
   Skill-shaped playbook, use the selected platform's supported creation path
   instead of inventing a broad lifecycle package.
6. **Needs more evidence**: use this when the sample, demand, workflow shape,
   or validation path is too weak.

Customization Checkup may pass an advisory `capabilityRecommendation` with
`lifecycle`, `discipline`, `evidenceState`, `nextStep`, and `handoff`. Repeated
friction still routes through Repeated Friction Triage and Loop Discovery. A
current-task lifecycle review may select Skill ownership directly when the
bounded procedure-demand and coverage conditions above are satisfied. Re-run
this ladder against current observed, built-in, and configured coverage; do not
treat the handoff field as authorization to create or install anything.

### Create the Skill when authorized

Keep the default profile read-only. If the user only asks for analysis, return
a ready-to-use creation handoff containing the trigger, target workflow,
required context, output, validation, and one failure boundary.

If the user explicitly asks to create the recommended Skill, use the selected
platform's supported creation workflow and proceed without asking for another
generic approval. Use personal scope for a cross-project user workflow and
project scope for repository-specific conventions; ask once only when that
boundary is genuinely ambiguous. Use the host-native personal/project store
reported by inventory.

Create the smallest useful package. Give the Skill a narrow verb-led name and
a description that states the triggering condition or state transition. Keep
`SKILL.md` navigation-sized, add scripts only for repeated deterministic work,
then validate discovery and run one representative dry-run or task check.
Never overwrite an existing or built-in Skill silently.

## Bug-Diagnosis Skill Examples

Use bug-topic session evidence only as a lead. For a session-derived repeated
opportunity, require at least two distinct comparable Task Episodes with the
same reusable reproduction or diagnosis need. Bug/error keywords, issue counts,
or repeated attempts inside one Episode do not establish recurrence.

Do not select a frontend or backend example from Session Evidence alone. Join
its Task Episodes or Insight Ledger with inspected Project Evidence using the
matching [project overlay](../project-harness/project-overlays.md), then use Agent Customize
evidence to check existing coverage. Only the lead may route the supported
candidate through Loop Discovery and the coverage ladder above.

| Supported procedure shape | Joined evidence | Copy/adapt example |
|---|---|---|
| Browser or UI reproduction | GitHub Issue, Jira, Aone, or exported screenshots/video/comments plus a project-owned browser, component, E2E, WebView, IDE, or desktop route | [`reproduce-frontend-bug`](examples/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md) |
| Backend correlated diagnosis | Issue evidence plus a project-owned service/test/job route, readable logs or traces, and a stable request/trace/job/run id | [`diagnose-backend-bug`](examples/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md) |

These directories are example package shapes, not built-ins, configured or
observed coverage, creation authorization, or a universal issue-solving Skill.
Compose any later authorized repair, validation, PR/MR, and review through the
[Goal Completion pattern](../loop-engineering/patterns/goal-completion.md).

## Analysis Loop

1. Confirm either a Loop Discovery decision of `Create Skill` or `Extend Skill`,
   or the explicit session-informed lifecycle-profile mode above. In profile
   mode, apply its evidence ladder first and enter creation only when demand,
   stability, Skill fit, and validation make the boundary concrete. Demand may
   be repeated/costly, or one directly evidenced current SDLC handoff with no
   matching coverage. If the candidate is an automation, hook, script, rule,
   custom agent, command, or MCP-backed loop without a reusable how-to playbook,
   return it to `../loop-engineering/loop-discovery.md`.
2. Name the Skill boundary:
   - trigger
   - user intent
   - required context
   - steps
   - output artifact or answer shape
   - validation commands or checks
   - failure modes and handoff points
   - runtime dependencies the Skill must not pretend to own: state store,
     trace/log sink, approval surface, scheduler, MCP server, or CI system
3. Check whether an existing Skill already covers the boundary.
4. Classify the Skill action:
   - **Covered by Skill**: no new Skill work; cite the existing Skill.
   - **Extend Skill**: add or adjust instructions, references, scripts, assets,
     examples, or validation guidance in the existing Skill.
   - **Create Skill**: create a new Skill only when no existing Skill owns the
     reusable playbook.
   - **Not a Skill**: return to Loop Discovery with the reason.
   - **Needs more evidence**: name the missing session, report, artifact, or
     validation proof.
5. Keep `SKILL.md` navigation-sized. Move detailed examples, host-specific
   rules, long checklists, and platform inventories into references, scripts,
   assets, or templates.

## Candidate Score

Use this compact scoring table before recommending Skill work:

| Field | Good signal | Weak signal |
|---|---|---|
| Demand | Seen repeatedly/costly, or one current SDLC handoff has direct need or behavior evidence and no matching coverage | One isolated request or tool invocation with no reusable procedure |
| Skill fit | Reusable how-to workflow with judgment | Deterministic transform or policy check |
| Onboarding fit | README plus setup script plus environment-aware agent judgment | Single command or static setup notes |
| Stability | Same trigger, inputs, steps, and output shape | Different goal each time |
| Validation | Clear test, command, review, or artifact check | Success depends only on taste |
| Coverage | Missing or incomplete existing Skill coverage | Existing Skill already handles it |
| Scope | Narrow workflow a first `SKILL.md` can own | Whole product area or vague theme |
| Evidence | Session/report/repo facts align | Only cache names, counts, or guesses |

For medium-confidence items, output `needs more evidence` with the exact
missing proof.

## Skill Package Shape

When the decision is `Create Skill`, define the smallest useful package:

```text
skills/<skill-name>/
  SKILL.md              # trigger, boundary, steps, validation, output
  references/           # optional long guidance
  scripts/              # optional deterministic helpers
  assets/               # optional reusable templates or examples
```

When the decision is `Extend Skill`, name the exact existing file and the
smallest change type:

- trigger or description update
- reference link
- validation rule
- script or asset handoff
- example artifact
- host-specific boundary note

Do not add scripts merely to prove a Skill exists. Add scripts only when the
workflow has deterministic extraction, validation, formatting, or packaging
that the agent would otherwise repeat by hand.

If the loop needs resumable state, human approval, background execution,
trace/span export, external writes, or multi-run evaluation storage, keep those
contracts in the selected runtime owner and have the Skill reference them
explicitly instead of embedding vague "agent will remember" instructions.
Use `../loop-engineering/loop-primitives.md`,
`../loop-engineering/automation-readiness.md`, or
`../loop-engineering/loop-state-ledger.md` for those supporting contracts after Loop Discovery
selects them.

## Output Template

```markdown
### Skill discovery
- **Target repo**: ...
- **Loop candidate**: ...
- **Evidence refs**: ...
- **Mode**: read-only | creation authorized

### Lifecycle coverage
| Axis | Capability | Observed use | Configured or built-in | Gap confidence | Next action |
|---|---|---|---|---|---|
| Artifact/Discipline | ... | workspace/user-global/not observed | ... | high/medium/low | Keep/Try built-in/Try configured/Extend/Create/Needs evidence |

| Candidate | Evidence | Existing coverage | Skill action | Decision |
|---|---|---|---|---|
| ... | session/report/repo refs | covered/missing/partial | Covered/Create/Extend/Not a Skill | ... |

### Create Skill
1. ...

### Extend Skill
1. ...

### Not a Skill
1. ...

### Needs more evidence
1. ...

### Safe next validation
```

Describe the smallest next validation step in prose, not as a hard-coded CLI
command.

## Quality Bar

- Cite concrete Skill files, repository paths, session ids, reports, or
  artifacts.
- Keep explicit activation, inferred reads, configured assets, built-ins, and
  commands as separate evidence classes.
- Prefer a matching platform built-in or built-in command before proposing a
  new user Skill; never present configured project or personal stores as
  product built-ins.
- Keep Skill recommendations narrow enough that the first `SKILL.md` can be
  useful without scripts.
- For onboarding Skills, separate agent-owned judgment from deterministic setup
  commands and cite the README, scripts, platform docs, or registry source they
  complement.
- Separate Skill coverage from loop ownership: automation, hooks, scripts,
  commands, agents, MCP, and rules are valid loop owners but are not Skills.
- Separate procedural guidance from runtime guarantees: a Skill may instruct an
  agent to use a session, trace, approval, schedule, or MCP-backed action, but
  another owner must provide that capability.
- Prefer extending an existing Skill when the evidence shows partial coverage.
- Create a standalone platform Skill only when the workflow is reusable outside
  one project-specific rule or command.
- Treat missing Spec workflow and bounded Git lifecycle work as review leads;
  reject document absence alone, ordinary Git use, and generic tool-shaped
  Skills.

## Platform Notes

Load only the selected platform note after the shared evidence and coverage
rules identify a Skill-shaped gap. These sections own analyzer semantics,
built-in precedence, native creation paths, and host-local stores.

### Qoder

Read Qoder `topSkills` as observed Skill activation. Prove the current product
surface from host inventory. In a Qoder source checkout, the embedded built-in
owner is `chat/agents/tool/skill/builtin_skills/` plus its loader, not repository-local
`.qoder/skills` or `.agents/skills`.

- `~/.qoder/skills` and `~/.agents/skills` are personal stores;
  `<repo>/.qoder/skills` and `<repo>/.agents/skills` are project stores. They
  can supplement the product surface, but they are not Qoder built-ins. The
  current loader gives an embedded built-in precedence over a same-named
  personal or project Skill; do not promise a same-name override.
- Globally visible built-in Skills currently include `create-skill`,
  `create-subagent`, `canvas`, and `vercel-deploy`.
- `create-skill-ui` is available only in Quest Agent mode, and `schedule` only
  in Quest sessions. State that availability instead of recommending them as
  universal Skills.
- `front-design` and `wiki-plan-gen` are private built-in-agent Skills. Route to
  the owning built-in agent when available; do not tell the user to invoke them
  as global Skills.
- `/ultra-review` is a Qoder built-in command that dispatches three independent
  review perspectives. Count it as observed review coverage when session
  evidence shows use, but do not call it a `SKILL.md` or create a duplicate
  review Skill unless the user needs a distinct reusable review policy.

Specialize the shared coverage ladder as follows:

1. **Covered — observed**: keep the observed Skill or equivalent Qoder
   capability and cite its evidence.
2. **Try Qoder built-in**: when a matching built-in is available but no similar
   workflow was observed, recommend one concrete trial and its success check.
3. **Try configured Skill**: when no Qoder built-in matches but an installed
   personal/project/plugin Skill already covers the family, recommend a bounded
   trial before declaring a gap.
4. **Extend existing Skill**: name the exact partial Skill and missing trigger,
   step, output, or validation.
5. **Create with `create-skill`**: when no built-in or installed Skill covers a
   stable Skill-shaped playbook, use Qoder's built-in `create-skill`.
6. **Needs more evidence**: keep the recommendation read-only when the sample,
   demand, workflow shape, or validation path is too weak.

Typical Qoder-first moves include `create-subagent` for a reusable isolated
specialist, `/ultra-review` for deep multi-perspective review, `vercel-deploy`
for a matching web-delivery path, `canvas` for a durable visual artifact,
`schedule` for an eligible Quest follow-up, and `create-skill` for the remaining
proven playbook. Do not force these onto unrelated lifecycle gaps.

Use the [Qoder Platform Reference](platforms/qoder.md) for the configured
feature taxonomy, file locations, and official examples. Treat product/runtime
descriptions as availability evidence only: provider-context advertisement may
make a context-gated capability available, explicit activation proves use, and
task-linked outcome evidence is still required before calling it effective.

When inventory or the `/skill` menu shows only 0-2 relevant described Skills
and the repeated workflow has no matching Skill owner, make the safe next step
a Qoder-native `/create-skill <workflow description>` suggestion. Keep the
description concrete: trigger, target workflow, required context, output,
validation, and one failure boundary.

If the user explicitly asks to create the recommended Skill, invoke the Qoder
built-in `create-skill`. Use the host-native personal/project store reported by
inventory and never overwrite an existing or built-in Skill silently.

### Codex

Read Codex `topSkills` as observed Skill activation. Read Codex
`inferredSkillReads` only as a Skill file that a command appeared to read, not
as confirmed activation. Keep both separate from prose mentions and configured
Skill presence.

Inspect only the active Codex project, user, or packaged Skill stores reported
by inventory. Do not infer that a configured Skill was activated, or that an
apparent file read was a Skill invocation.
