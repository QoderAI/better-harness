# Adapter Matrix Stale Commands Cleanup

Fix stale smoke commands in the Host Adapter Matrix so every referenced CLI
step exists in the current implementation and the Cursor row does not claim a
runtime smoke that the roadmap tracks as missing. This is roadmap P0 item A-05.

## Traceability

- Spec ID: 2026-07-28-a05-adapter-docs-stale-commands
- Story: roadmap.md TODO A-05
- Status: Implemented

## Intent

The `docs/adapters/README.md` matrix drifted from the shipped CLI:

1. The Codex Smoke cell references `harness prepare --platform codex` and a
   `html-report` validation step. Neither exists: the registry has no
   `prepare` subcommand, and rendering/validation runs through
   `harness analyze` plus `harness render --mode html --validate`
   (`scripts/better-harness-cli/registry.mjs`,
   `scripts/harness-analysis/render-report.mjs`).
2. The Cursor Smoke cell presents `agent --plugin-dir . --mode ask --print ->
   Cursor evidence bundle -> validated html render` as an existing smoke
   chain, while `roadmap.md` records "Real host smoke test: Cursor No" and
   tracks the packaged `cursor-agent --plugin-dir` smoke as open item U-04.
   The cell also uses the `agent` binary name instead of `cursor-agent`.

Reader-facing output contracts (Default Output columns, `html-visual.md`
routing) already match the durable-HTML product decision from
`docs/specs/2026-07-27-claude-durable-html-default.md` and stay unchanged.

## Acceptance Scenarios

- AC-1: The matrix's Codex Smoke cell uses only commands that exist today:
  `harness analyze --platform codex` and a validated
  `harness render --mode html` step; the strings `harness prepare` and
  `html-report` no longer appear in `docs/adapters/README.md`.
- AC-2: The Cursor Smoke cell no longer claims an existing evidence-bundle ->
  validated render smoke chain; it states that the packaged
  `cursor-agent --plugin-dir` runtime smoke is not yet available and points
  to roadmap item U-04.
- AC-3: Existing content-contract tests keep passing unchanged:
  `test/agent-customize-architecture.test.mjs` and
  `test/better-harness-skill.test.mjs` assertions over
  `docs/adapters/README.md`.
- AC-4: `node --test test/doc-link-graph.test.mjs` passes; no markdown links
  change.

## Non-Goals

- No change to Default Output or Session Evidence columns; the durable-HTML
  defaults for Claude Code, Codex, and Cursor are an accepted product
  contract guarded by `test/better-harness-skill.test.mjs`.
- No support-declaration consistency tests (tracked separately as A-06).
- No CLI, renderer, or provider code changes.

## Plan

1. Rewrite the Codex Smoke cell to the current
   `harness analyze --platform codex` -> validated
   `harness render --mode html` chain.
2. Rewrite the Cursor Smoke cell to name the correct `cursor-agent` binary
   and mark the runtime smoke as pending roadmap U-04 instead of claiming a
   working chain.
3. Check A-05 off in `roadmap.md`.

## Test Evidence

- `node --test test/agent-customize-architecture.test.mjs`
- `node --test test/better-harness-skill.test.mjs`
- `node --test test/doc-link-graph.test.mjs`
