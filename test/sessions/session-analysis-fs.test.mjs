import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { walkFiles } from "../../scripts/session-analysis/fs.mjs";
import { collectSkillFiles } from "../../scripts/agent-customize/core/items.mjs";

const SYMLINK_TYPE = process.platform === "win32" ? "junction" : "dir";

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(os.tmpdir(), "walkfiles-symlink-"));
  try {
    // mkdtemp may return an 8.3 short path on Windows; normalize to the
    // realpath so assertions compare like for like.
    const real = await realpath(dir);
    return await fn(real);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeSkill(dir, name) {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "SKILL.md"), `# ${name}\n`, "utf8");
}

test("walkFiles does not follow directory symlinks by default", async () => {
  await withTempDir(async (root) => {
    const real = path.join(root, "real-skill");
    const linked = path.join(root, "linked-skill");
    await writeSkill(real, "real");
    await writeSkill(path.join(root, "link-target", "target-skill"), "linked");
    await symlink(path.join(root, "link-target", "target-skill"), linked, SYMLINK_TYPE);

    const files = await walkFiles(root, {
      match: (file) => path.basename(file) === "SKILL.md",
    });
    const names = files.map((file) => path.basename(path.dirname(file))).sort();
    assert.deepEqual(names, ["real-skill", "target-skill"]);
  });
});

test("walkFiles with followSymlinks: true collects files inside linked directories", async () => {
  await withTempDir(async (root) => {
    const target = path.join(root, "target", "linked-skill");
    await writeSkill(path.join(root, "real-skill"), "real");
    await writeSkill(target, "linked");
    await symlink(path.dirname(target), path.join(root, "linked-skill"), SYMLINK_TYPE);

    const files = await walkFiles(root, {
      match: (file) => path.basename(file) === "SKILL.md",
      followSymlinks: true,
    });
    const names = files.map((file) => path.basename(path.dirname(file))).sort();
    // walkFiles dedupes directories by realpath, so the linked directory is
    // collected once even though it is reachable through two paths.
    assert.deepEqual(names, ["linked-skill", "real-skill"]);
  });
});

test("walkFiles with followSymlinks does not loop forever on a self-referencing link cycle", async () => {
  await withTempDir(async (root) => {
    await writeSkill(path.join(root, "skill-a"), "a");
    await symlink(root, path.join(root, "loop"), SYMLINK_TYPE);

    const files = await walkFiles(root, {
      maxDepth: 10,
      match: (file) => path.basename(file) === "SKILL.md",
      followSymlinks: true,
    });
    // The link cycle is deduplicated by realpath, so skill-a is found once.
    assert.equal(files.length, 1);
    assert.equal(path.basename(path.dirname(files[0])), "skill-a");
  });
});

test("walkFiles with followSymlinks skips broken symlinks", async () => {
  await withTempDir(async (root) => {
    await symlink(path.join(root, "missing-target"), path.join(root, "broken"), SYMLINK_TYPE);
    const files = await walkFiles(root, { followSymlinks: true });
    assert.deepEqual(files, []);
  });
});

test("collectSkillFiles discovers skills installed via symlinks", async () => {
  await withTempDir(async (root) => {
    const target = path.join(root, "repo", "skills", "linked-skill");
    await writeSkill(target, "linked");
    const skillsRoot = path.join(root, "kimi-home", "skills");
    await mkdir(skillsRoot, { recursive: true });
    await symlink(path.dirname(target), path.join(skillsRoot, "linked-skill"), SYMLINK_TYPE);

    const items = await collectSkillFiles(skillsRoot, "user", "User", path.join(root, "kimi-home"));
    assert.equal(items.length, 1);
    assert.equal(items[0].kind, "skill");
    assert.equal(items[0].name, "linked-skill");
  });
});

test("collectSkillFiles drops plugin skills whose realpath escapes the component root", async () => {
  await withTempDir(async (root) => {
    const pluginRoot = path.join(root, "plugin");
    const skillsRoot = path.join(pluginRoot, "skills");
    await writeSkill(path.join(skillsRoot, "inside-skill"), "inside");
    // A symlink inside the plugin component root points at a skill outside it.
    const external = path.join(root, "outside-plugin-root", "external-skill");
    await writeSkill(external, "external");
    await symlink(external, path.join(skillsRoot, "linked-outside"), SYMLINK_TYPE);

    const items = await collectSkillFiles(skillsRoot, "plugin", "Plugin", pluginRoot);
    assert.deepEqual(items.map((item) => item.name), ["inside-skill"]);
  });
});
