import type { TFunction } from "i18next";

export type StudioArea =
  | "memory"
  | "memory-sources"
  | "customizations"
  | "session-performance"
  | "sessions"
  | "commits"
  | "artifacts"
  | "debugger"
  | "compare";

/**
 * The landing View. Sessions is the retained evidence a reader opens Studio for,
 * so an unknown route and a fresh launch both resolve here rather than to
 * whichever View happens to sort first in the sidebar.
 */
export const STUDIO_DEFAULT_AREA: StudioArea = "sessions";

export type StudioCompareSurface = "live" | "sessions" | "bench" | "results";
export type StudioInspectorSurface = "workbench";

/** One selectable local ACP Agent, as published by the server's bounded catalog. */
export interface StudioAcpAgentOption {
  id: string;
  label: string;
  available: boolean;
  detail: string;
}

/** Retained Session count for one Agent (Coding Agent / ACP client) in the active Project. */
export interface StudioSessionAgent {
  agent: string;
  sessionCount: number;
}

/**
 * Session compare asks what two Agents did to the same working tree, so its
 * readiness is an Agent-count question, not a Project-count or Session-count
 * question. Two Sessions from a single Agent stay comparable but cannot answer
 * it, and that narrower capability is reported as such.
 */
export type StudioSessionCompareScope = "cross-agent" | "single-agent" | "insufficient";

export interface StudioConfig {
  sessionPerformanceEnabled?: boolean;
  runEnabled: boolean;
  acpEnabled: boolean;
  acpAgentLabel?: string;
  acpRuntimeProfile?: "acp-v1-stdio" | "acp-v1-rust" | "acp-v1-nsxpc";
  acpAgents?: readonly StudioAcpAgentOption[];
  artifactsEnabled: boolean;
  artifactCount?: number;
  evidenceEnabled: boolean;
  experimentEnabled: boolean;
  experimentRunnable: boolean;
  gitEnabled: boolean;
  harnessMode: "none" | "configured" | "workspace-default";
  historyEnabled: boolean;
  inspectorEnabled: boolean;
  workspaceWorkbenchEnabled: boolean;
  workspaceDiscoveryEnabled: boolean;
  workspaceConnected: boolean;
  projectExecutionEnabled: boolean;
  activeProjectId?: string;
  projectRevision?: number;
  sessionCount: number;
  /** Per-Agent Session breakdown. Absent when the host predates the Agent dimension. */
  sessionAgents?: readonly StudioSessionAgent[];
  inputCount: number;
  intentAnalysisEnabled: boolean;
  customizationAnalysisEnabled: boolean;
  customizationAnalyzed: boolean;
  customizationDefinitionCount: number;
}

export type StudioAvailability = "ready" | "partial" | "foundation";

export interface StudioDestination {
  id: StudioArea;
  label: string;
  group: string;
  availability: StudioAvailability;
  status: string;
}

export function studioDestinations(config: StudioConfig, activeCompareSurface: StudioCompareSurface | undefined, t: TFunction<"common">): readonly StudioDestination[] {
  const compareAvailable = config.experimentEnabled || config.evidenceEnabled;
  const compareScope = sessionCompareScope(config);
  const debuggerReady = isDebuggerReady(config);
  const artifactsReady = hasUsableArtifacts(config);
  const availableCompareSurfaces = compareSurfaces(config);
  const effectiveCompareSurface = activeCompareSurface !== undefined && availableCompareSurfaces.includes(activeCompareSurface)
    ? activeCompareSurface
    : availableCompareSurfaces[0];
  const sessionsStatus = (): string => config.workspaceConnected
    ? t("destination.sessions", { count: config.sessionCount })
    : t("destination.workspaceRequired");
  const artifactsStatus = (): string => artifactsReady
    ? config.artifactCount === undefined
      ? t("destination.compatibilityCatalog")
      : t("destination.artifacts", { count: config.artifactCount })
    : t("destination.noObservedOutputs");
  const debuggerStatus = (): string => debuggerReady
    ? config.harnessMode === "workspace-default" ? t("destination.localDefault") : t("destination.liveRuns")
    : config.harnessMode === "workspace-default"
      ? config.workspaceConnected ? t("destination.readOnlyProject") : t("destination.workspaceRequired")
      : t("destination.harnessRequired");
  const compareStatus = (): string => effectiveCompareSurface === undefined
    ? config.workspaceConnected
      ? compareScope === "single-agent" ? t("destination.singleAgentOnly") : t("destination.secondAgentRequired")
      : t("destination.workspaceRequired")
    : effectiveCompareSurface === "live"
      ? t("destination.liveAgentCompare")
      : effectiveCompareSurface === "bench"
        ? config.experimentRunnable ? t("destination.harnessBench") : t("destination.comparisonBlocked")
        : effectiveCompareSurface === "results"
          ? t("destination.frozenResults")
          : compareScope === "cross-agent"
            ? t("destination.agentCompare")
            : t("destination.singleAgentOnly");

  return [
    { id: "memory", label: t("area.memory"), group: t("group.control"), availability: "ready", status: t("memoryReview.preview") },
    {
      id: "customizations",
      label: t("area.customizations"),
      group: t("group.control"),
      availability: config.customizationAnalysisEnabled ? "ready" : "foundation",
      status: config.customizationAnalyzed
        ? t("destination.definitions", { count: config.customizationDefinitionCount })
        : config.customizationAnalysisEnabled
          ? t("destination.analyzeHosts")
          : t("destination.collectorUnavailable"),
    },
    {
      id: "sessions",
      label: t("area.sessions"),
      group: t("group.observe"),
      availability: config.workspaceConnected ? "ready" : "partial",
      status: sessionsStatus(),
    },
    {
      id: "session-performance", label: t("area.session-performance"), group: t("group.observe"),
      availability: config.sessionPerformanceEnabled ? "ready" : "foundation", status: config.sessionPerformanceEnabled ? t("area.session-performance") : t("destination.collectorUnavailable"),
    },
    {
      id: "commits",
      label: t("area.commits"),
      group: t("group.observe"),
      availability: config.gitEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.gitEnabled ? t("destination.repositoryHistory") : config.workspaceConnected ? t("destination.notGitRepository") : t("destination.workspaceRequired"),
    },
    {
      id: "artifacts",
      label: t("area.artifacts"),
      group: t("group.observe"),
      availability: "ready",
      status: artifactsStatus(),
    },
    {
      id: "debugger",
      label: t("area.debugger"),
      group: t("group.run"),
      availability: debuggerReady ? "ready" : "foundation",
      status: debuggerStatus(),
    },
    {
      id: "compare",
      label: t("area.compare"),
      group: t("group.validate"),
      availability: effectiveCompareSurface === "bench" && !config.experimentRunnable
        ? "partial"
        : effectiveCompareSurface === "sessions" && compareScope !== "cross-agent"
          ? "partial"
          : effectiveCompareSurface === "live" || compareAvailable || compareScope === "cross-agent"
            ? "ready"
            : config.workspaceConnected ? "partial" : "foundation",
      status: compareStatus(),
    },
  ];
}

export function compareSurfaces(config: StudioConfig): readonly StudioCompareSurface[] {
  return [
    ...(liveCompareReady(config) ? ["live" as const] : []),
    ...(sessionCompareScope(config) === "insufficient" ? [] : ["sessions" as const]),
    ...(config.experimentEnabled ? ["bench" as const] : []),
    ...(config.evidenceEnabled ? ["results" as const] : []),
  ];
}

/** Agents this host can actually launch for a live comparison. */
export function selectableAcpAgents(config: StudioConfig): readonly StudioAcpAgentOption[] {
  return (config.acpAgents ?? []).filter((agent) => agent.available);
}

/**
 * A live comparison starts two Agent runs against the open Project, so it needs
 * a launchable ACP Agent and a Project that can execute. It stays reachable with
 * a single available Agent, because the reader may still want the same Agent on
 * both sides.
 */
export function liveCompareReady(config: StudioConfig): boolean {
  return config.acpEnabled
    && config.projectExecutionEnabled
    && selectableAcpAgents(config).length >= 1;
}

/** Agents that contributed at least one retained Session to the active Project. */
export function sessionAgents(config: StudioConfig): readonly StudioSessionAgent[] {
  return (config.sessionAgents ?? []).filter((entry) => entry.sessionCount > 0);
}

export function sessionCompareScope(config: StudioConfig): StudioSessionCompareScope {
  if (config.sessionCount < 2) return "insufficient";
  return sessionAgents(config).length >= 2 ? "cross-agent" : "single-agent";
}

export function inspectorSurfaces(config: StudioConfig): readonly StudioInspectorSurface[] {
  return config.inspectorEnabled ? ["workbench"] : [];
}

function isDebuggerReady(config: StudioConfig): boolean {
  return (config.runEnabled || config.acpEnabled)
    && (config.harnessMode !== "workspace-default" || config.projectExecutionEnabled);
}

function hasUsableArtifacts(config: StudioConfig): boolean {
  return config.artifactsEnabled && (config.artifactCount === undefined || config.artifactCount > 0);
}

export function studioProjectGateRequired(config: StudioConfig, hasConfiguredSources: boolean, area: StudioArea = STUDIO_DEFAULT_AREA): boolean {
  if (area === "artifacts" || area === "memory-sources" || area === "memory") return false;
  const independentContext = hasConfiguredSources
    || config.inspectorEnabled
    || config.evidenceEnabled
    || config.experimentEnabled
    || hasUsableArtifacts(config)
    || config.harnessMode === "configured";
  return config.workspaceDiscoveryEnabled
    && !config.workspaceConnected
    && !independentContext;
}

export function capabilitySummary(config: StudioConfig, t: TFunction<"common">): { ready: number; partial: number; foundation: number } {
  return studioDestinations(config, undefined, t).reduce(
    (summary, destination) => ({ ...summary, [destination.availability]: summary[destination.availability] + 1 }),
    { ready: 0, partial: 0, foundation: 0 },
  );
}
