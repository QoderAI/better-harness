# Changelog

This file records notable public changes to Better Harness. Entries describe
observable behavior and compatibility, not every internal refactor.

## 0.6.4 - 2026-08-19

### Added

- Session analysis now supports DeepSeek Harness evidence, including bounded
  project discovery, normalized messages and tool lifecycles, workspace
  matching, and Inspector/commit-session integration.

- Harness Inspector can list sessions for the selected UTC day and present
  session and experiment evidence in denser notebook-oriented views.

### Changed

- Inspector's Capability, Date, Trace, and Replay surfaces now share the
  repository design contract for readable typography, semantic state and
  categorical colours, keyboard navigation, responsive density, and bounded
  overflow.

- The public homepage and README make Harness Inspector easier to discover,
  while the self-contained report uses a flatter workbench hierarchy and a
  clearer date calendar and session detail flow.

### Fixed

- Tool-call details keep redaction visible in the Inspector instead of making
  protected content look accidentally empty.

- Cross-platform source and test paths are canonicalized so Windows short-path
  aliases and line endings do not create false failures.

## 0.6.3 - 2026-08-14

### Added

- `npx @qoder-ai/better-harness inspector` now renders the current workspace,
  opens the generated report, and uses a bounded 30-day UTC evidence window by
  default. The public Inspector page and bilingual guide lead with the same
  short command.

### Changed

- The zero-argument Inspector quickstart scans up to 200 commits and hydrates
  up to 100 sessions, while explicit `render` invocations preserve their
  existing bounds and open only when `--open` is provided.

### Fixed

- Qoder assistant messages with structured `thinking`, `text`, and `tool_use`
  content are normalized before Session Detail renders them, preventing raw
  transport JSON from appearing as intermediate responses while preserving
  tool calls in the structured activity trace.

## 0.6.2 - 2026-08-14

### Added

- Harness Inspector now documents its local evidence pipeline, relationship
  strengths, privacy boundaries, and CLI workflow in a bilingual concept guide
  with a source-backed architecture diagram.

- The Inspector renderer accepts `--open` so a generated self-contained report
  can be opened in the default browser after it is written.

### Changed

- Session View uses denser activity and commit presentation, compresses long
  idle windows, and keeps expanded activity focused while preserving access to
  the full retained trace.

- Inspector chrome now uses one workspace identity, clearer breadcrumbs, and
  the visible `Capability` label consistently across navigation and docs.

- Qoder CLI installation guidance now distinguishes the Desktop-bundled path
  from standalone marketplace and Git installation.

### Fixed

- The Inspector sticky header is isolated from trace content so scrolling and
  focused expansion do not create overlap.

## 0.6.1 - 2026-08-13

### Added

- Harness Inspector now includes a read-only Session Replay that advances
  through retained prompts, intermediate responses, normalized tool calls,
  assistant responses, and observed commit events without rerunning tools or
  resuming the coding-agent session.

- The GitHub Pages site has a first-class Inspector tab with an interactive,
  deterministic English sample. The bilingual wrapper explains the Workbench,
  its three evidence lanes, usage flow, evidence labels, and the command for
  generating a private self-contained report from a local repository.

### Changed

- Session View places the elapsed-time activity chart beside the retained Turn
  trace, links chart selections into the corresponding calls, and shows a
  continuous ribbon that distinguishes observed tool execution from
  unattributed time.

- Capability navigation opens the declared Delivery Tree by default and keeps
  scope navigation separate from evidence selection. Short sessions expose
  their tool calls by default while repeated call runs remain compact.

### Fixed

- Story-to-session candidate matching filters generic stop words before scoring
  overlap, reducing incorrect associations caused by broad terms such as
  `project`, `session`, or `harness`.

- Session View filters now keep visible tool-call totals and collapsed run
  groups aligned with the current selection.

## 0.6.0 - 2026-08-13

### Added

- Harness Inspector is now available from the published CLI through
  `better-harness harness-inspector` and the `better-harness inspector`
  shortcut. `inspector render` creates a self-contained, read-only HTML
  workbench that relates Feature Tree stages, Stories, prompts, sessions,
  tool calls, files, and commits across the supported session providers. Its
  synchronized Evidence Drawer explains why evidence is linked, states known
  limitations, and distinguishes commits created during a session from files
  merely present in those commits.

- `better-harness commit-session-link` correlates bounded Git history with
  coding-agent sessions and renders commit-oriented provenance evidence.
  Long-session reports can now retain privacy-safe tool activity and file
  evidence for trace inspection instead of reducing execution to aggregate
  counts.

- A new Harness Component Snapshot contract and direct CLI captures, compares,
  and resolves non-authorizing rollback references for bounded project-owned
  Harness component state. Standard report analysis can also surface
  evidence-bound native Learning Capture candidates without requiring adapters
  to assign pattern labels.

### Changed

- The repository test suite now runs on Vitest with human-readable failures in
  the main GitHub Actions log, source annotations, a Job Summary, and JUnit
  output. Existing Node assertions remain intact, while Windows, macOS, Linux,
  Node 22.20.0, and Node 24.x remain release gates.

- Test ownership is organized by capability, and contributor commands now use
  the same Vitest discovery contract locally and in CI.

### Fixed

- Claude session discovery resolves underscore-based transcript directories,
  component snapshot failures retain bounded diagnostics, and review-trigger
  stop-hook results use a structured cross-platform output contract.

- CI test module paths remain valid on Windows drive-letter workspaces, and
  failure output identifies the owning test instead of reporting only a failed
  capability group.

## 0.5.0 - 2026-08-04

### Added

- `better-harness plugin status`, `plugin plan`, `plugin verify`, and
  `better-harness doctor` expose a read-only lifecycle control plane over eight
  host profiles and eleven host surfaces. Status reports installation,
  enablement, observed-version relation, and verification per surface from the
  public configured-asset inventory; `plugin plan` emits typed native argv or
  manual steps for install, update, and remove without executing them; `doctor`
  reports bounded runtime and host diagnostics with redacted authorized roots.
  Unknown, mixed, foreign, or unbound host state fails closed, `plugin apply`
  stays unregistered, and Kimi Code and Grok are rejected with `UNKNOWN_HOST`
  until their native lifecycle contracts are validated.

- Kimi Code is now a supported analysis-capable source-local host. The
  repository installs as a Kimi Code plugin (`/plugins install <repo>`)
  through a `.kimi-plugin/plugin.json` manifest, gains a Kimi configured-asset
  provider (user `~/.kimi-code/skills` and `mcp.json`, project
  `.kimi-code/skills` and `.kimi/skills`, and managed plugins from
  `plugins/installed.json` with `enabled` filtering and plugin-root path
  confinement) plus a Kimi session-evidence adapter that reads
  workspace-matching wire transcripts under
  `~/.kimi-code/sessions/<wd_*>/ses{sion}_*/agents/*/wire.jsonl`, resolving
  the workspace mapping through `workspaces.json` and `session_index.jsonl`
  with a `wd_<name>_*` prefix fallback that records a
  `kimi-workspace-index-absent` warning. The public npm package now ships
  seven host metadata roots; the Qoder runtime bundle remains Qoder-specific.

- A read-only native Learning Capture review contract can now screen ordinary
  Task Episodes for repeated exact repair routes, emit a bounded privacy-safe
  packet, validate evidence-bound `match` or `abstain` decisions, and project
  accepted `recurring-correction` opportunities through the existing Learning
  Loop candidate model without requiring adapter-supplied pattern labels.

### Fixed

- Portable HTML finding-bound fixes now record against the HTML report contract
  without requiring Qoder's `canvas.json`, and refresh `findings.json`,
  `report.md`, and `report.html` to the same repair revision. Qoder split reports
  retain their Canvas-sidecar validation boundary.

- Root CLI delegation failures now keep machine mode parseable: spawn errors,
  signal termination, and output-buffer exhaustion each emit one stable JSON
  error document, while normal child stdout, stderr, and numeric exit status
  remain capability-owned.

- Checkup plan/apply is provider-aware: only `provider=qoder` can emit or execute
  `qodercli` disable mutations. Other hosts keep candidates as `manual-review`
  until a provider-native apply contract exists. `provider-home` source
  resolution and fingerprints bind to the explicit host home (for example
  Codex uses `codexHome`, never Qoder home).

- Make `command describe` resolve exact registered leaf paths instead of
  returning the parent command metadata.

- The Portable HTML report route in `templates/reporting/routing.md` now
  lists WorkBuddy, so agents on WorkBuddy are routed to the self-contained
  HTML + Markdown output the 0.4.0 host adapter already ships. A derived
  support-declaration check now requires every adapter-matrix host claiming
  portable HTML output to appear in that routing row.

## 0.4.1 - 2026-08-04

### Fixed

- The published npm package identity is `@qoder-ai/better-harness`. The
  previously documented `@qoderai/better-harness` scope was never a valid
  registry name, so package metadata, the lockfile, the adapter matrices, and
  the documentation site now all reference the hyphenated scope.

- The repository `test` script runs the automated suite again, so the release
  workflow verifies tests before publishing instead of reporting success
  without running them.

## 0.4.0 - 2026-07-30

### Added

- WorkBuddy is now a supported analysis-capable source-local host. It gains a
  WorkBuddy configured-asset provider (user skills, marketplace plugins with
  `settings.json` enabled state, `mcp.json`/`.mcp.json` user and plugin MCP
  servers, the global
  `AGENTS.md` and identity context files) plus a WorkBuddy session-evidence
  adapter that reads workspace-matching JSONL transcripts under
  `~/.workbuddy/projects/`, including cwd-less 5.x transcripts from exact
  workspace-slug directories and sparse camelCase/snake_case usage, with a
  `WORKBUDDY_DIR` override. WorkBuddy has no
  install shell in this repository; the skill installs by copying it into
  `~/.workbuddy/skills`.
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
