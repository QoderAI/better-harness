# Claude transcript-dir lookup must survive underscore paths and slug misses

## Traceability

- Spec ID: 73-claude-transcript-dir-underscore-slug
- Story: QoderAI/better-harness#73
- Status: Implemented

## Intent

`workspaceToClaudeSlugVariants()` folds `/`, `\`, `.`, and drive-letter `:` into
`-`, but never folds `_`. Claude Code does fold `_` when it names the directory
under `~/.claude/projects/`, so every workspace whose path contains an
underscore resolves to a nonexistent transcript root: the run succeeds and
reports 0 sessions, which reads as "no evidence" rather than "wrong lookup".
The Story confirms the diagnosis by junctioning the underscore spelling onto the
real folder, which turned 0 sessions into 15 of 15 with `evidenceMode`
`session-rich`.

Slug guessing is the deeper problem: the slug only selects which folder to open,
and `isWorkspaceMatch()` already re-checks the transcript `cwd` one step later.
A slug miss must therefore degrade to reading the recorded `cwd`, so the next
character Claude Code folds does not silently zero out session evidence again.

## Acceptance Scenarios

- AC-1: `workspaceToClaudeSlugVariants("C:\\work\\my_project")` puts
  `c--work-my-project` (underscore folded together with `.` and separators)
  first, and keeps the unfolded `c--work-my_project` spelling as a later
  fallback variant.
- AC-2: A Claude fixture whose transcript lives under an underscore-folded
  project directory discovers its sessions through `sources` instead of
  reporting zero eligible sessions.
- AC-3: When no slug variant directory exists, `sources` scans
  `<home>/projects/*`, keeps the directories whose transcripts record a `cwd`
  inside the selected workspace, reports the `claude-project-jsonl` root as
  `exists: true`, and analyzes those sessions. Unrelated project directories in
  the same root are not adopted.
- AC-4: Existing behavior is unchanged: dotted workspaces keep their
  dot-substituted primary slug, dotless Unix workspaces and Windows drive paths
  keep their previous variants, and a workspace with no transcripts anywhere
  still reports 0 sessions with the `missing-required-root` warning.

## Non-goals

- No change to other platform slug functions (Cursor, Qoder, Qwen, Pi,
  Workbuddy); the Story evidence is Claude-specific.
- No blanket `[^a-zA-Z0-9]` fold. The Story evidences `_`; the `cwd` fallback
  covers any further character class without guessing Claude Code's alphabet.
- No change to the `missing-required-root` warning shape or to verdict/exit-code
  semantics. The `cwd` fallback removes the false-negative case instead of
  turning it into a failure.

## Plan and Tasks

- `scripts/session-analysis/platforms/claude.mjs`:
  - Fold `_` alongside `.` in the primary slug variants, keeping the narrower
    `.`-only and separator-only classes as ordered fallbacks. Adding variants is
    additive because discovery probes every entry in `root.paths`.
  - Add a bounded `cwd`-based recovery in `discoverSourceRoots()`: when none of
    the slug paths exist, list `<home>/projects` and keep the directories whose
    `.jsonl` transcripts record a `cwd` that matches the workspace match scope.
    The recovered paths are appended to `root.paths`, so `exists` and
    `discoverSessions()` pick them up with no further changes.
- `test/session-analysis-providers.test.mjs`: add underscore slug assertions, an
  underscore-directory provider fixture, and a fallback fixture whose project
  directory name matches no slug variant while a sibling unrelated project must
  stay excluded.

## Test and Review Evidence

- AC-1/AC-4: `node --test test/session-analysis-providers.test.mjs`
  (underscore, dotted, Unix, and Windows slug assertions).
- AC-2/AC-3: same file, fixtures "Claude provider discovers transcripts for
  underscore workspace paths" and "Claude provider recovers transcripts from the
  recorded cwd when no slug variant matches".
- Regression safety: `node --test test/session-workspace-provider.test.mjs
  test/session-analysis-claude-facets.test.mjs test/session-analysis.test.mjs`.
- Risk: low. The slug change only reorders/extends variants for paths containing
  `_`, which previously resolved to nonexistent roots. The `cwd` scan runs only
  when every slug variant is missing — today's zero-session path — and is
  bounded by directory, file, and line caps.
