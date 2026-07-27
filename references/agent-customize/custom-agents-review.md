# Custom Agent Review

Use this reference when Custom Agents, subagents, agent profiles, specialist
roles, or delegated-work quality are in scope. Inventory answers how many
Agents are configured; this review asks whether each Agent can be selected,
bounded, and trusted for its intended role.

## Best-Practice Summary

The common contract across Qoder, Codex, Claude Code, and GitHub Copilot is:

- give each Agent one focused specialist role rather than a broad duplicate of
  the main Agent;
- write a specific description because automatic delegation depends on it;
- make the system prompt state scope, expected output, and important limits;
- grant only the tools, Skills, and MCP access needed for that role;
- use isolated context for bounded exploration, tests, triage, or independent
  review, while the main Agent owns synthesis and the final decision;
- keep project Agents versioned with the repository and keep user Agents for
  genuinely reusable personal roles.

Qoder requires `name` and `description`, supports `tools`, `model`, `skills`,
and `mcpServers`, and uses the description for automatic selection. Codex
recommends subagents for bounded exploration, tests, and triage so the main
thread stays focused. Claude Code requires `name` and `description`, recommends
focused prompts and limited tools, and treats omitted tools as inherited access.
GitHub Copilot requires `description`, uses the Markdown body as the prompt,
and enables all available built-in and MCP tools when `tools` is omitted.

Official grounding:

- Qoder Custom Agent: https://docs.qoder.com/extensions/subagent
- OpenAI Codex best practices:
  https://developers.openai.com/codex/learn/best-practices
- Claude Code subagents: https://code.claude.com/docs/en/sub-agents
- GitHub Copilot custom-agent configuration:
  https://docs.github.com/en/copilot/reference/custom-agents-configuration

## Evidence Ladder

- **Configured**: an Agent profile exists in a supported project, user, or
  plugin location.
- **Valid**: required metadata and a non-empty prompt parse successfully.
- **Bounded**: the role, output, and tool/permission boundary are explicit.
- **Observed**: a bounded session shows the Agent was invoked.
- **Effective**: the Agent returned a relevant result that the main task used or
  independently verified.

Presence, count, or a plausible name never proves delegation or effectiveness.

## Deterministic Checks

The static evaluator may create findings for:

- missing or malformed frontmatter;
- missing required `name` for Qoder/Claude-style profiles;
- invalid lowercase/hyphen identifiers where the provider requires them;
- a declared name that drifts from the invocable filename;
- missing or very short descriptions that cannot route a task reliably;
- an empty or extremely short system prompt;
- a prompt above the provider-safe 30,000-character ceiling;
- missing local Markdown references;
- explicit `read-only` or review-only scope paired with `Edit`/`Write` tools;
- omitted or wildcard tool declarations, reported as an unbounded-access
  advisory rather than a universal failure.

Opaque semantic similarity must not create a duplicate-role finding. A project
Agent shadowing a user or plugin Agent is not automatically a defect; report
the effective precedence only when the provider contract proves it.

## Count And Pressure

Always report the configured Agent count and source scopes. Count alone is
unrated: official providers do not publish a universal maximum, and zero Custom
Agents is valid when there is no repeated specialist role. Add a pressure
finding only when concrete evidence exists, such as exact name collisions,
unbounded tool inheritance, repeated unused routing, or overlapping observed
delegation.

## Reader Summary

Keep the visible summary to one sentence:

```text
Custom Agents score 86 (B); 3 configured, with one profile missing a clear tool boundary.
```

When scoring evidence is unavailable:

```text
3 Custom Agents are configured, but their profile content was not reviewed.
```

The summary names count, score when supported, and the most important bounded
problem. Detailed checks remain ordinary findings with source paths and a
focused repair prompt.

## Review Result

Report:

- configured count and Project / Global / Plugin scopes;
- score, grade, risk, confidence, and static/observed evidence state;
- prompt and tool-boundary metrics without embedding prompt content;
- at most one compact surface summary;
- grouped findings for repair-worthy profile problems.

Do not expose raw system prompts, secrets, environment values, session
transcripts, or absolute user-home paths in the durable report.
