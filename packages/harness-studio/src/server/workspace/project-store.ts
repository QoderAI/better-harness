import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { StudioProjectDescriptor, StudioProjectKind } from "../../contracts/studio-project.js";
import type { HarnessStudioState, StoredStudioProject } from "../studio-types.js";

/**
 * Remembered Projects, so a relaunch resumes where the reader left off.
 *
 * Studio's Project catalog was in-memory only, which made every launch open on
 * an empty gate even though the reader had opened the same directory dozens of
 * times. Only local Projects are remembered: an imported workspace lives in a
 * bounded materialization this process created, and that is gone by the next run.
 *
 * The file is a cache, never a source of truth. Anything unreadable, malformed,
 * or pointing at a directory that no longer exists is dropped, because a stale
 * catalog must not be able to stop Studio from starting.
 */

const CATALOG_VERSION = 1;
const CATALOG_FILE = "projects.json";
/** Matches `MAX_STUDIO_PROJECTS`; a hand-edited file cannot grow past it. */
const MAX_REMEMBERED = 32;

interface PersistedProject {
  id: string;
  label: string;
  kind: StudioProjectKind;
  localDirectory: string;
  lastOpenedAt: string;
  sessionCount: number;
  inputCount: number;
  artifactCount: number;
  gitEnabled: boolean;
  workspaceWorkbenchEnabled: boolean;
}

interface PersistedCatalog {
  version: number;
  activeProjectId?: string;
  projects: PersistedProject[];
}

function catalogPath(stateRoot: string): string {
  return join(stateRoot, CATALOG_FILE);
}

function persistable(project: StoredStudioProject): PersistedProject | undefined {
  // Only a local directory survives a restart; an imported workspace does not.
  if (project.kind !== "local" || project.localDirectory === undefined) return undefined;
  const { descriptor } = project;
  return {
    id: descriptor.id,
    label: descriptor.label,
    kind: "local",
    localDirectory: project.localDirectory,
    lastOpenedAt: descriptor.lastOpenedAt,
    sessionCount: descriptor.sessionCount,
    inputCount: descriptor.inputCount,
    artifactCount: descriptor.artifactCount,
    gitEnabled: descriptor.gitEnabled,
    workspaceWorkbenchEnabled: descriptor.workspaceWorkbenchEnabled,
  };
}

function readProject(value: unknown): PersistedProject | undefined {
  if (value === null || typeof value !== "object") return undefined;
  const candidate = value as Record<string, unknown>;
  const strings = ["id", "label", "localDirectory", "lastOpenedAt"] as const;
  if (!strings.every((key) => typeof candidate[key] === "string" && (candidate[key] as string).length > 0)) return undefined;
  if (candidate.kind !== "local") return undefined;
  const counts = ["sessionCount", "inputCount", "artifactCount"] as const;
  if (!counts.every((key) => Number.isSafeInteger(candidate[key]) && (candidate[key] as number) >= 0)) return undefined;
  return {
    id: candidate.id as string,
    label: candidate.label as string,
    kind: "local",
    localDirectory: candidate.localDirectory as string,
    lastOpenedAt: candidate.lastOpenedAt as string,
    sessionCount: candidate.sessionCount as number,
    inputCount: candidate.inputCount as number,
    artifactCount: candidate.artifactCount as number,
    gitEnabled: candidate.gitEnabled === true,
    workspaceWorkbenchEnabled: candidate.workspaceWorkbenchEnabled === true,
  };
}

/**
 * Load the remembered catalog, dropping anything that no longer resolves.
 *
 * A directory that has since been deleted or renamed is reported as
 * `unavailable` rather than removed, so the reader sees why a Project they
 * remember is not openable instead of finding it silently missing.
 */
export async function loadStoredProjects(stateRoot: string): Promise<{
  projects: Map<string, StoredStudioProject>;
  activeProjectId?: string;
}> {
  const empty = { projects: new Map<string, StoredStudioProject>() };
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(catalogPath(stateRoot), "utf8"));
  } catch {
    return empty;
  }
  if (parsed === null || typeof parsed !== "object") return empty;
  const catalog = parsed as Partial<PersistedCatalog>;
  if (catalog.version !== CATALOG_VERSION || !Array.isArray(catalog.projects)) return empty;

  const projects = new Map<string, StoredStudioProject>();
  const ordered = catalog.projects
    .flatMap((value) => { const project = readProject(value); return project === undefined ? [] : [project]; })
    .sort((left, right) => right.lastOpenedAt.localeCompare(left.lastOpenedAt))
    .slice(0, MAX_REMEMBERED);
  for (const project of ordered) {
    const reachable = await stat(project.localDirectory).then((entry) => entry.isDirectory()).catch(() => false);
    const descriptor: StudioProjectDescriptor = {
      id: project.id,
      label: project.label,
      kind: "local",
      availability: reachable ? "ready" : "unavailable",
      lastOpenedAt: project.lastOpenedAt,
      sessionCount: project.sessionCount,
      inputCount: project.inputCount,
      artifactCount: project.artifactCount,
      gitEnabled: project.gitEnabled,
      workspaceWorkbenchEnabled: project.workspaceWorkbenchEnabled,
    };
    projects.set(project.id, { descriptor, kind: "local", localDirectory: project.localDirectory });
  }
  const active = typeof catalog.activeProjectId === "string"
    && projects.get(catalog.activeProjectId)?.descriptor.availability === "ready"
    ? catalog.activeProjectId
    : undefined;
  return { projects, ...(active === undefined ? {} : { activeProjectId: active }) };
}

/**
 * Write the catalog through a temporary file, so an interrupted write leaves the
 * previous catalog intact rather than a truncated one.
 *
 * Failures are swallowed: not remembering a Project is a degraded launch, but a
 * failed write must never fail the request that triggered it.
 */
export async function saveStoredProjects(stateRoot: string, state: HarnessStudioState): Promise<void> {
  const catalog: PersistedCatalog = {
    version: CATALOG_VERSION,
    ...(state.activeProjectId === undefined ? {} : { activeProjectId: state.activeProjectId }),
    projects: [...state.projects.values()]
      .flatMap((project) => { const value = persistable(project); return value === undefined ? [] : [value]; })
      .slice(0, MAX_REMEMBERED),
  };
  const target = catalogPath(stateRoot);
  const temporary = `${target}.${process.pid}.tmp`;
  try {
    await mkdir(dirname(target), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => undefined);
  }
}
