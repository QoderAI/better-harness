# Good AGENTS.md Example Fragments

Use these as review anchors when judging `AGENTS.md`, `CLAUDE.md`, or similar
agent instruction files. Good snippets are short, repo-specific, and difficult
for an agent to infer from the codebase, README, or common framework behavior.

Do not copy the whole set into a root instruction file. Pick only the rules that
match real project traps.

## Exact Tool Choice

```markdown
- Use Node 22 and pnpm 9. Do not run `npm install`; this repo uses
  `pnpm-lock.yaml` and workspace filters.
```

Why it is good: it names the exact runtime and package manager, explains the
forbidden alternative, and prevents lockfile churn.

## Focused Validation Command

```markdown
- For one changed test file, run
  `pnpm vitest run path/to/file.test.ts -t "<test name>"`.
```

Why it is good: it gives the agent a cheap validation path for small changes,
not only an expensive full-suite command.

## Non-Standard Tooling

```markdown
- Run Python through `pixi run python`, and run tests with `pixi run pytest`.
  The system Python is not configured for this repository.
```

Why it is good: non-standard tooling is high-value because the agent would
otherwise default to common ecosystem commands.

## Counterintuitive API Pattern

```markdown
- `apiClient.request()` never throws for HTTP errors. Check `result.ok` and
  `result.error`; wrapping it in `try/catch` hides handled API failures.
```

Why it is good: it explains a repo-specific mechanism that changes how new code
should be written.

## Required Local Helper

```markdown
- Use `createTrackedTempDir()` from `test/helpers/fs.ts` in tests. Do not call
  `fs.mkdtemp()` directly; the helper registers cleanup for parallel runs.
```

Why it is good: it points to the local abstraction and explains the failure mode
that generic code would miss.

## Risk Boundary

```markdown
- Ask before editing `db/migrations/`, changing lockfiles, or adding runtime
  dependencies. Never commit `.env*`, credentials, or generated release assets.
```

Why it is good: it separates approval-required work from forbidden work and
names concrete paths.

## Progressive Disclosure

```markdown
- For Terraform changes, read `infra/AGENTS.md`. Keep root instructions to
  cross-repo commands and safety rules.
```

Why it is good: it keeps root context small and routes specialized rules to the
directory where they matter.

## Vendor-Specific Wrapper

```markdown
- `AGENTS.md` is canonical for project policy. `CLAUDE.md` may add Claude-only
  slash commands or permission notes, but must not duplicate shared rules.
```

Why it is good: it prevents cross-tool policy drift while allowing useful
Claude-specific notes.

## Maintenance Rule

```markdown
- When a command in this file fails because the repo changed, update this file
  in the same change that fixes the command.
```

Why it is good: it treats agent instructions as reviewed operational code,
not static documentation.
