import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { parse as parseYaml } from "yaml";

import { MANAGE_TABS } from "../constants.mjs";

const QUALIFIED_DSH_VERSION = "0.1.1-rc.2";
const QUALIFIED_DSH_SOURCE_SHA = "b150a551b8d465e31e418e1b2eaf5e79bbb7d28e";
const DIAGNOSTIC_LIST_LIMIT = 100;
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const DEFAULT_MAX_BYTES = 65_536;
const DEFAULT_MAX_SOURCE_BYTES = 1_048_576;
const DEFAULT_INSTRUCTION_CANDIDATES = ["AGENTS.md", "CLAUDE.md"];
const DEFAULT_LOCAL_INSTRUCTION_CANDIDATES = ["AGENTS.local.md", "CLAUDE.local.md"];
const SYSTEM_REMINDER_OPEN = "<system-reminder>";
const SYSTEM_REMINDER_CLOSE = "</system-reminder>";
const WORKSPACE_CONTEXT_INTRO = "The following workspace instructions may be relevant to your work. "
  + "Use them as guidance when applicable. More specific instructions take precedence over broader ones. "
  + "They do not override system, developer, or direct user instructions.";
const COMPACT_WORKSPACE_CONTEXT_INTRO = "Workspace instructions were omitted or truncated to fit the configured byte budget.";

function expandDshHome(value) {
  if (value === "~") return os.homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) {
    return path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function assertPathOption(options, key) {
  if (options[key] !== undefined && typeof options[key] !== "string") {
    throw new TypeError(`${key} must be a path string`);
  }
}

function validateOptions(options) {
  if (!options || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("DSH configured-assets options must be an object");
  }
  for (const key of ["workspace", "cwd", "dshHome", "dsh-home", "home", "dshAgentsHome", "bundledSkillDir"]) {
    assertPathOption(options, key);
  }
  for (const key of ["includeUserHome", "includeDefaultRoots"]) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") {
      throw new TypeError(`${key} must be a boolean`);
    }
  }
  for (const key of [
    "customSkillDirs",
    "projectRootMarkers",
    "instructionFileCandidates",
    "localInstructionFileCandidates",
  ]) {
    if (options[key] !== undefined && (
      !Array.isArray(options[key]) || options[key].some((value) => typeof value !== "string")
    )) {
      throw new TypeError(`${key} must be an array of strings`);
    }
  }
  for (const key of ["maxBytes", "maxSourceBytes"]) {
    if (options[key] !== undefined && typeof options[key] !== "number") {
      throw new TypeError(`${key} must be a number`);
    }
  }
}

function isInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

async function requireDirectory(value, field) {
  let info;
  try {
    info = await stat(value);
  } catch {
    throw new TypeError(`${field} must be an existing directory`);
  }
  if (!info.isDirectory()) throw new TypeError(`${field} must be an existing directory`);
}

async function markerExists(directory, marker) {
  try {
    await stat(path.join(directory, marker));
    return true;
  } catch {
    return false;
  }
}

async function findProjectRoot(cwd, markers) {
  let current = cwd;
  for (;;) {
    for (const marker of markers) {
      if (await markerExists(current, marker)) return current;
    }
    const parent = path.dirname(current);
    if (parent === current) return cwd;
    current = parent;
  }
}

function emptyManageCollections() {
  return {
    plugins: [],
    mcps: [],
    skills: [],
    subagents: [],
    rules: [],
    commands: [],
    hooks: [],
  };
}

function diagnosticsFor(options, includeUserHome, instructionCollection = "enabled") {
  const configuredKeys = [
    "dshHome",
    "dsh-home",
    "home",
    "dshAgentsHome",
    "includeUserHome",
    "includeDefaultRoots",
    "customSkillDirs",
    "bundledSkillDir",
    "projectRootMarkers",
    "instructionFileCandidates",
    "localInstructionFileCandidates",
    "maxBytes",
    "maxSourceBytes",
  ];
  return {
    qualifiedDshVersion: QUALIFIED_DSH_VERSION,
    qualifiedDshSourceSha: QUALIFIED_DSH_SOURCE_SHA,
    evidenceKind: "configured-not-observed",
    configurationSource: configuredKeys.some((key) => options[key] !== undefined)
      ? "caller-overrides"
      : "qualified-defaults",
    userHomeCollection: includeUserHome ? "included" : "not-authorized",
    instructionCollection,
    runtimeResolution: {
      cordis: false,
      profile: false,
      preset: false,
      runtimeSkills: false,
    },
    shadowedSkills: [],
    skippedSkills: [],
    instructionDecisions: [],
    diagnosticsTruncated: false,
  };
}

function appendDiagnostic(diagnostics, collection, value) {
  if (diagnostics[collection].length < DIAGNOSTIC_LIST_LIMIT) {
    diagnostics[collection].push(value);
  } else {
    diagnostics.diagnosticsTruncated = true;
  }
}

function classifyExplicitScope(root, workspace) {
  if (isInside(workspace, root)) return "project";
  if (isInside(path.resolve(os.homedir()), root)) return "user";
  return "other";
}

function skillSourceLabel(sourceKind) {
  if (sourceKind.startsWith("project-")) return "DeepSeek Harness project";
  if (sourceKind.startsWith("user-")) return "User";
  if (sourceKind === "bundled") return "DeepSeek Harness bundled";
  return "DeepSeek Harness custom";
}

function skillEvidence(filePath, root) {
  return { path: filePath, relativePath: path.relative(root, filePath) };
}

function resolveSkillRoots({
  options,
  workspace,
  projectRoot,
  dshHome,
  dshAgentsHome,
  includeUserHome,
}) {
  const includeDefaultRoots = options.includeDefaultRoots !== false;
  const roots = [];
  let order = 0;
  const add = (rootPath, sourceKind, rank, scope, skipSystem = false) => {
    roots.push({
      path: path.resolve(rootPath),
      sourceKind,
      rank,
      scope,
      skipSystem,
      order: order += 1,
    });
  };
  if (includeDefaultRoots) {
    add(path.join(projectRoot, ".dsh", "skills"), "project-dsh", 100, "project");
    add(path.join(projectRoot, ".agents", "skills"), "project-agents", 200, "project");
  }
  for (const customRoot of options.customSkillDirs ?? []) {
    const resolved = path.resolve(customRoot);
    add(resolved, "custom", 300, classifyExplicitScope(resolved, workspace));
  }
  if (includeDefaultRoots && includeUserHome) {
    add(path.join(dshHome, "skills"), "user-dsh", 400, "user", true);
    add(path.join(dshAgentsHome, "skills"), "user-agents", 500, "user");
  }
  const explicitBundled = options.bundledSkillDir;
  const ambientBundled = includeDefaultRoots && includeUserHome
    ? process.env.DSH_BUNDLED_SKILL_DIR || undefined
    : undefined;
  const bundled = explicitBundled ?? ambientBundled;
  if (bundled !== undefined) {
    const resolved = path.resolve(bundled);
    add(resolved, "bundled", 600, classifyExplicitScope(resolved, workspace));
  }
  return roots;
}

function closingFrontmatter(raw, start) {
  let lineStart = start;
  while (lineStart <= raw.length) {
    const nextNewline = raw.indexOf("\n", lineStart);
    const lineEnd = nextNewline < 0 ? raw.length : nextNewline;
    const line = raw.slice(lineStart, lineEnd).replace(/\r$/u, "");
    if (line === "---") {
      return { start: lineStart, bodyStart: nextNewline < 0 ? raw.length : nextNewline + 1 };
    }
    if (nextNewline < 0) return undefined;
    lineStart = nextNewline + 1;
  }
  return undefined;
}

function parseSkillFrontmatter(raw) {
  const firstLineEnd = raw.indexOf("\n");
  if (firstLineEnd < 0) return undefined;
  if (raw.slice(0, firstLineEnd).replace(/\r$/u, "") !== "---") return undefined;
  const start = firstLineEnd + 1;
  const closing = closingFrontmatter(raw, start);
  if (!closing) return undefined;
  const value = parseYaml(raw.slice(start, closing.start));
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return value;
}

function invocationBoolean(data, key) {
  if (!Object.hasOwn(data, key)) return undefined;
  const value = data[key];
  if (typeof value === "boolean") return value;
  if (value === 1 || value === "1") return true;
  if (value === 0 || value === "0") return false;
  if (typeof value === "string") {
    const normalized = value.toLowerCase();
    if (["true", "yes", "on"].includes(normalized)) return true;
    if (["false", "no", "off"].includes(normalized)) return false;
  }
  throw new TypeError(`${key} must be a native DSH boolean`);
}

function validateInvocation(data) {
  for (const legacy of ["disableModelInvocation", "modelInvocable", "userInvocable"]) {
    if (Object.hasOwn(data, legacy)) throw new TypeError(`${legacy} is not supported by DSH`);
  }
  invocationBoolean(data, "disable-model-invocation");
  invocationBoolean(data, "user-invocable");
}

function errorCode(error) {
  return error && typeof error === "object" && "code" in error ? error.code : undefined;
}

async function skillEntryKind(entryPath, entry, diagnostics) {
  if (entry.isDirectory()) return "directory";
  if (entry.isFile()) return "file";
  if (!entry.isSymbolicLink()) return "other";
  try {
    const info = await stat(entryPath);
    if (info.isDirectory()) return "directory";
    if (info.isFile()) return "file";
    return "other";
  } catch {
    appendDiagnostic(diagnostics, "skippedSkills", {
      filePath: entryPath,
      reason: "unavailable",
    });
    return "other";
  }
}

async function parseSkillCandidate(filePath, root, diagnostics) {
  let raw;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    appendDiagnostic(diagnostics, "skippedSkills", {
      filePath,
      reason: ["ENOENT", "ENOTDIR"].includes(errorCode(error)) ? "missing-skill-file" : "unavailable",
    });
    return undefined;
  }
  let data;
  try {
    data = parseSkillFrontmatter(raw);
  } catch {
    appendDiagnostic(diagnostics, "skippedSkills", { filePath, reason: "malformed" });
    return undefined;
  }
  if (!data) {
    appendDiagnostic(diagnostics, "skippedSkills", { filePath, reason: "malformed" });
    return undefined;
  }
  const name = data.name;
  const description = data.description;
  if (typeof name !== "string" || name.length === 0 || !SKILL_NAME.test(name)) {
    appendDiagnostic(diagnostics, "skippedSkills", { filePath, reason: "invalid-name" });
    return undefined;
  }
  if (typeof description !== "string" || description.length === 0) {
    appendDiagnostic(diagnostics, "skippedSkills", { filePath, reason: "malformed" });
    return undefined;
  }
  try {
    validateInvocation(data);
  } catch {
    appendDiagnostic(diagnostics, "skippedSkills", { filePath, reason: "invalid-invocation" });
    return undefined;
  }
  return {
    id: `dsh:skill:${filePath}`,
    kind: "skill",
    scope: root.scope,
    sourceLabel: skillSourceLabel(root.sourceKind),
    sourceKind: root.sourceKind,
    filePath,
    name,
    description,
    evidence: skillEvidence(filePath, root.path),
  };
}

async function collectSkills(roots, diagnostics) {
  const candidates = [];
  for (const root of roots) {
    let entries;
    try {
      entries = await readdir(root.path, { withFileTypes: true, encoding: "utf8" });
    } catch {
      continue;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (root.skipSystem && entry.name === ".system") continue;
      const entryPath = path.join(root.path, entry.name);
      const kind = await skillEntryKind(entryPath, entry, diagnostics);
      const filePath = kind === "directory"
        ? path.join(entryPath, "SKILL.md")
        : kind === "file" && entry.name.endsWith(".md")
          ? entryPath
          : undefined;
      if (!filePath) {
        if (kind !== "other" || !entry.isSymbolicLink()) {
          appendDiagnostic(diagnostics, "skippedSkills", { filePath: entryPath, reason: "unsupported-entry" });
        }
        continue;
      }
      const item = await parseSkillCandidate(filePath, root, diagnostics);
      if (item) candidates.push({ item, rank: root.rank, rootOrder: root.order });
    }
  }

  const winners = new Map();
  for (const candidate of candidates) {
    const existing = winners.get(candidate.item.name);
    if (!existing) {
      winners.set(candidate.item.name, candidate);
      continue;
    }
    appendDiagnostic(diagnostics, "shadowedSkills", {
      name: candidate.item.name,
      sourceKind: candidate.item.sourceKind,
      filePath: candidate.item.filePath,
    });
  }
  return [...winners.values()]
    .map((candidate) => candidate.item)
    .sort((left, right) => left.name === right.name ? 0 : left.name < right.name ? -1 : 1);
}

function resolveInstructionCandidates(value, fallback) {
  return (value ?? fallback).filter((candidate) => (
    candidate !== ""
    && candidate !== "."
    && candidate !== ".."
    && !path.isAbsolute(candidate)
    && !/[\\/]/u.test(candidate)
  ));
}

function ancestorChain(root, cwd) {
  const chain = [];
  let current = cwd;
  while (current !== root) {
    chain.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  chain.push(root);
  return chain.reverse();
}

function instructionCandidate(filePath, displayPath, scope, rootForEvidence) {
  return { filePath, displayPath, scope, rootForEvidence };
}

async function readBoundedInstruction(candidate, maxSourceBytes, diagnostics) {
  let info;
  try {
    info = await stat(candidate.filePath);
  } catch (error) {
    if (!["ENOENT", "ENOTDIR"].includes(errorCode(error))) {
      appendDiagnostic(diagnostics, "instructionDecisions", {
        path: candidate.displayPath,
        reason: "unavailable",
      });
    }
    return undefined;
  }
  if (!info.isFile()) {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: candidate.displayPath,
      reason: "unavailable",
    });
    return undefined;
  }
  if (info.size > maxSourceBytes) {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: candidate.displayPath,
      reason: "source-too-large",
    });
    return undefined;
  }
  const chunks = [];
  let bytes = 0;
  try {
    const stream = createReadStream(candidate.filePath, { encoding: "utf8" });
    for await (const chunk of stream) {
      const text = String(chunk);
      bytes += Buffer.byteLength(text, "utf8");
      if (bytes > maxSourceBytes) {
        stream.destroy();
        appendDiagnostic(diagnostics, "instructionDecisions", {
          path: candidate.displayPath,
          reason: "source-too-large",
        });
        return undefined;
      }
      chunks.push(text);
    }
  } catch {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: candidate.displayPath,
      reason: "unavailable",
    });
    return undefined;
  }
  return { ...candidate, content: chunks.join("") };
}

function instructionDigest(content) {
  return createHash("sha1").update(content.trim()).digest("hex");
}

function instructionRule(file) {
  return {
    id: `dsh:rule:${file.filePath}`,
    kind: "rule",
    scope: file.scope,
    sourceLabel: file.scope === "user" ? "User" : "DeepSeek Harness project",
    sourceKind: "dsh-instruction",
    filePath: file.filePath,
    name: file.displayPath,
    description: "Applicable DSH Instruction source",
    evidence: skillEvidence(file.filePath, file.rootForEvidence),
  };
}

function byteLength(value) {
  return Buffer.byteLength(value, "utf8");
}

function truncateUtf8(value, maxBytes) {
  const bytes = Buffer.from(value, "utf8");
  if (bytes.length <= maxBytes) return value;
  let end = Math.max(0, Math.trunc(maxBytes));
  while (end > 0 && (bytes.readUInt8(end) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString("utf8");
}

function sectionText(file) {
  return `Instructions from: ${file.displayPath}\n\n${file.content}`;
}

function markerText(maxBytes, omitted, truncated) {
  if (omitted.length === 0 && truncated.length === 0) return "";
  const parts = [];
  if (omitted.length > 0) parts.push(`omitted ${omitted.map((file) => file.displayPath).join(", ")}`);
  if (truncated.length > 0) {
    parts.push(`truncated ${truncated.map((item) => (
      `${item.displayPath} from ${item.originalBytes} to ${item.includedBytes} bytes`
    )).join(", ")}`);
  }
  return `Workspace instruction budget ${maxBytes} bytes: ${parts.join("; ")}`;
}

function escapedFrameBody(value) {
  return value.replaceAll(SYSTEM_REMINDER_CLOSE, "<\\/system-reminder>");
}

function buildInstructionText(files, maxBytes, omitted, truncated, intro) {
  const marker = markerText(maxBytes, omitted, truncated);
  const body = [marker, intro, ...files.map(sectionText)].filter((block) => block.length > 0);
  return [SYSTEM_REMINDER_OPEN, escapedFrameBody(body.join("\n\n")), SYSTEM_REMINDER_CLOSE].join("\n");
}

function withTruncatedContent(file, includedBytes) {
  return { ...file, content: truncateUtf8(file.content, includedBytes) };
}

function truncateInstructionToFit(file, maxBytes, omitted, intro) {
  const originalBytes = byteLength(file.content);
  let low = 0;
  let high = originalBytes;
  let best = withTruncatedContent(file, 0);
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = withTruncatedContent(file, mid);
    const truncated = [{
      displayPath: file.displayPath,
      originalBytes,
      includedBytes: byteLength(candidate.content),
    }];
    const text = buildInstructionText([candidate], maxBytes, omitted, truncated, intro);
    if (byteLength(text) <= maxBytes) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

function budgetInstructionFiles(files, maxBytes) {
  if (files.length === 0) return { included: [], omitted: [], truncated: [], represented: true };
  const fullText = buildInstructionText(files, maxBytes, [], [], WORKSPACE_CONTEXT_INTRO);
  if (byteLength(fullText) <= maxBytes) {
    return { included: files, omitted: [], truncated: [], represented: true };
  }
  for (let start = 1; start < files.length; start += 1) {
    const included = files.slice(start);
    const omitted = files.slice(0, start);
    const suffixText = buildInstructionText(included, maxBytes, omitted, [], WORKSPACE_CONTEXT_INTRO);
    if (byteLength(suffixText) <= maxBytes) {
      return { included, omitted, truncated: [], represented: true };
    }
  }
  const mostSpecific = files.at(-1);
  const omitted = files.slice(0, -1);
  const originalBytes = byteLength(mostSpecific.content);
  for (const intro of [WORKSPACE_CONTEXT_INTRO, COMPACT_WORKSPACE_CONTEXT_INTRO]) {
    const truncatedFile = truncateInstructionToFit(mostSpecific, maxBytes, omitted, intro);
    const includedBytes = byteLength(truncatedFile.content);
    const truncated = [{ displayPath: mostSpecific.displayPath, originalBytes, includedBytes }];
    const text = buildInstructionText([truncatedFile], maxBytes, omitted, truncated, intro);
    if (byteLength(text) <= maxBytes) {
      return {
        included: includedBytes > 0 || originalBytes === 0 ? [mostSpecific] : [],
        omitted,
        truncated,
        represented: includedBytes > 0 || originalBytes === 0,
      };
    }
  }
  const truncated = [{ displayPath: mostSpecific.displayPath, originalBytes, includedBytes: 0 }];
  const compactNotice = escapedFrameBody(markerText(maxBytes, omitted, truncated));
  const compactWithHeading = escapedFrameBody([compactNotice, sectionText(withTruncatedContent(mostSpecific, 0))].join("\n\n"));
  if (byteLength(compactWithHeading) <= maxBytes && originalBytes === 0) {
    return { included: [mostSpecific], omitted, truncated, represented: true };
  }
  return { included: [], omitted, truncated, represented: false };
}

async function collectInstructions({
  projectRoot,
  cwd,
  dshHome,
  includeUserHome,
  instructionFileCandidates,
  localInstructionFileCandidates,
  maxBytes,
  maxSourceBytes,
  diagnostics,
}) {
  const candidates = [];
  if (includeUserHome) {
    candidates.push(instructionCandidate(
      path.join(dshHome, "AGENTS.md"),
      "$DSH_HOME/AGENTS.md",
      "user",
      dshHome,
    ));
  }
  for (const directory of ancestorChain(projectRoot, cwd)) {
    for (const names of [instructionFileCandidates, localInstructionFileCandidates]) {
      for (const name of names) {
        const filePath = path.join(directory, name);
        candidates.push(instructionCandidate(
          filePath,
          path.relative(projectRoot, filePath),
          "project",
          projectRoot,
        ));
      }
    }
  }

  const loaded = [];
  const seenPaths = new Set();
  for (const candidate of candidates) {
    if (seenPaths.has(candidate.filePath)) continue;
    seenPaths.add(candidate.filePath);
    const file = await readBoundedInstruction(candidate, maxSourceBytes, diagnostics);
    if (file) loaded.push(file);
  }

  const deduped = [];
  const digestsByDirectory = new Map();
  for (const file of loaded) {
    const directory = path.dirname(file.displayPath);
    const digest = instructionDigest(file.content);
    const digests = digestsByDirectory.get(directory) ?? new Set();
    digestsByDirectory.set(directory, digests);
    if (digests.has(digest)) {
      appendDiagnostic(diagnostics, "instructionDecisions", {
        path: file.displayPath,
        reason: "duplicate-content",
      });
      continue;
    }
    digests.add(digest);
    deduped.push(file);
  }

  const budgeted = budgetInstructionFiles(deduped, maxBytes);
  for (const file of budgeted.omitted) {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: file.displayPath,
      reason: "budget-omitted",
    });
  }
  for (const item of budgeted.truncated) {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: item.displayPath,
      reason: "budget-truncated",
    });
  }
  if (!budgeted.represented && deduped.length > 0) {
    appendDiagnostic(diagnostics, "instructionDecisions", {
      path: deduped.at(-1).displayPath,
      reason: "budget-not-represented",
    });
  }
  return budgeted.included.map(instructionRule);
}

export async function collectDshCustomizeInventory(options = {}) {
  validateOptions(options);
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const cwd = path.resolve(options.cwd ?? workspace);
  if (!isInside(workspace, cwd)) {
    throw new TypeError("cwd must be equal to or inside workspace");
  }
  await requireDirectory(workspace, "workspace");
  await requireDirectory(cwd, "cwd");

  const explicitDshHome = options.dshHome ?? options["dsh-home"] ?? options.home;
  const environmentDshHome = process.env.DSH_HOME;
  const dshHomeInput = explicitDshHome ?? (
    environmentDshHome !== undefined && environmentDshHome.trim().length > 0
      ? environmentDshHome
      : path.join(os.homedir(), ".dsh")
  );
  const dshHome = path.resolve(expandDshHome(dshHomeInput));
  const dshAgentsHome = path.resolve(
    options.dshAgentsHome ?? process.env.DSH_AGENTS_HOME ?? path.join(os.homedir(), ".agents"),
  );
  const projectRootMarkers = options.projectRootMarkers ?? [".git"];
  const projectRoot = await findProjectRoot(cwd, projectRootMarkers);
  const includeUserHome = options.includeUserHome === true;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
  const maxSourceBytes = options.maxSourceBytes ?? DEFAULT_MAX_SOURCE_BYTES;
  const instructionsEnabled = maxBytes > 0
    && Number.isFinite(maxBytes)
    && maxSourceBytes > 0
    && Number.isFinite(maxSourceBytes);
  const diagnostics = diagnosticsFor(
    options,
    includeUserHome,
    instructionsEnabled ? "enabled" : "disabled-by-byte-limit",
  );
  const skillRoots = resolveSkillRoots({
    options,
    workspace,
    projectRoot,
    dshHome,
    dshAgentsHome,
    includeUserHome,
  });
  const skills = await collectSkills(skillRoots, diagnostics);
  const manage = emptyManageCollections();
  manage.skills = skills;
  if (instructionsEnabled) {
    manage.rules = await collectInstructions({
      projectRoot,
      cwd,
      dshHome,
      includeUserHome,
      instructionFileCandidates: resolveInstructionCandidates(
        options.instructionFileCandidates,
        DEFAULT_INSTRUCTION_CANDIDATES,
      ),
      localInstructionFileCandidates: resolveInstructionCandidates(
        options.localInstructionFileCandidates,
        DEFAULT_LOCAL_INSTRUCTION_CANDIDATES,
      ),
      maxBytes,
      maxSourceBytes,
      diagnostics,
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    provider: "dsh",
    dshHome,
    dshAgentsHome,
    workspace,
    cwd,
    projectRoot,
    tabs: MANAGE_TABS,
    plugins: [],
    manage,
    diagnostics,
    unsupported: [],
  };
}
