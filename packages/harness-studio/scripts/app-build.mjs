import { watch } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build, context } from "esbuild-wasm";

export const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = join(packageRoot, "..", "..");
export const appDir = join(packageRoot, "dist", "app");
const appSourceDir = join(packageRoot, "src", "app");
const appStylesDir = join(appSourceDir, "styles");
const inspectorAssetRoot = join(repositoryRoot, "scripts", "harness-inspector", "ui");
const reloadAssetName = "studio-dev-reload.txt";

export function reconcileStudioDevReloadRevision(currentRevision, observedRevision) {
  return {
    revision: observedRevision,
    reload: currentRevision !== null && currentRevision !== observedRevision,
  };
}

export function injectStudioDevReload(html) {
  const script = `<script>
window.__harnessStudioDevReload = window.__harnessStudioDevReload || { revision: null };
(function pollHarnessStudioDevReload() {
  const reconcileStudioDevReloadRevision = ${reconcileStudioDevReloadRevision.toString()};
  async function check() {
    try {
      const response = await fetch("/assets/${reloadAssetName}", { cache: "no-store" });
      if (response.ok) {
        const revision = await response.text();
        const next = reconcileStudioDevReloadRevision(window.__harnessStudioDevReload.revision, revision);
        window.__harnessStudioDevReload.revision = next.revision;
        if (next.reload) {
          window.location.reload();
          return;
        }
      }
    } catch {}
    setTimeout(check, 250);
  }
  check();
})();
</script>`;

  return /<\/body>/i.test(html)
    ? html.replace(/<\/body>/i, `${script}\n  </body>`)
    : `${html}\n${script}\n`;
}

function studioAppBuildOptions({ development = false, plugins = [] } = {}) {
  return {
    entryPoints: { app: join(appSourceDir, "main.tsx") },
    outdir: join(appDir, "assets"),
    entryNames: "[name]",
    chunkNames: "chunks/[name]-[hash]",
    bundle: true,
    splitting: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    jsx: "automatic",
    minify: !development,
    sourcemap: true,
    define: { "process.env.NODE_ENV": development ? '"development"' : '"production"' },
    logLevel: "warning",
    plugins,
  };
}

async function copyStudioAppStaticAssets({ development = false, revision } = {}) {
  await mkdir(join(appDir, "assets"), { recursive: true });
  const sourceHtml = await readFile(join(appSourceDir, "index.html"), "utf8");
  await Promise.all([
    writeFile(
      join(appDir, "index.html"),
      development ? injectStudioDevReload(sourceHtml) : sourceHtml,
      "utf8",
    ),
    ...["tokens.css", "shell.css", "workbench.css"].map((file) =>
      copyFile(join(appStylesDir, file), join(appDir, "assets", file)),
    ),
    copyFile(join(inspectorAssetRoot, "workbench.css"), join(appDir, "assets", "inspector-workbench.css")),
    copyFile(join(repositoryRoot, "node_modules", "pdfjs-dist", "legacy", "build", "pdf.worker.mjs"), join(appDir, "assets", "pdf.worker.mjs")),
  ]);
  if (development) {
    await writeFile(join(appDir, "assets", reloadAssetName), String(revision), "utf8");
  }
}

export async function buildStudioApp() {
  await mkdir(join(appDir, "assets"), { recursive: true });
  await build(studioAppBuildOptions());
  await copyStudioAppStaticAssets();
}

export async function buildStudioServerRuntime() {
  const runtimeAssetRoot = join(packageRoot, "dist", "server", "runtime", "ui");
  await mkdir(runtimeAssetRoot, { recursive: true });
  const nodeRuntime = {
    bundle: true,
    format: "esm",
    platform: "node",
    target: "node22",
    logLevel: "warning",
    banner: {
      js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
    },
  };
  await Promise.all([
    build({
      ...nodeRuntime,
      entryPoints: [join(repositoryRoot, "scripts", "agent-customize", "index.mjs")],
      outfile: join(packageRoot, "dist", "server", "runtime", "agent-customize-runtime.mjs"),
    }),
    build({
      ...nodeRuntime,
      entryPoints: [join(packageRoot, "scripts", "inspector-workspace-provider.mjs")],
      outfile: join(packageRoot, "dist", "server", "runtime", "inspector-workspace-runtime.mjs"),
    }),
    ...["workbench.html", "workbench.css", "workbench.js"].map((file) =>
      copyFile(join(inspectorAssetRoot, file), join(runtimeAssetRoot, file)),
    ),
  ]);
}

export function createStudioDevReloadPlugin({
  publishRevision = (revision) => copyStudioAppStaticAssets({ development: true, revision }),
  onPublished = () => {},
} = {}) {
  let revision = 0;
  return {
    name: "studio-development-reload",
    setup(buildApi) {
      buildApi.onEnd(async (result) => {
        if (result.errors.length > 0) return;
        const nextRevision = revision + 1;
        await publishRevision(nextRevision);
        revision = nextRevision;
        onPublished(revision);
      });
    },
  };
}

export async function createStudioAppDevelopmentContext({ onPublished = () => {} } = {}) {
  let resolveInitialBuild;
  let rejectInitialBuild;
  const initialBuild = new Promise((resolvePromise, rejectPromise) => {
    resolveInitialBuild = resolvePromise;
    rejectInitialBuild = rejectPromise;
  });
  const publishSuccessfulBuild = createStudioDevReloadPlugin({
    onPublished(revision) {
      onPublished(revision);
      resolveInitialBuild();
    },
  });
  const observeInitialFailure = {
    name: "studio-development-initial-build",
    setup(buildApi) {
      buildApi.onEnd((result) => {
        if (result.errors.length > 0) rejectInitialBuild(new Error("Initial Studio browser build failed."));
      });
    },
  };
  const buildContext = await context(studioAppBuildOptions({
    development: true,
    plugins: [publishSuccessfulBuild, observeInitialFailure],
  }));
  await buildContext.watch();
  try {
    await initialBuild;
  } catch (error) {
    await buildContext.dispose();
    throw error;
  }
  return buildContext;
}

export function watchStudioStaticSources(onChange) {
  let debounce;
  const notify = () => {
    if (debounce !== undefined) clearTimeout(debounce);
    debounce = setTimeout(() => {
      debounce = undefined;
      onChange();
    }, 200);
  };
  const watchers = [
    watch(appSourceDir, (event, filename) => {
      if (filename === null || filename === "index.html") notify();
    }),
    watch(appStylesDir, notify),
    watch(inspectorAssetRoot, (event, filename) => {
      if (filename === null || filename === "workbench.css") notify();
    }),
  ];
  return () => {
    if (debounce !== undefined) clearTimeout(debounce);
    for (const watcher of watchers) watcher.close();
  };
}
