import { readFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";

export type StudioSourceKind = "inspector" | "evidence" | "experiment";

export interface StudioSourceCandidate {
  id: string;
  kind: StudioSourceKind;
  label: string;
  path: string;
}

export interface StudioSourceDescriptor {
  id: string;
  kind: StudioSourceKind;
  label: string;
  active: boolean;
}

const SOURCE_KINDS = new Set<StudioSourceKind>(["inspector", "evidence", "experiment"]);
const SOURCE_ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function startupSource(kind: StudioSourceKind, path: string | undefined, label?: string): StudioSourceCandidate | undefined {
  if (path === undefined) return undefined;
  return {
    id: `${kind}_startup`,
    kind,
    label: label ?? defaultLabel(kind, path),
    path: resolve(path),
  };
}

export async function readSourceCatalogFile(catalogPath: string): Promise<StudioSourceCandidate[]> {
  const resolved = resolve(catalogPath);
  const value = JSON.parse(await readFile(resolved, "utf8")) as unknown;
  return parseSourceCatalog(value, dirname(resolved));
}

export function parseSourceCatalog(value: unknown, baseDir: string): StudioSourceCandidate[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source catalog must be an object with a sources array.");
  }
  const sources = (value as { sources?: unknown }).sources;
  if (!Array.isArray(sources)) throw new Error("Source catalog requires a sources array.");
  return sources.map((entry, index) => parseSourceEntry(entry, baseDir, index));
}

export function mergeSourceCatalog(...groups: Array<Array<StudioSourceCandidate | undefined> | undefined>): StudioSourceCandidate[] {
  const seen = new Set<string>();
  const merged: StudioSourceCandidate[] = [];
  for (const group of groups) {
    for (const source of group ?? []) {
      if (source === undefined || seen.has(source.id)) continue;
      seen.add(source.id);
      merged.push(source);
    }
  }
  return merged;
}

export function describeSources(
  sources: readonly StudioSourceCandidate[],
  active: Partial<Record<StudioSourceKind, string>>,
): StudioSourceDescriptor[] {
  return sources.map((source) => ({
    id: source.id,
    kind: source.kind,
    label: source.label,
    active: active[source.kind] === source.id,
  }));
}

export function activeSourcePath(
  sources: readonly StudioSourceCandidate[],
  active: Partial<Record<StudioSourceKind, string>>,
  kind: StudioSourceKind,
): string | undefined {
  const id = active[kind];
  return id === undefined ? undefined : sources.find((source) => source.kind === kind && source.id === id)?.path;
}

export function initialActiveSources(
  sources: readonly StudioSourceCandidate[],
  preferred: Partial<Record<StudioSourceKind, string | undefined>>,
): Partial<Record<StudioSourceKind, string>> {
  const active: Partial<Record<StudioSourceKind, string>> = {};
  for (const kind of SOURCE_KINDS) {
    const preferredId = preferred[kind];
    const candidate = preferredId === undefined
      ? sources.find((source) => source.kind === kind)
      : sources.find((source) => source.kind === kind && source.id === preferredId);
    if (candidate !== undefined) active[kind] = candidate.id;
  }
  return active;
}

export function assertSourceSelection(value: unknown): { kind: StudioSourceKind; sourceId: string } {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Source selection must be an object.");
  }
  const body = value as { kind?: unknown; sourceId?: unknown };
  if (typeof body.kind !== "string" || !SOURCE_KINDS.has(body.kind as StudioSourceKind)) {
    throw new Error("Source selection kind must be inspector, evidence, or experiment.");
  }
  if (typeof body.sourceId !== "string" || !SOURCE_ID_PATTERN.test(body.sourceId)) {
    throw new Error("Source selection requires an opaque sourceId.");
  }
  return { kind: body.kind as StudioSourceKind, sourceId: body.sourceId };
}

function parseSourceEntry(value: unknown, baseDir: string, index: number): StudioSourceCandidate {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Source catalog entry ${index + 1} must be an object.`);
  }
  const entry = value as Record<string, unknown>;
  if (typeof entry.kind !== "string" || !SOURCE_KINDS.has(entry.kind as StudioSourceKind)) {
    throw new Error(`Source catalog entry ${index + 1} has an unsupported kind.`);
  }
  if (typeof entry.path !== "string" || entry.path.trim().length === 0) {
    throw new Error(`Source catalog entry ${index + 1} requires a path.`);
  }
  const kind = entry.kind as StudioSourceKind;
  const id = typeof entry.id === "string" && SOURCE_ID_PATTERN.test(entry.id)
    ? entry.id
    : `${kind}_${index + 1}`;
  return {
    id,
    kind,
    label: typeof entry.label === "string" && entry.label.trim().length > 0
      ? entry.label
      : defaultLabel(kind, entry.path),
    path: resolve(baseDir, entry.path),
  };
}

function defaultLabel(kind: StudioSourceKind, path: string): string {
  const name = basename(path) || path;
  if (kind === "inspector") return `Inspector · ${name}`;
  if (kind === "evidence") return `Evidence · ${name}`;
  return `Experiment · ${name}`;
}
