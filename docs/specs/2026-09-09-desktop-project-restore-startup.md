# Restore Projects without automatic scanning

## Traceability
- Spec ID: desktop-project-restore-startup
- Status: Implemented; local verification complete

## Intent
`npm run better-harness-desktop:dev` fails with `Studio service startup timed out`
when restoring the remembered Project takes longer than the desktop's 30-second
startup deadline. Restore only the Project identity and local directory. A shared
Scan Project action in the left sidebar explicitly refreshes Project evidence.

## Acceptance Scenarios
- AC-1: Startup restores the active Project without invoking Session discovery,
  Git history, artifact discovery, or customization collection. A missing local
  directory remains unavailable; stale counts are not presented as current data.
- AC-2: A sidebar Scan Project action refreshes Sessions, Git/checkpoint evidence,
  observed artifacts, and available customization inventory (Skills, MCP, hooks,
  and plugins) together, then refreshes all Project views.
- AC-3: Scanning shows a busy state, rejects duplicate Project mutations, and
  preserves the previous snapshot on failure. Retry is available. Keyboard focus
  and bounded layout hold at wide, compact, and narrow widths.
- AC-4: The existing macOS user profile opens a Desktop window through the exact
  npm dev command; clean-profile smoke remains green.

## Non-goals
Session scanner optimization, global Memory collection, AI analyses or live agent
runs, deleting saved user state, changing native transports, release packaging,
installation, or publishing. Existing explicit open/switch behavior is retained.

## Plan and Tasks
1. Replace boot-time discovery with an empty, explicitly unscanned workspace.
2. Add a shared Project scan route using existing discovery/collection owners;
   publish its workspace and customization results together.
3. Add the sidebar action using existing semantic tokens and button conventions:
   click or Enter/Space scans, busy disables repeat actions, errors allow retry.
4. Add server and browser regressions, build Studio, run desktop smoke, and
   verify the npm dev launch against the remembered user profile.

## Test and Review Evidence
- Before change: interactive zsh/npm dev reaches ACP discovery and Evidence host
  readiness, then reports the 30-second Studio startup timeout during restoration.
- AC-1–AC-3: 23 focused Vitest cases passed across project restoration, project
  storage/routes, customizations, and session timing. The new restoration test
  proves zero boot collector calls, unified scan results, concurrent mutation
  rejection, failure rollback, retry, and unavailable-directory behavior.
- AC-3: six Playwright scan cases passed (three widths, light/dark), including
  keyboard activation, busy state, no view-triggered boot scan, and no page or
  console errors. Screenshots are under
  `packages/harness-studio/test-results/navigation-final/`.
- AC-4: the existing macOS profile opened in 1,973 ms, retained the active Project
  with `workspaceScanRequired: true`, and responded after 35 seconds with no
  page errors. Receipt: `packages/better-harness-desktop/dist/smoke-restored/receipt.json`.
  The exact `npm run better-harness-desktop:dev` command was also relaunched
  successfully and left running.
- Clean-profile desktop smoke passed with OXC, ACP, and Evidence using NSXPC,
  renderer sandbox/authentication, directory selection/cancellation, responsive
  layouts, and service shutdown. Receipt:
  `packages/better-harness-desktop/dist/smoke/receipt.json`.
- Studio and Rust builds, Rust suites, and eight documentation-link tests passed.
  Preview health and Canvas module returned HTTP 200 from the existing preview
  server; a second preview process correctly refused the occupied port.
- Review Readiness Check: maintenance work follows the explicit user request;
  no Story id was supplied. All implementation/test changes are unstaged and
  task-owned; no release metadata, commit, installation, or remote state changed.
  AI involvement is explicit in this working session. CI was not inspected.
- Risk: scanning remains potentially slow, but is explicitly user-triggered and
  no longer part of desktop startup. Windows/Linux require their CI receipts;
  portable server tests do not establish native-host success.
