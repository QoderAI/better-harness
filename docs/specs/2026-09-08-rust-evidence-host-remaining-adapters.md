# Port remaining Desktop evidence-host adapters

## Traceability

- Spec ID: rust-evidence-host-remaining-adapters
- Status: Implemented
- Follows: `docs/specs/2026-09-08-rust-evidence-host.md`

## Intent

The first evidence-host slice left seven JS session-analysis hosts as
`no-evidence` on Desktop. Port them as the same kind of bounded snapshot the
existing Rust adapters already produce, so opening a Project can surface those
Sessions and the Artifact files they changed. The JS analyzers stay canonical
for `better-harness session-analysis`.

## Acceptance Scenarios

- **AC-1:** `sessions.discover` reports `ok` for each of augment, qwen, pi,
  kimi, workbuddy, dsh, and harness-run when a workspace-qualified fixture
  exists, and `no-evidence` when the home is empty. A Session has `sessionId`,
  `platform`, and a usable `firstSeen` or `lastSeen`.
- **AC-2:** Tool calls that name a file inside the Project become POSIX-relative
  observations. Paths outside the root are dropped.
- **AC-3:** Workspace matching uses each host's native identity (cwd, slug,
  project key, or workspace index). A foreign-cwd transcript is not attributed
  to the open Project.
- **AC-4:** `PORTED` lists all thirteen hosts. `UNPORTED` is empty. Discovery
  still fails closed on a single adapter error without aborting the others.
- **AC-5:** Native tests cover one fixture per host plus the existing slug
  helpers. Compressed DSH `.jsonl.zstd` artifacts are omitted rather than
  failing discovery.

## Non-goals

- Replacing or changing `scripts/session-analysis` parsers, privacy pipelines,
  usage accounting, fork-cutoff dedupe, or CLI output.
- Porting DSH's fail-closed event-shape validator or Zstd frame scanner.
- Interpreting encrypted reasoning, opening tool output sidecars, or claiming
  field-level parity with the JS analyzers.
- New hosts, UI chrome, packaging, or CI jobs.

## Plan and Tasks

Keep each adapter a `discover_from(home, workspace, max)` snapshot like Claude
and Grok: walk the native tree, qualify by workspace, retain bounded prompts,
tool names/paths, and last assistant text.

| Host | Home / tree | Identity |
| --- | --- | --- |
| augment | `~/.augment/sessions/*.json` | `ide_state_node` workspace folders / terminal cwd |
| qwen | `$QWEN_RUNTIME_DIR` or `$QWEN_HOME` or `~/.qwen/projects/<slug>/chats/*.jsonl` | sanitizeCwd slug + record `cwd` |
| pi | `$PI_CODING_AGENT_DIR` or `~/.pi/agent/sessions/--<slug>--/*.jsonl` | session header `cwd`; custom sessionDir is out of scope |
| kimi | `~/.kimi-code/sessions/wd_*/ses_*/agents/*/wire.jsonl` | `workspaces.json` / `session_index.jsonl` / `wd_<basename>_` fallback |
| workbuddy | `$WORKBUDDY_DIR` or `~/.workbuddy/projects/<slug>/*.jsonl` | slug + record `cwd` |
| dsh | `$DSH_HOME` or `~/.dsh/sessions/<projectKey>/<encodedId>/session.jsonl` | header `cwd`; uncompressed only |
| harness-run | `<workspace>/.better-harness/harness-runs/**/trace.jsonl` | sibling `revision.json`; always this Project |

## Test and Review Evidence

- `rustup run 1.96.0 cargo test` in `rust/evidence-host`: 19 lib tests and 14
  stdio-host tests passed, including one fixture per new host, empty-home
  `no-evidence`, slug helpers, and `host.describe` listing all thirteen
  platforms.
- Risk: snapshots are thinner than JS (no usage charts, no DSH zstd, no Pi
  custom sessionDir). Missing compressed DSH sessions must not be presented as
  an empty date window. Windows/Linux CI was not run.
