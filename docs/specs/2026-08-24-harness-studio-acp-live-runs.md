# Run coding agents through ACP in Harness Studio

## Traceability

- Spec ID: harness-studio-acp-live-runs
- Status: Implemented

## Intent

Allow the Harness Studio Debugger to start a real local coding-agent session
through stable ACP v1 while preserving the existing Harness compile/resolve
boundary and AG-UI browser projection. The Studio server, rather than browser
JavaScript, owns the local Agent process, ACP connection, workspace root,
permission decisions, cancellation, and protocol evidence.

## Acceptance Scenarios

- AC-1: When Studio is configured with an allowlisted ACP Agent command, the
  Debugger composer offers that Agent alongside the existing workspace-default
  Qoder runtime. When no ACP Agent is configured, no ACP control or endpoint is
  advertised.
- AC-2: Starting an ACP run launches the configured command with an argv array,
  negotiates stable ACP v1, creates a session rooted at the selected local
  workspace, submits the harness-prefixed prompt, and projects the resulting
  assistant and Tool Call updates through the existing live Debugger.
- AC-3: Studio retains a bounded, credential-redacted protocol trace containing
  real ACP directions, methods, session ids, request ids, and payloads. The live
  State Inspector labels this as ACP evidence and does not construct synthetic
  `run/*` methods for an ACP run.
- AC-4: An ACP `session/request_permission` request appears in the live State
  Inspector with only the Agent-provided bounded choices. A same-origin decision
  route resolves that exact pending request; disconnect, cancellation, and
  timeout resolve it as cancelled rather than auto-approving an action.
- AC-5: Cancelling an active ACP run sends `session/cancel`, allows a bounded
  cooperative shutdown window, then closes an unresponsive Agent process and
  terminates the browser stream with an honest cancelled/error state. Qoder
  runs retain their existing behavior.
- AC-6: ACP is an honest prompt-session adapter. It delivers Harness skills in
  the prompt preamble but exposes no standard Harness tool or MCP capability
  merely because an Agent implements ACP; tool requirements therefore continue
  to fail closed during resolution.
- AC-7: Focused adapter, protocol projection, server, and browser tests prove
  initialization, workspace rooting, updates, permission decisions,
  cancellation, redaction, missing-command failure, and the unchanged Qoder
  path on macOS/Linux/Windows-compatible Node APIs.

## Non-goals

- Adding a generic browser-to-stdio bridge or accepting an arbitrary executable,
  argv, environment, or workspace path from browser input.
- Advertising ACP v2, remote ACP HTTP/WebSocket Agents, client-owned filesystem
  or terminal capabilities, session load/resume, or multi-turn chat in this
  first integration.
- Treating ACP Tool Calls as proof that a Harness `require tool` contract was
  materialized.
- Replacing AG-UI as the browser transport, changing saved historical Session
  ownership, or adding workspace restoration/replay semantics.
- Changing the existing Qoder/Pi adapters, supported-host claims, release notes,
  versions, or changelog.

## Plan and Tasks

1. Add a prompt-only `@harness/adapter-acp` descriptor and an ACP v1 executor
   backed by the official TypeScript SDK. Use `node:child_process.spawn` with an
   argv array and Web Stream adapters for stdio.
2. Map ACP message chunks, Tool Calls, prompt completion, permission
   requests, and cancellation onto the neutral Harness run lifecycle plus a
   bounded protocol-evidence event.
3. Extend the AG-UI projection/store with namespaced ACP evidence while keeping
   existing AG-UI event behavior backward compatible.
4. Add an optional Studio ACP configuration, run/permission/cancel routes, and a
   per-run server registry that owns pending permission promises and abort state.
5. Add an ACP runtime choice and live permission/cancel/raw-evidence controls to
   the existing Debugger composer and State Inspector using shared design tokens.
6. Configure the repository-local workspace launcher for the installed
   `codex-acp` command without making the published server auto-execute discovered
   binaries.
7. Add deterministic fixture-Agent tests, then exercise the built Studio at
   wide, compact, and narrow widths with console/page-error and screenshot checks.

## Test and Review Evidence

- AC-2/AC-3/AC-5/AC-6: focused `@qoder-ai/harness` tests using a deterministic
  ACP fixture process, plus adapter-registry and redaction assertions.
- AC-2/AC-3: `@qoder-ai/harness-ui` translator/store tests for ACP protocol
  evidence and unchanged core AG-UI ordering.
- AC-1/AC-4/AC-5: Harness Studio server tests with an injected ACP command and
  same-origin permission/cancel requests.
- AC-1 through AC-5: built-app Playwright flow covering Agent selection, live
  updates, permission choice, cancellation, real Raw ACP metadata, keyboard
  focus, bounded overflow, and no browser console/page errors.
- Package gates: focused typecheck/tests first, then package tests, root tests,
  `git diff --check`, the Markdown doc-link test, and the required preview health
  and `/canvas-module.js` smoke checks.
- Risk: an ACP Agent is a real coding process. The executable is server-configured,
  the workspace root stays server-owned, browser requests are same-origin, no
  client filesystem/terminal capability is advertised, and permissions default
  to cancelled on every incomplete decision path.
- Risk: protocol projection can overclaim raw fidelity. Each retained protocol
  item records whether it is a client request or Agent notification and contains
  the real ACP method/payload observed at that boundary; semantic AG-UI projection
  remains a separate view.

### Implemented evidence

- `npm test --workspace @qoder-ai/harness`: 20 files and 165 tests passed before
  the final missing-command/redaction additions; the final focused ACP suite
  passed 4/4.
- `npm test --workspace @qoder-ai/harness-ui`: 3 files and 30 tests passed.
- Focused Studio ACP server/store checks passed 3/3; the ACP browser check passed
  at 1440×900, 1024×768, and 390×844 with no horizontal overflow, console error,
  or page error.
- `npm run typecheck` passed for `@qoder-ai/harness`,
  `@qoder-ai/harness-ui`, and `@qoder-ai/harness-studio`; `git diff --check`, the
  focused doc-link graph test, and the public plugin-manifest test passed.
- The existing preview process answered `200` for `/health` and
  `/canvas-module.js` (`application/javascript`).
- A live `codex-acp` 0.12.0 smoke at the built Debugger completed with
  `ACP_READY`, zero Tool Calls, and ten observed ACP frames. The local Codex
  config's `service_tier="default"` is not accepted by that ACP binary; the
  smoke used server-owned argv overrides for `service_tier="fast"` and
  `model="gpt-5.4"` without editing the user's config.
- Known unrelated gates: the full Studio suite has two existing Artifact
  renderer expectation failures (DOCX/XLSX Studio fallback versus provisioned
  Qoder Canvas); the root suite initially failed only because the local npm
  mirror URL entered the new SDK lock entry, which was normalized to npmjs and
  its focused manifest gate then passed.

### Review Readiness Check

- Story: none supplied; this dated maintenance feature spec is the visible
  intent and acceptance owner.
- Spec/tests/risk: present in this document and backed by focused executor,
  translation, store, server, browser, type, and live-runtime evidence above.
- Changed modules: Harness adapter/executor, Harness UI protocol projection,
  Studio server/configuration, Debugger UI, launcher/CLI, tests, and lockfile.
- Generated files: only `package-lock.json` is part of the source diff; compiled
  `dist` output and Playwright screenshots remain ignored validation artifacts.
- Staged split: no files are staged. The working tree also contains a separate
  in-progress Artifact workspace change that overlaps Studio shell/server/style
  files; ACP work was not committed or staged across that user-owned boundary.
- AI marker: no commit exists for this local diff, so there is no commit-level AI
  marker to review yet.
