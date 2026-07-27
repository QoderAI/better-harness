import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(currentDir, "findings-recommend.json");
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalIdFor(id) {
  if (!id) {
    return null;
  }
  const value = String(id);
  if (catalog.findings[value]) {
    return value;
  }
  return catalog.summary?.aliases?.[value] ?? null;
}

export function findingsRecommendCatalog() {
  return catalog;
}

export function lookupFindingRecommendation(...ids) {
  for (const id of ids.flat()) {
    const canonicalId = canonicalIdFor(id);
    if (canonicalId && catalog.findings[canonicalId]) {
      return {
        id: canonicalId,
        ...catalog.findings[canonicalId],
      };
    }
  }
  return null;
}

export function localizedRecommendationSuggestion(entry) {
  if (!isPlainObject(entry?.recommendation)) {
    return undefined;
  }
  const en = entry.recommendation.en;
  const zh = entry.recommendation["zh-CN"] ?? entry.recommendation.zh;
  if (!en && !zh) {
    return undefined;
  }
  return {
    ...(en ? { en } : {}),
    ...(zh ? { zh, "zh-CN": zh } : {}),
  };
}

export function enrichFindingWithRecommendation(finding, ids = []) {
  const candidates = [
    ...ids,
    finding?.recommendationId,
    finding?.id,
    finding?.category && finding?.id ? `${finding.category}.${finding.id}` : undefined,
  ].filter(Boolean);
  const entry = lookupFindingRecommendation(candidates);
  if (!entry) {
    return finding;
  }
  const suggestion = localizedRecommendationSuggestion(entry);
  return {
    ...finding,
    recommendationId: entry.id,
    title: entry.title,
    why: entry.why,
    recommendation: entry.recommendation,
    passCheck: entry.passCheck,
    aiFixLabel: entry.aiFixLabel,
    ...(suggestion ? { suggestion } : {}),
  };
}
