import { lstat, readFile, readdir, realpath, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";
import { expandHome, isDirectory, normalizeWorkspace, pathExists } from "../session-analysis/index.mjs";
import {
  COMPONENT_KINDS,
  SNAPSHOT_KIND,
  SNAPSHOT_SCHEMA_VERSION,
  artifactRefForRoute,
  canonicalStringify,
  componentIdFor,
  componentIdentityDigest,
  compareCodeUnits,
  contentRevision,
  deepFreeze,
  fail,
  normalizeComponentRoute,
  rollbackReferenceFor,
  sha256,
  snapshotDigestFor,
  populationRefFromKey,
  validatePopulationRef,
  validateHarnessComponentSnapshot,
} from "./contract.mjs";

const COLLECTION_KINDS = Object.freeze([
  ["rules", "rule"],
  ["skills", "skill"],
  ["hooks", "hook"],
  ["commands", "command"],
]);
const WORKFLOW_ROOTS = Object.freeze([
  [".qoder", "workflows"],
  [".agents", "workflows"],
]);
const MAX_SKILL_FILES = 5000;
const MAX_SKILL_DEPTH = 12;
const MAX_SKILL_BYTES = 64 * 1024 * 1024;
const MAX_PROBE_DEPTH = 32;
const MAX_PROBE_ENTRIES = 100_000;
const MAX_HOOK_DECLARATIONS = 5000;
const MAX_SNAPSHOT_COMPONENTS = 20_000;
const COMPONENT_READ_CONCURRENCY = 8;
const MAX_WORKFLOW_FILES = 5000;
const MAX_WORKFLOW_DEPTH = 4;
const MAX_COMPONENT_FILE_BYTES = 16 * 1024 * 1024;

function populationRefFromCanonicalWorkspace(canonicalWorkspace) {
  const portableWorkspace = canonicalWorkspace.normalize("NFC").replaceAll("\\", "/");
  const pathIdentity = process.platform === "win32" ? portableWorkspace.toLowerCase() : portableWorkspace;
  const digest = sha256(`better-harness:harness-component-population:v1\0workspace-path\0${process.platform}\0${pathIdentity}`);
  return `hcp:qoder:project:sha256:${digest}`;
}

export async function deriveHarnessComponentPopulationRef(options = {}) {
  if (options.populationKey !== undefined) return populationRefFromKey(options.populationKey);
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  const canonicalWorkspace = await realpath(workspace).catch(() => undefined);
  if (!canonicalWorkspace) fail("WORKSPACE_NOT_FOUND", "snapshot workspace does not exist");
  return populationRefFromCanonicalWorkspace(canonicalWorkspace);
}

async function canonicalPath(value) {
  return realpath(path.resolve(value)).catch(() => path.resolve(value));
}

async function createWorkspaceReadContext(workspace, options = {}) {
  const resolvedWorkspace = path.resolve(workspace);
  const canonicalWorkspace = await realpath(resolvedWorkspace).catch(() => undefined);
  if (!canonicalWorkspace && options.requireCanonical) {
    fail("WORKSPACE_NOT_FOUND", "snapshot workspace does not exist");
  }
  const root = canonicalWorkspace ?? resolvedWorkspace;
  return Object.freeze({ workspace: resolvedWorkspace, root });
}

async function assertSafeProjectReadTarget(readContext, target) {
  const stats = await lstat(target).catch(() => undefined);
  if (!stats) return;
  const resolvedTarget = await realpath(target).catch(() => undefined);
  if (!resolvedTarget) fail("UNRESOLVED_PROJECT_READ_TARGET", "project evidence target cannot be resolved safely");
  const relative = path.relative(readContext.root, resolvedTarget);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("PROJECT_READ_OUTSIDE_WORKSPACE", "project evidence target resolves outside the workspace");
  }
}

async function assertProjectReadBoundaries(readContext) {
  const { workspace } = readContext;
  const qoderRoot = path.join(workspace, ".qoder");
  const targets = [
    path.join(workspace, ".git"),
    path.join(workspace, ".git", "config"),
    path.join(workspace, ".agents"),
    qoderRoot,
    path.join(workspace, "AGENTS.md"),
    path.join(workspace, "DESIGN.md"),
    path.join(qoderRoot, "settings.json"),
    path.join(qoderRoot, "settings.local.json"),
    path.join(qoderRoot, "hooks.json"),
  ];
  for (const target of targets) await assertSafeProjectReadTarget(readContext, target);
}

async function assertProjectDoesNotAliasQoderHome(readContext) {
  const { workspace } = readContext;
  const environmentHome = process.env.QODER_HOME;
  const environmentBase = path.basename(String(environmentHome ?? "")).toLowerCase();
  const qoderHome = environmentHome && [".qoder", "qoder"].includes(environmentBase)
    ? expandHome(environmentHome)
    : path.join(os.homedir(), ".qoder");
  const [projectRoot, userRoot] = await Promise.all([
    canonicalPath(path.join(workspace, ".qoder")),
    canonicalPath(qoderHome),
  ]);
  if (path.relative(readContext.root, userRoot) === "" || path.relative(projectRoot, userRoot) === "") {
    fail("AMBIGUOUS_QODER_SCOPE", "workspace boundary aliases the Qoder user asset home");
  }
}

async function probeCollectorRoot(root, options) {
  if (!(await pathExists(root))) return [];
  await assertSafeProjectReadTarget(options.readContext, root);
  const matches = [];
  let entryCount = 0;

  async function visit(directory, depth) {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const entry of entries) {
      entryCount += 1;
      if (entryCount > MAX_PROBE_ENTRIES) {
        fail("INVENTORY_PROBE_BOUNDS_EXCEEDED", `${options.label} completeness probe exceeded ${MAX_PROBE_ENTRIES} entries`);
      }
      const entryPath = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) {
        fail("UNSUPPORTED_INVENTORY_SYMLINK", `${options.label} contains a symbolic link that the v1 inventory cannot prove`);
      }
      if (entry.isDirectory()) {
        if (depth >= MAX_PROBE_DEPTH) {
          fail("INVENTORY_PROBE_BOUNDS_EXCEEDED", `${options.label} completeness probe exceeded depth ${MAX_PROBE_DEPTH}`);
        }
        await visit(entryPath, depth + 1);
        continue;
      }
      if (!entry.isFile()) {
        fail("UNSUPPORTED_INVENTORY_ENTRY", `${options.label} contains an unsupported filesystem entry`);
      }
      if (!options.match(entryPath)) continue;
      if (depth > options.collectorDepth) {
        fail("INVENTORY_DEPTH_EXCEEDED", `${options.label} contains a supported asset beyond collector depth ${options.collectorDepth}`);
      }
      matches.push(entryPath);
      if (matches.length > options.limit) {
        fail("INVENTORY_LIMIT_EXCEEDED", `${options.label} contains more than ${options.limit} supported assets`);
      }
    }
  }

  await visit(root, 0);
  return matches;
}

async function validateHookJson(readContext, filePath) {
  let value;
  try {
    const evidence = await workspaceFileEvidence(readContext, filePath);
    value = JSON.parse(evidence.content.toString("utf8"));
  } catch {
    fail("INVALID_HOOK_CONFIG", "cannot read or parse Qoder hook configuration");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_HOOK_CONFIG", `Qoder hook configuration ${path.basename(filePath)} must be an object`);
  }
  if (value.hooks === undefined) return 0;
  if (!value.hooks || typeof value.hooks !== "object" || Array.isArray(value.hooks)) {
    fail("INVALID_HOOK_CONFIG", `Qoder hook configuration ${path.basename(filePath)} has an invalid hooks object`);
  }
  let count = 0;
  for (const recordsValue of Object.values(value.hooks)) {
    const records = Array.isArray(recordsValue) ? recordsValue : [recordsValue];
    for (const record of records) {
      if (!record || typeof record !== "object" || Array.isArray(record)) {
        fail("INVALID_HOOK_CONFIG", `Qoder hook configuration ${path.basename(filePath)} has an invalid hook record`);
      }
      const hooks = Array.isArray(record.hooks) ? record.hooks : [record];
      if (hooks.some((hook) => !hook || typeof hook !== "object" || Array.isArray(hook))) {
        fail("INVALID_HOOK_CONFIG", `Qoder hook configuration ${path.basename(filePath)} has an invalid hook declaration`);
      }
      count += hooks.length;
      if (count > MAX_HOOK_DECLARATIONS) {
        fail("INVENTORY_LIMIT_EXCEEDED", `Qoder hook configuration contains more than ${MAX_HOOK_DECLARATIONS} declarations`);
      }
    }
  }
  return count;
}

async function assertQoderInventoryComplete(readContext) {
  const { workspace } = readContext;
  await assertProjectDoesNotAliasQoderHome(readContext);
  await assertProjectReadBoundaries(readContext);
  const qoderRoot = path.join(workspace, ".qoder");
  const agentRoot = path.join(workspace, ".agents");
  const markdown = (filePath) => /\.(?:md|mdc)$/iu.test(path.basename(filePath));
  const skill = (filePath) => path.basename(filePath) === "SKILL.md";
  const json = (filePath) => path.extname(filePath).toLowerCase() === ".json";
  const hookFiles = await probeCollectorRoot(path.join(qoderRoot, "hooks"), {
    readContext,
    label: "Qoder project Hooks",
    collectorDepth: 2,
    limit: 500,
    match: json,
  });
  await Promise.all([
    probeCollectorRoot(path.join(qoderRoot, "rules"), {
      readContext,
      label: "Qoder project Rules",
      collectorDepth: 4,
      limit: 5000,
      match: markdown,
    }),
    probeCollectorRoot(path.join(qoderRoot, "skills"), {
      readContext,
      label: "Qoder project Skills",
      collectorDepth: 5,
      limit: 5000,
      match: skill,
    }),
    probeCollectorRoot(path.join(agentRoot, "skills"), {
      readContext,
      label: "shared project Skills",
      collectorDepth: 5,
      limit: 5000,
      match: skill,
    }),
    probeCollectorRoot(path.join(qoderRoot, "commands"), {
      readContext,
      label: "Qoder project Commands",
      collectorDepth: 4,
      limit: 5000,
      match: markdown,
    }),
  ]);
  const directHookFiles = [path.join(qoderRoot, "settings.json"), path.join(qoderRoot, "settings.local.json"), path.join(qoderRoot, "hooks.json")];
  let hookCount = 0;
  for (const filePath of [...directHookFiles, ...hookFiles]) {
    if (await pathExists(filePath)) hookCount += await validateHookJson(readContext, filePath);
    if (hookCount > MAX_HOOK_DECLARATIONS) {
      fail("INVENTORY_LIMIT_EXCEEDED", `Qoder project contains more than ${MAX_HOOK_DECLARATIONS} hook declarations`);
    }
  }
}

async function workspaceFileEvidence(readContext, filePath) {
  if (typeof filePath !== "string" || !filePath.trim()) {
    fail("MISSING_COMPONENT_FILE", "component evidence does not identify a file");
  }
  const resolvedInput = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(readContext.workspace, filePath);
  const candidate = await realpath(resolvedInput).catch(() => undefined);
  if (!candidate) fail("UNREADABLE_COMPONENT_FILE", "component evidence file cannot be resolved");
  const relative = path.relative(readContext.root, candidate);
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    fail("COMPONENT_FILE_OUTSIDE_WORKSPACE", "component evidence resolves outside the workspace");
  }
  const route = normalizeComponentRoute(relative);
  const fileStats = await stat(candidate).catch(() => undefined);
  if (!fileStats?.isFile()) fail("UNREADABLE_COMPONENT_FILE", "component evidence target is not a regular file");
  if (fileStats.size > MAX_COMPONENT_FILE_BYTES) {
    fail("COMPONENT_FILE_LIMIT_EXCEEDED", `component evidence file exceeds ${MAX_COMPONENT_FILE_BYTES} bytes`);
  }
  const content = await readFile(candidate);
  if (content.byteLength > MAX_COMPONENT_FILE_BYTES) {
    fail("COMPONENT_FILE_LIMIT_EXCEEDED", `component evidence file exceeds ${MAX_COMPONENT_FILE_BYTES} bytes`);
  }
  return { route, content };
}

function hookSemanticDigest(item) {
  return sha256(canonicalStringify({
    event: String(item.step ?? "unknown").normalize("NFC"),
    matcher: String(item.matcher ?? "").normalize("NFC"),
    handlerType: String(item.handlerType ?? "unknown").normalize("NFC"),
  })).slice(0, 16);
}

function hookRoute(route, item) {
  const identityOrdinal = Number(item.identityOrdinal);
  if (!Number.isInteger(identityOrdinal) || identityOrdinal < 0) {
    fail("INVALID_HOOK_IDENTITY_ORDINAL", "hook evidence is missing its duplicate identity ordinal");
  }
  return `${route}#hook/${hookSemanticDigest(item)}/${identityOrdinal}`;
}

function hooksWithIdentityOrdinals(items) {
  const groups = new Map();
  for (const item of items) {
    if (!Number.isInteger(Number(item.registrationIndex)) || Number(item.registrationIndex) < 0
      || !Number.isInteger(Number(item.hookIndex)) || Number(item.hookIndex) < 0) {
      fail("INVALID_HOOK_COORDINATES", "hook evidence is missing stable registration coordinates");
    }
    const fileKey = String(item.evidence?.relativePath ?? item.filePath ?? "").normalize("NFC").replaceAll("\\", "/");
    const key = `${fileKey}\0${hookSemanticDigest(item)}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }
  const ordinals = new Map();
  for (const group of groups.values()) {
    group.sort((left, right) => {
      const registrationDelta = Number(left.registrationIndex) - Number(right.registrationIndex);
      return registrationDelta || Number(left.hookIndex) - Number(right.hookIndex);
    });
    group.forEach((item, index) => ordinals.set(item, index));
  }
  return items.map((item) => ({ ...item, identityOrdinal: ordinals.get(item) }));
}

async function skillTreeRevision(readContext, entryFilePath) {
  const entryEvidence = await workspaceFileEvidence(readContext, entryFilePath);
  const resolvedEntry = path.isAbsolute(entryFilePath)
    ? path.resolve(entryFilePath)
    : path.resolve(readContext.workspace, entryFilePath);
  const skillRoot = path.dirname(await realpath(resolvedEntry));
  const entries = [];
  let totalBytes = 0;

  async function visit(directory, depth) {
    if (depth > MAX_SKILL_DEPTH) {
      fail("SKILL_REVISION_BOUNDS_EXCEEDED", `skill tree exceeds maximum depth ${MAX_SKILL_DEPTH}`);
    }
    const children = await readdir(directory, { withFileTypes: true });
    children.sort((left, right) => compareCodeUnits(left.name, right.name));
    for (const child of children) {
      const childPath = path.join(directory, child.name);
      if (child.isSymbolicLink()) fail("UNSUPPORTED_SKILL_SYMLINK", "skill trees cannot contain symbolic links in v1");
      if (child.isDirectory()) {
        await visit(childPath, depth + 1);
        continue;
      }
      if (!child.isFile()) fail("UNSUPPORTED_SKILL_ENTRY", "skill trees can contain only directories and regular files");
      if (entries.length >= MAX_SKILL_FILES) {
        fail("SKILL_REVISION_BOUNDS_EXCEEDED", `skill tree exceeds maximum file count ${MAX_SKILL_FILES}`);
      }
      const evidence = await workspaceFileEvidence(readContext, childPath);
      totalBytes += evidence.content.byteLength;
      if (totalBytes > MAX_SKILL_BYTES) {
        fail("SKILL_REVISION_BOUNDS_EXCEEDED", `skill tree exceeds maximum byte count ${MAX_SKILL_BYTES}`);
      }
      entries.push({
        route: normalizeComponentRoute(path.relative(skillRoot, await realpath(childPath))),
        revision: contentRevision(evidence.content),
      });
    }
  }

  await visit(skillRoot, 0);
  if (!entries.some((entry) => entry.route === path.basename(entryEvidence.route))) {
    fail("SKILL_ENTRYPOINT_MISSING", "skill tree does not contain its entrypoint");
  }
  entries.sort((left, right) => compareCodeUnits(left.route, right.route));
  return contentRevision(canonicalStringify(entries));
}

async function hookContentRevision(readContext, item) {
  const configurationDigest = String(item.configurationDigest ?? "");
  if (!/^[a-f0-9]{64}$/u.test(configurationDigest)) {
    fail("HOOK_REVISION_UNAVAILABLE", "hook evidence is missing a bounded configuration digest");
  }
  const evidence = {
    configurationRevision: `sha256:${configurationDigest}`,
    position: {
      registrationIndex: Number(item.registrationIndex),
      hookIndex: Number(item.hookIndex),
    },
  };
  if (item.scriptPath) {
    const script = await workspaceFileEvidence(readContext, item.scriptPath);
    evidence.script = { artifactRef: artifactRefForRoute(script.route), revision: contentRevision(script.content) };
  }
  return contentRevision(canonicalStringify(evidence));
}

async function componentFromItem(readContext, populationRef, kind, item) {
  const filePath = item.filePath ?? item.evidence?.path ?? item.path;
  const evidence = await workspaceFileEvidence(readContext, filePath);
  const route = kind === "hook" ? hookRoute(evidence.route, item) : evidence.route;
  const revision = kind === "hook"
    ? await hookContentRevision(readContext, item)
    : kind === "skill"
      ? await skillTreeRevision(readContext, filePath)
      : contentRevision(evidence.content);
  const component = {
    id: componentIdFor({ provider: "qoder", scope: "project", populationRef, kind, route }),
    provider: "qoder",
    scope: "project",
    populationRef,
    kind,
    route,
    identityDigest: "",
    revision,
    activation: {
      state: "unknown",
      evidenceState: "unavailable",
      reason: "runtime-observation-not-collected",
    },
    provenance: {
      state: "observed",
      source: kind === "workflow" ? "qoder-project-workflow-scan" : "qoder-project-inventory",
      artifactRef: artifactRefForRoute(evidence.route),
    },
    rollbackReference: "",
  };
  component.identityDigest = componentIdentityDigest(component);
  component.rollbackReference = rollbackReferenceFor(component);
  return component;
}

async function collectWorkflowItemsWithContext(readContext, options = {}) {
  const items = [];
  for (const segments of WORKFLOW_ROOTS) {
    const root = path.join(readContext.workspace, ...segments);
    const files = await probeCollectorRoot(root, {
      readContext,
      label: `${segments.join("/")} project Workflows`,
      collectorDepth: options.maxDepth ?? MAX_WORKFLOW_DEPTH,
      limit: options.maxFiles ?? MAX_WORKFLOW_FILES,
      match: (filePath) => /\.(?:md|ya?ml|json)$/iu.test(path.basename(filePath)),
    });
    items.push(...files.map((filePath) => ({ filePath })));
  }
  return items;
}

export async function collectWorkflowItems(workspace, options = {}) {
  const readContext = await createWorkspaceReadContext(workspace);
  return collectWorkflowItemsWithContext(readContext, options);
}

function coverageFor(components) {
  return COMPONENT_KINDS.map((kind) => ({
    kind,
    state: "observed",
    count: components.filter((component) => component.kind === kind).length,
  }));
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

async function assembleHarnessComponentSnapshotWithContext({ provider, populationRef: requestedPopulationRef, inventory, workflowItems }, readContext) {
  const populationRef = validatePopulationRef(requestedPopulationRef);
  if (inventory.provider !== provider) fail("INVENTORY_PROVIDER_MISMATCH", "inventory provider does not match the snapshot provider");

  const descriptors = [];
  for (const [collection, kind] of COLLECTION_KINDS) {
    const projectItems = (inventory.manage?.[collection] ?? []).filter((item) => item.scope === "project");
    const identifiedItems = kind === "hook" ? hooksWithIdentityOrdinals(projectItems) : projectItems;
    for (const item of identifiedItems) {
      descriptors.push({ kind, item });
    }
  }
  for (const item of workflowItems) descriptors.push({ kind: "workflow", item });
  if (descriptors.length > MAX_SNAPSHOT_COMPONENTS) {
    fail("SNAPSHOT_COMPONENT_LIMIT_EXCEEDED", `snapshot exceeds ${MAX_SNAPSHOT_COMPONENTS} components`);
  }

  const components = (await mapWithConcurrency(
    descriptors,
    COMPONENT_READ_CONCURRENCY,
    ({ kind, item }) => componentFromItem(readContext, populationRef, kind, item),
  ))
    .sort((left, right) => compareCodeUnits(left.id, right.id));
  const ids = components.map((component) => component.id);
  if (new Set(ids).size !== ids.length) fail("DUPLICATE_COMPONENT_ID", "collected component IDs are not unique");
  const relationships = components.map((component) => ({
    type: "declared-in",
    sourceComponentId: component.id,
    targetArtifactRef: component.provenance.artifactRef,
  }));
  const snapshot = {
    kind: SNAPSHOT_KIND,
    schemaVersion: SNAPSHOT_SCHEMA_VERSION,
    provider,
    scope: "project",
    populationRef,
    coverage: coverageFor(components),
    components,
    relationships,
    snapshotDigest: "",
  };
  snapshot.snapshotDigest = snapshotDigestFor(snapshot);
  validateHarnessComponentSnapshot(snapshot);
  return deepFreeze(snapshot);
}

export async function assembleHarnessComponentSnapshot(options) {
  const readContext = await createWorkspaceReadContext(options.workspace);
  return assembleHarnessComponentSnapshotWithContext(options, readContext);
}

export async function createHarnessComponentSnapshot(options = {}) {
  const provider = String(options.provider ?? "qoder").toLowerCase();
  if (provider !== "qoder") fail("UNSUPPORTED_PROVIDER", `unsupported snapshot provider: ${provider}`);
  const workspace = normalizeWorkspace(options.workspace ?? process.cwd());
  if (!(await isDirectory(workspace))) fail("WORKSPACE_NOT_FOUND", "snapshot workspace must be an existing directory");
  const readContext = await createWorkspaceReadContext(workspace, { requireCanonical: true });
  await assertQoderInventoryComplete(readContext);
  const [inventory, workflowItems] = await Promise.all([
    collectAgentCustomizeInventory({
      provider,
      workspace,
      includeUserHome: false,
      projectCollections: COLLECTION_KINDS.map(([collection]) => collection),
    }),
    collectWorkflowItemsWithContext(readContext),
  ]);
  const populationRef = options.populationKey === undefined
    ? populationRefFromCanonicalWorkspace(readContext.root)
    : populationRefFromKey(options.populationKey);
  return assembleHarnessComponentSnapshotWithContext({ provider, populationRef, inventory, workflowItems }, readContext);
}
