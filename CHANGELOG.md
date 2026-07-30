# Changelog

This file records notable public changes to Better Harness. Entries describe
observable behavior and compatibility, not every internal refactor.

## Unreleased

### Changed

- The `harness analyze` platform gate now names the full supported set
  (`qoder, codex, claude, cursor, qwen, copilot`) when it rejects an unsupported
  `--platform`, matching the session-analysis and asset-baseline gates. The
  existing error prefix and exit behavior are unchanged.
- Core Change Watch now requires framework-specific evidence before labeling
  Rails or FastAPI, exposes bounded root Just recipes as statically discovered
  unverified argv entrypoints, and keeps historical-only files out of current
  recommended reads and action targets.

## 0.3.0 - 2026-07-27

### Changed

- The public npm package now includes the Qoder, Claude Code, Codex, and Cursor
  plugin metadata roots with aligned public descriptions. The generated Qoder
  runtime bundle remains Qoder-specific.
- CI now follows the `main` branch, and repo-local Agent Skills use `SKILL.md`
  directly without a mirror sidecar contract.
- Claude Code now defaults `/better-harness` to a validated, self-contained
  HTML report with paired Markdown and findings artifacts. Explicit inline or
  no-files requests remain write-free.

### Removed

- Removed pre-public identity aliases, migration-only specifications, and local
  compatibility readers. Better Harness is now the only product, CLI, plugin,
  callback, report-root, and session-reference identity.
- Removed developer-specific paths and obsolete compatibility commands from the
  public terminal-demo documentation.
