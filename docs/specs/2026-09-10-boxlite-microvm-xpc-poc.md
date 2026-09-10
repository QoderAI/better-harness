# BoxLite microVM capability service and an agent in a box

## Traceability

- Spec ID: boxlite-microvm-xpc-poc
- Status: Proof of concept — not wired into the desktop build
- Request: prove out BoxLite as an XPC service, work out how the Debugger goes
  inside one, and run the published `agent-in-box/run-pi` guide

## Intent

Every Agent the Debugger drives executes commands on the user's machine. The ACP
host fences filesystem access by canonical path, but `bash` is `bash`: an Agent
that installs a package, deletes a directory, or runs a downloaded script does it
to the real host.

[BoxLite](https://github.com/boxlite-ai/boxlite) is a daemonless Rust library
that boots hardware-isolated microVMs from OCI images and keeps them across
turns. This POC asks three questions and answers them with running code rather
than design:

1. Can BoxLite be hosted as a fourth capability service, beside OXC, ACP and
   Evidence, using the same NSXPC transport?
2. What does it take to put the Debugger's Agent inside a box?
3. Does the published `run-pi` guide work from Rust, on this machine?

The reader-facing outcome would be a Debugger session whose Agent can run
anything it likes, where the blast radius is a disposable VM and the edits still
land on the real project through a mount. This slice stops short of that: it
establishes feasibility, measures it, and names what remains.

## Acceptance Scenarios

- **AC-1** Given macOS on Apple Silicon with `kern.hv_support`, when the
  embedded BoxLite runtime creates and starts a box, then a Linux guest boots
  and runs a command, and the elapsed boot time is reported.
- **AC-2** Given the JSONL envelope (`box-rust-0.1.0+jsonl-v1`), when a caller
  drives `host.describe`, `box.create`, `box.start`, `box.exec`, `box.list`,
  `box.remove` and `shutdown` over stdio, then each returns a reply, command
  output arrives as unsolicited `output` event frames ahead of the `exit` event,
  and the driver exits cleanly. The envelope is versioned, bounded (4 MiB
  request, 16 MiB frame), and rejects unknown methods and unknown fields.
- **AC-3** Given a hand-assembled `Harness Box.app` signed with a plain ad-hoc
  `codesign`, when a caller drives `harness-box-client`, then the bridge reaches
  `com.qoder.harness-studio.box`, the service spawns one `harness-box-host`
  driver, a leading `transport` frame proves `servicePid !== bridgePid`, and a
  VM boots and executes a command through that hop. No entitlement is added to
  the service or the driver.
- **AC-4** Given `harness-acp-host` **unmodified**, when its Agent command is
  `harness-box-exec` wrapping a real ACP server, then the ACP `initialize`
  request reaches the server inside the box and its response reaches the caller.
  Only protocol bytes appear on stdout; provisioning and diagnostics go to
  stderr.
- **AC-5** Given the `agent-in-box/run-pi` guide, when it is reproduced through
  the Rust SDK instead of Python, then a Node image boots, the Pi CLI installs
  into the box, and the installed CLI answers — with timings recorded against
  the guide's published numbers.
- **AC-6** The POC states which of its findings are measured and which are
  design, and names the questions that must be settled before integration.

## Non-goals

- Wiring the service into `scripts/rust.mjs`, `nsxpc-bundle.mjs`,
  `after-pack.mjs`, `service-host.mjs`, or any Studio route. The NSXPC bundle
  used for AC-3 is assembled by a standalone script in the crate.
- Changing `harness-acp-host`. Proving it needs no change is the point of AC-4.
- Any Studio UI, an Agent profile that selects a box, or Performance/Evidence
  surfaces for box metrics.
- Windows and Linux. BoxLite supports both, but the transport question here is
  NSXPC.
- Running a model. No provider API key is used anywhere in this slice; `Secret`
  substitution, which keeps a key out of the guest entirely, is untested.
- Deciding the driver-singleton question below. It is surfaced, not answered.

## Plan and Tasks

### Capability split

```
Studio Node
  (not wired in this slice)
    -- JSONL stdio --
  harness-box-client               (macOS bridge, 376 KB)
    -- NSXPC sendFrame:/deliverFrame: --
  harness-box-xpc                  (launchd, 430 KB)
    -- stdio --
  harness-box-host                 (driver, 84 MB — owns the runtime and the VMs)
```

`xpc.rs` is the Evidence transport shell with the names changed, so the two stay
reviewable together. The size split is the design: no virtualization code sits
in the bridge or the service.

Reaping is load-bearing rather than tidy here. BoxLite is daemonless, so the VMs
are children of the driver; the existing `reap_driver` path is what stops a
dropped connection from stranding a running VM.

### Wire

Newline-delimited JSON, same envelope as Evidence. Unlike Evidence the channel is
duplex: a box boots and prints on its own schedule, so the host also emits
unsolicited event frames, distinguished by carrying no `id`.

| method | params | result |
| --- | --- | --- |
| `host.describe` | `{}` | `{ protocol, pid, boxlite, capabilities }` |
| `box.create` | `{ name, image?, cpus?, memoryMib?, diskSizeGb?, mounts?, allowNet?, env? }` | `{ boxId, name, created, elapsedMs }` |
| `box.start` | `{ name }` | `{ boxId, bootMs }` |
| `box.exec` | `{ name, command, args?, env?, workingDir?, timeoutMs?, interactive? }` | `{ execId, launchMs }` |
| `exec.stdin` | `{ execId, data, close? }` | `{ ok }` |
| `exec.kill` | `{ execId, signal? }` | `{ ok }` |
| `box.stop` / `box.remove` / `box.list` | `{ name, force? }` | `{ ok }` / `[BoxInfo]` |

Events: `{ type: "output", execId, stream, data }`,
`{ type: "exit", execId, exitCode, errorMessage? }`,
`{ type: "boxState", boxId, state, elapsedMs? }`.

Replies and events share one outbound queue, for the reason `acp-host`
documents: a command's output must reach the caller before the reply announcing
its exit. Requests are dispatched **concurrently**, so a `box.create` that
spends seconds booting cannot stall an `exec.stdin` for a box already up —
which also means replies may arrive out of send order, and causally dependent
calls must wait for the previous reply.

`box.create` names every box, and a repeated name reuses it. That is the whole
economy: the second session skips the install the first one paid for.

### The Debugger in a box

`harness-acp-host` spawns an Agent as `command + args` and speaks JSON-RPC to its
stdio. It does not care what that process is. So the Agent can move into a VM
with no change to the ACP host — only a command that looks like an Agent from
outside and is a microVM inside:

```
Studio ── acp-host ── harness-box-exec ─┬─ boxlite runtime
          (unchanged)  (stdio proxy)    └─ microVM: pi-acp
```

```bash
harness-box-exec --box debugger --image node:20-slim \
  --mount /work/project:/workspace --workdir /workspace \
  --allow-net registry.npmjs.org --allow-net api.anthropic.com \
  --probe 'command -v pi-acp' \
  --provision 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent pi-acp' \
  -- pi-acp
```

The mount is what keeps this honest: `/workspace` is the same bytes as the
project directory, so the Agent's edits are real and ACP's `fs/*` results agree
with what it sees, while its command execution is confined to the VM.

Studio's side would then be one substitution in `acp-agent-catalog.ts` — the
profile's `executable` becomes `harness-box-exec` and the box flags prepend its
`args`. That substitution is **not** made in this slice.

### `pi` and `pi-acp` are different programs

The catalog's existing note — "pi-acp is not installed; the pi CLI alone is not
an ACP server" — is correct, and was re-verified inside a box: after installing
`@earendil-works/pi-coding-agent`, `/usr/local/bin` holds only `pi`, nothing
under its `dist/` references `agent-client-protocol`, and `pi --mode rpc` is an
*output mode* (`text | json | rpc`), not an Agent server. `pi-acp` is a separate
npm package. So the run-pi guide and the Debugger want different commands in the
same box: `pi -p '…' --mode json` for a one-shot answer, `pi-acp` for a session.

### Build prerequisites

BoxLite compiles from source, so this crate needs two tools the other three do
not:

- `protoc` >= 3.12, or `boxlite-shared`'s build script fails outright;
- a real `mke2fs` on `PATH` (`brew install e2fsprogs`, keg-only, lands in
  `/opt/homebrew/opt/e2fsprogs/sbin`).

The second is a sharp edge worth recording: on the development machine
`/opt/homebrew/bin/mke2fs` was a symlink into the `android-platform-tools` cask,
not e2fsprogs, and BoxLite died building the guest rootfs with
`mke2fs failed with exit code None` — an empty diagnostic, because the process
never got far enough to have an exit code. Any machine with Android
platform-tools installed hits this.

## Test and Review Evidence

Local macOS 26.6.2, Apple M4 Pro, `kern.hv_support: 1`, Rust 1.96.0,
BoxLite 0.10.0, 2026-09-10. No provider API key was used.

| AC | Evidence |
| --- | --- |
| AC-1 | `examples/boot_probe`: guest reports `Linux 6.12.87 aarch64`, `uid=0(root)`, command exit 0. Boot 6.23 s with the image cached; total 6.30 s including create and remove. |
| AC-2 | stdio driver driven by a JSONL script: `host.describe` → `box-rust-0.1.0+jsonl-v1`; `box.create` → `zkAGGeEZfLKd`; `box.exec` `launchMs` 3730 followed by three `output` events (`hello from the box`, `6.12.87`, `0`) then `exit` 0; `box.list` returned both boxes; `box.remove` ok; `shutdown` and process exit 0. |
| AC-3 | `bundle.mjs --smoke`: `transport` frame `servicePid 27461 / bridgePid 27032`, driver pid 27540 — three distinct processes. Through that hop, `box.create` → `box.start` booted in **2.45 s** and `box.exec` streamed `booted through NSXPC` / `6.12.87` back as events, then `box.remove` and `shutdown`. Bundle signed with `codesign --force --sign - --deep` and no entitlements file. |
| AC-4 | `harness-box-exec … -- pi-acp` fed one ACP `initialize` line returned `{"agentInfo":{"name":"pi-acp","title":"pi ACP adapter","version":"0.0.33"},"agentCapabilities":{"loadSession":true,…}}` on stdout, with box reuse at 0.82 s, `pi-acp` install at 4.3 s and the reply at 4.49 s. A prior run with `-- cat` confirmed byte-exact round-tripping and that stdout carries no diagnostics. |
| AC-5 | `examples/pi_probe`: `node:20-slim` boots, `npm install -g --ignore-scripts` takes **96.6 s** (guide: ~72 s), `pi --version` → `0.74.2` in 0.82 s, `pi --help` exit 0. Total 193.6 s including the first-time image pull, against the guide's ~77 s on a warmer cache. |
| AC-6 | This section, plus the crate README's verified/open split. |

`cargo +1.96.0 fmt --check`: clean. `cargo +1.96.0 clippy --release
--all-targets`: 0 warnings. No existing file in the repository was modified.

### Entitlements: the expected blocker that was not one

Hypervisor.framework needs `com.apple.security.hypervisor`, but the process that
calls it is `boxlite-shim`, which BoxLite drops into each box's `bin/` and
**ad-hoc signs itself**:

```console
$ codesign -d --entitlements - ~/.boxlite/boxes/<id>/bin/boxlite-shim
    [Key] com.apple.security.cs.disable-library-validation  [Bool] true
    [Key] com.apple.security.hypervisor                     [Bool] true
```

Neither the XPC service nor the driver needs an entitlement of its own, which
AC-3 confirms in practice. The risk moved rather than vanished: the driver must
be able to write and execute a freshly signed binary under `~/.boxlite`. That
works today because these services are not `app-sandbox`ed; turning that on
would break it.

### Open questions, in the order they must be answered

1. **A driver singleton.** BoxLite locks its home directory — *"Only one
   runtime instance can use a BOXLITE_HOME directory at a time."* This is the
   one place the service cannot copy `acp-host`, which spawns a driver per XPC
   connection; a second box driver fails to start rather than share. Either the
   XPC service holds one driver and multiplexes connections onto it (a
   connection id in the envelope), or the service holds the runtime itself
   (dropping the driver child, and with it the thin-transport property), or each
   driver gets its own `BOXLITE_HOME` (discarding the shared image cache and
   every warm box, which is most of the value).
2. **`mke2fs` by absolute path.** An XPC service inherits launchd's `PATH`, not
   a shell's. AC-3's fresh-box creation only passed because the ext4 image was
   already cached, so this is unproven under launchd rather than known-good.
3. **Where ACP's own services read.** `services.rs` reads the host filesystem.
   With a mount that agrees with the guest this is consistent, but full
   isolation means reading through the box — and that does require changing
   `acp-host`.
4. **Cost of a box.** 8 GB sparse disk and a 23 MB shim per box, plus a ~96 s
   first provision. Acceptable for a Debugger session; unmeasured for a fleet.

Risk: this is exploratory work with no Story behind it and no consumer in
Studio. It adds a crate that does not build in CI, is not staged by
`rust.mjs`, and carries two build prerequisites the other services do not. It
should either gain a decision on the singleton question and be integrated, or be
removed — leaving it half-wired is the bad outcome.

AI involvement: Claude implementation and local verification.
