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
   standalone `html-report` validation step. The registry has no `prepare`
   subcommand, and `html-report` is not a CLI step: it is the HTML validator
   check id inside the renderer
   (`scripts/harness-analysis/renderers/html.mjs`). Rendering/validation runs
   through `harness analyze` plus `harness render --mode html --validate`
   (`scripts/better-harness-cli/registry.mjs`,
   `scripts/harness-analysis/render-report.mjs`).
2. The Cursor Smoke cell presents `agent --plugin-dir . --mode ask --print ->
   Cursor evidence bundle -> validated html render` as an existing smoke
   chain, while `roadmap.md` records Cursor Harness analysis as No and tracks
   the packaged runtime smoke as open item U-04. The missing contract is a
   real Better Harness Cursor host smoke, not the binary name: `agent` is the
   current primary Cursor CLI and `cursor-agent` is a legacy alias for the
   same executable, and both accept `--plugin-dir`.
3. The Cursor Default Output cell claims a `self-contained HTML + Markdown`
   pipeline, but `roadmap.md` records Cursor Durable report as "No supported
   pipeline" and tracks the static-only report route as open item U-03. A
   documentation string is not host or runtime proof, so the column must not
   assert a working output pipeline.

The Claude Code and Codex Default Output columns and `html-visual.md` routing
already match the durable-HTML product decision from
`docs/specs/2026-07-27-claude-durable-html-default.md` and stay unchanged.

## Acceptance Scenarios

- AC-1: The matrix's Codex Smoke cell uses only commands that exist today and
  states validation explicitly: `harness analyze --platform codex` followed by
  `harness render --mode html --validate`; the strings `harness prepare` and
  `html-report` no longer appear in `docs/adapters/README.md`. `harness render`
  defaults `--validate` to false, so the flag must be written out.
- AC-2: The Cursor Smoke cell no longer claims an existing evidence-bundle ->
  validated render smoke chain; it states that the packaged runtime smoke is
  not yet available and points to roadmap item U-04.
- AC-3: The Cursor Default Output cell no longer claims a
  `self-contained HTML + Markdown` pipeline; it marks the durable-report
  output as not yet supported and points to roadmap item U-03, matching the
  roadmap's "No supported pipeline" record.
- AC-4: `test/agent-customize-architecture.test.mjs` still passes unchanged.
  `test/better-harness-skill.test.mjs` is updated so its Cursor row assertion
  matches the pending-U-03 output marker instead of the removed
  `self-contained HTML + Markdown` claim; the Claude Code row assertion stays
  unchanged.
- AC-5: `node --test test/doc-link-graph.test.mjs` passes; no markdown links
  change.

## Non-Goals

- No change to the Session Evidence columns, or to the Claude Code and Codex
  Default Output columns; their durable-HTML defaults are an accepted product
  contract guarded by `test/better-harness-skill.test.mjs`.
- No new Cursor report route or runtime smoke; U-03 and U-04 stay open. This
  change only stops the docs from overstating unshipped Cursor output.
- No support-declaration consistency tests (tracked separately as A-06).
- No CLI, renderer, or provider code changes.

## Plan

1. Rewrite the Codex Smoke cell to the current
   `harness analyze --platform codex` -> `harness render --mode html --validate`
   chain, writing the `--validate` flag out explicitly.
2. Mark the Cursor Smoke cell runtime smoke as pending roadmap U-04 instead of
   claiming a working chain, without a binary-name change (`agent` and
   `cursor-agent` are the same executable).
3. Mark the Cursor Default Output cell as pending roadmap U-03 and update the
   guarding `test/better-harness-skill.test.mjs` Cursor assertion to match.
4. Check A-05 off in `roadmap.md`.

## Test Evidence

- `node --test test/agent-customize-architecture.test.mjs`
- `node --test test/better-harness-skill.test.mjs`
- `node --test test/doc-link-graph.test.mjs`
