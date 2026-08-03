# Sessions Diagnostics

Analyze session evidence as a local engineering workflow. Keep claims tied to
files, logs, transcripts, metrics, or observed behavior.

## Bundled Tools

Use `scripts/session-analysis.mjs` for structured session inventory before manual
JSONL inspection. Resolve `<node>` through
`../tool-runtimes/node-runtime-discovery.md` if PATH `node` is unavailable or
fails validation:

```bash
# Discover evidence roots for a workspace
<node> scripts/session-analysis.mjs sources --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo

# Session list with event counts and time range
<node> scripts/session-analysis.mjs facets --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo --limit 20

# Compact insight cards and action candidates
<node> scripts/session-analysis.mjs insights --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo --limit 20

# Read single session events
<node> scripts/session-analysis.mjs show --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo --session-id <id> --include-events

# Diagnose the facts admission funnel and resolve candidate refs to local sessions
<node> scripts/session-analysis.mjs facts --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo --selection all-eligible --limit 5 --debug --output /tmp/session-facts-debug.json

# Expand one debug locator with normalized commands and user text
<node> scripts/session-analysis.mjs show --platform <qoder|codex|claude|cursor|qwen|copilot|pi|workbuddy|grok> --workspace /path/to/repo --session-id <id> --include-events --include-command-text --include-user-text
```

`facts --debug` is an operator-only diagnostic route. It exposes raw session
ids under `debug.locators`, so never send that envelope to the Session Evidence
agent or copy it into a report. Compare `admission`, `omitted`,
`populationCoverage`, `observationCoverage`, and `diagnosticFlags` before
opening only the candidate sessions needed to explain a surprising aggregate.
Command and user text flags are also local-only and must not be used for broad
transcript dumps.

Supported platforms: `qoder`, `codex`, `claude`, `cursor`, `qwen`, `copilot`, `pi`, `workbuddy`, and `grok`. Do not invent
unsupported platform names.
Always pass the absolute target workspace and load the matching Platform Notes
before interpreting source roots or workspace bindings.
Fall back to direct JSONL reads when the script is unavailable or you need
user-prompt text extraction beyond event structure.

Treat any heuristic match as a candidate until the
important findings are manually checked.

## Coding Agent Session Research

Use this flow when platform project or user assets, Session Insights,
validation habits, workflow friction, or repeated coding-agent workflows are
in scope:

1. Resolve the absolute target workspace and list the platforms in scope.
2. Run `session-analysis.mjs sources` for each analyzer-supported platform in
   scope before declaring roots absent.
3. Use the selected Platform Notes to confirm which discovered roots and
   records bind to the target workspace.
4. Run `facets` with the same `--platform` and `--workspace` when `sources`
   reports enabled roots or sessions; otherwise record the source-probe result
   as the no-session boundary.
5. Run `insights` with the same scope when a user-facing report, recommendation,
   or review action needs the most important session signals. Use `facets` as
   aggregate evidence and `insights` as the compact card/action input.
   `insights.keySignals.longSessions` separates active long sessions from
   wall-span-only idle/resume sessions.
6. Use `show --include-events` only for bounded samples that support important,
   surprising, or high-impact claims.
7. For important aggregate items, expand the counter before turning it into a
   report claim. Use `facets.topHookCommands` or `insights.keySignals.topHookCommands`
   to identify hook command/script targets such as
   `PostToolUse -> node hooks/post-tool.mjs`; if no command is present in the
   event data, compare with configured hook inventory and label those commands
   as configured candidates instead of observed script execution.
8. For Goal, Plan, and Spec workflow evidence, use `planningSignals` from
   `facets` or `insights`. `workspace` signals prove current-project observed
   behavior; `user-global` signals prove user/global capability only. Static
   specification directories or goal database files are project-binding or
   state evidence, not observed Goal/Plan use unless matching session evidence
   exists.
9. Join static assets and session behavior explicitly: configured Rules, Skills,
   MCP, hooks, agents, or plugins are presence/content evidence; observed tool
   calls, hook events, permission decisions, validation commands, and errors are
   execution evidence.
10. Treat `long-active-review` as an outcome-review lead. Classify task family,
    outcome, and friction before considering decomposition, subagents, Experts,
    tooling, or model changes. Run Loop Discovery only after reviewed repeated
    evidence supports a durable Custom Agent, Skill-backed review loop, or
    other owner. Do not recommend delegation from wall-span-only sessions.
11. Report one platform at a time unless the user asks for comparison. Keep
    separate evidence ledgers for every in-scope provider and compare only after
    each platform has its own source probe and bounded facets.
12. Return to `routing.md` to decide the action form: report-only action,
    `../loop-engineering/loop-discovery.md` recommendation for repeated or
    schedulable work, `skill-discovery.md` only for Skill decisions, the
    selected platform practice reference for platform-native tuning, or
    `needs more evidence`.

## Workflow

1. Identify the target workspace. If the user does not name one, use the
   current working directory.
2. Decide the scope. Include selected-platform user-home or global config only
   when the user asks for local installation, global skills, user-level
   settings, or cross-workspace behavior.
3. Build an evidence inventory before interpreting behavior: workspace context,
   configured asset inventory, runtime home files, audit logs, transcripts,
   usage metrics, generated reports, and any review packets the user provided.
4. For session behavior, reconstruct the timeline from audit events and
   transcript metadata before drawing conclusions about validation, tools,
   permissions, hooks, skills, model usage, or repeated friction.
5. For report review, compare every important claim against the underlying
   evidence and mark missing scope, missing provenance, cross-tool leakage, and
   overclaims.
6. If the user asks for multiple tools, analyze each tool separately first and
   deliver separate reports unless they explicitly ask for a comparison.
7. Manually inspect high-severity or surprising evidence before reporting. Do
   not rely on aggregate counters alone for claims about real behavior.
8. Separate confirmed problems, likely risks, healthy checks, and coverage
   gaps.
9. Recommend the smallest useful fix first: missing context and validation
   gaps before broader automation, plugin, or policy changes.

## Evidence To Inspect

- Workspace context: guidance files, project manifests, validation commands,
  local runtime config, rules or policies, MCP config, local skills, plugins,
  agents, hooks, and automations.
- Runtime home: selected-platform settings, audit logs, run manifests, session
  indexes, skills, plugin state, and caches only when the requested scope makes
  user-home evidence relevant.
- Session traces: event timestamps, tool calls, permission decisions, hook
  events, validation commands, edit events, model attribution, errors, and
  transcript coverage gaps.
- Generated reports: source evidence JSON, usage JSON, analysis packets, review
  packets, final reports, and quality-check output.
- For installed or global assets, run
  `scripts/agent-customize/cli.mjs inventory --provider <cursor|qoder|codex|claude|qwen|copilot>`
  or the `scripts/coding-agent-practices/inventory.mjs` wrapper, and treat its
  output as configured asset inventory, not session behavior.

## Output Rules

- Do not infer runtime behavior from static files alone.
- Do not merge tools into one story unless comparison is explicitly requested.
- Do not treat loaded skill text as proof that a skill/tool was invoked.
- Do not recommend broad automation before fixing missing context or validation
  commands.
- Do not print raw secrets, tokens, private keys, prompts, or `.env` contents.

## Platform Notes

Load only the selected platform note. These sections own source roots,
workspace matching, host-local state, and platform-native follow-up routes.

### Qoder

For Qoder, always pass the current absolute project path as `--workspace`. The
analyzer computes the workspace slug by replacing path separators with `-`, so
`/Users/example/workspace/better-harness` maps to
`~/.qoder/projects/-Users-example-workspace-better-harness/**/*.jsonl` plus matching
Qoder audit, run, log, state, transcript, and optional cache roots. Do not treat
unscoped files under `~/.qoder/projects` as current-project evidence.

Qoder is the primary runtime for Qoder reports. Inspect relevant sources such
as `~/.qoder/settings.json`, `~/.qoder/audit/audit.jsonl`,
`~/.qoder/logs/runs/*/manifest.json`,
`~/.qoder/plugins/installed_plugins*.json`, and
`~/.qoder/plugins/cache/**/SKILL.md` only when user-home scope is authorized.
Connect those files back to the selected workspace sessions instead of treating
global counters as workspace evidence.

Static locations such as `.qoder/specs` are project-binding or state evidence,
not observed Goal, Plan, or Spec use without matching session evidence. Route
Qoder Rule, Hook, Skill, Custom Agent, or MCP tuning through
`../agent-customize/platforms/qoder.md`.

### Codex

For Codex, the analyzer probes `~/.codex/audit-logs`, `~/.codex/audit`,
`~/.codex/sessions`, `~/.codex/session_index.jsonl`, `~/.codex/history.jsonl`,
and optional archived sessions. Keep Codex evidence scoped by workspace matches
inside those records; do not treat all `~/.codex` activity as current-project
evidence.

Inspect Codex audit logs, sessions, indexes, history, skills, and plugin/cache
equivalents only when relevant to the requested scope. Static locations such as
`.codex/specs` remain project-binding or state evidence, not observed Goal,
Plan, or Spec use without matching session evidence. Load
`../agent-customize/platforms/codex.md` for Codex-native follow-up guidance.

### Claude Code

For Claude Code, the analyzer reads workspace-matching JSONL transcripts under
`~/.claude/projects` and verifies the embedded cwd before admitting a session.
Current and legacy audit logs are optional lifecycle sources. Generated files
under `~/.claude/usage-data/facets` are derived output and never become observed
Session facts.

Treat transcript timestamps, tool results, model usage, and audit joins as
provider-labelled coverage. A missing optional audit source limits lifecycle
and outcome evidence; it does not turn observed transcript content into a
failure or prove successful delivery. Load
`../agent-customize/platforms/claude.md` for Claude-native asset guidance.

### Cursor

For Cursor, the primary workspace source is
`~/.cursor/projects/<workspace-slug>/agent-transcripts/**/*.jsonl`. The analyzer
joins matching `~/.cursor/chats/*/<session>/meta.json` for session bounds and
matching `~/.cursor/{audit,audit-logs}/audit.jsonl` records for tool lifecycle,
results, model usage, and timestamps. The transcript itself may omit timestamps;
all joins therefore remain explicit coverage rather than assumed chronology.

Read `sourceCoverage` in production `facts` before interpreting an empty
candidate list. `absent` means the bounded workspace scan found no transcript;
`out-of-window` means timestamped transcripts exist outside the selected
window; `unobserved` means transcripts exist but cannot support a bounded
request; `partial` means some Session content is observable while content or
metadata/audit joins remain incomplete; and `observed` means the selected
window has request content with the required joins. `unobserved` and `partial`
lower the Session Evidence lane rather than becoming zero activity or a clean
result.

Never decode Cursor `store.db` or join global audit records without a matching
workspace transcript identity. Route configured Cursor rules, Skills, hooks,
plugins, and other project/user assets through
`../agent-customize/global-assets.md`; configured presence does not prove use.

### Qwen

For Qwen Code, the analyzer reads workspace-matching JSONL transcripts under
`~/.qwen/projects/<workspace-slug>/chats/**/*.jsonl` and verifies the embedded
`cwd` before admitting a session. The analyzer computes the workspace slug by
replacing path separators with `-`, so `/home/admin/workspace` maps to
`~/.qwen/projects/-home-admin-workspace/chats/*.jsonl`. Qwen Code does not
maintain a separate audit log; transcript records are the primary lifecycle
source, with tool calls carried in `message.parts` function call entries and
tool results in top-level `toolCallResult`.

Treat transcript timestamps, model usage (`usageMetadata`), tool calls, and
tool results as provider-labelled coverage. Generated files under
`~/.qwen/insights` are derived output and never become observed Session facts.
Route configured Qwen rules (`QWEN.md`), Skills, hooks, extensions, and other
project/user assets through `../agent-customize/global-assets.md`; configured
presence does not prove use.

### Copilot

For GitHub Copilot CLI, the analyzer reads workspace-matching transcripts under
`~/.copilot/session-state/<session-id>/events.jsonl`. Each session directory
carries a `workspace.yaml` descriptor whose `cwd` binds the session to a
workspace; the analyzer also accepts the `context.cwd` recorded on the
`session.start` event. Copilot writes one typed lifecycle record per line, so
transcript records are the primary source: `user.message`, `assistant.message`,
`tool.execution_start`, `tool.execution_complete`, `hook.start`, `hook.end`,
`subagent.started`, `subagent.completed`, `session.plan_changed`,
`session.compaction_start`, `session.compaction_complete`,
`permission.requested`, `permission.completed`,
`session.permissions_changed`, and `external_tool.*`. Unrecognized types stay
explicit `metadata.*` events rather than being dropped or reinterpreted.

Keep four Copilot boundaries explicit:

- Copilot records `outputTokens` per assistant message and nothing else. Carry
  that field as partial per-response usage; never fill input tokens, cache
  tokens, or cost with zero. Subagent totals (`totalTokens`) and
  `preCompactionTokens` are aggregates and never become per-response usage.
  Complete usage evidence requires the opt-in OpenTelemetry export, which this
  workflow does not read.
- Permission evidence comes from the `permission.requested` /
  `permission.completed` pair, joined on `requestId`. Retain only the request
  kind and the result decision. The prompt intent, paths, and commands are
  payloads and are never retained. `session.permissions_changed` reports a mode
  change, not a decision.
- A session directory can match the workspace and carry no `events.jsonl`. That
  is partial coverage, not zero activity.
- `~/.copilot/session-store.db` is documented as automatically managed. Never
  read or decode it.

VS Code Copilot Chat has no supported durable transcript; its `debug-logs`
output is undocumented and stays `unobserved`. Route configured Copilot rules
(`AGENTS.md`, `.github/copilot-instructions.md`, `.github/instructions/`),
Skills, Agents, hooks, MCP, and installed Plugins through
`../agent-customize/global-assets.md`; configured presence does not prove use.

### Pi

For Pi, the analyzer reads workspace-matching JSONL transcripts under
`~/.pi/agent/sessions/--<cwd-slug>--/*.jsonl` and verifies the `cwd` embedded
in the version-3 session header before admitting a session. Pi computes the
directory slug by stripping the leading separator and replacing path
separators with `-`, so `/home/admin/workspace` maps to
`~/.pi/agent/sessions/--home-admin-workspace--/`. The `PI_CODING_AGENT_DIR`
and `PI_CODING_AGENT_SESSION_DIR` environment variables relocate the agent
dir and session storage; honor them before assuming the default path. Pi does
not maintain a separate audit log; transcript `message` entries are the
primary lifecycle source, with tool calls carried in assistant `toolCall`
content blocks and tool results in `toolResult` role messages.

Treat transcript timestamps, model usage (`message.usage`), tool calls, and
tool results as provider-labelled coverage. Entries such as `model_change`,
`compaction`, and `custom` stay metadata. Route configured Pi rules
(`AGENTS.md`), Skills, prompt templates, extensions, pi packages, and other
project/user assets through `../agent-customize/global-assets.md`; configured
presence does not prove use.

### WorkBuddy

For WorkBuddy, the analyzer reads workspace-matching JSONL transcripts under
`~/.workbuddy/projects/<cwd-slug>/*.jsonl`. It verifies embedded `cwd` values
when present; for observed 5.x transcripts without `cwd`, it admits only files
from the exact requested workspace slug and rejects prefix-only directory
matches. WorkBuddy computes the directory slug by stripping the leading
separator and replacing path separators with `-`, so `/home/admin/workspace` maps to
`~/.workbuddy/projects/home-admin-workspace/`. The `WORKBUDDY_DIR`
environment variable relocates the data root; honor it before assuming the
default path. WorkBuddy does not maintain a separate audit log; transcript
records are the primary lifecycle source, with tool calls carried in
`function_call` records and tool results in `function_call_result` records.

Treat transcript timestamps, sparse camelCase or snake_case model usage
(`providerData.usage`), tool calls, and tool results as provider-labelled
coverage. Entries such as `reasoning`, `file-history-snapshot`, `ai-title`,
and `custom-title` stay metadata even when a companion usage event is emitted.
Route configured WorkBuddy rules (`AGENTS.md`, identity files), Skills,
marketplace plugins, MCP config, and other project/user assets through
`../agent-customize/global-assets.md`; configured presence does not prove
use.

### Grok

For Grok, the analyzer reads workspace-matching session directories under
`~/.grok/sessions/<url-encoded-cwd>/<session-id>/`. The group directory name is
`encodeURIComponent(absoluteCwd)`, so `/Users/work` maps to
`~/.grok/sessions/%2FUsers%2Fwork/`. Prefer `summary.json` `info.cwd` for
qualification; fall back to decoding the group directory name. Primary
transcript is `updates.jsonl` (ACP-style `session/update` records). Optional
`chat_history.jsonl` is secondary, and `signals.json` may contribute sparse
usage when present. Missing signals leave usage unobserved rather than
zero-filled. The `GROK_HOME` environment variable relocates the data root.
Route configured Grok skills, hooks, MCP servers in `config.toml`, installed
plugins, and project `.grok` assets through `../agent-customize/global-assets.md`;
configured presence does not prove use.
