# Choosing where a Debugger run executes

## Traceability

- Spec ID: debugger-microvm-placement
- Status: Implemented
- Request: put the microVM capability on the Debugger page, with a placement
  choice in the top-right, defaulting a virtual-machine run to qodercli
- Builds on: `docs/specs/2026-09-10-boxlite-microvm-xpc-poc.md`

## Intent

Every Agent the Debugger drives executes its commands on the reader's machine.
The [BoxLite POC](2026-09-10-boxlite-microvm-xpc-poc.md) established that an
Agent can instead run inside a disposable Linux microVM with the Project
bind-mounted, and that `harness-acp-host` needs no change to allow it.

This turns that into a choice a reader can make: a placement control beside the
run commands, `This Mac` or `microVM`, applied to the next live run.

**The request's default could not be honoured, and the reason is load-bearing.**
qodercli ships as a single Bun-compiled Mach-O arm64 binary — verified on the
development machine as `qodercli-1.1.48`, with no package on a public registry —
so a Linux guest has nothing to install. A box run therefore defaults to the
first Agent that *does* have a portable distribution, and qodercli stays the
host default it already was. The reader is told why rather than shown a
placement that fails when they use it.

## Acceptance Scenarios

- **AC-1** Given a Studio with the shim staged and at least one Agent with a
  microVM recipe, when the Debugger is open, then a two-state placement control
  appears among the run commands and reports which state is active. Given
  neither condition, the control is absent and every run stays on the host.
- **AC-2** Given the placement is `microVM`, when the live-run composer opens,
  then Agents without a recipe are unselectable and carry the reason a *box*
  cannot host them — not the reason this machine lacks them — and the local
  Qoder harness is unselectable because it is a different transport with no
  guest to run in.
- **AC-3** Given an Agent absent from this machine but with a recipe, when the
  placement is `microVM`, then it is selectable; and given an Agent installed
  here without a recipe, it is not. Box availability never consults host
  availability, because the box installs the Agent itself.
- **AC-4** Given a `microVM` run, when it starts, then the ACP host spawns
  `harness-box-exec` in the Agent's place with the Project bind-mounted at
  `/workspace`, the Agent installed into the guest on first use, and egress
  restricted to the registry plus the Agent's own provider hosts.
  `harness-acp-host` is unchanged.
- **AC-5** Given a second run in the same Project, when it starts in a box, then
  it reuses that Project's box and skips the install the first run paid for. Two
  different Projects do not share a box.
- **AC-6** Given the placement is `microVM` while the selected Agent has no
  recipe, when the placement changes, then the selection moves to an Agent the
  box can start instead of failing later at the server.
- **AC-7** Given Studio launched by the desktop app, when a box is created, then
  `mke2fs` resolves to a real e2fsprogs binary even though the process inherited
  launchd's `PATH` and Homebrew keeps e2fsprogs keg-only.
- **AC-8** Given a run already executing in a box, when a second box run starts,
  then it fails with a sentence naming the one-at-a-time limit rather than a raw
  lock error.
- **AC-9** Given a box that cannot be prepared — an image that will not pull, a
  guest that will not boot, an Agent install that fails — when a run starts,
  then it ends with a sentence naming the likely cause and the Agent's own
  process exits non-zero rather than hanging.
- **AC-11** Given the placement is `microVM`, when the live-run composer opens,
  then it states that a first run in this Project prepares the guest, can take
  minutes with no visible progress, and that later runs reuse it. A host run
  shows no such line.
- **AC-10** Given preparation that never completes, when the deadline passes,
  then the run fails saying so and names `--start-timeout`, and that sentence
  reaches the caller as the reason `connection.open` failed. The deadline is set
  below `AcpRustExecutor`'s own 10-minute request bound on purpose, so the
  explanation comes from the layer that knows the cause rather than as a generic
  "request timed out" from two layers up.

## Non-goals

- **Concurrent box runs.** BoxLite locks its home directory to one runtime, and
  each run currently owns its own. AC-8 makes that legible rather than removing
  it; removing it needs the driver-singleton decision the POC left open.
- qodercli, Codex ACP, or a custom `--acp-agent` inside a box. The first has no
  Linux build, the second has no public package, and Studio will not guess an
  install recipe for the third.
- Compare lanes. Placement is a Debugger control in this slice.
- Provider credentials. A boxed Agent reads its key from the environment it is
  given; BoxLite's `Secret` substitution, which keeps a key out of the guest
  entirely, is not wired up.
- Windows. `box-service` is not built there.
- ACP's own `fs` and terminal services, which still read the host. The mount
  keeps them consistent with the guest; full isolation would change `acp-host`.

## Plan and Tasks

### Placement is a run parameter, not a second Agent list

A boxed Pi is still Pi. Modelling placement as new catalog entries would double
the list and split one Agent's identity in two, so it travels as one query
parameter and is resolved in exactly one place:

```text
RunView ── liveRunEndpoint(choice, endpoints, placement)
              └── /api/acp/runs/stream?agent=pi&placement=box
                    └── server.ts: acpAgentInBox(profile.agent, profile.box, …)
                          └── harness-box-exec --box … -- pi-acp
```

Absent means host, so an older server ignores the parameter rather than
misreading it.

### The catalog gains a recipe, not a flag

`Preset` carries either a `box` recipe or a `boxMissing` reason, and the two are
exclusive. A recipe says what the *guest* installs and runs, which is why it is
keyed off packages rather than the host executable:

| Agent | Box | Reason |
| --- | --- | --- |
| Qoder CLI | — | macOS arm64 binary only; a box runs Linux |
| Pi ACP | `node:20-slim` + `@earendil-works/pi-coding-agent`, `pi-acp` | verified answering ACP `initialize` in a box |
| Claude ACP | `node:20-slim` + `@zed-industries/claude-code-acp` | the adapter bundles the Agent SDK |
| Codex ACP | — | no package on the public npm registry |
| DSH ACP | — | no portable entrypoint is registered |

`modelPolicy` belongs to the recipe rather than the host Agent: what runs in the
guest is `recipe.command`, which may not exist on this machine at all.

### One box per Project

`boxNameForWorkspace` derives a stable name from the Project path, so reuse
survives a Studio restart and two Projects never share a guest. Reuse is the
economy of the feature: a first run pays ~96 s to install Pi, the second pays
under a second to reattach.

### Optional everywhere

BoxLite compiles from source and needs `protoc`, which no other service does.
`scripts/rust.mjs` skips `box-service` when it is absent, `main.mjs` passes
`boxExecExecutable` only when the binary exists, and the control hides itself
when the server reports no boxable Agent. A machine that cannot build BoxLite
builds and runs everything else unchanged.

### When a box will not start

A boxed run has a slow, failure-prone half the host path does not: pulling an
image, building a rootfs, installing packages over a network. Nothing upstream
bounds it — `harness-acp-host` deliberately has no timeout, because it is
waiting for an Agent's first frame, and Studio's only ACP timeout is the
five-minute one on a permission prompt. So a stalled pull would leave the
Debugger waiting with nothing to show.

`harness-box-exec` therefore owns the failure story for that half:

| Failure | What the reader gets |
| --- | --- |
| Another box run is live | *"Only one microVM run can be active at a time. Finish or cancel the other run…"* |
| Image will not pull | The registry's own error, plus what a first run needs |
| Guest will not boot | The same sentence, naming hardware virtualization |
| Agent install fails | The exit code, and a pointer at the egress allow-list |
| Nothing completes | *"The microVM was not ready within {deadline}…"*, naming `--start-timeout` |

Each is one deadline over create-boot-install and a non-zero exit, never a hang.
The ACP host already retains an Agent's stderr as connection diagnostics and
attaches it to the failure, so these sentences are literally the text Studio
shows when a run refuses to start — which is why they name a likely cause rather
than the layer that failed.

The deadline (`--start-timeout`) defaults to **480 s, deliberately under the
600 s** `AcpRustExecutor` allows any ACP host request. `connection.open` is the
request waiting for this process to answer `initialize`, so overrunning it would
replace a specific explanation with a generic "request timed out" from two
layers up — while this process kept running. Losing that race on purpose is what
keeps the diagnosis where the cause is known.

What this slice does **not** do is report progress, and the composer says so
rather than pretending otherwise: choosing `microVM` shows a line explaining
that a first run in this Project prepares the guest, can take minutes with no
visible progress, and that later runs reuse it.

That is expectation management, not a progress bar, because a real one has no
clean route today. The shim owns the slow work and its stderr reaches the ACP
host only as failure diagnostics — `AgentDiagnostics` retains a tail and uses it
in `explain`, never on the success path. Streaming it properly would mean a new
event through four contracts (acp-host wire → `AcpRustExecutor` → run event →
UI). The cheaper and better route is for Studio to read `boxState` from
`box-service`, which already emits it — and that is gated on the same
driver-singleton decision as everything else.

### `mke2fs`, resolved rather than hoped for

BoxLite shells out to `mke2fs` and finds it on `PATH`. A Studio-spawned process
inherits launchd's `PATH`, not a shell's; Homebrew keeps e2fsprogs keg-only; and
`android-platform-tools` installs a *different* `mke2fs` under the same name
that BoxLite dies on with an empty `exit code None`. `ensure_tooling_path`
therefore prepends the known-good locations — prepends, so a real e2fsprogs wins
over a shadowing one — before the runtime is built.

## Test and Review Evidence

Local macOS 26.6.2, Apple M4 Pro, Rust 1.96.0, BoxLite 0.10.0, 2026-09-11.

| AC | Evidence |
| --- | --- |
| AC-1 | `placementAvailable` gates the control; covered by `live-agent-choices.test.ts` for both a catalog with a recipe and one without. |
| AC-2/3 | `acp-agent-catalog.test.ts` asserts Pi is `available: false` but `boxAvailable: true` with nothing installed, qodercli the reverse with its own reason, and `choiceRunnable` refuses the local harness in a box. |
| AC-4 | `acp-agent-catalog.test.ts` asserts the generated argv mounts `/work/better-harness:/workspace`, ends at `pi-acp`, installs both packages, and allows the registry plus `api.anthropic.com`. |
| AC-5 | `boxNameForWorkspace` is stable per path and distinct across paths. Measured live in the POC: reuse reattached in 0.82 s against a 96.6 s first install. |
| AC-6 | `resolveLiveAgentChoice(choices, "acp:qodercli", "box")` moves to `acp:pi`. This caught a real defect: the first implementation required host availability in a box, which would have hidden every uninstalled-but-boxable Agent. |
| AC-7 | `harness-box-host` created, booted (2.7 s), ran a command in, and removed a fresh `alpine` box under `PATH=/usr/bin:/bin:/usr/sbin:/sbin`. |
| AC-8 | With one driver holding the lock, a second shim exited 1 with *"Only one microVM run can be active at a time. Finish or cancel the other run…"* above BoxLite's raw lock error. |
| AC-9 | `--image nonexistent-registry-xyz/nope:latest` exited 1 with the registry's own failure plus *"This needs hardware virtualization, and a first run must be able to pull…"*. A failing install returns the exit code and points at the egress allow-list. |
| AC-10 | `--start-timeout 1` against an unprepared `node:20-slim` exited 1 with *"The microVM was not ready within 1s… raise --start-timeout if this machine is simply slow."* Driving the real `harness-acp-host` with that shim returned it verbatim as the `connection.open` error, under `ACP initialize failed: Incoming transport closed` — so the reader gets the cause, not just the symptom. Default deadline is 480 s, under the executor's 600 s. |

| AC-11 | With `microVM` selected, the composer renders the first-run line above the prompt, beside a `microVM` chip, with `Pi ACP` already selected. i18n resource tests keep the English and Chinese keys in step. |

Verified live in a running Studio (dev server, Project bound, Debugger open):
the placement control renders beside `Saved runs`, switching to `microVM` moved
the observed Agent from `Qoder CLI` to `Pi ACP` on its own, and the composer
listed every Agent with a box-side reason — `Pi ACP` and `Claude ACP` selectable
with *"Runs in a node:20-slim microVM · installs …"*, `Qoder CLI` disabled with
its macOS-binary reason, and the local Qoder harness disabled because it "has no
guest to run in".

`npx tsc --noEmit`: clean. `npx vitest run` (harness-studio): 672 tests.
`cargo +1.96.0 fmt --check` and `clippy --release --all-targets`: clean, 0 warnings.

Risk: concurrent box runs remain unsupported (AC-8 reports rather than solves
it), and a boxed Agent still needs its provider key in the guest environment.
Both are named in Non-goals. The `protoc` prerequisite is new for anyone
building the desktop Rust services, though the build degrades rather than fails
without it.

AI involvement: Claude implementation and local verification.
