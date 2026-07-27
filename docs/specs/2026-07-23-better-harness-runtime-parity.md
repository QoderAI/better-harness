# Align the Better Harness runtime

## Traceability

- Spec ID: better-harness-runtime-parity
- Status: Implemented
- Source snapshot: synchronized repository state at `6020bfb9bc4fefc9c85159bc3f07ff926f53d941`

## Intent

Bring the current Better Harness evidence runtime, Skill routing, reference
guidance, and verification coverage from the sibling source checkout into
this standalone repository. Preserve this repository's public packaging,
preview, `qoder-canvas`, frozen CLI, and compatibility owners while matching the
source behavior at the selected snapshot.

## Acceptance Scenarios

- AC-1: authorized project, user-home, global-hook, plugin, and Memory scopes
  remain provider-labelled and isolated; one shared inventory feeds asset lint,
  baseline, and integrity without silently widening scope.
- AC-2: Qoder, Codex, and Cursor asset collection deduplicates compatibility
  aliases, reports canonical evidence owners, and keeps project Qoder Memory
  metadata distinct from separately authorized global or body access.
- AC-3: Qoder session discovery recognizes POSIX and Windows workspace slug
  variants, preserves permission outcomes, and exposes privacy-safe request
  metadata without durable raw prompts, debug ids, or private paths.
- AC-4: session analysis emits bounded Task Episodes, request evolution, and a
  typed work trace that distinguishes inspection, change, execution, checking,
  and handoff while declaring evidence gaps and omissions.
- AC-5: harness analysis supports deterministic text and JSON envelopes,
  bounded windows, summary facts, and atomic Canvas output through this
  repository's `qoder-canvas` renderer and report-source layout.
- AC-6: finding-bound repair records immediate Repair Progress separately from
  Loop Effectiveness; legacy score-review callbacks remain readable but cannot
  raise effectiveness without a later independent outcome window.
- AC-7: task-loop reconciliation accounts for candidates, enforces evidence,
  numeric, asset, privacy, repair-prompt, and promotion gates, and keeps
  historical report contracts readable without authoring a new suggestions
  portfolio.
- AC-8: all current Better Harness reference documents and bug-diagnosis
  examples are reachable from `skills/better-harness/SKILL.md`; the retired
  standalone `skills/loop-blueprint` Skill is not restored.
- AC-9: source packaging guards and runtime owners are adapted to
  `scripts/npm-package`, local preview/report-source modules, Claude packaging,
  frozen CLI contracts, and the existing Better Harness Canvas template rather
  than replacing those local owners.
- AC-10: focused tests, the Markdown link graph, full tests, package verification,
  plugin validation, and preview health/module smoke tests pass on the synced
  tree; the readiness review records any intentional residual script diff.

## Non-goals

- Do not publish, push, or change registry versions.
- Do not add a duplicate render mode or replace `qoder-canvas`.
- Do not delete local-only preview, report-source, frozen-contract, Claude, or
  terminal-demo owners merely to make directory listings byte-identical.
- Do not restore the standalone Loop Blueprint Skill or rewrite historical
  specs and changelog evidence.
- Do not claim source parity for intentionally adapted paths without tests.

## Plan and Tasks

1. Sync provider collectors, inventory, baseline, integrity, and their fixtures.
2. Sync session discovery, privacy, request evolution, work-trace analysis, and
   deterministic tests including Windows slug coverage.
3. Sync JSON analysis, summary facts, task-loop reconciliation, Repair Progress,
   renderers, validators, models, and templates while adapting local owners.
4. Sync missing reachable references, examples, package guards, and regression
   tests without importing retired or incompatible public namespaces.
5. Regenerate the documentation routing graph, run focused and full validation,
   inspect package/plugin/preview artifacts, and perform a Review Readiness Check.

## Test and Review Evidence

- AC-1..AC-4: provider, asset-baseline, asset-integrity, session-source,
  session-features, and session-analysis tests with deterministic fixtures.
- AC-5..AC-7: harness-analysis CLI/renderer/validator, task-loop-report, and
  finding-bound-fix tests, including JSON and Canvas replacement paths.
- AC-8: `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs test/better-harness-skill.test.mjs`.
- AC-9..AC-10: `npm test`, `npm run pack:verify`, plugin validation, then
  `npm run preview` with `/health` and `/canvas-module.js` smoke checks.
- Risk: byte-copying source owners can erase local behavior. Review each source
  overlay against local-only files and preserve the explicit adaptation boundary
  above before accepting full-suite evidence.

Implemented evidence:

- Focused provider, session, report, repair, Skill, hook, packaging, and frozen
  CLI contract suites passed after the source-owner sync.
- `node --test --test-reporter=dot` passed with loopback access enabled for the
  preview tests; sandbox-only execution otherwise reports `listen EPERM` for the
  three loopback server cases.
- `npm run pack:verify` passed with 280 npm entries and 314 runtime ZIP entries.
- `qodercli plugin validate .` passed.
- Preview smoke returned `ok` from `/health` and HTTP 200 with 86,836 bytes from
  `/canvas-module.js` at `http://127.0.0.1:58575`.
