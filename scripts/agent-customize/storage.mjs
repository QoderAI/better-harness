import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

import { pathExists } from "../session-analysis/fs.mjs";
import { expandHome } from "../session-analysis/paths.mjs";

const execFileAsync = promisify(execFile);
const STORAGE_PREFIX = "cursor.plugins.installedIds";

export function workspaceUriForStorage(workspace) {
  return workspace ? pathToFileURL(path.resolve(workspace)).href : "no-workspace";
}

export function defaultCursorStateDbPath() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Cursor", "User", "globalStorage", "state.vscdb");
  }
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Cursor", "User", "globalStorage", "state.vscdb");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "Cursor", "User", "globalStorage", "state.vscdb");
}

function normalizeInstalledRecord(record) {
  const id = String(record?.id ?? record?.pluginId ?? "").trim();
  if (!id) {
    return undefined;
  }
  const rawSources = Array.isArray(record.sources)
    ? record.sources
    : Array.isArray(record.scopes)
      ? record.scopes
      : [];
  const sources = rawSources.map((source) => String(source).trim()).filter(Boolean);
  return {
    id,
    sources,
    source: sources.includes("project") ? "project" : sources.includes("team") ? "team" : "user",
  };
}

function parseInstalledRecords(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.map(normalizeInstalledRecord).filter(Boolean);
  } catch {
    return [];
  }
}

function selectInstalledRow(rows, workspaceUri, teamId) {
  const exactTeamKey = teamId ? `${STORAGE_PREFIX}.${teamId}|${workspaceUri}` : undefined;
  const exactNoTeamKey = `${STORAGE_PREFIX}.no-team|${workspaceUri}`;
  const noWorkspaceNoTeamKey = `${STORAGE_PREFIX}.no-team|no-workspace`;
  const noWorkspaceTeamKey = teamId ? `${STORAGE_PREFIX}.${teamId}|no-workspace` : undefined;
  const byKey = new Map(rows.map((row) => [row.key, row]));
  for (const key of [exactTeamKey, exactNoTeamKey, noWorkspaceTeamKey, noWorkspaceNoTeamKey]) {
    if (key && byKey.has(key)) {
      return byKey.get(key);
    }
  }
  const workspaceRows = rows.filter((row) => row.key.endsWith(`|${workspaceUri}`));
  if (workspaceRows.length > 0) {
    return workspaceRows
      .map((row) => ({ row, count: parseInstalledRecords(row.value).length }))
      .sort((left, right) => right.count - left.count)[0].row;
  }
  return undefined;
}

async function readRowsWithNodeSqlite(dbPath) {
  try {
    const sqlite = await import("node:sqlite");
    const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    try {
      return db
        .prepare("select key, value from ItemTable where key like ? order by key")
        .all(`${STORAGE_PREFIX}.%`);
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

async function readRowsWithSqliteCli(dbPath) {
  try {
    const { stdout } = await execFileAsync("sqlite3", [
      "-separator",
      "\u001f",
      dbPath,
      `select key, value from ItemTable where key like '${STORAGE_PREFIX}.%' order by key;`,
    ]);
    return stdout
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((line) => {
        const separator = line.indexOf("\u001f");
        return separator === -1
          ? undefined
          : { key: line.slice(0, separator), value: line.slice(separator + 1) };
      })
      .filter(Boolean);
  } catch {
    return undefined;
  }
}

async function readInstalledRows(dbPath) {
  return (await readRowsWithNodeSqlite(dbPath)) ?? (await readRowsWithSqliteCli(dbPath)) ?? [];
}

export async function readInstalledPluginState(options = {}) {
  if (Array.isArray(options.installedPluginRecords)) {
    return {
      records: options.installedPluginRecords.map(normalizeInstalledRecord).filter(Boolean),
      source: "provided",
    };
  }

  const stateDbPath = path.resolve(expandHome(options.stateDbPath ?? defaultCursorStateDbPath()));
  if (!(await pathExists(stateDbPath))) {
    return {
      records: undefined,
      stateDbPath,
      source: "missing",
    };
  }

  const workspaceUri = workspaceUriForStorage(options.workspace);
  const rows = await readInstalledRows(stateDbPath);
  const selected = selectInstalledRow(rows, workspaceUri, options.teamId);
  return {
    records: selected ? parseInstalledRecords(selected.value) : undefined,
    storageKey: selected?.key,
    stateDbPath,
    workspaceUri,
    source: selected ? "state.vscdb" : "not-found",
  };
}
