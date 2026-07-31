# Report Routing WorkBuddy Host Gap

Add WorkBuddy to the Portable HTML report route in
`templates/reporting/routing.md` and add a derived consistency test so a
future host with portable HTML output cannot be omitted from report routing
again.

## Traceability

- Spec ID: 2026-07-30-routing-workbuddy-host
- Story: follow-up to the WorkBuddy host adapter (`4b871d9`,
  CHANGELOG 0.4.0)
- Status: Implemented

## Intent

The WorkBuddy host adapter shipped with a `self-contained HTML + Markdown`
Default Output claim in the [Host Adapter Matrix](../adapters/README.md), and
the matrix Output Modes section, the docs site (English and zh-Hans), and
CHANGELOG 0.4.0 all state that WorkBuddy portable HTML routing is
implemented. However, the Portable HTML report route in
[`templates/reporting/routing.md`](../../templates/reporting/routing.md)
still lists only "Claude Code, Codex, Cursor, Qwen Code, GitHub Copilot, or
Pi". Because `routing.md` is the routing switchboard agents load through
`SKILL.md`, an agent running on WorkBuddy is never routed to the portable
HTML report.

The omission survived because the two guarding assertions
(`test/better-harness-skill.test.mjs`, `test/style-templates.test.mjs`)
hard-code the host list, and the A-06 support-declaration consistency tests
(`test/support-declarations.test.mjs`) never compare the adapter matrix
against `routing.md`.

## Acceptance Scenarios

- AC-1: The Portable HTML report row in `templates/reporting/routing.md`
  lists WorkBuddy alongside the existing hosts; no other route changes.
- AC-2: The hard-coded routing assertions in
  `test/better-harness-skill.test.mjs` and `test/style-templates.test.mjs`
  match the updated host list.
- AC-3: `test/support-declarations.test.mjs` gains a derived check: every
  adapter-matrix host whose Default Output cell claims
  `self-contained HTML + Markdown` must appear as an exact host entry in the
  Portable HTML report route of `routing.md`. A prefix collision such as
  `WorkBuddy` versus `WorkBuddy Enterprise` must fail. The check is
  one-directional so a host may be removed from the matrix claim first (as the
  in-flight A-05 change does for Cursor) without breaking routing.
- AC-4: `npm test` passes; `node --test test/doc-link-graph.test.mjs` passes
  with this spec's links resolving.

## Non-Goals

- No change to the Cursor entries in `routing.md` or the adapter matrix; the
  Cursor durable-report gap stays tracked by the in-flight A-05 pull request
  and roadmap item HA-03.
- No new WorkBuddy capability, output mode, or renderer change; this only
  routes the already-shipped portable HTML output.

## Plan

1. Add WorkBuddy to the Portable HTML report row in
   `templates/reporting/routing.md`.
2. Update the two hard-coded host-list assertions to match.
3. Add the derived matrix-to-routing consistency test to
   `test/support-declarations.test.mjs`, parsing the route declaration into
   normalized host entries and covering a host-prefix collision.

## Test Evidence

- `node --test test/support-declarations.test.mjs`
- Mutation regression: replacing the exact `WorkBuddy` route entry with
  `WorkBuddy Enterprise` must report WorkBuddy as missing.
- `node --test test/better-harness-skill.test.mjs`
- `node --test test/style-templates.test.mjs`
- `node --test test/doc-link-graph.test.mjs`
- Full suite: `npm test`
