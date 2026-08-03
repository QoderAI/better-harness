# Claude transcript-dir slug must fold dots like Claude Code does

## Traceability

- Spec ID: 41-claude-transcript-dir-dot-slug
- Story: QoderAI/better-harness#41
- Status: Implemented

## Intent

The Claude session-evidence collector derives the project-transcript directory
from the workspace path by replacing `/` (and drive-letter `:`) with `-`, but
Claude Code's own project-directory naming also replaces `.` with `-`. For any
workspace path containing a dot component (`~/.claude`, `~/src/foo.bar`,
`~/work/my.project`), the computed root does not exist and every
session-derived signal is silently computed from an empty set. The collector
must resolve the same directory name Claude Code actually creates so dotted
workspace paths stop reporting zero sessions.

## Acceptance Scenarios

- AC-1: `workspaceToClaudeSlugVariants("/Users/twurm/.claude")` includes
  `-Users-twurm--claude` (each `/` and `.` folded to `-`, dots not collapsed),
  and that variant is preferred as the primary slug.
- AC-2: A Claude provider fixture whose workspace path contains a dotted
  directory component discovers its transcript sessions from
  `projects/<dot-substituted-slug>` via `sources` discovery instead of
  reporting zero eligible sessions.
- AC-3: Existing slug variants remain covered: dotless Unix workspaces still
  resolve to the previous slug, and Windows drive paths still produce both
  `C--...` and colonless variants (existing tests keep passing).

## Non-goals

- No changes to other platform slug functions (Cursor, Qwen, Qoder, Pi,
  Workbuddy); the defect and evidence in the Story are Claude-specific.
- No folding of further character classes (e.g. `_`, spaces) beyond `.`;
  the Story only evidences the `.` substitution. A wider audit of Claude
  Code's slug alphabet stays out of scope until concrete evidence exists.
- No change to the `missing-required-root` warning flow itself.

## Plan and Tasks

- `scripts/session-analysis/platforms/claude.mjs`: extend
  `workspaceToClaudeSlugVariants` so the dot-substituted forms
  (`replace(/[\\/.]/g, "-")`, applied per character so `.claude` yields
  `--claude`) are emitted first, while retaining the previous slash-only
  variants for backward compatibility with directories created before the
  fix or by older host versions. Discovery already probes every variant via
  `paths`, so adding variants is additive and safe.
- `test/session-analysis-providers.test.mjs`: add slug assertions for a
  dotted Unix path plus a provider-level regression fixture that stores a
  transcript under the dot-substituted project directory and asserts the
  session is discovered.

## Test and Review Evidence

- AC-1/AC-3: `node --test test/session-analysis-providers.test.mjs`
  (slug variant assertions, existing Unix/Windows expectations unchanged).
- AC-2: same test file, new fixture "Claude provider resolves transcripts for
  dotted workspace paths".
- Regression safety: `node --test test/session-workspace-provider.test.mjs
  test/session-analysis-claude-facets.test.mjs` exercise dependent flows.
- Risk: low — additive slug variants; primary slug order changes only for
  paths containing dots, which previously resolved to nonexistent roots.
