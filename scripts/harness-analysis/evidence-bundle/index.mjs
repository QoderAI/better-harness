import { analyzeHarnessEvidence } from "../report-run.mjs";
import { resolveWorkspaceTopology } from "../../workspace-topology/index.mjs";
import { collectAgentCustomize } from "./agent-customize.mjs";
import {
  EVIDENCE_BUNDLE_KIND,
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  EVIDENCE_LANE_NAMES,
  availableLane,
  freezeEvidenceBundleContext,
  laneIsAvailable,
  unavailableLane,
} from "./contract.mjs";
import { collectProjectHarness } from "./project-harness.mjs";
import { collectSessionEvidence } from "./session-evidence.mjs";

async function capture(owner, operation) {
  try {
    const result = await operation();
    if (!result || !new Set(["available", "partial", "unavailable"]).has(result.status)) {
      throw Object.assign(new Error(`${owner} returned an invalid lane envelope`), {
        code: "INVALID_LANE_ENVELOPE",
      });
    }
    return result;
  } catch (error) {
    return unavailableLane(owner, error);
  }
}

async function collectLead(context, options, analyze) {
  try {
    const data = await analyze({
      workspace: context.workspace,
      platform: context.provider,
      language: context.language,
      since: context.window.since,
      until: context.window.until,
      format: "json",
      "include-global-capabilities": context.authority.includeUserHome,
      ...(options["canvas-out"] ? { "canvas-out": options["canvas-out"] } : {}),
      ...(options["replace-canvas"] ? { "replace-canvas": options["replace-canvas"] } : {}),
      ...(options[`${context.provider}-home`] ? { [`${context.provider}-home`]: options[`${context.provider}-home`] } : {}),
      topology: context.topology,
      analysisScope: context.analysisScope,
    });
    if (!data?.evidence || !data?.summaryFacts) {
      throw Object.assign(new Error("lead analyzer returned an invalid contract"), {
        code: "INVALID_LEAD_EVIDENCE",
      });
    }
    return availableLane(data);
  } catch (error) {
    return unavailableLane("lead-analyzer", error);
  }
}

export async function collectEvidenceBundle(options = {}, dependencies = {}) {
  const now = dependencies.now?.() ?? new Date();
  const baseContext = freezeEvidenceBundleContext(options, now);
  const resolveTopology = dependencies.resolveWorkspaceTopology ?? resolveWorkspaceTopology;
  const topologyResolution = await resolveTopology({
    workspace: baseContext.workspace,
    maxFiles: options["topology-max-files"] ?? options.topologyMaxFiles,
    maxMembers: options["topology-max-members"] ?? options.topologyMaxMembers,
    maxInstructionScopes: options["topology-max-instruction-scopes"] ?? options.topologyMaxInstructionScopes,
  });
  const context = freezeEvidenceBundleContext({
    ...options,
    topology: topologyResolution.topology,
    analysisScope: topologyResolution.analysisScope,
  }, now);
  const sessionCollector = dependencies.collectSessionEvidence ?? collectSessionEvidence;
  const projectCollector = dependencies.collectProjectHarness ?? collectProjectHarness;
  const customizeCollector = dependencies.collectAgentCustomize ?? collectAgentCustomize;
  const leadAnalyzer = dependencies.analyzeHarnessEvidence ?? analyzeHarnessEvidence;
  const [sessionEvidence, projectHarness, agentCustomize, lead] = await Promise.all([
    capture("session-evidence", () => sessionCollector(context, options, dependencies)),
    capture("project-harness", () => projectCollector(context, options, dependencies)),
    capture("agent-customize", () => customizeCollector(context, options, dependencies)),
    collectLead(context, options, leadAnalyzer),
  ]);
  const lanes = { sessionEvidence, projectHarness, agentCustomize };
  const incompleteLanes = EVIDENCE_LANE_NAMES.filter((name) => !laneIsAvailable(lanes[name]));
  const unavailableLanes = EVIDENCE_LANE_NAMES.filter((name) => lanes[name]?.status === "unavailable");
  const partialLanes = EVIDENCE_LANE_NAMES.filter((name) => lanes[name]?.status === "partial");
  const leadFailed = !laneIsAvailable(lead);
  const topologyIncomplete = context.topology.status !== "complete";
  const status = leadFailed || (context.depth === "normal" && (incompleteLanes.length > 0 || topologyIncomplete))
    ? "failed"
    : incompleteLanes.length > 0 || topologyIncomplete
      ? "partial"
      : "complete";
  return {
    kind: EVIDENCE_BUNDLE_KIND,
    schemaVersion: EVIDENCE_BUNDLE_SCHEMA_VERSION,
    status,
    context,
    lanes,
    lead,
    diagnostics: {
      collectionMode: "frozen-context-multi-owner",
      requiredLanes: context.depth === "normal" ? [...EVIDENCE_LANE_NAMES] : [],
      incompleteLanes,
      unavailableLanes,
      partialLanes,
      leadRequired: true,
      topologyRequired: true,
      topologyStatus: context.topology.status,
      topologyIncomplete,
      individualCommandsRemainDiagnostic: true,
    },
  };
}

export {
  EVIDENCE_BUNDLE_KIND,
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  EVIDENCE_LANE_NAMES,
  freezeEvidenceBundleContext,
} from "./contract.mjs";
