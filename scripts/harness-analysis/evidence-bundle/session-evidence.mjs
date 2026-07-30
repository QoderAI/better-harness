import { createAnalyzer } from "../../session-analysis.mjs";
import {
  bindSessionSelection,
  freezeSessionPopulation,
  sessionAdmissionBinding,
} from "../../session-analysis/session-population.mjs";
import { availableLane } from "./contract.mjs";

const SOURCE_COVERAGE_STATES = new Set([
  "absent",
  "out-of-window",
  "unobserved",
  "partial",
  "observed",
]);

function analyzerOptions(context, options = {}) {
  return {
    workspace: context.workspace,
    platform: context.provider,
    since: context.window.since,
    until: context.window.until,
    ...(options[`${context.provider}-home`] ? { [`${context.provider}-home`]: options[`${context.provider}-home`] } : {}),
  };
}

export async function collectSessionPopulation(context, options = {}, dependencies = {}) {
  const create = dependencies.createAnalyzer ?? createAnalyzer;
  const analyzer = await create(context.provider);
  const runOptions = analyzerOptions(context, options);
  const discovery = await analyzer.analyze({ ...runOptions, command: "sources" });
  if (!Array.isArray(discovery?.sessions)) {
    throw Object.assign(new Error("Session population discovery returned an invalid contract"), {
      code: "INVALID_SESSION_POPULATION",
    });
  }
  return freezeSessionPopulation({
    scope: {
      ...(discovery.scope ?? {}),
      platform: context.provider,
      workspace: context.workspace,
      since: context.window.since,
      until: context.window.until,
    },
    sessions: discovery.sessions,
    excludedSessionId: options["exclude-session-id"] ?? options.excludeSessionId,
    providerSessionId: typeof analyzer.currentSessionId === "function" ? analyzer.currentSessionId() : null,
    suppliedUntil: true,
  });
}

export async function collectSessionEvidence(context, options = {}, dependencies = {}) {
  const create = dependencies.createAnalyzer ?? createAnalyzer;
  const analyzer = await create(context.provider);
  const population = dependencies.sessionPopulation ?? null;
  const data = await analyzer.analyze({
    command: "facts",
    ...analyzerOptions(context, options),
    selection: "all-eligible",
    limit: context.evidenceLimit,
    "episode-limit": context.evidenceLimit,
    ...(population ? { sessionInventory: population.sessions } : {}),
  });
  if (data?.kind !== "session-core-facts" || !Array.isArray(data.candidates)) {
    throw Object.assign(new Error("session facts returned an invalid contract"), {
      code: "INVALID_SESSION_EVIDENCE",
    });
  }
  const sourceCoverageStatus = data.sourceCoverage?.status;
  if (sourceCoverageStatus !== undefined && !SOURCE_COVERAGE_STATES.has(sourceCoverageStatus)) {
    throw Object.assign(new Error("session facts returned an invalid source coverage state"), {
      code: "INVALID_SESSION_EVIDENCE",
    });
  }
  const laneStatus = ["unobserved", "partial"].includes(sourceCoverageStatus)
    ? "partial"
    : "available";
  if (!population) return availableLane(data, laneStatus);
  const eligibleCount = Number(data.scope?.eligibleSessions ?? -1);
  const selectedCount = Number(data.scope?.selectedSessions ?? -1);
  if (eligibleCount !== population.binding.eligible.count
    || selectedCount !== population.binding.eligible.count) {
    throw Object.assign(new Error("Session facts do not match the frozen all-eligible population"), {
      code: "SESSION_POPULATION_BINDING_MISMATCH",
    });
  }
  const selectionBinding = bindSessionSelection(population, population.sessions, {
    strategy: "all-eligible",
    projectionPolicy: "session-fact-candidates-v2",
  });
  const boundData = {
    ...data,
    omitted: {
      ...(data.omitted ?? {}),
      activeSessions: population.binding.omission.activeSessions,
      homeSessionOnly: population.binding.omission.homeSessionOnly,
    },
    populationBinding: population.binding,
    selectionBinding,
  };
  boundData.admissionBinding = sessionAdmissionBinding(boundData, selectionBinding);
  return availableLane(boundData, laneStatus);
}
