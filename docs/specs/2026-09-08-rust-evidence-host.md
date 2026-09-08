# Rust evidence host for Sessions and Artifact observations

## Traceability

- Spec ID: rust-evidence-host
- Status: Implemented
- Request: write this spec and implement a new desktop XPC capability for Sessions and Artifacts

## Intent

Desktop Session discovery currently runs inside the Studio Node worker through a
bundled copy of `scripts/session-analysis`. That bundle is a packaging hazard
(computed `import()` cannot see host adapters), and it keeps filesystem-heavy
evidence scanning in the same process as HTTP, ACP, and the semantic kernel.

Extract a third desktop capability service, next to OXC and ACP:

- a Rust driver owns host-adapter Session discovery and Artifact observations;
- Node remains the Studio host and still builds the Inspector report, git
  correlation, and Feature Tree;
- macOS reaches the driver through a private Foundation NSXPC service;
- Windows/Linux spawn the same driver over stdio.

The reader-facing outcome is that opening a Project in Harness Studio Desktop
returns retained Sessions (and the Artifact files those Sessions changed)
without going through the JS adapter bundle.

## Acceptance Scenarios

- **AC-1** Given the Rust evidence driver and a Project directory that has
  retained Grok, Qoder, Codex, Claude, Cursor, and Copilot Sessions, when
  `sessions.discover` runs over stdio, then those hosts report `ok` when
  evidence exists (or `no-evidence` when the home is empty), each Session has
  `sessionId`, `platform`, and a usable `firstSeen` or `lastSeen`, and the count
  is greater than zero when any host matched. Remaining hosts report
  `no-evidence` rather than failing the whole discovery.
- **AC-2** Given a discovered Session whose tool calls name workspace files that
  still exist, when `artifacts.observe` (or the equivalent observation list on
  `sessions.discover`) runs, then it returns only regular files confined to the
  Project directory, as POSIX-relative paths, never a path outside the root and
  never a symlink escape.
- **AC-3** Given macOS, when Studio starts the evidence host with
  `transport: "nsxpc"`, then Node talks to `harness-evidence-client`, the client
  reaches `com.qoder.harness-studio.evidence` over NSXPC, the service spawns one
  unmodified `harness-evidence-host` driver per connection, and a leading
  `transport` frame proves `servicePid !== bridgePid`. The Node client refuses
  to continue if that proof is missing. There is no silent stdio fallback.
- **AC-4** Given Windows or Linux, when Studio starts the evidence host, then it
  spawns `harness-evidence-host` over stdio. The NSXPC client and service
  binaries exist in the crate but exit non-zero off macOS.
- **AC-5** Given the desktop shell, when a remembered or newly opened Project
  is activated, then `workspaceSessionProvider.discover` is served by the Rust
  host (not `inspector-workspace-runtime.mjs` adapter loading). The JS Inspector
  workspace provider may still project git history and the Inspector report from
  the Rust summaries. `api/config.sessionCount` is the Rust-discovered count.
- **AC-6** The JSONL envelope is versioned (`version: 1`), bounded (4 MiB
  request, 16 MiB response), fail-closed on malformed frames, unknown methods,
  and unknown fields, and identifies the host as
  `evidence-rust-1.0.0+jsonl-v1`. Deadline, crash, and close fail pending calls
  without replaying them.
- **AC-7** Native tests cover stdio discover against fixtures, observation
  confinement, envelope faults, and on macOS the NSXPC transport proof. Desktop
  packaging stages `harness-evidence-host` (all platforms) plus
  `harness-evidence-client` / `harness-evidence-xpc` and a development
  `Harness Evidence.app` on macOS.

## Non-goals

- Porting all thirteen `scripts/session-analysis` adapters in this slice.
  The first six hosts landed here; the remaining seven are
  `docs/specs/2026-09-08-rust-evidence-host-remaining-adapters.md`.
- Replacing `scripts/session-analysis` as the CLI owner. The JS analyzers remain
  canonical for `better-harness session-analysis` until a tested parity migration.
- Moving Inspector report construction, Feature Tree parsing, git correlation,
  Customization collection, or Artifact viewers (PDF, PPTX, Markdown React,
  OXC compile) into this service. OXC stays its own crate.
- A public Mach service, TCP listener, generic RPC registry, or silent
  NSXPC-to-stdio fallback.
- App Sandbox entitlements, notarization, or auto-update.
- Changing the Sessions or Artifacts UI chrome.

## Plan and Tasks

### Capability split

```
Studio Node
  createRustEvidenceHost({ executable, transport })
    -- JSONL stdio --
  harness-evidence-client          (macOS)
    -- NSXPC sendFrame:/deliverFrame: --
  harness-evidence-xpc             (launchd)
    -- stdio --
  harness-evidence-host            (driver; Windows/Linux spawn this directly)
```

The XPC layer is a byte-for-byte JSONL forwarder, copied from ACP: no discovery
logic in the bridge or the `.xpc` binary. One driver child per accepted
connection, so a hung adapter fails one discover, not Studio.

### Wire

Newline-delimited JSON. Node sends `{ version, id, method, params }`. The driver
replies `{ version, id, result | error }` or, on NSXPC, a leading unsolicited
`{ version, event: { type: "transport", transport: "nsxpc", servicePid, bridgePid } }`.

Methods:

| method | params | result |
| --- | --- | --- |
| `host.describe` | `{}` | `{ protocol, pid, platforms }` |
| `sessions.discover` | `{ workspace, maxSessions?, includeToolTrace?, includeDialogue? }` | `{ sessions, providers, observations }` |
| `artifacts.observe` | `{ workspace, sessions }` | `{ observations }` |

`sessions[]` match the Inspector summary consumed by
`createInspectorWorkspaceSessionProvider`: `sessionId`, `platform`, `firstSeen`,
`lastSeen`, `prompts`, `promptCount`, `assistantMessageCount`, `toolCallCount`,
`toolActivity.calls`, `dialogue.turns`. Node projects that into Studio Session
and Debugger events; `collectWorkspaceArtifactObservations` keeps working from
`change` resources.

### First-slice adapters

- **Grok**: `$GROK_HOME/sessions/<encodeURIComponent(cwd)>/<id>/` with
  `summary.json` + `updates.jsonl`. Workspace match is the encoded group name
  and `summary.info.cwd`.
- **Qoder**: `~/.qoder/logs/sessions/<slug>/<id>/segments/*.jsonl` where `slug`
  is `workspaceToQoderSlugVariants`. Prompts come from `input.prompt.received`
  / `submitted`; timestamps from `ts` and segment names.
- **Codex**: `~/.codex/sessions/**/rollout-*.jsonl`. First-line `session_meta`
  cwd match; only the newest `maxSessions` matching files are fully parsed.
- **Claude**: `~/.claude/projects/<slug>/*.jsonl` using Claude's `/._` slug fold.
  Prompts from `type: user`; tools from `tool_use` in assistant content.
- **Cursor**: `~/.cursor/projects/<slug>/agent-transcripts/**/*.jsonl`. Slug
  variants drop a leading `-`. Prompts from `<user_query>`; tools from
  `tool_use`.
- **Copilot**: `~/.copilot/session-state/<id>/workspace.yaml` + `events.jsonl`.
  Workspace match is `cwd` on the yaml or `session.start`.

Prompt text is truncated to 200 characters. Absolute paths in tool resources
are rebased to the Project root or dropped.

### Desktop injection

`studio-runtime.mjs` receives `evidenceHostExecutable` and
`evidenceHostTransport` (`stdio` | `nsxpc`) on the existing start contract.
It probes `host.describe`, then supplies
`createRustEvidenceWorkspaceSessionProvider()` as `workspaceSessionProvider`.
That provider calls Rust `sessions.discover` and reuses the bundled Inspector
runtime only for git / Inspector report construction (`collect` is injected).

### Packaging

Same layout as ACP:

- driver `harness-evidence-host` in `Resources/native` (and inside the `.xpc` on
  macOS);
- `harness-evidence-client` in `Contents/MacOS`;
- `com.qoder.harness-studio.evidence.xpc` holding `harness-evidence-xpc` plus
  the nested driver.

Development uses `dist/native/Harness Evidence.app` so launchd can find the
service without modifying Electron.app.

## Test and Review Evidence

Local macOS arm64, Rust 1.96.0, 2026-09-08:

| AC | Evidence |
| --- | --- |
| AC-1 | `cargo +1.96.0 test` in `rust/evidence-host`: fixtures for Grok, Qoder, Codex, Claude, Cursor, and Copilot. Release stdio discover of this repository in 3.6s: 100 sessions (qoder 68, codex 26, grok 3, claude 3); Cursor discovered 8 (older than the recency cap); Copilot none for this exact cwd. |
| AC-2 | `artifacts::tests::drops_missing_and_keeps_real_files` keeps `docs/kept.md` and drops `../escape`. |
| AC-3 | Node client test refuses a stdio describe when `transport: "nsxpc"`. `transport_proof` JSON names distinct pids. Live launchd hop uses the ACP-identical client/xpc/driver split; `Harness Evidence.app` is staged by `scripts/rust.mjs`. |
| AC-4 | `harness-evidence-client` / `harness-evidence-xpc` are `cfg(target_os = "macos")` and exit 2 otherwise. `rust.mjs` stages `harness-evidence-host` on every platform. |
| AC-5 | Desktop start contract requires `evidenceHostExecutable` + `evidenceHostTransport`. `studio-runtime.mjs` probes `host.describe` and injects `createRustEvidenceWorkspaceSessionProvider`. |
| AC-6 | Envelope tests: unknown method is a call error; unknown fields fail the frame; oversized stdin is a process fault. |
| AC-7 | `nsxpc-bundle.mjs` `installEvidenceXpc`, `after-pack.mjs` signs the evidence `.xpc`, Windows/Linux `extraResources` include `harness-evidence-host*`. |

`npx vitest run test/rust-evidence-provider.test.ts` (harness-studio): 2 passed.
`node --test test/service-host.test.mjs` (desktop): 6 passed.

Risk: Grok/Qoder summaries are a subset of the JS analyzer (no usage report,
no full privacy pipeline). Inspector cards stay populated; usage charts may be
thinner until later adapters land. Unported hosts (Codex, Claude, …) disappear
from Desktop until ported — that is accepted for this slice and must stay
visible as `no-evidence`, not as a date-range empty window.
