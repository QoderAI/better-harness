import { CUSTOMIZATION_DEFAULT_CATEGORY, isCustomizationCategory, type CustomizationCategory } from "../customization-library.js";
import { STUDIO_DEFAULT_AREA, type StudioArea } from "../studio-shell-model.js";

export interface StudioLocation {
  area: StudioArea;
  projectId?: string;
  /** Which catalog kind the Customizations View is showing, when the route names one. */
  customizationCategory?: CustomizationCategory;
}

const PROJECT_ID = /^project_[a-f0-9]{32}$/u;

/**
 * A View that navigates by sub-route keeps that sub-route in the address, so a
 * reload lands where the reader was rather than on the View's first row.
 */
function viewLocation(parts: readonly string[], areas: ReadonlySet<string>): StudioLocation | undefined {
  if (parts.length === 2 && parts[0] === "sessions" && parts[1] === "performance") return { area: "session-performance" };
  if (parts[0] === "customizations" && areas.has("customizations")) {
    if (parts.length === 1) return { area: "customizations", customizationCategory: CUSTOMIZATION_DEFAULT_CATEGORY };
    if (parts.length === 2 && isCustomizationCategory(parts[1])) return { area: "customizations", customizationCategory: parts[1] };
    return undefined;
  }
  if (parts.length === 1 && areas.has(parts[0]!)) return { area: parts[0] as StudioArea };
  return undefined;
}

export function parseStudioLocation(hash: string | undefined, areas: ReadonlySet<string>): StudioLocation {
  const route = (hash ?? "").replace(/^#\/?/u, "").split('?')[0]!;
  const parts = route.split("/").filter(Boolean);
  // A retained hash can name a View this build no longer has. The Project is
  // still the scope the reader asked for, so keep it and land on the default
  // View rather than dropping back to a Project-less route.
  if (parts[0] === "projects" && PROJECT_ID.test(parts[1] ?? "")) {
    const view = viewLocation(parts.slice(2), areas);
    if (view !== undefined) return { projectId: parts[1], ...view };
    if (parts.length === 3) return { projectId: parts[1], area: STUDIO_DEFAULT_AREA };
    return { area: STUDIO_DEFAULT_AREA };
  }
  return viewLocation(parts, areas) ?? { area: STUDIO_DEFAULT_AREA };
}

export function studioLocationHash(location: StudioLocation): string {
  const route = location.area === "session-performance"
    ? "sessions/performance"
    : location.area === "customizations" && location.customizationCategory !== undefined
      ? `customizations/${location.customizationCategory}`
      : location.area;
  return location.projectId === undefined
    ? `#/${route}`
    : `#/projects/${location.projectId}/${route}`;
}
