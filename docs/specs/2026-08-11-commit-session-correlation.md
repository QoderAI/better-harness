# Commit and session correlation with Session Viewer

## Traceability

- Spec ID: commit-session-correlation
- Status: Implemented
- Source evidence: entire.io commit/session pages and the upstream
  `https://github.com/entireio/cli` domain model (`Entire-Checkpoint` commit
  trailer linking checkpoints and sessions to commits)
- Reference session:
  `https://entire.io/gh/entireio/git-sync/session/0708a5fa-06bd-4274-b1fe-513c7202217e`
  (session UUID differs from its three `Entire-Checkpoint` ULIDs)

## Intent

Let a maintainer answer "which agent sessions produced this commit" from
local evidence only. Better Harness already normalizes multi-host session
events (`scripts/session-analysis/`) but has no link between sessions and git
commits. This change adds a bounded, deterministic correlation between local
git commits and discovered sessions, plus a self-contained commit-view HTML
report in the spirit of the entire.io commit page (commit header, linked
session timeline, change breakdown, token totals) without adopting
entire-cli's shadow-branch, refs storage, or checkpoint-first product model.
The session viewer presents local session activity: a compact activity rail
and a tool-call bubble trace derived from the selected local transcript.

## Acceptance Scenarios

- AC-1: `commit-session-link correlate` emits one JSON document that, for each
  selected commit, lists candidate sessions ordered by confidence with
  explicit evidence (time overlap, overlapping repo-relative files, cwd
  match); sessions with no time overlap and no explicit trailer are excluded.
- AC-2: Confidence is deterministic and ranked: `explicit` (a
  `Harness-Session:` trailer names a discovered session id, or an
  `Entire-Checkpoint:` trailer resolves through read-only checkpoint metadata
  to that session id) > `high` (time overlap plus at least one overlapping file) >
  `medium` (time overlap plus session cwd inside the repository) > `low` (time
  overlap only).
- AC-3: `commit-session-link render --commit <ref>` writes a single
  self-contained HTML file (inline CSS/SVG, no remote assets, no runtime
  reads) showing the commit header, linked sessions with confidence badges and
  privacy-safe prompt summaries, a code/tests/docs change breakdown, and
  observed token totals when present.
- AC-4: Correlation JSON and the commit-view HTML are privacy-safe: file
  paths are repo-relative, prompt text passes `sanitizePrivateReviewText`, and
  no absolute home paths appear. The Session Viewer HTML is a local
  full-transcript reader: it keeps transcript structure and paths but redacts
  credential-shaped content (tokens, keys, embedded URL credentials) and
  bounds every text block.
- AC-5: `--help`/`-h` on every registered `commit-session-link` path prints
  canonical help on stdout with empty stderr and exit 0 before reading the
  workspace, spawning git, or writing files.
- AC-6: Focused tests cover git fact parsing, correlation scoring (including
  trailer, grace-window, and no-overlap boundaries), HTML rendering, and the
  CLI help contract; `node --test` on the new test file plus
  `better-harness-cli` and `doc-link-graph` tests pass.
- AC-7: `commit-session-link render-session --session-id <id>` writes a
  self-contained Session Viewer HTML file, named `session-viewer-<id>.html` by
  default, with a visible `Session Viewer` product label and a browser title
  prefixed by `Session Viewer`. It presents a header meta row (platform,
  models, duration, commit and
  file-change counts, token total), then one turn block per user prompt with
  the prompt card, a collapsed "N messages, N tool calls" expander holding
  tool chips and intermediate assistant notes, and the final assistant
  response rendered from a bounded inline Markdown subset (headings, lists,
  code fences, inline code, bold).
- AC-8: Commits whose committer time falls inside the session window (plus
  grace) and that correlate with the session appear as inline commit chips
  after the turn that produced them, expandable to the full commit subject and
  trailers; turn anchors allow deep links within the file.
- AC-9: `Entire-Checkpoint` facts remain distinct from session facts. The
  reader accepts both upstream stores without modifying Git: sharded content
  on `entire/checkpoints/v1` and per-checkpoint
  `refs/entire/checkpoints/<shard>/<checkpoint-id>` refs. Missing or malformed
  checkpoint metadata degrades to heuristic evidence and is reported, never
  promoted to `explicit`.
- AC-10: Git commit facts use committer time for heuristic production-time
  correlation while retaining author time for display. Numstat paths are read
  with NUL delimiters, including rename and paths containing tabs or newlines.
- AC-11: Every transcript-derived HTML field is bounded and credential-redacted,
  including tool commands, commit messages, and trailers. A synthetic token in
  any rendered lane does not appear in the generated HTML.
- AC-12: The session view exposes a compact right-side activity rail with
  prompt, response, tool-call, touched-file, linked-commit, aggregate `+/-`,
  and top-tool facts. Commit chips expose explicit versus heuristic evidence.
  Checkpoint identifiers stay transport evidence and do not become viewer
  navigation or a Better Harness product concept. The page remains
  self-contained and usable without a network.
- AC-13: A reference-shape end-to-end fixture keeps the session UUID distinct
  from three checkpoint ULIDs and proves all three commits link explicitly to
  the session through checkpoint metadata. Browser layout evidence uses a real
  local host transcript; synthetic reference-shape data remains test-only.
- AC-14: When a selected session is absent from the native host history but a
  resolved Entire checkpoint contains its self-contained `full.jsonl`,
  `render-session` reads and normalizes that transcript directly from Git
  without checking out or copying checkpoint content into the workspace. Native
  session evidence remains the first choice when both sources exist.
- AC-15: Native host events and Entire checkpoint content normalize into one
  versioned, read-only `SessionViewerReportV1` projection before rendering.
  Entire root `sessions[]` file paths are authoritative (with a bounded legacy
  fallback), and the page timeline, header, and right-side activity rail consume
  the same derived counts. This projection remains distinct from
  `HarnessCheckpointV1`, whose checkpoint is an artifact-run continuity index.
- AC-16: Detailed native and Entire-backed sessions reuse the public
  `ToolCallTraceV2` projection from session analysis. The session viewer renders
  its bounded calls as an inline, horizontally scrollable SVG: x is call
  sequence, y is a privacy-safe tool lane, orange is failure, and bubble area
  scales only observed latency. Codex orchestration-layer `exec` calls are
  attributed to the nested local capability named in the real invocation
  source (for example `exec_command`, `apply_patch`, `browser`, or `web`), with
  unclassifiable calls left as `exec`. Summary-only correlation does not build
  the trace.

## Non-goals

- Writing commit trailers or installing git hooks (deterministic linking at
  commit time. This reader consumes pre-existing trailers but never creates or
  rewrites them).
- Adopting entire-cli's shadow branch, `entire/checkpoints/v1` refs backend,
  or any checkpoint write path.
- Agent-vs-human line attribution, multi-platform aggregation in one run,
  multi-session comparison, or remote/hosted viewing.
- Changing existing session-analysis facts, reports, or selection behavior.
- Reusing `HarnessCheckpointV1` as an agent transcript or Git checkpoint
  contract; the two formats share summary/content separation, not domain
  semantics or identifiers.
- Introducing a Better Harness checkpoint list, checkpoint navigation, or
  checkpoint filters in the session viewer.

## Normalized Read Model

`SessionViewerReportV1` is the renderer-facing contract. It contains one
session projection, derived activity counts, a bounded tool breakdown and
trace, turns, and unresolved-link diagnostics. Native host history and Entire
`full.jsonl` are source adapters; neither source gets a separate renderer or
count algorithm. Entire checkpoint facts remain below this projection as a
read-only way to resolve explicit commit-to-session evidence.

The Entire adapter follows the local reference checkout at
`/Users/phodal/test/entire-cli`, commit
`caa0c9be90261fb2b64bf6cfc7147ee3981494db`:

- `api/checkpoint/metadata.go` separates root `CheckpointSummary`, per-session
  `Metadata`, `SessionFilePaths`, and `SessionContent`;
- `api/checkpoint/interfaces.go` separates checkpoint-level reads from
  session-content reads; and
- root `sessions[]` paths select metadata/transcript objects rather than an
  assumed directory index.

The existing [Harness Run Checkpoints](2026-08-10-harness-run-checkpoints.md)
remains the authority for Git-neutral Harness artifact continuity. Its
`HarnessCheckpointV1` envelope is not widened by this feature.

## Plan and Tasks

New capability directory `scripts/commit-session-link/` consuming only the
public `scripts/session-analysis/index.mjs` surface:

1. `git-facts.mjs` — bounded commit metadata collection plus per-commit
   `git diff-tree --numstat -z` facts (default 20
   commits, or one `--commit <ref>`): hash, subject, author name, authored
   and committed time, per-file added/removed, and typed session/checkpoint
   trailers parsed from the body.
2. `entire-checkpoints.mjs` — bounded, read-only resolution of allowlisted
   checkpoint ids from upstream git-branch and git-refs stores into explicit
   checkpoint-to-session facts, plus bounded reads of a resolved session's
   self-contained transcript. No fetch, checkout, ref update, or hook write.
3. `correlate.mjs` — pure scoring: session summaries (id, platform, time
   range, repo-relative touched files, cwds, prompt/tool counts, token
   totals, checkpoint ids) × commit facts → ranked matches with evidence;
   grace window
   defaults to 45 minutes after `lastSeen`.
4. `session-source.mjs` — hydrate bounded sessions via
   `createAnalyzer(platform)` (`resolveScope` → `analyze` → `readSession`),
   bounded by the commit time range and `--max-sessions` (default 20); when
   native discovery cannot find an explicitly selected session, normalize a
   resolved Entire transcript through the matching public platform analyzer.
5. `render-html.mjs` — pure HTML string builder for the commit view.
6. `session-view.mjs` + `render-session-html.mjs` — pure turn-timeline
   builder over hydrated events (user prompt, intermediate steps, final
   response, inline commit markers) and the Session Viewer HTML renderer with
   an inline Markdown subset; hydrated via a
   `collectSessionDetail` addition to `session-source.mjs` that returns raw
   events for one session.
7. `session-report-model.mjs` — one versioned, renderer-facing read model for
   the main timeline, header metrics, right-side activity rail, and the public
   `ToolCallTraceV2` projection, independent of whether events came from a
   native host or Entire.
8. `cli.mjs` + `index.mjs` — `correlate`, `render`, and `render-session`
   subcommands; help-first argument handling; default HTML output under
   `<workspace>/.qoder/better-harness-runs/commit-session-link/`.
9. Register `commit-session-link` (audience `advanced`) with the subcommands
   in `scripts/better-harness-cli/registry.mjs`.
10. Tests in `test/commit-session-link.test.mjs` with a temp git repo fixture,
  a three-checkpoint reference-shape fixture, adversarial Git paths, synthetic
  model fixtures, and renderer assertions for the bounded bubble trace.

## Test and Review Evidence

- `node --test test/commit-session-link.test.mjs` — 30/30 passing; correlation,
  source adapters, privacy, renderer, nested `exec` attribution, and CLI
  coverage.
- `npm test` — 1330/1330 passing after the final tool-attribution change.
- `npm run pack:verify` — passed with 478 npm entries and 500 runtime-zip
  entries.
- `npm run preview`; `GET /health` returned `ok` and
  `GET /canvas-module.js` returned HTTP 200 with 100449 bytes.
- Manual: run `render` against this repository and open the HTML from disk;
  verify no network requests and no absolute home paths (AC-3, AC-4).
- Manual: render the current repository's real local Codex session, inspect it
  in a browser, expand the tool-call trace, check console/page errors and
  horizontal overflow, and save a screenshot (AC-12, AC-13, AC-16). Observed
  evidence: 6 prompts, 51 responses, 280 tool calls, 279 timed calls, 4 failed
  calls, 8 bounded lanes; no console errors, checkpoint navigation, or document
  overflow. The scroll container intentionally owns chart overflow.
- Risk: correlation is heuristic; mitigated by explicit per-match evidence and
  the typed `Harness-Session` and resolved `Entire-Checkpoint` channels. A
  checkpoint trailer alone is never proof of a session link. Git output parsing
  is locale-safe via `-z`/format strings rather than porcelain text.
- Risk: upstream checkpoint stores are Git internals. Reads are bounded to
  validated 12-hex or 26-character ULID ids and known ref/path layouts; any
  unsupported layout remains visible as unresolved evidence.
- Risk: a local transcript can contain credentials. All rendered text lanes
  share one redaction boundary and adversarial tests assert absence in the
  final HTML, not only in helper return values.
