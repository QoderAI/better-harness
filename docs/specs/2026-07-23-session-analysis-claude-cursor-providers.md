# Support Claude Code and Cursor session providers

## Traceability

- Spec ID: session-analysis-claude-cursor-providers
- Status: Implemented
- Port source: sibling source commit `33b19bf1`
- Related local contract: [Stabilize Scripts Refactoring Contracts](2026-07-21-scripts-refactor-contracts.md)

## Intent

Add Claude Code and Cursor as first-class, read-only providers for the existing
`session-analysis` capability. Preserve provider provenance and evidence gaps
while reusing the current selection, facts, facets, insights, usage, and
semantic-facet owners. Claude project transcripts are the primary Claude
source. Cursor project transcripts are joined with chat metadata and optional
audit events because the transcript alone does not expose timestamps, results,
or usage.

The implementation must not treat generated Claude Insights facets, missing
Cursor timestamps, or an unavailable audit join as observed outcomes. It must
also keep Qoder and Codex output backward compatible.

## Acceptance Scenarios

- SCCP-AC-1: The public `scripts/session-analysis.mjs` facade accepts
  `--platform claude` and `--platform cursor` for `sources`, `sessions`,
  `facets`, `insights`, `facts`, `file-reads`, `show`, `events`, and
  `claude-facets`, while existing Qoder and Codex commands remain compatible.
- SCCP-AC-2: A provider may expand one raw record into multiple normalized
  events so every nested `tool_use` and `tool_result` retains its own invocation
  identity and evidence reference.
- SCCP-AC-3: Claude discovery reads workspace-matching JSONL transcripts under
  `~/.claude/projects`, verifies the embedded cwd, and treats current and legacy
  Claude audit logs as optional lifecycle evidence rather than a prerequisite.
- SCCP-AC-4: Claude normalization preserves bounded user and assistant text,
  tool requests and results, model and usage fields, timestamps, cwd,
  permission mode, and sidechain identity without treating titles,
  attachments, or queue metadata as task outcomes.
- SCCP-AC-5: Generated `~/.claude/usage-data/facets` never enters production
  facts or findings. Derived usage-data artifacts remain excluded unless a
  future explicit contract marks their provenance and inference boundary.
- SCCP-AC-6: Cursor discovery reads workspace-scoped agent transcripts, joins
  matching `chats/*/<session>/meta.json` records by session id, and joins only
  audit records whose session, conversation, or transcript identity belongs to
  the selected workspace.
- SCCP-AC-7: Cursor normalization maps camel-case lifecycle events, tool input
  and output, model and token usage, permission decisions, file edits, shell
  execution, MCP execution, user prompts, assistant handoffs, and subagent
  boundaries into the provider-neutral event contract.
- SCCP-AC-8: Missing or partial timestamps, tool results, model usage, or audit
  joins are reported as explicit source-coverage warnings or `Unobserved`
  evidence. They never become zero activity, successful validation, task
  completion, acceptance, or a provider-quality comparison.
- SCCP-AC-9: Workspace matching and provider-home routing work on Windows,
  macOS, and Linux without shell-only path assumptions or reliance on one
  observed slug spelling.
- SCCP-AC-10: Active-session exclusion is provider-owned. A provider without a
  reliable current-session environment id falls back to the existing bounded
  active-window rule rather than reading another provider's environment id.
- SCCP-AC-11: `usage-summary` and the non-Canvas Harness analysis path accept
  Claude and Cursor evidence without coercing either provider to Qoder. Qoder
  remains the only Canvas-output host.
- SCCP-AC-12: Focused fixtures cover discovery, workspace isolation,
  one-to-many message expansion, transcript/meta/audit joins, stale or missing
  optional sources, privacy-safe facts, usage coverage, and provider-labelled
  Harness output.
- SCCP-AC-13: Validation includes focused session-analysis and Harness tests,
  the full repository suite, Markdown link-graph regeneration and validation,
  package verification, and bounded read-only forward tests against real local
  Claude and Cursor provider homes without persisting raw session content.

## Non-goals

- Import Claude Insights semantic facets as observed session facts.
- Decode Cursor's internal content-addressed `store.db` blob format in the
  first implementation.
- Claim complete historical coverage when audit, metadata, or transcript
  stores cover different time windows.
- Compare provider quality from event counts or missing fields.
- Add Canvas output for Claude or Cursor.
- Change findings, scores, or repair state merely because another provider is
  available.

## Plan and Tasks

1. Add a backward-compatible one-to-many normalization hook to both the public
   compatibility entrypoint and the capability-owned analyzer, plus a shared
   provider analysis runner for the new adapters.
2. Implement Claude source discovery, transcript expansion, optional audit
   normalization, source coverage, and fixtures.
3. Implement Cursor transcript discovery, chat-meta and audit joins, lifecycle
   normalization, source coverage, and fixtures.
4. Register both providers in the public CLI, capability-owned analyzer, usage
   route, planning/lifecycle host normalization, active-session resolution,
   and non-Canvas Harness path. Refresh the deliberately frozen CLI help
   fixtures and command descriptions to reflect the accepted provider surface.
5. Add focused tests and bounded real-home forward probes that emit only
   aggregate or privacy-safe envelopes.
6. Regenerate documentation routing, run the full validation stack, and update
   this spec to Implemented only when the visible evidence supports it.

## Test and Review Evidence

- The focused provider, Harness, shared-contract, frozen CLI, and doc-link
  suite passed with 183 tests:
  `node --test test/session-analysis-providers.test.mjs
  test/harness-report-run.test.mjs test/task-loop-source.test.mjs
  test/session-analysis.test.mjs test/session-analysis-core-facts.test.mjs
  test/session-usage-summary.test.mjs test/session-selection-plan.test.mjs
  test/scripts-refactor-contract.test.mjs test/better-harness-cli.test.mjs
  test/doc-link-graph.test.mjs`.
- `npm test` passed after the final capability-owned analyzer, CLI snapshot,
  and documentation adaptations.
- `env npm_config_cache=/tmp/better-harness-npm-cache npm run pack:verify`
  passed with 284 npm-package entries and 318 runtime-zip entries.
- `node scripts/doc-link-graph/cli.mjs skills/better-harness` regenerated the
  routing graph, and the doc-link test confirmed it is current.
- Read-only local forward probes passed for Claude and Cursor bounded `facts`
  and non-Canvas `harness analyze`. Neither provider had a workspace-matching
  local session, so both correctly returned an explicit zero-session boundary
  without writing report artifacts.
