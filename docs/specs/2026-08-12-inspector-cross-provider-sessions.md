# Inspector cross-provider session discovery

## Traceability

- Spec ID: inspector-cross-provider-sessions
- Status: Implemented

## Intent

`better-harness harness-inspector render` currently reads sessions from exactly
one `--platform` (default `qoder`). Developers who alternate between hosts such
as Qoder, Claude Code, and Codex on the same repository must run the inspector
once per host and never see one merged delivery picture. The intended workflow
is `npx @qoder-ai/better-harness inspector`: discover the current project's
sessions across every supported session-analysis provider automatically, merge
them by recency, and render one self-contained HTML report.

## Acceptance Scenarios

- AC-1: With `--platform all` (the new default), the inspector enumerates every
  platform in `SUPPORTED_SESSION_PLATFORMS`, skips providers whose evidence
  roots do not exist locally without failing, and merges discovered sessions
  from the remaining providers into one report.
- AC-2: A provider that throws during scope resolution, discovery, or session
  hydration does not fail the render; the failure surfaces as a privacy-safe
  report diagnostic naming the platform.
- AC-3: Merged sessions are ranked by `lastSeen` descending and bounded by the
  existing global `--max-sessions` limit; every rendered session keeps its
  platform identity through the existing `platform` field and
  `<platform>/<sessionId>` locator.
- AC-4: `--platform <host>` and `--platform <a>,<b>` still scope the render to
  the named providers; an unsupported platform name fails fast with a usage
  error (exit 64) that lists the supported platforms and leaks no option value.
- AC-5: `better-harness inspector` resolves to `harness-inspector` as a hidden
  alias, and an argv that starts with an option flag (for example
  `inspector --out report.html`) implies the `render` command. Empty argv and
  `--help` keep printing help without reading workspace or provider state.
- AC-6: The report model gains a `providers` array (platform, status,
  discovered and included counts) and the HTML header badge reflects the
  providers that contributed sessions; the report stays privacy-safe (no home
  paths, no raw error payloads).

## Non-goals

- No cross-provider session dedupe beyond the existing per-platform identity;
  session ids are already namespaced by platform in locators.
- No new `session-analysis` subcommand and no change to its single-platform
  contract; aggregation lives in the collector used by the inspector.
- No provider filter panel or per-provider lanes in the workbench UI; the UI
  change is limited to the header badge plus the existing per-session locator.
- No package rename; the published bin stays `better-harness` under
  `@qoder-ai/better-harness`.
- No per-provider session quota; the global recency-ranked `--max-sessions`
  bound is the declared semantic.

## Plan and Tasks

1. `scripts/commit-session-link/session-source.mjs`: add
   `collectMultiPlatformSessionSummaries({ workspace, repoRoot, platforms,
   since, until, maxSessions, includeToolTrace, includeDialogue,
   createAnalyzer })` returning `{ sessions, providers }`. Discovery phase per
   platform (resolveScope → discoverSourceRoots → short-circuit when no root
   exists → discoverSessions) with per-provider try/catch; hydration phase only
   for the global top-N candidates. `createAnalyzer` is injectable for tests.
   Export through `scripts/commit-session-link/index.mjs`.
2. `scripts/harness-inspector/cli.mjs`: parse `--platform` as `all`, a single
   host, or a comma list validated against `SUPPORTED_SESSION_PLATFORMS`
   (default `all`); route through the multi-platform collector; map provider
   errors and no-evidence providers to report diagnostics; treat a leading
   option flag as an implicit `render`; extend help text and stdout JSON with
   provider counts.
3. `scripts/harness-inspector/report-model.mjs`: project a `providers` array
   (safe platform text, bounded counts, status whitelist) and widen the
   `filters.platform` text bound to hold a comma list.
4. `scripts/harness-inspector/render-html.mjs`: derive the header badge from
   providers that contributed sessions, falling back to the requested filter.
5. `scripts/better-harness-cli/registry.mjs`: add hidden alias `inspector` to
   the `harness-inspector` command.
6. Tests in `test/inspector-cross-provider.test.mjs` plus targeted additions to
   existing suites (alias inventory already generically covered).

Decision rationale: aggregation belongs next to `collectSessionSummaries`
because workspace binding is already implemented inside every platform
analyzer's `discoverSessions`; a global recency bound (not per-provider quotas)
matches the single-platform semantic and the "what happened recently in this
project" reading of the report.

## Test and Review Evidence

- `node --test test/inspector-cross-provider.test.mjs` — AC-1, AC-2, AC-3,
  AC-4, AC-6 via injected fake analyzers and spawned CLI usage-error checks.
- `node --test test/harness-inspector.test.mjs` — existing AC regression plus
  AC-5 help zero-side-effect guard.
- `node --test test/better-harness-cli.test.mjs` — AC-5 alias dispatch through
  the generic alias inventory paths.
- `npm test` — full suite before commit (1362 pass). The frozen
  `commands --json` and `schema` baselines in
  `test/scripts-refactor-contract.test.mjs` were revised after diffing the
  inventories; the only change is the declared hidden `inspector` alias.
- Manual smoke: `node scripts/harness-inspector/cli.mjs --max-sessions 8
  --commits 20 --out <tmp>` on this repository enumerated all 10 providers
  (4 with evidence), merged the top 8 sessions from qoder and codex, and the
  header badge rendered `qoder · codex · 8 sessions`;
  `better-harness inspector --help` dispatches through the alias.
- Risk: default `--platform` changes from `qoder` to `all`; render output for
  existing users may now include other hosts' sessions for the same workspace.
  Mitigation: sessions remain workspace-bound by each provider adapter and the
  report remains local-only and privacy-projected.
