import { matchesAnyPattern } from "../blast-radius/utils.mjs";

const BLOCKING_CONFIDENCE = new Set(["high", "medium"]);

export function applyMappingPolicy(mapping, config, options = {}) {
  const criticalMatches = criticalPathMatches(mapping.sourceFile, config);
  const blockOnCriticalMissing = options.blockOnCriticalMissing !== false;
  let gate = "pass";
  const reasons = [];

  if (mapping.status === "missing") {
    if (
      blockOnCriticalMissing &&
      criticalMatches.length > 0 &&
      BLOCKING_CONFIDENCE.has(mapping.confidence)
    ) {
      gate = "block";
      reasons.push("critical source path changed without mapped test evidence");
    } else {
      gate = "remind";
      reasons.push("source path changed without mapped test evidence");
    }
  } else if (mapping.status === "unknown" && criticalMatches.length > 0) {
    gate = "remind";
    reasons.push("critical source path changed but test mapping is unknown");
  }

  return {
    ...mapping,
    gate,
    criticalMatches,
    reasons,
  };
}

function criticalPathMatches(sourceFile, config) {
  const rules = config.core ?? [];
  return rules
    .filter((rule) => matchesAnyPattern(sourceFile, rule.paths ?? []))
    .map((rule) => ({
      rule: rule.name ?? "core code",
      risk: rule.risk ?? "medium",
      message: rule.message ?? "",
    }));
}
