# Harden local analysis and mutation boundaries

## Traceability

- Spec ID: security-reliability-boundaries
- Status: Implemented

## Intent

Restore a trustworthy local execution baseline for Better Harness by fixing the confirmed CLI entrypoint regression and closing three confirmed security/reliability gaps in source mutation, secret scanning, and session-text redaction. The outcome is that supported paths execute deterministically, authorized source and backup writes cannot escape through symbolic links, incomplete secret scans cannot report success, and review packets do not retain URL userinfo credentials. Keep task-external release metadata out of agent-authored changes unless a maintainer or pre-existing requirement authorizes it.

## Acceptance Scenarios

- AC-1: Direct and delegated `cloc --json` execution produces parser-safe JSON when the installation, repository, or target path contains spaces or is reached through an equivalent symbolic path.
- AC-2: A Checkup source patch rejects a source or backup path reached through a symbolic-link component or resolving outside its authorized root; ordinary in-root files and backups remain writable.
- AC-3: Secret Scan reports machine-readable incomplete coverage and returns a distinct non-zero exit code when an explicit target, nested symbolic link, or safety-sensitive file read cannot be inspected; a complete clean scan still exits zero, while secret findings preserve their existing finding exit behavior.
- AC-4: Session/review text redaction removes GitLab tokens and userinfo credentials from hierarchical URLs across HTTP, database, SSH, percent-encoded, and username/token-only forms.
- AC-5: Focused regression tests, the full root test suite, package verification, documentation build, and repository secret scan complete successfully.
- AC-6: Agent instructions prohibit proactive changelog, release-note, version, and task-external metadata edits unless the user or a pre-existing requirement authorizes them; user-visible behavior alone is insufficient.

## Non-goals

- Redesigning the Host capability registry, Evidence Bundle cache, report model, or CLI command registry.
- Changing scoring, finding generation, report prose, or host support claims.
- Adding remote Preview authentication or changing release automation in this change.
- Refactoring unrelated large modules or introducing a generic `scripts/core/` utility layer.
- Publishing an npm release.

## Plan and Tasks

1. Add RED coverage for a spaced symbolic installation path, then compare canonical real paths in the `cloc` direct-entrypoint check.
2. Add Checkup regressions for symbolic-link source parents and backup roots. Validate each backup directory component and canonical containment before writing without changing normal patch semantics.
3. Add Secret Scan CLI tests for unreadable/missing explicit paths, nested symbolic links, safety-sensitive read skips, and coverage status. Make incomplete scans fail closed with a stable distinct exit code while retaining current finding behavior.
4. Add parameterized privacy-safe text tests for GitLab and hierarchical URL userinfo credentials, then extend shared review-text sanitization to redact them.
5. Run focused tests after each RED→GREEN slice, then the complete verification gates.
6. Record the maintainer-requested change-scope rule in `AGENTS.md`, remove the proactive changelog entry, and perform traceability, security, and code-quality review before commit and merge.

Affected owners are expected to remain limited to:

- `scripts/cloc/`
- `scripts/coding-agent-practices/checkup/`
- `scripts/agent-guardrails/`
- `scripts/session-analysis/`
- their focused tests and this spec
- `AGENTS.md` for the explicit task-scope rule

## Test and Review Evidence

- AC-1: `node --test test/cloc.test.mjs test/better-harness-cli.test.mjs`, including the spaced symbolic installation path
- AC-2: focused Checkup tests in `test/harness-checkup.test.mjs` for source and backup symlink rejection
- AC-3: focused Secret Guard tests in `test/agent-guardrails-secret-scan.test.mjs`, including nested-link, safety-skip, exit-code, and JSON coverage assertions
- AC-4: focused privacy/session tests covering exact credential non-retention across hierarchical URL schemes
- AC-6: inspect the `AGENTS.md` diff and confirm `CHANGELOG.md` has no PR delta
- AC-5:
  - `npm test`
  - `npm run pack:verify`
  - `node --test test/doc-link-graph.test.mjs`
  - `npm ci && npm run build` from `docs/`
  - repository secret scan over the final diff/worktree

Risk notes:

- Path containment changes must remain cross-platform and must not reject normal Windows/macOS/Linux in-root files.
- Secret Scan exit-code changes are intentional machine-contract behavior and require explicit regression coverage.
- Redaction must favor removing credential material over preserving diagnostic fidelity.
- No destructive external action is part of implementation; PR publication occurs only after verification and a sensitive-data scan.
