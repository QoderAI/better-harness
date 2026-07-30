# Add GitHub Copilot as a supported host

## Traceability

- Spec ID: `copilot-host-support`
- Status: Implemented

## Intent

Make GitHub Copilot a first-class, evidence-safe Better Harness host alongside
Qoder, Codex, Claude Code, Cursor, and Qwen Code.

Copilot already loads the canonical `better-harness` Skill today, but only by
falling back to the Claude Code shell: Copilot resolves plugin manifests in the
order `.plugin/plugin.json`, `plugin.json`, `.github/plugin/plugin.json`,
`.claude-plugin/plugin.json`, and marketplace manifests in the order
`marketplace.json`, `.plugin/marketplace.json`, `.github/plugin/marketplace.json`,
`.claude-plugin/marketplace.json`. That fallback is undocumented for users,
gives Copilot no shell of its own, and leaves the load order dependent on which
other host shells happen to exist.

The larger gap is evidence. Every provider enum rejects `copilot`, so the
workflow cannot inventory Copilot's configured assets or read Copilot session
transcripts. A Copilot user can run the Skill but cannot get a Copilot-scoped
Harness report.

Copilot's transcript is the richest of any supported host: `events.jsonl`
records hook, subagent, plan, compaction, and permission lifecycle events
directly. That evidence must be normalized without inventing coverage Copilot
does not record. Copilot does not persist per-response token usage in the
transcript, and VS Code Copilot Chat has no documented durable transcript, so
both stay explicit boundaries rather than zero values.

## Acceptance Scenarios

- **CHS-AC-1 (native shell):** The repository exposes a Copilot-native plugin
  manifest at `.github/plugin/plugin.json` and a marketplace manifest at
  `.github/plugin/marketplace.json`. Both carry the `package.json` version, and
  the manifest declares `skills` explicitly rather than relying on a default.
  Copilot resolves them ahead of `.claude-plugin/`, so host selection no longer
  depends on the Claude shell.
- **CHS-AC-2 (version alignment):** `package.json` and the Qoder, Codex, Claude
  Code, Cursor, Qwen, and Copilot host manifests expose the same package
  version, and the packaging verification gate covers the new manifests.
- **CHS-AC-3 (configured assets):** `agent-customize` supports
  `--provider copilot` through a capability-owned provider module that
  inventories Copilot Rules, Skills, Agents, Hooks, MCP, and installed-Plugin
  metadata from documented Copilot locations. Installed-Plugin records stay
  separate from marketplace catalogs and never become runtime-use claims.
- **CHS-AC-4 (session evidence):** `session-analysis` supports
  `--platform copilot` through a capability-owned platform module that reads
  workspace-matching `~/.copilot/session-state/<id>/events.jsonl`, and both the
  public and capability-owned analyzer factories resolve it.
- **CHS-AC-5 (evidence boundaries):** Copilot facts report
  `usageFieldsObserved: false` because the transcript records no per-response
  token usage. Session Diagnostics states that VS Code Copilot Chat has no
  supported durable transcript and that `session-store.db` is documented as
  auto-managed and is not an evidence source.
- **CHS-AC-6 (bundle propagation):** `harness evidence-bundle --platform copilot`
  freezes a Copilot context and returns all three lanes, and `--copilot-home`
  routes isolated configuration paths into the Agent Customize lane.
- **CHS-AC-7 (host routing):** The host adapter matrix carries a Copilot row with
  discovery paths, evidence sources, default output, and a smoke command.
  Portable HTML routing includes Copilot, and Qoder remains the only Canvas host.
- **CHS-AC-8 (provider behavior):** Deterministic fixtures cover Copilot asset
  inventory and transcript normalization, including tool call/result pairing,
  hook lifecycle, subagent delegation, and absent or unreadable transcripts. Raw
  prompts, commands, output, paths, and secrets do not enter production facts.
- **CHS-AC-9 (documentation integrity):** Markdown links and the generated
  Better Harness documentation routing graph remain current, and the README
  documents the marketplace install path rather than the deprecated direct
  install.

## Non-goals

- Modify `~/.copilot`, publish to `github/copilot-plugins` or
  `github/awesome-copilot`, or install a user-level Copilot Skill.
- Read `~/.copilot/session-store.db`. It is documented as automatically managed
  and its schema is internal.
- Treat VS Code Copilot Chat `debug-logs` as durable session evidence.
- Add Copilot OpenTelemetry ingestion for token usage.
- Add a `scripts/packaging/` Copilot host-artifact builder. That path is scoped
  to an accepted host-artifact contract and currently supports Codex only.
- Automate Copilot cloud agent `enabledPlugins` configuration.
- Add Copilot sources to `agent-lint` host instructions, which currently support
  Qoder, Claude Code, and Codex only.
- Add Copilot metadata to the Qoder runtime bundle.
- Treat configured Copilot assets, zero candidates, or a loaded Skill as proof of
  runtime quality or Skill invocation.

## Plan and Tasks

1. Add `.github/plugin/plugin.json` and `.github/plugin/marketplace.json` as a
   thin Copilot shell, and include `.github/plugin/` in the public package files
   list. (CHS-AC-1, CHS-AC-2)
2. Add `scripts/agent-customize/providers/copilot.mjs` as the capability-local
   owner and register it in the provider registry. Resolve Copilot home through
   `COPILOT_HOME` and an explicit override, and build the same Manage
   collections as existing providers. (CHS-AC-3)
3. Add `scripts/session-analysis/platforms/copilot.mjs` and register it in both
   the public `session-analysis.mjs` dispatch and the capability-owned
   `analyzer.mjs` dispatch. (CHS-AC-4, CHS-AC-5)
4. Register `copilot` in the remaining provider enums: evidence-bundle contract
   and lanes, report run, task-loop source and report, report quality,
   coding-agent-practices asset baseline, asset integrity, and inventory,
   lifecycle demand signals, session core facts, selection profile, usage
   summary, and agent-lint usage. (CHS-AC-6)
5. Add `references/agent-customize/platforms/copilot.md`, a Copilot asset route,
   and a Copilot section in Session Diagnostics. (CHS-AC-3, CHS-AC-5)
6. Add the Copilot host matrix row, update the metadata-root counts across the
   architecture, community, glossary, and concepts docs, and route Copilot
   through portable HTML reporting. (CHS-AC-7)
7. Document the Copilot marketplace install path in both READMEs. (CHS-AC-9)
8. Extend tests and packaging verification for the new shell, provider,
   platform, and enums, replacing the assertion that excluded Copilot from the
   host matrix. (CHS-AC-2, CHS-AC-8, CHS-AC-9)

## Test and Review Evidence

- `node --test`
- `node --test test/doc-link-graph.test.mjs`
- `npm run pack:verify`
- `copilot plugin marketplace add <repo>` then
  `copilot plugin install better-harness@better-harness`, expecting the reported
  skill install count.
- `node scripts/better-harness.mjs harness evidence-bundle --platform copilot
  --workspace . --depth quick --format json`

## Risk

Copilot's plugin surface is evolving: direct repository installs are deprecated
in favor of marketplace installs, and the manifest resolution order is the only
guarantee that a Copilot-native shell takes precedence over the Claude shell.
Both are pinned by the host matrix row and manifest tests so a Copilot change
surfaces as a failing contract rather than silent host misrouting.

Copilot transcript event names are observed from a real session rather than a
published schema. The platform module therefore treats unknown event types as
ignorable and keeps coverage explicit instead of inferring activity.

## Unknowns

- [NEEDS CLARIFICATION: whether Copilot publishes a versioned JSON schema for
  `plugin.json` that the manifest test should validate against.]
- [NEEDS CLARIFICATION: whether `~/.copilot/session-state` layout is stable
  enough to promote from observed to documented in the host matrix.]
