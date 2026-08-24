// Bundle the React app with the repo-conventional esbuild-wasm toolchain.
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild-wasm";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
const appDir = join(packageRoot, "dist", "app");
const inspectorAssetRoot = join(packageRoot, "..", "..", "scripts", "harness-inspector", "ui");

await mkdir(join(appDir, "assets"), { recursive: true });
await build({
  entryPoints: { app: join(packageRoot, "src", "app", "main.tsx") },
  outdir: join(appDir, "assets"),
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
  bundle: true,
  splitting: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  jsx: "automatic",
  minify: true,
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "warning",
});
// Studio owns the on-demand collection lifecycle, while the existing MJS
// capability remains the no-install public entrypoint. Bundle that capability
// into the server distribution so the npm package and direct scripts share the
// same provider implementations without making browser code import them.
await build({
  entryPoints: [join(repositoryRoot, "scripts", "agent-customize", "index.mjs")],
  outfile: join(packageRoot, "dist", "server", "runtime", "agent-customize-runtime.mjs"),
  bundle: true,
  format: "esm",
  platform: "node",
  target: "node22",
  logLevel: "warning",
});
await Promise.all([
  copyFile(join(packageRoot, "src", "app", "index.html"), join(appDir, "index.html")),
  ...["tokens.css", "shell.css", "workbench.css"].map((file) =>
    copyFile(join(packageRoot, "src", "app", "styles", file), join(appDir, "assets", file)),
  ),
  copyFile(join(inspectorAssetRoot, "workbench.css"), join(appDir, "assets", "inspector-workbench.css")),
  copyFile(join(repositoryRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"), join(appDir, "assets", "pdf.worker.mjs")),
]);
process.stdout.write(`Built studio app into ${appDir}\n`);
process.exit(0);
