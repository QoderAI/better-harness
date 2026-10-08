import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "vitest";
import { launchArguments, parseArgs } from "../../scripts/pi-extension-runtime/cli.mjs";

const cli = fileURLToPath(new URL("../../scripts/pi-extension-runtime/cli.mjs", import.meta.url));
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args]);
    let stdout = "", stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
  });
}

test("help succeeds and unknown commands/options or missing values fail", async () => {
  const help = await run(["--help"]);
  assert.equal(help.code, 0);
  assert.match(help.stdout, /harness-reload/);
  for (const args of [["oops"], ["build", "--wat"], ["build", "--entry"], ["run", "--entry", "a", "--out", "b"]]) {
    const failure = await run(args);
    assert.equal(failure.code, 1);
    assert.equal(failure.stdout, "");
    assert.ok(failure.stderr.length > 0);
  }
});

test("Pi launch keeps paths and native arguments as separate argv entries", () => {
  const options = parseArgs(["run", "--entry", "source 空格.ts", "--out", "out file.ts", "--pi-cli", "pi cli.js", "--", "--no-session"]);
  const args = launchArguments(options);
  assert.equal(args[0], path.resolve("pi cli.js"));
  assert.equal(args[1], "--no-session");
  assert.equal(args.at(-1), path.resolve("out file.ts"));
  assert.equal(args.filter((value) => value === "-e").length, 2);
});

test("build emits JSON only and failed compile preserves the artifact", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi cli 空格 "));
  try {
    const entry = path.join(root, "source.ts"), outfile = path.join(root, "output.ts");
    const args = ["build", "--entry", entry, "--out", outfile, "--json"];
    await writeFile(entry, 'export default () => "ok";');
    const good = await run(args);
    assert.equal(good.code, 0);
    assert.equal(good.stderr, "");
    assert.equal(JSON.parse(good.stdout).status, "ready");
    const bytes = await readFile(outfile);
    await writeFile(entry, "export default (");
    const bad = await run(args);
    assert.equal(bad.code, 1);
    assert.equal(JSON.parse(bad.stdout).status, "failed");
    assert.deepEqual(await readFile(outfile), bytes);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("run launches the supplied JavaScript CLI with native args and selected source/output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi run 空格 "));
  try {
    const entry = path.join(root, "source.ts"), outfile = path.join(root, "output.ts");
    const fakePi = path.join(root, "fake pi.mjs");
    await writeFile(entry, 'export default () => "ready";');
    await writeFile(fakePi, 'process.stdout.write(JSON.stringify({args:process.argv.slice(2),entry:process.env.BH_PI_EXTENSION_ENTRY,outfile:process.env.BH_PI_EXTENSION_OUTPUT}));');
    const result = await run(["run", "--entry", entry, "--out", outfile, "--pi-cli", fakePi, "--", "--no-session"]);
    assert.equal(result.code, 0);
    const observed = JSON.parse(result.stdout);
    assert.equal(observed.entry, entry);
    assert.equal(observed.outfile, outfile);
    assert.equal(observed.args[0], "--no-session");
    assert.equal(observed.args.at(-1), outfile);
    await writeFile(entry, "export default (");
    const failed = await run(["run", "--entry", entry, "--out", outfile, "--pi-cli", fakePi]);
    assert.equal(failed.code, 1);
    assert.equal(failed.stdout, "", "Pi must not start after a failed initial build");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("watch observes edits, retains output on error, recovers and exits on termination", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pi watch "));
  let child;
  try {
    const entry = path.join(root, "source.ts"), outfile = path.join(root, "output.ts");
    await writeFile(entry, 'export default () => "v1";');
    child = spawn(process.execPath, [cli, "watch", "--entry", entry, "--out", outfile, "--json"]);
    const exit = new Promise((resolve, reject) => { child.once("exit", resolve); child.once("error", reject); });
    const events = []; let pending = "";
    child.stdout.on("data", (chunk) => {
      pending += chunk;
      let newline;
      while ((newline = pending.indexOf("\n")) >= 0) {
        events.push(JSON.parse(pending.slice(0, newline))); pending = pending.slice(newline + 1);
      }
    });
    async function next(status) {
      const deadline = Date.now() + 20000;
      while (!events.length) { assert.ok(Date.now() < deadline, "Watcher did not report a build"); await delay(20); }
      const event = events.shift(); assert.equal(event.status, status); return event;
    }
    const first = await next("ready");
    await writeFile(entry, 'export default () => "v2";');
    const second = await next("ready");
    assert.notEqual(second.revision, first.revision);
    const lastGood = await readFile(outfile);
    await writeFile(entry, "export default (");
    await next("failed");
    assert.deepEqual(await readFile(outfile), lastGood);
    await writeFile(entry, 'export default () => "v3";');
    await next("ready");
    child.kill("SIGTERM");
    await exit;
  } finally {
    child?.kill("SIGKILL");
    await rm(root, { recursive: true, force: true });
  }
});
