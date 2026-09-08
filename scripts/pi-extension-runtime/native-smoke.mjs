#!/usr/bin/env node
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createExtensionCompiler } from "./compiler.mjs";

// Opt-in, installed package only. No package download or real model request.
const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Usage: node scripts/pi-extension-runtime/native-smoke.mjs <installed-pi-package-root>");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "@earendil-works/pi-coding-agent");
assert.equal(manifest.version, "0.85.1", "Update the smoke evidence explicitly when changing Pi version.");
const sdk = await import(pathToFileURL(path.resolve(packageRoot, manifest.main)));
const scratch = await mkdtemp(path.join(os.tmpdir(), "native-pi-wasm-"));
const cwd = path.join(scratch, "project 空格");
const agentDir = path.join(scratch, "agent");
await mkdir(cwd); await mkdir(agentDir);
const entry = path.join(cwd, "extension.ts");
const helper = path.join(cwd, "greeting.ts");
const outfile = path.join(cwd, "compiled.ts");
const previousEntry = process.env.BH_PI_EXTENSION_ENTRY;
const previousOutput = process.env.BH_PI_EXTENSION_OUTPUT;
process.env.BH_PI_EXTENSION_ENTRY = entry;
process.env.BH_PI_EXTENSION_OUTPUT = outfile;
let compiler, session, receipt;
const notices = [];
const errors = [];
let reloads = 0;
try {
  await writeFile(path.join(cwd, "package.json"), '{"type":"module"}');
  await writeFile(entry, `
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { greeting } from "./greeting";
export default function (pi: ExtensionAPI) {
  pi.registerCommand("harness-hello", { description: "Native smoke", handler: async (_args, ctx) => ctx.ui.notify(greeting) });
  pi.registerTool({ name: "wasm_echo", label: "WASM echo", description: "Native tool schema probe",
    parameters: Type.Object({ text: Type.String() }),
    execute: async (_id, params) => ({ content: [{ type: "text", text: greeting + params.text }], details: {} }) });
  pi.on("session_start", () => pi.appendEntry("wasm-start", { greeting }));
  pi.on("session_shutdown", () => pi.appendEntry("wasm-stop", { greeting }));
}
`);
  await writeFile(helper, 'export const greeting: string = "native-v1";');
  compiler = await createExtensionCompiler({ entry, outfile });
  const first = await compiler.rebuild();
  assert.equal(first.status, "ready");
  const unchanged = await compiler.rebuild();
  assert.equal(unchanged.changed, false);
  await compiler.dispose();

  const settingsManager = sdk.SettingsManager.inMemory({ packages: [], compaction: { enabled: false } }, { projectTrusted: true });
  const loader = new sdk.DefaultResourceLoader({
    cwd, agentDir, settingsManager,
    noSkills: true, noPromptTemplates: true, noThemes: true,
    additionalExtensionPaths: [fileURLToPath(new URL("./pi-extension.mjs", import.meta.url)), outfile],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  ({ session } = await sdk.createAgentSession({ cwd, agentDir, resourceLoader: loader,
    settingsManager, sessionManager: sdk.SessionManager.inMemory(cwd), noTools: "builtin" }));
  // Fail locally if a command ever falls through to an LLM call.
  session.agent.prompt = async () => { throw new Error("Native smoke must not call a model."); };
  await session.bindExtensions({
    uiContext: { notify: (message, type) => notices.push({ message, type }) },
    commandContextActions: {
      waitForIdle: () => session.waitForIdle(),
      reload: async () => { reloads++; await session.reload(); },
    },
    onError: (error) => errors.push(error),
  });
  await session.prompt("/harness-hello");
  assert.equal(notices.at(-1).message, "native-v1");
  assert.ok(session.getAllTools().some((tool) => tool.name === "wasm_echo"));
  const echo = session.extensionRunner.getAllRegisteredTools().find((t) => t.definition.name === "wasm_echo");
  assert.equal((await echo.definition.execute("smoke-echo", { text: "!" })).content[0].text, "native-v1!");
  await writeFile(helper, 'export const greeting: string = "native-v2";');
  await session.prompt("/harness-reload");
  assert.equal(reloads, 1);
  assert.deepEqual(loader.getExtensions().errors, []);
  await session.prompt("/harness-hello");
  assert.equal(notices.at(-1).message, "native-v2");
  const lastGood = await readFile(outfile);
  await writeFile(helper, "export const greeting = (");
  await session.prompt("/harness-reload");
  assert.equal(reloads, 1);
  assert.equal(notices.at(-1).type, "error");
  assert.deepEqual(await readFile(outfile), lastGood);
  await session.prompt("/harness-hello");
  assert.equal(notices.at(-1).message, "native-v2");
  await writeFile(helper, 'export const greeting: string = "native-v3";');
  await session.prompt("/harness-reload");
  assert.equal(reloads, 2);
  await session.prompt("/harness-hello");
  assert.equal(notices.at(-1).message, "native-v3");
  await writeFile(helper, 'export const greeting: string = "native-v4";');
  const reloadTool = session.extensionRunner.getAllRegisteredTools().find((t) => t.definition.name === "harness_reload");
  const queued = await reloadTool.definition.execute("smoke-reload", {});
  assert.equal(queued.details.status, "queued");
  const deadline = Date.now() + 10000;
  while (!session.sessionManager.getEntries().some((e) => e.customType === "wasm-start" && e.data.greeting === "native-v4")) {
    assert.ok(Date.now() < deadline, "Queued tool reload did not finish.");
    await delay(20);
  }
  assert.equal(reloads, 3);
  await session.prompt("/harness-hello");
  assert.equal(notices.at(-1).message, "native-v4");
  assert.deepEqual(errors, []);
  const lifecycle = session.sessionManager.getEntries().filter((e) => ["wasm-start", "wasm-stop"].includes(e.customType));
  assert.deepEqual(lifecycle.map((e) => [e.customType, e.data.greeting]), [
    ["wasm-start", "native-v1"], ["wasm-stop", "native-v1"],
    ["wasm-start", "native-v2"], ["wasm-stop", "native-v2"], ["wasm-start", "native-v3"],
    ["wasm-stop", "native-v3"], ["wasm-start", "native-v4"],
  ]);
  receipt = { status: "passed", pi: manifest.version, node: process.version,
    platform: process.platform, arch: process.arch, reloads, lifecycleEvents: lifecycle.length,
    compilationMs: { initial: first.durationMs, unchanged: unchanged.durationMs }, bytes: first.bytes,
    modelRequests: 0 };
} finally {
  if (session) {
    await session.extensionRunner.emit({ type: "session_shutdown", reason: "quit" });
    session.dispose();
  }
  await compiler?.dispose();
  if (previousEntry === undefined) delete process.env.BH_PI_EXTENSION_ENTRY;
  else process.env.BH_PI_EXTENSION_ENTRY = previousEntry;
  if (previousOutput === undefined) delete process.env.BH_PI_EXTENSION_OUTPUT;
  else process.env.BH_PI_EXTENSION_OUTPUT = previousOutput;
  await rm(scratch, { recursive: true, force: true });
}
process.stdout.write(`${JSON.stringify(receipt)}\n`);
