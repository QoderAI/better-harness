#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, "../..");
const AGENT_CUSTOMIZE_PATH = path.join(REPOSITORY_ROOT, "scripts", "agent-customize", "index.mjs");
const DSH_NATIVE_VERSION = "0.1.1-rc.2";
const DSH_NATIVE_SOURCE_SHA = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const DSH_PACKAGES = [
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-agent-instructions",
  "@deepseek-ai/dsh-fs",
  "@deepseek-ai/dsh-fs-local",
  "@deepseek-ai/dsh-home-paths",
  "@deepseek-ai/dsh-invariants",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-scope",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-skill",
  "@deepseek-ai/dsh-skill-filesystem",
  "@deepseek-ai/dsh-tools",
];

async function installNativeOwners(prefix) {
  const specs = [
    "@deepseek-ai/cordis@4.0.1",
    ...DSH_PACKAGES.map((packageName) => `${packageName}@${DSH_NATIVE_VERSION}`),
  ];
  const args = [
    "install",
    "--prefix", prefix,
    "--no-package-lock",
    "--no-save",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    ...specs,
  ];
  const npmCli = process.env.npm_execpath;
  const command = npmCli ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const commandArgs = npmCli ? [npmCli, ...args] : args;
  await new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      stdio: "inherit",
      shell: !npmCli && process.platform === "win32",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`native DSH owner install failed (${signal ?? code})`));
    });
  });
}

async function write(filePath, content) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content, "utf8");
}

function skill(name, description, body = "NATIVE PRIVATE SKILL BODY") {
  return ["---", `name: ${name}`, `description: ${description}`, "---", "", body, ""].join("\n");
}

async function directorySkill(root, entry, name, description) {
  const filePath = path.join(root, entry, "SKILL.md");
  await write(filePath, skill(name, description));
  return filePath;
}

async function loadPackage(nodeModules, packageName) {
  const packageRoot = path.join(nodeModules, ...packageName.split("/"));
  const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
  if (packageName.startsWith("@deepseek-ai/dsh-")) {
    assert.equal(manifest.version, DSH_NATIVE_VERSION, `${packageName} must remain pinned`);
  }
  return import(pathToFileURL(path.join(packageRoot, manifest.main ?? "lib/index.js")));
}

async function createFixture(scratch) {
  const repository = path.join(scratch, "repo with 空格");
  const workspace = path.join(repository, "packages", "api");
  const cwd = path.join(workspace, "src");
  const dshHome = path.join(scratch, "dsh home");
  const agentsHome = path.join(scratch, "agents home");
  const customOne = path.join(scratch, "custom-one");
  const customTwo = path.join(scratch, "custom-two");
  const bundled = path.join(scratch, "bundled");
  const external = path.join(scratch, "external targets");
  await mkdir(path.join(repository, ".git"), { recursive: true });
  await mkdir(cwd, { recursive: true });

  await directorySkill(path.join(repository, ".dsh", "skills"), "alpha", "alpha", "project dsh");
  await write(path.join(repository, ".dsh", "skills", "flat.md"), skill("flat-skill", "flat"));
  await write(path.join(repository, ".dsh", "skills", "fallback", "SKILL.md"),
    "---\nname: fallback\ndescription: [broken\n---\n");
  await directorySkill(path.join(repository, ".agents", "skills"), "alpha", "alpha", "project agents shadow");
  await directorySkill(path.join(repository, ".agents", "skills"), "beta", "beta", "project agents");
  await directorySkill(path.join(repository, ".agents", "skills"), "fallback", "fallback", "valid fallback");
  await directorySkill(customOne, "custom", "custom-skill", "custom one");
  await directorySkill(customOne, "tie-z", "custom-tie", "first custom root");
  await directorySkill(customTwo, "tie-a", "custom-tie", "second custom root");
  await directorySkill(path.join(dshHome, "skills"), "user", "user-skill", "user dsh");
  await directorySkill(path.join(agentsHome, "skills"), "agents", "agents-skill", "user agents");
  await directorySkill(bundled, "bundled", "bundled-skill", "bundled");

  const symlinkCases = { file: false, directory: false, broken: false };
  const externalSkill = path.join(external, "linked.md");
  const externalSkillDirectory = path.join(external, "linked-directory");
  const brokenSkillTarget = path.join(external, "broken.md");
  await write(externalSkill, skill("linked-skill", "linked file"));
  await directorySkill(externalSkillDirectory, "entry", "linked-directory-skill", "linked directory");
  await write(brokenSkillTarget, skill("broken-skill", "removed target"));
  await mkdir(customOne, { recursive: true });
  for (const [kind, target, linkPath, type] of [
    ["file", externalSkill, path.join(customOne, "linked.md"), "file"],
    [
      "directory",
      path.join(externalSkillDirectory, "entry"),
      path.join(customOne, "linked-directory"),
      process.platform === "win32" ? "junction" : "dir",
    ],
    ["broken", brokenSkillTarget, path.join(customOne, "broken.md"), "file"],
  ]) {
    try {
      await symlink(target, linkPath, type);
      symlinkCases[kind] = true;
    } catch (error) {
      if (!["EPERM", "EACCES", "ENOSYS"].includes(error?.code)) throw error;
    }
  }
  if (symlinkCases.broken) await rm(brokenSkillTarget, { force: true });

  await write(path.join(dshHome, "AGENTS.md"), "GLOBAL NATIVE INSTRUCTION");
  await write(path.join(repository, "AGENTS.md"), "ROOT NATIVE INSTRUCTION");
  await write(path.join(repository, "CLAUDE.md"), "ROOT CLAUDE INSTRUCTION");
  await write(path.join(repository, "packages", "AGENTS.md"), "PACKAGES NATIVE INSTRUCTION");
  await write(path.join(workspace, "AGENTS.md"), "SAME API INSTRUCTION\n");
  await write(path.join(workspace, "CLAUDE.md"), "  SAME API INSTRUCTION  \n");
  await write(path.join(workspace, "AGENTS.local.md"), "API LOCAL INSTRUCTION");
  await write(path.join(cwd, "AGENTS.md"), "🙂".repeat(2_000));

  return {
    repository,
    workspace,
    cwd,
    dshHome,
    agentsHome,
    customOne,
    customTwo,
    bundled,
    external,
    symlinkCases,
  };
}

async function verifyNativeOwners(nodeModules, fixture) {
  const { Context } = await loadPackage(nodeModules, "@deepseek-ai/cordis");
  const { default: SkillRegistry } = await loadPackage(nodeModules, "@deepseek-ai/dsh-skill");
  const SkillFileSystem = await loadPackage(nodeModules, "@deepseek-ai/dsh-skill-filesystem");
  const Instructions = await loadPackage(nodeModules, "@deepseek-ai/dsh-agent-instructions");

  const ctx = new Context();
  await ctx.plugin(SkillRegistry);
  await ctx.plugin(SkillFileSystem, {
    dshHome: fixture.dshHome,
    agentsHome: fixture.agentsHome,
    customSkillDirs: [fixture.customOne, fixture.customTwo],
    bundledSkillDir: fixture.bundled,
    includeDefaultRoots: true,
    watch: false,
  });
  const snapshot = await ctx.skills.snapshot({ cwd: fixture.cwd });
  const skillNames = snapshot.skills.map((entry) => entry.name);
  assert.deepEqual(skillNames, [
    "agents-skill",
    "alpha",
    "beta",
    "bundled-skill",
    "custom-skill",
    "custom-tie",
    "fallback",
    "flat-skill",
    ...(fixture.symlinkCases.directory ? ["linked-directory-skill"] : []),
    ...(fixture.symlinkCases.file ? ["linked-skill"] : []),
    "user-skill",
  ]);
  assert.equal(skillNames.includes("broken-skill"), false);
  assert.equal(snapshot.skills.find((entry) => entry.name === "alpha")?.source, "project-dsh");
  assert.equal(snapshot.skills.find((entry) => entry.name === "fallback")?.source, "project-agents");
  assert.equal(snapshot.skills.find((entry) => entry.name === "custom-tie")?.description, "first custom root");

  const discovered = await Instructions.discoverBaselineInstructionFiles({
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
  });
  assert.deepEqual(discovered.map((file) => file.displayPath), [
    "$DSH_HOME/AGENTS.md",
    "AGENTS.md",
    "CLAUDE.md",
    path.join("packages", "AGENTS.md"),
    path.join("packages", "api", "AGENTS.md"),
    path.join("packages", "api", "CLAUDE.md"),
    path.join("packages", "api", "AGENTS.local.md"),
    path.join("packages", "api", "src", "AGENTS.md"),
  ]);

  const full = await Instructions.loadBaselineInstructions({
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
    maxSourceBytes: 1_048_576,
    maxBytes: 65_536,
  });
  assert.ok(full);
  assert.equal(Buffer.byteLength(full.text, "utf8") <= 65_536, true);
  assert.match(full.text, /GLOBAL NATIVE INSTRUCTION/u);
  assert.match(full.text, /ROOT NATIVE INSTRUCTION/u);
  assert.match(full.text, /SAME API INSTRUCTION/u);
  assert.equal(full.text.includes(`Instructions from: ${path.join("packages", "api", "CLAUDE.md")}`), false);
  assert.doesNotMatch(full.text, /�/u);

  const sourceBounded = await Instructions.loadBaselineInstructions({
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
    maxSourceBytes: 64,
    maxBytes: 65_536,
  });
  assert.ok(sourceBounded);
  assert.equal(sourceBounded.text.includes(path.join("packages", "api", "src", "AGENTS.md")), false);

  const budgeted = await Instructions.loadBaselineInstructions({
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
    maxSourceBytes: 1_048_576,
    maxBytes: 1_024,
  });
  assert.ok(budgeted);
  assert.equal(Buffer.byteLength(budgeted.text, "utf8") <= 1_024, true);
  assert.ok(budgeted.omitted.length > 0 || budgeted.truncated.length > 0);
  assert.doesNotMatch(budgeted.text, /�/u);

  return {
    skillNames,
    instructionCandidates: discovered.map((file) => file.displayPath),
    deduplicatedApiClaude: !full.text.includes(`Instructions from: ${path.join("packages", "api", "CLAUDE.md")}`),
    sourceLimit: "verified",
    aggregateBudget: "verified",
    utf8: "verified",
    symlinkCases: fixture.symlinkCases,
  };
}

async function compareBetterHarness(fixture, native) {
  try {
    await access(AGENT_CUSTOMIZE_PATH);
  } catch {
    throw new Error("DSH configured-assets provider is not implemented yet; native DSH half passed");
  }
  const { collectAgentCustomizeInventory } = await import(pathToFileURL(AGENT_CUSTOMIZE_PATH));
  assert.equal(typeof collectAgentCustomizeInventory, "function");

  const optedIn = await collectAgentCustomizeInventory({
    provider: "dsh",
    workspace: fixture.workspace,
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
    dshAgentsHome: fixture.agentsHome,
    customSkillDirs: [fixture.customOne, fixture.customTwo],
    bundledSkillDir: fixture.bundled,
    includeUserHome: true,
  });
  assert.deepEqual(optedIn.manage.skills.map((entry) => entry.name), native.skillNames);
  assert.equal(optedIn.projectRoot, fixture.repository);
  assert.deepEqual(optedIn.manage.rules.map((entry) => entry.name), [
    "$DSH_HOME/AGENTS.md",
    "AGENTS.md",
    "CLAUDE.md",
    path.join("packages", "AGENTS.md"),
    path.join("packages", "api", "AGENTS.md"),
    path.join("packages", "api", "AGENTS.local.md"),
    path.join("packages", "api", "src", "AGENTS.md"),
  ]);

  const defaultClosed = await collectAgentCustomizeInventory({
    provider: "dsh",
    workspace: fixture.workspace,
    cwd: fixture.cwd,
    dshHome: fixture.dshHome,
    dshAgentsHome: fixture.agentsHome,
    includeUserHome: false,
  });
  assert.equal(defaultClosed.manage.skills.some((entry) => ["user-skill", "agents-skill"].includes(entry.name)), false);
  assert.equal(defaultClosed.manage.rules.some((entry) => entry.scope === "user"), false);

  const explicit = await collectAgentCustomizeInventory({
    provider: "dsh",
    workspace: fixture.workspace,
    cwd: fixture.cwd,
    customSkillDirs: [fixture.customOne],
    bundledSkillDir: fixture.bundled,
    includeUserHome: false,
  });
  assert.ok(explicit.manage.skills.some((entry) => entry.name === "custom-skill"));
  assert.ok(explicit.manage.skills.some((entry) => entry.name === "bundled-skill"));

  const budgeted = await collectAgentCustomizeInventory({
    provider: "dsh",
    workspace: fixture.workspace,
    cwd: fixture.cwd,
    maxBytes: 1_024,
    maxSourceBytes: 1_048_576,
  });
  assert.ok(budgeted.diagnostics.instructionDecisions.some((entry) => (
    entry.reason === "budget-omitted" || entry.reason === "budget-truncated"
  )));
  assert.doesNotMatch(JSON.stringify(optedIn), /NATIVE PRIVATE SKILL BODY|NATIVE INSTRUCTION|SAME API INSTRUCTION/u);
}

let installation;
let cleanupInstallation = false;
let scratch;
try {
  const provided = process.env.DSH_NATIVE_NODE_MODULES;
  if (provided) {
    installation = path.resolve(provided);
  } else {
    const prefix = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-assets-native-"));
    cleanupInstallation = true;
    await installNativeOwners(prefix);
    installation = path.join(prefix, "node_modules");
  }
  scratch = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-assets-smoke-"));
  const fixture = await createFixture(scratch);
  const native = await verifyNativeOwners(installation, fixture);
  process.stdout.write(`${JSON.stringify({
    phase: "native-dsh",
    status: "pass",
    dshVersion: DSH_NATIVE_VERSION,
    sourceSha: DSH_NATIVE_SOURCE_SHA,
    credentialUsed: false,
    platform: process.platform,
    ...native,
  })}\n`);
  await compareBetterHarness(fixture, native);
  process.stdout.write(`${JSON.stringify({ phase: "better-harness-comparison", status: "pass" })}\n`);
} finally {
  if (scratch) await rm(scratch, { recursive: true, force: true });
  if (cleanupInstallation && installation) {
    await rm(path.dirname(installation), { recursive: true, force: true });
  }
}
