# Preserve Pi's native terminal interface in Studio

- ADR-0009
- Status: Proposed
- Date: 2026-09-08

## Context

The maintainer requested a Pi equivalent of the dedicated official DSH workspace
and a distribution-size comparison. Pi's current upstream exposes an interactive
terminal, RPC and SDK; its client/server packages provide transport primitives,
not a ready-made browser application. Rebuilding a chat page from RPC would
replace the upstream interface the maintainer asked to preserve.

## Decision

Use Pi's installed executable in a managed PTY within the existing Studio Node
host. Studio renders terminal bytes using xterm; Pi retains its composer,
commands, tools, settings and session behavior. The page has one launch button
and no title actions. The host discovers but never installs Pi.

Startup cwd comes from the server-owned Project. A session carries a Project
revision and process generation; stale input is rejected. A different Project's
explicit launch stops the previous process, while ordinary page navigation
retains the terminal. Input/output are bounded, output is memory-only, and
shutdown terminates the owned process tree. Ctrl+Shift+F6 exits terminal focus.
The terminal supplies a color-scheme hint; saved Pi settings still belong to Pi.

`node-pty` uses Node-API. Prepare its platform runtime during Studio build and
Desktop staging, and unpack the native helper files from ASAR. This adds native
dependency/build work inside the existing Node host; no additional desktop
service or alternative agent runtime is introduced. Linux requires a native
build because node-pty 1.1.0 ships no Linux prebuild. Windows uses ConPTY.

## Consequences and evidence

DSH owns a Web origin and full frontend; Pi owns a terminal interface. They offer
different experiences and different features. Package footprint results must
name versions, production dependency closures, platform and exclusions. Shared
Electron and the Studio terminal bridge are separate costs. Package-manager
payloads are not signed installer sizes or runtime memory measurements.

This draft retains at most 4 Mi characters of terminal output per process;
exceeding it stops that process and requires an explicit restart. Long-session
snapshot/streaming retention remains a production-hardening consideration.
Native Windows/Linux and packaged installers need their own acceptance.

Acceptance and measurements: [Pi runtime comparison spec](../specs/2026-09-08-studio-pi-runtime-comparison.md).

## Sources

- [Pi interfaces at the inspected revision](https://github.com/earendil-works/pi/blob/faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19/packages/coding-agent/README.md)
- [Pi transport-neutral client](https://github.com/earendil-works/pi/blob/faa9863cb8b54689f1d0c2df9dbab1ee1fa9de19/packages/client/README.md)
- [node-pty platform/runtime contract](https://github.com/microsoft/node-pty/tree/1.1.0)
