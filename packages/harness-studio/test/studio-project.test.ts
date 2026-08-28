import { describe, expect, it } from "vitest";
import { isStudioProjectCatalog, STUDIO_PROJECT_CATALOG_KIND } from "../src/contracts/studio-project.js";
import { parseStudioLocation, studioLocationHash } from "../src/app/shell/project-routing.js";

const PROJECT_ID = `project_${"a".repeat(32)}`;
const AREAS = new Set(["overview", "sessions", "compare"]);

describe("Studio Project contracts", () => {
  it("round-trips opaque Project and View routes while preserving legacy routes", () => {
    expect(parseStudioLocation(`#/projects/${PROJECT_ID}/sessions`, AREAS)).toEqual({ projectId: PROJECT_ID, area: "sessions" });
    expect(studioLocationHash({ projectId: PROJECT_ID, area: "compare" })).toBe(`#/projects/${PROJECT_ID}/compare`);
    expect(parseStudioLocation("#/sessions", AREAS)).toEqual({ area: "sessions" });
    expect(parseStudioLocation("#/projects/not-a-project/sessions", AREAS)).toEqual({ area: "overview" });
    expect(parseStudioLocation(`#/projects/${PROJECT_ID}/sessions/extra`, AREAS)).toEqual({ area: "overview" });
  });

  it("accepts a bounded catalog and rejects inconsistent active Projects", () => {
    const descriptor = {
      id: PROJECT_ID,
      label: "better-harness",
      kind: "local" as const,
      availability: "ready" as const,
      lastOpenedAt: "2026-08-27T00:00:00.000Z",
      sessionCount: 2,
      inputCount: 1,
      artifactCount: 3,
      gitEnabled: true,
      workspaceWorkbenchEnabled: true,
    };
    expect(isStudioProjectCatalog({
      kind: STUDIO_PROJECT_CATALOG_KIND,
      revision: 1,
      activeProjectId: PROJECT_ID,
      projects: [descriptor],
      stage: "idle",
    })).toBe(true);
    expect(isStudioProjectCatalog({
      kind: STUDIO_PROJECT_CATALOG_KIND,
      revision: 1,
      activeProjectId: PROJECT_ID,
      projects: [descriptor],
      stage: "removing",
    })).toBe(true);
    expect(isStudioProjectCatalog({
      kind: STUDIO_PROJECT_CATALOG_KIND,
      revision: 1,
      activeProjectId: `project_${"b".repeat(32)}`,
      projects: [descriptor],
      stage: "idle",
    })).toBe(false);
    expect(isStudioProjectCatalog({
      kind: STUDIO_PROJECT_CATALOG_KIND,
      revision: 1,
      projects: [{ ...descriptor, id: "../../workspace" }],
      stage: "idle",
    })).toBe(false);
  });
});
