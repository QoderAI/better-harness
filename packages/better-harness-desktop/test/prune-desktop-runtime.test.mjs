import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import {
  isDebugMetadataFile,
  isKeptPdfjsPath,
  pruneDesktopRuntime,
} from "../scripts/prune-desktop-runtime.mjs";

async function writeTree(root, files) {
  for (const [relativePath, content] of Object.entries(files)) {
    const full = join(root, relativePath);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

test("debug metadata is README, source maps, and declaration files only", () => {
  for (const name of ["README.md", "readme", "index.js.map", "index.d.ts", "pdf.d.mts", "view.d.cts"]) {
    assert.equal(isDebugMetadataFile(name), true, name);
  }
  for (const name of ["index.js", "LICENSE", "package.json", "skia.darwin-arm64.node", "esbuild.wasm", "readme.js"]) {
    assert.equal(isDebugMetadataFile(name), false, name);
  }
});

test("PDF.js keep list is the legacy Node entry plus support trees", () => {
  const root = join("app", "node_modules", "pdfjs-dist");
  assert.equal(isKeptPdfjsPath(root, join(root, "package.json")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "LICENSE")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "legacy", "build", "pdf.mjs")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "legacy", "build", "pdf.worker.mjs")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "cmaps", "A.bcmap")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "wasm", "jbig2.wasm")), true);
  assert.equal(isKeptPdfjsPath(root, join(root, "legacy", "build", "pdf.min.mjs")), false);
  assert.equal(isKeptPdfjsPath(root, join(root, "legacy", "build", "pdf.sandbox.mjs")), false);
  assert.equal(isKeptPdfjsPath(root, join(root, "build", "pdf.mjs")), false);
  assert.equal(isKeptPdfjsPath(root, join(root, "web", "viewer.mjs")), false);
  assert.equal(isKeptPdfjsPath(root, join(root, "types", "src", "pdf.d.ts")), false);
});

test("staging prune drops debug metadata, Phosphor, and unused PDF.js trees", async () => {
  const appRoot = await mkdtemp(join(tmpdir(), "desktop-runtime-prune-"));
  try {
    await writeTree(appRoot, {
      "src/main.mjs": "export {}\n",
      "node_modules/keep-pkg/index.js": "export const ok = true;\n",
      "node_modules/keep-pkg/LICENSE": "MIT\n",
      "node_modules/keep-pkg/README.md": "docs\n",
      "node_modules/keep-pkg/index.d.ts": "export const ok: boolean;\n",
      "node_modules/keep-pkg/index.js.map": "{\"version\":3}\n",
      "node_modules/@phosphor-icons/react/dist/csr/X.js": "export const X = () => null;\n",
      "node_modules/@phosphor-icons/react/README.md": "icons\n",
      "node_modules/pdfjs-dist/package.json": "{\"name\":\"pdfjs-dist\"}\n",
      "node_modules/pdfjs-dist/LICENSE": "Apache-2.0\n",
      "node_modules/pdfjs-dist/README.md": "pdfjs\n",
      "node_modules/pdfjs-dist/webpack.mjs": "export {}\n",
      "node_modules/pdfjs-dist/build/pdf.mjs": "export function getDocument() {}\n",
      "node_modules/pdfjs-dist/build/pdf.mjs.map": "{\"version\":3}\n",
      "node_modules/pdfjs-dist/web/viewer.mjs": "export {}\n",
      "node_modules/pdfjs-dist/types/src/pdf.d.ts": "export {}\n",
      "node_modules/pdfjs-dist/legacy/build/pdf.mjs": "export function getDocument() { return true; }\n",
      "node_modules/pdfjs-dist/legacy/build/pdf.mjs.map": "{\"version\":3}\n",
      "node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs": "export {}\n",
      "node_modules/pdfjs-dist/legacy/build/pdf.min.mjs": "export {}\n",
      "node_modules/pdfjs-dist/legacy/build/pdf.sandbox.mjs": "export {}\n",
      "node_modules/pdfjs-dist/legacy/web/viewer.mjs": "export {}\n",
      "node_modules/pdfjs-dist/cmaps/A.bcmap": "cmap\n",
      "node_modules/pdfjs-dist/wasm/jbig2.wasm": "wasm\n",
      "node_modules/pdfjs-dist/standard_fonts/Fox.pfb": "font\n",
      "node_modules/pdfjs-dist/iccs/x.icc": "icc\n",
      "node_modules/pdfjs-dist/image_decoders/pdf.image_decoders.mjs": "export {}\n",
      "node_modules/pdfjs-dist/image_decoders/pdf.image_decoders.mjs.map": "{\"version\":3}\n",
      "node_modules/@qoder-ai/harness-studio/dist/app/assets/app.js": "console.log(1);\n",
      "node_modules/@qoder-ai/harness-studio/dist/app/assets/app.js.map": "{\"version\":3}\n",
    });

    const stats = await pruneDesktopRuntime(appRoot);
    assert.equal(stats.removedPhosphor, true);
    assert.equal(stats.removed > 0, true);

    assert.equal(await exists(join(appRoot, "src", "main.mjs")), true);
    assert.equal(await exists(join(appRoot, "node_modules", "keep-pkg", "index.js")), true);
    assert.equal(await exists(join(appRoot, "node_modules", "keep-pkg", "LICENSE")), true);
    assert.equal(await exists(join(appRoot, "node_modules", "keep-pkg", "README.md")), false);
    assert.equal(await exists(join(appRoot, "node_modules", "keep-pkg", "index.d.ts")), false);
    assert.equal(await exists(join(appRoot, "node_modules", "keep-pkg", "index.js.map")), false);
    assert.equal(await exists(join(appRoot, "node_modules", "@phosphor-icons")), false);

    const pdfjs = join(appRoot, "node_modules", "pdfjs-dist");
    assert.equal(await exists(join(pdfjs, "package.json")), true);
    assert.equal(await exists(join(pdfjs, "LICENSE")), true);
    assert.equal(await exists(join(pdfjs, "legacy", "build", "pdf.mjs")), true);
    assert.equal(await exists(join(pdfjs, "legacy", "build", "pdf.worker.mjs")), true);
    assert.equal(await exists(join(pdfjs, "cmaps", "A.bcmap")), true);
    assert.equal(await exists(join(pdfjs, "wasm", "jbig2.wasm")), true);
    assert.equal(await exists(join(pdfjs, "standard_fonts", "Fox.pfb")), true);
    assert.equal(await exists(join(pdfjs, "iccs", "x.icc")), true);
    assert.equal(await exists(join(pdfjs, "image_decoders", "pdf.image_decoders.mjs")), true);
    assert.equal(await exists(join(pdfjs, "README.md")), false);
    assert.equal(await exists(join(pdfjs, "webpack.mjs")), false);
    assert.equal(await exists(join(pdfjs, "build")), false);
    assert.equal(await exists(join(pdfjs, "web")), false);
    assert.equal(await exists(join(pdfjs, "types")), false);
    assert.equal(await exists(join(pdfjs, "legacy", "build", "pdf.mjs.map")), false);
    assert.equal(await exists(join(pdfjs, "legacy", "build", "pdf.min.mjs")), false);
    assert.equal(await exists(join(pdfjs, "legacy", "web")), false);
    assert.equal(await exists(join(pdfjs, "image_decoders", "pdf.image_decoders.mjs.map")), false);

    assert.equal(await exists(join(appRoot, "node_modules", "@qoder-ai", "harness-studio", "dist", "app", "assets", "app.js")), true);
    assert.equal(await exists(join(appRoot, "node_modules", "@qoder-ai", "harness-studio", "dist", "app", "assets", "app.js.map")), false);

    const runtime = await readFile(join(pdfjs, "legacy", "build", "pdf.mjs"), "utf8");
    assert.match(runtime, /export function getDocument/);
  } finally {
    await rm(appRoot, { recursive: true, force: true });
  }
});
