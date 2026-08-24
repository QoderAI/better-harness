# Add Kimi Code as a supported host

## Traceability

- Spec ID: `kimi-host-support`
- Status: Implemented
- Contribution workflow: [Contributing a New Coding Agent Host](../adapters/contributing-new-coding-agent.md)

## Intent

Make Kimi Code a first-class, evidence-safe Better Harness host alongside
Qoder, Codex, Claude Code, Cursor, Qwen Code, GitHub Copilot, and Pi.

This contribution reaches the **Verified install/discovery** capability level:
native discovery, configured assets, session evidence, evidence-bundle routing,
and portable report routing are verified. Kimi Code remains outside the public
Quickstart set until a full report render is validated end to end in Kimi Code,
as required by the repository's host contribution contract.

Kimi Code is a terminal coding agent extended through Agent Skills, MCP
servers, custom agents, hooks, and plugins installed through `/plugins`. It
implements the Agent Skills standard and discovers a plugin package's skills
through the `.kimi-plugin/plugin.json` manifest, so
`/plugins install <repo>` can load the canonical `better-harness` Skill today,
and a manual copy of `skills/better-harness` into `~/.kimi-code/skills` or a
project `.kimi-code/skills` directory works without the plugin manager. The
gaps this spec closes are the missing evidence: every provider enum rejected
`kimi`, so the workflow could neither inventory Kimi Code's configured assets
nor read Kimi Code session transcripts, leaving a Kimi Code user unable to get
a Kimi-scoped Harness report.

Kimi Code's native contracts were verified against the local Kimi Code
installation: the configuration root is `~/.kimi-code` (overridable through
`--kimi-home`); sessions are wire transcripts at
`~/.kimi-code/sessions/<wd_*>/ses{sion}_*/agents/<agent>/wire.jsonl` with a
sibling `state.json` carrying title and created/updated timestamps; the
workspace-to-`wd_*` mapping resolves through `~/.kimi-code/workspaces.json`
(exact `root` match) and `~/.kimi-code/session_index.jsonl` (per-session
`workDir`), falling back to `wd_<name>_*` directory prefixes with a
`kimi-workspace-index-absent` warning only when both indexes are absent. Wire
records normalize from `context.append_loop_event` (`tool.call`/`tool.result`/
`content.part`), `turn.prompt`/`turn.steer`, `context.append_message`
(protocol 1.0), and `usage.record` token usage; unknown record types degrade to
bounded `metadata.*` events for forward compatibility.

## Acceptance Scenarios

- **KHS-AC-1 (native shell):** The repository declares a
  `.kimi-plugin/plugin.json` manifest with the canonical `skills` pointer, so
  `/plugins install <repo>` discovers the root `skills/` Skill and
  `/skill:better-harness` invokes it. The manifest ships in the public npm
  package as the seventh filesystem metadata root; the Qoder runtime bundle
  stays Qoder-specific.
- **KHS-AC-2 (configured assets):** `agent-customize` supports `--provider
  kimi` through a capability-owned provider module that inventories user-level
  `~/.kimi-code/skills/**/SKILL.md` and `~/.kimi-code/mcp.json#mcpServers`,
  project-level `.kimi-code/skills/**/SKILL.md` and `.kimi/skills/**/SKILL.md`,
  and project `AGENTS.md`/`CLAUDE.md` context. Repository-root `skills/` is the
  Better Harness distribution layout, not a Kimi Code project convention, and
  is deliberately not probed.
- **KHS-AC-3 (plugin inventory):** Installed plugins indexed in
  `~/.kimi-code/plugins/installed.json` are inventoried from their managed
  copies under `~/.kimi-code/plugins/managed/<id>/`, reading `kimi.plugin.json`
  first and falling back to `.kimi-plugin/plugin.json`. Assets are inventoried
  only for records with `enabled: true`, and manifest-declared paths that
  escape the plugin root are skipped. `walkFiles` follows symlinks so
  symlink-installed skills are discovered; collected files whose realpath
  escapes the plugin root through such symlinks are dropped from the
  inventory.
- **KHS-AC-4 (evidence boundaries):** Kimi Code has no memory equivalent, and
  memory inventory is declared unsupported rather than approximated.
  `~/.kimi-code/config.toml` holds model/provider settings and is surfaced only
  as a diagnostics flag, never parsed into inventory items. The MCP collector
  reads `mcp.json` only and never surfaces environment values, header values,
  URL credentials, or authentication state; `~/.kimi-code/credentials` and
  `server.token` are never read.
- **KHS-AC-5 (session evidence):** `session-analysis` supports `--platform
  kimi` through a capability-owned platform module that reads
  workspace-matching wire transcripts, resolves the workspace-to-`wd_*` mapping
  through `workspaces.json` and `session_index.jsonl`, and falls back to
  `wd_<name>_*` directory prefixes only when both indexes are absent, recording
  a `kimi-workspace-index-absent` warning. User text, command text, and message
  content stay gated behind the shared `includeUserText`/`includeCommandText`/
  `includeContent` privacy flags, and session ids and home paths never enter
  production facts.
- **KHS-AC-6 (bundle propagation):** `harness evidence-bundle --platform kimi`
  freezes a Kimi Code context and returns all three lanes, and `--kimi-home`
  routes isolated configuration paths into the Agent Customize lane, selection
  profile, and task-loop analysis through both the collector API and the
  relevant CLIs.
- **KHS-AC-7 (host routing):** The canonical host adapter matrix carries a Kimi
  Code row with discovery paths, evidence sources, default output, and a smoke
  command. Canonical portable HTML routing includes Kimi Code, and Qoder
  remains the only Canvas host. Public Quickstart surfaces remain unchanged
  until Kimi Code has an end-to-end report-render smoke.
- **KHS-AC-8 (support-declaration consistency):** `kimi` is a member of the
  canonical supported-platform set, so the provider registry, session platform
  loader, CLI help, report gate, asset-baseline gate, and adapter matrix all
  agree (A-06).
- **KHS-AC-9 (provider behavior):** Deterministic fixtures cover Kimi Code
  asset inventory, plugin `enabled` filtering and plugin-root path confinement,
  symlink-followed skill discovery, wire-record normalization, workspace-index
  resolution and prefix fallback, and privacy-gated text extraction.
- **KHS-AC-10 (documentation integrity):** Markdown links and the generated
  documentation routing graph remain current, and the detailed Installation
  sections in both READMEs document the `/plugins install` path and the manual
  skills-directory fallback without promoting Kimi Code into the public
  Quickstart set.

## Non-goals

- Inventory Kimi Code custom agents, plugin-declared `agents`/`commands`/
  `hooks` beyond plugin metadata, or plugin `systemPrompt` content merged into
  rules; plugin prompt content stays plugin metadata.
- Add a Kimi Code memory inventory. There is no memory equivalent, so memory
  stays declared unsupported rather than over-reporting.
- Parse `~/.kimi-code/config.toml` into inventory items.
- Split a `docs/adapters/kimi-code.md`; no split trigger is met.
- Add a `scripts/packaging/` Kimi Code host-artifact builder. Kimi Code
  installs from the checked-in `.kimi-plugin/plugin.json` manifest and needs no
  generated shell.
- Add Kimi Code metadata to the Qoder runtime bundle.
- Promote Kimi Code to the README Quickstart list, Docusaurus home-page cards,
  installation tabs, or public adapter matrix before a full report render is
  validated end to end in Kimi Code.
- Treat configured Kimi Code assets, zero candidates, or a loaded Skill as
  proof of runtime quality or Skill invocation.

## Plan and Tasks

1. Add `.kimi-plugin/plugin.json` as the native plugin manifest and ship it in
   the public npm package files list and packaging verifier. (KHS-AC-1)
2. Add `scripts/agent-customize/providers/kimi.mjs` as the capability owner and
   register it in the provider registry, covering user skills and MCP, project
   skill roots, `AGENTS.md`/`CLAUDE.md` context, and managed-plugin inventory
   with `enabled` filtering and plugin-root path confinement. (KHS-AC-2,
   KHS-AC-3, KHS-AC-4)
3. Add `scripts/session-analysis/platforms/kimi.mjs` and register it in both
   the public `session-analysis.mjs` dispatch and the capability-owned
   `analyzer.mjs` dispatch, with `workspaces.json`/`session_index.jsonl`
   workspace resolution and the `wd_<name>_*` prefix fallback. (KHS-AC-5)
4. Register `kimi` across the remaining provider enums and `--kimi-home`
   threading: evidence-bundle contract and lanes, report run, task-loop source
   and report, report quality, coding-agent-practices asset baseline, asset
   integrity, and inventory, lifecycle demand signals, selection profile, usage
   summary, and agent-lint usage. (KHS-AC-6, KHS-AC-8)
5. Add `references/agent-customize/platforms/kimi.md`, a Kimi asset route, and
   a Kimi Code section in Session Diagnostics. (KHS-AC-2, KHS-AC-5)
6. Add the Kimi Code row to the canonical adapter matrix, keep the
   metadata-root counts across the architecture, community, glossary, and
   concepts docs, and route Kimi Code through portable HTML reporting without
   changing the public Quickstart set. (KHS-AC-7)
7. Document the `/plugins install` path and the manual skills-directory
   fallback in the detailed Installation sections of both READMEs. (KHS-AC-10)
8. Extend tests and packaging verification for the new manifest, provider,
   platform, enums, and the supported-platform consistency set. (KHS-AC-8,
   KHS-AC-9, KHS-AC-10)

## Test and Review Evidence

Confirmed on the final integration diff:

- `node --test test/coding-agent-platform-notes.test.mjs
  test/plugin-manifests.test.mjs test/docs-entrypoints.test.mjs
  test/support-declarations.test.mjs test/scripts-refactor-contract.test.mjs
  test/agent-asset-baseline.test.mjs
  test/better-harness-evidence-bundle.test.mjs test/agent-customize.test.mjs`:
  focused provider, manifest, documentation, and consistency tests passed.
- `npm test`: no new failures beyond the pre-existing environment-dependent
  baseline failures.
- `node scripts/agent-customize/cli.mjs --help` lists `kimi` in the provider
  set and `--kimi-home` in the home overrides.

Not observed on the final integration diff: a model-driven, end-to-end
`/skill:better-harness` report render inside an interactive Kimi Code session.
Public Quickstart promotion therefore remains deferred.

## Risk

Kimi Code's wire transcript format and session directory contract are observed
from a local installation rather than a published schema. The platform module
degrades unknown record types to bounded `metadata.*` events and keeps coverage
explicit instead of inferring activity, so a Kimi Code change surfaces as a
failing contract rather than silent misrouting.

## Unknowns

- [NEEDS CLARIFICATION: whether Kimi Code publishes a versioned schema for the
  wire transcript format that the platform test should validate against.]
- [NEEDS CLARIFICATION: whether Kimi Code will expose custom-agent inventory
  natively, at which point the Agents collection could move off the
  not-yet-inventoried boundary.]
- [NEEDS CLARIFICATION: Kimi Code does not document a session-id environment
  variable; `currentSessionId()` follows the `<HOST>_SESSION_ID` convention and
  reads `KIMI_SESSION_ID`, returning null when it is unset.]
