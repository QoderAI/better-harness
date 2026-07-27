# Evidence Commands

Use bounded local evidence first:

- Current changes: `git status --porcelain=v1 | sed -n 'l'`, `git diff --cached --name-only`, `git diff --stat`, `git diff --name-only`, and focused hunks.
- Specs: `find docs/specs -maxdepth 2 -type f` when present, then `rg -n "<story-id>|Spec ID:|Story:|Acceptance|Test" docs specs`.
- History: `git log -n <N> --pretty=fuller`, `git show --stat --format=fuller <commit>`, and `git log --all --grep=<story-id> --format=fuller --name-only`.
- Local docs/tests: `docs/`, `specs/`, `adr/`, `rfcs/`, `design/`, `architecture/`, nearby `AGENTS.md`, changed tests.

For status output, preserve leading spaces. The first porcelain column is
staged/index state and the second is worktree state: `M ` staged, ` M`
unstaged, `MM` both, `??` untracked. Do not claim staged content unless
preserved porcelain and `git diff --cached --name-only` agree.
