# Agent Customize Routing

Use this as the shared switchboard for configured agent-asset evidence. Start
from `../README.md` when the reference domain is unclear. Load only the matching
reference; keep detailed platform examples in the target file.

## Core Contract

Route by ownership before choosing a vendor-specific feature:

- **Rules / AGENTS.md**: always-needed project facts and soft constraints.
- **Skills**: repeatable how-to workflows with stable trigger, inputs, steps,
  output, failure modes, and validation.
- **Loop Specs**: repeated or schedulable work patterns that may be owned by a
  Skill, automation, hook, command, script, custom agent, MCP-backed workflow,
  rule, or existing coverage.
- **Commands / Prompts**: thin manual entrypoints or shortcuts that invoke a
  Skill, script, or constrained prompt; they do not own broad workflow logic.
- **MCP**: external systems, tools, resources, and data access.
- **Hooks**: deterministic lifecycle checks, blocking, logging, or validation.
- **Custom Agents / Subagents**: specialist role isolation, parallel research,
  or independent verification.
- **Plugins**: team packaging and distribution of canonical assets.
- **Permissions / Sandbox**: hard access boundaries for files, commands,
  network, credentials, and state-changing actions.
- **Memory**: observed preferences, repeated traps, and lessons; not raw
  private transcripts.
- **Spec / ADR**: reviewable rationale for non-trivial behavior changes.

## Reference Selection

- Agent guides (`AGENTS.md`, `CLAUDE.md`, Copilot, Cursor, Qoder rules) ->
  `agents-md-review.md`.
- Cursor/Qoder/Codex/Claude project or user assets -> `global-assets.md`; for
  Claude-specific configured-asset scope, then load `platforms/claude.md`; for
  Codex-specific operating practice, then load `platforms/codex.md`; for
  Qoder-specific feature taxonomy, then load `platforms/qoder.md`. For
  installed, user-home, settings screenshot, plugin cache, or memory scope, run
  the Global/User Asset Pass.
- Prior decision, user correction, remembered preference, stale recall,
  cross-window adoption, or memory-safety question -> `memory-review.md` after
  `global-assets.md` establishes the configured/storage boundary. Memory files
  and settings are recall leads, not proof that a later task used them.
- Memory title overlap, enabled Plugin name/capability overlap, or Hook
  count/duplicate/fan-out pressure -> use the selected platform's supported
  metadata-only integrity scan from Platform Notes, then load
  `memory-review.md`, `global-assets.md`, or `hooks-review.md` for the affected
  owner. The scan never authorizes mutation.
- Why a known Rule, Skill, Memory, Hook, Command, MCP, Agent, or Workflow was
  not used; repeated correction/rediscovery; cross-asset freshness; or whether
  a lesson became a maintainable capability -> `knowledge-assets-review.md`.
  Start from bounded Task Episodes and load `memory-review.md` only for the
  memory-specific privacy, recall, or stale-content branch.
- Explicit `/better-harness checkup`, customization cleanup, unused-capability, or
  context-pressure request -> `global-assets.md`, then select `mcp-review.md`,
  `agents-md-review.md`, `hooks-review.md`, or `memory-review.md` for the
  affected owner. Checkup is read-only until a digest-bound repair plan is
  explicitly confirmed.
- MCP configuration, shadowing, observed use, tool-surface pressure, or cleanup
  -> `mcp-review.md`; MCP remains an access layer, not the workflow owner.
- Custom Agent inventory, profile content, routing descriptions, tool
  boundaries, specialist-role overlap, or delegated-work quality ->
  `custom-agents-review.md`; count alone is inventory, not quality or use.
- Visual/UI design contracts, `DESIGN.md`, design tokens, generated UI style
  drift, or visual report/component library themes ->
  [DESIGN.md contract](../project-harness/design-md-contract.md);
  use `design-md-review` or `design-system-capture` when available for detailed
  authoring, review, or extraction.
- Runtime failure diagnosis, raw log walls, logging-framework discovery,
  REST/test/CLI/UI debug routes, correlation, health/debug surfaces, profiles,
  or diagnostic artifact quality -> `../project-harness/observability.md`; when project
  instructions are in scope, also load `agents-md-review.md` for the minimal
  executable `AGENTS.md` route.
- Sessions, validation habits, workflow friction, repeated workflows ->
  `../session-evidence/sessions-diagnostics.md`, then
  `../session-evidence/session-insights-report.md` when a reader
  report is requested. Usage, cost, long-session, or model-advice questions
  additionally load `../session-evidence/session-usage-efficiency.md`.
- An Agent Work Loop, Task Episode, session-outcome, or repeated-friction report
  -> [Agent Work Loop Task Episode construction](../../models/agent-work-loop.md#construct-task-episode-evidence),
  then `knowledge-assets-review.md` for the fifth-dimension asset chain. It maps
  existing practice owners to the five reader questions without turning
  aggregate session counters into task or delivery proof.
- A selected Agent Work Loop task with an inspected library/SDK, visual,
  backend/multi-service, generator/schema, infrastructure/release, or
  documentation/plugin shape -> `../project-harness/project-overlays.md`; use only the matching
  evidence additions and keep their judgments in the existing fifteen checks.
- Review or change of the Agent Work Loop definitions themselves ->
  `../../models/agent-work-loop-rationale.md`; primary sources explain the model shape but do
  not score the current project.
- Repeated work, duplicate manual work, workflow friction, or schedule/event
  candidates -> `../loop-engineering/loop-discovery.md`; use
  `skill-discovery.md` only when the loop decision is
  `Create Skill` or `Extend Skill`.
- Existing Skill evaluation, audit, score explanation, benchmark design, or
  "what should I fix first" request -> `skill-review.md`; keep static quality,
  measured task lift, and evidence level separate.
- Short manual shortcut or prompt alias -> Command/Prompt shell; keep canonical
  behavior in a Skill, script, or reference.
- Host agent hook practice -> `agent-hooks.md`; then load
  `platforms/claude.md` or `platforms/qoder.md` when implementation details are
  provider-specific.
- Hook duplication, latency, timeout, failure, matcher breadth, or cleanup ->
  `hooks-review.md`; use `agent-hooks.md` only after the remediation form is
  selected.
- Git/CI lifecycle safeguards, review triggers, or sensitive-code harness
  policy -> `../project-harness/`.
- New non-trivial workflow, hook, agent, packaging, report, or review behavior
  -> write or update a focused `docs/specs/*.md` before implementation.

## Composite Signal Rules

- Project-wide policy with enforcement need -> Rule explains the constraint;
  Hook and/or Permission/Sandbox enforces it.
- Repeatable external-system diagnosis -> Skill owns the workflow and judgment;
  MCP provides access to the external system.
- Repeated work with an undecided owner -> Loop Discovery chooses the durable
  surface before any Skill, hook, automation, command, agent, MCP, rule, or
  script recommendation.
- One-off external lookup -> use MCP inside the current task; do not create a
  durable Skill or Agent until repeated demand or high risk is visible.
- Specialist review with a stable checklist -> Custom Agent owns role isolation;
  Skill owns the repeatable review procedure when the checklist is reusable.
- Short manual entrypoint -> Command/Prompt invokes a Skill, script, or focused
  prompt; promote to Skill when steps, references, or validation become
  substantial.
- Team distribution -> Plugin packages canonical assets only after the canonical
  Skill, reference, script, hook, agent role, or rule has an owner and
  validation evidence.
- Preference memory -> store as Memory only when host policy allows it and the
  preference is explicit or repeatedly observed; otherwise keep it session-local.

## End-To-End Route

1. Identify intent, target repo, risk level, and whether the task is read-only,
   review, implementation, or validation.
2. Load always-needed Rules or agent guides only for facts and constraints.
3. Trigger a Skill when the task has a repeatable procedure or artifact shape.
4. Use MCP only when the workflow crosses into an external system.
5. Check Permissions/Sandbox before file, command, network, credential, or
   external-state access.
6. Use Hooks for deterministic lifecycle enforcement.
7. Use Custom Agents/Subagents for independent context, specialist review, or
   parallel evidence collection.
8. Map output back to specs, acceptance criteria, tests, commands, changed
   files, risks, and unresolved questions.
9. Package proven combinations in Plugins or host shells while keeping canonical
   behavior in `skills/`, `references/`, `scripts/`, `hooks/`, or templates.
10. Persist only reusable lessons as Memory, references, specs, or skill
    updates when evidence shows the pattern recurs.

## Ownership Route

| Signal | Action form | Read next |
|---|---|---|
| Missing repo fact, command, or path rule | Add or tune Rule / `AGENTS.md` | `agents-md-review.md` |
| Stable repeated prompt with repeatable inputs/steps/output | Discover loop owner first; create or extend Skill only when selected | `../loop-engineering/loop-discovery.md`, then `skill-discovery.md` for Skill decisions |
| Existing Skill quality, routing, safety, or benchmark review | Evaluate the Skill with Gates, weighted quality, and evidence ceilings | `skill-review.md` |
| Short manually invoked shortcut | Command / Prompt shell | canonical Skill, script, or reference |
| Large conditional detail for a Skill | Add Skill reference | `skill-discovery.md` |
| Visual design source of truth for generated UI | `DESIGN.md` contract or design-review Skill | [DESIGN.md contract](../project-harness/design-md-contract.md) |
| Repeated deterministic transformation or check | Add script under owning capability | relevant Skill or spec |
| One-off external lookup or integration boundary | Use or validate MCP inside current task | `platforms/codex.md` when Codex-specific; `platforms/qoder.md` when Qoder-specific |
| Repeated external-system diagnosis | Discover loop owner first; support with MCP when live access is needed | `../loop-engineering/loop-discovery.md`, then `skill-discovery.md` for Skill decisions |
| Repeated manual safety check | Add or tune Hook | `agent-hooks.md` for host agent hooks; `../project-harness/` for Git/CI safeguards |
| Access must be blocked or approved | Add Permission / Sandbox boundary | host policy plus Hook route |
| Repeated specialist review or investigation role | Custom Agent or Skill-backed review loop | `../loop-engineering/loop-discovery.md`, then `custom-agents-review.md` and the provider-specific reference as selected |
| Practice needs team installation or upgrade | Plugin / host shell | canonical asset plus host package docs |
| Observed preference, repeated correction, or repeated trap | Review asset state and choose Memory/reference only when justified | `knowledge-assets-review.md`, then `memory-review.md`; cite evidence and do not persist raw transcript |
| Non-trivial behavior change | Spec / ADR first | `docs/specs/` or `docs/adrs/` |

## Session-To-Action Route

- Stable repeated prompt with repeatable inputs/steps/output -> run Loop
  Discovery from `../loop-engineering/loop-discovery.md`; read
  `skill-discovery.md` only when the decision is
  `Create Skill` or `Extend Skill`.
- Repeated specialist review or investigation role -> Custom Agent; read
  `../loop-engineering/loop-discovery.md`, then `platforms/qoder.md` or
  `skill-discovery.md` based on the selected owner.
- Reviewed repeated active-long sessions with a separable task family and
  relevant friction -> consider subagents or Experts for work decomposition,
  specialist review, or parallel evidence collection; duration and
  `long-active-review` alone remain investigation leads. Run Loop Discovery
  before recommending a durable Custom Agent, Skill-backed review loop, or
  other owner.
- Repeated manual safety check -> Add or tune Hook; read `agent-hooks.md` for
  host agent hooks, `../project-harness/` for Git/CI safeguards, and
  `platforms/qoder.md` when the target is Qoder-specific.
- Missing repo context, command, or file-scope rule -> add/tune Rule or
  `AGENTS.md`; read `agents-md-review.md`, plus `platforms/codex.md` when
  Codex-specific or `platforms/qoder.md` when Qoder-specific.
- Repeated visual style drift or generated UI inconsistency -> inspect
  `DESIGN.md` with the [DESIGN.md contract](../project-harness/design-md-contract.md); recommend `design-md-review`,
  `design-system-capture`, lint, CI, or hooks only when the evidence supports
  that form.
- Repeated external lookup or integration boundary -> Add or validate MCP; read
  `platforms/codex.md` when Codex-specific and `platforms/qoder.md` when
  Qoder-specific.
- Repeated diagnosis that uses external systems -> Loop Discovery decides the
  owner; MCP is supporting access, and a Skill or Custom Agent is selected only
  when the evidence justifies that surface.
- Hard block, approval, credential, network, or external-state boundary -> add
  Permission/Sandbox policy and a Hook when lifecycle enforcement is needed.
- Team-wide reuse across repositories -> package as Plugin only after the
  canonical Skill, reference, script, hook, or agent role is stable.
- Weak or one-off cluster -> `needs more evidence`.

## Safety Route

- Use Rules to explain the policy and expected behavior.
- Use Permissions/Sandbox to set the hard access boundary.
- Use Hooks to inspect commands, file writes, tool calls, MCP calls, stop
  events, or handoff points; read `agent-hooks.md` for lifecycle placement,
  evidence levels, and implementation gates.
- Use Skills to describe the safe remediation or exception workflow.
- Use Custom Agents for independent review of sensitive or broad diffs.
- Use CI or external policy checks as final evidence when available.

Do not claim a safety practice is enforced from static file presence alone.
Separate configured policy, hook content, hook execution evidence, and CI/policy
results.

## Promotion Thresholds

- **Skill**: repeated or costly demand, stable trigger, stable inputs,
  repeatable steps, clear output, and validation path.
- **Loop Spec**: repeated or schedulable demand, stable trigger, input context,
  verification path, stop condition, permission boundary, and human gate.
- **Command / Prompt**: short manual trigger with narrow input and output; move
  broad or multi-step behavior into a Skill or script.
- **Custom Agent**: a reusable specialist role needs isolated context,
  independent judgment, or parallel evidence collection.
- **Hook / Permission**: the risk requires deterministic blocking, approval,
  logging, or validation.
- **MCP**: the workflow needs live external data, external actions, or
  structured resources outside the repository.
- **Plugin**: canonical assets are stable, validated, installable, and have a
  drift-check or mirror-check path.
- **Memory**: the preference or lesson is explicit, repeated, and safe to
  persist under the active host policy.

## Evidence Rules

- Separate presence, content quality, and runtime execution evidence.
- Cite concrete files, commands, session ids, reports, plugin metadata, or
  opened external records.
- Treat external systems as unavailable unless actually opened or provided.
- Do not infer execution, Story status, tracker state, or AI involvement from
  filenames, branch names, timestamps, or prose style.
- Keep report projection inside existing readiness dimensions unless a separate
  spec explicitly changes the report contract.

## Platform Notes

Load only the selected platform route after the shared owner and evidence rules
identify the relevant practice surface. The following platform sections own
host paths, native actions, and configured-surface details.

## Qoder Asset Route

For Qoder-specific actions, use `platforms/qoder.md` as the taxonomy for Rules,
Hooks, Skills, Custom Agents, MCP, and Plugins. Presence is not execution proof.

For Memory title overlap, enabled Plugin name/capability overlap, or Hook
count/duplicate/fan-out pressure, run `<cli> coding-agent-practices
asset-integrity <provider> --workspace <target> --json`. The Qoder and Codex
routes preserve their provider boundaries; the scan is metadata-only and never
authorizes mutation.

Inspect configured surfaces before projecting readiness evidence:

- `.qoder/rules` and project/user rules for guidance.
- Qoder hooks/settings for lifecycle enforcement.
- `.qoder/skills`, user skills, `.agents/skills`, and plugin skills for
  workflows and mirrors.
- Qoder Custom Agents for specialist roles.
- MCP config for external capabilities.
- `.qoder-plugin/` and installed plugin metadata for packaging.

Use the Global/User Asset Pass from `global-assets.md` when the user asks about
Qoder Settings tabs, global assets such as `~/.qoder/skills` or
`~/.qoder/hooks`, installed plugins, marketplace assets, or memories. Keep
configured inventory evidence separate from observed session behavior.
For a Qoder memory claim, then load `memory-review.md`; primary project scope
precedes cache mirrors and personal categories remain outside engineering review
unless the current task explicitly needs them.
If Qoder has only 0-2 relevant described Skills and repeated workflow evidence
has no matching Skill owner, recommend `/create-skill <workflow description>` as
the Qoder-native customization path. Do not report low Skill count as failure by
itself.

## Codex Asset Route

For Codex-specific actions, use `platforms/codex.md` as the operating
practice reference for prompt shape, Plan mode, `AGENTS.md`, `.codex` config,
testing and review loops, MCP, Skills, automations, thread controls, worktrees,
and subagents. Presence is not execution proof.

Inspect configured surfaces before projecting readiness evidence:

- `AGENTS.md` and nested agent guidance for durable repo context.
- `.codex/config.toml` and user config for model, approval, sandbox, profiles,
  feature flags, MCP servers, and defaults.
- `.agents/skills`, project skills, user skills, and packaged plugin skills for
  repeatable workflows.
- MCP configuration and connector availability for external context.
- Codex automations and worktrees for scheduled or parallel workflows.
- Codex generated memory metadata for recall candidates; load
  `memory-review.md` before treating it as a user preference, applied lesson,
  or current project fact.
- Session, diff, test, build, and review evidence for observed execution.

## Qwen Asset Route

For Qwen Code-specific actions, use `platforms/qwen.md` as the operating
practice reference for prompt shape, `QWEN.md`, `.qwen` config, testing and
review loops, MCP, Skills, automations, worktrees, and subagents. Presence is
not execution proof.

Inspect configured surfaces before projecting readiness evidence:

- `QWEN.md` and `AGENTS.md` for durable repo context.
- `.qwen/settings.json` and user settings for model, approval, sandbox, MCP
  servers, and defaults.
- `.qwen/skills`, project skills, user skills, and extension skills for
  repeatable workflows.
- MCP configuration (`~/.mcp.json` and project `.mcp.json`) and connector
  availability for external context.
- Qwen extensions under `~/.qwen/extensions/` for installed plugin metadata;
  each extension carries a `.qwen-extension-install.json` marker with a
  `source` pointer to the real plugin root.
- Session, diff, test, build, and review evidence for observed execution.

Use the Global/User Asset Pass from `global-assets.md` when the user asks about
Qwen global assets such as `~/.qwen/skills` or `~/.qwen/hooks`, installed
extensions, or memories. Keep configured inventory evidence separate from
observed session behavior.
