# Desktop runtime prune for debug metadata, Phosphor, and PDF.js

## Traceability

- Spec ID: `2026-09-10-desktop-runtime-prune`
- Status: Implemented
- Request: shrink the packaged Harness Studio `.app` by dropping pack-time debug metadata, unused Phosphor files, and unused PDF.js trees
- AI involvement: implementation and local validation by Grok 4.6

## Intent

The unpacked macOS arm64 app is about 518MB. Chromium is most of that, but the
staged Node runtime still ships debug metadata, the full Phosphor icon package,
and both PDF.js builds. Phosphor icons are already bundled into Studio's
browser assets, and the Node PDF adapter imports only the legacy PDF.js entry.
Staging should keep the runtime those two facts require and drop the rest
before electron-builder packs `dist/app`.

## Acceptance Scenarios

- **AC-1** Given a staged desktop `node_modules` tree, when staging finishes,
  then `*.map`, `*.d.ts` / `*.d.mts` / `*.d.cts`, and package README files are
  gone, while runtime JavaScript, LICENSE files, native addons, and WASM remain.
- **AC-2** Given `@phosphor-icons/react` in the production closure, when staging
  finishes, then no `@phosphor-icons` package remains under staged
  `node_modules`. The Studio browser bundle already inlines the icons it uses.
- **AC-3** Given `pdfjs-dist` in the production closure, when staging finishes,
  then the modern `build/` tree, viewer `web/` trees, types, webpack helper,
  minified copies, and source maps are gone, while `legacy/build/pdf.mjs`,
  `legacy/build/pdf.worker.mjs`, and the runtime support trees (`cmaps`,
  `wasm`, `standard_fonts`, `iccs`, `image_decoders`) remain. The Node adapter
  can still load `pdfjs-dist/legacy/build/pdf.mjs`.
- **AC-4** Given the prune owner, when its tests run, then they assert keep and
  drop behaviour on a fixture tree rather than grepping packaged markup.

## Non-goals

- Shrinking Electron Framework / Chromium.
- Shiki language subsetting or dropping `esbuild-wasm`.
- Changing Studio's PDF adapter to the modern `pdfjs-dist/build` entry. That
  build loads in Node but warns to use `legacy`; this change keeps the working
  Node path.
- Moving Phosphor to `devDependencies` in the npm package. Desktop staging is
  the pack-time owner; the Studio CLI package layout stays unchanged.
- Signing, notarization, or a smaller published npm tarball.

## Plan and Tasks

1. Add `packages/better-harness-desktop/scripts/prune-desktop-runtime.mjs` as
   the keep/drop owner. Walk with `node:path` / `readdir`; do not split native
   paths on `/`.
2. Call it from `scripts/stage.mjs` after the production `npm install`.
3. Cover AC-1..AC-4 with `node:test` fixtures next to the existing desktop
   protocol tests.
4. Restage and confirm Phosphor is absent, PDF.js legacy entry still imports,
   and staged `node_modules` is smaller.

## Test and Review Evidence

- `npm test -w @qoder-ai/better-harness-desktop`: 10 passed, including the three
  prune keep/drop tests (AC-1, AC-2, AC-3, AC-4).
- `npm exec -w @qoder-ai/harness-studio -- vitest run test/pdf-artifact-adapter.test.ts`:
  4 passed against the workspace PDF.js install.
- `npm run stage -w @qoder-ai/better-harness-desktop` pruned 5394 files. Staged
  `node_modules` went from 285MB to 141MB. `@phosphor-icons` is absent.
  `pdfjs-dist` is 7.8MB and still exports `getDocument` from
  `legacy/build/pdf.mjs`. Zero leftover `*.map`, `*.d.ts`, or README files.
