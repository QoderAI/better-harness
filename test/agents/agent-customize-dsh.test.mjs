import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { test } from "vitest";

import { MANAGE_TABS } from "../../scripts/agent-customize/constants.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, "../..");
const PROVIDER_PATH = path.join(REPOSITORY_ROOT, "scripts", "agent-customize", "providers", "dsh.mjs");
const CLI_PATH = path.join(REPOSITORY_ROOT, "scripts", "agent-customize", "cli.mjs");
const DSH_VERSION = "0.1.1-rc.2";
const DSH_SOURCE_SHA = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";

async function loadDshProvider() {
  try {
    await access(PROVIDER_PATH);
  } catch {
    assert.fail("DSH configured-assets provider is not implemented yet");
  }
  const module = await import(`${pathToFileURL(PROVIDER_PATH).href}?red-contract=${Date.now()}`);
  assert.equal(
    typeof module.collectDshCustomizeInventory,
    "function",
    "DSH configured-assets provider must export collectDshCustomizeInventory",
  );
  return module.collectDshCustomizeInventory;
}

async function withTempRoot(prefix, callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), prefix));
  try {
    return await callback(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function write(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function skillDocument({ name, description = "Fixture skill", fields = [], body = "PRIVATE SKILL BODY" }) {
  return [
    "---",
    `name: ${name}`,
    `description: ${description}`,
    ...fields,
    "---",
    "",
    body,
    "",
  ].join("\n");
}

async function writeDirectorySkill(root, entry, values) {
  const filePath = path.join(root, entry, "SKILL.md");
  await write(filePath, skillDocument(values));
  return filePath;
}

async function writeFlatSkill(root, filename, values) {
  const filePath = path.join(root, filename);
  await write(filePath, skillDocument(values));
  return filePath;
}

async function createRepository(root, workspaceSegments = []) {
  const repository = path.join(root, "repo");
  const workspace = path.join(repository, ...workspaceSegments);
  await mkdir(path.join(repository, ".git"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  return { repository, workspace };
}

function names(items) {
  return items.map((item) => item.name);
}

function probeDshHome({ workspace, cwd, syntheticHome, envDshHome, explicitDshHome }) {
  const options = {
    workspace,
    cwd,
    includeUserHome: false,
    dshAgentsHome: path.join(syntheticHome, ".agents"),
  };
  if (explicitDshHome !== undefined) options.dshHome = explicitDshHome;
  const script = [
    `const module = await import(${JSON.stringify(pathToFileURL(PROVIDER_PATH).href)});`,
    `const result = await module.collectDshCustomizeInventory(${JSON.stringify(options)});`,
    "process.stdout.write(JSON.stringify({ dshHome: result.dshHome }));",
  ].join("\n");
  const env = {
    ...process.env,
    HOME: syntheticHome,
    USERPROFILE: syntheticHome,
    DSH_HOME: envDshHome,
  };
  const result = spawnSync(process.execPath, ["--input-type=module", "--eval", script], {
    cwd,
    encoding: "utf8",
    env,
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout).dshHome;
}

function itemByName(items, name) {
  return items.find((item) => item.name === name);
}

function assertStandardEmptyCollections(inventory) {
  assert.deepEqual(inventory.plugins, []);
  for (const key of ["plugins", "mcps", "subagents", "commands", "hooks"]) {
    assert.deepEqual(inventory.manage[key], [], key);
  }
}

async function symlinkOrSkip(t, target, linkPath, type) {
  try {
    await symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) {
      t.skip(`symbolic links unavailable: ${error.code}`);
      return false;
    }
    throw error;
  }
}

test("DSH provider owns the standard configured-assets envelope without runtime-use claims", async () => {
  await withTempRoot("better-harness-dsh-envelope-", async (root) => {
    const { repository, workspace } = await createRepository(root);
    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, cwd: workspace, includeUserHome: false });

    assert.equal(inventory.provider, "dsh");
    assert.equal(inventory.workspace, path.resolve(workspace));
    assert.equal(inventory.cwd, path.resolve(workspace));
    assert.equal(inventory.projectRoot, path.resolve(repository));
    assert.deepEqual(inventory.tabs, MANAGE_TABS);
    assert.ok(Array.isArray(inventory.manage.skills));
    assert.ok(Array.isArray(inventory.manage.rules));
    assertStandardEmptyCollections(inventory);
    assert.equal(inventory.diagnostics.evidenceKind, "configured-not-observed");
    assert.deepEqual(inventory.diagnostics.runtimeResolution, {
      cordis: false,
      profile: false,
      preset: false,
      runtimeSkills: false,
    });
    assert.doesNotMatch(JSON.stringify(inventory), /invoked|instruction followed|complete runtime/iu);
  });
});

test("DSH Skills use one-level directory and flat layouts with declared-name identity", async () => {
  await withTempRoot("better-harness-dsh-layout-", async (root) => {
    const { repository, workspace } = await createRepository(root);
    const dshSkills = path.join(repository, ".dsh", "skills");
    const agentSkills = path.join(repository, ".agents", "skills");
    await writeDirectorySkill(dshSkills, "alpha-entry", { name: "alpha", description: "DSH alpha" });
    await writeFlatSkill(dshSkills, "flat-entry.md", { name: "flat-skill", description: "Flat" });
    await writeDirectorySkill(path.join(dshSkills, "nested"), "not-valid", {
      name: "nested-skill",
      description: "Must not recurse",
    });
    await writeDirectorySkill(agentSkills, "alpha", { name: "alpha", description: "Agents shadow" });
    await writeDirectorySkill(agentSkills, "beta-entry", { name: "beta", description: "Agents beta" });

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, includeUserHome: false });

    assert.deepEqual(names(inventory.manage.skills), ["alpha", "beta", "flat-skill"]);
    assert.match(itemByName(inventory.manage.skills, "alpha").filePath, /\.dsh/u);
    assert.match(itemByName(inventory.manage.skills, "beta").filePath, /\.agents/u);
    assert.equal(itemByName(inventory.manage.skills, "nested-skill"), undefined);
  });
});

test("DSH Skill frontmatter preserves YAML types and native invocation validation", async () => {
  await withTempRoot("better-harness-dsh-yaml-", async (root) => {
    const { repository, workspace } = await createRepository(root);
    const skills = path.join(repository, ".dsh", "skills");
    await writeFlatSkill(skills, "quoted.md", {
      name: "quoted",
      description: '"Use when: a colon is present"',
      fields: ["unknown-field: accepted", "metadata: { owner: dsh, nested: { enabled: true } }"],
    });
    await write(path.join(skills, "folded.md"), [
      "---", "name: folded", "description: >", "  Folded", "  description", "---", "PRIVATE FOLDED BODY",
    ].join("\n"));
    await write(path.join(skills, "literal.md"), [
      "---", "name: literal", "description: |", "  Literal", "  description", "---", "PRIVATE LITERAL BODY",
    ].join("\n"));
    for (const [name, key, value] of [
      ["bool-true", "disable-model-invocation", "true"],
      ["bool-false", "disable-model-invocation", "FALSE"],
      ["bool-one", "user-invocable", "1"],
      ["bool-zero", "user-invocable", "0"],
      ["bool-yes", "disable-model-invocation", "YES"],
      ["bool-no", "disable-model-invocation", "no"],
      ["bool-on", "user-invocable", "ON"],
      ["bool-off", "user-invocable", "off"],
    ]) {
      await writeFlatSkill(skills, `${name}.md`, { name, fields: [`${key}: ${value}`] });
    }
    await write(path.join(skills, "missing-frontmatter.md"), "name: missing-frontmatter\ndescription: invalid\n");
    await write(path.join(skills, "malformed.md"), "---\nname: malformed\ndescription: [unterminated\n---\n");
    await write(path.join(skills, "numeric-name.md"), "---\nname: 123\ndescription: invalid\n---\n");
    await write(path.join(skills, "boolean-description.md"), "---\nname: boolean-description\ndescription: false\n---\n");
    await writeFlatSkill(skills, "bad-name.md", { name: "Bad Name" });
    await write(path.join(skills, "missing-name.md"), "---\ndescription: missing name\n---\n");
    await write(path.join(skills, "missing-description.md"), "---\nname: missing-description\n---\n");
    await writeFlatSkill(skills, "invalid-invocation.md", {
      name: "invalid-invocation",
      fields: ["user-invocable: sometimes"],
    });
    for (const [filename, legacy] of [
      ["legacy-disable.md", "disableModelInvocation"],
      ["legacy-model.md", "modelInvocable"],
      ["legacy-user.md", "userInvocable"],
    ]) {
      await writeFlatSkill(skills, filename, {
        name: filename.slice(0, -3),
        fields: [`${legacy}: true`],
      });
    }

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, includeUserHome: false });
    const found = names(inventory.manage.skills);
    for (const expected of [
      "quoted", "folded", "literal", "bool-true", "bool-false", "bool-one", "bool-zero",
      "bool-yes", "bool-no", "bool-on", "bool-off",
    ]) {
      assert.ok(found.includes(expected), expected);
    }
    for (const invalid of [
      "missing-frontmatter", "malformed", "numeric-name", "boolean-description", "Bad Name",
      "missing-name", "missing-description", "invalid-invocation", "legacy-disable", "legacy-model", "legacy-user",
    ]) {
      assert.equal(found.includes(invalid), false, invalid);
    }
    assert.match(itemByName(inventory.manage.skills, "quoted").description, /Use when: a colon is present/u);
    assert.doesNotMatch(JSON.stringify(inventory), /PRIVATE (?:FOLDED|LITERAL|SKILL) BODY/u);
    assert.equal(Object.hasOwn(itemByName(inventory.manage.skills, "quoted"), "metadata"), false);
    assert.equal(Object.hasOwn(itemByName(inventory.manage.skills, "bool-true"), "invocation"), false);
  });
});

test("DSH filesystem winners follow native ranks, malformed fallback, and custom declaration order", async () => {
  await withTempRoot("better-harness-dsh-precedence-", async (root) => {
    const { repository, workspace } = await createRepository(root);
    const customOne = path.join(root, "custom-one");
    const customTwo = path.join(root, "custom-two");
    const dshHome = path.join(root, "home", ".dsh");
    const agentsHome = path.join(root, "home", ".agents");
    const bundled = path.join(root, "bundled");
    await writeDirectorySkill(path.join(repository, ".dsh", "skills"), "winner", {
      name: "winner", description: "rank 100",
    });
    await writeDirectorySkill(path.join(repository, ".agents", "skills"), "winner", {
      name: "winner", description: "rank 200",
    });
    await write(path.join(repository, ".dsh", "skills", "fallback", "SKILL.md"),
      "---\nname: fallback\ndescription: [broken\n---\n");
    await writeDirectorySkill(path.join(repository, ".agents", "skills"), "fallback", {
      name: "fallback", description: "valid lower candidate",
    });
    await writeDirectorySkill(customOne, "tie-z", { name: "custom-tie", description: "first root" });
    await writeDirectorySkill(customTwo, "tie-a", { name: "custom-tie", description: "second root" });
    await writeFlatSkill(customOne, "a-lexical.md", { name: "lexical-tie", description: "lexically first" });
    await writeFlatSkill(customOne, "z-lexical.md", { name: "lexical-tie", description: "lexically second" });
    await writeDirectorySkill(path.join(dshHome, "skills"), "winner", { name: "winner", description: "rank 400" });
    await writeDirectorySkill(path.join(agentsHome, "skills"), "winner", { name: "winner", description: "rank 500" });
    await writeDirectorySkill(bundled, "winner", { name: "winner", description: "rank 600" });

    const collect = await loadDshProvider();
    const inventory = await collect({
      workspace,
      includeUserHome: true,
      dshHome,
      dshAgentsHome: agentsHome,
      customSkillDirs: [customOne, customTwo],
      bundledSkillDir: bundled,
    });

    assert.equal(itemByName(inventory.manage.skills, "winner").description, "rank 100");
    assert.equal(itemByName(inventory.manage.skills, "fallback").description, "valid lower candidate");
    assert.equal(itemByName(inventory.manage.skills, "custom-tie").description, "first root");
    assert.equal(itemByName(inventory.manage.skills, "lexical-tie").description, "lexically first");
    assert.equal(inventory.manage.skills.filter((item) => item.name === "winner").length, 1);
    assert.ok(inventory.diagnostics.shadowedSkills.some((item) => item.name === "winner"));
    assert.equal(inventory.diagnostics.runtimeResolution.runtimeSkills, false);
    assert.equal(inventory.diagnostics.evidenceKind, "configured-not-observed");
  });
});

test("DSH default privacy performs no ambient user/global filesystem reads", async () => {
  await withTempRoot("better-harness-dsh-no-read-", async (root) => {
    const { workspace } = await createRepository(root, ["workspace"]);
    const denied = path.join(root, "denied ambient home");
    const dshHome = path.join(denied, ".dsh");
    const agentsHome = path.join(denied, ".agents");
    const bundled = path.join(denied, "bundled");
    await writeDirectorySkill(path.join(dshHome, "skills"), "private", {
      name: "private-user-skill", description: "must not be probed",
    });
    await writeDirectorySkill(path.join(agentsHome, "skills"), "private", {
      name: "private-agents-skill", description: "must not be probed",
    });
    await write(path.join(dshHome, "AGENTS.md"), "PRIVATE GLOBAL INSTRUCTION");
    await writeDirectorySkill(bundled, "private", {
      name: "private-bundled-skill", description: "must not be probed",
    });
    await loadDshProvider();

    const script = [
      `const module = await import(${JSON.stringify(pathToFileURL(PROVIDER_PATH).href)});`,
      `const result = await module.collectDshCustomizeInventory(${JSON.stringify({
        workspace,
        cwd: workspace,
        dshHome,
        dshAgentsHome: agentsHome,
        includeUserHome: false,
      })});`,
      "if (result.diagnostics.userHomeCollection !== 'not-authorized') throw new Error('authorization state');",
      "process.stdout.write(JSON.stringify(result));",
    ].join("\n");
    const result = spawnSync(process.execPath, [
      "--permission",
      `--allow-fs-read=${REPOSITORY_ROOT}`,
      `--allow-fs-read=${path.dirname(workspace)}`,
      "--input-type=module",
      "--eval",
      script,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(root, "synthetic-os-home"),
        DSH_HOME: dshHome,
        DSH_AGENTS_HOME: agentsHome,
        DSH_BUNDLED_SKILL_DIR: bundled,
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.doesNotMatch(result.stdout, /private-(?:user|agents|bundled)-skill|PRIVATE GLOBAL/u);
  });
});

test("DSH user opt-in and explicit external roots obey distinct authorization boundaries", async () => {
  await withTempRoot("better-harness-dsh-authorized-", async (root) => {
    const { workspace } = await createRepository(root, ["workspace"]);
    const dshHome = path.join(root, "synthetic-home", ".dsh");
    const agentsHome = path.join(root, "synthetic-home", ".agents");
    const custom = path.join(root, "external", "custom");
    const customSibling = path.join(root, "external", "sibling");
    const bundled = path.join(root, "external", "bundled");
    const projectCustom = path.join(workspace, "explicit-skills");
    await writeDirectorySkill(path.join(workspace, ".dsh", "skills"), "default-project", { name: "default-project" });
    await writeDirectorySkill(path.join(dshHome, "skills"), "user", { name: "user-skill" });
    await writeDirectorySkill(path.join(dshHome, "skills", ".system"), "hidden", { name: "hidden-system-skill" });
    await writeDirectorySkill(path.join(agentsHome, "skills"), "agents", { name: "agents-skill" });
    await writeDirectorySkill(path.join(agentsHome, "skills"), ".system", { name: "agents-system-skill" });
    await write(path.join(dshHome, "AGENTS.md"), "AUTHORIZED GLOBAL INSTRUCTION");
    await writeDirectorySkill(custom, "custom", { name: "custom-skill" });
    await writeDirectorySkill(customSibling, "sibling", { name: "sibling-must-not-appear" });
    await writeDirectorySkill(bundled, "bundled", { name: "bundled-skill" });
    await writeDirectorySkill(projectCustom, "project-custom", { name: "project-custom-skill" });

    const collect = await loadDshProvider();
    const explicitOnly = await collect({
      workspace,
      includeUserHome: false,
      dshHome,
      dshAgentsHome: agentsHome,
      includeDefaultRoots: false,
      customSkillDirs: [custom, projectCustom],
      bundledSkillDir: bundled,
    });
    assert.deepEqual(names(explicitOnly.manage.skills), ["bundled-skill", "custom-skill", "project-custom-skill"]);
    assert.equal(itemByName(explicitOnly.manage.skills, "custom-skill").scope, "other");
    assert.equal(itemByName(explicitOnly.manage.skills, "project-custom-skill").scope, "project");
    assert.equal(names(explicitOnly.manage.skills).includes("default-project"), false);
    assert.equal(names(explicitOnly.manage.skills).includes("sibling-must-not-appear"), false);
    assert.equal(explicitOnly.manage.rules.length, 0);

    const optedIn = await collect({
      workspace,
      includeUserHome: true,
      dshHome,
      dshAgentsHome: agentsHome,
      customSkillDirs: [custom],
      bundledSkillDir: bundled,
    });
    assert.ok(names(optedIn.manage.skills).includes("user-skill"));
    assert.ok(names(optedIn.manage.skills).includes("agents-skill"));
    assert.ok(names(optedIn.manage.skills).includes("agents-system-skill"));
    assert.equal(names(optedIn.manage.skills).includes("hidden-system-skill"), false);
    assert.equal(optedIn.manage.rules[0].scope, "user");
    assert.equal(optedIn.diagnostics.userHomeCollection, "included");

    const relativeCustom = path.relative(process.cwd(), custom);
    const relative = await collect({ workspace, customSkillDirs: [relativeCustom] });
    assert.ok(names(relative.manage.skills).includes("custom-skill"));
    const literalTilde = await collect({ workspace, customSkillDirs: ["~/skills"] });
    assert.equal(names(literalTilde.manage.skills).includes("user-skill"), false);
    const literalAgentsHome = await collect({
      workspace,
      dshAgentsHome: "~/agents",
      includeUserHome: false,
    });
    assert.equal(literalAgentsHome.dshAgentsHome, path.resolve("~/agents"));

    const previousBundled = process.env.DSH_BUNDLED_SKILL_DIR;
    process.env.DSH_BUNDLED_SKILL_DIR = bundled;
    try {
      const ambientBundled = await collect({
        workspace,
        dshHome,
        dshAgentsHome: agentsHome,
        includeUserHome: true,
      });
      assert.ok(names(ambientBundled.manage.skills).includes("bundled-skill"));
    } finally {
      if (previousBundled === undefined) delete process.env.DSH_BUNDLED_SKILL_DIR;
      else process.env.DSH_BUNDLED_SKILL_DIR = previousBundled;
    }
  });
});

test("DSH home normalization matches native blank-environment and tilde semantics", async () => {
  await withTempRoot("better-harness-dsh-home-normalization-", async (root) => {
    const { workspace } = await createRepository(root, ["workspace"]);
    const syntheticHome = path.join(root, "synthetic home");
    await mkdir(syntheticHome, { recursive: true });

    for (const envDshHome of ["", "   "]) {
      assert.equal(
        probeDshHome({ workspace, cwd: workspace, syntheticHome, envDshHome }),
        path.join(syntheticHome, ".dsh"),
      );
    }
    for (const envDshHome of ["~/dsh-test", "~\\dsh-test"]) {
      assert.equal(
        probeDshHome({ workspace, cwd: workspace, syntheticHome, envDshHome }),
        path.join(syntheticHome, "dsh-test"),
      );
    }
    assert.equal(
      probeDshHome({
        workspace,
        cwd: workspace,
        syntheticHome,
        envDshHome: path.join(root, "environment-home"),
        explicitDshHome: "~\\dsh-test",
      }),
      path.join(syntheticHome, "dsh-test"),
    );
    assert.equal(
      probeDshHome({
        workspace,
        cwd: workspace,
        syntheticHome,
        envDshHome: path.join(root, "environment-home"),
        explicitDshHome: "",
      }),
      await realpath(workspace),
    );
  });
});

test("DSH workspace and cwd select the nearest native project root above workspace", async () => {
  await withTempRoot("better-harness-dsh-project-root-", async (root) => {
    const parentInstruction = path.join(root, "AGENTS.md");
    const { repository, workspace } = await createRepository(root, ["packages", "api"]);
    const cwd = path.join(workspace, "src");
    await mkdir(cwd, { recursive: true });
    await write(parentInstruction, "OUTSIDE NEAREST PROJECT ROOT");
    await write(path.join(repository, "AGENTS.md"), "REPOSITORY INSTRUCTION");
    await write(path.join(repository, "packages", "AGENTS.md"), "PACKAGES INSTRUCTION");
    await write(path.join(workspace, "AGENTS.md"), "API INSTRUCTION");
    await write(path.join(cwd, "AGENTS.md"), "CWD INSTRUCTION");
    await write(path.join(repository, "unrelated.txt"), "UNRELATED SIBLING SENTINEL");
    await writeDirectorySkill(path.join(repository, ".dsh", "skills"), "root-skill", { name: "root-skill" });

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, cwd, includeUserHome: false });
    assert.equal(inventory.projectRoot, path.resolve(repository));
    assert.ok(names(inventory.manage.skills).includes("root-skill"));
    assert.deepEqual(names(inventory.manage.rules), [
      "AGENTS.md",
      path.join("packages", "AGENTS.md"),
      path.join("packages", "api", "AGENTS.md"),
      path.join("packages", "api", "src", "AGENTS.md"),
    ]);
    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, /OUTSIDE NEAREST PROJECT ROOT|UNRELATED SIBLING SENTINEL/u);

    const permissionScript = [
      `const module = await import(${JSON.stringify(pathToFileURL(PROVIDER_PATH).href)});`,
      `const result = await module.collectDshCustomizeInventory(${JSON.stringify({
        workspace,
        cwd,
        includeUserHome: false,
      })});`,
      `if (result.projectRoot !== ${JSON.stringify(path.resolve(repository))}) throw new Error('project root');`,
    ].join("\n");
    const bounded = spawnSync(process.execPath, [
      "--permission",
      `--allow-fs-read=${REPOSITORY_ROOT}`,
      `--allow-fs-read=${repository}`,
      "--input-type=module",
      "--eval",
      permissionScript,
    ], { encoding: "utf8", env: { ...process.env, HOME: path.join(root, "synthetic-home") } });
    assert.equal(bounded.status, 0, bounded.stderr);

    const defaultCwd = await collect({ workspace, includeUserHome: false });
    assert.equal(defaultCwd.cwd, path.resolve(workspace));
    await assert.rejects(() => collect({ workspace, cwd: root }), /cwd|workspace/iu);
    await assert.rejects(() => collect({ workspace, cwd: path.join(root, "missing") }), /cwd|directory/iu);
    const fileCwd = path.join(workspace, "file.txt");
    await write(fileCwd, "not a directory");
    await assert.rejects(() => collect({ workspace, cwd: fileCwd }), /cwd|directory/iu);
    await assert.rejects(() => collect({ workspace: path.join(root, "missing-workspace") }), /workspace|directory/iu);
    await assert.rejects(() => collect({ workspace: fileCwd }), /workspace|directory/iu);
  });
});

test("DSH Instructions preserve global, root-to-cwd, base, and local candidate order", async () => {
  await withTempRoot("better-harness-dsh-instruction-order-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["packages", "api"]);
    const cwd = path.join(workspace, "src");
    const dshHome = path.join(root, "fake DSH home");
    await mkdir(cwd, { recursive: true });
    await write(path.join(dshHome, "AGENTS.md"), "GLOBAL");
    await write(path.join(repository, "AGENTS.md"), "ROOT AGENTS");
    await write(path.join(repository, "CLAUDE.md"), "ROOT CLAUDE");
    await write(path.join(repository, "packages", "AGENTS.md"), "PACKAGES AGENTS");
    await write(path.join(workspace, "AGENTS.md"), "API AGENTS");
    await write(path.join(workspace, "CLAUDE.md"), "API CLAUDE");
    await write(path.join(workspace, "AGENTS.local.md"), "API AGENTS LOCAL");
    await write(path.join(workspace, "CLAUDE.local.md"), "API CLAUDE LOCAL");
    await write(path.join(cwd, "AGENTS.md"), "SRC AGENTS");

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, cwd, dshHome, includeUserHome: true });
    assert.deepEqual(names(inventory.manage.rules), [
      "$DSH_HOME/AGENTS.md",
      "AGENTS.md",
      "CLAUDE.md",
      path.join("packages", "AGENTS.md"),
      path.join("packages", "api", "AGENTS.md"),
      path.join("packages", "api", "CLAUDE.md"),
      path.join("packages", "api", "AGENTS.local.md"),
      path.join("packages", "api", "CLAUDE.local.md"),
      path.join("packages", "api", "src", "AGENTS.md"),
    ]);
  });
});

test("DSH Instruction candidates filter path values and deduplicate paths and same-directory content", async () => {
  await withTempRoot("better-harness-dsh-instruction-dedup-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["project"]);
    await write(path.join(repository, "AGENTS.md"), "SAME CONTENT\n");
    await write(path.join(repository, "CLAUDE.md"), "  SAME CONTENT  \n");
    await write(path.join(workspace, "AGENTS.md"), "SAME CONTENT");
    await write(path.join(workspace, "CUSTOM.md"), "CUSTOM SENTINEL PROSE");
    const absoluteCandidate = path.join(repository, "CUSTOM.md");

    const collect = await loadDshProvider();
    const inventory = await collect({
      workspace,
      instructionFileCandidates: [
        "", ".", "..", absoluteCandidate, "nested/AGENTS.md", "nested\\AGENTS.md",
        "AGENTS.md", "AGENTS.md", "CLAUDE.md", "CUSTOM.md",
      ],
      localInstructionFileCandidates: [],
    });
    assert.deepEqual(names(inventory.manage.rules), [
      "AGENTS.md",
      path.join("project", "AGENTS.md"),
      path.join("project", "CUSTOM.md"),
    ]);
    assert.ok(inventory.diagnostics.instructionDecisions.some((item) => item.reason === "duplicate-content"));
    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, /SAME CONTENT|CUSTOM SENTINEL PROSE/u);
    assert.equal(/digest|sha1|sha-1/iu.test(serialized), false);
  });
});

test("DSH Instruction source limits exclude failed sources without collapsing independent rules", async (t) => {
  await withTempRoot("better-harness-dsh-source-limit-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["project"]);
    await write(path.join(repository, "AGENTS.md"), "under");
    await write(path.join(repository, "CLAUDE.md"), "this source is over the limit");
    await mkdir(path.join(repository, "AGENTS.local.md"), { recursive: true });
    await symlinkOrSkip(t, path.join(root, "missing-target"), path.join(repository, "CLAUDE.local.md"), "file");

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace, maxSourceBytes: 8, maxBytes: 65_536 });
    assert.deepEqual(names(inventory.manage.rules), ["AGENTS.md"]);
    assert.ok(inventory.diagnostics.instructionDecisions.some((item) => item.reason === "source-too-large"));

    const disappearing = path.join(workspace, "AGENTS.md");
    await write(disappearing, "disappears after stat");
    const disappearingProbe = spawnSync(process.execPath, [
      "--experimental-test-module-mocks",
      "--input-type=module",
      "--eval",
      String.raw`
        import { mock } from "node:test";
        import path from "node:path";
        import { pathToFileURL } from "node:url";
        const actual = await import("node:fs/promises");
        const watched = path.resolve(process.env.DSH_DISAPPEARING_SOURCE);
        let removed = false;
        mock.module("node:fs/promises", {
          namedExports: {
            ...actual,
            stat: async (candidate, ...args) => {
              const result = await actual.stat(candidate, ...args);
              if (!removed && path.resolve(String(candidate)) === watched) {
                removed = true;
                await actual.rm(watched, { force: true });
              }
              return result;
            },
          },
        });
        const provider = await import(pathToFileURL(process.env.DSH_PROVIDER_PATH).href);
        const inventory = await provider.collectDshCustomizeInventory({
          workspace: process.env.DSH_WORKSPACE,
          maxSourceBytes: 1_000,
          maxBytes: 65_536,
        });
        process.stdout.write(JSON.stringify({
          names: inventory.manage.rules.map((item) => item.name),
          decisions: inventory.diagnostics.instructionDecisions,
        }));
        mock.restoreAll();
      `,
    ], {
      encoding: "utf8",
      env: {
        ...process.env,
        HOME: path.join(root, "synthetic-home"),
        DSH_DISAPPEARING_SOURCE: disappearing,
        DSH_PROVIDER_PATH: PROVIDER_PATH,
        DSH_WORKSPACE: workspace,
      },
    });
    assert.equal(disappearingProbe.status, 0, disappearingProbe.stderr);
    const disappearingResult = JSON.parse(disappearingProbe.stdout);
    assert.equal(disappearingResult.names.includes(path.join(path.basename(workspace), "AGENTS.md")), false);
    assert.ok(disappearingResult.names.includes("AGENTS.md"));
    assert.ok(disappearingResult.decisions.some((item) => item.reason === "unavailable"));

    if (process.platform !== "win32") {
      const unreadable = path.join(workspace, "AGENTS.md");
      await write(unreadable, "unreadable");
      await chmod(unreadable, 0o000);
      try {
        const withUnreadable = await collect({ workspace, maxSourceBytes: 1_000, maxBytes: 65_536 });
        assert.equal(names(withUnreadable.manage.rules).includes(path.join(path.basename(workspace), "AGENTS.md")), false);
        assert.ok(names(withUnreadable.manage.rules).includes("AGENTS.md"));
      } finally {
        await chmod(unreadable, 0o600);
      }
    }
  });
});

test("DSH aggregate budgeting exposes only natively represented Instruction sources", async () => {
  await withTempRoot("better-harness-dsh-budget-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["deep"]);
    const cwd = path.join(workspace, "src");
    await mkdir(cwd, { recursive: true });
    await write(path.join(repository, "AGENTS.md"), "b".repeat(40_000));
    await write(path.join(workspace, "AGENTS.md"), "m".repeat(40_000));
    await write(path.join(cwd, "AGENTS.md"), "🙂".repeat(8_000));
    const collect = await loadDshProvider();

    const full = await collect({ workspace, cwd, maxBytes: 200_000 });
    assert.equal(full.manage.rules.length, 3);

    const suffix = await collect({ workspace, cwd, maxBytes: 10_000 });
    assert.deepEqual(names(suffix.manage.rules), [path.join("deep", "src", "AGENTS.md")]);
    assert.ok(suffix.diagnostics.instructionDecisions.some((item) => item.reason === "budget-omitted"));
    assert.ok(suffix.diagnostics.instructionDecisions.some((item) => item.reason === "budget-truncated"));

    await write(path.join(cwd, "AGENTS.md"), "");
    const empty = await collect({ workspace, cwd, maxBytes: 512 });
    assert.ok(names(empty.manage.rules).includes(path.join("deep", "src", "AGENTS.md")));

    await write(path.join(cwd, "AGENTS.md"), "non-empty");
    const noticeOnly = await collect({ workspace, cwd, maxBytes: 8 });
    assert.deepEqual(noticeOnly.manage.rules, []);
    assert.ok(noticeOnly.diagnostics.instructionDecisions.some((item) => item.reason === "budget-not-represented"));

    const disabled = await collect({ workspace, cwd, maxBytes: 0 });
    assert.deepEqual(disabled.manage.rules, []);
    assert.equal(disabled.diagnostics.instructionCollection, "disabled-by-byte-limit");

    for (const limits of [
      { maxSourceBytes: 0 },
      { maxSourceBytes: -1 },
      { maxSourceBytes: Number.POSITIVE_INFINITY },
      { maxBytes: Number.NaN },
    ]) {
      const sourceDisabled = await collect({ workspace, cwd, ...limits });
      assert.deepEqual(sourceDisabled.manage.rules, []);
      assert.equal(sourceDisabled.diagnostics.instructionCollection, "disabled-by-byte-limit");
    }
  });
});

test("DSH aggregate budgeting preserves raw whitespace-heavy Instruction bytes", async () => {
  await withTempRoot("better-harness-dsh-raw-budget-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["nested"]);
    const rootContent = `ROOT${" ".repeat(400)}`;
    const leafContent = `LEAF${" ".repeat(400)}`;
    assert.equal(Buffer.byteLength(rootContent, "utf8"), 404);
    assert.equal(Buffer.byteLength(leafContent, "utf8"), 404);
    await write(path.join(repository, "AGENTS.md"), rootContent);
    await write(path.join(workspace, "AGENTS.md"), leafContent);

    const collect = await loadDshProvider();
    const inventory = await collect({
      workspace,
      cwd: workspace,
      maxBytes: 512,
      maxSourceBytes: 1_048_576,
    });

    assert.deepEqual(names(inventory.manage.rules), [path.join("nested", "AGENTS.md")]);
    assert.ok(inventory.diagnostics.instructionDecisions.some((item) => (
      item.path === "AGENTS.md" && item.reason === "budget-omitted"
    )));
    assert.ok(inventory.diagnostics.instructionDecisions.some((item) => (
      item.path === path.join("nested", "AGENTS.md") && item.reason === "budget-truncated"
    )));
    assert.doesNotMatch(JSON.stringify(inventory), /ROOT|LEAF/u);
  });
});

test("DSH symlinks retain authorized lexical evidence without exposing target realpaths", async (t) => {
  await withTempRoot("better-harness-dsh-links-", async (root) => {
    const { repository, workspace } = await createRepository(root, ["workspace with 空格"]);
    const external = path.join(root, "off-tree target 空格");
    const externalSkillDir = path.join(external, "directory-skill");
    const externalSkillFile = path.join(external, "file-skill.md");
    const externalInstruction = path.join(external, "instruction.md");
    await write(path.join(externalSkillDir, "SKILL.md"), skillDocument({ name: "linked-directory" }));
    await write(externalSkillFile, skillDocument({ name: "linked-file" }));
    await write(externalInstruction, "PRIVATE OFF-TREE INSTRUCTION PROSE");
    const skills = path.join(repository, ".dsh", "skills");
    await mkdir(skills, { recursive: true });
    if (!await symlinkOrSkip(t, externalSkillDir, path.join(skills, "directory-link"), process.platform === "win32" ? "junction" : "dir")) return;
    if (!await symlinkOrSkip(t, externalSkillFile, path.join(skills, "file-link.md"), "file")) return;
    await symlinkOrSkip(t, path.join(root, "broken"), path.join(skills, "broken-link.md"), "file");
    if (!await symlinkOrSkip(t, externalInstruction, path.join(workspace, "AGENTS.md"), "file")) return;

    const collect = await loadDshProvider();
    const inventory = await collect({ workspace });
    assert.ok(names(inventory.manage.skills).includes("linked-directory"));
    assert.ok(names(inventory.manage.skills).includes("linked-file"));
    assert.equal(names(inventory.manage.skills).includes("broken-link"), false);
    assert.ok(names(inventory.manage.rules).includes(path.join("workspace with 空格", "AGENTS.md")));
    const serialized = JSON.stringify(inventory);
    assert.doesNotMatch(serialized, new RegExp(external.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
    assert.doesNotMatch(serialized, /PRIVATE OFF-TREE INSTRUCTION PROSE/u);
    for (const item of [...inventory.manage.skills, ...inventory.manage.rules]) {
      assert.equal(path.isAbsolute(item.evidence.path), true);
    }
  });
});

test("DSH diagnostics stay minimal, deterministic, and bounded", async () => {
  await withTempRoot("better-harness-dsh-diagnostics-", async (root) => {
    const { repository, workspace } = await createRepository(root);
    const skills = path.join(repository, ".dsh", "skills");
    await writeDirectorySkill(skills, "winner", { name: "winner" });
    await writeDirectorySkill(path.join(repository, ".agents", "skills"), "winner", { name: "winner" });
    await mkdir(skills, { recursive: true });
    await Promise.all(Array.from({ length: 512 }, (_, index) => write(
      path.join(skills, `malformed-${String(index).padStart(3, "0")}.md`),
      "---\nname: [broken\n---\n",
    )));
    await write(path.join(repository, "AGENTS.md"), "duplicate");
    await write(path.join(repository, "CLAUDE.md"), " duplicate \n");

    const collect = await loadDshProvider();
    const first = await collect({ workspace });
    const second = await collect({ workspace });
    const diagnostics = first.diagnostics;
    assert.equal(diagnostics.qualifiedDshVersion, DSH_VERSION);
    assert.equal(diagnostics.qualifiedDshSourceSha, DSH_SOURCE_SHA);
    assert.equal(diagnostics.evidenceKind, "configured-not-observed");
    assert.equal(diagnostics.configurationSource, "qualified-defaults");
    assert.equal(diagnostics.userHomeCollection, "not-authorized");
    assert.deepEqual(diagnostics.runtimeResolution, {
      cordis: false,
      profile: false,
      preset: false,
      runtimeSkills: false,
    });
    assert.equal(diagnostics.shadowedSkills.length, 1);
    assert.ok(diagnostics.skippedSkills.length > 0);
    assert.ok(diagnostics.skippedSkills.length < 512);
    assert.ok(diagnostics.instructionDecisions.some((item) => item.reason === "duplicate-content"));
    assert.equal(diagnostics.diagnosticsTruncated, true);
    assert.deepEqual(second.diagnostics, diagnostics);
    for (const removed of [
      "rootCount", "entryCount", "validCandidateCount", "effectiveCount", "candidateCount",
      "observedCount", "deduplicatedCount", "includedCount", "shadowedOmittedCount",
      "skippedOmittedCount", "instructionOutcomeOmittedCount",
    ]) {
      assert.equal(Object.hasOwn(diagnostics, removed), false, removed);
    }
  });
});

test("agent-customize exposes only the minimal public DSH CLI surface", async () => {
  await withTempRoot("better-harness-dsh-cli-", async (root) => {
    const { workspace } = await createRepository(root);
    const dshHome = path.join(root, "dsh-home");
    const help = spawnSync(process.execPath, [CLI_PATH, "--help"], {
      encoding: "utf8",
      env: { ...process.env, HOME: path.join(root, "synthetic-home") },
    });
    assert.equal(help.status, 0, help.stderr);
    assert.match(help.stdout, /\bdsh\b/u);
    assert.match(help.stdout, /--workspace/u);
    assert.match(help.stdout, /--cwd/u);
    assert.match(help.stdout, /--dsh-home/u);
    assert.match(help.stdout, /--include-user-home/u);
    for (const flag of [
      "--dsh-agents-home",
      "--dsh-custom-skill-dir",
      "--dsh-bundled-skill-dir",
      "--dsh-include-default-roots",
      "--dsh-project-root-marker",
      "--dsh-instruction-file-candidate",
      "--dsh-local-instruction-file-candidate",
      "--dsh-max-instruction-bytes",
      "--dsh-max-instruction-source-bytes",
    ]) {
      assert.equal(help.stdout.includes(flag), false, flag);
    }

    const inventory = spawnSync(process.execPath, [
      CLI_PATH,
      "inventory",
      "--provider", "dsh",
      "--workspace", workspace,
      "--cwd", workspace,
      "--dsh-home", dshHome,
      "--include-user-home=false",
    ], {
      encoding: "utf8",
      env: { ...process.env, HOME: path.join(root, "synthetic-home") },
    });
    assert.equal(inventory.status, 0, inventory.stderr);
    const payload = JSON.parse(inventory.stdout);
    assert.equal(payload.provider, "dsh");
    assert.equal(payload.cwd, path.resolve(workspace));
    assert.equal(payload.dshHome, path.resolve(dshHome));
    assert.equal(payload.diagnostics.userHomeCollection, "not-authorized");
  });
});
