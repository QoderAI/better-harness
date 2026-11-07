# Harness analysis host, history, instruction, and lead-binding defects

## Traceability

- Spec ID: 2026-10-24-harness-analysis-defects
- Story: QoderAI/better-harness#212, QoderAI/better-harness#195, QoderAI/better-harness#164
- Status: Implemented

## Intent

Repair the confirmed analysis defects found during Windows-hosted validation. The
defects fall into five groups: Qoder home discovery and CLI documentation,
bounded history windows that collapse to the same sample, instruction and gate
discovery gaps, an incomplete Claude Rules projection, and a missing regression
for the already-correct lead/session binding path. The change also brings the
file-explorer fixture in line with Windows environment and stream-lifecycle
behavior.

This work prefers honest coverage metadata over confident-looking but incomplete
data. A truncated or low-confidence history window must be visible as such, and
analysis must continue to fail closed when real binding conflicts exist.

## Acceptance scenarios

- AC-1: `--qoder-home` remains explicit and wins over environment/defaults, and
  help for `harness analyze`, `harness evidence-bundle`, and task-loop source
  advertises the option. `QODER_HOME` is honored by the Qoder session analyzer
  only when it names an asset home (including `.qoder-cn`); a shared-client-cache
  value is ignored. The default prefers `~/.qoder-cn` only when `~/.qoder` is
  absent or has no session data.
- AC-2: history windows report independent ranges, so 30/90/180-day windows can
  report different commit counts and hotspots. A window reuses the bounded main
  scan when that scan reaches older than the window, and queries Git for the
  window otherwise. Every window exposes its commit limit, truncation state, and
  coverage status, with truncation exact at the limit.
- AC-3: `history-window-coverage` is `review` rather than `ready` when history
  confidence is low or any window is truncated, while retaining the existing
  ready behavior for complete high/medium-confidence history. The matrix note
  explains that raising `--max-commits` completes the 30/90/180-day windows in a
  very active repository.
- AC-4: instruction analysis recognizes root and nested `AGENTS.md` and
  `CLAUDE.md` carriers, counts each directory scope once when both carriers
  exist, excludes scratch directories from suggested scopes and the suggested
  instruction minimum, and reports carrier kinds without changing the existing
  density thresholds.
- AC-5: evidence packs expose project-owned package and Just gates, and the
  `validate-impact` action includes those exact commands when available. Gates
  that start long-running watchers, dev servers, or UI/open-headed sessions are
  not presented as validation commands.
- AC-6: Claude project Rules inventory includes a root `AGENTS.md` compatibility
  entry without duplicating `CLAUDE.md`. This relies on Claude Code reading
  `AGENTS.md` as project instructions; see
  <https://code.claude.com/docs/en/memory#agents-md>.
- AC-7: an integration test proves an injected session population keeps the lead
  lane available and carries `sessionBinding`, while the genuine conflict test
  still downgrades the lead to `SESSION_POPULATION_BINDING_MISMATCH`.
- AC-8: the file-explorer test sets both `HOME` and `USERPROFILE` on Windows and
  shuts down without asserting while child-process pipes are still closing.

## Non-goals

- Adding new host adapters or changing host support levels.
- Replacing the bounded `maxCommits` safety limit or adding unbounded history
  scans.
- Redesigning report/Canvas UI or changing the binding reconciliation contract.
- Treating scratch or generated files as instruction carriers.

## Plan and tasks

1. Align Qoder home resolution across asset and session analysis, and document
   the accepted host-home option.
2. Fetch and filter each history window independently, reuse the main scan when
   it covers the window, add coverage metadata, and make the review matrix
   consume it.
3. Extend instruction carriers, scope filtering, and project gate extraction.
4. Add root `AGENTS.md` to the Claude Rules inventory.
5. Add a lead/session binding integration regression and keep the conflict test.
6. Make the file-explorer fixture portable and close child streams explicitly.
7. Run focused tests, then the broader affected suites.

## Test and review evidence

- `test/agents/coding-agent-practices-inventory.test.mjs` covers Qoder asset
  homes, `QODER_HOME` separation, and an implicit `.qoder-cn` home.
- `test/agents/agent-customize.test.mjs` covers Qoder provider `QODER_HOME`
  resolution and the Claude Rules root `AGENTS.md` compatibility entry.
- `test/sessions/session-analysis.test.mjs` exercises Qoder session roots from
  `QODER_HOME`, rejects a non-asset `QODER_HOME` (shared client cache), the
  `~/.qoder-cn` default, and the both-homes preference.
- `test/governance/core-change-watch.test.mjs` covers independent history
  windows, exact truncation at the commit limit, instruction scope deduplication,
  scratch-scope exclusion, non-terminating gate exclusion, and project gates in
  the `validate-impact` action.
- `test/reporting/better-harness-evidence-bundle.test.mjs` exercises the real
  Claude lead/session binding path and keeps the genuine conflict regression.
- `packages/harness-studio-apps/test/test_file_explorer.mjs` passes on Windows
  with `HOME`/`USERPROFILE` isolation and orderly child shutdown.
- `test/support/path-links.mjs` keeps Windows fixtures portable with directory
  junctions and skips only the two file-symlink cases when the host denies them.
- The DSH explicit-root fixture isolates `HOME`/`USERPROFILE`, so external roots
  are not accidentally classified as user-home paths.
- Full `npm test` on 2026-10-25: 1767 passed, 30 skipped, 0 failed.
