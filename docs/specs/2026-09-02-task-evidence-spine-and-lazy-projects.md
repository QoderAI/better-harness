# Task evidence spine and lazy projects

## Traceability

- Spec ID: `2026-09-02-task-evidence-spine-and-lazy-projects`
- Status: Implemented
- Extends: `2026-09-01-organization-harness-dashboard`
- Extends: `2026-09-02-local-multi-project-dashboard`

## Intent

Make the Harness Dashboard tell the smallest credible organization-level story:
which task was accepted, which execution and Harness assets can be linked to it,
which change evidence was retained, and whether acceptance was observed. Keep
usage and activity charts as supporting evidence rather than replacing them
with prose.

The same change makes explicitly configured projects independent collection
units. The server lists project identities without collecting every repository,
then collects and caches only the selected project. A slow or failing project
must not prevent the other configured projects from opening.

`scripts/session-analysis/` remains the canonical Session evidence owner.
`scripts/task-evidence-upload/` remains the Task Evidence contract owner, and
Harness UI remains a read-only projection of those contracts.

## Acceptance Scenarios

- **AC-1 — Backward-compatible task relationships:** Task Evidence input and
  packet contracts accept an optional `links` object containing a project
  reference plus bounded Session, commit, and artifact reference lists. Values
  pass through the existing privacy sanitizer. Packets without `links` remain
  valid and their integrity checks are unchanged.
- **AC-2 — Honest task evidence spine:** each received packet is projected into
  five compact stages: task defined, execution linked, Harness assets observed,
  change or artifact evidence observed, and acceptance observed. Missing links
  display as `Unobserved`; receipt acceptance is not presented as task success,
  and asset outcomes are not presented as configured-asset inventory.
- **AC-3 — Evidence detail without dashboard clutter:** the Task Evidence pane
  leads with one selected packet and its spine. Packet selection is keyboard
  reachable, while acceptance, asset, observation, privacy, and digest detail is
  available through one native disclosure. Existing usage, Skill, MCP, token,
  and model charts remain present and continue to use the existing projections.
- **AC-4 — On-demand project collection:** the initial page resolves every
  configured project identity but collects only the first project. Selecting an
  uncached project requests that project by opaque id, and selecting a cached
  project does not issue another request inside the refresh window.
- **AC-5 — Project-local failure and retry:** collection caches are isolated by
  project id. A failed collection is not cached, the selected project reports a
  bounded error without exposing its path, and Retry attempts only that project.
- **AC-6 — Responsive and accessible evidence:** wide, compact, and narrow
  layouts have no document-level horizontal overflow. Project and packet
  selectors, Retry, disclosure, and chart controls expose visible keyboard
  focus; loading and failure changes are announced; browser console and page
  error collections remain empty.

## Non-goals

- Remote ingestion agents, machine registration, clone identity, Session
  de-duplication across machines, or organization-wide aggregation.
- Authentication, role-based access, cost allocation, policy enforcement, SLOs,
  or promotion workflows.
- Inferring Task-to-Session, Task-to-commit, or Task-to-artifact links from
  timestamps or prose. Links must be supplied as evidence.
- Adding Session bodies, prompts, tool payloads, absolute paths, or credentials
  to Task Evidence packets.
- Replacing Recharts activity visualizations or changing their measurement
  semantics.

## Plan and Tasks

1. Extend the Task Evidence contract with optional, bounded, sanitized links and
   cover packet creation, validation, privacy, and old-packet compatibility.
2. Project each packet into a five-stage evidence spine with explicit observed,
   failed, and unobserved states plus compact disclosed detail.
3. Split project discovery from collection, add one timed cache per opaque
   project id, and expose a server route that resolves only configured ids.
4. Update the client to load projects on selection, retain successful client
   snapshots, isolate failures, and expose Retry and live status semantics.
5. Add contract, model, loader, and browser tests; verify build plus wide,
   compact, and narrow screenshots after integrating the default branch.

## Test and Review Evidence

- **AC-1:** `test/cli/task-evidence-upload.test.mjs` validates bounded link
  projection through packet and plan integrity, including path redaction. The
  existing packet/store tests continue to accept packets without `links`.
- **AC-2, AC-3:** `packages/harness-ui/test/dashboard-model.test.mjs` checks the
  five projected stages against real contract builders. The browser suite checks
  the visible spine, honest receipt copy, and keyboard disclosure while keeping
  the existing activity charts reachable.
- **AC-4, AC-5:** `packages/harness-ui/test/local-data.test.mjs` verifies opaque
  project discovery and independent keyed caches, including retry of only the
  failed key. The browser suite configures two projects, observes one project API
  request on first selection, then verifies that returning to the first project
  uses its retained client snapshot.
- **AC-6:** Playwright passes at 1440x900, 1024x768, and 390x844 with no page
  overflow, console errors, page errors, failed requests, or error responses.
  The test drives project selection, Task Evidence disclosure, chart controls,
  chart focus, and the operational evidence disclosure.
- **Commands:** `npx vitest run test/cli/task-evidence-upload.test.mjs` passes
  19 tests; `npm test -w @qoder-ai/harness-ui` passes 40 tests with the package's
  15-second integration-test bound; `npm run build -w @qoder-ai/harness-ui` succeeds with the 13
  existing dynamic-filesystem tracing warnings; and the doc-link graph suite
  passes 8 tests.
- **Risk:** references remain explicit input rather than inferred correlation,
  and project ids remain local path-derived identities. Machine identity,
  cross-machine de-duplication, authorization, and organization aggregation stay
  outside this POC and must not be inferred from the project selector.
