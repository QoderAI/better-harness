# Synchronize hosted Artifact selection with Collaboration

## Traceability

- Spec ID: studio-artifact-surface-selection
- Status: Implemented
- Builds on: `studio-agentic-artifact-interaction`

## Intent

Make the hosted Artifact itself a semantic selection surface. A Provider-owned
opaque iframe may publish one address observation for the exact Artifact
revision and surface binding that Studio mounted. Studio validates the frame
source and identity, then resolves the address against the current interaction
workspace before changing Collaboration state.

The event is an observation only. It carries no proposal continuation, decision
identity, filesystem path, approval token, or mutation authority.

## Acceptance Scenarios

- **AC-1:** The public Artifact contract defines a versioned hosted-selection
  event containing only Artifact id, exact revision, surface binding id, and a
  bounded semantic address.
- **AC-2:** `ExternalHostedArtifactView` accepts an event only from its mounted
  iframe and only when every identity field matches the current
  interaction-capable descriptor. Wrong revision, wrong binding, empty or
  oversized address, non-interactive Artifact, and unrelated window messages
  are ignored.
- **AC-3:** Collaboration resolves the published address against the current
  workspace targets. A valid Viewer selection updates the semantic target;
  unknown addresses cannot become proposal targets. Manual dropdown selection
  remains available and uses the same shared state.
- **AC-4:** Refreshing the same Artifact after Apply preserves the selected
  stable address when it remains present in the authoritative revision. A
  prepared or settled proposal is not silently retargeted by later iframe
  events.
- **AC-5:** The Draw.io hosted Viewer emits stable `drawio://` addresses from
  explicit outline cell clicks. The real browser flow proves clicking a Viewer
  node updates Collaboration before steering, with zero document overflow and
  zero captured console/page error.

## Non-goals

- Treating an iframe event as approval or write authority.
- Guessing semantic identity from coordinates or pixels.
- Generic canvas hit-testing, official draw.io internal event patching, hover
  synchronization, multi-selection, presence, or CRDT collaboration.
- Enabling interaction for Providers that do not advertise an interaction
  runtime.

## Plan

1. Add the portable event contract and Host-side exact-binding validator.
2. Lift shared selection through Artifact View and Collaboration without
   moving proposal authority into the iframe.
3. Embed stable addresses in the Draw.io hosted document and publish them from
   explicit semantic outline clicks.
4. Add focused tests, real cross-repository Browser evidence, and current
   verification records before changing this spec to Implemented.

## Evidence

- Core `@qoder-ai/harness`: Node 24 build and 20 files / 173 Vitest;
  dry-run pack 149051 B / 640903 B / 143 entries.
- `@qoder-ai/harness-studio`: Node 24 typecheck/build and 62 files / 491
  Vitest; focused hosted-selection and interaction routes 2 files / 28 tests;
  dry-run pack 6968575 B / 37982755 B / 1146 entries.
- Focused `oxlint` and both repositories' `git diff --check` passed.
- Real in-app Browser against the cross-repository Studio Host clicked the
  Draw.io outline target `Orders`; Collaboration selected the exact
  `drawio://complex-features.drawio/page/rich/cell/orders-swimlane` address
  without using its dropdown. `Approve once` advanced `b0340ff4…08ddf5` to
  `5666866e…a577c6`, rendered `Surface-selected Orders`, retained the same
  stable address, and displayed authoritative readback evidence.
- 1440×900, 1024×768, and 390×844 screenshots were inspected in the
  Structurizr verification workspace at
  `.verification/agentic-artifact-surface-selection-{wide,compact,narrow}.png`;
  all had document/body scroll width equal to viewport width and the browser
  captured zero warning/error console entries.
