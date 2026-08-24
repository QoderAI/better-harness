import { describe, expect, it } from "vitest";
import {
  capabilitySummary,
  compareSurfaces,
  inspectorSurfaces,
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
      status: "Open workspace",
    });
    expect(destinations.find((destination) => destination.id === "inputs")).toMatchObject({
      availability: "foundation",
      status: "Workspace required",
    });
    expect(destinations.find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "foundation",
      status: "Workspace required",
    });
    expect(destinations.find((destination) => destination.id === "commits")).toMatchObject({
      availability: "foundation",
      status: "Workspace required",
    });
    expect(destinations.find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Harness required",
    });
    expect(destinations.find((destination) => destination.id === "compare")).toMatchObject({
      availability: "foundation",
      status: "Workspace required",
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
      status: "Open workspace",
    });
    expect(studioDestinations(config).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "foundation",
    });
  });

  it("labels the zero-configuration workspace harness without presenting it as retained evidence", () => {
    const config: StudioConfig = { ...EMPTY, aguiEnabled: true, harnessMode: "workspace-default", workspaceDiscoveryEnabled: true };

    expect(studioDestinations(config).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "ready",
      status: "Local default",
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
});
