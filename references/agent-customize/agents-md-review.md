# Agent Instructions Review Reference

Use this reference when reviewing `AGENTS.md`, `CLAUDE.md`, or other AI agent operating guides.

## Core Idea

Treat agent instruction files as operating guides, not READMEs, tutorials, architecture documents, or generic best-practice lists.

A good instruction file is:

- short
- accurate
- executable
- repo-specific
- scoped to the right directory
- safe around risky operations
- portable across agent tools
- designed for progressive disclosure

## Signal Budget

Treat every line as context cost. Include guidance only when it prevents an
agent mistake that the repository cannot make obvious by inspection.

- Include exact custom commands, required versions, non-standard tooling,
  counterintuitive code patterns, and safety boundaries.
- Prefer one current repo-specific command or snippet over a paragraph of
  abstract guidance.
- Put commands and critical risk rules early; long sessions are more likely to
  lose low-signal middle content.
- Exclude architecture tours, directory inventories, and README duplication
  unless they describe a trap the agent cannot infer.
- Treat generated or `/init`-style instruction files as unproven until a human
  has removed redundancy, verified commands, and tied rules to observed needs.

## Progressive Disclosure

- Root instructions contain only always-needed guidance.
- Nested instructions contain local module rules.
- Long workflows are linked, not embedded.
- Detailed playbooks live in docs, skills, workflows, or tool-specific files.
- The agent should receive minimum context first and load deeper context only when relevant.
- Place critical global rules in the root file before longer local guidance.

When progressive disclosure is a finding, include a short reader-facing
explanation: progressive disclosure is a context-engineering practice where the
root agent guide stays lean, the agent first discovers the relevant route, and
deeper docs, skills, workflows, or data are loaded only when task-relevant. This
reduces instruction bloat and context rot.

## Length And Density Gates

Line count is a review trigger, not a quality score. Use it to inspect whether
the root file is carrying always-needed guidance or hiding docs that should be
loaded only when relevant.

- `<=80` lines: healthy root size when commands and risk rules are complete.
- `81-120` lines: acceptable for multi-tool or multi-runtime repositories.
- `121-180` lines: borderline; require a clear split rationale and links to
  deeper docs instead of embedded workflows.
- `>180` lines: overloaded root by default. Do not label it `A` or `High`
  quality unless most content is short, repo-specific, always-needed operating
  policy and there is clear progressive disclosure.
- `200+` lines in a root-only `AGENTS.md` or `CLAUDE.md` is a finding. Recommend
  extracting local module rules, long workflows, architecture background, and
  tool-specific details before calling the instruction file high quality.

For long roots, record the line count, whether nested instruction files exist,
and which sections should move. A 207-line root guide should normally be
reported as context overload, not simply as "high quality".

## AGENTS.md And CLAUDE.md Split

- Put cross-tool project facts and safety rules in `AGENTS.md`.
- Put Claude-only syntax, permissions, slash commands, or tool quirks in
  `CLAUDE.md`.
- If both files exist, flag duplicated or conflicting rules and identify the
  canonical source.
- For multi-tool teams, prefer one canonical `AGENTS.md` plus small wrappers or
  links for vendor files. Use symlinks only when the team supports them across
  Windows, macOS, and Linux; otherwise keep vendor files short and explicit.
- Do not let a vendor-specific file become the only source of project operating
  policy unless the repository intentionally supports only that agent.

## Host-Aware Source Ledger

Do not compare every instruction-looking file as though every host loads it.
Keep one evidence ledger per selected provider:

- **Qoder**: user Rules under `~/.qoder/rules`, project `.qoder/rules`, then the
  project-root `AGENTS.md` compatibility source. Do not assume
  `~/.qoder/AGENTS.md` or nested `AGENTS.md` is active until the selected Qoder
  runtime proves it.
- **Claude Code**: `~/.claude/CLAUDE.md` plus active ancestor, project, and
  nested Claude instruction sources.
- **Codex**: `~/.codex/AGENTS.md` plus active ancestor, project, and nested
  `AGENTS.md` sources.

Files from an unselected provider are inventory evidence only. They cannot
create a duplicate, conflict, or context-pressure finding for the selected host.

## Deterministic Overlap And Conflict Review

- Report exact normalized paragraph/block duplicates with both source
  locations.
- Report repeated command lines after whitespace and path-separator
  normalization.
- Report high-confidence section overlap only when stable normalized lines are
  substantially shared; do not delete text from an opaque LLM similarity score.
- Require a narrow visible contradiction for conflicts, such as two package
  managers, mutually exclusive commands, opposing permission rules, or
  `must`/`never` statements over the same operation.
- A similar topic with different scopes is not a conflict.

## Root, Rule, Or Skill Decision

- Keep always-needed cross-tool project facts, commands, and safety boundaries
  in root `AGENTS.md`.
- Move Qoder path-, file-, or task-scoped guidance to `.qoder/rules`.
- Move a repeatable multi-step workflow with stable trigger, inputs, output,
  failure modes, and validation to a Skill.
- Keep explanatory architecture or tutorials in normal docs and link them only
  when task-relevant.

Every split proposal names the canonical owner and shows the source pair. A
Checkup may propose a patch, but mutation still needs the confirmed repair flow.

## Observability Navigation

When the project owns runtime, service, distributed, asynchronous, UI/E2E, or
other behavior that can fail outside a compiler message, review whether the
operating guide gives an agent a minimal route into its actual logging and
observability architecture. Load [Observability](../project-harness/observability.md) for the
direct AI-debug readiness check.

Keep only non-inferable, always-needed facts in root `AGENTS.md`:

- the actual logging facade/framework and a link to its project architecture;
- exact local start, focused reproduction, and focused-test commands;
- where local logs, captured test output, traces, crash reports, or E2E
  artifacts appear, including format, process/component-to-file mapping, and
  the profile/level switch;
- the request, trace, session, task, test, or run identity and how an agent
  supplies or filters it;
- inaccessible, encrypted, or remote-only sinks plus access, redaction,
  production-safety, and retention boundaries.

Reject a route that names only one operating-system path when the repository
supports several platforms, or one log directory when a multi-process runtime
requires the agent to choose among main/server, renderer/client, worker/shared,
extension/plugin, and child-service output. Verify linked document content;
`Observable` state-management guidance is not an observability architecture.

Do not embed a dashboard catalog, architecture tutorial, credentials, production
endpoints, or long query recipes. Logging style rules alone are insufficient:
the guide must expose how the agent runs and consumes the existing framework.
Do not require observability boilerplate for a project whose standard local
failure path is already obvious, runnable, readable, and correlated.

## Must-Have Sections

1. **Project facts the agent should not guess**: package manager, exact runtime
   versions, non-standard tooling, app structure, key services.
2. **Commands**: install, typecheck, lint, test, build, start, verify one
   changed area, and run one focused test with full flags.
3. **Counterintuitive patterns**: APIs that behave differently than common
   training examples, required helper utilities, forbidden APIs, representative
   snippets when they clarify behavior.
4. **Decision rules**: when to ask, when to plan, when to use a tool, when not
   to touch files.
5. **Risk controls**: destructive commands, credentials, production changes,
   migrations, releases, generated files, and protected directories.
6. **AI-debug route when applicable**: actual logging facade, start/reproduction
   and focused-test commands, readable output location, correlation semantics,
   profile switch, and safe access boundaries, with deeper architecture linked
   instead of embedded.

## Example Fragments

For concrete examples of high-signal rules, read
`examples/agents-md-good-examples.md`. Use those snippets as review anchors,
not as a pasteable universal template.

## Review Criteria

- [ ] Root file is concise enough to stay in context comfortably.
- [ ] Root file length passes the Length And Density Gates, or the overload is
      called out as a finding.
- [ ] `AGENTS.md` and `CLAUDE.md` responsibilities are split without conflicting
      canonical rules.
- [ ] Most guidance is non-inferable from code, README, or standard framework
      conventions.
- [ ] It avoids duplicating README/docs.
- [ ] Commands are copy-pasteable and current.
- [ ] Exact versions and non-standard tools are stated when they affect agent
      choices.
- [ ] Critical safety boundaries are early and explicit.
- [ ] Runtime-bearing projects expose a minimal, current AI-debug route naming
      the actual framework, runnable reproduction, readable output, correlation,
      and blockers, or explicitly prove a sufficient standard framework path.
- [ ] It states what not to do for risky areas.
- [ ] Approval requirements are explicit.
- [ ] Language is imperative and direct.
- [ ] Nested modules have local instruction files where needed.
- [ ] The file explains repo-specific traps, not generic programming advice.
- [ ] Stale, generated, or speculative rules are identified for removal.

## Anti-Patterns to Flag

- Full architecture docs embedded in root instructions.
- Root files above 180 lines with no nested instructions or linked deep docs.
- Generic best practices unrelated to the repo.
- Auto-generated context committed without human curation and command
  verification.
- Directory tours or architecture summaries that duplicate discoverable repo
  structure.
- Rule accumulation from one-off agent mistakes without pruning old rules.
- Critical safety rules buried after long background sections.
- A 200+ line `CLAUDE.md` or `AGENTS.md` scored as high quality without a
  context-overload finding.
- Cross-tool policy hidden only in a vendor-specific file.
- CI/CD details that contradict actual pipeline config.
- Commands that rewrite lockfiles or switch package managers without approval.
- Instructions that require unavailable tools.
- Tool-specific details that should be in a skill or command instead.
- Logging style rules with no start/reproduction command or log-consumption
  route.
- A platform-specific log path presented as the whole route for a cross-platform
  project.
- A linked file whose name suggests observability but whose content describes a
  different concept.
- Full observability architecture, dashboard inventories, production endpoints,
  credentials, or private query details embedded in root instructions.

## Score Calibration

- `A` / `High`: concise, human-curated, current, repo-specific,
  non-inferable, and progressively disclosed.
- `B`: useful but slightly long, missing a split, carrying some docs content,
  or needing minor command/staleness verification.
- `C`: root is overloaded, vendor-specific policy is mixed with shared policy,
  generated or stale content is present, or commands/risk rules need
  verification.
- `D` / `F`: stale, unsafe, generic, contradictory, or unable to guide an agent
  through common repo work.

Cap the score at `B` when the root file is above 180 lines unless the review
shows explicit evidence that the extra length is unavoidable and still
always-needed. Cap it at `C` when a 200+ line root file has no progressive
disclosure path.

## Output Template

```markdown
### Agent instruction review
- **Score**: A | B | C | D | F
- **Main risk**: ...
- **Missing facts**: ...
- **Non-inferable signal**: what only this file tells the agent
- **Overloaded context**: line count, split target, and score cap if any
- **Why this matters**: short reader-facing explanation for progressive
  disclosure, instruction bloat, context rot, or other non-obvious agent
  guidance concepts
- **Unsafe or stale instruction**: ...
- **AI-debug route**: Ready | Partial | Blocked | not applicable; name the
  framework and earliest missing gate
- **Maintenance drift**: generated, duplicated, or outdated content to remove
- **Recommended patch**: ...
```
