import { describe, expect, it } from "vitest";
import { createInstance, type TFunction } from "i18next";
import {
  capabilitySummary,
  compareSurfaces,
  inspectorSurfaces,
  liveCompareReady,
  selectableAcpAgents,
  sessionAgents,
  sessionCompareScope,
  studioProjectGateRequired,
  studioDestinations,
  STUDIO_DEFAULT_AREA,
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
  it("offers global Memory and the existing workbenches with honest availability", () => {
    const destinations = studioDestinations(EMPTY, undefined, commonT);

    expect(destinations.map((destination) => destination.id)).toEqual([
      "memory",
      "customizations",
      "sessions",
      "session-performance",
      "commits",
      "artifacts",
      "debugger",
      "compare",
    ]);
    // The landing View must be one the shell can actually resolve.
    expect(destinations.map((destination) => destination.id)).toContain(STUDIO_DEFAULT_AREA);
    expect(destinations.find((destination) => destination.id === "sessions")).toMatchObject({
      availability: "partial",
      status: "Project required",
    });
    expect(destinations.find((destination) => destination.id === "artifacts")).toMatchObject({
      availability: "ready",
      status: "No observed outputs",
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
    expect(capabilitySummary(EMPTY, commonT)).toEqual({ ready: 2, partial: 1, foundation: 5 });
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true }, false, "memory-sources")).toBe(false);
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
      sessionAgents: [{ agent: "qoder", sessionCount: 2 }, { agent: "codex", sessionCount: 1 }],
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
    expect(capabilitySummary(config, commonT)).toEqual({ ready: 7, partial: 0, foundation: 1 });
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
      availability: "ready",
      status: "No observed outputs",
    });
  });

  it("labels Compare from its active surface", () => {
    const config: StudioConfig = {
      ...EMPTY,
      experimentEnabled: true,
      experimentRunnable: true,
      evidenceEnabled: true,
      sessionCount: 3,
      sessionAgents: [{ agent: "qoder", sessionCount: 2 }, { agent: "codex", sessionCount: 1 }],
      workspaceConnected: true,
    };

    expect(studioDestinations(config, "bench", commonT).find((destination) => destination.id === "compare")?.status).toBe("Harness Bench");
    expect(studioDestinations(config, "sessions", commonT).find((destination) => destination.id === "compare")?.status).toBe("Cross-Agent compare");
    expect(studioDestinations(config, "results", commonT).find((destination) => destination.id === "compare")?.status).toBe("Frozen results");
  });

  it("offers a live Agent comparison only when an Agent can be launched in an executable Project", () => {
    const ready: StudioConfig = {
      ...EMPTY,
      acpEnabled: true,
      workspaceConnected: true,
      projectExecutionEnabled: true,
      acpAgents: [
        { id: "qodercli", label: "Qoder CLI", available: true, detail: "Available" },
        { id: "claude-acp", label: "Claude ACP", available: true, detail: "Available" },
        { id: "dsh", label: "DSH ACP", available: false, detail: "No portable entrypoint." },
      ],
    };

    expect(liveCompareReady(ready)).toBe(true);
    expect(compareSurfaces(ready)).toEqual(["live"]);
    expect(selectableAcpAgents(ready).map((agent) => agent.id)).toEqual(["qodercli", "claude-acp"]);
    expect(studioDestinations(ready, "live", commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "ready",
      status: "Live Agent compare",
    });
    // An unavailable Agent, a read-only Project, or no ACP support each withdraw it.
    expect(liveCompareReady({ ...ready, acpAgents: [{ id: "dsh", label: "DSH ACP", available: false, detail: "No portable entrypoint." }] })).toBe(false);
    expect(liveCompareReady({ ...ready, projectExecutionEnabled: false })).toBe(false);
    expect(liveCompareReady({ ...ready, acpEnabled: false })).toBe(false);
    expect(compareSurfaces({ ...ready, projectExecutionEnabled: false })).toEqual([]);
  });

  it("scopes Session compare by Agent count rather than Session or Project count", () => {
    const oneAgent: StudioConfig = {
      ...EMPTY,
      workspaceConnected: true,
      sessionCount: 4,
      sessionAgents: [{ agent: "qoder", sessionCount: 4 }],
    };
    const twoAgents: StudioConfig = {
      ...oneAgent,
      sessionAgents: [{ agent: "qoder", sessionCount: 3 }, { agent: "claude-code", sessionCount: 1 }],
    };

    expect(sessionCompareScope(oneAgent)).toBe("single-agent");
    expect(sessionCompareScope(twoAgents)).toBe("cross-agent");
    expect(sessionCompareScope({ ...twoAgents, sessionCount: 1 })).toBe("insufficient");
    // A single Agent keeps the surface reachable but must not claim readiness.
    expect(compareSurfaces(oneAgent)).toEqual(["sessions"]);
    expect(studioDestinations(oneAgent, "sessions", commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "partial",
      status: "One Agent only",
    });
    expect(studioDestinations(twoAgents, "sessions", commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "ready",
      status: "Cross-Agent compare",
    });
  });

  it("asks a connected Project for a second Agent instead of another Project", () => {
    const config: StudioConfig = {
      ...EMPTY,
      workspaceConnected: true,
      workspaceDiscoveryEnabled: true,
      sessionCount: 1,
      sessionAgents: [{ agent: "qoder", sessionCount: 1 }],
    };

    expect(compareSurfaces(config)).toEqual([]);
    expect(studioDestinations(config, undefined, commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "partial",
      status: "Second Agent required",
    });
    expect(sessionAgents(config)).toEqual([{ agent: "qoder", sessionCount: 1 }]);
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

  it("does not call an unavailable experiment ready outside the Experiment workbench", () => {
    const config: StudioConfig = { ...EMPTY, experimentEnabled: true, experimentRunnable: false };

    expect(studioDestinations(config, "bench", commonT).find((destination) => destination.id === "compare")).toMatchObject({
      availability: "partial",
      status: "Comparison blocked",
    });
  });

  it("opens Artifacts without a Project or catalog while keeping other gates", () => {
    const config = { ...EMPTY, workspaceDiscoveryEnabled: true };
    expect(studioProjectGateRequired(config, false, "artifacts")).toBe(false);
    expect(studioProjectGateRequired(config, false, "sessions")).toBe(true);
  });

  it("requires an initial Project only when no independent configured context is available", () => {
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true }, false)).toBe(true);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, evidenceEnabled: true }, true)).toBe(false);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, artifactsEnabled: true }, false)).toBe(false);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, artifactsEnabled: true, artifactCount: 0 }, false)).toBe(true);
    expect(studioProjectGateRequired({ ...EMPTY, workspaceDiscoveryEnabled: true, runEnabled: true, harnessMode: "configured" }, false)).toBe(false);
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
  });
});
