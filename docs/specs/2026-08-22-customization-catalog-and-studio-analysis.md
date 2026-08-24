# Customization catalog and Studio analysis

## Traceability

- Spec ID: customization-catalog-and-studio-analysis
- Status: Implemented

## Intent

Introduce a public, versioned customization catalog that distinguishes reusable
definitions from Plugin installation, Host exposure, MCP registration, and the
runtime observations the current collectors can actually produce. Harness
Studio should collect Codex, Claude, and Qoder customizations only after the user
explicitly requests analysis, then render a browser-safe projection without
duplicating Host discovery logic in the React application. V1 must not reserve
public Kind variants, relationship graphs, or protocol objects without both a
concrete producer and a current consumer. Existing dependency-free
`scripts/agent-customize/*.mjs` consumers must continue to work.

## Acceptance Scenarios

- AC-1: `@qoder-ai/harness` exports a `better-harness.customization/v1`
  discriminated model covering Plugin packages, installations, definitions,
  Host exposures, MCP registrations, and observed Host/MCP runtime evidence.
- AC-2: The V1 definition union contains only the six Kind-specific contracts
  currently produced by the shared collectors: Instruction, Agent Skill,
  Prompt Command, Agent Definition, Hook, and MCP Server Definition.
- AC-3: Studio exposes an explicit Analyze action for the selected local
  workspace, or the launch working directory when none is selected. No
  customization Home-directory collection runs while loading Studio, opening a
  workspace, or reading a previously completed result.
- AC-4: One Analyze request collects Codex, Claude, and Qoder independently;
  one Host failure produces a diagnostic while successful Host results remain
  visible.
- AC-5: The browser response contains no absolute filesystem paths, environment
  values, raw Hook commands, raw MCP arguments, authorization values, or Memory
  contents.
- AC-6: A physical definition observed by more than one Host is represented once
  with multiple Host exposures. A Plugin package and its Host installation are
  separate records.
- AC-7: A configured MCP Server is represented as a registration. Runtime
  discovery is emitted only when collector evidence exists and does not claim
  that cached capabilities are currently connected or exposed to a model.
- AC-8: The existing `scripts/agent-customize/cli.mjs` help and inventory paths
  remain directly runnable with Node and do not import Harness Studio or require
  a workspace package build.
- AC-9: Studio model/server tests cover idle, running, success, partial failure,
  privacy, and concurrent-analysis behavior; browser evidence covers the
  changed surface at wide, compact, and narrow widths with no console errors or
  horizontal page overflow.
- AC-10: Studio exposes Definition and Installation detail views. The latter
  shows the package, Host, scope, install source, enablement, applicability, and
  browser-safe source for every collected installation instead of transferring
  rich installation records only to render aggregate counts.
- AC-11: The V1 browser catalog does not contain a generic relationship graph,
  zero-producer Workflow/Execution Policy/Memory variants, or MCP Resource,
  Resource Template, and Prompt descriptors that the current collector cannot
  emit.

## Non-goals

- Replacing or deleting the existing provider collectors in this first version.
- Reading or displaying Memory entry bodies.
- Connecting to MCP Servers, refreshing credentials, invoking MCP primitives,
  or treating a Host cache as proof of a current protocol connection.
- Parsing arbitrary Workflow files into executable graphs.
- Reserving Workflow or Execution Policy as public V1 Kinds before a collector
  exists, or treating instruction-like files as either one without authority.
- Modeling Memory stores or entries before a metadata-only collector and an
  approved Studio consumer exist.
- Modeling MCP Resources, Resource Templates, or Prompts before live/cache
  discovery supplies those descriptors.
- Shipping a generic relationship graph before Studio or another committed
  consumer requires graph traversal. Direct foreign keys remain sufficient for
  Package, Installation, Exposure, Registration, and Discovery in V1.
- Editing, installing, enabling, or disabling discovered customizations.
- Making Qoder Canvas the authority for collection or normalization; Canvas may
  consume the resulting public catalog later as a renderer.
- Adding support for another Coding Agent Host.

## Plan and Tasks

1. Add the minimal public V1 catalog and six produced Kind-specific TypeScript
   contracts under `packages/harness/src/customization/`, with deterministic
   identity helpers, validation, summary, and a package export.
2. Add a Studio-owned collector boundary. Its default packaged implementation
   reuses a server-only bundle of the dependency-free `agent-customize` runtime;
   tests and embedders may inject a collector without accessing user Home data.
3. Normalize legacy provider inventories on the Studio server, deduplicate
   definitions by server-private resolved source identity, and emit only opaque
   evidence references plus safe display paths.
4. Add same-origin, on-demand analysis routes with an in-memory result scoped to
   the selected or launch workspace and an isolated per-Host failure model.
5. Add a docked Customizations surface with one Analyze action, Host status
   rows, Definition and Installation detail views, Kind counts, and explicit
   configured-versus-runtime wording.
6. Preserve the `.mjs` CLI public path and verify both package and script lanes.

The public model belongs to Harness because collection and presentation need a
shared boundary, but its V1 scope is justified by the current script producer
and Studio consumer only. Collection policy and Home-directory access belong to
the Studio server. The React application receives only the safe catalog.

## Test and Review Evidence

- AC-1, AC-2, AC-6, AC-7, AC-11: `npm test -w @qoder-ai/harness` with focused
  customization model tests.
- AC-3, AC-4, AC-5, AC-7: `npm test -w @qoder-ai/harness-studio` with focused
  collector and server route tests.
- AC-8: focused root tests for `agent-customize` plus direct
  `node scripts/agent-customize/cli.mjs --help` smoke evidence.
- AC-9, AC-10: Playwright against the built Studio at 1440x900, 1024x768, and 390x844;
  inspect console and page errors and retain screenshots under test results.
- Cross-platform review: use `node:path` for native paths, POSIX paths only for
  portable source references, no shell command interpolation, and no `/tmp` or
  separator assumptions in implementation or fixtures.
- Risk review: inspect the serialized browser response for private workspace and
  Home roots, known secret fixtures, Hook command payloads, and raw MCP
  configuration values.

Implemented evidence on 2026-08-22:

- `npm test -w @qoder-ai/harness`: 19 files and 161 tests passed after the
  generated-source gate.
- `npm test -w @qoder-ai/harness-studio`: 34 files and 205 tests passed.
- Focused root compatibility tests: 3 files and 103 tests passed; direct
  `node scripts/agent-customize/cli.mjs --help` exited successfully.
- Playwright customization coverage passed for both Definition and Installation
  detail views at 1440x900, 1024x768, and 390x844 with no console/page errors or
  document overflow.
- Package dry runs include the Harness customization entrypoint and the Studio
  server-only MJS runtime; the Studio package contains no runtime sourcemap.
- A real Studio server request returned 287 definitions, 45 packages, 49
  installations, and 12 MCP registrations across Codex, Claude, and Qoder. The
  browser-safe V1 document contained exactly six Definition Kind buckets, no
  generic relationship graph, no serialized Home root, and no raw collector
  fields.
