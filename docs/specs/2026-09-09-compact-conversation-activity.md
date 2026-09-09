# Compact conversation activity

## Traceability
- Spec ID: compact-conversation-activity
- Status: Implemented

## Intent
Make the shared Compare, Debugger and Memory transcript easier to scan, using
the user's supplied conversation screenshot as the visual reference. Reduce
repeated chrome and collect consecutive thinking/tool events between prose.

## Acceptance Scenarios
- AC-1: User and assistant prose remain visible in chronological order without
  repeated visual role labels or full-width separators between every event.
- AC-2: Consecutive thoughts/tools form a collapsed activity disclosure with
  observed operation counts, visible running/failure/interruption indicators,
  and a file reference when available. Expanding exposes every original item.
- AC-3: Keyboard disclosure and manual expansion survive streaming and view
  switches. Compare file navigation opens the parent group and focuses the
  correct tool. Permissions remain visible outside collapsed groups.
- AC-4: Shared rows and prompt input use compact semantic metrics. Wide,
  compact and narrow layouts preserve focus, bounded overflow, readable text,
  touch targets, and both themes without browser errors.

## Non-goals
No protocol changes, inferred tool successes, filesystem access, new dependency,
application-internal inspection, release packaging, or changes to other work.

## Plan and Tasks
1. Add a pure chronological activity grouping and summary projection.
2. Render persistent disclosures in the shared ACP transcript, preserving
   individual tool expansion and explicit file navigation.
3. Tighten shared message, disclosure and input spacing using existing tokens.
4. Test grouping, streaming/reveal behavior, scroll restoration, permissions,
   and representative layouts in real browser fixtures.

## Test and Review Evidence
- AC-1/2: `conversation-activity.test.ts` checks chronology, stable group keys,
  complete item retention, observed kinds/paths and non-success states. The
  focused six-suite Vitest run passed 33 tests.
- AC-3/4: 29 browser scenarios passed across conversation, session stream,
  session controls, Debugger, Compare workspace and Memory. The new gated
  activity scenario verifies live failure/running summaries, permission access,
  expansion across appended results and navigation, and nested file reveal.
  Existing long-transcript tests retain 253 entries and reading position.
- Screenshots reviewed at 1440×900, 1024×768 and 390×844, including light/dark
  themes, collapsed activities and expanded tool results. Six tool calls plus
  one thought occupy a single 28px activity row at desktop width. Touch layouts
  retain 44px controls and wrap the file reference. Screenshot receipts are in
  the session's external `compact-activity` visualization directory.
- Studio TypeScript/application build passed. Doc graph regeneration had no
  generated diff and all eight doc-link checks passed. Canvas preview served
  HTTP 200 from `/health` and `/canvas-module.js` on port 58575.
- Independent desktop smoke passed with the native Rust NSXPC transport,
  sandboxed renderer, authorized HTTP access, no errors and clean shutdown.
  This is local macOS evidence; installed release and native Windows/Linux
  verification were not performed.

Review readiness: this user-requested maintenance has no linked Story. Changes
are confined to shared transcript presentation, localized labels, the fixture,
and behavior tests; prior Compare/Memory changes remain in the same unstaged
worktree. No release metadata, commit or push is included. AI involvement is
explicit in this Codex session. Group/manual expansion stops automatic following
before resizing; original tool identities and permission authority are retained.
The supplied screenshot is the reference; the computer tool denied opening the
reference application, so its live behavior has not been inspected.
