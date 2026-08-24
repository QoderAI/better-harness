# Artifact provider SDK and Structurizr integration

## Traceability

- Spec ID: artifact-provider-sdk-and-structurizr
- Status: Implemented

## Intent

Expose the host-neutral Artifact descriptor, snapshot, and external Provider
contracts from `@qoder-ai/harness` so a repository can implement one Provider
without importing Studio server internals. Keep Studio responsible for catalog
HTTP routes, activation, provider selection, sandbox policy, and React UI. Prove
the boundary with a local Structurizr DSL Provider before publishing the SDK and
Studio packages.

## Acceptance Scenarios

- AC-1: `@qoder-ai/harness/artifacts` exports the Artifact wire model, source
  entry, adapter/runtime bindings, Provider contract, and an inference helper;
  the subpath imports no React or Studio server module.
- AC-2: Harness Studio consumes the shared contract without changing its V2
  catalog/snapshot wire format and accepts explicitly injected Providers through
  `HarnessStudioServerOptions`; fingerprint-bound activation remains required.
- AC-3: Studio's numeric source-file, source-byte, output-byte, and timeout
  budgets are an explicit host policy with bounded overrides. Effective limits
  participate in build/cache identity. Package imports remain restricted to the
  selected trusted build runtime.
- AC-4: Structurizr4js keeps its domain package and host-neutral
  `@homology/structurizr-artifact` projection independent of Harness, then
  provides an experimental-local `.dsl` Harness adapter using the published SDK
  shape. The adapter runs projection in a bounded child process and renders the
  generated SVG through Studio's common opaque-origin hosted surface. A
  cross-repository test exercises catalog, snapshot, resource, and viewer
  routes.
- AC-5: focused tests, package dry-runs, the serial Better Harness checks, and
  Structurizr provider tests pass before publication. Publication uses the
  repository's GitHub Actions workflow in dependency order for Harness, UI, and
  Studio; registry reads and a clean-consumer install verify the released
  versions separately from local tests.

## Non-goals

- Moving `ArtifactView`, React renderers, HTTP routing, iframe policy, or
  activation storage into `@qoder-ai/harness`.
- Allowing artifact-authored code to import arbitrary workspace or npm packages.
- Claiming the first Structurizr Provider is reviewed, remotely sandboxed, or a
  general provider marketplace/discovery mechanism.
- Publishing the Structurizr Provider package in this change.

## Plan and Tasks

1. Move the host-neutral contracts to a public `artifacts` subpath and keep
   Studio compatibility re-exports while internal imports migrate.
2. Add explicit embedded-provider injection, provider receipt/fingerprint
   validation, public activation helpers, and configurable bounded compile
   limits to Studio.
3. Add the Structurizr Provider package, child driver, hosted SVG surface, and
   focused tests in structurizr4js.
4. Run focused and package checks in both repositories, then run Better Harness
   generated/Harness/UI/Studio checks serially.
5. Perform Review Readiness Check, commit exact paths, push, dispatch Harness,
   UI, and Studio releases in dependency order, and verify npm plus a clean
   consumer.

## Test and Review Evidence

- AC-1/AC-2: Harness and Studio TypeScript builds plus Artifact provider,
  activation, registry, catalog, and server focused Vitest files.
- AC-3: compile-runtime tests cover custom accepted limits, hard-ceiling
  rejection, and cache/build identity separation.
- AC-4: Structurizr Provider tests cover valid DSL, invalid DSL, exact revision
  envelope/resource identity, hosted document safety, and real Studio routes.
- AC-5: `npm pack --dry-run --json` for the three packages, serial workspace checks,
  GitHub Actions run URLs, `npm view`, and an isolated install/import receipt.
- Release: commit `341f43c` published `@qoder-ai/harness@0.2.0`,
  `@qoder-ai/harness-ui@0.1.1`, and `@qoder-ai/harness-studio@0.1.0` through
  Actions runs `32558304947`, `32558407687`, and `32558682123`; all three
  registry records bind the same `gitHead`.
- Clean consumer: version-only npm install completed with 0 vulnerabilities;
  Node 24.19.0 imported the Artifact provider API, UI, and Studio, and the
  external Structurizr Provider returned 200 for catalog, snapshot, SVG
  resource, and CSP-protected viewer routes.
- Risk: provider code is trusted local code. The initial contribution therefore
  stays `experimental-local`, uses `trusted-local-process`, and never weakens the
  opaque-origin surface or artifact-authored package allowlist.
