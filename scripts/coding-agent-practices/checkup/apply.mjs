import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { collectAgentCustomizeInventory } from "../../agent-customize/index.mjs";
import { hookConfigurationDigest } from "../../agent-customize/core/items.mjs";
import { expandHome } from "../../session-analysis/paths.mjs";
import { CHECKUP_KIND, CHECKUP_SCHEMA_VERSION } from "./contract.mjs";
import { computePlanDigest } from "./plan.mjs";

const ALLOWED_SOURCE_EXTENSIONS = new Set([".json", ".md", ".mdc", ".markdown"]);
const FORBIDDEN_PATH_PARTS = [
  "/.git/",
  "/node_modules/",
  "/plugins/cache/",
  "/extension/local/",
  "/shared_client/",
  "/logs/",
  "/sessions/",
  "/cache/",
];

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceKey(sourceRef) {
  return `${sourceRef.base}:${String(sourceRef.relativePath).replace(/\\/gu, "/")}`;
}

function containedPath(root, relativePath) {
  if (!relativePath || path.isAbsolute(relativePath) || /^[A-Za-z]:[\\/]/u.test(relativePath)) {
    throw new Error("sourceRef.relativePath must be a non-empty relative path");
  }
  const resolvedRoot = path.resolve(root);
  const portableRelativePath = relativePath.replace(/[\\/]+/gu, path.sep);
  const resolvedPath = path.resolve(resolvedRoot, portableRelativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error("sourceRef.relativePath escapes its declared base");
  }
  return resolvedPath;
}

export function resolveSourceRef(sourceRef, options = {}) {
  const workspace = path.resolve(options.workspace ?? process.cwd());
  const providerHome = path.resolve(expandHome(
    options.qoderHome ?? options["qoder-home"] ?? process.env.QODER_HOME ?? path.join(os.homedir(), ".qoder"),
  ));
  const root = sourceRef?.base === "workspace"
    ? workspace
    : sourceRef?.base === "provider-home"
      ? providerHome
      : null;
  if (!root) {
    throw new Error("source patches support only workspace and provider-home owners");
  }
  const filePath = containedPath(root, sourceRef.relativePath);
  const normalized = `/${filePath.split(path.sep).join("/")}/`.toLowerCase();
  if (FORBIDDEN_PATH_PARTS.some((part) => normalized.includes(part))) {
    throw new Error("source patch target is generated, cached, logged, or otherwise immutable");
  }
  if (!ALLOWED_SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase())) {
    throw new Error("source patch target must be a supported instruction or hook source file");
  }
  return { filePath, workspace, key: sourceKey(sourceRef) };
}

function replaceLines(content, patch) {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const trailingNewline = content.endsWith("\n");
  const lines = content.split(/\r?\n/u);
  if (trailingNewline) lines.pop();
  const start = Number(patch.startLine);
  const end = Number(patch.endLine);
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > lines.length) {
    throw new Error("source patch line range is invalid for the current file");
  }
  const currentSegment = lines.slice(start - 1, end).join(newline);
  if (patch.expectedHash && sha256(currentSegment) !== patch.expectedHash) {
    throw new Error("source patch segment drifted after planning");
  }
  const replacementLines = String(patch.replacement ?? "").split(/\r?\n/u);
  if (replacementLines.length === 1 && replacementLines[0] === "") replacementLines.pop();
  lines.splice(start - 1, end - start + 1, ...replacementLines);
  return `${lines.join(newline)}${trailingNewline ? newline : ""}`;
}

function removeHookRegistration(content, patch) {
  const config = JSON.parse(content);
  const original = config?.hooks?.[patch.event];
  if (!original) throw new Error("planned hook event no longer exists");
  const wasArray = Array.isArray(original);
  const records = wasArray ? original : [original];
  const registrationIndex = Number(patch.registrationIndex);
  const hookIndex = Number(patch.hookIndex);
  if (!Number.isInteger(registrationIndex) || !Number.isInteger(hookIndex) || !records[registrationIndex]) {
    throw new Error("planned hook registration index is no longer valid");
  }
  const record = records[registrationIndex];
  const nested = Array.isArray(record?.hooks) ? record.hooks : [record];
  const hook = nested[hookIndex];
  if (!hook) throw new Error("planned nested hook index is no longer valid");
  if (hookConfigurationDigest(patch.event, record, hook) !== patch.expectedConfigurationDigest) {
    throw new Error("planned hook full configuration drifted after planning");
  }
  if (Array.isArray(record?.hooks)) {
    record.hooks.splice(hookIndex, 1);
    if (record.hooks.length === 0) records.splice(registrationIndex, 1);
  } else {
    records.splice(registrationIndex, 1);
  }
  if (records.length === 0) {
    delete config.hooks[patch.event];
  } else {
    config.hooks[patch.event] = wasArray ? records : records[0];
  }
  return `${JSON.stringify(config, null, 2)}\n`;
}

function applySourcePatchContent(content, patch = {}) {
  if (patch.type === "replace-lines") {
    return replaceLines(content, patch);
  }
  if (patch.type === "remove-hook-registration") {
    return removeHookRegistration(content, patch);
  }
  throw new Error(`Unsupported source patch type: ${patch.type ?? "missing"}`);
}

function backupName(sourceRef, now) {
  const timestamp = new Date(now ?? Date.now()).toISOString().replace(/[:.]/gu, "-");
  const safeSource = `${sourceRef.base}-${sourceRef.relativePath}`.replace(/[^A-Za-z0-9._-]+/gu, "__");
  return path.join(timestamp, `${safeSource}.bak`);
}

async function atomicReplace(filePath, content) {
  const metadata = await stat(filePath);
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, content, { flag: "wx" });
    await chmod(temporaryPath, metadata.mode);
    await rename(temporaryPath, filePath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function applySourcePatch(action, options = {}) {
  const sourceRef = action.mutation?.sourceRef;
  const resolved = resolveSourceRef(sourceRef, options);
  const content = await readFile(resolved.filePath, "utf8");
  const expectedFingerprint = action.sourceFingerprints?.[resolved.key];
  if (!expectedFingerprint || sha256(content) !== expectedFingerprint) {
    throw new Error("source fingerprint changed after planning");
  }
  const replacement = applySourcePatchContent(content, action.mutation.patch);
  if (path.extname(resolved.filePath).toLowerCase() === ".json") {
    JSON.parse(replacement);
  }
  const backupRoot = path.join(resolved.workspace, ".better-harness-checkup-backups");
  const relativeBackup = backupName(sourceRef, options.now);
  const backupPath = path.join(backupRoot, relativeBackup);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await copyFile(resolved.filePath, backupPath);
  await atomicReplace(resolved.filePath, replacement);
  const verifiedContent = await readFile(resolved.filePath, "utf8");
  let parser = "readable";
  if (path.extname(resolved.filePath).toLowerCase() === ".json") {
    JSON.parse(verifiedContent);
    parser = "json-verified";
  }
  return {
    status: "applied",
    backup: path.relative(resolved.workspace, backupPath).split(path.sep).join("/"),
    verification: {
      disk: sha256(verifiedContent) === sha256(replacement) ? "verified" : "failed",
      parser,
      runtimeReload: "required",
    },
  };
}

function assertQoderMutation(mutation) {
  if (mutation?.type !== "qoder-cli" || mutation.executable !== "qodercli" || !Array.isArray(mutation.argv)) {
    throw new Error("unsupported Qoder CLI mutation contract");
  }
  const [resource, operation] = mutation.argv;
  if (!new Set(["skills", "mcp", "plugin"]).has(resource) || operation !== "disable") {
    throw new Error("only disable-first Qoder Skill, MCP, and plugin mutations are supported");
  }
  if (mutation.argv.some((value) => typeof value !== "string" || value.includes("\0"))) {
    throw new Error("Qoder CLI argv must contain plain non-null strings");
  }
}

export function createQoderCliExecutor(options = {}) {
  const spawn = options.spawn ?? spawnSync;
  return async (mutation, context = {}) => {
    assertQoderMutation(mutation);
    const result = spawn(mutation.executable, mutation.argv, {
      cwd: context.workspace,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: result.status === 0 && !result.error,
      exitCode: Number.isInteger(result.status) ? result.status : 1,
      signal: result.signal ?? null,
    };
  };
}

function verificationArgv(action) {
  if (action.target.kind === "skill") return ["skills", "list"];
  if (action.target.kind === "mcp") {
    const scope = action.target.scope === "project" ? "project" : "user";
    return ["mcp", "get", action.target.name, "--scope", scope];
  }
  if (action.target.kind === "plugin") return ["plugin", "list", "--json"];
  return null;
}

export function createQoderCliVerificationExecutor(options = {}) {
  const spawn = options.spawn ?? spawnSync;
  return async (action, context = {}) => {
    const argv = verificationArgv(action);
    if (!argv) return { ok: false, exitCode: 1 };
    const result = spawn("qodercli", argv, {
      cwd: context.workspace,
      encoding: "utf8",
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      ok: result.status === 0 && !result.error,
      exitCode: Number.isInteger(result.status) ? result.status : 1,
    };
  };
}

function inventoryCollection(kind) {
  if (kind === "skill") return "skills";
  if (kind === "mcp") return "mcps";
  if (kind === "hook") return "hooks";
  return null;
}

async function verifyQoderAction(action, options, dependencies) {
  const collectInventory = dependencies.collectInventory ?? collectAgentCustomizeInventory;
  const inventory = await collectInventory({
    provider: "qoder",
    workspace: options.workspace,
    qoderHome: options.qoderHome,
    qoderSharedClientCacheRoot: options.qoderSharedClientCacheRoot,
  });
  if (action.target.kind === "plugin") {
    const item = (inventory.plugins ?? []).find((plugin) =>
      (plugin.qoderPluginId ?? plugin.id) === action.target.name ||
      plugin.name === action.target.name ||
      plugin.displayName === action.target.name
    );
    return { disk: !item || item.enabled === false ? "verified" : "not-observed", runtimeReload: "required" };
  }
  const collection = inventoryCollection(action.target.kind);
  const item = collection
    ? (inventory.manage?.[collection] ?? []).find((asset) => asset.name === action.target.name && asset.scope === action.target.scope)
    : null;
  return { disk: !item || item.enabled === false ? "verified" : "not-observed", runtimeReload: "required" };
}

function validatePlan(plan) {
  if (plan?.kind !== CHECKUP_KIND || plan?.phase !== "plan") {
    throw new Error("apply requires a phase=plan Harness Customization Checkup payload");
  }
  if (!plan.planDigest || computePlanDigest(plan) !== plan.planDigest) {
    throw new Error("plan digest does not match the supplied plan content");
  }
}

export async function applyCheckupPlan(plan, options = {}, dependencies = {}) {
  validatePlan(plan);
  if (!options.confirmationDigest || options.confirmationDigest !== plan.planDigest) {
    throw new Error("explicit --confirm-plan-digest must match the supplied plan");
  }
  const selectedActionIds = [...new Set(options.selectedActionIds ?? [])];
  if (selectedActionIds.length === 0) {
    throw new Error("apply requires at least one explicit --action-id");
  }
  const actionById = new Map((plan.actions ?? []).map((action) => [action.id, action]));
  for (const actionId of selectedActionIds) {
    if (!actionById.has(actionId)) throw new Error(`selected action is not present in the plan: ${actionId}`);
  }
  const currentPlan = options.currentPlan ?? plan;
  validatePlan(currentPlan);
  if (currentPlan.planDigest !== plan.planDigest) {
    throw new Error("current evidence or source fingerprints drifted after planning");
  }

  const executeQoder = dependencies.executeQoder ?? createQoderCliExecutor(dependencies.executorOptions);
  const queryQoder = dependencies.queryQoder ?? createQoderCliVerificationExecutor(dependencies.executorOptions);
  const results = [];
  for (const actionId of selectedActionIds) {
    const action = actionById.get(actionId);
    try {
      if (action.mutation?.type === "source-patch") {
        const result = await applySourcePatch(action, options);
        results.push({ actionId, operation: action.operation, ...result });
      } else if (action.mutation?.type === "qoder-cli") {
        const execution = await executeQoder(action.mutation, { workspace: options.workspace });
        if (!execution.ok) {
          throw new Error(`Qoder CLI operation failed with exit code ${execution.exitCode}`);
        }
        const effectiveState = await queryQoder(action, { workspace: options.workspace });
        const verification = dependencies.verifyAction
          ? await dependencies.verifyAction(action)
          : await verifyQoderAction(action, options, dependencies);
        results.push({
          actionId,
          operation: action.operation,
          status: "applied",
          execution,
          verification: {
            ...verification,
            effectiveStateCommand: effectiveState.ok ? "succeeded" : "failed",
          },
        });
      } else {
        results.push({
          actionId,
          operation: action.operation,
          status: "manual-review-required",
          verification: { disk: "not-changed", runtimeReload: "not-applicable" },
        });
      }
    } catch (error) {
      results.push({
        actionId,
        operation: action.operation,
        status: "failed",
        errorCode: error instanceof Error && /fingerprint|drift/iu.test(error.message)
          ? "source-drift"
          : "apply-failed",
      });
      break;
    }
  }

  return {
    kind: CHECKUP_KIND,
    schemaVersion: CHECKUP_SCHEMA_VERSION,
    phase: "apply",
    provider: plan.provider,
    workspace: plan.workspace,
    planDigest: plan.planDigest,
    selectedActionIds,
    results,
    summary: {
      selected: selectedActionIds.length,
      applied: results.filter((result) => result.status === "applied").length,
      failed: results.filter((result) => result.status === "failed").length,
      manualReviewRequired: results.filter((result) => result.status === "manual-review-required").length,
    },
    verificationBoundary: "disk/config verification is separate from runtime reload evidence",
  };
}
