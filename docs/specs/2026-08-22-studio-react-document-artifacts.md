# Render document artifacts through the React runtime

## Traceability

- Spec ID: studio-react-document-artifacts
- Status: Implemented

## Intent

Extend Studio's existing React and esbuild Artifact Preview lifecycle to
declarative diagram documents. An operator should be able to open Mermaid and
SVG artifacts as rendered output, switch to their exact source, and receive a
new render after the file changes without introducing another Canvas-style
viewer host.

The lifecycle stays:

```text
Artifact Revision
  -> selected ArtifactBuildRuntime
  -> generated or source React module
  -> immutable ArtifactBuildSnapshot
  -> opaque-origin sandboxed Preview
  -> ArtifactPreviewHost commit
```

## Acceptance Scenarios

- **AC-1:** `.mmd` and `.mermaid` artifacts resolve to a Studio Mermaid React
  build runtime. A valid diagram renders in the existing sandboxed Preview,
  keeps Source available, and advertises execute plus live-update capability.
- **AC-2:** `.svg` artifacts resolve to a Studio SVG React build runtime and
  render through the same build snapshot, Preview/Source host, runtime error,
  theme, and live-update protocol used by TSX/JSX.
- **AC-3:** The SVG runtime preserves SVG-as-image security semantics: embedded
  script and event handlers do not execute, the artifact cannot reach the
  parent document, and direct SVG content remains attachment-only.
- **AC-4:** Beautiful Mermaid is bundled from a Studio-owned dependency with
  fixed rendering options. Its SVG output is presented in the browser's
  script-disabled image mode, so artifact text cannot enable HTML handlers,
  external navigation, or network access; invalid syntax reaches the existing
  runtime-failed state with a bounded diagnostic.
- **AC-5:** A build runtime is selected by the Artifact plugin registry and
  executed by generic build routes. Adding a build-backed format does not add a
  renderer-id branch to `server.ts` or a format-specific provider to
  `ArtifactView.tsx`.
- **AC-6:** A generated asynchronous React artifact reports
  `renderCompleted` only after its diagram/image surface is ready. Existing
  TSX/JSX confinement, stale-build rejection, Qoder override priority, PPTX,
  Markdown, image, text, code, and diff behavior remain covered.

## Non-goals

- Using or extending Qoder Canvas as the native Mermaid or SVG host.
- Allowing artifacts to import Mermaid or other new npm packages themselves.
- Executing scripts, external resources, forms, or navigation embedded in SVG
  or Mermaid input.
- Rendering Mermaid fences inside Markdown in this increment.
- Rendering arbitrary HTML, PDF, DOCX, XLSX, Lottie, or write-back to source.
- Publishing a third-party plugin API or loading arbitrary plugin React modules
  into Studio's own origin.

## Plan and Tasks

1. Add a trusted `ArtifactBuildRuntimeImplementation` contribution to Artifact
   plugin resolution. It describes either a confined source module or a
   Studio-generated virtual module, its raw-source loader, allowed runtime-only
   packages, and build options.
2. Make the compiler cache and build identity runtime-aware, and make the build
   and preview routes delegate to the selected build runtime instead of checking
   `studio.react-preview`.
3. Add Studio Mermaid and SVG build runtime providers before the native data
   provider while preserving operator override priority.
4. Generalize the browser provider to every server-selected, code-backed
   `sandboxed-web` renderer and remove the old SVG-specific iframe path.
5. Extend the React runtime entry with an optional `artifactReady` promise so
   generated asynchronous components can delay successful host commit.
6. Add focused catalog, registry, compiler, server/browser, security, live
   update, and regression evidence.

## Test and Review Evidence

- AC-1/AC-2/AC-5: catalog, plugin registry, build contract, build identity, and
  browser provider tests for TSX, SVG, MMD, and Mermaid extensions.
- AC-3/AC-4: Playwright frames containing a script-bearing SVG, valid Mermaid,
  and invalid Mermaid; assert the parent is unchanged, the valid diagram is
  visible, failures are operator-readable, and no unexpected console/page errors
  escape Studio.
- AC-6: compiler tests for the generated modules and `artifactReady`, plus the
  existing Artifact Playwright suite, package typecheck/build, doc link graph,
  and `git diff --check`.

Risk review:

- Beautiful Mermaid increases browser bundle work. Only Mermaid builds bundle
  it, build output remains bounded, and compiler timeouts still apply.
- SVG bytes remain untrusted. Rendering as an image rather than injecting SVG
  markup into the document preserves the browser's script-disabled image mode.
- Runtime implementations are trusted server code. Artifact bytes select only
  among registered implementations and never supply a module path or package
  allowlist.

Implementation evidence captured on 2026-08-22:

- `npm test -- --maxWorkers=1` passed all 30 Harness Studio test files and 189
  tests. This includes compiler, catalog, registry, server, security, and
  existing Artifact renderer regressions.
- `npm run test:browser` passed all 26 Playwright scenarios. The shared Artifact
  scenario rendered SVG and Beautiful Mermaid, rejected invalid Mermaid,
  observed a Mermaid build change without reloading Studio, kept the SVG script
  inert, and reported no unexpected console or page errors.
- Wide, compact, and narrow Beautiful Mermaid screenshots were reviewed from
  the Playwright output. The preview remained primary and the document had no
  horizontal overflow at 1440x900, 1024x768, or 390x844.
- `npx vitest run test/skills-docs/doc-link-graph.test.mjs` passed 8 tests after
  regenerating the routing graph, and `git diff --check` passed.
- Dependency installation reported an engine warning because the local process
  used Node 26 while the repository declares Node 22.20 through 24. The build,
  tests, and browser evidence passed, but this local run is not a supported-Node
  CI receipt.
