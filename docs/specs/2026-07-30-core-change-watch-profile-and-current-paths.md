# Core Change Watch Profile And Current Paths

## Traceability

- Spec ID: 2026-07-30-core-change-watch-profile-and-current-paths
- Status: Implemented
- Issue: None; focused evidence-correctness maintenance discovered by a validated Better Harness report.

## Intent

Keep Core Change Watch's static project profile and current-work guidance
truthful. Framework labels must require framework-specific evidence, supported
root Just recipes must be visible without being executed, and current reads or
actions must not point to files that exist only in bounded Git history.

## Acceptance Scenarios

- AC-1: A Python project with FastAPI declared in a supported Python manifest
  and generic `app/api` or `app/services` paths is identified as FastAPI, is not
  identified as Rails, and receives no TypeScript-only path reason. A real
  Rails fixture remains identified from Rails-specific evidence.
- AC-2: Public recipes in a root `justfile`, `Justfile`, or `.justfile` are
  represented additively as entry candidates with `kind: "just-recipe"`, an
  argv-style `command`, the source path, and `executionStatus: "unverified"`.
  Parsing is static, bounded, handles LF and CRLF, ignores private recipes, and
  never runs Just or a shell.
- AC-3: `recommendedReads` and every `followUpActions[].files` entry resolve to
  a currently present tracked file or a currently present changed/untracked
  file. Deleted historical paths remain available in raw history evidence but
  are not projected as current work targets.
- AC-4: Focused Core Change Watch tests, repository documentation checks, and
  the full package gate pass without a new dependency.

## Non-Goals

- Session lane/lead population binding or source-fingerprint changes.
- Renderer progress-track ARIA changes.
- Agent Work Loop score changes or synthetic Task Episodes.
- Executing Just recipes, shell-string dispatch, or proving command success.
- Adding dependencies or a general TOML/Just parser.
- Editing generated reports, installed plugin caches, Session content, Memory,
  or user-home data.
- Rewriting or deleting valid raw Git-history evidence.

## Plan And Tasks

Allowed files, copied verbatim from the approved Worker package:

1. `docs/specs/2026-07-30-core-change-watch-profile-and-current-paths.md`
2. `scripts/core-change-watch/project-profile.mjs`
3. `scripts/core-change-watch/core-candidates.mjs`
4. `scripts/core-change-watch/evidence-pack.mjs`
5. `test/core-change-watch.test.mjs`
6. `references/project-harness/core-change-watch.md`
7. `CHANGELOG.md`
8. `docs/better-harness-doc-links.mmd`

Tasks:

1. Add focused regression fixtures for AC-1 through AC-3 and preserve the
   defect-specific failing run before production edits.
2. Tighten framework/path evidence and add bounded static Just recipe
   projection without changing existing entry-candidate meanings.
3. Filter history-derived current-work projections through present repository
   inventory while preserving the history profile.
4. Update the canonical Core Change Watch guidance and changelog, regenerate
   the Markdown routing graph, and mark this spec Implemented only after all
   acceptance evidence passes.
5. Run the change-traceability Review Readiness Check before commit or review.

## Test And Review Evidence

- The focused red run failed all three new regressions for the intended causes:
  missing FastAPI evidence, missing Just recipe projection, and a deleted
  historical path projected as current work. The same run passed 3/3 after the
  implementation.
- The real `database-caching` projection reports only `fastapi`, exposes
  `just sync`, `just api-dev`, `just health`, and `just check` with unverified
  status, uses no TypeScript reason for `app/api`, and emits only readable
  recommended/action paths.
- AC-1 to AC-3 red/green:
  `node --test --test-name-pattern='framework-specific evidence|Just recipes|non-current historical paths' test/core-change-watch.test.mjs`
- Focused suite: `node --test test/core-change-watch.test.mjs`
- Real target projection: run `analyzeProjectProfile`,
  `analyzeCoreCandidates`, and `buildEvidencePack` against `database-caching`;
  assert FastAPI/no Rails, argv Just entries with unverified status, neutral
  `app/api` reasons, and readable current-work paths.
- Documentation: regenerate the routing graph and run
  `node --test test/doc-link-graph.test.mjs`.
- Package gate: `TMPDIR=<clean-temp-root> npm run check` passed with 884/884
  tests plus npm-package and runtime-zip verification. The clean temp root
  avoids unrelated `/tmp/CLAUDE.md` ancestor-instruction contamination.
- Risk review: verify additive output fields, cross-platform path handling,
  preserved Rails and raw-history fixtures, no shell execution, no dependency
  changes, and an explicit AI co-author marker at commit time.
