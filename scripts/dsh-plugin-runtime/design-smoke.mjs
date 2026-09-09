#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const packageRoot = process.argv[2];
if (!packageRoot) throw new Error("Usage: node scripts/dsh-plugin-runtime/design-smoke.mjs <installed-dsh-package-root>");
const pkg = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(pkg.version, "0.1.2-rc.1");
const scratch = await mkdtemp(path.join(tmpdir(), "design-native-"));
const output = path.resolve("dist/dsh-design-smoke"); await mkdir(output, { recursive: true });
let child, exit, url, browser;
let logs = "", exited = false;
const events = [], browserErrors = [];
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    if (exited) throw new Error("DSH exited during native validation.");
    await delay(50);
  }
  throw new Error("Native validation timed out.");
}
try {
  // Move the distribution and its declared WASM dependency outside the checkout.
  // The controller must resolve all production modules from this copied closure.
  const bundle = path.join(scratch, "distribution");
  await cp(fileURLToPath(new URL("../../packages/harness-studio/dist/server/runtime/dsh-design", import.meta.url)), bundle, { recursive: true });
  const require = createRequire(import.meta.url);
  await cp(path.dirname(require.resolve("esbuild-wasm/package.json")), path.join(scratch, "node_modules", "esbuild-wasm"), { recursive: true });
  const { prepareDshDesignProfile } = await import(pathToFileURL(path.join(bundle, "index.mjs")));
  const design = await prepareDshDesignProfile({ home: path.join(scratch, "home"), cwd: scratch });
  const overlay = JSON.parse(await readFile(design.patch, "utf8"));
  overlay[0].insert.push({ id: "design-test", name: new URL("../../test/dsh-plugin-runtime/native-probe.mjs", import.meta.url).href, config: { token: design.token, cwd: scratch } });
  await writeFile(design.patch, JSON.stringify(overlay));
  child = spawn(process.execPath, [path.join(packageRoot, pkg.bin.dsh), "--profile", "wasm", "--patch", design.patch, "--no-open", "--host", "127.0.0.1", "--port", "0"],
    { cwd: scratch, env: { ...process.env, DSH_HOME: design.home, DSH_TELEMETRY_DISABLED: "1", SSH_CONNECTION: "native-smoke-browser-picker" }, stdio: ["ignore", "pipe", "pipe"] });
  exit = new Promise(done => child.on("exit", code => { exited = true; done(code); }));
  let pending = "";
  const collect = chunk => {
    logs = (logs + chunk).slice(-30000); pending += chunk;
    let end;
    while ((end = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, end); pending = pending.slice(end + 1);
      const match = line.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/); if (match) url = match[1];
      const marker = line.indexOf("DESIGN_LIFECYCLE "); if (marker >= 0) events.push(line.slice(marker + 17));
    }
  };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  await until(() => url, 60000);
  const status = async () => {
    const response = await fetch(new URL("/harness-design/status", url), { headers: { "X-Harness-Design-Token": design.token } });
    if (!response.ok) return; return response.json();
  };
  const call = async action => {
    const response = await fetch(new URL(`/design-test?action=${action}`, url), { method: "POST", headers: { "X-Test-Token": design.token } });
    const result = await response.json(); if (!response.ok) throw new Error(result.error); return result;
  };
  await until(async () => (await status())?.phase === "idle");
  assert.equal((await fetch(new URL("/harness-design/status", url))).status, 403);
  assert.equal((await fetch(new URL("/harness-design/status", url), { method: "POST" })).status, 405);
  let editor;
  if (process.argv.includes("--browser")) {
    const { chromium } = await import("@playwright/test"); browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", error => browserErrors.push(error.message));
    page.on("console", message => { if (message.type() === "error") browserErrors.push(message.text()); });
    await page.goto(url);
    for (const name of ["Continue", "Configure later"]) {
      const button = page.getByRole("button", { name, exact: true });
      await button.waitFor({ state: "visible", timeout: 4000 }).catch(() => {}); if (await button.isVisible()) await button.click();
    }
    const choose = page.getByRole("button", { name: "Choose workspace", exact: true });
    if (await choose.isVisible()) {
      await choose.click(); await page.getByRole("button", { name: "Edit path", exact: true }).click();
      const field = page.getByRole("textbox", { name: "Edit path", exact: true });
      await field.fill(scratch); await field.press("Enter"); await page.getByRole("button", { name: "Open", exact: true }).click();
    }
    editor = page.locator('[contenteditable="true"][role="textbox"]');
    await editor.fill("Keep this official DSH draft while the plugin changes.");
    await page.screenshot({ path: path.join(output, "before.png") });
  }
  const source = (version, fail = false) => `import { defineTool } from "@deepseek-ai/dsh-tools";
export const inject = ["tools"];
export async function apply(ctx) {
 await new Promise(r => setTimeout(r, 400));
 ${fail ? 'throw new Error("intentional native apply failure");' : ''}
 console.log("DESIGN_LIFECYCLE start-${version}");
 ctx.effect(() => () => console.log("DESIGN_LIFECYCLE stop-${version}"));
 ctx.tools.register(defineTool({name:"harness_greeting",description:"Native smoke greeting",parameters:{},output:{schema:{type:"string"},render:(_a,v)=>[{type:"text",text:v}]},async execute(){return "${version}";}}));
}`;
  const compile = async version => { await writeFile(design.entry, source(version)); return call("compile"); };
  await call("busy"); await compile("v1");
  await until(async () => (await status())?.phase === "waiting");
  await delay(150); assert.equal((await status()).phase, "waiting");
  await call("release");
  await until(async () => (await status())?.phase === "activating");
  await assert.rejects(call("create"), /activating/);
  await until(async () => (await status())?.phase === "active");
  assert.equal((await call("greeting")).value, "v1");
  await call("create");
  const patch = path.join(design.home, "profiles", "wasm", "cordis.patch.yml");
  const before = await readFile(patch);
  await writeFile(design.entry, "export function apply("); await call("compile");
  await until(async () => (await status())?.phase === "error");
  assert.deepEqual(await readFile(patch), before); assert.equal((await call("greeting")).value, "v1");
  await writeFile(design.entry, source("broken", true)); await call("compile");
  await until(async () => (await status())?.phase === "error");
  assert.ok((await status()).message.includes("previous plugin restored"));
  assert.deepEqual(await readFile(patch), before); assert.equal((await call("greeting")).value, "v1");
  await compile("v2"); await until(async () => (await status())?.phase === "active");
  await delay(700); // Let native patch watcher reconcile persisted configuration.
  assert.equal((await call("greeting")).value, "v2");
  assert.equal((await call("greeting")).pid, child.pid);
  assert.equal(events.filter(event => event === "start-v2").length, 1);
  if (editor) {
    assert.equal(await editor.innerText(), "Keep this official DSH draft while the plugin changes.");
    await editor.page().screenshot({ path: path.join(output, "after.png") }); assert.deepEqual(browserErrors, []);
  }
  const final = await status();
  await browser?.close(); browser = undefined;
  child.kill("SIGTERM"); await exit;
  assert.equal(events.filter(event => event === "stop-v2").length, 1);
  const receipt = { version: pkg.version, pid: child.pid, phase: final.phase, events, copiedDistribution: true, busyDeferred: true, newAgentVeto: true, syntaxAndApplyRecovery: true, browser: Boolean(editor), browserErrors };
  await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2)); console.log(JSON.stringify(receipt));
} catch (error) {
  console.error(logs.replace(/token[=":]+[^\s",}]+/g, "token=[redacted]").slice(-6000)); throw error;
} finally {
  await browser?.close();
  if (child && !exited) { child.kill("SIGTERM"); const timer = setTimeout(() => child.kill("SIGKILL"), 3000); await exit; clearTimeout(timer); }
  await rm(scratch, { recursive: true, force: true });
}
