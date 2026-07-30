# Changelog

This file records notable public changes to Better Harness. Entries describe
observable behavior and compatibility, not every internal refactor.

## Unreleased

### Added

- Pi (pi.dev) is now a supported analysis-capable source-local host. The
  repository installs as a pi package (`pi install <repo>`) through a `pi`
  manifest in `package.json`, registers a `/better-harness` prompt template,
  and gains a Pi configured-asset provider (settings-declared pi packages,
  skills, prompt templates, extensions, and `AGENTS.md` context) plus a Pi
  session-evidence adapter that reads workspace-matching JSONL v3 transcripts
  under `~/.pi/agent/sessions/` with `PI_CODING_AGENT_DIR` and
  `PI_CODING_AGENT_SESSION_DIR` overrides. Pi's shell is the `pi` manifest in
  the existing `package.json`, so the public npm package still ships six host
  metadata roots and the Qoder runtime bundle remains Qoder-specific.

### Changed

- Cursor installed-plugin inventory now leaves unknown numeric or opaque IDs
  unmatched instead of assigning them to cached plugins by name/order. Direct
  manifest IDs and workspace project MCP hints remain supported.
- `harness record-fix-output` now resolves Home only for Global output, so a
  verified Project-only result remains recordable when Home is unavailable.
- The `harness analyze` platform gate now names the full supported set
  (`qoder, codex, claude, cursor, qwen, copilot, pi`) when it rejects an
  unsupported `--platform`, matching the session-analysis and asset-baseline
  gates. The existing error prefix and exit behavior are unchanged.
- Core Change Watch now requires framework-specific evidence before labeling
  Rails or FastAPI, exposes bounded root Just recipes as statically discovered
  unverified argv entrypoints, and keeps historical-only files out of current
  recommended reads and action targets.
- Evidence bundles now discover and privacy-filter one frozen Session population
  before either Session facts or lead analysis hydrates it. Versioned redacted
  bindings fail closed on population, selection, or admission contradictions
  while preserving bounded lead selection and explicit zero-signal filtering.
- Self-contained HTML reports now expose every fluency-dimension score track as
  a labeled progressbar with a zero-to-100 range and the displayed rounded
  score. Report validation rejects incomplete, duplicated, invalid, or
  score-mismatched dimension progressbar contracts.
- Chinese self-contained HTML reports now use standards-based language
  segmentation to keep bounded word-like phrases together while preserving
  normal wrapping around Latin text, paths, URLs, and longer content. Runtimes
  without segmentation support fall back to readable escaped text, and English
  reports remain unchanged.
- HTML Evidence cards now display machine-owned Task Episode coverage from a
  summary-facts companion, with legacy at-a-glance coverage retained only as a
  compatibility fallback.

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
