# Agent Customize Help-only Path

Give `agent-customize` a help-only path so `--help` returns before the CLI
reads HOME, workspace, SQLite, or plugin caches. This is roadmap P0 item A-04.

## Traceability

- Spec ID: 2026-07-28-a04-agent-customize-help-only
- Story: roadmap.md TODO A-04
- Status: Implemented

## Intent

`scripts/agent-customize/cli.mjs` has no help branch. Any invocation —
including `--help` — runs `collectAgentCustomizeInventory`, which resolves the
provider home, walks the workspace, and opens provider caches (Cursor plugin
cache, Qoder SharedClientCache, Claude state, Codex app paths). A discovery
call such as `better-harness agent-customize --help` therefore reads private
host data before printing anything, and the root facade passes `--help`
through to this script unchanged for direct-dispatch commands.

The unsupported-behavior rule in `roadmap.md` (Definition of Done) requires
help and other unsupported paths to fail or return before reading private
data.

## Acceptance Scenarios

- AC-1: `node scripts/agent-customize/cli.mjs --help` (also `-h` and the
  `help` command word) prints usage to stdout and exits 0 without calling
  `collectAgentCustomizeInventory` or any provider collector.
- AC-2: The help-only path performs no HOME, workspace, SQLite, or plugin
  cache access. Evidence: `--help` combined with an unsupported
  `--provider` value still exits 0, while the same unsupported provider
  without `--help` keeps failing with the existing collector error.
- AC-3: `better-harness agent-customize --help` through the root facade
  reaches the same help-only path and exits 0.
- AC-4: Existing `inventory` and `manage` behavior is unchanged for all
  non-help invocations; `npm test` passes.

## Non-Goals

- No checkup capability states (A-01), provider-aware plan/apply (A-02), or
  provider-home binding (A-03).
- No change to `collectAgentCustomizeInventory`, provider collectors, or the
  root facade dispatch contract.
- No new flags beyond help recognition.

## Plan

1. Add a `usage()` string and an early help gate to
   `scripts/agent-customize/cli.mjs`, following the `agent-lint` CLI pattern:
   detect `--help`, `-h`, or a leading `help` command before parsing options
   or importing collector work, print usage, and return exit code 0.
2. Add CLI tests in `test/agent-customize.test.mjs` that spawn the script
   and the root facade to cover AC-1 through AC-3.

## Test Evidence

- `node --test test/agent-customize.test.mjs`
- `npm test`
