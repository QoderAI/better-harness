# Make Claude Code reports durable by default

## Traceability

- Spec ID: claude-durable-html-default
- Status: Implemented

## Intent

Make an ordinary `/better-harness` run in Claude Code produce the same portable,
openable report experience promised by the public quick start. Claude Code
should default to the existing validated HTML renderer instead of returning an
inline-only review that leaves no reusable artifact.

## Acceptance Scenarios

- CDHD-AC-1: An ordinary Claude Code invocation selects durable HTML output by
  default. Inline output writes nothing only when the user explicitly requests
  an inline or no-files result.
- CDHD-AC-2: A durable Claude run writes exactly `findings.json`, `report.md`,
  and self-contained `report.html` below the target-local
  `.claude/better-harness` report root and succeeds only when the renderer
  returns `status: pass`.
- CDHD-AC-3: Qoder remains Canvas-first, Codex remains HTML-first, and the
  renderer's machine contract and report schemas do not change.
- CDHD-AC-4: The public README, host adapter matrix, report-routing contract,
  and canonical Better Harness Skill describe the same Claude default.
- CDHD-AC-5: Claude's native plugin manifest, isolated marketplace install,
  Skill discovery, and a real Claude routing probe pass against the updated
  source plugin.

## Non-goals

- Add a new renderer, report schema, Claude-specific findings model, or Claude
  session-evidence provider.
- Make the generated HTML depend on a server, remote asset, or Claude-only
  runtime.
- Change Qoder Canvas artifacts, Codex output, scoring, finding eligibility, or
  source-mutation authority.
- Publish the repository, package, or marketplace listing.

## Plan and Tasks

1. Update the report-routing switchboard so Claude Code and Codex select the
   existing HTML route by default, while an explicit inline request remains a
   no-write route.
2. Tighten the canonical Skill with host-specific default output roots and make
   report-artifact authority distinct from source/config mutation authority.
3. Align the README and host adapter matrix with the executable Skill contract.
4. Route standalone HTML findings through the compact Agent Work Loop validator
   instead of requiring the Qoder-only `canvas.json` sidecar.
5. Add focused contract assertions that prevent Claude from regressing to an
   undocumented inline-only default or a Canvas-only validation path.
6. Re-run Claude strict validation, isolated install/discovery, a real routing
   probe, focused renderer/docs tests, the documentation link graph, and package
   verification.

## Test and Review Evidence

- CDHD-AC-1/CDHD-AC-4: `node --test test/style-templates.test.mjs
  test/better-harness-skill.test.mjs` asserts the Claude default and explicit-inline
  exception across routing and Skill owners.
- CDHD-AC-2/CDHD-AC-3: `node --test
  test/harness-report-render-cli.test.mjs` confirms validated HTML contains the
  three named artifacts and remains self-contained while Canvas coverage stays
  green.
- CDHD-AC-4: regenerate the routing graph with `node
  scripts/doc-link-graph/cli.mjs skills/better-harness`, then run `node --test
  test/doc-link-graph.test.mjs`.
- CDHD-AC-5: run `claude plugin validate --strict .`; install the repository in
  an isolated `CLAUDE_CONFIG_DIR`; confirm `Skills (1) better-harness`; then ask
  a real Claude Code process which route an ordinary invocation selects.
- Risk: default report writes may surprise users who wanted chat-only output.
  Mitigate with an explicit inline/no-files override and keep report writes
  confined to the target-local host report root.
- Risk: Claude could hand-write HTML or leave partial artifacts after validation
  failure. Mitigate by retaining the renderer-only contract, exact artifact
  set, atomic publication, and `status: pass` gate.

## Implementation Evidence

- CDHD-AC-1/CDHD-AC-4: the canonical Skill, report routing, host matrix, README,
  architecture guide, and changelog now agree that Claude Code defaults to
  durable HTML and reserves write-free behavior for explicit inline/no-files
  requests. The Skill stays below its 12,000-byte prompt budget and passes the
  Skill Creator validator.
- CDHD-AC-2/CDHD-AC-3: standalone compact Agent Work Loop findings now use the
  compact validator for HTML/Markdown output while Qoder's split Canvas route
  still requires its sidecar. A target-local live render returned `status:
  pass`, exactly three artifacts, a passing self-contained HTML check, and no
  `canvas.json`.
- CDHD-AC-5: Claude Code 2.1.217 passed strict plugin validation. A fresh
  isolated marketplace install exposed `Skills (1) better-harness`; its copied
  Skill contained the Claude HTML route, and its copied renderer returned
  `status: pass`. A real one-turn Claude probe selected durable HTML,
  `.claude/better-harness`, and the exact three-artifact set.
- Final validation: `npm test` passed 822/822; `npm run pack:verify` passed with
  an isolated writable npm cache (290 npm entries and 324 runtime ZIP entries);
  the regenerated document graph passed all five focused integrity tests; and
  `git diff --check` passed.
