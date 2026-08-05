import { createHash } from "node:crypto";

export function normalizeIdentity(value) {
  return String(value ?? "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^git\+/iu, "")
    .replace(/^git@github\.com:/iu, "github.com/")
    .replace(/^ssh:\/\/git@github\.com\//iu, "github.com/")
    .split(/[?#]/u, 1)[0]
    .replace(/\.git$/iu, "")
    .replace(/^https?:\/\//iu, "")
    .replace(/\/$/u, "")
    .toLowerCase();
}

function pluginIdentityValues(plugin) {
  return [
    plugin.id,
    plugin.name,
    plugin.claudePluginId,
    plugin.codexPluginId,
    plugin.qoderPluginId,
    plugin.cursorPluginId,
    plugin.remotePluginId,
    plugin.copilotPluginName,
    plugin.piPackageSource,
  ].filter((value) => typeof value === "string" && value.trim());
}

export function matchesBetterHarnessPlugin(plugin, profile) {
  if (!plugin || !profile) return false;
  const names = new Set(profile.identity.names.map(normalizeIdentity));
  const nativeIds = new Set(profile.identity.nativeIds.map(normalizeIdentity));
  const repositories = new Set(profile.identity.repositories.map(normalizeIdentity));
  if (names.has(normalizeIdentity(plugin.name))) return true;
  for (const value of pluginIdentityValues(plugin)) {
    const normalized = normalizeIdentity(value);
    if (nativeIds.has(normalized) || repositories.has(normalized)) return true;
  }
  return false;
}

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, stableValue(value[key])]),
    );
  }
  return value;
}

export function stableSerialize(value) {
  return JSON.stringify(stableValue(value));
}

export function stableDigest(value) {
  return createHash("sha256")
    .update(stableSerialize(value))
    .digest("hex");
}
