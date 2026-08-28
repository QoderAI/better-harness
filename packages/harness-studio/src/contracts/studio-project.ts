export const STUDIO_PROJECT_CATALOG_KIND = "HarnessStudioProjectCatalogV1" as const;
export const MAX_STUDIO_PROJECTS = 32;

export type StudioProjectKind = "local" | "imported";

export interface StudioProjectDescriptor {
  id: string;
  label: string;
  kind: StudioProjectKind;
  availability: "ready" | "unavailable";
  lastOpenedAt: string;
  sessionCount: number;
  inputCount: number;
  artifactCount: number;
  gitEnabled: boolean;
  workspaceWorkbenchEnabled: boolean;
}

export interface StudioProjectCatalog {
  kind: typeof STUDIO_PROJECT_CATALOG_KIND;
  revision: number;
  activeProjectId?: string;
  projects: StudioProjectDescriptor[];
  stage: "idle" | "choosing" | "discovering" | "removing";
}

export interface ActiveStudioProject extends StudioProjectDescriptor {
  revision: number;
}

const PROJECT_ID = /^project_[a-f0-9]{32}$/u;

export function isStudioProjectCatalog(value: unknown): value is StudioProjectCatalog {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (!(candidate.kind === STUDIO_PROJECT_CATALOG_KIND
    && Number.isInteger(candidate.revision)
    && Number(candidate.revision) >= 0
    && (candidate.activeProjectId === undefined || (typeof candidate.activeProjectId === "string" && PROJECT_ID.test(candidate.activeProjectId)))
    && ["idle", "choosing", "discovering", "removing"].includes(String(candidate.stage))
    && Array.isArray(candidate.projects)
    && candidate.projects.length <= MAX_STUDIO_PROJECTS
    && candidate.projects.every(isStudioProjectDescriptor))) return false;
  const ids = new Set(candidate.projects.map((project) => project.id));
  return ids.size === candidate.projects.length
    && (candidate.activeProjectId === undefined || ids.has(candidate.activeProjectId));
}

function isStudioProjectDescriptor(value: unknown): value is StudioProjectDescriptor {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string" && PROJECT_ID.test(candidate.id)
    && typeof candidate.label === "string" && candidate.label.length > 0 && candidate.label.length <= 160
    && (candidate.kind === "local" || candidate.kind === "imported")
    && (candidate.availability === "ready" || candidate.availability === "unavailable")
    && typeof candidate.lastOpenedAt === "string"
    && Number.isFinite(Date.parse(candidate.lastOpenedAt))
    && ["sessionCount", "inputCount", "artifactCount"].every((key) => Number.isInteger(candidate[key]) && Number(candidate[key]) >= 0)
    && typeof candidate.gitEnabled === "boolean"
    && typeof candidate.workspaceWorkbenchEnabled === "boolean";
}
