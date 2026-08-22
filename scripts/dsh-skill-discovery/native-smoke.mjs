#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import policy, {
  DSH_NATIVE_SOURCE_SHA,
  DSH_NATIVE_VERSION,
  verifyCanonicalSkill,
} from "./index.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT = path.resolve(HERE, "../..");
const DSH_PACKAGES = [
  "@deepseek-ai/dsh-agent",
  "@deepseek-ai/dsh-llm",
  "@deepseek-ai/dsh-session",
  "@deepseek-ai/dsh-skill",
  "@deepseek-ai/dsh-skill-filesystem",
  "@deepseek-ai/dsh-system-prompt",
  "@deepseek-ai/dsh-tool-skill",
  "@deepseek-ai/dsh-tools",
];

async function installNativeOwners(prefix) {
  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const specs = ["@deepseek-ai/cordis@4.0.1", ...DSH_PACKAGES.map((entry) => `${entry}@${DSH_NATIVE_VERSION}`)];
  await new Promise((resolve, reject) => {
    const child = spawn(npm, [
      "install",
      "--prefix", prefix,
      "--no-package-lock",
      "--no-save",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      ...specs,
    ], { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`native DSH owner install failed (${signal ?? code})`));
    });
  });
}

async function runSmoke(nodeModules, scratch) {
  const load = async (packageName) => {
    const packageRoot = path.join(nodeModules, ...packageName.split("/"));
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8"));
    if (packageName.startsWith("@deepseek-ai/dsh-")) {
      assert.equal(manifest.version, DSH_NATIVE_VERSION, `${packageName} must remain pinned`);
    }
    return import(pathToFileURL(path.join(packageRoot, manifest.main ?? "lib/index.js")));
  };

  const { Context } = await load("@deepseek-ai/cordis");
  const { default: SystemPrompt } = await load("@deepseek-ai/dsh-system-prompt");
  const { default: ToolRuntime } = await load("@deepseek-ai/dsh-tools");
  const { default: AgentRegistry, Inbox, agentEvents } = await load("@deepseek-ai/dsh-agent");
  const { default: SkillRegistry } = await load("@deepseek-ai/dsh-skill");
  const SkillFileSystem = await load("@deepseek-ai/dsh-skill-filesystem");
  const toolSkill = await load("@deepseek-ai/dsh-tool-skill");
  const { Session, SessionId } = await load("@deepseek-ai/dsh-session");
  const { CallId, createUserMessage } = await load("@deepseek-ai/dsh-llm");

  let sequence = 0;
  const agentFor = (cwd) => {
    sequence += 1;
    const id = SessionId(`better-harness-native-${sequence}`);
    const session = Session.create(id, [], { version: 0, id, createdAt: 0, cwd });
    return {
      ctx: new Context(),
      id,
      options: {},
      session,
      inbox: new Inbox(session, { inserted() {}, discarded() {}, claimed() {} }),
      status: "idle",
      send() {},
      followup() {},
      steer() {},
      inject() {},
      cancel() {},
      runMaintenance: (task) => task(new AbortController().signal),
      whenIdle: () => Promise.resolve(),
    };
  };

  const setup = async ({ betterHarnessRoot = REPOSITORY_ROOT, customSkillDirs, withPolicy = true } = {}) => {
    const home = await mkdtemp(path.join(scratch, "home-"));
    const ctx = new Context();
    await ctx.plugin(SystemPrompt);
    await ctx.plugin(ToolRuntime);
    await ctx.plugin(AgentRegistry);
    await ctx.plugin(SkillRegistry);
    await ctx.plugin(SkillFileSystem, {
      dshHome: path.join(home, ".dsh"),
      agentsHome: path.join(home, ".agents"),
      customSkillDirs: customSkillDirs ?? [path.join(betterHarnessRoot, "skills")],
      includeDefaultRoots: true,
      watch: false,
    });
    await ctx.plugin(toolSkill);
    if (withPolicy) await ctx.plugin(policy, { betterHarnessRoot });
    return ctx;
  };

  const userMessage = (text) => createUserMessage({
    content: [{ type: "text", text }],
    source: { kind: "user" },
  });
  const preStep = (ctx, agent, messages) => agentEvents(ctx, agent).waterfall(
    "agent/pre-step",
    { messages, turn: 1, step: 1, signal: new AbortController().signal },
    () => Promise.resolve({ kind: "enter", messages }),
  );

  const workspace = await mkdtemp(path.join(scratch, "workspace-"));
  await mkdir(path.join(workspace, ".git"));
  const ctx = await setup();
  const agent = agentFor(workspace);
  const winner = await ctx.skills.get("better-harness", { cwd: workspace, scope: agent });
  const identity = await verifyCanonicalSkill({ betterHarnessRoot: REPOSITORY_ROOT, skill: winner });
  assert.equal(identity.verified, true, identity.reasons.join(", "));
  assert.equal(winner.source, "custom");
  assert.equal(winner.path, identity.paths.skillFile);
  assert.deepEqual(winner.resourceBase, { kind: "directory", path: identity.paths.skillDirectory });

  const explicit = await preStep(ctx, agent, [userMessage("/better-harness inspect this harness")]);
  assert.equal(explicit.kind, "enter");
  const injection = explicit.messages.find((message) => message.source?.kind === "skill-invocation");
  assert.equal(injection?.source?.name, "better-harness");
  assert.match(injection.content[0].text, /<skill_content name="better-harness">/);
  assert.match(injection.content[0].text, /# Better Harness/);

  const catalogDecision = await preStep(ctx, agentFor(workspace), [userMessage("ordinary prompt")]);
  assert.equal(catalogDecision.kind, "enter");
  const catalog = catalogDecision.messages.find((message) => message.source?.kind === "skill-catalog");
  assert.equal(catalog?.source?.entries?.some((entry) => entry.name === "better-harness"), true);
  const modelResult = await ctx.tools.execute({
    signal: new AbortController().signal,
    callId: CallId("better-harness-model-call"),
    name: "skill",
    arguments: { name: "better-harness" },
    agent,
  });
  assert.equal(modelResult.isError, true);
  assert.match(modelResult.content[0].text, /explicit \/better-harness/);

  const shadowWorkspace = await mkdtemp(path.join(scratch, "shadow-"));
  const shadowDirectory = path.join(shadowWorkspace, ".dsh", "skills", "better-harness");
  await mkdir(path.join(shadowWorkspace, ".git"));
  await mkdir(shadowDirectory, { recursive: true });
  await writeFile(path.join(shadowDirectory, "SKILL.md"), [
    "---",
    "name: better-harness",
    "description: Project shadow",
    "---",
    "",
    "Shadow body.",
  ].join("\n"));
  const shadowAgent = agentFor(shadowWorkspace);
  const shadow = await ctx.skills.get("better-harness", { cwd: shadowWorkspace, scope: shadowAgent });
  assert.equal(shadow.source, "project-dsh");
  await assert.rejects(
    () => preStep(ctx, shadowAgent, [userMessage("/better-harness")]),
    /winner-source-mismatch.*winner-path-mismatch.*resource-base-mismatch/,
  );

  const malformedWorkspace = await mkdtemp(path.join(scratch, "malformed-"));
  const malformedDirectory = path.join(malformedWorkspace, ".dsh", "skills", "better-harness");
  await mkdir(path.join(malformedWorkspace, ".git"));
  await mkdir(malformedDirectory, { recursive: true });
  await writeFile(path.join(malformedDirectory, "SKILL.md"), "---\nname: better-harness\ndescription: [unterminated\n---\n");
  const malformedAgent = agentFor(malformedWorkspace);
  const malformedWinner = await ctx.skills.get("better-harness", { cwd: malformedWorkspace, scope: malformedAgent });
  assert.equal(malformedWinner.source, "custom");
  assert.equal((await verifyCanonicalSkill({ betterHarnessRoot: REPOSITORY_ROOT, skill: malformedWinner })).verified, true);

  const standalone = await mkdtemp(path.join(scratch, "standalone-"));
  const standaloneSkill = path.join(standalone, "skills", "better-harness");
  await mkdir(standaloneSkill, { recursive: true });
  await writeFile(path.join(standaloneSkill, "SKILL.md"), await readFile(identity.paths.skillFile, "utf8"));
  const standaloneCtx = await setup({ betterHarnessRoot: standalone, withPolicy: false });
  const standaloneAgent = agentFor(workspace);
  const standaloneWinner = await standaloneCtx.skills.get("better-harness", { cwd: workspace, scope: standaloneAgent });
  const standaloneIdentity = await verifyCanonicalSkill({ betterHarnessRoot: standalone, skill: standaloneWinner });
  assert.equal(standaloneIdentity.verified, false);
  assert.equal(standaloneIdentity.reasons.includes("required-resource-missing:scripts/better-harness.mjs"), true);

  const previousCwd = process.cwd();
  process.chdir(REPOSITORY_ROOT);
  try {
    const relativeCtx = await setup({ customSkillDirs: ["skills"], withPolicy: false });
    assert.equal((await relativeCtx.skills.get("better-harness", { cwd: workspace }))?.source, "custom");
    const tildeCtx = await setup({ customSkillDirs: ["~/skills"], withPolicy: false });
    assert.equal(await tildeCtx.skills.get("better-harness", { cwd: workspace }), undefined);
  } finally {
    process.chdir(previousCwd);
  }

  return {
    dshVersion: DSH_NATIVE_VERSION,
    sourceSha: DSH_NATIVE_SOURCE_SHA,
    credentialRequired: false,
    owners: ["SkillRegistry", "FileSystemSkillProvider", "tool-skill agent/pre-step", "ToolRuntime.guard"],
    discovery: "verified",
    explicitInvocation: "injected before model request derivation",
    modelInvocation: "rejected",
    shadow: "rejected",
    malformedShadow: "canonical fallback verified",
    standaloneCopy: "unverified",
    relativePath: "resolved from process cwd",
    literalTilde: "not expanded",
  };
}

let installation;
let cleanup = false;
try {
  const provided = process.env.DSH_NATIVE_NODE_MODULES;
  if (provided) {
    installation = path.resolve(provided);
  } else {
    const prefix = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-native-"));
    cleanup = true;
    await installNativeOwners(prefix);
    installation = path.join(prefix, "node_modules");
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "better-harness-dsh-smoke-"));
  try {
    const result = await runSmoke(installation, scratch);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
} finally {
  if (cleanup && installation) {
    await rm(path.dirname(installation), { recursive: true, force: true });
  }
}
