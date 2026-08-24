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

export function studioDestinations(config: StudioConfig): readonly StudioDestination[] {
  const compareAvailable = config.experimentEnabled || config.evidenceEnabled;
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
          : "Workspace required",
    },
    {
      id: "sessions",
      label: "Sessions",
      group: "Observe",
      availability: config.workspaceConnected ? "ready" : "partial",
      status: config.workspaceConnected ? `${config.sessionCount} session${config.sessionCount === 1 ? "" : "s"}` : "Open workspace",
    },
    {
      id: "commits",
      label: "Commits",
      group: "Observe",
      availability: config.gitEnabled ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.gitEnabled ? "Repository history" : config.workspaceConnected ? "Not a Git repository" : "Workspace required",
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
        : config.workspaceConnected ? "No observed outputs" : "Workspace required",
    },
    {
      id: "debugger",
      label: "Debugger",
      group: "Run",
      availability: config.aguiEnabled ? "ready" : "foundation",
      status: config.aguiEnabled ? config.harnessMode === "workspace-default" ? "Local default" : "Live runs" : "Harness required",
    },
    {
      id: "compare",
      label: "Compare",
      group: "Validate",
      availability: compareAvailable || config.sessionCount >= 2 ? "ready" : config.workspaceConnected ? "partial" : "foundation",
      status: config.sessionCount >= 2 ? "Session compare" : config.experimentEnabled ? "Harness Bench" : config.evidenceEnabled ? "Frozen results" : config.workspaceConnected ? "Choose 2 sessions" : "Workspace required",
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

export function capabilitySummary(config: StudioConfig): { ready: number; partial: number; foundation: number } {
  return studioDestinations(config).reduce(
    (summary, destination) => ({ ...summary, [destination.availability]: summary[destination.availability] + 1 }),
    { ready: 0, partial: 0, foundation: 0 },
  );
}
