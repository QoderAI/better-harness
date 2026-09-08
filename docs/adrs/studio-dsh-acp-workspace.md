# Official DSH workspace and ACP comparison in Studio

- ADR ID: ADR-0008
- Status: Proposed
- Decision date: 2026-09-08

## Context

The maintainer explicitly requests the official DSH interactive interface inside
Studio Desktop, including its composer, conversations, tools and approvals.
A Studio-rendered ACP conversation does not satisfy this requirement. The
inspected upstream revision is `0a53fb55bea101816fa226bb964ae2bed71c343b`.

## Decision

The dedicated DSH page hosts the complete installed DSH Web application in an
isolated-origin frame. Its frontend, plugin graph, Host API and native runtime
remain upstream-owned. Studio does not reconstruct DSH components, translate its
interactive protocol, or substitute Point Go for DSH execution.

The existing Node host supervises the installed external application with
`dsh --profile web --no-open --host 127.0.0.1 --port 0`. This is application
lifecycle glue, not an extracted native capability service. Desktop discovers
DSH without starting or installing it; launch requires an explicit page action.
A server-validated Project id/revision supplies the initial cwd. DSH's own
workspace/session selector remains authoritative thereafter, and can select
other local directories: this is not a workspace security sandbox.

Studio owns one reusable DSH Web process and isolated loopback origin.
DSH manages multiple workspaces itself; switching Studio Projects does not spawn
additional writers against the same DSH home.
DSH's readiness URL authenticates the frame using its upstream token-to-cookie
exchange. The launch URL stays in memory and is neither logged nor persisted by
Studio; subsequent RPC and WebSocket requests go directly to DSH. Studio's
credential is never forwarded to the DSH origin. No proxy, trust-header rewrite,
DSH source patch, browser security disablement, or generic renderer launch API is
introduced. The frame has no Node access and cannot navigate the top window.

The host owns startup timeout, bounded output, exit reporting and shutdown.
Page navigation retains the active frame; changing Project never rebinds an
existing DSH process. The host stop operation and Studio shutdown terminate the shared Web host. Upstream owns persisted session recovery.

Keep `dsh --profile acp` in Debugger/Compare through the existing Rust ACP Host
(NSXPC on macOS, stdio on Windows/Linux). ACP remains the automation interface;
it does not supply the dedicated interactive page.

## Consequences and alternatives

The official UI retains upstream visual and keyboard behavior inside Studio's
semantic-token pane. The dedicated view has a single Start DSH button before
launch and no title actions, as explicitly requested by the maintainer. The two
applications have separate settings and session selection; Studio does not claim synchronized selections. Installation,
profiles and provider credentials remain DSH-owned. An unavailable Web profile
or startup failure is visible with retry; no ACP UI fallback is used.

Static-only embedding would omit the required dynamic plugin graph and native
Host services. Reimplementing upstream controls would recreate the mismatch the
maintainer corrected. Vendoring the full distribution is outside this slice;
the installed runtime supplies both frontend and backend.

## Validation gate

The [implementation spec](../specs/2026-09-08-studio-dsh-acp-workspace.md) owns
acceptance. Verify lifecycle and authority failures, real official UI within
Desktop, keyboard/overflow/errors/screenshots at three widths, and the retained
ACP catalog. Browser fixtures do not establish native model or platform parity.

## References

- [Studio architecture](../ARCHITECTURE.md)
- [Studio design contract](../../DESIGN.md)
- [Official Web application](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/bundle/web-app/README.md)
- [Official browser connection](https://github.com/deepseek-ai/deepseek-harness/blob/0a53fb55bea101816fa226bb964ae2bed71c343b/packages/client/connection/README.md)

## Inspected desktop references

Source inspection on 2026-09-08 (community projects, not official DeepSeek apps):

- [liguobao lifecycle](https://github.com/liguobao/dsh-desktop/blob/b956692e577a811a10f3c9fc44f3561aeb866613/src/harness-server.js): supervised Web process, bounded readiness output, process-tree stop. Its parent-watch module additionally handles parent crashes.
- [bruc3van runtime manager](https://github.com/bruc3van/dsh-desktop/blob/f741d9341e70b2b2ac1356b02210894260e4c40b/src/main/web-ui-manager.ts): one generation owns one DSH home; duplicate starts must join the existing generation.
- [anywhere-labs desktop plugin](https://github.com/anywhere-labs/dsh-desktop/blob/0c6849fbc00bed04775ee93b87b3d0faa77e064f/dsh-plugin-desktop/src/electron-shell-generation.ts): upstream token exchange within the Electron session, then official page loading and native lifecycle.
- Point's inspected local `desktop/electron/src/main.mjs` uses WebContentsView
  with a separate partition. It is useful when native surface ownership is
  required; a Studio frame avoids native-overlay/modal stacking and bounds IPC.
  Verify official UI compatibility in the actual shell before accepting it.

No third-party source is copied or executed. The first slice uses the upstream
launch-token exchange; it does not read credential files to mint cookies. It
owns normal process-tree shutdown, but does not yet provide a crash-survivor or
runtime-install/update manager like the standalone distributions.
