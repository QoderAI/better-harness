# Host capability declarations stay consistent

## Traceability

- Spec ID: `2026-07-28-host-capability-consistency`
- Status: Implemented

## Intent

Better Harness currently has working Claude Code and Cursor configured-asset,
session-evidence, and portable-report paths, while `roadmap.md` still describes
some of those paths as unavailable. Contributors and users therefore cannot
reliably tell whether a host capability is implemented, partial, or deliberately
unsupported.

Add one narrow, machine-readable host-capability declaration and a focused
consistency test. Use it to correct the stale Roadmap without changing host
collection, report generation, checkup behavior, packaging, or host-runtime
smoke claims.

## Acceptance Scenarios

- **AC-1 (canonical declaration):** A checked-in declaration lists the current
  Qoder, Codex, Claude Code, and Cursor status for configured-asset inventory,
  session evidence, and portable durable-report output. Each status uses a
  small fixed vocabulary and does not imply runtime use from static inventory.
- **AC-2 (implementation consistency):** A focused test verifies that every
  host declared to support configured-asset inventory is registered in
  `agent-customize`; every host declared to support session evidence has a
  session platform adapter; and every host declared to support durable reports
  is accepted by the report route. A missing owner or undeclared host fails the
  test.
- **AC-3 (public-document consistency):** The adapter matrix and Roadmap use
  the same declared states for the three covered capabilities. Their
  descriptions distinguish fixture coverage from real installed-host smoke
  coverage and preserve explicit partial/unsupported boundaries elsewhere.
- **AC-4 (minimal behavior impact):** Existing CLI arguments, evidence
  collection paths, report formats, home-directory access, package boundaries,
  and host execution behavior remain unchanged.

## Non-goals

- Do not add a new coding-agent host, session source, inventory collector,
  checkup behavior or mutation executor, or real-host smoke environment.
- Do not promote partial fixture-backed support to a completed real-host smoke.
- Do not change Qoder, Codex, Claude Code, or Cursor runtime behavior or read
  any user-home data as part of the new consistency check.
- Do not generate public documentation from JavaScript in this change; the
  declaration remains a small canonical contract with explicitly maintained
  human-readable tables.

## Plan and Tasks

1. Add a capability-local host declaration module with a constrained status
   vocabulary and the four current hosts. Keep it data-only and dependency-free.
   (AC-1, AC-4)
2. Add a focused test that compares the declaration against the configured-asset
   provider registry, session-platform registry, and Harness report platform
   validation. (AC-2, AC-4)
3. Correct only the stale Roadmap rows and summary statements that contradict
   the declaration; retain honest partial and unsupported states. Add a small
   adapter-matrix reference to the declaration. (AC-3)
4. Regenerate the documentation graph, run focused checks and the full test
   suite, then perform a Review Readiness Check on the final local diff.
   (AC-1--AC-4)

## Test and Review Evidence

- **AC-1--AC-2:** a new focused host-capability consistency test, including
  negative fixture coverage for invalid status/owner combinations where exposed
  by the module API.
- **AC-3:** `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs`.
- **AC-4:** existing focused provider, session-platform, and report-route tests;
  then `npm test`.
- **Review:** inspect `git diff --check`, `git diff --stat`, staged/unstaged
  state, changed-module ownership, generated graph freshness, and explicit
  unsupported/partial claims before commit.
- **Risk:** the main risk is overclaiming host support. Review every declaration
  against an existing implementation owner and keep "real host smoke" partial
  unless an installed-host command was actually run and recorded.

## Implementation Evidence

- **AC-1--AC-3:** `node --test test/host-capability-consistency.test.mjs
  test/agent-customize-architecture.test.mjs test/harness-report-run.test.mjs
  test/session-analysis-providers.test.mjs` passed 30/30. The new consistency
  test checks every declared `yes` state against the inventory registry,
  session-adapter constructor, report-platform validator, adapter matrix, and
  Roadmap.
- **AC-3:** `node scripts/doc-link-graph/cli.mjs skills/better-harness` and
  `node --test test/doc-link-graph.test.mjs` passed; the graph remains 34 files
  and 50 links.
- **AC-4:** `git diff --check` passed. No provider, session, checkup, package,
  or host-shell implementation changed; exporting the existing report platform
  validator only makes its unchanged acceptance rule testable.
- **Regression boundary:** `npm test` was run after `npm ci`, but the local
  Node `v26.5.0` is outside the declared `>=22.20.0 <25.0.0` range. The suite
  still lacks the locked `esbuild-wasm` and `@vscode/tree-sitter-wasm` runtime
  dependencies and cannot bind `127.0.0.1` for preview tests. These failures
  reproduce outside this diff; the focused checks above pass.
- **Review Readiness:** no Story was supplied or inferred. The local diff is
  one spec-backed maintenance change on `fix/host-capability-consistency`; all
  changed files map to AC-1--AC-4, no generated file changed, and there are no
  staged/unstaged split changes at review time.
