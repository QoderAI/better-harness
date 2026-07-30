import { analyzeHarnessEvidence } from "../report-run.mjs";
import { validateSessionPopulationBundle } from "../../session-analysis/session-population.mjs";
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
import {
  collectSessionEvidence,
  collectSessionPopulation,
} from "./session-evidence.mjs";

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

async function collectLead(context, options, analyze, sessionPopulation) {
  try {
    const data = await analyze({
      workspace: context.workspace,
      platform: context.provider,
      language: context.language,
      since: context.window.since,
      until: context.window.until,
      format: "json",
      sessionPopulation,
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

function populationDiagnostics(population, sessionEvidence, lead) {
  if (!population?.binding) {
    return { status: "unavailable" };
  }
  const session = sessionEvidence?.data
    ? {
        population: sessionEvidence.data.populationBinding,
        selection: sessionEvidence.data.selectionBinding,
        admission: sessionEvidence.data.admissionBinding,
      }
    : null;
  const leadBinding = lead?.data?.sessionBinding ?? null;
  const errors = validateSessionPopulationBundle({
    population: population.binding,
    session,
    lead: leadBinding,
  });
  const sessionEligibleCount = Number(sessionEvidence?.data?.scope?.eligibleSessions ?? -1);
  const sessionSelectedCount = Number(sessionEvidence?.data?.scope?.selectedSessions ?? -1);
  const leadSelection = lead?.data?.summaryFacts?.evidenceBoundary?.manifest?.selection ?? {};
  if (sessionEligibleCount !== population.binding.eligible.count
    || sessionSelectedCount !== session?.selection?.selected?.count) {
    errors.push("Session public counts do not match its population binding");
  }
  if (Number(leadSelection.eligibleCount ?? -1) !== population.binding.eligible.count
    || Number(leadSelection.analyzedCount ?? -1) !== leadBinding?.selection?.selected?.count) {
    errors.push("lead public counts do not match its population binding");
  }
  const sessionAdmission = session?.admission ?? {};
  const leadAdmission = leadBinding?.admission ?? {};
  const comparable = session?.selection?.selected?.fingerprint === leadBinding?.selection?.selected?.fingerprint
    && session?.selection?.projectionPolicyFingerprint === leadBinding?.selection?.projectionPolicyFingerprint;
  return {
    status: errors.length > 0 ? "conflict" : "bound",
    population: population.binding,
    sessionSelection: session?.selection ?? null,
    leadSelection: leadBinding?.selection ?? null,
    episodes: {
      comparison: comparable ? "comparable" : "not-comparable-selection-or-policy",
      sessionTaskEpisodes: Number(sessionAdmission.taskEpisodes ?? 0),
      leadProjectedEpisodes: Number(leadAdmission.projectedEpisodes ?? 0),
      leadRetainedEpisodes: Number(leadAdmission.retainedTaskEpisodes ?? 0),
      leadZeroSignalDiscardedEpisodes: Number(leadAdmission.zeroSignalDiscardedEpisodes ?? 0),
    },
    ...(errors.length > 0 ? { errorCodes: ["SESSION_POPULATION_BINDING_MISMATCH"] } : {}),
  };
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
  const populationCollector = dependencies.collectSessionPopulation ?? collectSessionPopulation;
  const projectPromise = capture("project-harness", () => projectCollector(context, options, dependencies));
  const customizePromise = capture("agent-customize", () => customizeCollector(context, options, dependencies));
  const populationLane = await capture("session-population", async () =>
    availableLane(await populationCollector(context, options, dependencies)));
  const sessionPopulation = laneIsAvailable(populationLane) ? populationLane.data : null;
  const sessionPromise = sessionPopulation
    ? capture("session-evidence", () => sessionCollector(context, options, {
        ...dependencies,
        sessionPopulation,
      }))
    : Promise.resolve(unavailableLane("session-evidence", populationLane.error));
  const leadPromise = sessionPopulation
    ? collectLead(context, options, leadAnalyzer, sessionPopulation)
    : Promise.resolve(unavailableLane("lead-analyzer", populationLane.error));
  let [sessionEvidence, projectHarness, agentCustomize, lead] = await Promise.all([
    sessionPromise,
    projectPromise,
    customizePromise,
    leadPromise,
  ]);
  const sessionPopulationBinding = populationDiagnostics(sessionPopulation, sessionEvidence, lead);
  if (sessionPopulationBinding.status === "conflict") {
    lead = unavailableLane("lead-analyzer", Object.assign(
      new Error("Session population binding mismatch"),
      { code: "SESSION_POPULATION_BINDING_MISMATCH" },
    ));
  }
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
      sessionPopulationBinding,
    },
  };
}

export {
  EVIDENCE_BUNDLE_KIND,
  EVIDENCE_BUNDLE_SCHEMA_VERSION,
  EVIDENCE_LANE_NAMES,
  freezeEvidenceBundleContext,
} from "./contract.mjs";
