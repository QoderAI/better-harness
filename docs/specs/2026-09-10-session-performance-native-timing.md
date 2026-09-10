# Session performance for Claude and Codex

## Traceability

- Spec ID: session-performance-native-timing
- Status: Implemented; local validation
- Request: desktop Electron Performance must time retained Codex and Claude sessions, not only Qoder.

## Intent

The Performance workbench times Claude Code transcripts and Codex rollouts with
the same pairing rules as Qoder. Desktop macOS must run that reader through the
Evidence NSXPC host. Catalog ranking stays bounded. Codex must not count the
same exec twice, must share session identity with Sessions discovery, and must
not use harness preamble as a title.

## Acceptance scenarios

- AC-1: A workspace Claude transcript and a workspace Codex rollout appear in
  the Performance catalog with `claude:<id>` / `codex:<id>` and non-empty
  timing (wall or longest), not as `no-evidence`.
- AC-2: Detail for those ids returns paired model/tool/shell intervals. Codex
  `payload.id` is the catalog id even when `payload.session_id` differs, matching
  `sessions.discover`.
- AC-3: When a rollout has `item_completed` CommandExecution, `exec` /
  `function_call` stream copies of the same work are not also counted as tools.
  A `wait` call that has no item still remains.
- AC-4: A user message that starts with `You are running under harness revision`
  keeps only the text after the policy block as the title. A message that is
  only that block does not become the title.
- AC-5: Catalog analysis is globally capped at `maxSessions` (default 200, max
  500) across Qoder+Claude+Codex, not 200 per provider. Catalog rows do not run
  tool-phase / subagent linking. The browser contract still rejects more than
  500 catalog sessions.
- AC-6: macOS desktop Evidence XPC (`Harness Evidence.app`) embeds a host that
  contains the Claude/Codex reader, not the older Qoder-only binary.

## Non-goals

Cursor/Copilot/other hosts, changing Qoder pairing semantics, installing a
release build, rewriting Sessions discovery, or editing Codex/Claude files.

## Plan and tasks

1. Restore unrelated Playwright deletions from this working tree.
2. Align Codex performance ids with `platforms/codex.rs` (`payload.id` first).
3. Skip stream `exec` tools when CommandExecution items exist; strip harness
   revision preambles from titles.
4. Rank all providers by mtime, analyse only the global cap, and summarise
   catalog rows without wait-phase linking.
5. Rebuild and stage `Harness Evidence.app` so Electron NSXPC serves the new host.

## Test and review evidence

- AC-1/2/3/4/5: evidence-host lib tests 36 passed, including
  `native_transcripts_are_measured_by_the_same_rules_and_stay_namespaced`
  (id alignment, exec not doubled, wait kept, harness title, global cap).
  Studio `session-timing-api.test.ts` 13 passed, including namespaced detail
  and a 500/501 catalog contract bound.
- AC-6: `Harness Evidence.app` XPC host restaged 2026-09-10 17:40 and contains
  `request-boundary` / Claude reader strings. Relaunch Electron after killing
  any leftover `harness-evidence-*` processes so launchd does not keep the old
  driver.
