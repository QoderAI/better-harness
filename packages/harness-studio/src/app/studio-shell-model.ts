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
  aguiEnabled: boolean;
  acpEnabled: boolean;
  acpAgentLabel?: string;
  artifactsEnabled: boolean;
  artifactCount?: number;
  evidenceEnabled: boolean;
  experimentEnabled: boolean;
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
  group: "Control" | "Observe" | "Run" | "Validate";
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

export function studioDestinations(config: StudioConfig): readonly StudioDestination[] {
  const compareAvailable = config.experimentEnabled || config.evidenceEnabled;
  const debuggerReady = isDebuggerReady(config);
  return [
    { id: "overview", label: "Overview", group: "Control", availability: "ready", status: "Control plane" },
    {
      id: "customizations",
      label: "Customizations",
      group: "Control",
      availability: config.customizationAnalysisEnabled ? "ready" : "foundation",
      status: config.customizationAnalyzed
        ? `${config.customizationDefinitionCount} definition${config.customizationDefinitionCount === 1 ? "" : "s"}`
        : config.customizationAnalysisEnabled
          ? "Analyze local Hosts"
          : "Collector unavailable",
    },
    {
      id: "inputs",
      label: "Inputs",
      group: "Observe",
      availability: config.workspaceWorkbenchEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.workspaceWorkbenchEnabled
        ? `${config.inputCount} input${config.inputCount === 1 ? "" : "s"}`
        : config.workspaceConnected
          ? "No retained trace"
          : "Project required",
    },
    {
      id: "sessions",
      label: "Sessions",
      group: "Observe",
      availability: config.workspaceConnected ? "ready" : "partial",
      status: config.workspaceConnected ? `${config.sessionCount} session${config.sessionCount === 1 ? "" : "s"}` : "Project required",
    },
    {
      id: "commits",
      label: "Commits",
      group: "Observe",
      availability: config.gitEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.gitEnabled ? "Repository history" : config.workspaceConnected ? "Not a Git repository" : "Project required",
    },
    {
      id: "artifacts",
      label: "Artifacts",
      group: "Observe",
      availability: config.artifactsEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.artifactsEnabled
        ? config.artifactCount === undefined
          ? "Compatibility catalog"
          : `${config.artifactCount} artifact${config.artifactCount === 1 ? "" : "s"}`
        : config.workspaceConnected ? "No observed outputs" : "Project required",
    },
    {
      id: "debugger",
      label: "Debugger",
      group: "Run",
      availability: debuggerReady ? "ready" : "foundation",
      status: debuggerReady
        ? config.harnessMode === "workspace-default" ? "Project default" : "Live runs"
        : config.harnessMode === "workspace-default"
          ? config.workspaceConnected ? "Read-only Project" : "Project required"
          : "Harness required",
    },
    {
      id: "compare",
      label: "Compare",
      group: "Validate",
      availability: compareAvailable || config.sessionCount >= 2 ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.sessionCount >= 2 ? "Session compare" : config.experimentEnabled ? "Harness Bench" : config.evidenceEnabled ? "Frozen results" : config.workspaceConnected ? "Choose 2 sessions" : "Project required",
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

export function studioOverview(config: StudioConfig): StudioOverviewModel {
  if (config.workspaceConnected) {
    return {
      mode: "workspace",
      title: "Project evidence is ready.",
      detail: config.sessionCount === 0
        ? "No retained Sessions were discovered for this Project yet."
        : `${config.sessionCount} retained Session${config.sessionCount === 1 ? "" : "s"} can be inspected without changing the Project.`,
      primaryAction: { area: "sessions", label: "Open Sessions" },
      secondaryActions: [
        ...(config.workspaceWorkbenchEnabled ? [{ area: "inputs" as const, label: "Review Inputs" }] : []),
        ...(config.sessionCount >= 2 || config.experimentEnabled || config.evidenceEnabled ? [{ area: "compare" as const, label: "Open Compare" }] : []),
        ...(isDebuggerReady(config) ? [{ area: "debugger" as const, label: "Open Debugger" }] : []),
        ...(config.artifactsEnabled ? [{ area: "artifacts" as const, label: "Open Artifacts" }] : []),
      ],
      facts: [
        {
          id: "inputs",
          label: "Inputs",
          value: config.workspaceWorkbenchEnabled ? String(config.inputCount) : "—",
          detail: config.workspaceWorkbenchEnabled ? "Retained prompts" : "No retained trace",
        },
        {
          id: "sessions",
          label: "Sessions",
          value: String(config.sessionCount),
          detail: "Observed agent runs",
        },
        {
          id: "artifacts",
          label: "Artifacts",
          value: config.artifactsEnabled && config.artifactCount !== undefined ? String(config.artifactCount) : "—",
          detail: config.artifactsEnabled ? "Retained outputs" : "No observed outputs",
        },
        {
          id: "repository",
          label: "Repository",
          value: config.gitEnabled ? "Git" : "Folder",
          detail: config.gitEnabled ? "Commit history available" : "No Git history",
        },
      ],
    };
  }

  if (config.workspaceDiscoveryEnabled) {
    return {
      mode: "workspace-required",
      title: "Choose a Project to begin.",
      detail: "The Project chooser is open. Select a directory to discover its retained agent evidence.",
      secondaryActions: [],
      facts: [],
    };
  }

  const configuredFacts: StudioOverviewFact[] = [
    ...(config.experimentEnabled ? [{ id: "experiment", label: "Harness Bench", value: "Ready", detail: "Experiment manifest loaded" }] : []),
    ...(config.evidenceEnabled ? [{ id: "evidence", label: "Evidence results", value: "Ready", detail: "Frozen verdict loaded" }] : []),
    ...(isDebuggerReady(config) ? [{ id: "debugger", label: "Debugger", value: "Ready", detail: config.harnessMode === "workspace-default" ? "Project default harness" : "Harness runtime loaded" }] : []),
    ...(config.artifactsEnabled ? [{ id: "artifacts", label: "Artifacts", value: config.artifactCount === undefined ? "Ready" : String(config.artifactCount), detail: config.artifactCount === undefined ? "Catalog loaded" : "Retained outputs" }] : []),
    ...(config.inspectorEnabled ? [{ id: "inspector", label: "Inspector", value: "Loaded", detail: "Read-only evidence source" }] : []),
    ...(config.customizationAnalysisEnabled ? [{ id: "customizations", label: "Customizations", value: config.customizationAnalyzed ? String(config.customizationDefinitionCount) : "Available", detail: config.customizationAnalyzed ? "Definitions discovered" : "Local collector ready" }] : []),
  ];

  if (configuredFacts.length === 0) {
    return {
      mode: "empty",
      title: "No working context is loaded.",
      detail: "Start Studio with a Project-enabled launcher or a configured Harness, experiment, evidence, or artifact source.",
      secondaryActions: [],
      facts: [],
    };
  }

  const primaryAction: StudioOverviewAction | undefined = config.experimentEnabled || config.evidenceEnabled
    ? { area: "compare", label: "Open Compare" }
    : isDebuggerReady(config)
      ? { area: "debugger", label: "Open Debugger" }
      : config.artifactsEnabled
        ? { area: "artifacts", label: "Open Artifacts" }
        : config.customizationAnalysisEnabled
          ? { area: "customizations", label: config.customizationAnalyzed ? "Open Customizations" : "Analyze Customizations" }
          : undefined;

  return {
    mode: "configured",
    title: config.experimentEnabled
      ? "Comparison setup is ready."
      : config.evidenceEnabled
        ? "Evidence results are ready."
        : isDebuggerReady(config)
          ? "Live debugging is ready."
          : config.artifactsEnabled
            ? "Artifact evidence is ready."
            : config.customizationAnalysisEnabled
              ? "Customization analysis is available."
              : "Configured evidence is loaded.",
    detail: "Studio is running with configured local sources. Open the primary workbench or review the loaded context below.",
    ...(primaryAction === undefined ? {} : { primaryAction }),
    secondaryActions: [
      ...(config.experimentEnabled || config.evidenceEnabled ? [{ area: "compare" as const, label: "Open Compare" }] : []),
      ...(isDebuggerReady(config) ? [{ area: "debugger" as const, label: "Open Debugger" }] : []),
      ...(config.artifactsEnabled ? [{ area: "artifacts" as const, label: "Open Artifacts" }] : []),
      ...(config.customizationAnalysisEnabled ? [{ area: "customizations" as const, label: config.customizationAnalyzed ? "Open Customizations" : "Analyze Customizations" }] : []),
    ].filter((action) => action.area !== primaryAction?.area),
    facts: configuredFacts,
  };
}

function isDebuggerReady(config: StudioConfig): boolean {
  return config.aguiEnabled && (config.harnessMode !== "workspace-default" || config.projectExecutionEnabled);
}

export function studioProjectGateRequired(config: StudioConfig, hasConfiguredSources: boolean): boolean {
  const independentContext = hasConfiguredSources
    || config.inspectorEnabled
    || config.evidenceEnabled
    || config.experimentEnabled
    || config.artifactsEnabled
    || config.harnessMode === "configured";
  return config.workspaceDiscoveryEnabled
    && !config.workspaceConnected
    && !independentContext;
}

export function capabilitySummary(config: StudioConfig): { ready: number; partial: number; foundation: number } {
  return studioDestinations(config).reduce(
    (summary, destination) => ({ ...summary, [destination.availability]: summary[destination.availability] + 1 }),
    { ready: 0, partial: 0, foundation: 0 },
  );
}
