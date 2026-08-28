import type { StudioArea } from "../studio-shell-model.js";

export interface StudioLocation {
  area: StudioArea;
  projectId?: string;
}

const PROJECT_ID = /^project_[a-f0-9]{32}$/u;

export function parseStudioLocation(hash: string | undefined, areas: ReadonlySet<string>): StudioLocation {
  const route = (hash ?? "").replace(/^#\/?/u, "");
  const parts = route.split("/").filter(Boolean);
  if (parts[0] === "projects" && parts.length === 3 && PROJECT_ID.test(parts[1]!) && areas.has(parts[2]!)) {
    return { projectId: parts[1], area: parts[2] as StudioArea };
  }
  const area = parts[0];
  return { area: area !== undefined && areas.has(area) ? area as StudioArea : "overview" };
}

export function studioLocationHash(location: StudioLocation): string {
  return location.projectId === undefined
    ? `#/${location.area}`
    : `#/projects/${location.projectId}/${location.area}`;
}
