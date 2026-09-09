# Compare native agent interfaces in Studio

## Traceability

- Spec ID: studio-pi-runtime-comparison
- Status: Pi UI superseded by [DSH Harness Design](2026-09-09-studio-dsh-harness-design.md); historical measurements retained
- Request: extend the DSH draft PR with a similar Pi integration and compare size.
- Decision: [Native Pi terminal](../adrs/studio-native-pi-terminal.md)

## Intent

Keep Pi's upstream interactive experience accessible from a dedicated Studio
page with one launch button, and measure pinned runtime distribution footprints.
Upstream Pi at `faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19` supplies a terminal UI,
RPC and SDK, but no official Web frontend. Its client/server packages are
transport libraries. A terminal host therefore preserves the original UI.

## Acceptance scenarios

- **AC-1:** Discover the installed Pi executable without installation. Launch
  only on explicit action, with cwd from the current trusted Project/revision.
- **AC-2:** One launch button and no title actions. Retain the upstream terminal
  across navigation; native keyboard input and resize work at three widths.
- **AC-3:** Bound terminal output and input, reject cross-origin/stale control,
  isolate process generations, and stop owned processes during shutdown.
- **AC-4:** Compare separately installed production closures for pinned DSH and
  Pi releases, reporting logical file bytes and gzip artifact bytes. Retain
  locks, platform, versions and exclusions. Shared Electron and Studio bridge
  overhead are separate from agent packages; do not infer installer size or RSS.

## Non-goals

Reimplementing Pi's composer, tools or settings; a new host adapter; model calls;
global package installation; packaged Windows/Linux acceptance; treating npm
package metadata alone as a full runtime footprint.

## Plan and tasks

1. Preserve DSH as the first commit in draft PR #158.
2. Host Pi's native terminal through a bounded PTY in the Studio Node host, with
   terminal rendering only in Studio. Bind the session to its launch Project;
   changing Projects must not route input into the previous Project's process.
3. Add portable package footprint tooling using Node APIs and npm argv arrays,
   isolated production installs, pinned packages and retained lockfiles.
4. Validate lifecycle/authority, real Pi editing without submission, responsive
   layout, focus and error channels. Record limitations before follow-up commit.

## Test and review evidence

- Studio build/typecheck passed. Full Studio suite under Node 24.20.0:
  82 files / 615 tests passed. Terminal tests cover concurrent launch reuse,
  cursor reads, native resize, stale Project/generation rejection, exit/restart,
  bounded input/output and cleanup (AC-1, AC-3).
- Playwright: 9 related DSH/Pi scenarios passed, including all three widths,
  launch focus, native input, retained draft, focus escape, overflow and guarded
  API calls (AC-2, AC-3). The first layout pass exposed an unbounded resize loop;
  bounding the terminal pane to the available height resolved it.
- Real Pi 0.85.1 in Electron: `PI_CLI_ENTRY=<installed CLI entry> node
  packages/better-harness-desktop/scripts/pi-smoke.mjs` passed. Native composer
  draft input, navigation retention, three widths, keyboard escape and sandbox
  checks passed; console/page errors were empty. No model prompt was submitted.
  Screenshots/receipt: `packages/better-harness-desktop/dist/pi-acceptance/`.
  The smoke uses an isolated Pi profile; upstream may download its `fd` helper
  there on first run. This download is outside the package footprint below.
- Desktop unit suite: 6 passed. `npm run stage -w
  @qoder-ai/better-harness-desktop` passed, including native helper preparation.
  This is staging evidence, not a packaged installer or signing receipt.
- Markdown link graph: 8 passed; generated routing graph unchanged.
  Scoped diff whitespace check passed.
- Initial DSH commit CI found the pinned Antigravity Markdown closure needed
  refreshing after the new ADR/spec links. The current verified closure has
  112 Markdown nodes, 317 edges and 116 packaged files; both frozen expectations
  are updated. Windows Desktop also failed in four untouched Rust evidence-host
  fixture tests with `InvalidFilename` (run 34244849314); this PR does not claim
  that failure fixed. That run's macOS/Linux Desktop jobs passed for the DSH
  checkpoint, not for the subsequent Pi code.
- Canvas preview was attempted again and remains blocked by missing Canvas SDK
  runtime. Its `/health` and `/canvas-module.js` endpoints were not verified.
- AI implementation: Codex. No Story id was supplied. The maintainer authorized
  scoped commits and draft PR #158. ADR-0009 remains Proposed. Changes cover the
  host, minimal UI, native dependency preparation, tests and size tooling only.
  No release/version updates or upstream source copies. Windows/Linux runtime,
  model execution and signed installers remain unverified.

## Footprint measurement

Receipt: [machine-readable measurement](2026-09-08-studio-agent-footprint.json).
Two independent installs produced the same byte counts on macOS arm64 using
Node 26.8.1 / npm 11.19.0. The measurement tool's runtime is recorded separately
from the Node 24 Studio test runtime; `npm exec` selected the machine's Node 26.

| Agent release | Production files | Gzip npm bundle |
| --- | ---: | ---: |
| Pi 0.85.1 | 396.00 MiB | 134.58 MiB |
| DSH 0.1.2-rc.1 | 210.18 MiB | 43.60 MiB |

Pi is 1.88 times larger in installed files and 3.09 times larger in this gzip
bundle comparison. These are full production dependency installations with
scripts disabled, not minimal feature-equivalent runtimes. Archives contain a
small measurement wrapper/log plus bundled dependencies. The top-level DSH CLI
package alone would exclude most of its runtime and is not the comparison.

Pi's installed `@esbuild/*` payloads account for 296,666,027 bytes (282.92 MiB),
including other operating systems/architectures; darwin-arm64 itself is only
10,574,305 bytes. Therefore these results do not establish which optimized,
single-platform Desktop would be smaller. No pruning was performed.

Shared local Electron 44.2.0 files are 306.46 MiB. The unpruned Pi terminal bridge
dependencies (`node-pty`, `node-addon-api`, xterm and fit addon) total 67.43 MiB.
These are separately reported filesystem payloads, not incremental renderer
bundle sizes. Neither is included in the agent rows. Node, package-manager
cache, user sessions, first-run downloads and runtime memory are excluded.

Reproduce the procedure from the repository root:

```sh
npm exec -- node packages/better-harness-desktop/scripts/compare-agent-footprint.mjs --out <new-directory>
```

The output retains isolated manifests, lockfiles, install logs, archives and
SHA-256 receipts. Exact dependency resolutions are frozen in those lockfiles;
a later fresh run can resolve different transitive versions and must carry its
own result. The measured locks/archives are retained locally in
`/tmp/studio-agent-footprint-final-20260908`, not vendored into this repository.

## Remaining draft boundaries

Pi's terminal transcript is limited to 4 Mi characters per process; reaching the
limit stops the process and requires a fresh explicit start. Project revision
changes invalidate input into an older process; another Project's explicit start
replaces it. There is one active Pi process in this slice. Native Windows/Linux
and long-session retention need separate validation before promotion from draft.
