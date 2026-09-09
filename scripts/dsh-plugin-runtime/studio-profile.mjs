import { createHash, randomBytes } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { preparePluginProfile, readOwnedPatch } from "./runtime.mjs";

const starter = `import { defineTool } from "@deepseek-ai/dsh-tools";
export const inject = ["tools"];
export function apply(ctx) {
  ctx.tools.register(defineTool({
    name: "harness_greeting", description: "Read the current Harness Design greeting.",
    parameters: {}, output: { schema: { type: "string" }, render: (_args, value) => [{ type: "text", text: value }] },
    async execute() { return "Hello from Harness Design"; },
  }));
}
`;

/** Called by the desktop host before boot; no arbitrary renderer paths. */
export async function prepareDshDesignProfile({ home, cwd }) {
  home = path.resolve(home); cwd = path.resolve(cwd);
  // Validate home ownership before writing even the seed source.
  // This controller is the sole activation writer. Disable the native file
  // watcher so persistence cannot race the explicit awaited Entry.update.
  const patchReload = "startup";
  const profile = await preparePluginProfile(home, patchReload);
  const control = path.join(profile, "control");
  await mkdir(control, { recursive: true });
  for (const file of ["control.mjs", "activation.mjs"]) {
    await copyFile(new URL(`./${file}`, import.meta.url), path.join(control, file));
  }
  const sourceRoot = path.join(cwd, ".harness-design");
  await mkdir(sourceRoot, { recursive: true });
  const entry = path.join(sourceRoot, "plugin.ts");
  try { await writeFile(entry, starter, { flag: "wx" }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  // Seed only a no-op on first boot. A broken edited source must not stop
  // the official UI from opening so it can be repaired with native tools.
  const profilePatch = path.join(profile, "cordis.patch.yml");
  let owned = await readOwnedPatch(profilePatch);
  if (!owned) {
    // Seed ESM needs no compiler process inside Electron. Real compilation
    // begins later in the external DSH Node process through its native tool.
    const noop = "export function apply() {}\n";
    const revision = createHash("sha256").update(noop).digest("hex");
    await writeFile(path.join(profile, "modules", `${revision}.mjs`), noop, { flag: "wx" }).catch(error => { if (error.code !== "EEXIST") throw error; });
    owned = [{ insert: [{ id: "harness-wasm-plugin", name: `./modules/${revision}.mjs` }] }];
    await writeFile(profilePatch, JSON.stringify(owned), { flag: "wx" });
  }
  const revision = path.posix.basename(owned[0].insert[0].name, ".mjs");
  const bytes = await readFile(path.join(profile, "modules", `${revision}.mjs`));
  if (createHash("sha256").update(bytes).digest("hex") !== revision) throw new Error("Startup plugin failed its content digest.");
  const token = randomBytes(32).toString("hex");
  const patch = path.join(control, "controller.patch.yml");
  await writeFile(patch, JSON.stringify([{ insert: [{ id: "harness-design-controller", name: "./control.mjs",
    config: { home, entry, token, patchReload, compilerUrl: new URL("./index.mjs", import.meta.url).href } }] }]), { mode: 0o600 });
  return { home, profile: "wasm", patch, token, entry };
}
