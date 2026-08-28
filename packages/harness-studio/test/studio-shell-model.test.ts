import { describe, expect, it } from "vitest";
import {
  capabilitySummary,
  compareSurfaces,
  inspectorSurfaces,
  studioProjectGateRequired,
  studioOverview,
  studioDestinations,
  type StudioConfig,
} from "../src/app/studio-shell-model.js";

const EMPTY: StudioConfig = {
  aguiEnabled: false,
  acpEnabled: false,
  artifactsEnabled: false,
  evidenceEnabled: false,
  experimentEnabled: false,
  gitEnabled: false,
  harnessMode: "none",
  historyEnabled: false,
  inspectorEnabled: false,
  workspaceWorkbenchEnabled: false,
  workspaceDiscoveryEnabled: false,
  workspaceConnected: false,
  projectExecutionEnabled: false,
  sessionCount: 0,
  inputCount: 0,
  intentAnalysisEnabled: false,
  customizationAnalysisEnabled: false,
  customizationAnalyzed: false,
  customizationDefinitionCount: 0,
};

describe("Studio control-plane navigation", () => {
  it("offers the eight workbenches with honest availability", () => {
    const destinations = studioDestinations(EMPTY);

    expect(destinations.map((destination) => destination.id)).toEqual([
      "overview",
      "customizations",
      "inputs",
      "sessions",
      "commits",
      "artifacts",
      "debugger",
      "compare",
    ]);
    expect(destinations.find((destination) => destination.id === "overview")).toMatchObject({ availability: "ready" });
    expect(destinations.find((destination) => destination.id === "sessions")).toMatchObject({
      availability: "partial",
      status: "Project required",
    });
    expect(destinations.find((destination) => destination.id === "inputs")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(destinations.find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(destinations.find((destination) => destination.id === "commits")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(destinations.find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Harness required",
    });
    expect(destinations.find((destination) => destination.id === "compare")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(capabilitySummary(EMPTY)).toEqual({ ready: 1, partial: 1, foundation: 6 });
  });

  it("routes configured artifacts to Debugger, Compare, and Inspector surfaces", () => {
    const config: StudioConfig = {
      aguiEnabled: true,
      acpEnabled: false,
      artifactsEnabled: true,
      evidenceEnabled: true,
      experimentEnabled: true,
      gitEnabled: true,
      harnessMode: "configured",
      historyEnabled: true,
      inspectorEnabled: true,
      workspaceWorkbenchEnabled: true,
      workspaceDiscoveryEnabled: true,
      workspaceConnected: true,
      projectExecutionEnabled: true,
      sessionCount: 3,
      inputCount: 8,
      intentAnalysisEnabled: true,
      customizationAnalysisEnabled: true,
      customizationAnalyzed: true,
      customizationDefinitionCount: 12,
    };

    expect(compareSurfaces(config)).toEqual(["sessions", "bench", "results"]);
    expect(inspectorSurfaces(config)).toEqual(["workbench"]);
    expect(studioDestinations(config).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "ready",
      status: "Live runs",
    });
    expect(studioDestinations(config).find((destination) => destination.id === "customizations")).toMatchObject({
      availability: "ready",
      status: "12 definitions",
    });
    expect(capabilitySummary(config)).toEqual({ ready: 8, partial: 0, foundation: 0 });
  });

  it("treats an artifact directory as independent of every other input", () => {
    const config: StudioConfig = { ...EMPTY, artifactsEnabled: true };

    expect(studioDestinations(config).find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "ready",
      status: "Compatibility catalog",
    });
    // Artifacts must not imply retained Inspector evidence or a Compare input.
    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
  });

  it("reports the workspace Artifact aggregate without requiring a Session selection", () => {
    const config: StudioConfig = { ...EMPTY, artifactsEnabled: true, artifactCount: 12, workspaceConnected: true };

    expect(studioDestinations(config).find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "ready",
      status: "12 artifacts",
    });
  });

  it("does not present a live AG-UI endpoint as retained Inspector evidence or a Compare input", () => {
    const config: StudioConfig = { ...EMPTY, aguiEnabled: true, harnessMode: "configured" };

    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
    expect(studioDestinations(config).find((destination) => destination.id === "sessions")).toMatchObject({
      availability: "partial",
      status: "Project required",
    });
    expect(studioDestinations(config).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "foundation",
    });
  });

  it("labels the zero-configuration workspace harness without presenting it as retained evidence", () => {
    const config: StudioConfig = { ...EMPTY, aguiEnabled: true, harnessMode: "workspace-default", workspaceDiscoveryEnabled: true };

    expect(studioDestinations(config).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
  });

  it("enables Compare from frozen evidence alone", () => {
    const config: StudioConfig = { ...EMPTY, evidenceEnabled: true };

    expect(compareSurfaces(config)).toEqual(["results"]);
    expect(studioDestinations(config).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "ready",
      status: "Frozen results",
    });
  });

  it("does not offer a workspace command when directory discovery is unavailable", () => {
    const overview = studioOverview({
      ...EMPTY,
      experimentEnabled: true,
      inspectorEnabled: true,
      customizationAnalysisEnabled: true,
    });

    expect(overview).toMatchObject({
      mode: "configured",
      title: "Comparison setup is ready.",
      primaryAction: { area: "compare", label: "Open Compare" },
    });
    expect(overview.facts.map((fact) => fact.id)).toEqual(["experiment", "inspector", "customizations"]);
    expect(overview.secondaryActions).toEqual([
      { area: "customizations", label: "Analyze Customizations" },
    ]);
  });

  it("leaves workspace opening to the modal gate when discovery is available", () => {
    const overview = studioOverview({ ...EMPTY, workspaceDiscoveryEnabled: true });

    expect(overview).toMatchObject({
      mode: "workspace-required",
      secondaryActions: [],
    });
    expect(overview.primaryAction).toBeUndefined();
  });

  it("requires an initial Project only when no independent configured context is available", () => {
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true }, false)).toBe(true);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, evidenceEnabled: true }, true)).toBe(false);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, artifactsEnabled: true }, false)).toBe(false);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, aguiEnabled: true, harnessMode: "configured" }, false)).toBe(false);
  });

  it("does not advertise the Project-default Debugger before a Project is active", () => {
    const overview = studioOverview({
      ...EMPTY,
      aguiEnabled: true,
      harnessMode: "workspace-default",
      inspectorEnabled: true,
    });

    expect(overview.mode).toBe("configured");
    expect(overview.facts.map((fact) => fact.id)).toEqual(["inspector"]);
    expect(overview.secondaryActions).not.toContainEqual({ area: "debugger", label: "Open Debugger" });
  });

  it("keeps imported retained-run Projects out of the default execution path", () => {
    const config: StudioConfig = {
      ...EMPTY,
      aguiEnabled: true,
      harnessMode: "workspace-default",
      workspaceConnected: true,
      projectExecutionEnabled: false,
    };

    expect(studioDestinations(config).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Read-only Project",
    });
    expect(studioOverview(config).secondaryActions).not.toContainEqual({ area: "debugger", label: "Open Debugger" });
  });

  it("summarizes connected workspace evidence without capability maturity totals", () => {
    const overview = studioOverview({
      ...EMPTY,
      aguiEnabled: true,
      artifactsEnabled: true,
      artifactCount: 6,
      gitEnabled: true,
      harnessMode: "workspace-default",
      projectExecutionEnabled: true,
      workspaceWorkbenchEnabled: true,
      workspaceDiscoveryEnabled: true,
      workspaceConnected: true,
      sessionCount: 12,
      inputCount: 34,
    });

    expect(overview).toMatchObject({
      mode: "workspace",
      primaryAction: { area: "sessions", label: "Open Sessions" },
    });
    expect(overview.facts.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: "inputs", value: "34" },
      { id: "sessions", value: "12" },
      { id: "artifacts", value: "6" },
      { id: "repository", value: "Git" },
    ]);
    expect(overview.secondaryActions).toEqual([
      { area: "inputs", label: "Review Inputs" },
      { area: "compare", label: "Open Compare" },
      { area: "debugger", label: "Open Debugger" },
      { area: "artifacts", label: "Open Artifacts" },
    ]);
  });
});
