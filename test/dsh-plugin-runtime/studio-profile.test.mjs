import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vitest";
import { prepareDshDesignProfile } from "../../scripts/dsh-plugin-runtime/index.mjs";

test("owns an isolated profile, preserves edited source and keeps broken source out of startup", async () => {
  const cwd = await mkdtemp(path.join(tmpdir(), "design 空格 "));
  try {
    const home = path.join(cwd, "home");
    const first = await prepareDshDesignProfile({ cwd, home });
    const patch = path.join(home, "profiles", "wasm", "cordis.patch.yml");
    const before = await readFile(patch);
    const controller = JSON.parse(await readFile(first.patch, "utf8"))[0].insert[0];
    assert.equal(controller.id, "harness-design-controller");
    assert.equal(controller.config.entry, first.entry);
    await writeFile(first.entry, "invalid TypeScript (");
    const again = await prepareDshDesignProfile({ cwd, home });
    assert.equal(await readFile(first.entry, "utf8"), "invalid TypeScript (");
    assert.deepEqual(await readFile(patch), before);
    assert.notEqual(first.token, again.token);
    const row = JSON.parse(before)[0].insert[0];
    await writeFile(path.join(home, 'profiles', 'wasm', 'modules', path.posix.basename(row.name)), 'corrupted module');
    await assert.rejects(prepareDshDesignProfile({ cwd, home }), /content digest/);
  } finally { await rm(cwd, { recursive: true, force: true }); }
});
