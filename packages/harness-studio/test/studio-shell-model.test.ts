import { describe, expect, it } from "vitest";
import { createInstance, type TFunction } from "i18next";
import {
  capabilitySummary,
  compareSurfaces,
  inspectorSurfaces,
  studioProjectGateRequired,
  studioOverview,
  studioDestinations,
  type StudioConfig,
} from "../src/app/studio-shell-model.js";
import { namespaces as enNamespaces } from "../src/app/i18n/en/index.js";

/** Real English `t` bound to an isolated i18next instance over the bundled en resources. */
function englishT<N extends string>(defaultNS: N): TFunction<N> {
  const instance = createInstance();
  instance.init({
    resources: { en: enNamespaces },
    lng: "en",
    fallbackLng: "en",
    defaultNS,
    interpolation: { escapeValue: false },
  });
  return instance.t.bind(instance) as TFunction<N>;
}

const commonT = englishT("common");
const overviewT = englishT("overview");

const EMPTY: StudioConfig = {
  runEnabled: false,
  acpEnabled: false,
  artifactsEnabled: false,
  evidenceEnabled: false,
  experimentEnabled: false,
  experimentRunnable: false,
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
    const destinations = studioDestinations(EMPTY, undefined, commonT);

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
    expect(capabilitySummary(EMPTY, commonT)).toEqual({ ready: 1, partial: 1, foundation: 6 });
  });

  it("routes configured artifacts to Debugger, Compare, and Inspector surfaces", () => {
    const config: StudioConfig = {
      runEnabled: true,
      acpEnabled: false,
      artifactsEnabled: true,
      evidenceEnabled: true,
      experimentEnabled: true,
      experimentRunnable: true,
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
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "ready",
      status: "Live runs",
    });
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "customizations")).toMatchObject({
      availability: "ready",
      status: "12 definitions",
    });
    expect(capabilitySummary(config, commonT)).toEqual({ ready: 8, partial: 0, foundation: 0 });
  });

  it("treats an artifact directory as independent of every other input", () => {
    const config: StudioConfig = { ...EMPTY, artifactsEnabled: true };

    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "ready",
      status: "Compatibility catalog",
    });
    // Artifacts must not imply retained Inspector evidence or a Compare input.
    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
  });

  it("reports the workspace Artifact aggregate without requiring a Session selection", () => {
    const config: StudioConfig = { ...EMPTY, artifactsEnabled: true, artifactCount: 12, workspaceConnected: true };

    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "ready",
      status: "12 artifacts",
    });
  });

  it("does not advertise an exact zero Artifact count as usable evidence", () => {
    const config: StudioConfig = { ...EMPTY, artifactsEnabled: true, artifactCount: 0, workspaceConnected: true };

    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "partial",
      status: "No observed outputs",
    });
    expect(studioOverview(config, overviewT).secondaryActions).not.toContainEqual({ area: "artifacts", label: "Open Artifacts" });
    expect(studioOverview(config, overviewT).facts.find((fact) => fact.id === "artifacts")).toMatchObject({ value: "0", detail: "No observed outputs" });
  });

  it("labels Compare from its active surface", () => {
    const config: StudioConfig = { ...EMPTY, experimentEnabled: true, experimentRunnable: true, evidenceEnabled: true, sessionCount: 3, workspaceConnected: true };

    expect(studioDestinations(config, "bench", commonT).find((destination) => destination.id === "compare")?.status).toBe("Harness Bench");
    expect(studioDestinations(config, "sessions", commonT).find((destination) => destination.id === "compare")?.status).toBe("Session compare");
    expect(studioDestinations(config, "results", commonT).find((destination) => destination.id === "compare")?.status).toBe("Frozen results");
  });

  it("does not present a live Harness run endpoint as retained Inspector evidence or a Compare input", () => {
    const config: StudioConfig = { ...EMPTY, runEnabled: true, harnessMode: "configured" };

    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "sessions")).toMatchObject({
      availability: "partial",
      status: "Project required",
    });
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "foundation",
    });
  });

  it("labels the zero-configuration workspace harness without presenting it as retained evidence", () => {
    const config: StudioConfig = { ...EMPTY, runEnabled: true, harnessMode: "workspace-default", workspaceDiscoveryEnabled: true };

expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Project required",
    });
    expect(inspectorSurfaces(config)).toEqual([]);
    expect(compareSurfaces(config)).toEqual([]);
  });

  it("enables Compare from frozen evidence alone", () => {
    const config: StudioConfig = { ...EMPTY, evidenceEnabled: true };

    expect(compareSurfaces(config)).toEqual(["results"]);
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "ready",
      status: "Frozen results",
    });
  });

  it("does not offer a workspace command when directory discovery is unavailable", () => {
    const overview = studioOverview({
      ...EMPTY,
      experimentEnabled: true,
      experimentRunnable: true,
      inspectorEnabled: true,
      customizationAnalysisEnabled: true,
    }, overviewT);

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

  it("does not call an unavailable experiment ready outside the Experiment workbench", () => {
    const config: StudioConfig = { ...EMPTY, experimentEnabled: true, experimentRunnable: false };

    expect(studioDestinations(config, "bench", commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "partial",
      status: "Comparison blocked",
    });
    expect(studioOverview(config, overviewT)).toMatchObject({
      title: "Comparison setup needs attention.",
      facts: [expect.objectContaining({ id: "experiment", value: "Blocked" })],
    });
  });

  it("leaves workspace opening to the modal gate when discovery is available", () => {
    const overview = studioOverview({ ...EMPTY, workspaceDiscoveryEnabled: true }, overviewT);

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
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, artifactsEnabled: true, artifactCount: 0 }, false)).toBe(true);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, runEnabled: true, harnessMode: "configured" }, false)).toBe(false);
  });

  it("does not advertise the Project-default Debugger before a Project is active", () => {
    const overview = studioOverview({
      ...EMPTY,
      runEnabled: true,
      harnessMode: "workspace-default",
      inspectorEnabled: true,
    }, overviewT);

    expect(overview.mode).toBe("configured");
    expect(overview.facts.map((fact) => fact.id)).toEqual(["inspector"]);
    expect(overview.secondaryActions).not.toContainEqual({ area: "debugger", label: "Open Debugger" });
  });

  it("keeps imported retained-run Projects out of the default execution path", () => {
    const config: StudioConfig = {
      ...EMPTY,
      runEnabled: true,
      harnessMode: "workspace-default",
      workspaceConnected: true,
      projectExecutionEnabled: false,
    };

    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "debugger")).toMatchObject({
      availability: "foundation",
      status: "Read-only Project",
    });
    expect(studioOverview(config, overviewT).secondaryActions).not.toContainEqual({ area: "debugger", label: "Open Debugger" });
  });

  it("summarizes connected workspace evidence without capability maturity totals", () => {
    const overview = studioOverview({
      ...EMPTY,
      runEnabled: true,
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
    }, overviewT);

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
