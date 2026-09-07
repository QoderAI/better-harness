import { STUDIO_DEFAULT_AREA, type StudioArea } from "../studio-shell-model.js";

export interface StudioLocation {
  area: StudioArea;
  projectId?: string;
}

const PROJECT_ID = /^project_[a-f0-9]{32}$/u;

export function parseStudioLocation(hash: string | undefined, areas: ReadonlySet<string>): StudioLocation {
  const route = (hash ?? "").replace(/^#\/?/u, "");
  const parts = route.split("/").filter(Boolean);
  // A retained hash can name a View this build no longer has. The Project is
  // still the scope the reader asked for, so keep it and land on the default
  // View rather than dropping back to a Project-less route.
  if (parts[0] === "projects" && parts.length === 3 && PROJECT_ID.test(parts[1]!)) {
    return { projectId: parts[1], area: areas.has(parts[2]!) ? parts[2] as StudioArea : STUDIO_DEFAULT_AREA };
  }
  const area = parts[0];
  return { area: area !== undefined && areas.has(area) ? area as StudioArea : STUDIO_DEFAULT_AREA };
}

export function studioLocationHash(location: StudioLocation): string {
  return location.projectId === undefined
    ? `#/${location.area}`
    : `#/projects/${location.projectId}/${location.area}`;
}
