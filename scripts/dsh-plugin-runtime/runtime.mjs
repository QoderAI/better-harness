import { createHash, randomUUID } from "node:crypto";
import { builtinModules } from "node:module";
import { mkdir, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild-wasm";

const owner = { kind: "better-harness.dsh-plugin-runtime", version: 1 };
const profileManifest = patchReload => ({ name: "better-harness-dsh-runtime-experiment", private: true, type: "module",
  dsh: { profile: { bundles: ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app"], patchReload } } });
const builtins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

async function atomicWrite(filename, content) {
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try { await writeFile(temporary, content, { flag: "wx" }); await rename(temporary, filename); }
  finally { await rm(temporary, { force: true }); }
}

export async function readOwnedPatch(patch) {
  try {
    const previous = JSON.parse(await readFile(patch, "utf8"));
    const row = previous?.[0]?.insert?.[0];
    if (!Array.isArray(previous) || previous.length !== 1 || Object.keys(previous[0]).length !== 1
      || !Array.isArray(previous[0].insert) || previous[0].insert.length !== 1 || row?.id !== "harness-wasm-plugin"
      || Object.keys(row).length !== 2 || !/^\.\/modules\/[a-f0-9]{64}\.mjs$/.test(row.name)) {
      throw new Error("Experiment patch was changed; refusing to overwrite it.");
    }
    return previous;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
}

/** Only our isolated home is writable. A running DSH process does not own the build lock. */
export async function preparePluginProfile(home, patchReload) {
  const manifest = profileManifest(patchReload);
  await mkdir(home, { recursive: true });
  const marker = path.join(home, ".better-harness-dsh.json");
  try {
    const existing = JSON.parse(await readFile(marker, "utf8"));
    if (existing.kind !== owner.kind || existing.version !== owner.version) throw new Error("Unknown experiment home owner.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    if ((await readdir(home)).length) throw new Error("Use an empty experiment home; refusing to modify an existing DSH home.");
    await writeFile(marker, json(owner), { flag: "wx" });
  }
  const profile = path.join(home, "profiles", "wasm");
  await mkdir(path.join(profile, "modules"), { recursive: true });
  const manifestPath = path.join(profile, "package.json");
  try {
    const existing = JSON.parse(await readFile(manifestPath, "utf8"));
    if (JSON.stringify(existing) !== JSON.stringify(manifest)) throw new Error("Experiment Profile manifest was changed; refusing to overwrite it.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    await writeFile(manifestPath, json(manifest), { flag: "wx" });
  }
  return profile;
}

export async function createPluginRuntime({ entry, home, patchReload = "live" }) {
  if (!["live", "startup"].includes(patchReload)) throw new Error("Unsupported Profile reload policy.");
  entry = await realpath(path.resolve(entry)); home = path.resolve(home);
  const profile = await preparePluginProfile(home, patchReload);
  const patch = path.join(profile, "cordis.patch.yml");
  const lock = path.join(home, ".compiler-lock");
  const capturedInputs = new Map();
  const context = await esbuild.context({
    absWorkingDir: path.dirname(entry), entryPoints: [entry],
    outfile: path.join(profile, "candidate.mjs"), bundle: true, write: false,
    format: "esm", platform: "node", target: "node22", metafile: true, logLevel: "silent",
    plugins: [{ name: "dsh-runtime-imports", setup(build) {
      build.onLoad({ filter: /\.(?:[cm]?[jt]sx?|json)$/ }, async ({ path: filename }) => {
        const bytes = await readFile(filename);
        capturedInputs.set(path.resolve(filename), digest(bytes));
        const extension = path.extname(filename).slice(1);
        const loader = ["mts", "cts"].includes(extension) ? "ts" : ["mjs", "cjs"].includes(extension) ? "js" : extension;
        return { contents: bytes, loader, resolveDir: path.dirname(filename) };
      });
      build.onResolve({ filter: /^[^./]/ }, ({ path: specifier, kind }) => {
        if (kind === "entry-point" || path.isAbsolute(specifier)) return;
        if (builtins.has(specifier) || specifier.startsWith("@deepseek-ai/")) return { path: specifier, external: true };
        return { errors: [{ text: `Unsupported runtime import: ${specifier}. Use local files or DSH-owned packages.` }] };
      });
    } }],
  });
  let closed = false, tail = Promise.resolve(), disposal;
  let inputHashes;
  async function build({ onlyChanged = false, publish = true } = {}) {
    if (closed) throw new Error("Runtime compiler is disposed.");
    const job = tail.then(async () => {
      const started = performance.now();
      if (onlyChanged && inputHashes) {
        const unchanged = await Promise.all([...inputHashes].map(async ([file, hash]) =>
          readFile(file).then((bytes) => digest(bytes) === hash, () => false)));
        if (unchanged.every(Boolean)) return { status: "unchanged" };
      }
      let locked = false;
      try {
        try { await mkdir(lock); locked = true; }
        catch (error) { if (error.code === "EEXIST") throw new Error("Another compiler owns this home. Retry after it exits."); throw error; }
        await preparePluginProfile(home, patchReload);
        const result = await context.rebuild();
        const metadata = Object.values(result.metafile.outputs).find((item) => item.entryPoint);
        if (!metadata?.exports.includes("apply")) throw new Error("DSH plugins must export a named apply function.");
        const output = result.outputFiles[0].contents;
        const revision = digest(output);
        const moduleName = `./modules/${revision}.mjs`;
        const artifact = path.join(profile, "modules", `${revision}.mjs`);
        const nextPatch = [{ insert: [{ id: "harness-wasm-plugin", name: moduleName }] }];
        const previous = await readOwnedPatch(patch);
        try { await writeFile(artifact, output, { flag: "wx" }); }
        catch (error) {
          if (error.code !== "EEXIST") throw error;
          if (digest(await readFile(artifact)) !== revision) throw new Error("Existing compiled module failed its content digest.");
        }
        const changed = JSON.stringify(previous) !== JSON.stringify(nextPatch);
        if (publish && changed) await atomicWrite(patch, json(nextPatch));
        // Compare future saves with exactly the bytes given to esbuild, so an
        // edit during compilation cannot get mistaken for the compiled source.
        inputHashes = new Map();
        for (const file of Object.keys(result.metafile.inputs)) {
          const absolute = path.resolve(path.dirname(entry), file);
          const hash = capturedInputs.get(absolute);
          if (hash === undefined) { inputHashes = undefined; break; }
          inputHashes.set(absolute, hash);
        }
        return { status: publish ? "published" : "compiled", revision, changed, bytes: output.length,
          durationMs: performance.now() - started, artifact, patch,
          activation: publish ? "pending-native-loader" : "not-requested", diagnostics: result.warnings.map((warning) => ({ text: warning.text })) };
      } catch (error) {
        inputHashes = undefined;
        return { status: "failed", diagnostics: (error.errors ?? [error]).map((item) => ({ text: item.text ?? item.message ?? String(item), ...(item.location ? { location: item.location } : {}) })) };
      } finally { if (locked) await rm(lock, { recursive: true }); }
    });
    tail = job.catch(() => {});
    return job;
  }
  function publish({ revision }) {
    if (closed) return Promise.reject(new Error("Runtime compiler is disposed."));
    const job = tail.then(async () => {
      if (!/^[a-f0-9]{64}$/.test(revision)) throw new Error("Invalid compiled revision.");
      let locked = false;
      try {
        await mkdir(lock); locked = true;
        await preparePluginProfile(home, patchReload); await readOwnedPatch(patch);
        const artifact = path.join(profile, "modules", `${revision}.mjs`);
        if (digest(await readFile(artifact)) !== revision) throw new Error("Compiled module digest changed.");
        await atomicWrite(patch, json([{ insert: [{ id: "harness-wasm-plugin", name: `./modules/${revision}.mjs` }] }]));
      } finally { if (locked) await rm(lock, { recursive: true }); }
    });
    tail = job.catch(() => {}); return job;
  }
  return { home, profile, build, publish, dispose() { closed = true; disposal ??= tail.then(() => context.dispose()); return disposal; } };
}
