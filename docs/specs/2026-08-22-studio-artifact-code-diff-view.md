# Unify code and diff rendering through Artifact View

## Traceability

- Spec ID: studio-artifact-code-diff-view
- Status: Implemented

## Intent

Make Artifact View the owner of Studio's read-only code and patch presentation.
Artifact source, Git commit patches, Session diffs, Tool Call payloads, and other
code evidence should use one rendering contract instead of composing Shiki and
`@pierre/diffs` independently.

The shared view must preserve the complete supplied text, render every file in
a multi-file patch, infer a useful language for common repository formats, and
remain readable when Studio switches between dark and light themes. Loading or
highlighting failure must fall back to exact escaped text rather than hiding
content.

Artifact formats also need one composition boundary. The Artifact host should
resolve a registered renderer provider from the server-selected renderer
contract, then let that provider own its data loading and view lifecycle. Code
and Diff, PPTX, images, SVG, Qoder Canvas, and dynamic React Preview therefore
share a provider contract without pretending their internal runtimes are the
same or introducing class inheritance.

## Acceptance Scenarios

- **AC-1:** Artifact View exposes a typed, ordered renderer-provider registry.
  Each provider has stable identity, an explicit descriptor match, and one
  render entrypoint receiving the Artifact descriptor plus host lifecycle
  context. The host resolves exactly one provider and owns the honest
  unavailable fallback.
- **AC-2:** Source mode preserves every input character and lazily highlights
  JavaScript/JSX/TypeScript/TSX, web formats, Markdown, JSON/JSONL, YAML, Python, Rust,
  Go, Java/JVM, C/C++, C#, Ruby, PHP, SQL, Swift, shell/PowerShell/batch,
  Dockerfile, Makefile, TOML, Vue, and Svelte paths. Unknown formats remain
  readable plain text.
- **AC-3:** Source highlighting uses theme-specific tokens for both Studio dark
  and light themes and re-highlights after a theme change without changing the
  underlying source text.
- **AC-4:** Diff mode renders all files and all supplied hunks in a unified
  patch. Single-file consumers may omit a redundant file header; multi-file
  patches retain clear file boundaries and language inference from each path.
- **AC-5:** Git History waits for the actual Artifact Diff renderer before
  treating a patch as ready. Artifact patch files and Git patches expose the
  same line-number, addition/deletion, word-diff, overflow, and fallback
  behavior.
- **AC-6:** Wide, compact, and narrow layouts keep code and diff scrolling
  inside the owning pane, preserve keyboard navigation and visible focus, and
  produce no unexpected console or page errors.
- **AC-7:** Code/Diff, PPTX, image, SVG, Qoder Canvas, and dynamic React Preview
  are registered providers under the same Artifact View host. PPTX keeps its
  revision-bound data snapshot lifecycle and dynamic React keeps build,
  sandbox-handshake, and live-update behavior; registry unification does not
  erase those format-specific contracts.
- **AC-8:** Unknown, unavailable, or malformed renderer descriptors cannot fall
  through to another provider by file extension. Provider resolution follows
  the server-selected renderer identity and produces accessible fallback text.

## Non-goals

- Editing code, staging hunks, accepting/rejecting changes, or adding comments.
- Reconstructing full files omitted by a bounded Git patch or expanding
  unchanged hunks from repository blobs.
- Highlighting binary data, executing displayed source, or eagerly bundling
  every Shiki grammar into the Studio entry chunk.
- Changing Git history pagination, refs, commit selection, or Artifact dynamic
  preview execution.
- A class hierarchy, service locator, arbitrary third-party provider loading,
  or moving server-side adapter/plugin resolution into the browser.

## Plan and Tasks

1. Add an Artifact-owned typed provider contract, ordered registry, resolver,
   and host that dispatch the server-selected renderer without reclassifying
   file extensions in the browser.
2. Make Studio theme state available to the shared renderer and add paired dark
   and light syntax themes.
3. Extend the lazy grammar map and portable filename inference for common
   repository languages and special filenames.
4. Render every parsed patch file, retaining headers only where they convey a
   multi-file boundary.
5. Register Code/Diff, PPTX, image, SVG, Qoder Canvas, and dynamic React
   Preview providers, moving format-specific view ownership out of `App.tsx`.
6. Keep Git History and Session source/diff consumers on the Artifact-owned
   code view without manufacturing full Artifact descriptors for retained
   evidence that does not have one.
7. Add behavior tests for provider identity/resolution, language inference,
   exact token preservation, theme
   changes, multi-file patch parsing, shared consumer rendering, and responsive
   browser behavior.

## Test and Review Evidence

- AC-1/AC-4/AC-7/AC-8: focused component/model tests verify provider ordering,
  exact renderer identity, unavailable fallback, one shared dispatch path, and
  that a two-file patch yields two render models instead of dropping the second.
- AC-2/AC-3: Shiki tests concatenate tokens back to the exact input for common
  formats in both themes; unknown text remains the explicit fallback.
- AC-5: Artifact and Git History Playwright flows wait for the rendered Pierre
  surface and assert syntax tokens plus all expected patch content.
- AC-6: run Studio typecheck and package tests, then Playwright at wide,
  compact, and narrow sizes with console/page-error and overflow assertions.
- Risk: grammar growth can inflate initial JavaScript. Keep grammars behind
  per-language dynamic imports and inspect the production chunk split.
- Risk: third-party Shadow DOM styling and asynchronous tokenization can make a
  raw fallback look complete before the real view is ready. Expose stable ready
  markers and assert them in browser tests.

## Implementation Evidence

- `ArtifactView` now owns the browser-side provider contract, ordered registry,
  resolver, and unavailable fallback. Dynamic React Preview, Qoder Canvas,
  PPTX, SVG, image, and text-family providers all compose through this host;
  their format-specific loading, snapshot, build, and sandbox lifecycles remain
  inside the selected provider.
- `ArtifactCodeView` is now the only application-level consumer of
  `HighlightedCode` and `StudioDiff`. Artifact source/patches, Git History,
  Session diffs, Tool Call payloads, Raw ACP, and Terminal output all enter
  through its explicit source or diff mode.
- Focused provider and rendering tests pass 19 scenarios across exact renderer
  identity, registry ordering, malformed and unavailable fallback, language
  inference, exact light and dark token reconstruction, unknown text fallback,
  multi-file patch retention, and equal-length patch cache identities.
- Artifact and Git History Playwright coverage passes 12 scenarios. It waits
  for the real Pierre render state, verifies two-file Artifact patches, observes
  syntax-colored Git lines, and proves Artifact Source re-highlights after a
  dark-to-light theme change.
- The current combined Studio worktree passes typecheck, 27 Vitest files with
  169 tests, and all 22 Playwright scenarios. The Markdown link graph passes 8
  tests and `git diff --check` passes.
- Visual evidence was reviewed in `test-results` for a dark, wide multi-file
  Artifact patch; a dark Git History patch at wide layout; and a narrow, light
  Artifact Source view. Existing responsive suites retain wide, compact, and
  narrow overflow plus console/page-error assertions.
- The root Canvas preview smoke command remains unavailable in this checkout
  because no Canvas SDK runtime is provisioned; it exits before `/health` or
  `/canvas-module.js` can be served. Artifact View browser coverage does not
  depend on that optional Qoder Canvas runtime.
