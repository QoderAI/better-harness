# Use DSH for Harness Design

- ADR ID: ADR-0010
- Status: Accepted
- Decision date: 2026-09-09
- Supersedes: [Native Pi terminal](studio-native-pi-terminal.md)
- Extends: [Official DSH workspace](studio-dsh-acp-workspace.md)

## Decision

Harness Design keeps DSH as its only implementation. The maintainer explicitly
chose one runtime after the comparison and accepted the DSH recommendation.
Keep one launch button and embed the official Web interface. Remove the Pi
page, terminal transport, xterm and node-pty dependencies. Existing Pi adapters
elsewhere and recorded distribution comparisons remain independent.

Desktop boots a dedicated, owned DSH home beneath its data directory. The first
launched Studio Project owns `.harness-design/plugin.ts` for that process's
lifetime. Existing source is preserved. Credentials and session configuration
in this isolated home are configured through the official DSH interface.

The controller adds two native tools: `harness_compile_plugin` stages an ESM
plugin with esbuild-wasm, and `harness_design_status` reports compilation and
activation. Compilation runs inside the existing DSH process; the public
compiler bundle is shipped in Studio and uses its declared WASM dependency.
The application and DSH core are preinstalled, not rebuilt on each edit.
The compiler resources and full `esbuild-wasm` package are unpacked beside
`app.asar`; Desktop passes that real path so external Node can import them.
Bootstrapping writes a no-op ESM seed without starting a compiler in Electron.

## Activation ownership

The compile tool returns promptly so its calling agent can finish. Background
activation waits up to 60 seconds for every native Agent maintenance lane,
claims them synchronously and vetoes new Agent publication during replacement.
Later input is parked by native maintenance. Cancellation before activation
retains the old patch. Once loader work starts, leases remain held until it
settles; the controller does not release them behind still-running plugin code.

Use the native `startup` patch policy in this owned Profile: file persistence
must not create a second asynchronous activation writer. The controller awaits
native `Entry.update`, then publishes the immutable revision for the next boot.
The standalone CLI experiment retains its original `live` policy.

DSH 0.1.2-rc.1 can lose a module's injection metadata during callback rollback.
When failed rollback leaves no active fiber, restore the previous full module
through a forced native update. Report the activation error even after recovery;
if restoration also fails, retain the last good disk patch and report that DSH
needs restarting. Do not promise rollback of arbitrary plugin side effects.

## Feedback and limits

The official tool views carry results. Studio displays one inline status/error
row and keeps the upstream frame mounted. A host-authenticated, GET-only status
endpoint supplies feedback; it accepts no compilation or filesystem commands.
No additional action buttons or custom chat protocol are introduced.

Local plugins execute with DSH's authority. A plugin whose lifecycle never
settles can block activation until DSH is stopped; Desktop shutdown escalates
to terminating the process. ESM revisions occupy process cache until exit and
their files persist in the owned Profile. This is not type checking, a sandbox,
a general dependency installer or an application-core compiler.

The [implementation spec](../specs/2026-09-09-studio-dsh-harness-design.md)
records focused, native, browser and distribution-resolution evidence.
