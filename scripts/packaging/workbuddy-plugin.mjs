#!/usr/bin/env node

import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const WORKBUDDY_ARTIFACT_KIND = "better-harness-workbuddy-plugin-artifact";
export const WORKBUDDY_ARTIFACT_SCHEMA_VERSION = 1;
export const WORKBUDDY_ARTIFACT_MARKER = ".workbuddy-plugin-artifact.json";
export const WORKBUDDY_REQUIRED_PATHS = Object.freeze([
  ".codebuddy-plugin/plugin.json",
  ".codebuddy-plugin/marketplace.json",
  "settings.json",
  "skills/better-harness/SKILL.md",
  "scripts/better-harness.mjs",
  "scripts/harness-analysis/host-runtime/contract.mjs",
  "scripts/harness-analysis/host-runtime/index.mjs",
  "agents/better-harness-review-director.md",
  "agents/session-evidence-reviewer.md",
  "agents/project-harness-reviewer.md",
  "agents/agent-customize-reviewer.md",
  "avatars/team.svg",
  "avatars/better-harness-review-director.svg",
  "avatars/session-evidence-reviewer.svg",
  "avatars/project-harness-reviewer.svg",
  "avatars/agent-customize-reviewer.svg",
]);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COPY_ROOTS = Object.freeze([
  ".codebuddy-plugin",
  "agents",
  "avatars",
  "case-studies",
  "docs",
  "hooks",
  "models",
  "references",
  "scripts",
  "skills",
  "templates",
]);
const COPY_FILES = Object.freeze([
  "AGENTS.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  "LICENSE",
  "README.md",
  "README.zh-CN.md",
  "package.json",
  "settings.json",
]);
const EXCLUDED_PREFIXES = Object.freeze([
  ".git",
  ".workbuddy",
  ".pi",
  ".qoder",
  ".codex",
  ".claude",
  ".cursor",
  "node_modules",
  "test",
  "dist",
  "scripts/packaging",
  "docs/docs",
  "docs/i18n",
  "docs/src",
  "docs/static",
  "docs/build",
  "docs/node_modules",
]);
const PRIVATE_KEY_PATTERN = /(?:access[_-]?token|refresh[_-]?token|botToken|api[_-]?key|password|private[_-]?key|rawTranscript|rawSession|rawPrompt)/iu;
const ABSOLUTE_HOME_PATTERN = /(?:^|["'\s])(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)/u;

function posix(value) {
  return value.split(path.sep).join("/");
}

function excluded(relativePath) {
  const normalized = posix(relativePath);
  return normalized.split("/").includes("node_modules")
    || EXCLUDED_PREFIXES.some((prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`));
}

async function exists(filePath) {
  return Boolean(await lstat(filePath).catch(() => null));
}

async function ensureRegular(root, relativePath) {
  const filePath = path.join(root, relativePath);
  const stats = await lstat(filePath).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error(`WorkBuddy artifact is missing a regular file: ${relativePath}`);
  }
  return filePath;
}

async function readJson(root, relativePath) {
  return JSON.parse(await readFile(await ensureRegular(root, relativePath), "utf8"));
}

async function scanTree(root, { strict = false } = {}) {
  const files = [];
  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const childRelative = relative ? `${relative}/${entry.name}` : entry.name;
      const childPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`WorkBuddy artifact contains a symlink: ${childRelative}`);
      if (excluded(childRelative)) {
        if (strict) throw new Error(`WorkBuddy artifact contains excluded private path: ${childRelative}`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(childPath, childRelative);
      } else if (entry.isFile()) {
        files.push(childRelative);
        const inspectContent = strict
          && !childRelative.startsWith("scripts/")
          && !childRelative.startsWith("docs/")
          && !childRelative.startsWith("skills/")
          && !childRelative.startsWith("references/")
          && !childRelative.startsWith("models/");
        if (inspectContent) {
          if (PRIVATE_KEY_PATTERN.test(entry.name)) throw new Error(`WorkBuddy artifact contains private-looking filename: ${childRelative}`);
          const content = await readFile(childPath, "utf8").catch(() => "");
          if (PRIVATE_KEY_PATTERN.test(content)) throw new Error(`WorkBuddy artifact contains private field: ${childRelative}`);
          if (ABSOLUTE_HOME_PATTERN.test(content)) throw new Error(`WorkBuddy artifact contains an absolute home path: ${childRelative}`);
        }
      }
    }
  }
  await visit(root);
  return files;
}

function assertPromptParity(manifest) {
  const init = manifest.defaultInitPrompt;
  const first = manifest.quickPrompts?.[0];
  if (!init || !first || init.en !== first.en || init.zh !== first.zh) {
    throw new Error("defaultInitPrompt must exactly equal quickPrompts[0]");
  }
}

export async function verifyWorkBuddyPluginRoot(root = ROOT) {
  const resolvedRoot = path.resolve(root);
  const manifest = await readJson(resolvedRoot, ".codebuddy-plugin/plugin.json");
  const marketplace = await readJson(resolvedRoot, ".codebuddy-plugin/marketplace.json");
  const settings = await readJson(resolvedRoot, "settings.json");
  if (manifest.name !== "better-harness" || manifest.expertType !== "team") throw new Error("plugin must be the Better Harness team plugin");
  if (manifest.categoryId !== "10-ProjectQuality") throw new Error("plugin categoryId must be 10-ProjectQuality");
  if (manifest.plugin !== manifest.name) throw new Error("plugin field must match name");
  if (!Array.isArray(manifest.tags) || manifest.tags.length !== 3) throw new Error("plugin must declare exactly three tags");
  if (!Array.isArray(manifest.quickPrompts) || manifest.quickPrompts.length !== 3) throw new Error("plugin must declare exactly three quick prompts");
  assertPromptParity(manifest);
  const lead = manifest.teamInfo?.leadAgent;
  const members = manifest.teamInfo?.memberAgents;
  if (lead !== manifest.agentName || !Array.isArray(members) || members.length !== 3 || members.includes(lead)) {
    throw new Error("teamInfo must contain one lead and exactly three member agents");
  }
  if (settings.agent !== lead) throw new Error("settings.agent must select the team lead");
  const manifestAgents = new Set(manifest.agents ?? []);
  for (const agentId of [lead, ...members]) {
    const declared = `./agents/${agentId}.md`;
    if (!manifestAgents.has(declared)) throw new Error(`agent is not declared by plugin.json: ${agentId}`);
    await ensureRegular(resolvedRoot, `agents/${agentId}.md`);
  }
  const roles = new Set((manifest.members ?? []).map((member) => member.id));
  if (roles.size !== 4 || !roles.has(lead) || members.some((member) => !roles.has(member))) {
    throw new Error("plugin members must contain lead plus the three canonical members");
  }
  if (manifest.members.filter((member) => member.role === "lead").length !== 1) throw new Error("plugin members must contain exactly one lead");
  const marketplaceEntry = marketplace.plugins?.[0];
  if (!marketplaceEntry || marketplaceEntry.name !== manifest.name || marketplaceEntry.version !== manifest.version) {
    throw new Error("Marketplace entry must match plugin name and version");
  }
  if (marketplace.metadata?.version !== manifest.version) throw new Error("Marketplace metadata version must match plugin version");
  const files = await scanTree(resolvedRoot, { strict: path.basename(resolvedRoot) === "better-harness" && await exists(path.join(resolvedRoot, WORKBUDDY_ARTIFACT_MARKER)) });
  for (const required of WORKBUDDY_REQUIRED_PATHS) {
    if (!files.includes(required)) throw new Error(`WorkBuddy plugin is missing required path: ${required}`);
  }
  return {
    pluginRoot: resolvedRoot,
    name: manifest.name,
    version: manifest.version,
    agentCount: manifest.agents.length,
    memberCount: manifest.teamInfo.memberAgents.length,
    fileCount: files.length,
  };
}

async function copyPath(repoRoot, stageRoot, relativePath) {
  const source = path.join(repoRoot, relativePath);
  if (!(await exists(source))) throw new Error(`Missing WorkBuddy source path: ${relativePath}`);
  const destination = path.join(stageRoot, relativePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, {
    recursive: true,
    dereference: true,
    filter: (candidate) => !excluded(posix(path.relative(repoRoot, candidate))),
  });
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  CRC_TABLE[index] = value >>> 0;
}
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) value = CRC_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}
function u16(value) { const buffer = Buffer.allocUnsafe(2); buffer.writeUInt16LE(value); return buffer; }
function u32(value) { const buffer = Buffer.allocUnsafe(4); buffer.writeUInt32LE(value >>> 0); return buffer; }
function zipBuffer(entries) {
  const local = [];
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(posix(entry.relativePath));
    const raw = entry.content;
    const compressed = deflateRawSync(raw, { level: 9 });
    const header = Buffer.concat([u32(0x04034b50), u16(20), u16(0), u16(8), u16(0), u16(33), u32(crc32(raw)), u32(compressed.length), u32(raw.length), u16(name.length), u16(0), name]);
    local.push(header, compressed);
    central.push(Buffer.concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(8), u16(0), u16(33), u32(crc32(raw)), u32(compressed.length), u32(raw.length), u16(name.length), u16(0), u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + compressed.length;
  }
  const centralBuffer = Buffer.concat(central);
  return Buffer.concat([...local, centralBuffer, Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length), u32(centralBuffer.length), u32(offset), u16(0)])]);
}

async function collectFiles(root) {
  const files = [];
  for (const relativePath of await scanTree(root)) {
    files.push({ relativePath, content: await readFile(path.join(root, relativePath)) });
  }
  return files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
}

async function replaceOutput(stageRoot, outputRoot) {
  if (await exists(outputRoot)) {
    const marker = JSON.parse(await readFile(path.join(outputRoot, WORKBUDDY_ARTIFACT_MARKER), "utf8").catch(() => "null"));
    if (marker?.kind !== WORKBUDDY_ARTIFACT_KIND || marker.schemaVersion !== WORKBUDDY_ARTIFACT_SCHEMA_VERSION) {
      throw new Error(`Refusing to replace unowned WorkBuddy output: ${outputRoot}`);
    }
    await rm(outputRoot, { recursive: true, force: true });
  }
  await rename(stageRoot, outputRoot);
}

export async function buildWorkBuddyPluginArtifact({ repoRoot = ROOT, outputRoot = path.join(ROOT, "dist", "workbuddy", "better-harness") } = {}) {
  const resolvedRepoRoot = path.resolve(repoRoot);
  const resolvedOutput = path.resolve(outputRoot);
  await verifyWorkBuddyPluginRoot(resolvedRepoRoot);
  // `mkdtemp` requires its parent to exist. Creating only the requested
  // output parent keeps the build deterministic for a fresh checkout and
  // does not create any private run state inside the plugin root.
  await mkdir(path.dirname(resolvedOutput), { recursive: true });
  const stageContainer = await mkdtemp(path.join(path.dirname(resolvedOutput), ".better-harness-workbuddy-build-"));
  const stageRoot = path.join(stageContainer, "better-harness");
  await mkdir(stageRoot, { recursive: true });
  try {
    for (const file of COPY_FILES) await copyPath(resolvedRepoRoot, stageRoot, file);
    for (const root of COPY_ROOTS) await copyPath(resolvedRepoRoot, stageRoot, root);
    const marker = {
      kind: WORKBUDDY_ARTIFACT_KIND,
      schemaVersion: WORKBUDDY_ARTIFACT_SCHEMA_VERSION,
      host: "workbuddy",
      pluginName: "better-harness",
      version: (await readJson(stageRoot, ".codebuddy-plugin/plugin.json")).version,
    };
    await writeFile(path.join(stageRoot, WORKBUDDY_ARTIFACT_MARKER), `${JSON.stringify(marker, null, 2)}\n`);
    const verified = await verifyWorkBuddyPluginRoot(stageRoot);
    if (resolvedOutput.endsWith(".zip")) {
      await mkdir(path.dirname(resolvedOutput), { recursive: true });
      await writeFile(resolvedOutput, zipBuffer(await collectFiles(stageRoot)));
      // `stageRoot` is removed in the finally block. Do not return a stale
      // pluginRoot path that points at that deleted temporary directory.
      return {
        name: verified.name,
        version: verified.version,
        agentCount: verified.agentCount,
        memberCount: verified.memberCount,
        archive: resolvedOutput,
        fileCount: verified.fileCount + 1,
      };
    }
    await mkdir(path.dirname(resolvedOutput), { recursive: true });
    await replaceOutput(stageRoot, resolvedOutput);
    return { ...verified, pluginRoot: resolvedOutput };
  } finally {
    await rm(stageContainer, { recursive: true, force: true }).catch(() => {});
  }
}

function usage() {
  return [
    "Usage: node scripts/packaging/workbuddy-plugin.mjs [options]",
    "",
    "Options:",
    "  --verify [root]         Validate the source WorkBuddy plugin root",
    "  --out <dir|zip>         Build an isolated WorkBuddy plugin directory or zip",
    "  --json                  Emit machine-readable JSON",
    "  -h, --help              Print help",
    "",
  ].join("\n");
}

export async function main(argv = process.argv.slice(2)) {
  const json = argv.includes("--json");
  try {
    if (argv.includes("--help") || argv.includes("-h")) {
      process.stdout.write(usage());
      return 0;
    }
    const verifyIndex = argv.indexOf("--verify");
    const outIndex = argv.indexOf("--out");
    const result = verifyIndex >= 0
      ? await verifyWorkBuddyPluginRoot(argv[verifyIndex + 1] && !argv[verifyIndex + 1].startsWith("-") ? argv[verifyIndex + 1] : ROOT)
      : await buildWorkBuddyPluginArtifact({ outputRoot: outIndex >= 0 ? path.resolve(argv[outIndex + 1]) : undefined });
    process.stdout.write(json ? `${JSON.stringify({ ok: true, data: result }, null, 2)}\n` : `WorkBuddy plugin verified: ${result.pluginRoot ?? result.archive}\n`);
    return 0;
  } catch (error) {
    if (json) process.stdout.write(`${JSON.stringify({ ok: false, error: { message: error.message } }, null, 2)}\n`);
    else process.stderr.write(`WorkBuddy plugin validation failed: ${error.message}\n`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = await main();
