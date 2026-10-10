import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("a Git source plugin isolates missing DSH dependencies from Codex routes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-source-plugin-"));
  try {
    const plugin = path.join(root, "plugin");
    const workspace = path.join(root, "workspace");
    const hostHome = path.join(root, "host-home");
    await mkdir(workspace);
    await mkdir(hostHome);
    await cp(path.join(repoRoot, "scripts"), path.join(plugin, "scripts"), { recursive: true });
    await cp(path.join(repoRoot, "package.json"), path.join(plugin, "package.json"));
    const run = (args) => spawnSync(process.execPath, [path.join(plugin, "scripts", "better-harness.mjs"), ...args], {
      cwd: workspace,
      encoding: "utf8",
      env: { ...process.env, HOME: hostHome, USERPROFILE: hostHome },
      timeout: 30_000,
    });

    const help = run(["--help"]);
    assert.equal(help.status, 0, help.stderr);
    const codex = run(["agent-customize", "inventory", "--provider", "codex", "--workspace", workspace,
      "--codex-home", hostHome, "--codex-app-path", path.join(root, "absent-app")]);
    assert.equal(codex.status, 0, codex.stderr);
    assert.equal(JSON.parse(codex.stdout).provider, "codex");

    const dsh = run(["agent-customize", "inventory", "--provider", "dsh", "--workspace", workspace]);
    assert.notEqual(dsh.status, 0);
    assert.match(dsh.stderr, /DSH configured-assets inventory requires the yaml runtime dependency/u);
    assert.match(dsh.stderr, /npm ci/u);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
