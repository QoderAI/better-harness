import path from "node:path";

import { CONFIG_PATH, isIgnored, loadConfig } from "./config.mjs";
import { collectGitChanges, isGitFailureError } from "./git.mjs";
import { buildCodeGraph, mapChangedSymbols } from "./graph.mjs";
import { isTestFile } from "./parser.mjs";
import { matchesAnyPattern, normalizeRelativePath, unique } from "./utils.mjs";

function emptyMetrics() {
  return {
    changedFiles: 0,
    changedLines: 0,
    changedSymbols: 0,
    impactedSymbols: 0,
    impactedFiles: 0,
    testGaps: 0,
    securityRemovals: 0,
    parsedFiles: 0,
  };
}

function gitFailureReport(error) {
  const message = error.code === "GIT_BASE_REF_UNAVAILABLE"
    ? `Blast radius could not verify git base ref "${error.ref}"; failing closed because changed files cannot be distinguished from a real empty diff.`
    : `Blast radius git collection failed (${error.code}); failing closed because changed files cannot be distinguished from a real empty diff.`;

  return {
    status: "error",
    shouldReview: true,
    score: 100,
    severity: "critical",
    reasons: [message],
    metrics: emptyMetrics(),
    changedFiles: [],
    changedSymbols: [],
    affectedSymbols: [],
    affectedFiles: [],
    coreHits: [],
    testGaps: [],
    securityRemovals: [],
    error: {
      type: "git",
      code: error.code,
      message: error.message,
      ref: error.ref,
      command: error.command,
      status: error.status,
      stderr: error.stderr,
    },
    configPath: CONFIG_PATH,
  };
}
function enrichCallers(changedSymbols, graph, config) {
  return changedSymbols.map((symbol) => {
    const callerIds = graph.reverseEdges.get(symbol.id) ?? [];
    const callers = callerIds.map((id) => graph.symbolById.get(id)).filter(Boolean);
    const callerFiles = unique(callers.map((caller) => caller.filePath)).slice(0, 10);
    const callerCount = callers.length;
    const callerLevel = thresholdLevel(callerCount, config.thresholds.callerCount);

    return {
      ...symbol,
      callerCount,
      callerFiles,
      testFiles: unique(graph.testFilesBySymbolId.get(symbol.id) ?? []),
      callerLevel,
    };
  });
}

function computeImpactRadius(changedSymbols, graph, config) {
  const changedIds = new Set(changedSymbols.map((symbol) => symbol.id));
  const visited = new Set(changedIds);
  const queue = changedSymbols.map((symbol) => ({ id: symbol.id, depth: 0, via: null }));
  const affected = [];

  while (queue.length > 0 && affected.length < config.limits.maxImpactSymbols) {
    const current = queue.shift();
    if (current.depth >= config.limits.blastRadiusDepth) {
      continue;
    }

    for (const callerId of graph.reverseEdges.get(current.id) ?? []) {
      if (visited.has(callerId)) {
        continue;
      }
      visited.add(callerId);
      const caller = graph.symbolById.get(callerId);
      if (!caller) {
        continue;
      }

      const item = {
        ...caller,
        depth: current.depth + 1,
        via: graph.symbolById.get(current.id)?.name ?? current.via,
      };
      affected.push(item);
      queue.push({ id: callerId, depth: item.depth, via: item.via });
    }
  }

  const affectedFiles = unique(affected.map((symbol) => symbol.filePath));
  return {
    affectedSymbols: affected,
    affectedFiles,
    truncated: queue.length > 0 || affected.length >= config.limits.maxImpactSymbols,
  };
}

function computeTestGaps(changedSymbols, graph) {
  return changedSymbols
    .filter((symbol) => !isTestFile(symbol.filePath))
    .filter((symbol) => (graph.testFilesBySymbolId.get(symbol.id) ?? []).length === 0)
    .map((symbol) => ({
      name: symbol.name,
      filePath: symbol.filePath,
      line: symbol.startLine,
    }));
}

function thresholdLevel(value, threshold) {
  if (value >= threshold.critical) {
    return "critical";
  }
  if (value >= threshold.high) {
    return "high";
  }
  if (value >= threshold.warn) {
    return "medium";
  }
  return "low";
}

function thresholdScore(value, threshold) {
  const level = thresholdLevel(value, threshold);
  if (level === "critical") {
    return 30;
  }
  if (level === "high") {
    return 20;
  }
  if (level === "medium") {
    return 10;
  }
  return 0;
}

function riskWeight(risk) {
  switch (risk) {
    case "critical":
      return 45;
    case "high":
      return 35;
    case "medium":
      return 25;
    case "low":
      return 15;
    default:
      return 25;
  }
}

function scoreSeverity(score) {
  if (score >= 90) {
    return "critical";
  }
  if (score >= 70) {
    return "high";
  }
  if (score >= 45) {
    return "medium";
  }
  return "low";
}

function coreHitsFor(changedFiles, changedSymbols, config) {
  const hits = [];
  const seen = new Set();

  for (const rule of config.core) {
    for (const file of changedFiles) {
      if (!matchesAnyPattern(file, rule.paths)) {
        continue;
      }
      const key = `${rule.name}:path:${file}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push({
        rule: rule.name,
        type: "path",
        target: file,
        risk: rule.risk,
        message: rule.message,
      });
    }

    for (const symbol of changedSymbols) {
      if (!matchesAnyPattern(symbol.name, rule.symbols, { caseInsensitive: true })) {
        continue;
      }
      const key = `${rule.name}:symbol:${symbol.filePath}:${symbol.name}`;
      if (seen.has(key)) {
        continue;
      }
      seen.add(key);
      hits.push({
        rule: rule.name,
        type: "symbol",
        target: `${symbol.name} (${symbol.filePath}:${symbol.startLine})`,
        risk: rule.risk,
        message: rule.message,
      });
    }
  }

  return hits;
}

function buildReasons(metrics, changedSymbols, impact, coreHits, testGaps, securityRemovals, graph, config) {
  const reasons = [];

  if (thresholdLevel(metrics.changedFiles, config.thresholds.changedFiles) !== "low") {
    reasons.push(`Too many files changed: ${metrics.changedFiles}`);
  }

  if (thresholdLevel(metrics.changedLines, config.thresholds.changedLines) !== "low") {
    reasons.push(`Too many changed lines: ${metrics.changedLines}`);
  }

  if (thresholdLevel(metrics.changedSymbols, config.thresholds.changedSymbols) !== "low") {
    reasons.push(`Too many changed symbols: ${metrics.changedSymbols}`);
  }

  if (thresholdLevel(metrics.impactedSymbols, config.thresholds.impactedSymbols) !== "low") {
    reasons.push(
      `Blast radius reaches ${metrics.impactedSymbols} symbol(s) across ${metrics.impactedFiles} file(s)`,
    );
  }

  if (thresholdLevel(metrics.impactedFiles, config.thresholds.impactedFiles) !== "low") {
    reasons.push(`Blast radius crosses ${metrics.impactedFiles} file(s)`);
  }

  for (const hit of coreHits.slice(0, 5)) {
    reasons.push(`Changed core code: ${hit.rule} -> ${hit.target}`);
  }

  for (const symbol of changedSymbols) {
    if (symbol.callerLevel === "low") {
      continue;
    }
    reasons.push(
      `High blast radius: ${symbol.name} has ${symbol.callerCount} caller(s) across ${symbol.callerFiles.length} file(s)`,
    );
  }

  for (const gap of testGaps.slice(0, 5)) {
    reasons.push(`Missing direct test coverage: ${gap.name} (${gap.filePath}:${gap.line})`);
  }

  for (const removal of securityRemovals.slice(0, 5)) {
    reasons.push(`Removed security-like check: ${removal.filePath}:${removal.line} "${removal.text}"`);
  }

  if (impact.truncated) {
    reasons.push(
      `Blast radius truncated at ${config.limits.maxImpactSymbols} affected symbols; review may undercount impact`,
    );
  }

  if (graph.truncated) {
    reasons.push(
      `Call graph truncated at ${config.limits.maxSourceFiles} source files; review may undercount callers`,
    );
  }

  return reasons;
}

function computeScore(metrics, changedSymbols, impact, coreHits, testGaps, securityRemovals, config) {
  let score = 0;

  score += thresholdScore(metrics.changedFiles, config.thresholds.changedFiles);
  score += thresholdScore(metrics.changedLines, config.thresholds.changedLines);
  score += thresholdScore(metrics.changedSymbols, config.thresholds.changedSymbols);
  score += thresholdScore(metrics.impactedSymbols, config.thresholds.impactedSymbols);
  score += thresholdScore(metrics.impactedFiles, config.thresholds.impactedFiles);

  const highestCore = Math.max(0, ...coreHits.map((hit) => riskWeight(hit.risk)));
  score += highestCore;

  const highestCaller = Math.max(
    0,
    ...changedSymbols.map((symbol) => thresholdScore(symbol.callerCount, config.thresholds.callerCount)),
  );
  score += highestCaller;
  score += Math.min(testGaps.length * 5, 15);
  score += Math.min(securityRemovals.length * 15, 30);
  if (impact.truncated) {
    score += 10;
  }

  return Math.min(score, 100);
}

export async function analyzeRepository(repoRoot, options = {}) {
  const root = path.resolve(repoRoot || process.cwd());
  const config = options.config ?? (await loadConfig(root, options.configPath));
  let changes;
  try {
    changes = options.changes ?? (await collectGitChanges(root, config));
  } catch (error) {
    if (isGitFailureError(error)) {
      return gitFailureReport(error);
    }
    throw error;
  }
  const changedFiles = changes.files
    .map((file) => ({
      ...file,
      filePath: normalizeRelativePath(root, file.filePath),
    }))
    .filter((file) => !isIgnored(file.filePath, config));
  const changedFilePaths = changedFiles.map((file) => file.filePath);
  const ranges = Object.fromEntries(
    Object.entries(changes.ranges)
      .map(([file, fileRanges]) => [normalizeRelativePath(root, file), fileRanges])
      .filter(([file]) => changedFilePaths.includes(file)),
  );

  if (changedFiles.length === 0) {
    const metrics = emptyMetrics();
    return {
      status: "ok",
      shouldReview: false,
      score: 0,
      severity: scoreSeverity(0),
      reasons: [],
      metrics,
      changedFiles: [],
      changedSymbols: [],
      affectedSymbols: [],
      affectedFiles: [],
      coreHits: [],
      testGaps: [],
      securityRemovals: [],
      configPath: CONFIG_PATH,
    };
  }

  const graph = await buildCodeGraph(root, changedFilePaths, config);
  const changedSymbols = enrichCallers(
    mapChangedSymbols(changedFilePaths, ranges, graph),
    graph,
    config,
  );
  const impact = computeImpactRadius(changedSymbols, graph, config);
  const coreHits = coreHitsFor(changedFilePaths, changedSymbols, config);
  const testGaps = computeTestGaps(changedSymbols, graph);
  const securityRemovals = (changes.securityRemovals ?? [])
    .map((item) => ({ ...item, filePath: normalizeRelativePath(root, item.filePath) }))
    .filter((item) => changedFilePaths.includes(item.filePath));
  const metrics = {
    changedFiles: changedFiles.length,
    changedLines: changedFiles.reduce((sum, file) => sum + file.added + file.deleted, 0),
    changedSymbols: changedSymbols.length,
    impactedSymbols: impact.affectedSymbols.length,
    impactedFiles: impact.affectedFiles.length,
    testGaps: testGaps.length,
    securityRemovals: securityRemovals.length,
    parsedFiles: graph.parsedFiles,
  };
  const reasons = buildReasons(
    metrics,
    changedSymbols,
    impact,
    coreHits,
    testGaps,
    securityRemovals,
    graph,
    config,
  );
  const score = computeScore(
    metrics,
    changedSymbols,
    impact,
    coreHits,
    testGaps,
    securityRemovals,
    config,
  );
  const shouldReview =
    score >= config.thresholds.reviewScore ||
    coreHits.some((hit) => ["critical", "high"].includes(hit.risk)) ||
    securityRemovals.length > 0;

  return {
    status: shouldReview ? "review-recommended" : "ok",
    shouldReview,
    score,
    severity: scoreSeverity(score),
    reasons,
    metrics,
    changedFiles,
    changedSymbols,
    affectedSymbols: impact.affectedSymbols,
    affectedFiles: impact.affectedFiles,
    coreHits,
    testGaps,
    securityRemovals,
    configPath: CONFIG_PATH,
  };
}
