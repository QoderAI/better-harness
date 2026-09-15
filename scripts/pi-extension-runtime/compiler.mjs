import { createHash, randomUUID } from "node:crypto";
import { builtinModules } from "node:module";
import { mkdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild-wasm";

// These are provided by Pi's native extension loader, not bundled copies.
const hostPackages = new Set([
  "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai",
  "@earendil-works/pi-ai/compat", "@earendil-works/pi-ai/oauth", "@earendil-works/pi-ai/providers/all",
  "@earendil-works/pi-agent-core", "@earendil-works/pi-tui",
  "typebox", "typebox/compile", "typebox/value",
]);
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function diagnostic(error) {
  return { text: error.text ?? error.message ?? String(error),
    ...(error.location ? { location: {
      file: error.location.file, line: error.location.line,
      column: error.location.column, lineText: error.location.lineText,
    } } : {}) };
}

/** Trusted local source only. Compilation does not execute or sandbox it. */
export async function createExtensionCompiler({ entry, outfile }) {
  entry = path.resolve(entry);
  outfile = path.resolve(outfile);
  const canonical = async (file) => realpath(file).catch((error) => {
    if (error.code === "ENOENT") return file;
    throw error;
  });
  if (await canonical(entry) === await canonical(outfile)) throw new Error("Output must differ from the source entry.");
  // Pi 0.85.1's Jiti loader can route .mjs and type:module .js to Node's
  // persistent ESM cache. A .ts entry forces Pi's uncached loader even though
  // esbuild has already lowered/bundled the source to JavaScript.
  if (path.extname(outfile) !== ".ts") {
    throw new Error("Output must end in .ts to use Pi's reloadable extension loader.");
  }
  const context = await esbuild.context({
    absWorkingDir: path.dirname(entry), entryPoints: [entry], outfile,
    bundle: true, write: false, format: "esm", platform: "node", target: "node22",
    metafile: true, sourcemap: false, logLevel: "silent",
    plugins: [{ name: "pi-host-imports", setup(build) {
      build.onResolve({ filter: /^[^./]/ }, ({ path: specifier, kind }) => {
        if (kind === "entry-point" || path.isAbsolute(specifier)) return;
        if (hostPackages.has(specifier) || builtins.has(specifier)) {
          return { path: specifier, external: true };
        }
        return { errors: [{ text: `Unsupported runtime import: ${specifier}. Use local source or a Pi-provided package.` }] };
      });
    } }],
  });
  let closed = false;
  let tail = Promise.resolve();
  let revision;
  let disposePromise;

  async function rebuild() {
    if (closed) throw new Error("Compiler is disposed.");
    const job = tail.then(async () => {
      const started = performance.now();
      try {
        const result = await context.rebuild();
        const output = result.outputFiles.find((file) => path.resolve(file.path) === outfile);
        const metadata = Object.values(result.metafile.outputs).find((item) => item.entryPoint);
        if (!output || !metadata?.exports.includes("default")) {
          throw new Error("Pi extensions must export a default factory.");
        }
        // Never replace any source module, even if it was imported by the entry.
        const sources = await Promise.all(Object.keys(result.metafile.inputs).map((file) =>
          canonical(path.resolve(path.dirname(entry), file))));
        if (sources.includes(await canonical(outfile))) {
          throw new Error("Output must not overwrite an imported source module.");
        }
        const next = createHash("sha256").update(output.contents).digest("hex");
        await mkdir(path.dirname(outfile), { recursive: true });
        const temporary = path.join(path.dirname(outfile), `.${path.basename(outfile)}.${randomUUID()}.tmp`);
        try {
          await writeFile(temporary, output.contents, { flag: "wx" });
          await rename(temporary, outfile);
        } finally {
          await rm(temporary, { force: true });
        }
        const changed = revision !== next;
        revision = next;
        return { status: "ready", revision, changed, bytes: output.contents.length,
          durationMs: performance.now() - started, outfile,
          diagnostics: result.warnings.map(diagnostic) };
      } catch (error) {
        return { status: "failed", revision: revision ?? null, outfile,
          durationMs: performance.now() - started,
          diagnostics: (error.errors ?? [error]).map(diagnostic) };
      }
    });
    tail = job.catch(() => {});
    return job;
  }

  return {
    rebuild,
    // A portable polling loop calls rebuild() and lets esbuild reuse its graph.
    // Serial rebuilds also catch missing imports and newly created source files.
    dispose() {
      closed = true;
      disposePromise ??= tail.then(() => context.dispose());
      return disposePromise;
    },
  };
}
