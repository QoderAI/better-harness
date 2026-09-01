import type { TFunction } from "i18next";

export type StudioArea =
  | "overview"
  | "customizations"
  | "inputs"
  | "sessions"
  | "commits"
  | "artifacts"
  | "debugger"
  | "compare";

export type StudioCompareSurface = "sessions" | "bench" | "results";
export type StudioInspectorSurface = "workbench";

export interface StudioConfig {
  runEnabled: boolean;
  acpEnabled: boolean;
  acpAgentLabel?: string;
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

export type StudioOverviewMode = "workspace-required" | "workspace" | "configured" | "empty";

export interface StudioOverviewAction {
  area: StudioArea;
  label: string;
}

export interface StudioOverviewFact {
  id: string;
  label: string;
  value: string;
  detail: string;
}

export interface StudioOverviewModel {
  mode: StudioOverviewMode;
  title: string;
  detail: string;
  primaryAction?: StudioOverviewAction;
  secondaryActions: readonly StudioOverviewAction[];
  facts: readonly StudioOverviewFact[];
}

export function studioDestinations(config: StudioConfig, activeCompareSurface: StudioCompareSurface | undefined, t: TFunction<"common">): readonly StudioDestination[] {
  const compareAvailable = config.experimentEnabled || config.evidenceEnabled;
  const debuggerReady = isDebuggerReady(config);
  const artifactsReady = hasUsableArtifacts(config);
  const availableCompareSurfaces = compareSurfaces(config);
  const effectiveCompareSurface = activeCompareSurface !== undefined && availableCompareSurfaces.includes(activeCompareSurface)
    ? activeCompareSurface
    : availableCompareSurfaces[0];
  const sessionsStatus = (): string => config.workspaceConnected
    ? t("destination.sessions", { count: config.sessionCount })
    : t("destination.workspaceRequired");
  const inputsStatus = (): string => config.workspaceWorkbenchEnabled
    ? t("destination.inputs", { count: config.inputCount })
    : config.workspaceConnected
      ? t("destination.noRetainedTrace")
      : t("destination.workspaceRequired");
  const artifactsStatus = (): string => artifactsReady
    ? config.artifactCount === undefined
      ? t("destination.compatibilityCatalog")
      : t("destination.artifacts", { count: config.artifactCount })
    : config.workspaceConnected
      ? t("destination.noObservedOutputs")
      : t("destination.workspaceRequired");
  const debuggerStatus = (): string => debuggerReady
    ? config.harnessMode === "workspace-default" ? t("destination.localDefault") : t("destination.liveRuns")
    : config.harnessMode === "workspace-default"
      ? config.workspaceConnected ? t("destination.readOnlyProject") : t("destination.workspaceRequired")
      : t("destination.harnessRequired");
  const compareStatus = (): string => effectiveCompareSurface === undefined
    ? t("destination.workspaceRequired")
    : effectiveCompareSurface === "bench"
      ? config.experimentRunnable ? t("destination.harnessBench") : t("destination.comparisonBlocked")
      : effectiveCompareSurface === "results"
        ? t("destination.frozenResults")
        : effectiveCompareSurface === "sessions"
          ? t("destination.sessionCompare")
          : config.workspaceConnected
            ? t("destination.chooseTwoSessions")
            : t("destination.workspaceRequired");

  return [
    { id: "overview", label: t("area.overview"), group: t("group.control"), availability: "ready", status: t("destination.overviewStatus") },
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
      id: "inputs",
      label: t("area.inputs"),
      group: t("group.observe"),
      availability: config.workspaceWorkbenchEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: inputsStatus(),
    },
    {
      id: "sessions",
      label: t("area.sessions"),
      group: t("group.observe"),
      availability: config.workspaceConnected ? "ready" : "partial",
      status: sessionsStatus(),
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
      availability: artifactsReady ? "ready" : config.workspaceConnected ? "partial" : "foundation",
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
        : compareAvailable || config.sessionCount >= 2 ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: compareStatus(),
    },
  ];
}

export function compareSurfaces(config: StudioConfig): readonly StudioCompareSurface[] {
  return [
    ...(config.sessionCount >= 2 ? ["sessions" as const] : []),
    ...(config.experimentEnabled ? ["bench" as const] : []),
    ...(config.evidenceEnabled ? ["results" as const] : []),
  ];
}

export function inspectorSurfaces(config: StudioConfig): readonly StudioInspectorSurface[] {
  return config.inspectorEnabled ? ["workbench"] : [];
}

export function studioOverview(config: StudioConfig, t: TFunction<"overview">): StudioOverviewModel {
  const artifactsReady = hasUsableArtifacts(config);
  if (config.workspaceConnected) {
    return {
      mode: "workspace",
      title: t("summary.workspaceEvidenceReady"),
      detail: config.sessionCount === 0
        ? t("summary.noSessionsYet")
        : t("summary.sessionCount", { count: config.sessionCount }),
      primaryAction: { area: "sessions", label: t("actions.openSessions") },
      secondaryActions: [
        ...(config.workspaceWorkbenchEnabled ? [{ area: "inputs" as const, label: t("actions.reviewInputs") }] : []),
        ...(config.sessionCount >= 2 || config.experimentEnabled || config.evidenceEnabled ? [{ area: "compare" as const, label: t("actions.openCompare") }] : []),
        ...(isDebuggerReady(config) ? [{ area: "debugger" as const, label: t("actions.openDebugger") }] : []),
        ...(artifactsReady ? [{ area: "artifacts" as const, label: t("actions.openArtifacts") }] : []),
      ],
      facts: [
        {
          id: "inputs",
          label: t("facts.inputs"),
          value: config.workspaceWorkbenchEnabled ? String(config.inputCount) : "—",
          detail: config.workspaceWorkbenchEnabled ? t("facts.retainedPrompts") : t("facts.noRetainedTrace"),
        },
        {
          id: "sessions",
          label: t("facts.sessions"),
          value: String(config.sessionCount),
          detail: t("facts.observedRuns"),
        },
        {
          id: "artifacts",
          label: t("facts.artifacts"),
          value: config.artifactCount !== undefined ? String(config.artifactCount) : "—",
          detail: artifactsReady ? t("facts.retainedOutputs") : t("facts.noObservedOutputs"),
        },
        {
          id: "repository",
          label: t("facts.repository"),
          value: config.gitEnabled ? t("facts.gitValue") : t("facts.folderValue"),
          detail: config.gitEnabled ? t("facts.historyAvailable") : t("facts.noGitHistory"),
        },
      ],
    };
  }

  if (config.workspaceDiscoveryEnabled) {
    return {
      mode: "workspace-required",
      title: t("summary.chooseWorkspace"),
      detail: t("summary.chooseWorkspaceDetail"),
      secondaryActions: [],
      facts: [],
    };
  }

  const configuredFacts: StudioOverviewFact[] = [
    ...(config.experimentEnabled ? [{
      id: "experiment",
      label: t("facts.harnessBench"),
      value: config.experimentRunnable ? t("facts.ready") : t("facts.blocked"),
      detail: config.experimentRunnable ? t("facts.runnableExperiment") : t("facts.checkpointUnavailable"),
    }] : []),
    ...(config.evidenceEnabled ? [{ id: "evidence", label: t("facts.evidenceResults"), value: t("facts.ready"), detail: t("facts.manifestation") }] : []),
    ...(isDebuggerReady(config) ? [{ id: "debugger", label: t("facts.debugger"), value: t("facts.ready"), detail: config.harnessMode === "workspace-default" ? t("facts.localDefaultHarness") : t("facts.harnessRuntimeLoaded") }] : []),
    ...(artifactsReady ? [{ id: "artifacts", label: t("facts.artifacts"), value: config.artifactCount === undefined ? t("facts.ready") : String(config.artifactCount), detail: config.artifactCount === undefined ? t("facts.catalogLoaded") : t("facts.retainedOutputs") }] : []),
    ...(config.inspectorEnabled ? [{ id: "inspector", label: t("facts.inspector"), value: t("facts.loaded"), detail: t("facts.readOnlySource") }] : []),
    ...(config.customizationAnalysisEnabled ? [{ id: "customizations", label: t("facts.customizations"), value: config.customizationAnalyzed ? String(config.customizationDefinitionCount) : t("facts.available"), detail: config.customizationAnalyzed ? t("facts.definitionsDiscovered") : t("facts.collectorReady") }] : []),
  ];

  if (configuredFacts.length === 0) {
    return {
      mode: "empty",
      title: t("summary.emptyTitle"),
      detail: t("summary.emptyDetail"),
      secondaryActions: [],
      facts: [],
    };
  }

  const primaryAction: StudioOverviewAction | undefined = config.experimentEnabled || config.evidenceEnabled
    ? { area: "compare", label: t("actions.openCompare") }
    : isDebuggerReady(config)
      ? { area: "debugger", label: t("actions.openDebugger") }
      : artifactsReady
        ? { area: "artifacts", label: t("actions.openArtifacts") }
        : config.customizationAnalysisEnabled
          ? { area: "customizations", label: config.customizationAnalyzed ? t("actions.openCustomizations") : t("actions.analyzeCustomizations") }
          : undefined;

  return {
    mode: "configured",
    title: config.experimentEnabled
      ? config.experimentRunnable ? t("summary.comparisonSetupReady") : t("summary.comparisonSetupNeedsAttention")
      : config.evidenceEnabled
        ? t("summary.evidenceResultsReady")
        : isDebuggerReady(config)
          ? t("summary.liveDebuggingReady")
          : artifactsReady
            ? t("summary.artifactEvidenceReady")
            : config.customizationAnalysisEnabled
              ? t("summary.customizationAvailable")
              : t("summary.configuredLoaded"),
    detail: t("summary.configuredDetail"),
    ...(primaryAction === undefined ? {} : { primaryAction }),
    secondaryActions: [
      ...(config.experimentEnabled || config.evidenceEnabled ? [{ area: "compare" as const, label: t("actions.openCompare") }] : []),
      ...(isDebuggerReady(config) ? [{ area: "debugger" as const, label: t("actions.openDebugger") }] : []),
      ...(artifactsReady ? [{ area: "artifacts" as const, label: t("actions.openArtifacts") }] : []),
      ...(config.customizationAnalysisEnabled ? [{ area: "customizations" as const, label: config.customizationAnalyzed ? t("actions.openCustomizations") : t("actions.analyzeCustomizations") }] : []),
    ].filter((action) => action.area !== primaryAction?.area),
    facts: configuredFacts,
  };
}

function isDebuggerReady(config: StudioConfig): boolean {
  return config.runEnabled && (config.harnessMode !== "workspace-default" || config.projectExecutionEnabled);
}

function hasUsableArtifacts(config: StudioConfig): boolean {
  return config.artifactsEnabled && (config.artifactCount === undefined || config.artifactCount > 0);
}

export function studioProjectGateRequired(config: StudioConfig, hasConfiguredSources: boolean): boolean {
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