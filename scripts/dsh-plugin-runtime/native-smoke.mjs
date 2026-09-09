#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createPluginRuntime } from "./runtime.mjs";

const packageRoot = process.argv[2];
const browserCheck = process.argv.includes("--browser");
const output = path.resolve("dist/dsh-wasm-smoke");
if (!packageRoot) throw new Error("Usage: node scripts/dsh-plugin-runtime/native-smoke.mjs <installed-dsh-package-root> [--browser]");
const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
assert.equal(manifest.name, "@deepseek-ai/dsh");
assert.equal(manifest.version, "0.1.2-rc.1");
const scratch = await mkdtemp(path.join(os.tmpdir(), "native-dsh-wasm-"));
const source = path.join(scratch, "source 空格");
await cp(fileURLToPath(new URL("./examples", import.meta.url)), source, { recursive: true });
await mkdir(output, { recursive: true });
const entry = path.join(source, "plugin.ts"), helper = path.join(source, "greeting.ts");
const home = path.join(scratch, "home");
let runtime, child, browser, exit, url, receipt;
let exited = false, logs = "";
const lifecycle = [], browserErrors = [];
async function until(check, timeout = 30000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await check(); if (value) return value;
    if (exited) throw new Error(`DSH exited before verification finished: ${logs.replace(/token=[^\s]+/g, "token=[redacted]").slice(-3000)}`);
    await delay(100);
  }
  throw new Error("Timed out waiting for native DSH evidence.");
}
async function probe(expected) {
  return until(async () => {
    const response = await fetch(new URL("/harness-wasm-probe", url)).catch(() => undefined);
    if (!response?.ok) return;
    const value = await response.json();
    if (value.greeting === expected && value.toolValue === expected) return value;
  });
}
try {
  await writeFile(helper, 'export const greeting: string = "native-v1";');
  runtime = await createPluginRuntime({ entry, home });
  const first = await runtime.build(); assert.equal(first.status, "published");
  child = spawn(process.execPath, [path.join(packageRoot, manifest.bin.dsh), "--profile", "wasm", "--host", "127.0.0.1", "--port", "0", "--no-open"],
    // Select DSH's official browser directory picker for headless interaction.
    { cwd: source, env: { ...process.env, DSH_HOME: home, DSH_TELEMETRY_DISABLED: "1", SSH_CONNECTION: "native-smoke-browser-picker" }, stdio: ["ignore", "pipe", "pipe"] });
  exit = new Promise((resolve) => { child.once("exit", (code) => { exited = true; resolve(code); }); });
  child.once("error", (error) => { logs += error.message; exited = true; });
  let pending = "";
  const collect = (chunk) => {
    logs = (logs + chunk).slice(-20000);
    pending += chunk;
    let newline;
    while ((newline = pending.indexOf("\n")) >= 0) {
      const line = pending.slice(0, newline); pending = pending.slice(newline + 1);
      const start = line.indexOf("HARNESS_WASM_LIFECYCLE ");
      if (start >= 0) lifecycle.push(JSON.parse(line.slice(start + "HARNESS_WASM_LIFECYCLE ".length)));
      const match = line.match(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/);
      if (match) url = match[1];
    }
  };
  child.stdout.on("data", collect); child.stderr.on("data", collect);
  await until(() => url, 60000);
  const v1 = await probe("native-v1"); assert.equal(v1.pid, child.pid);
  assert.equal((await fetch(new URL("/harness-wasm-probe", url), { method: "POST" })).status, 405);
  let editor;
  if (browserCheck) {
    const { chromium } = await import("@playwright/test");
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on("pageerror", (error) => browserErrors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") browserErrors.push(message.text()); });
    await page.goto(url);
    const notice = page.getByRole("button", { name: "Continue", exact: true });
    await notice.waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    if (await notice.isVisible()) await notice.click();
    const later = page.getByRole("button", { name: "Configure later", exact: true });
    await later.waitFor({ state: "visible", timeout: 5000 }).catch(() => {});
    if (await later.isVisible()) await later.click();
    const workspace = page.getByRole("button", { name: "Choose workspace", exact: true });
    if (await workspace.isVisible()) {
      await workspace.click();
      await page.getByRole("button", { name: "Edit path", exact: true }).click();
      const pathField = page.getByRole("textbox", { name: "Edit path", exact: true });
      await pathField.fill(source); await pathField.press("Enter");
      await page.getByRole("button", { name: "Open", exact: true }).click();
    }
    editor = page.locator('[contenteditable="true"][role="textbox"]');
    try { await editor.waitFor({ state: "visible", timeout: 15000 }); }
    catch (error) {
      await page.screenshot({ path: path.join(output, "browser-failure.png") });
      await writeFile(path.join(output, "browser-failure.json"), JSON.stringify({ text: await page.locator("body").innerText(), errors: browserErrors }, null, 2));
      throw error;
    }
    await editor.fill("DSH runtime compiler draft, never submitted.");
    assert.equal(await editor.evaluate((el) => document.activeElement === el), true);
    await page.screenshot({ path: path.join(output, "official-web-before.png") });
  } else {
    const handoff = await fetch(url, { redirect: "manual" });
    const cookie = handoff.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
    const response = await fetch(new URL("/", url), { headers: { cookie } });
    assert.equal(response.status, 200);
    assert.ok((await response.text()).includes("__DSH_BOOT__"));
  }
  await writeFile(helper, 'export const greeting: string = "native-v2";');
  const second = await runtime.build({ onlyChanged: true }); assert.equal(second.status, "published");
  assert.notEqual(second.revision, first.revision);
  assert.equal((await probe("native-v2")).pid, v1.pid);
  await until(() => lifecycle.some((e) => e.event === "stop" && e.greeting === "native-v1"));
  const lastGood = await readFile(second.patch);
  await writeFile(helper, "export const greeting = (");
  assert.equal((await runtime.build()).status, "failed");
  assert.deepEqual(await readFile(second.patch), lastGood);
  assert.equal((await probe("native-v2")).pid, v1.pid);
  await writeFile(helper, 'export const greeting: string = "native-v3";');
  assert.equal((await runtime.build()).status, "published");
  assert.equal((await probe("native-v3")).pid, v1.pid);
  await until(() => lifecycle.some((e) => e.event === "stop" && e.greeting === "native-v2"));
  if (browser) {
    assert.equal(await editor.innerText(), "DSH runtime compiler draft, never submitted.");
    const page = browser.contexts()[0].pages()[0];
    await page.screenshot({ path: path.join(output, "official-web-after.png") });
    assert.deepEqual(browserErrors, []);
    await editor.fill(""); await browser.close(); browser = undefined;
  }
  child.kill("SIGTERM");
  const code = await Promise.race([exit, delay(7000).then(() => { throw new Error("DSH did not terminate gracefully."); })]);
  assert.equal(code, 0);
  assert.ok(lifecycle.some((e) => e.event === "stop" && e.greeting === "native-v3"));
  await assert.rejects(fetch(new URL("/harness-wasm-probe", url)));
  receipt = { status: "passed", dsh: manifest.version, node: process.version, platform: process.platform,
    nativeReloads: 2, processReused: true, browser: browserCheck, browserErrors, modelRequests: 0,
    lifecycle: lifecycle.map(({ event, greeting }) => ({ event, greeting })),
    initialCompileMs: first.durationMs, updateCompileMs: second.durationMs, moduleBytes: first.bytes };
} finally {
  await browser?.close();
  if (child && !exited) { child.kill("SIGKILL"); await exit; }
  await runtime?.dispose();
  await rm(scratch, { recursive: true, force: true });
}
await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2));
process.stdout.write(`${JSON.stringify(receipt)}\n`);
