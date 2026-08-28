import os from "node:os";
import path from "node:path";

import { pathExists } from "../fs.mjs";
import { expandHome, normalizeWorkspace } from "../paths.mjs";

export const CURSOR_COMPOSER_CONTEXT_USAGE_EVIDENCE = "cursor-native-composer-state";

const APPLICATION_USER_STORAGE_KEY =
  "src.vs.platform.reactivestorage.browser.reactiveStorageServiceImpl.persistentStorage.applicationUser";
const COMPOSER_DATA_PREFIX = "composerData:";
const CONTEXT_USAGE_SCHEMA_VERSION = 1;

function platformPath(platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

export function defaultCursorStateDbPath({
  platform = process.platform,
  homedir = os.homedir(),
  env = process.env,
} = {}) {
  const paths = platformPath(platform);
  if (platform === "darwin") {
    return paths.join(homedir, "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (platform === "win32") {
    const appData = env.APPDATA ?? paths.join(homedir, "AppData", "Roaming");
    return paths.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  const xdgConfig = env.XDG_CONFIG_HOME ?? paths.join(homedir, ".config");
  return paths.join(xdgConfig, "Cursor", "User", "globalStorage", "state.vscdb");
}

export function resolveCursorStateDbPath(options = {}) {
  return path.resolve(expandHome(options.stateDbPath ?? options["state-db"] ?? defaultCursorStateDbPath()));
}

function boundedText(value, limit) {
  return String(value ?? "").trim().slice(0, limit);
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : null;
}

function timestamp(value) {
  const millis = Number(value);
  if (!Number.isFinite(millis) || millis <= 0) return null;
  const result = new Date(millis);
  return Number.isNaN(result.getTime()) ? null : result.toISOString();
}

function parseJson(value, fallback) {
  try {
    return JSON.parse(String(value ?? ""));
  } catch {
    return fallback;
  }
}

function isWithinWorkspace(candidate, roots) {
  if (!candidate) return false;
  const resolved = normalizeWorkspace(candidate);
  return roots.some((root) => {
    const relative = path.relative(normalizeWorkspace(root), resolved);
    return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
  });
}

function workspaceRoots(scope) {
  return [...new Set([
    scope.workspace,
    scope._workspaceMatchScope?.requestedWorkspace,
    scope._workspaceMatchScope?.gitRoot,
  ].filter(Boolean).map(normalizeWorkspace))];
}

function projectedCategories(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, 40).flatMap((category) => {
    const estimatedTokens = positiveInteger(category?.estimatedTokens);
    if (!estimatedTokens) return [];
    return [{
      id: boundedText(category?.id, 80) || "other",
      label: boundedText(category?.label, 120) || "Other",
      estimatedTokens,
    }];
  });
}

function modelCatalog(db) {
  const row = db.prepare(`
    select case
      when json_valid(value) then json_extract(value, '$.availableDefaultModels2')
      else null
    end as models
    from ItemTable
    where key = ?
  `).get(APPLICATION_USER_STORAGE_KEY);
  const models = parseJson(row?.models, []);
  return new Map((Array.isArray(models) ? models : []).flatMap((model) => {
    const contextWindowSize = positiveInteger(model?.contextTokenLimit);
    if (!contextWindowSize) return [];
    return [...new Set([model?.name, model?.serverModelName]
      .map((name) => boundedText(name, 120))
      .filter(Boolean))]
      .map((name) => [name, contextWindowSize]);
  }));
}

const COMPOSER_CONTEXT_SELECT = `
  select
    substr(data.key, ${COMPOSER_DATA_PREFIX.length + 1}) as composerId,
    header.lastUpdatedAt as lastUpdatedAt,
    case when json_valid(header.value)
      then json_extract(header.value, '$.workspaceIdentifier.uri.fsPath')
      else null end as workspacePath,
    case when json_valid(data.value)
      then json_extract(data.value, '$.modelConfig.modelName')
      else null end as modelName,
    case when json_valid(data.value)
      then json_extract(data.value, '$.promptTokenBreakdown.totalUsedTokens')
      else null end as totalUsedTokens,
    case when json_valid(data.value)
      then json_extract(data.value, '$.promptTokenBreakdown.maxTokens')
      else null end as composerMaxTokens,
    case when json_valid(data.value)
      then json_extract(data.value, '$.promptTokenBreakdown.categories')
      else null end as categories
  from cursorDiskKV data
  join composerHeaders header
    on header.composerId = substr(data.key, ${COMPOSER_DATA_PREFIX.length + 1})
`;

function projectComposerRow(row, catalog, roots) {
  const composerId = boundedText(row?.composerId, 120);
  const capturedAt = timestamp(row?.lastUpdatedAt);
  const totalTokensUsed = positiveInteger(row?.totalUsedTokens);
  const modelName = boundedText(row?.modelName, 120);
  const contextWindowSize = catalog.get(modelName) ?? positiveInteger(row?.composerMaxTokens);
  if (!composerId || !capturedAt || !totalTokensUsed || !contextWindowSize) return null;
  if (!isWithinWorkspace(row?.workspacePath, roots)) return null;
  const categories = projectedCategories(parseJson(row?.categories, []));
  return {
    schemaVersion: CONTEXT_USAGE_SCHEMA_VERSION,
    status: "observed",
    evidence: CURSOR_COMPOSER_CONTEXT_USAGE_EVIDENCE,
    capturedAt,
    totalTokensUsed,
    contextWindowSize,
    percentFull: Math.min(100, Math.round((totalTokensUsed / contextWindowSize) * 100)),
    categories,
    items: [],
    coverage: {
      snapshotCount: 1,
      itemCount: 0,
      sourceItemCount: 0,
      truncated: false,
      rawTextOmitted: true,
    },
    actions: { openAgentId: composerId },
  };
}

export async function findCursorComposerContextUsages(scope, { sessionIds = [] } = {}) {
  const stateDbPath = scope.stateDbPath ?? resolveCursorStateDbPath(scope);
  if (!await pathExists(stateDbPath)) return [];
  let db;
  try {
    const sqlite = await import("node:sqlite");
    db = new sqlite.DatabaseSync(stateDbPath, { readOnly: true });
    const catalog = modelCatalog(db);
    const rows = sessionIds.length > 0
      ? sessionIds.flatMap((sessionId) => {
        const row = db.prepare(`${COMPOSER_CONTEXT_SELECT} where data.key = ?`).get(`${COMPOSER_DATA_PREFIX}${sessionId}`);
        return row ? [row] : [];
      })
      : db.prepare(`${COMPOSER_CONTEXT_SELECT} where data.key like ?`).all(`${COMPOSER_DATA_PREFIX}%`);
    const roots = workspaceRoots(scope);
    return rows
      .map((row) => projectComposerRow(row, catalog, roots))
      .filter(Boolean)
      .sort((left, right) => Date.parse(right.capturedAt) - Date.parse(left.capturedAt));
  } catch {
    return [];
  } finally {
    db?.close();
  }
}
