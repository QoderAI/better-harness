# Rust Box Service (POC)

**Status: proof of concept.** Not wired into `scripts/rust.mjs`, `service-host.mjs`,
or any Studio route — the bundle used for the NSXPC run below was assembled by
hand. Everything in [What was actually verified](#what-was-actually-verified)
was run on this machine; everything else is design, not a claim.

Spec: [`docs/specs/2026-09-10-boxlite-microvm-xpc-poc.md`](../../../../docs/specs/2026-09-10-boxlite-microvm-xpc-poc.md).

[BoxLite](https://github.com/boxlite-ai/boxlite) 0.10.0 hosted as a fourth
capability service, alongside `oxc-service`, `acp-host` and `evidence-host`. A
box is a hardware-isolated microVM running an OCI image, and it persists — which
is what makes it usable for an agent that installs packages and expects them to
still be there next turn.

The point of the service is not sandboxing for its own sake. It is a place to
put an agent's command execution that is not the user's machine, while the
agent still edits the user's real files through a mount.

## Why this shape

BoxLite is daemonless: the VMs are children of whatever process holds the
runtime. That maps onto the existing `acp-host` layout exactly — the XPC service
runs one unmodified `harness-box-host` driver per connection, the driver owns
the runtime, and the established `reap_driver` path is what stops a dropped
connection from stranding a VM. No new transport was invented for this.

```text
 Studio (Node)                  launchd service
 ────────────                   ──────────────
 harness-box-client <NSXPC> harness-box-xpc <stdio> harness-box-host ── microVMs
```

## Build prerequisites (verified, and both are sharp edges)

BoxLite compiles from source, so it needs more than the other three services:

- **`protoc` >= 3.12** — `brew install protobuf`. Without it `boxlite-shared`'s
  build script fails outright.
- **A real `mke2fs` on `PATH`** — `brew install e2fsprogs`, which is keg-only, so
  the binary lands in `/opt/homebrew/opt/e2fsprogs/sbin`.

The second one cost a debugging cycle and is worth stating plainly: on this
machine `/opt/homebrew/bin/mke2fs` was a symlink into the
`android-platform-tools` cask, not e2fsprogs. BoxLite invokes it to build the
guest rootfs and it died with `mke2fs failed with exit code None` — an empty
diagnostic, because the process never got far enough to have an exit code. Any
machine with Android platform-tools installed hits this. If the service is ever
productionised it should resolve `mke2fs` by absolute path rather than trusting
`PATH`.

```bash
PATH="/opt/homebrew/opt/e2fsprogs/sbin:$PATH" cargo +1.96.0 build --release
```

## Wire contract

Same JSONL envelope as `evidence-host` (`box-rust-0.1.0+jsonl-v1`): one UTF-8
JSON object per line, `version` 1, positive u32 `id`, 4 MiB request and 16 MiB
frame limits.

```json
{"version":1,"id":1,"method":"box.create","params":{"name":"debugger","image":"node:20-slim","mounts":[{"hostPath":"/work/project","guestPath":"/workspace"}],"allowNet":["registry.npmjs.org","api.anthropic.com"]}}
```

Methods: `host.describe`, `box.create`, `box.start`, `box.exec`, `exec.stdin`,
`exec.kill`, `box.stop`, `box.remove`, `box.list`, `shutdown`.

Unlike `evidence-host` the channel is duplex. A box boots and prints on its own
schedule, so the host also emits unsolicited **event** frames, distinguished by
carrying no `id`:

```json
{"version":1,"event":{"type":"output","execId":"exec-1","stream":"stdout","data":"..."}}
{"version":1,"event":{"type":"exit","execId":"exec-1","exitCode":0}}
{"version":1,"event":{"type":"boxState","boxId":"DuMuZRM21EtK","state":"running","elapsedMs":6230}}
```

Replies and events share one outbound queue, for the reason `acp-host` documents:
a command's output must reach Studio before the reply announcing its exit.

**Requests are dispatched concurrently, so replies may arrive out of order.** A
`box.create` that spends seconds booting must not stall an `exec.stdin` bound
for a box that is already up. Causally dependent calls must therefore wait for
the previous reply rather than assume send order — the smoke script below drove
`box.start` on a timer instead and got `no box named harness-smoke` back *before*
the `box.create` reply that would have created it.

`box.create` names every box. Reusing a name reuses the box, which is the whole
economy of the thing — the second Debugger session skips the install the first
one paid for.

## One runtime per BOXLITE_HOME

BoxLite locks its home directory: *"Only one runtime instance can use a
BOXLITE_HOME directory at a time."* This is the one place the service cannot
copy `acp-host`, which spawns a driver per XPC connection — a second box driver
would fail to start rather than share.

Three ways out, in preference order:

1. **One driver for every connection.** The XPC service holds a single driver
   and multiplexes connections onto it. Keeps the cache and the warm boxes;
   costs a connection id in the frame envelope.
2. **The XPC service holds the runtime itself**, dropping the driver child.
   Simplest, but the service stops being a thin transport and the hypervisor
   entitlement lands directly on it.
3. **A `BOXLITE_HOME` per driver.** Works today, throws away the shared image
   cache and every warm box — which is most of the value.

Nothing here is decided. It is the first thing to decide.

## Putting the Debugger in a box

`harness-acp-host` spawns an agent as `command + args` and speaks JSON-RPC to its
stdio. It does not care what that process is. So the agent can move into a VM
with **no change to the ACP host at all** — only a command that looks like an
agent from outside and is a microVM inside. That is `harness-box-exec`:

```text
 Studio ── acp-host ── harness-box-exec ─┬─ boxlite runtime
           (unchanged)  (stdio proxy)    └─ microVM: the agent
```

```bash
harness-box-exec --box debugger --image node:20-slim \
  --mount /work/project:/workspace --workdir /workspace \
  --allow-net registry.npmjs.org --allow-net api.anthropic.com \
  --probe 'command -v pi-acp' \
  --provision 'npm install -g --ignore-scripts @earendil-works/pi-coding-agent pi-acp' \
  -- pi-acp
```

Studio's side is then one substitution in `acp-agent-catalog.ts`: the profile's
`executable` becomes `harness-box-exec` and the box flags prepend its `args`.

### `pi` and `pi-acp` are different programs

The catalog's existing note — *"pi-acp is not installed; the pi CLI alone is not
an ACP server"* — is correct, and it matters for what goes in the box. Verified
inside one:

- `/usr/local/bin` holds only `pi` after installing `@earendil-works/pi-coding-agent`.
- Nothing under its `dist/` references `agent-client-protocol`.
- `pi --mode rpc` is an *output mode* (`text | json | rpc`), not an agent server.
  BoxLite's run-pi guide uses it for one-shot prompts, which is a different job.
- `pi-acp` is a separate npm package (0.0.33) and is the ACP entrypoint.

So the run-pi guide and the Debugger want different commands in the same box:
`pi -p '…' --mode json` for a one-shot answer, `pi-acp` for a session.

Three things follow from this design and only the first is implemented:

1. **The agent's commands run in the VM; its edits land on the host.** The mount
   makes `/workspace` the same bytes as the project directory, so `fs/*` results
   agree with what the agent sees. The blast radius of a bad `rm -rf` is the box.
2. **Boxes managed by the service rather than by each shim.** `harness-box-exec`
   currently embeds its own runtime, so Studio cannot list or observe those
   boxes. Routing it through `box-service` would put boot time and per-box
   metrics where Performance and Evidence can read them.
3. **ACP's own file and terminal services pointed at the box.** `services.rs`
   reads the host filesystem. Full isolation means reading through the box
   instead, and that does require changing `acp-host`.

## Entitlements: not this service's problem

This was expected to be the blocking risk. It is not.

Hypervisor.framework needs `com.apple.security.hypervisor`, but the process that
calls it is `boxlite-shim` — a 23 MB binary BoxLite drops into each box's `bin/`
and **ad-hoc signs itself**:

```console
$ codesign -d --entitlements - ~/.boxlite/boxes/<id>/bin/boxlite-shim
    [Key] com.apple.security.cs.disable-library-validation  [Bool] true
    [Key] com.apple.security.hypervisor                     [Bool] true
```

So neither the XPC service nor the driver needs an entitlement of its own. A VM
was booted through the XPC transport with nothing but `codesign --force --sign -
--deep` on the bundle — the same signing the other three services already get
from `scripts/rust.mjs`.

The residual risk moved rather than vanished: the driver must be able to *write
and execute a freshly signed binary* under `~/.boxlite`. That works from an XPC
service today because these services are not `app-sandbox`ed. Turning that on
later would break it.

## What was actually verified

On an M4 Pro, macOS 26.6.2, `kern.hv_support: 1`, BoxLite 0.10.0. No provider
API key was used anywhere below.

| Step | Result |
| --- | --- |
| A microVM boots | Linux 6.12.87 aarch64, `uid=0`, **6.23 s** cold with the image cached |
| The JSONL contract end to end | `host.describe`, `create`, `start`, `exec`, streamed stdout + `exit` events, `list`, `remove`, `shutdown` — clean exit |
| The run-pi guide, in Rust | `node:20-slim` boots, `npm install -g` takes **96.6 s**, `pi 0.74.2` runs (`--version`, `--help` both exit 0) |
| The shim's stdio bridging | A JSON-RPC line survives host → box → host intact; stdout carries only protocol bytes, diagnostics go to stderr |
| **A real ACP handshake inside the box** | `pi-acp` 0.0.33 answered `initialize` with its capabilities — box reused in **0.82 s**, `pi-acp` installed in **4.3 s**, reply at **4.49 s** |
| **The same, over NSXPC** | Three processes (`client` → `xpc` → `driver`), transport proof emitted, then a VM booted in **1.75 s** and ran a command with output streaming back as events. A fresh `alpine` box booted in **2.6 s** |

Two rows carry the argument. The ACP one: `harness-acp-host` was not modified,
and would not need to be. The NSXPC one: the runtime works from inside a signed
XPC service bundle, which was the risk this POC existed to test.

Still open: a driver singleton (see above), `mke2fs` resolved by absolute path
rather than `PATH` — an XPC service inherits launchd's `PATH`, not a shell's,
and the fresh-box test above only passed because the ext4 image was already
cached — and whether ACP's own `fs`/terminal services should read the host or
the box.

## Probes

```bash
cargo +1.96.0 run --release --example boot_probe     # a VM boots at all
cargo +1.96.0 run --release --example pi_probe       # the run-pi guide, in Rust
cargo +1.96.0 run --release --example pi_acp_probe   # is pi an ACP server? (no)
```

Run them one at a time — they each take the `BOXLITE_HOME` lock.
