# Qoder Feature Overview and Official Examples

This document summarizes Qoder's main extension capabilities based on the
official Qoder documentation. Each feature keeps only a brief introduction and
copyable official examples. Replace placeholders in the examples with values
from your actual environment.

Use this file as the Qoder-specific feature taxonomy for Rules, Hooks, Skills,
Custom Agents, MCP, and Plugins. For shared owner selection, start from
`../routing.md`; for Codex-specific operating practice, use
`codex.md`. Do not mirror Codex workflow guidance here unless
there is matching Qoder surface evidence.

## Rules

> Official documentation: https://docs.qoder.com/user-guide/rules

**Feature Summary**

Rules configure project-level context so Qoder can follow the project's
frameworks, code style, and team preferences in Chat, Inline Chat, and Agent
Mode. Rules are stored in `.qoder/rules` and can be shared with the repository
or kept local-only.

**Official Examples**

Manually reference a rule in Chat or Inline Chat:

```text
@rule
```

Example applicability description for the `Model Decision` type:

```text
Generate a unit test.
```

Example file pattern for the `Specific Files` type:

```text
*.md, src/*.java
```

Official rule types:

| Type | Purpose |
|---|---|
| `Apply Manually` | The user applies the rule manually with `@rule` |
| `Model Decision` | Agent Mode decides whether to apply the rule based on its description |
| `Always Apply` | Applies to all Chat and Inline Chat requests |
| `Specific Files` | Applies only to matching files |

## Hooks

> Official documentation: https://docs.qoder.com/extensions/hooks

**Feature Summary**

Hooks are automation scripts in the Qoder Agent lifecycle. A script receives a
JSON event context from `stdin` and controls whether execution should continue
through its exit code or standard output.

**Official Examples**

Safety note for Better Harness reports: the official snippets below demonstrate
Qoder hook mechanics, not final security posture. Do not echo full shell
commands, raw prompts, environment values, or suspected secrets in denial
messages. For copyable guardrails, prefer Node.js or Python entrypoints over
Bash plus `jq` so Windows, macOS, and Linux projects can use the same script.

Copy this as a Hook script, for example `check-command.sh`:

```bash
#!/bin/bash

input=$(cat)
tool_name=$(echo "$input" | jq -r '.tool_name')
tool_input=$(echo "$input" | jq -r '.tool_input')

if [ "$tool_name" = "Bash" ]; then
  command=$(echo "$input" | jq -r '.tool_input.command')

  if echo "$command" | grep -qE 'rm\s+-rf|DROP\s+TABLE'; then
    echo "Operation denied: $command" >&2
    exit 2
  fi
fi

exit 0
```

Register the script in the settings file:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [
          {
            "type": "command",
            "command": "./check-command.sh"
          }
        ]
      }
    ]
  }
}
```

When finer control is needed, output JSON to `stdout` while exiting with
`exit 0`:

```bash
#!/bin/bash
input=$(cat)

echo '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"This operation is not allowed"}}'
exit 0
```

Common events and matchers:

| Event | Example Matcher | Purpose |
|---|---|---|
| `PreToolUse` | `Bash` | Check before tool execution |
| `PostToolUse` | `Write \| Edit` | Process after file writes or edits |
| `PostToolUseFailure` | `Bash` | Process after tool failure |
| `UserPromptSubmit` | No matcher required | Process when the user submits a prompt |
| `Stop` | No matcher required | Process after the Agent stops |
| `PreToolUse` | `mcp__.*` | Intercept MCP tool calls |

Exit code meanings:

| Exit code | Meaning |
|---:|---|
| `0` | Allow execution to continue |
| `2` | Block the current action |
| Other non-zero values | Report an error but continue execution |

## Skills

> Official documentation: https://docs.qoder.com/extensions/skills

**Feature Summary**

Skills are reusable Agent capabilities, usually described by a `SKILL.md` file.
Qoder can trigger a Skill automatically based on the user's request, or the user
can trigger one manually with `/skill-name`.

**Official Examples**

Automatic trigger example:

```text
Analyze the errors in this log file
```

Manual trigger example:

```text
/log-analyzer
```

Create a Skill with the built-in assistant:

```text
/create-skill <Skill description, e.g., convert Word documents to PDF>
```

When Qoder is in scope and the visible relevant Skill descriptions are low
(0-2 matching described Skills), suggest `/create-skill <workflow description>`
for repeated workflows that have no matching Skill coverage. Treat this as a
workflow-customization suggestion, not proof of failure from count alone.

Install a Skill from the skills.sh marketplace:

```bash
npx skills add vercel-labs/agent-browser -a qoder
```

Install a specific Skill from GitHub:

```bash
npx skills add https://github.com/anthropics/skills --skill skill-creator -a qoder
```

Skill file locations:

```text
~/.qoder/skills/{skill-name}/SKILL.md
.qoder/skills/{skill-name}/SKILL.md
```

Official scenario examples:

| Skill | Scenario |
|---|---|
| `log-analyzer` | Analyze log errors |
| `api-doc-generator` | Generate API documentation |
| `code-reviewer` | Perform code review |

## Custom Agents

> Official documentation: https://docs.qoder.com/extensions/subagent

Use [Custom Agent Review](../custom-agents-review.md) for provider-neutral content
quality, tool-boundary, count, and report-summary checks. This section owns the
Qoder file format and invocation examples only.

**Feature Summary**

A Custom Agent is a Qoder Agent specialized for a specific task. Each Agent can
define its own name, description, tool permissions, model, Skills, MCP servers,
and system prompt.

**Official Examples**

Create an Agent with the built-in assistant:

```text
/create-agent <Your requirement, e.g., code review expert>
```

Agent file locations:

```text
~/.qoder/agents/<agentName>.md
${project}/.qoder/agents/<agentName>.md
```

Copy this as `code-review.md`:

```markdown
---
name: code-review
description: Code review expert, checks code quality and security
tools: Read, Grep, Glob, Bash
model: "[ModelName](modelId)"
skills:
  - {skillName1}
  - {skillName2}
mcpServers:
  - {mcpServerName1}
  - {mcpServerName2}
---

You are a senior code reviewer responsible for ensuring code quality.

Review checklist:
1. Code readability
2. Naming conventions
3. Error handling
4. Security checks
5. Test coverage
```

Natural-language trigger:

```text
Help me review the implementation of this interface
```

Manual trigger:

```text
/code-review
```

## MCP

> Official documentation: https://docs.qoder.com/user-guide/chat/model-context-protocol

**Feature Summary**

MCP connects external systems and data sources to Qoder. Qoder selects a
suitable MCP tool based on the user's input, the tool name, and the tool
description, then asks for confirmation before calling it.

**Official Examples**

Configure a remote SSE `fetch` server:

```json
{
  "mcpServers": {
    "fetch": {
      "type": "sse",
      "url": "https://mcp.api-inference.modelscope.net/******/sse"
    }
  }
}
```

Use the `fetch` server:

```text
Summarize this document: https://docs.qoder.com/user-guide/chat/overview
```

Configure a local STDIO `weather` server:

```json
{
  "mcpServers": {
    "weather": {
      "command": "npx",
      "args": [
        "-y",
        "@h1deya/mcp-server-weather"
      ]
    }
  }
}
```

Use the `weather` server:

```text
Check the weather in San Francisco, United States
```

Follow-up question:

```text
Are there any weather alerts in the United States tomorrow?
```

## Plugins

> Official documentation: https://docs.qoder.com/extensions/plugins

**Feature Summary**

Plugins package Skills, Commands, and MCP capabilities into installable units
that extend Qoder's domain knowledge or external tool integrations. The
official documentation states that Plugins are currently available only in
Quest.

For inventory-backed review, count a Plugin only when the installed index
supports it and `settings.json.enabledPlugins` does not disable it. A
settings-only entry is diagnostic, not installation evidence.

**Official Examples**

Capabilities a plugin can include:

| Component | Purpose |
|---|---|
| `Skills` | Provide specialized Agent capabilities for complex tasks |
| `Commands` | Provide commands or shortcut actions executable by the Agent |
| `MCP Servers` | Provide external tool or data source integrations |

Marketplace usage flow:

1. Open Marketplace in the IDE.
2. Select a plugin and open its detail page.
3. Review the Skills, Commands, or MCP Servers included in the plugin.
4. Click install.
5. Manage versions and enabled status in the Installed list.
6. Click `Try now` to start an Agent session and try the plugin capabilities.

View plugin capabilities after installation:

| Page | Visible Content |
|---|---|
| Qoder Settings / Skills | Skills introduced by the plugin |
| Qoder Settings / Commands | Commands introduced by the plugin |
| Qoder Settings / MCP | MCP servers introduced by the plugin |

## Documentation Links

- Rules: https://docs.qoder.com/user-guide/rules
- Hooks: https://docs.qoder.com/extensions/hooks
- Skills: https://docs.qoder.com/extensions/skills
- Custom Agents: https://docs.qoder.com/extensions/subagent
- MCP: https://docs.qoder.com/user-guide/chat/model-context-protocol
- Plugins: https://docs.qoder.com/extensions/plugins
