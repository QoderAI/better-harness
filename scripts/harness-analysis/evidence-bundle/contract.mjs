import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import {
  analysisScopeFromTopology,
  validateWorkspaceTopology,
} from "../../workspace-topology/index.mjs";

export const EVIDENCE_BUNDLE_KIND = "better-harness.evidence-bundle";
export const EVIDENCE_BUNDLE_SCHEMA_VERSION = 2;
export const EVIDENCE_LANE_NAMES = Object.freeze([
  "sessionEvidence",
  "projectHarness",
  "agentCustomize",
]);

const PROVIDERS = new Set(["qoder", "codex", "claude", "cursor", "qwen", "copilot", "pi", "workbuddy", "grok"]);
const DEPTHS = new Set(["quick", "normal"]);

function enabled(value) {
  return value === true || ["1", "true", "yes", "on"].includes(String(value ?? "").toLowerCase());
}

function isoDate(value, name) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw Object.assign(new Error(`invalid ${name}: ${value}`), { code: "INVALID_EVIDENCE_WINDOW" });
  }
  return date.toISOString();
}

function positiveLimit(value, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
    throw Object.assign(new Error("evidence limit must be an integer from 1 to 5"), {
      code: "INVALID_EVIDENCE_LIMIT",
    });
  }
  return parsed;
}

export function freezeEvidenceBundleContext(options = {}, now = new Date()) {
  if (!options.workspace) {
    throw Object.assign(new Error("--workspace is required"), { code: "MISSING_WORKSPACE" });
  }
  const provider = String(options.provider ?? options.platform ?? "qoder").toLowerCase();
  if (!PROVIDERS.has(provider)) {
    throw Object.assign(new Error(`unsupported evidence provider: ${provider}`), {
      code: "UNSUPPORTED_EVIDENCE_PROVIDER",
    });
  }
  const depth = String(options.depth ?? "normal").toLowerCase();
  if (!DEPTHS.has(depth)) {
    throw Object.assign(new Error(`unsupported evidence depth: ${depth}`), {
      code: "UNSUPPORTED_EVIDENCE_DEPTH",
    });
  }
  const until = isoDate(options.until ?? now, "window end");
  const defaultDays = depth === "quick" ? 7 : 30;
  const since = isoDate(
    options.since ?? new Date(new Date(until).getTime() - defaultDays * 24 * 60 * 60 * 1000),
    "window start",
  );
  if (new Date(since).getTime() > new Date(until).getTime()) {
    throw Object.assign(new Error("window start must not be after window end"), {
      code: "INVALID_EVIDENCE_WINDOW",
    });
  }
  const topology = options.topology;
  const analysisScope = options.analysisScope;
  const requestedWorkspace = path.resolve(String(options.workspace));
  const canonicalWorkspace = existsSync(requestedWorkspace)
    ? realpathSync(requestedWorkspace)
    : requestedWorkspace;
  if (topology !== undefined) {
    validateWorkspaceTopology(topology);
    if (canonicalWorkspace !== topology.requestedWorkspace) {
      throw Object.assign(new Error("workspace does not match the frozen topology target"), {
        code: "EVIDENCE_WORKSPACE_TOPOLOGY_MISMATCH",
      });
    }
    if (!analysisScope || !new Set(["repo", "path"]).has(analysisScope.kind)) {
      throw Object.assign(new Error("topology requires a valid analysisScope"), {
        code: "INVALID_EVIDENCE_ANALYSIS_SCOPE",
      });
    }
    const expectedScope = analysisScopeFromTopology(topology);
    if (analysisScope.kind !== expectedScope.kind
      || analysisScope.route !== expectedScope.route
      || !Array.isArray(analysisScope.pathspecs)
      || analysisScope.pathspecs.length !== expectedScope.pathspecs.length
      || analysisScope.pathspecs.some((item, index) => item !== expectedScope.pathspecs[index])) {
      throw Object.assign(new Error("analysisScope is not bound to topology target"), {
        code: "EVIDENCE_ANALYSIS_SCOPE_MISMATCH",
      });
    }
  } else if (analysisScope !== undefined) {
    throw Object.assign(new Error("analysisScope requires topology"), {
      code: "MISSING_EVIDENCE_TOPOLOGY",
    });
  }
  return Object.freeze({
    workspace: topology?.requestedWorkspace ?? canonicalWorkspace,
    provider,
    language: String(options.language ?? "en"),
    depth,
    window: Object.freeze({ since, until }),
    evidenceLimit: positiveLimit(options["evidence-limit"] ?? options.evidenceLimit, depth === "quick" ? 3 : 5),
    authority: Object.freeze({
      includeUserHome: enabled(options["include-user-home"] ?? options.includeUserHome),
      includeMemories: options["include-memories"] === undefined && options.includeMemories === undefined
        ? provider === "qoder"
        : enabled(options["include-memories"] ?? options.includeMemories),
    }),
    ...(topology ? { topology, analysisScope } : {}),
  });
}

export function availableLane(data, status = "available") {
  return { status, data };
}

export function unavailableLane(owner, error) {
  return {
    status: "unavailable",
    error: {
      code: String(error?.code ?? `${owner.toUpperCase()}_UNAVAILABLE`).replace(/[^A-Z0-9_]+/gu, "_").slice(0, 96),
      message: `${owner} evidence is unavailable`,
    },
  };
}

export function laneIsAvailable(lane) {
  return lane?.status === "available";
}
