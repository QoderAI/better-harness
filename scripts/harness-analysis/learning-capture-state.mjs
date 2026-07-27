import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { restoreProjectedInterventionLedger } from "./intervention-ledger.mjs";

async function findingsCandidates(root, depth = 0) {
  if (depth > 3) return [];
  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = [];
  for (const entry of entries) {
    if (entry.name.startsWith("_") || entry.name.startsWith(".")) continue;
    const target = path.join(root, entry.name);
    if (entry.isDirectory()) {
      candidates.push(...await findingsCandidates(target, depth + 1));
    } else if (entry.isFile() && entry.name === "findings.json") {
      try {
        const metadata = await stat(target);
        candidates.push({ path: target, mtimeMs: metadata.mtimeMs });
      } catch {
        // Ignore a report that disappeared during discovery.
      }
    }
  }
  return candidates;
}

function restoreLedger(projected) {
  if (!Array.isArray(projected)) {
    return { valid: false, interventionLedger: [], reason: "missing-intervention-ledger" };
  }
  if (projected.length === 0) return { valid: true, interventionLedger: [] };
  const interventionLedger = restoreProjectedInterventionLedger(projected);
  return {
    valid: interventionLedger.length === projected.length,
    interventionLedger,
    ...(interventionLedger.length === projected.length ? {} : { reason: "invalid-intervention-ledger" }),
  };
}

async function readLedger(findingsPath, { projectName }) {
  try {
    const payload = JSON.parse(await readFile(findingsPath, "utf8"));
    if (payload?.summary?.projectName !== projectName) return { valid: false, interventionLedger: [], reason: "project-mismatch" };
    const projected = payload?.summary?.learningCapture?.interventions;
    if (!payload?.summary?.learningCapture || !Array.isArray(projected)) {
      return { valid: false, interventionLedger: [], reason: "missing-learning-capture-capability" };
    }
    // Continuity is field-scoped: only the projected intervention ledger is
    // restored and validated. Model and report version metadata never select
    // whether this capability is readable.
    return restoreLedger(projected);
  } catch {
    return { valid: false, interventionLedger: [], reason: "unreadable-report" };
  }
}

export async function loadPriorLearningCaptureState({
  workspace,
  previousFindings,
} = {}) {
  const projectName = path.basename(path.resolve(workspace));
  const candidates = previousFindings
    ? [{ path: path.resolve(previousFindings), mtimeMs: Number.MAX_SAFE_INTEGER }]
    : await findingsCandidates(path.join(path.resolve(workspace), ".qoder", "better-harness"));
  candidates.sort((left, right) => right.mtimeMs - left.mtimeMs || right.path.localeCompare(left.path));
  if (candidates.length === 0) return { interventionLedger: [], evidenceRef: null, warning: null };

  for (const candidate of candidates) {
    const restored = await readLedger(candidate.path, { projectName });
    if (!restored.valid) {
      if (previousFindings) {
        throw Object.assign(new Error(`explicit prior findings report is invalid: ${restored.reason}`), {
          code: "INVALID_PRIOR_LEARNING_CAPTURE_REPORT",
        });
      }
      continue;
    }
    const interventionLedger = restored.interventionLedger;
    if (interventionLedger.length === 0) return { interventionLedger: [], evidenceRef: null, warning: null };
    return {
      interventionLedger,
      evidenceRef: {
        kind: "prior-harness-report",
        id: "learning-capture-intervention-ledger",
        label: `${interventionLedger.length} validated prior intervention${interventionLedger.length === 1 ? "" : "s"}`,
      },
      warning: null,
    };
  }

  return {
    interventionLedger: [],
    evidenceRef: null,
    warning: { code: "invalid-prior-learning-capture-report" },
  };
}
