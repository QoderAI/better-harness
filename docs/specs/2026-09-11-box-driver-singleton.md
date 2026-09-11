# One box driver, many connections

## Traceability

- Spec ID: box-driver-singleton
- Status: Implemented (infrastructure); the shim does not use it yet
- Request: resolve the driver-singleton question left open by the BoxLite POC,
  taking the recommended option
- Builds on: [`2026-09-10-boxlite-microvm-xpc-poc.md`](2026-09-10-boxlite-microvm-xpc-poc.md),
  [`2026-09-11-debugger-microvm-placement.md`](2026-09-11-debugger-microvm-placement.md)

## Intent

BoxLite locks its home directory:

```text
Another BoxliteRuntime is already using directory: ~/.boxlite
Only one runtime instance can use a BOXLITE_HOME directory at a time.
```

Every piece of box work so far has been shaped by that sentence. `box-service`
copied `acp-host`'s one-driver-per-connection transport, which cannot work here:
the second connection's driver fails to start and that caller gets nothing. The
Debugger's placement feature sidesteps it by giving each run its own shim with
its own runtime, which is why only one boxed run can be active at a time.

The POC listed three ways out and recommended the first: **one driver, shared by
every connection, with replies routed by connection id.** This implements it.

What it does not do is make concurrent boxed runs work — `harness-box-exec`
still owns a runtime of its own. This is the floor that change will stand on,
verified independently so that change is about the shim and nothing else.

## Acceptance Scenarios

- **AC-1** Given three concurrent clients, when each connects, then all three
  reach one service process and one driver process.
- **AC-2** Given those connections, when each sends a request, then each reply
  reaches the client that asked and no other, matched by request id.
- **AC-3** Given three connections running a command in the *same* box, when the
  commands produce output, then each connection sees only its own. A box is
  shared by name; a command is not.
- **AC-4** Given one connection with a long-running command, when other
  connections open and close, then that command runs to completion uninterrupted.
- **AC-5** Given the driver dies, then every connection is told, rather than
  hanging on a pipe that will never answer again.
- **AC-6** Given a caller sends `shutdown` over a shared driver, then it ends
  only that caller's work. A direct stdio caller keeps the old meaning.

## Non-goals

- Changing `harness-box-exec` to use the service. That is the next slice, and
  until it lands concurrent boxed runs still fail with the one-at-a-time message.
- Any Studio-visible behaviour. Nothing in Studio talks to this service yet.
- Sharing a box's *commands* across connections. Boxes are shared by name on
  purpose; commands belong to whoever started them.
- Windows and Linux, where there is no NSXPC transport.

## Plan and Tasks

### `ServiceType: User`, not `Application`

This was the discovery that decided the design, and it is invisible in code —
three concurrent clients were measured against both:

| ServiceType | servicePids observed | Result |
| --- | --- | --- |
| `Application` | three distinct | One service *and runtime* per calling process; clients 2 and 3 got nothing |
| `User` | one, shared | One service for the login session, as required |

`Application` means one instance per calling *process*, not per bundle. No
amount of care inside the service would have helped: the singleton has to exist
before the routing does.

### The envelope grew one field

```json
{"version":1,"id":3,"method":"box.exec","params":{…},"connectionId":7}
{"version":1,"id":3,"connectionId":7,"result":{"execId":"exec-1"}}
{"version":1,"connectionId":7,"event":{"type":"output","execId":"exec-1","…":"…"}}
```

The caller does not set it and cannot: it does not know which connection it is.
The service stamps requests on the way in, and the driver echoes it on replies
and stamps it on the events a connection caused. A driver spoken to directly
over stdio omits it throughout and is simply the only caller.

Events need it more than replies do. A reply could in principle be matched by
request id, but an event is unsolicited — without an address, one caller's box
output would be delivered to another's reader.

### Reaping got narrower

The sibling services reap the driver when a connection drops, because the driver
*is* that connection. Here it is everyone's, so:

- a dropped connection sends `connection.close`, and the driver kills only the
  commands that connection started;
- **boxes survive** — they are named per Project and shared, so the next session
  reuses the install this one paid for;
- `reap_driver` is now reached only when the driver itself is gone, and it tells
  every connection why before standing down;
- `shutdown` from a shared caller is downgraded to `connection.close`. Letting
  one caller tear down shared boxes would stop another session's agent mid-turn.

## Test and Review Evidence

Local macOS 26.6.2, Apple M4 Pro, BoxLite 0.10.0, 2026-09-11. Three concurrent
`harness-box-client` processes against a hand-assembled signed bundle.

| AC | Evidence |
| --- | --- |
| AC-1 | All three reported `servicePid=73792` and `driverPid=73793`. Under the previous `Application` type the same test gave three service pids and two silent clients. |
| AC-2 | Each client sent a distinct request id (101/102/103) and received its own back, with `connectionId` 1, 2 and 3. |
| AC-3 | Three connections created and started the *same* box, then each ran `echo mine-is-clientN`. Each saw exactly `['mine-is-clientN']` — no leak, no loss. |
| AC-4 | A command emitting five lines over ten seconds completed `['A1'…'A5','exit0']` while two other connections opened and closed during it. |
| AC-5 | `reap_driver` drains the routing table and calls `hostFailed:` on every proxy before reaping; reached only from the read loop's exit. |
| AC-6 | `shutdown` with a `connectionId` routes to `close_connection`; the stdio driver still exits when the id is absent. |

`cargo +1.96.0 fmt --check` and `clippy --release --all-targets`: clean, 0
warnings. No leftover boxes after the runs.

One defect found and fixed by this testing: the bridge opens with a bare newline
to prove the channel works, and the first implementation treated that
unparseable frame as malformed and closed the connection — so every client hung.
Blank frames are now dropped, matching what the stdio driver already did.

Risk: the service is now stateful across connections, so a driver crash affects
every caller rather than one. AC-5 makes that legible but not survivable — no
restart is attempted. And `ServiceType: User` means the service outlives any
single Studio, which is what makes box reuse cheap and also means a stale
service keeps running an old binary until it is killed; that cost a debugging
cycle here.

AI involvement: Claude implementation and local verification.
