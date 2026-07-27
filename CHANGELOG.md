# Changelog

This file records notable public changes to Better Harness. Entries describe
observable behavior and compatibility, not every internal refactor.

## Unreleased

### Changed

- Claude Code now defaults `/better-harness` to a validated, self-contained
  HTML report with paired Markdown and findings artifacts. Explicit inline or
  no-files requests remain write-free.

### Removed

- Removed pre-public identity aliases, migration-only specifications, and local
  compatibility readers. Better Harness is now the only product, CLI, plugin,
  callback, report-root, and session-reference identity.
- Removed developer-specific paths and obsolete compatibility commands from the
  public terminal-demo documentation.
