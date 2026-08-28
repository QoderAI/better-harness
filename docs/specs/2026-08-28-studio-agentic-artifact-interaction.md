# Add a Host-owned Agentic Artifact interaction loop

## Traceability

- Spec ID: studio-agentic-artifact-interaction
- Status: Implemented
- Architecture input: `docs/adrs/studio-artifact-runtime-and-providers.md`
- Depends on: `studio-external-artifact-provider-runtime`,
  `studio-artifact-view-host-lifecycle`, and Homology Artifact Surface v1

## Intent

Extend Harness Studio from a read-only Artifact viewer into a bounded shared
work surface where a human and a Provider-supplied Agent capability can observe
the same exact Artifact revision, address one semantic target, record steering,
review a content-addressed proposal preview, and settle that proposal through a
Host-owned approval gate.

The Host remains the authority for routing, same-origin access, proposal
lifetime, and the single decision entrypoint. The selected Provider remains the
authority for format-specific addressing, proposal construction, mutation,
validation, CAS, and authoritative readback. The opaque hosted iframe remains a
renderer only and cannot approve or directly invoke mutation.

This is an additive `artifact-interaction-v1` extension to the external
Artifact Provider contract. Existing Provider v1 contributions remain
read-only and unchanged when they do not declare the extension.

## Acceptance Scenarios

- **AC-1:** The public Provider contract defines an optional, versioned
  interaction runtime with browser-safe workspace, target, proposal, preview,
  decision, receipt, diagnostic, and evidence projections. Registry resolution
  preserves the exact selected implementation and includes its identity in the
  Surface binding identity and catalog revision. Contributions without the
  extension behave exactly as before.
- **AC-2:** `GET interaction`, `POST proposals`, `GET proposal preview`, and
  `POST decisions` routes resolve the same opaque Artifact id, exact source
  revision, Provider fingerprint, and contribution selected by the catalog.
  Requests are same-origin, bounded, strict, and path-free. Proposal state is
  bounded and expires; changing the selected Provider or Artifact revision
  invalidates it.
- **AC-3:** Preparing a proposal records one selected semantic address and one
  steering instruction without mutating source state. The response shows Agent
  intent, proposed actions, expected revision, digest, validation claims, and a
  content-addressed preview served by the Host. A preview digest mismatch fails
  closed.
- **AC-4:** Only the Host decision route may call Provider mutation. Approval is
  bound to proposal id, proposal digest, expected revision, decision id, and
  human actor. Reject performs zero source writes. A stale source returns
  `stale` and does not overwrite newer work. Replaying an identical decision
  returns the same terminal receipt and does not execute twice; a conflicting
  decision fails closed.
- **AC-5:** An applied receipt is emitted only after Provider-owned CAS,
  authoritative readback, and passed verification. The receipt exposes before
  and after revisions, status, bounded diagnostics, evidence references, and
  affected semantic addresses. Studio refreshes the catalog and rendered
  Artifact to the authoritative revision after apply.
- **AC-6:** The Artifact workspace exposes a docked Collaboration pane for
  interaction-capable Artifacts. It makes selected target, steering, proposal
  changes, preview, decision state, and receipt visible. Before proposal there
  is one primary `Prepare change` action; after proposal there is one primary
  `Approve once` action with secondary `Reject`. Loading, stale, failed,
  rejected, and applied states remain explicit and keyboard/focus accessible.
- **AC-7:** The first real Provider bridge is Draw.io. It lists stable
  `drawio://` page/cell addresses and maps the bounded steering form
  `Rename to <label>` to one `set-label` command through Homology Artifact
  Surface v1. It supplies the exact proposed Draw.io source as preview, uses
  source-digest CAS, and returns validation/readback evidence. It does not claim
  arbitrary natural-language planning or general Draw.io editing.
- **AC-8:** Focused contract, registry, discovery, route, Provider, and browser
  tests cover the full prepare/preview/reject/approve/stale/replay loop. Studio
  typecheck/build/tests and Draw.io package tests pass under supported Node 24.
  Wide `1440x900`, compact `1024x768`, and narrow `390x844` screenshots show no
  document horizontal overflow, no clipped decision controls, and zero captured
  console or page errors.

## Non-goals

- A universal Artifact IR, a universal model loop, or format-specific mutation
  logic inside Harness Studio.
- Allowing hosted iframes to call the decision route, access filesystem paths,
  choose a Provider, or receive a write capability.
- Free-form Draw.io generation, style/move/connect UI, multi-target editing,
  retained branches, CRDT collaboration, cross-process durable proposal state,
  or distributed CAS/ledger semantics.
- DSH approval UI, Better Harness ACP model invocation for proposal generation,
  remote or multi-tenant sandbox certification, undo, publication, or release
  certification.

## Plan and Tasks

1. Add the optional interaction runtime and browser wire contracts, then bind
   interaction identity into Provider validation, registry resolution, and the
   renderer binding digest.
2. Add bounded Host proposal state and same-origin exact-revision interaction
   routes with strict body parsing, preview digest checks, terminal receipt
   replay, and bounded errors.
3. Add a docked Collaboration pane to the Artifact workspace and refresh the
   exact Artifact after a verified apply.
4. Bridge the Homology Draw.io contribution to Artifact Surface v1 with a
   host-selected local file store, stable semantic targets, bounded rename
   planning, preview projection, decision mapping, CAS, and readback evidence.
5. Add focused tests, run supported-Node package/full validation, capture
   wide/compact/narrow browser evidence, and update this document only with
   commands and results that actually occurred.
6. Run Change Traceability Review in Review Readiness mode over the final local
   diff and close every AC or leave the spec in Draft with explicit blockers.

## Test and Review Evidence

- Node 24.15.0 `npm test -w @qoder-ai/harness -- --maxWorkers=1` passed
  20 files / 173 tests. `npm test -w @qoder-ai/harness-studio --
  --maxWorkers=1` passed 62 files / 490 tests after a successful Studio
  typecheck and production build. The focused interaction server test also
  passed with concurrent identical decisions and asserted one Provider
  execution, one replay, conflicting-decision rejection, reject with zero
  write, stale, preview CSP, and cross-origin rejection.
- The Harness and Studio dry-run packs completed through their prepack gates:
  148830/640108 B/143 entries and 6966318/37970934 B/1146 entries.
- In `structurizr4js`, the integration Provider build and 5 files / 28 tests
  passed. Focused `oxlint` reported zero warnings; its dry-run pack was
  2939480/11137759 B/21 entries. Node 26.7 root build plus four-worker Vitest
  passed 254 files / 2185 tests with 1 skipped. Package naming passed for 88
  packages / 86 workspaces / 2 exceptions / 12 families, 100 scripts, and
  2761 tracked / 233 allowlisted / 0 machine-local paths.
- The real cross-repository Host smoke selected
  `drawio://complex-features.drawio/page/rich/cell/runtime-group`, proved
  prepare and reject made zero writes, applied `bb301843…e133031e` to
  `b0340ff4…d608ddf5`, returned passed verification with one authoritative
  readback evidence item, replayed the terminal decision, and observed the
  catalog converge to the receipt revision. Existing external and native
  Artifact routes remained HTTP 200.
- In the in-app Browser, a real proposal changed `Visible Agentic UI` to
  `Observable Agentic UI`. The exact Draw.io Viewer and semantic target moved
  from `2c48d910…e208f4` to `862f057d…1f82ff`; the proposal, before/after
  revision, authoritative evidence, and terminal receipt remained visible
  after catalog refresh. This check first exposed a receipt-reset bug; the pane
  now preserves terminal state for the same Artifact id and offers an explicit
  `Prepare another change` reset.
- Screenshots
  `.verification/agentic-artifact-studio-{wide,compact,narrow}.png` cover
  1440x900, 1024x768, and 390x844. All three had zero document/body horizontal
  overflow, zero captured console warning/error, a scrollable Collaboration
  pane, and reachable decision controls; the narrow image shows both Approve
  once and Reject in the viewport.
- `git diff --check` passed in both repositories. No commit or push was made.

## Traceability Review

| Acceptance | Implementation and verification |
| --- | --- |
| AC-1 | Optional public interaction contract, registry validation, binding identity, catalog reference, and unchanged absent-extension behavior; core and Studio suites passed. |
| AC-2 | Exact-revision same-origin Host routes, strict bounded bodies, bounded TTL proposal state, Provider fingerprint/contribution reauthorization; focused server tests passed. |
| AC-3 | Provider prepare is read-only, proposal/preview digests are recomputed by the Host, and preview bytes are rechecked when served; Provider tests and cross-repository smoke passed. |
| AC-4 | Human-only digest/revision-bound decisions, Host-owned concurrent settlement, reject/stale/replay/conflict semantics; focused concurrent test and real smoke passed. |
| AC-5 | Applied receipt requires revision advancement, passed verification, evidence, Provider CAS/readback, catalog refresh, and exact Viewer convergence; real smoke and Browser flow passed. |
| AC-6 | Docked responsive Collaboration pane exposes shared selection, steering, proposal, preview, decisions, receipt, errors, and reset; three viewport checks passed. |
| AC-7 | Draw.io bridge uses stable addresses, bounded rename grammar, Homology Artifact Surface v1, selected-page SVG preview, local source CAS, and authoritative readback; 28 Provider tests and real Host smoke passed. |
| AC-8 | Focused/full tests, builds, packs, root regression, package naming, cross-repository Host smoke, and wide/compact/narrow Browser evidence all passed. |

Review Readiness result: no open P1/P2 traceability finding remains for AC-1
through AC-8. The non-goals below remain deliberately unsupported rather than
being inferred from the Draw.io reference.

### Risks

- **Authority drift:** rediscovery must not pair a pending proposal with a new
  Provider fingerprint, contribution, or revision.
- **Double execution:** both Host proposal state and Provider decision handling
  must make identical replay safe and conflicting decisions fail closed.
- **Filesystem races:** the Draw.io store must reject linked/non-regular files,
  compare the exact expected digest at write time, and perform authoritative
  readback before reporting `applied`; this increment does not claim
  cross-process transactional locking.
- **Preview confusion:** proposed bytes are non-authoritative until approval and
  must never replace the active Artifact catalog revision early.
- **Responsive density:** the Collaboration pane must collapse into the narrow
  Preview flow without turning the workbench into stacked dashboard cards.
