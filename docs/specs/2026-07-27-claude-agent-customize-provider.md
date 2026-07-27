# Claude Code Configured Asset Support

## Traceability

- Spec ID: `2026-07-27-claude-agent-customize-provider`
- Status: Implemented

## Intent

Better Harness currently accepts Claude Code session evidence but reports the required
`agentCustomize` lane as unavailable. Add a read-only Claude Code provider that inventories the
configured asset surfaces which can affect the selected workspace, without treating marketplace
catalogs, cached source, or successful parsing as proof of runtime use.

The provider must preserve the existing three-lane evidence contract: a normal Claude evidence
bundle should return configured Agent asset metadata through the same lint, inventory, and
integrity envelopes used by Qoder, Codex, and Cursor. Secret-bearing configuration values must
never be copied into the public inventory.

## Acceptance Scenarios

- **AC-1 (native configured assets):** Given a fixture with user and project Claude Code
  configuration, `agent-customize inventory --provider claude` discovers Skills, agents,
  commands, instruction/rule files, Hooks, and MCP servers from the documented Claude locations.
  The inventory distinguishes `user`, `project`, and `plugin` scope and accepts
  `--claude-home` plus a separate Claude state-file override for isolated tests.
- **AC-2 (hook contract):** Claude Hooks from `settings.json`, `settings.local.json`, and installed
  Plugin hook configuration retain event, matcher, handler type, safe command display,
  configuration digest, and async state. Claude's documented timeout seconds are normalized to
  `timeoutMs`, and `$CLAUDE_PROJECT_DIR` script paths resolve only when they stay inside the
  workspace or Plugin root.
- **AC-3 (MCP scope and privacy):** User MCPs come from top-level Claude state, local MCPs from the
  exact workspace entry in that state, and project MCPs from `.mcp.json`. Output includes command,
  argument, URL, and environment-key metadata needed for static review but never environment
  values, tokens, credentials, or unrelated Claude state fields.
- **AC-4 (installed Plugin truth):** Plugin inventory is rooted only in
  `plugins/installed_plugins.json` records. It supports default and manifest-declared Skill,
  command, agent, Hook, and MCP component paths; applies install scope/project-path gates plus
  user/project/local `enabledPlugins` settings; and does not count marketplace clones as installed.
  Disabled Plugins remain visible in Manage inventory, while their child assets are excluded from
  the public configured-asset surfaces.
- **AC-5 (instruction coverage):** Claude instruction review recognizes user `CLAUDE.md`, project
  `CLAUDE.md` or `.claude/CLAUDE.md`, project `CLAUDE.local.md`, and `.claude/rules/**/*.md` as
  Claude-native instruction sources with deterministic precedence. An `AGENTS.md` file by itself
  is not reported as a native Claude instruction.
- **AC-6 (three-lane availability):** `asset-baseline --provider claude`,
  `agent-lint --profile agent-assets-review --provider claude`, and the Claude evidence bundle
  complete using one shared read-only inventory snapshot. The bundle no longer returns
  `UNSUPPORTED_AGENT_CUSTOMIZE_PROVIDER` when standard configured surfaces are readable.
- **AC-7 (routing and portability):** Public CLI help, adapter/platform references, and architecture
  tests list Claude support. Code uses Node path/file APIs and fixture overrides so the collector is
  testable on Windows, macOS, and Linux; relative Markdown links and the generated documentation
  graph remain valid.

## Non-goals

- Do not claim that a configured Skill, Hook, MCP server, agent, command, or Plugin was invoked or
  produced a successful outcome. Runtime `claude mcp list` probing remains a separate diagnostic.
- Do not ingest raw auto-memory bodies, authentication data, conversation history, usage caches,
  marketplace catalog contents, or arbitrary fields from `.claude.json`.
- Do not mutate Claude configuration, enable/disable Plugins, install components, or add a project
  `CLAUDE.md` shim as part of evidence collection.
- Do not implement enterprise managed-settings discovery or CLI-session ephemeral Hook/Plugin
  state in this iteration; report these as explicit unsupported surfaces.
- Do not solve repository-wide nested/inherited asset topology here. Arbitrary nested
  `.claude/skills` and package attribution remain owned by
  [Monorepo and Workspace Support for Better Harness Evidence Collection](2026-07-25-monorepo-workspace-support.md).
- Do not add Claude Memory evaluation. Existing Memory metadata support remains Qoder/Codex-only.

## Plan and Tasks

1. Add `scripts/agent-customize/providers/claude.mjs` as the capability-local owner. Resolve the
   Claude config root and state path, collect documented user/project primitives, and build the
   same Manage collections as existing providers. (AC-1, AC-3)
2. Extend shared asset helpers with an object-backed Hook collector, provider-specific timeout and
   project-directory placeholder handling, safe Plugin child enablement metadata, and bounded
   component-path resolution. Keep existing provider defaults unchanged. (AC-2, AC-4)
3. Parse `installed_plugins.json` as installation evidence, then calculate workspace-effective
   activation from record scope/project path and the documented settings precedence. Collect only
   component paths inside the installed Plugin root. (AC-4)
4. Route `claude` and Claude path overrides through agent-customize, coding-agent-practices,
   agent-lint, task-loop evidence, and evidence-bundle owners. Extend Claude instruction discovery
   for native local/rule files. (AC-5, AC-6)
5. Add a synthetic Claude fixture covering user/project/local settings, state-scoped MCPs, enabled
   and disabled Plugins, custom component paths, non-command Hooks, timeout conversion, and secret
   redaction. Extend architecture, provider, baseline, lint, and evidence tests. (AC-1–AC-7)
6. Add a Claude platform reference, update adapter/routing tables and CLI help, regenerate the
   Better Harness documentation graph, and run Review Readiness over the final diff. (AC-7)

## Test and Review Evidence

- **AC-1–AC-4:** `node --test test/agent-customize.test.mjs`
- **AC-4, AC-7:** `node --test test/agent-customize-architecture.test.mjs`
- **AC-5–AC-6:** `node --test test/agent-lint.test.mjs test/agent-asset-baseline.test.mjs test/better-harness-evidence-bundle.test.mjs`
- **AC-7:** `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`
- **Regression:** `npm test`
- **Local smoke:** run Claude `inventory`, `agent-assets-review`, `asset-baseline`, and
  `harness evidence-bundle` against this workspace with authorized user-home metadata; inspect only
  counts, scopes, source paths, handler types, environment key names, and lane status. Search the
  serialized output for known local credential values before retaining any artifact.
- **Risk review:** verify Plugin path resolution cannot escape the installed root; disabled Plugin
  children do not enter public surfaces; state parsing selects only `mcpServers`; Hook command and
  condition output remains sanitized; no fixture or report records secret values.

## Implementation Evidence

- `node --test test/agent-customize.test.mjs test/agent-customize-architecture.test.mjs test/agent-lint.test.mjs test/agent-asset-baseline.test.mjs test/better-harness-evidence-bundle.test.mjs test/doc-link-graph.test.mjs`
  passed 53/53 after the final privacy hardening.
- `npm test` passed 823/826 cases. The only three failures were preview-server cases that could not bind
  `127.0.0.1` in the restricted sandbox; the isolated rerun
  `node --test test/preview-servers.test.mjs` passed 8/8 in a loopback-capable environment.
- `npm run pack:verify` initially hit the local root-owned npm cache. With a writable isolated
  cache, package verification passed with 292 npm entries and 326 runtime ZIP entries.
- A real Claude quick evidence bundle for this workspace completed with all three lanes
  available and `agentCustomize.data.status: complete`; the configured-asset envelopes reported
  10 authorized user Skills, 10 Hooks, and 2 MCP entries without running an MCP connection probe.
- A local privacy comparison found zero serialized matches across seven sensitive configuration
  candidates; serialized Claude Hook items retained no raw command field and MCP items retained no
  environment-value object.
