# Codex Best Practices

Reference note: based on OpenAI's official Codex best-practices guide:
https://developers.openai.com/codex/learn/best-practices. Reviewed against the
current Codex manual on 2026-07-06.

Use this file for Codex-specific operating practice. Use `../routing.md` for
host-neutral owner selection and `qoder.md` for Qoder-specific
feature taxonomy. Do not copy Codex-only workflow advice into Qoder docs unless
there is matching Qoder surface evidence.

## Operating Frame

Treat Codex as a configured teammate, not a one-off assistant. Start with the
right task context, move repeated guidance into `AGENTS.md`, configure Codex for
the real workflow, connect external systems through MCP, turn repeated work into
Skills, and automate only stable workflows.

## Prompt Shape

A strong first prompt has four parts:

- **Goal**: the change, bug, review, artifact, or decision needed.
- **Context**: files, folders, docs, examples, logs, errors, screenshots, or
  other material Codex should inspect.
- **Constraints**: architecture rules, safety limits, review standards,
  platform requirements, and do-not-touch boundaries.
- **Done when**: tests, checks, behavior, output files, or review evidence that
  prove the task is complete.

Pick reasoning effort to match task difficulty: low for small scoped work,
medium or high for complex changes and debugging, and extra high for long
agentic work.

## Planning

Use planning before complex, ambiguous, or high-risk implementation. Good
patterns:

- Use Plan mode when Codex should inspect context, ask clarifying questions, or
  produce an implementation plan before editing.
- Ask Codex to interview the requester when the goal is fuzzy.
- Use a `PLANS.md` or execution-plan template for long-running multi-step work
  when the repository already owns that workflow.

Planning is a control surface, not a permanent artifact requirement. Do not add
plans when the task is already small, obvious, and easy to verify.

## Durable Guidance

Use `AGENTS.md` for repository guidance that should load automatically:

- repo layout and important directories
- build, test, lint, and local run commands
- engineering conventions and review expectations
- safety constraints and do-not rules
- what "done" means and how to verify work

Keep `AGENTS.md` short and practical. Put large or conditional detail in linked
references. Use global `~/.codex/AGENTS.md` for personal defaults, repo-level
`AGENTS.md` for shared standards, and nested `AGENTS.md` files for subtree
rules. The closest applicable file wins.

When Codex repeats a mistake, ask for a retrospective and update the durable
guidance only when the lesson is reusable.

## Configuration

Codex configuration should match the actual environment:

- Use `~/.codex/config.toml` for personal defaults.
- Use `.codex/config.toml` for repo-specific behavior.
- Use CLI overrides only for one-off situations.
- Keep approval and sandbox settings tight until a trusted workflow needs more
  access.

Many weak results are setup problems: wrong working directory, missing write
access, unavailable tools, wrong model defaults, or missing connectors. Verify
environment assumptions before turning a local setup issue into a prompt rule.

## Reliability Loop

Do not stop at code generation. A complete Codex change should define and run
the relevant verification loop:

- create or update tests when risk justifies it
- run the focused test suite before broader checks
- run lint, formatting, type checks, or build checks when relevant
- confirm the behavior or artifact matches the request
- review the diff for bugs, regressions, risky patterns, unrelated edits, and
  missing tests

Use `/review` for PR-style review, uncommitted changes, commits, or custom
review instructions. For team consistency, keep reusable review expectations in
a `code_review.md` file referenced from `AGENTS.md`.

## External Context

Use MCP when Codex needs context or actions outside the repository:

- the data changes frequently
- the source is an external tool or system
- repeated users or projects need the same integration
- the workflow benefits from tools instead of pasted context

Start with one or two MCP tools that remove a real repeated manual step. Do not
wire every possible external system just because the connector exists.

## Skills

Turn a repeated workflow into a Skill when it has stable triggers, inputs,
steps, outputs, failure modes, and validation. Keep the first version narrow:
two or three concrete use cases are enough. Add scripts, references, or assets
only when they improve repeatability or verification.

Good Codex Skill candidates include log triage, release notes, PR review
against a checklist, migration planning, telemetry summaries, incident
summaries, and standard debugging flows. Package a Skill as a plugin only after
the canonical workflow is stable enough to share.

## Automations

Use automations for stable scheduled work. Skills define the method;
automations define the schedule, project, prompt, cadence, and execution
environment. Use automations for maintenance and reflection as well as
execution: summarize repeated friction, recent commits, release notes, likely
bugs, CI failures, or recurring analysis.

Do not automate a workflow that still needs frequent steering. Make it a Skill
first, validate it manually, then schedule it.

## Session Controls

Keep one Codex thread per coherent unit of work. Resume or compact when the
same problem continues; fork only when the work truly branches. Use worktrees
when concurrent threads could edit the same files.

Use subagents for bounded exploration, testing, triage, or independent review
while the main thread owns the final decision and implementation.
Use [Custom Agent Review](../custom-agents-review.md) when configured Agent
profiles, their descriptions, prompts, tool boundaries, or inventory count need
quality review.

## Common Failure Patterns

- Durable rules stay in prompts instead of moving into `AGENTS.md`, Skills, or
  references.
- Build and test commands are not visible, so Codex cannot verify its work.
- Complex tasks skip planning.
- Permissions are broadened before the workflow is understood.
- Multiple live threads edit the same files without worktrees.
- A recurring task becomes an automation before it is reliable manually.
- One long thread is used for an entire project instead of one task.

## Harness Projection

For readiness reports, separate static presence from quality and execution:

- `AGENTS.md`, `.codex/config.toml`, Skills, MCP config, automations, hooks, and
  subagents are configured-surface evidence.
- Test output, build logs, reviewed diffs, session traces, and automation
  histories are execution evidence.
- Do not claim a Codex practice is effective from file presence alone.
