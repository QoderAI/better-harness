# Add Pi as a supported host

## Traceability

- Spec ID: `pi-host-support`
- Status: Implemented
- Contribution workflow: [Contributing a New Coding Agent Host](../adapters/contributing-new-coding-agent.md)

## Intent

Make Pi (`pi.dev`, `@earendil-works/pi-coding-agent`) a first-class,
evidence-safe Better Harness host alongside Qoder, Codex, Claude Code, Cursor,
Qwen Code, and GitHub Copilot.

This contribution reaches the **Verified install/discovery** capability level:
native discovery, configured assets, session evidence, evidence-bundle routing,
and portable report routing are verified. Pi remains outside the public
Quickstart set until a full report render is validated end to end in Pi, as
required by the repository's host contribution contract.

Pi is a minimal terminal coding harness extended through TypeScript extensions,
skills, prompt templates, themes, and pi packages. It already implements the
Agent Skills standard and auto-discovers a package's `skills/` directory, so
`pi install <repo>` can load the canonical `better-harness` Skill today. The
gaps this spec closes are the missing native slash-command entry point and,
more importantly, the missing evidence: every provider enum rejected `pi`, so
the workflow could neither inventory Pi's configured assets nor read Pi session
transcripts, leaving a Pi user unable to get a Pi-scoped Harness report.

Pi's native contracts were verified against `@earendil-works/pi-coding-agent`:
the agent dir resolves from `PI_CODING_AGENT_DIR` (default `~/.pi/agent`);
sessions are JSONL trees whose default location is
`~/.pi/agent/sessions/--<cwd-slug>--/<timestamp>_<uuid>.jsonl`, where the slug
strips one leading separator and replaces `/`, `\`, and `:` with `-`; and
`--session-dir`, `PI_CODING_AGENT_SESSION_DIR`, and the settings `sessionDir`
key name the exact flat directory that contains JSONL files rather than a
cwd-keyed parent. Sessions use the version-3 header carrying `cwd` and the
session id, `message` entries for user/assistant/toolResult, `toolCall` content
blocks, and a finite `message.usage` object.

## Acceptance Scenarios

- **PHS-AC-1 (native shell):** The repository declares a `pi` manifest in
  `package.json` (`pi.skills`, `pi.prompts`) and the `pi-package` keyword, so
  `pi install <repo>` and `pi -e <repo>` discover the canonical root `skills/`
  Skill and the `prompts/` templates. The manifest ships in the public npm
  package; the Qoder runtime bundle stays Qoder-specific. Pi reuses the
  existing `package.json`, so it adds no new standalone metadata root and the
  package still ships six host metadata roots.
- **PHS-AC-2 (native slash command):** `prompts/better-harness.md` registers a
  `/better-harness` prompt template that routes to the `better-harness` Skill,
  supplies the `pi` host context, and expands arguments through the supported
  `${@:-default}` form.
- **PHS-AC-3 (configured assets):** `agent-customize` supports `--provider pi`
  through a capability-owned provider module that inventories settings-declared
  pi packages (npm/git/local), loose extensions, user and project Skills,
  prompt templates, and `AGENTS.md` context. The shared `.agents/skills`
  standard directory is discovered from the real user home even when
  `PI_CODING_AGENT_DIR` relocates the agent dir.
- **PHS-AC-4 (effective package state):** Package entries in object form honor
  Pi's effective-state contract. A standalone `autoload: false` entry with no
  positive resource delta publishes no child resources; project
  `autoload: false` entries can layer selective enable/disable deltas over the
  matching user package. Per-resource allowlists, `!` exclusions, `+`/`-`
  exact overrides, and `[]` (load none for normal autoload) narrow the reported
  Skills and prompt templates. npm versions and git URL/ref variants use Pi's
  normalized package identity, so a project declaration overrides or layers
  over the matching user package instead of being reported twice.
- **PHS-AC-5 (session evidence):** `session-analysis` supports `--platform pi`
  through a capability-owned platform module that reads workspace-matching
  version-3 JSONL transcripts, requires the first parsed record to be the sole
  authoritative session header, verifies its `cwd`, and resolves the session
  directory as CLI over environment over settings over default. A
  custom session directory is treated as the exact flat JSONL directory whose
  files are still qualified by the session-header cwd; relative custom paths
  resolve from the target workspace. The default tree nests transcripts under
  workspace-keyed `--<cwd-slug>--` directories.
- **PHS-AC-6 (evidence boundaries):** Missing or malformed `message.usage`
  fields stay absent rather than becoming zero, so partial per-response usage
  is explicit. A parent session directory alone is not an evidence root: the
  default tree requires at least one workspace-keyed session directory before
  `sources` reports the root as present. Session ids and home paths never enter
  production facts.
- **PHS-AC-7 (bundle propagation):** `harness evidence-bundle --platform pi`
  freezes a Pi context and returns all three lanes, and `--pi-home` routes
  isolated configuration paths into the Agent Customize lane, selection
  profile, and task-loop analysis through both the collector API and the
  relevant CLIs.
- **PHS-AC-8 (host routing):** The canonical host adapter matrix carries a Pi
  row with discovery paths, evidence sources, default output, and a smoke
  command. Canonical portable HTML routing includes Pi, and Qoder remains the
  only Canvas host. Public Quickstart surfaces remain unchanged until Pi has an
  end-to-end report-render smoke.
- **PHS-AC-9 (support-declaration consistency):** `pi` is a member of the
  canonical supported-platform set, so the provider registry, session platform
  loader, CLI help, report gate, asset-baseline gate, and adapter matrix all
  agree (A-06).
- **PHS-AC-10 (provider behavior):** Deterministic fixtures cover Pi asset
  inventory, autoload/filter effective state, relocated-agent-dir user-home
  discovery, flat and direct-file package Skills, normalized package identity,
  transcript normalization, custom-directory and precedence resolution,
  malformed/foreign header rejection, and partial/malformed usage. The
  supported prompt-template argument syntax is exercised by an expansion
  smoke test.
- **PHS-AC-11 (documentation integrity):** Markdown links and the generated
  documentation routing graph remain current, and the detailed Installation
  sections in both READMEs document the `pi install` path without promoting Pi
  into the public Quickstart set.

## Non-goals

- Add a native MCP inventory for Pi. Pi has no native MCP registry; MCP arrives
  through extension packages, so MCP capability claims stay extension-bound.
- Expand pi manifest glob sources beyond declared resource directories, or
  model per-resource enable state outside settings package entries. Both stay
  declared unsupported rather than over-reporting resources Pi may not load.
- Inventory Pi themes or extension runtime registration state.
- Split a `docs/adapters/pi.md`; no split trigger is met.
- Add a `scripts/packaging/` Pi host-artifact builder. Pi installs from the
  existing package manifest and needs no generated shell.
- Add Pi metadata to the Qoder runtime bundle.
- Promote Pi to the README Quickstart list, Docusaurus home-page cards,
  installation tabs, or public adapter matrix before a full report render is
  validated end to end in Pi.
- Treat configured Pi assets, zero candidates, or a loaded Skill as proof of
  runtime quality or Skill invocation.

## Plan and Tasks

1. Add the `pi` manifest and `pi-package` keyword to `package.json`, ship
   `prompts/` in the public package files list and packaging verifier, and add
   `prompts/better-harness.md`. (PHS-AC-1, PHS-AC-2)
2. Add `scripts/agent-customize/providers/pi.mjs` as the capability owner and
   register it in the provider registry, modeling `piHome` and the real user
   home independently and applying Pi's autoload/filter effective state.
   (PHS-AC-3, PHS-AC-4)
3. Add `scripts/session-analysis/platforms/pi.mjs` and register it in both the
   public `session-analysis.mjs` dispatch and the capability-owned
   `analyzer.mjs` dispatch, distinguishing the default cwd-keyed tree from a
   custom flat session directory and keeping usage partial. (PHS-AC-5,
   PHS-AC-6)
4. Register `pi` across the remaining provider enums and `--pi-home` threading:
   evidence-bundle contract and lanes, report run, task-loop source and report,
   report quality, coding-agent-practices asset baseline, asset integrity, and
   inventory, lifecycle demand signals, selection profile, usage summary, and
   agent-lint usage. (PHS-AC-7, PHS-AC-9)
5. Add `references/agent-customize/platforms/pi.md`, a Pi asset route, and a Pi
   section in Session Diagnostics. (PHS-AC-3, PHS-AC-5)
6. Add the Pi row to the canonical adapter matrix, keep the metadata-root
   counts across the architecture, community, glossary, and concepts docs, and
   route Pi through portable HTML reporting without changing the public
   Quickstart set. (PHS-AC-8)
7. Document the `pi install` path in the detailed Installation sections of both
   READMEs. (PHS-AC-11)
8. Extend tests and packaging verification for the new manifest, provider,
   platform, enums, and the supported-platform consistency set, plus an
   expansion smoke test for the prompt template. (PHS-AC-9, PHS-AC-10,
   PHS-AC-11)

## Test and Review Evidence

Confirmed on the final integration diff:

- `npm run check`: 913/913 tests passed, then npm tarball and Qoder runtime
  bundle verification passed.
- `node --test test/agent-customize.test.mjs
  test/session-analysis-providers.test.mjs test/task-loop-source.test.mjs
  test/support-declarations.test.mjs`: 90/90 focused provider tests passed.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` followed by
  `node --test test/doc-link-graph.test.mjs`: generated graph current and 6/6
  link-integrity tests passed.
- The externally visible [PR #25 evidence](https://github.com/QoderAI/better-harness/pull/25)
  records contributor-run native Pi 0.83.0 install/discovery, real local session
  facts, configured-asset inventory, and a complete evidence bundle.

Not observed on the final integration diff: a model-driven, end-to-end
`/better-harness` report render inside an interactive Pi session. Public
Quickstart promotion therefore remains deferred.

## Risk

Pi's session format and directory contract are observed from
`@earendil-works/pi-coding-agent` rather than a published schema. The platform
module treats non-message entries as ignorable metadata and keeps coverage
explicit instead of inferring activity, so a Pi change surfaces as a failing
contract rather than silent misrouting.

## Unknowns

- [NEEDS CLARIFICATION: whether Pi publishes a versioned schema for the
  session JSONL format that the platform test should validate against.]
- [NEEDS CLARIFICATION: whether Pi will expose an MCP registry natively, at
  which point MCP inventory could move off the extension-bound boundary.]
