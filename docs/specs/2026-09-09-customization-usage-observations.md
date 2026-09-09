# Observed usage counts for Skills and MCP Servers

## Traceability
- Spec ID: studio-customization-usage
- Status: Implemented (source, unit, browser, and real-evidence validation)
- Source: Maintainer request in this task ("session-analysis already counts
  invocations — put that on Skills and MCP Servers in Customizations").
- Builds on [2026-09-09-studio-customizations-workbench.md](2026-09-09-studio-customizations-workbench.md).

## Intent
The Customizations catalog answers *what is configured*. It cannot say whether
anything was ever used, so 172 Skills all read alike and a reader cannot tell a
working Skill from a dead one. session-analysis already detects Skill invocations
per host and MCP calls from the `mcp__<server>__<tool>` wire name, but that
evidence never reaches the catalog.

Surface the retained invocation evidence next to the definitions, without letting
it pretend to be more than an observation.

Measured on this repository's own local evidence (25 sessions, 3 hosts):

| Host   | Skill invocations observed        | MCP servers observed        |
| ------ | --------------------------------- | --------------------------- |
| Qoder  | `change-traceability-review`      | none in sample              |
| Codex  | `better-harness:ui-ux-pro-max`    | `codex_app`                 |
| Claude | none in sample                    | `Claude_Browser`, `ccd_session` |

## Acceptance Scenarios

- AC-1 (evidence source): A per-session usage record is derived from the same
  normalized events the Session summary already reads, through the existing
  `collectSkillUsageObservations` and `collectMcpUsageObservations` rules. No new
  detection rule, host adapter, or evidence root is introduced, and the record is
  produced only when a caller asks for it.
- AC-2 (matching vocabulary): One module owns how an observed name is matched to a
  catalog definition: case-insensitive, on the last `:`- or `/`-delimited segment,
  so Codex's `better-harness:ui-ux-pro-max` matches the Skill named
  `ui-ux-pro-max`, and an MCP server matches its registration name. Matching is
  scoped to the Host that produced the Session, so a Skill exposed by two Agents
  keeps two separate counts.
- AC-3 (Studio transport): Studio serves the aggregate as its own runtime
  observation with the observed Session count and the observation window. It is a
  Studio-owned payload beside the catalog, not a new field inside
  `CustomizationCatalogV1`, and a host that cannot supply it degrades to absent.
- AC-4 (presentation): Skills and MCP Servers rows carry a sortable, right-aligned
  **Uses** count that follows the active Agent filter; Overview shows it for the
  rows that can carry it. Categories with no invocation evidence do not grow an
  empty column. The provenance pane states the count, the last observed date, and
  the matching basis; a row with no observation reads as *not observed*, never as
  `0` uses.
- AC-5 (boundary): The pane states once, where the counts are read, that they come
  from retained Session evidence in this Project within the stated window, and
  that an absent count is not proof a definition is unused.
- AC-6 (degradation): With usage unavailable — an older provider, the desktop
  Rust evidence path, or a Project with no retained Sessions — the View renders
  exactly as before, with no column, no error, and no empty state regression.

## Non-goals
- No usage counts for Instructions, Agents, Plugins, Commands, or Hooks. Command
  invocation has no detection rule today, and Hook execution statistics exist for
  one host only; inventing a number for them would be worse than an honest gap.
- No per-tool counts inside an MCP server, no cost/latency metrics, no charts.
- No change to the customization catalog schema owned by `@qoder-ai/harness`.
- No new session reading pass: usage rides the existing discovery.

## Plan and Tasks
1. `scripts/session-analysis/customization-usage.mjs`: the matching vocabulary and
   the per-session/aggregate builders, exported from the package index.
2. `scripts/commit-session-link/session-source.mjs`: an opt-in
   `includeCustomizationUsage` flag that attaches the per-session record, forwarded
   by both collectors.
3. `packages/harness-studio/scripts/inspector-workspace-provider.mjs`: aggregate the
   records into the discovery payload.
4. Studio server: contract type, discovery plumbing, and `GET /api/customizations/usage`.
5. Studio app: usage index and row lookup in `customization-library.ts`, the Uses
   column, provenance facts, boundary line, and bilingual strings.
6. Tests at every seam plus a browser scenario, and this spec's evidence section.

## Test and Review Evidence
- Unit (AC-1, AC-2): `test/sessions/customization-usage.test.mjs` — 7 tests over the
  matching vocabulary (`better-harness:ui-ux-pro-max` → `ui-ux-pro-max`,
  `Claude_Browser` → `claude_browser`), the per-Session collector, per-Host
  attribution, dropped observations without a Host/kind/name, merged repeats, and
  an empty aggregate that stays distinguishable from a missing one.
- Unit (AC-2, AC-4): `packages/harness-studio/test/customization-library.test.ts` —
  a row reads only the Hosts it is exposed to, the Agent filter narrows the count
  (7 across Codex+Qoder, 2 for Codex, 5 for Qoder), an unexposed Host yields no
  count, a Hook row is never matched to a Skill observation, and only Overview,
  Skills, and MCP Servers are observable.
- Server (AC-3): `packages/harness-studio/test/customization-server.test.ts` —
  `GET /api/customizations/usage` is 404 before a Project is open, serves the
  bounded aggregate after discovery (a fractional session count is truncated, an
  invalid window bound becomes `null`, and zero-count, unsupported-kind, and
  blank-Host entries are dropped), and a malformed aggregate fails the Project open
  instead of reaching the browser.
- Browser (AC-4, AC-5, AC-6): `test/browser/customization.spec.mjs` — the Uses
  column appears for Skills and MCP Servers, follows the Agent filter (7 → 2 → 5),
  states the boundary ("4 retained Sessions of this Project"), reports
  `5 observed invocations, last on 2026-09-08` in the provenance pane, sorts by the
  column, and is absent for Hooks. The pre-existing scenarios still pass with usage
  present, and the retry scenario covers a Project without it.
- Real evidence: opened this repository as the Project through the Inspector
  provider. 100 retained Sessions across Codex, Claude, and Qoder produced 4
  observations — Skill `ui-ux-pro-max` 7 (Codex) + 1 (Qoder), Skill
  `change-traceability-review` 2 (Qoder), MCP server `claude_browser` 3 (Claude) —
  and the Skills table sorted by Uses leads with 8 and 2 above 229 unobserved rows.
  Screenshot: `outputs/studio-customization-usage/real-skills-uses.png`.
- Suites: TypeScript check, the Studio bundle, 639 Studio unit tests, 111 Studio
  Playwright tests, and 972 root session/reporting tests pass.
- Pre-existing failure, not from this change:
  `test/plugins/antigravity-plugin-artifact.test.mjs` pins the Markdown closure at
  114/320/117 while the repository now measures 116/323/119. Verified in a
  worktree at the parent commit that the drift already existed there, so the pin
  belongs to whoever added those docs.
- Review Readiness: the maintainer request supplies scope; no Story id was provided
  or inferred. Concurrent conversation/compare/memory work committed to `main`
  during this task is excluded from the change set. No push or install was
  requested. AI implementation and review: Qoder.

Commands and Hooks intentionally carry no count. Windows/Linux CI and desktop
packaging were not exercised; the desktop Rust evidence provider supplies no usage
yet and degrades to the previous View.
