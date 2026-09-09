# Build Harness Design on the official DSH runtime

## Traceability

- Spec ID: studio-dsh-harness-design
- Decision: [Use DSH for Harness Design](../adrs/studio-dsh-harness-design.md)
- Status: Implemented, local validation
- Request: choose one implementation; maintainer accepted DSH and continuing
  with removal of Pi plus integration of the runtime compiler experiment.
- Supersedes the dual-runtime composition in
  [Harness Design entry](2026-09-09-harness-design-entry.md).

## Acceptance

- **AC-1:** Harness Design has one Start button and the official DSH interface.
  Remove the Pi workspace, terminal transport, dedicated dependencies and
  packaging preparation. Keep unrelated Pi adapters and historical measurements.
- **AC-2:** Desktop starts a dedicated owned DSH Profile with the compiler
  controller and an editable local plugin entry. Preserve existing files and
  never use the default DSH home. Compile with the existing esbuild-wasm
  dependency; bundle the capability through a public entrypoint for packaging.
- **AC-3:** An official DSH tool compiles the fixed local source and queues a
  revision. Native agent maintenance leases wait for active work to finish and
  park later input while activation runs. Prevent new Agent publication during
  the activation boundary. Cancellation/shutdown releases reservations.
- **AC-4:** Await native loader activation before reporting success. Compile
  and load errors remain observable in official tools and Studio's inline
  status. Keep the last good patch on failure; report rollback failure honestly.
  Do not claim rollback of arbitrary plugin side effects.
- **AC-5:** Validate real DSH plugin replacement, scoped cleanup, syntax/apply
  failures and recovery, busy-agent ordering, cancellation, browser draft
  retention and the packaged capability's independent module resolution.
  Verify one-button UI and keyboard/overflow/errors at three widths.

## Plan and boundaries

Bring the DSH compiler experiment onto this branch, then expose its public
bootstrap entry. A persistent DSH controller handles native tools and activation;
the generated plugin remains a separate replaceable loader entry. Stage modules
before activating and persisting them. Use the native `startup` Profile policy
so only the controller activates changes; the standalone CLI keeps its `live`
watcher. The first launched Studio Project owns
the source entry for the lifetime of this DSH process; selecting another DSH
workspace does not silently change the compiler target.

No Pi implementation ships in this page. No automatic install, application-core
compilation, custom conversation UI, per-keystroke activation, native model call
requirement, arbitrary code sandbox or full side-effect transaction is included.
Use an explicit tool invocation to compile, not activation on every save.

## Evidence and risk

- AC-1/2: Studio build/typecheck and 82 focused host, shell and server tests pass.
  Concurrent Design launches share one process; the built bootstrap initializes
  a separate owned home, binds the first Project and keeps control tokens out
  of renderer state. Shutdown during startup does not await its readiness timer.
- AC-2/3/4: 20 compiler/bootstrap/activation/CLI tests pass. They cover staged
  publication, digest checks, source preservation, partial lease release,
  timeout, cancellation and native full-module restoration.
- AC-3/4/5: DSH 0.1.2-rc.1 / Node 24 native smoke passes from a compiler bundle
  and WASM dependency copied outside the checkout. A native Agent maintenance
  lane delays activation; new Agent creation is rejected during activation and
  works afterward. Syntax and native apply errors retain the disk patch; the
  old greeting tool is callable after restoration and a repaired v2 activates.
  One PID serves both versions, with one final v2 disposal on shutdown.
- AC-5: Playwright preserves an unsent official Web draft across replacement;
  no model calls are made. Native probes invoke registered tool definitions,
  not the entire model/permission dispatch. Receipt and images are in ignored
  `dist/dsh-design-smoke/`.
- AC-1/4/5: five Studio browser checks pass, covering 1440, 1024 and 390 pixel
  widths, keyboard launch/focus, navigation draft retention, inline error and
  recovery, bounded overflow and zero console/page errors. The optional
  installed-host case in that suite is skipped; the separate native smoke above
  uses the real official DSH interface.
- Desktop staging and six service tests pass. The staged production closure
  contains no node-pty or xterm. An unsigned macOS arm64 app was built with the
  existing local Rust service artifacts, then exercised through Electron:
  one-button launch, official workspace selection, native draft/focus retention,
  three widths and zero console/page errors. The controller reaches idle using
  its `app.asar.unpacked` compiler/WASM path. Receipt and inspected screenshots
  are under `packages/better-harness-desktop/dist/dsh-acceptance/`.
- Seventy compiler, CLI, document-link, scripts-contract and Antigravity tests
  pass, with one optional Antigravity case skipped. The ADR closure snapshot is
  updated to 115 nodes / 327 edges / 119 files; routing graph generation is
  unchanged. These seventy include the twenty compiler tests above.
- `npm run preview` still fails because the local Canvas SDK runtime is absent;
  its `/health` and `/canvas-module.js` checks are not verified. This does not
  describe the separately passing native DSH or Studio browser flows.

Readiness: the maintainer request supplies scope; no Story id was provided.
The imported DSH compiler experiment and the Pi removal serve AC-1 through AC-5.
The diff contains the public compiler/controller, Desktop resource routing,
single-interface UI, focused/native/browser tests, ADR/spec and the required
document closure snapshot. No release metadata or unrelated adapters changed.
The commit records its AI co-author; hosted CI is evaluated after push.

The controller remains mounted across plugin updates. ESM cache accumulates
until process exit; immutable files remain on disk. Generated code has the
DSH host's authority. A hung lifecycle requires stopping DSH; maintenance is
not released prematurely while its loader update is still running. Signed
installers and Windows/Linux native execution remain separate receipts.
