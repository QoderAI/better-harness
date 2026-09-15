import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";
import { launchArguments, parseArgs } from "../../scripts/dsh-plugin-runtime/cli.mjs";

const cli = fileURLToPath(new URL("../../scripts/dsh-plugin-runtime/cli.mjs", import.meta.url));
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 20000 });

test("help and strict option parsing report actionable errors", () => {
  const result = run(["--help"]);
  assert.equal(result.status, 0); assert.match(result.stdout, /activation/);
  for (const args of [["oops"], ["build", "--entry"], ["run", "--port", "-1"], ["run", "--entry", "a", "--home", "b"]]) {
    const failure = run(args);
    assert.equal(failure.status, 1); assert.equal(failure.stdout, ""); assert.ok(failure.stderr);
  }
});

test("DSH launch keeps native paths as argv and fixes loopback/profile arguments", () => {
  const options = parseArgs(["run", "--entry", "plugin 空格.ts", "--home", "isolated home", "--dsh-cli", "dsh cli.js", "--port", "12345", "--watch"]);
  assert.deepEqual(launchArguments(options), [path.resolve("dsh cli.js"), "--profile", "wasm", "--host", "127.0.0.1", "--port", "12345", "--no-open"]);
  assert.equal(options.watch, true);
});

test("build emits JSON and syntax failure exits nonzero without changing its published patch", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh cli "));
  try {
    const entry = path.join(root, "plugin.ts");
    await writeFile(entry, "export function apply() {}");
    const args = ["build", "--entry", entry, "--home", path.join(root, "home"), "--json"];
    const good = run(args); assert.equal(good.status, 0); assert.equal(good.stderr, "");
    const receipt = JSON.parse(good.stdout); assert.equal(receipt.status, "published");
    const before = await readFile(receipt.patch);
    await writeFile(entry, "export function apply(");
    const bad = run(args); assert.equal(bad.status, 1);
    assert.equal(JSON.parse(bad.stdout).status, "failed");
    assert.deepEqual(await readFile(receipt.patch), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run --watch publishes source edits and terminates its launched DSH process", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dsh watch 空格 "));
  let child;
  try {
    const entry = path.join(root, "plugin.ts"), fakeDsh = path.join(root, "fake dsh.mjs"), home = path.join(root, "home");
    await writeFile(entry, 'export function apply(ctx) { ctx.value = "one"; }');
    await writeFile(fakeDsh, 'console.log(JSON.stringify({pid:process.pid,home:process.env.DSH_HOME,args:process.argv.slice(2)})); setInterval(()=>{},1000);');
    child = spawn(process.execPath, [cli, "run", "--entry", entry, "--home", home, "--dsh-cli", fakeDsh, "--watch", "--control-stdio"]);
    const exit = new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; }); child.stderr.on("data", (d) => { stderr += d; });
    const patch = path.join(home, "profiles", "wasm", "cordis.patch.yml");
    async function until(check) {
      const deadline = Date.now() + 15000;
      while (!(await check())) { assert.ok(Date.now() < deadline, "CLI watch did not make progress"); await delay(30); }
    }
    await until(() => stdout.includes("\n"));
    const started = JSON.parse(stdout);
    assert.equal(started.home, home);
    assert.deepEqual(started.args.slice(0, 2), ["--profile", "wasm"]);
    const first = await readFile(patch, "utf8");
    await writeFile(entry, 'export function apply(ctx) { ctx.value = "two"; }');
    await until(async () => (await readFile(patch, "utf8")) !== first);
    const second = await readFile(patch, "utf8");
    await writeFile(entry, "export function apply(");
    await until(() => stderr.includes("Expected identifier") || stderr.includes("Unexpected end"));
    assert.equal(await readFile(patch, "utf8"), second);
    child.stdin.end("stop\n");
    await exit;
    assert.throws(() => process.kill(started.pid, 0), { code: "ESRCH" });
  } finally {
    child?.kill("SIGKILL"); await rm(root, { recursive: true, force: true });
  }
});
