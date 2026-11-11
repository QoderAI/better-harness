import { existsSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const QODER_ASSET_HOME_NAMES = new Set([".qoder", "qoder", ".qoder-cn", "qoder-cn"]);
const QODER_SESSION_DIRECTORIES = ["audit", path.join("logs", "sessions"), "projects", "sessions"];
// logs/sessions/<slug>/<session>/segments/*.jsonl is the deepest layout.
const QODER_SESSION_SCAN_DEPTH = 3;

// Kept local because session-analysis re-exports the Qoder analyzer that
// imports this module, and the refactor contract forbids deep imports.
function expandHome(filePath) {
  if (!filePath) return filePath;
  if (filePath === "~") return os.homedir();
  if (filePath.startsWith("~/")) return path.join(os.homedir(), filePath.slice(2));
  return filePath;
}

function environmentFor(options = {}) {
  return options.env ?? process.env;
}

export function looksLikeQoderAssetHome(candidate) {
  return QODER_ASSET_HOME_NAMES.has(path.basename(String(candidate ?? "")).toLowerCase());
}

function containsJsonl(directory, depth) {
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return false;
  }
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith(".jsonl")) return true;
  }
  if (depth <= 0) return false;
  return entries.some(
    (entry) => entry.isDirectory() && containsJsonl(path.join(directory, entry.name), depth - 1),
  );
}

// An empty or log-only directory is not session data; only a transcript file
// in a root the analyzer reads counts, so it cannot mask a populated home.
function hasQoderSessionData(home) {
  return QODER_SESSION_DIRECTORIES.some((directory) =>
    containsJsonl(path.join(home, directory), QODER_SESSION_SCAN_DEPTH),
  );
}

export function defaultQoderHome() {
  const internationalHome = path.join(os.homedir(), ".qoder");
  const cnHome = path.join(os.homedir(), ".qoder-cn");
  const cnExists = existsSync(cnHome);
  if (!cnExists) return internationalHome;
  const internationalExists = existsSync(internationalHome);
  if (!internationalExists) return cnHome;
  const cnHasSessions = hasQoderSessionData(cnHome);
  const internationalHasSessions = hasQoderSessionData(internationalHome);
  return cnHasSessions && !internationalHasSessions ? cnHome : internationalHome;
}

export function defaultQoderSharedClientCacheRoot() {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Qoder", "SharedClientCache");
  }
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "Qoder", "SharedClientCache");
  }
  const xdgConfig = process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), ".config");
  return path.join(xdgConfig, "Qoder", "SharedClientCache");
}

export function resolveQoderAssetHome(options = {}) {
  const explicit = options.qoderHome ?? options["qoder-home"];
  if (explicit) return path.resolve(expandHome(explicit));
  const environmentHome = environmentFor(options).QODER_HOME;
  if (environmentHome && looksLikeQoderAssetHome(environmentHome)) {
    return path.resolve(expandHome(environmentHome));
  }
  return defaultQoderHome();
}

export function resolveQoderSessionHome(options = {}) {
  const explicit = options.home ?? options.qoderHome ?? options["qoder-home"];
  if (explicit) return path.resolve(expandHome(explicit));
  const environmentHome = environmentFor(options).QODER_HOME;
  if (environmentHome && looksLikeQoderAssetHome(environmentHome)) {
    return path.resolve(expandHome(environmentHome));
  }
  return defaultQoderHome();
}

export function resolveQoderSharedClientCacheRoot(options = {}) {
  const explicit =
    options.qoderSharedClientCacheRoot ??
    options["qoder-shared-client-cache-root"] ??
    options.sharedClientCacheRoot;
  if (explicit) return path.resolve(expandHome(explicit));
  const environmentHome = environmentFor(options).QODER_HOME;
  if (environmentHome && !looksLikeQoderAssetHome(environmentHome)) {
    return path.resolve(expandHome(environmentHome));
  }
  return defaultQoderSharedClientCacheRoot();
}
