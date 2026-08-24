/**
 * Discovery for operator-provisioned Qoder Canvas viewers.
 *
 * This module knows only how to find and match Qoder viewers. Deciding which
 * adapter and renderer an artifact gets belongs to the plugin registry, where
 * Qoder Canvas is one provider among several rather than the host model.
 */
import { homedir } from "node:os";
import { basename, extname, join, resolve } from "node:path";
import { readFile, readdir, stat } from "node:fs/promises";
import type { ArtifactEntry } from "./artifact-catalog.js";

export interface CanvasViewer {
  id: string;
  label: string;
  extensions: string[];
  pathGlobs: string[];
  dataKey?: string;
  overrideBuiltIn: boolean;
  rootPath: string;
  manifestPath: string;
  modulePath: string;
  scriptPath?: string;
}

interface ViewerManifest {
  id?: unknown;
  label?: unknown;
  extensions?: unknown;
  pathGlobs?: unknown;
  dataKey?: unknown;
  overrideBuiltIn?: unknown;
  overridesBuiltIn?: unknown;
}

/** Qoder stores provisioned format viewers below the canvas subtree. */
export function defaultCanvasViewerRoot(env: NodeJS.ProcessEnv = process.env, home = homedir()): string {
  const qoderHome = env.QODER_HOME === undefined ? join(home, ".qoder") : resolve(env.QODER_HOME);
  return join(qoderHome, "canvas", "canvases");
}

/**
 * Discovery reads and parses every provisioned viewer's manifest, and the
 * catalog resolves viewers on every request. Live updates turn each artifact
 * write into another catalog request, so an uncached scan re-walks the
 * operator's whole viewer tree on every save. Provisioning is a rare, manual
 * act, so a short time bound is enough to keep a newly provisioned viewer
 * appearing on its own without paying for the scan repeatedly.
 */
const VIEWER_DISCOVERY_TTL_MS = 5_000;
const viewerDiscoveryCache = new Map<string, { expiresAt: number; viewers: CanvasViewer[] }>();

export function resetCanvasViewerDiscoveryCache(): void {
  viewerDiscoveryCache.clear();
}

export async function discoverCanvasViewers(root?: string): Promise<CanvasViewer[]> {
  const roots = root === undefined
    ? [...new Set([defaultCanvasViewerRoot(), join(homedir(), ".qoder", "canvas", "canvases")])]
    : [root];
  const key = JSON.stringify(roots);
  const now = Date.now();
  const cached = viewerDiscoveryCache.get(key);
  if (cached !== undefined && cached.expiresAt > now) return [...cached.viewers];
  const merged = new Map<string, CanvasViewer>();
  for (const candidate of roots) {
    const viewers = await discoverCanvasViewersAt(candidate);
    for (const viewer of viewers) if (!merged.has(viewer.id)) merged.set(viewer.id, viewer);
  }
  const discovered = [...merged.values()];
  viewerDiscoveryCache.set(key, { expiresAt: now + VIEWER_DISCOVERY_TTL_MS, viewers: discovered });
  return [...discovered];
}

async function discoverCanvasViewersAt(root: string): Promise<CanvasViewer[]> {
  const names = await readdir(root).catch(() => [] as string[]);
  const viewers: CanvasViewer[] = [];
  for (const name of names.sort()) {
    const viewerRoot = join(root, name);
    try {
      const manifestPath = join(viewerRoot, "manifest.json");
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as ViewerManifest;
      const id = portableString(manifest.id);
      const modulePath = join(viewerRoot, "index.canvas.tsx");
      if (id === undefined || !(await stat(modulePath)).isFile()) continue;
      const candidateScript = join(viewerRoot, "scripts", "index.mjs");
      const scriptPath = await stat(candidateScript).then((value) => value.isFile() ? candidateScript : undefined).catch(() => undefined);
      viewers.push({
        id,
        label: portableString(manifest.label) ?? id,
        extensions: stringArray(manifest.extensions).map(normalizeExtension),
        pathGlobs: stringArray(manifest.pathGlobs),
        ...(portableString(manifest.dataKey) === undefined ? {} : { dataKey: portableString(manifest.dataKey) }),
        overrideBuiltIn: manifest.overrideBuiltIn === true || manifest.overridesBuiltIn === true,
        rootPath: viewerRoot,
        manifestPath,
        modulePath,
        ...(scriptPath === undefined ? {} : { scriptPath }),
      });
    } catch {
      // A malformed or partially provisioned viewer is unavailable, not fatal
      // to the rest of the artifact catalog.
    }
  }
  return viewers;
}

/**
 * Every viewer that claims this artifact, in discovery order.
 *
 * Resolution has to see the whole set: an operator's overriding viewer must not
 * lose to a non-overriding one just because its directory sorts earlier, which
 * is exactly what happens when only the first match is inspected.
 */
export function matchCanvasViewers(entry: ArtifactEntry, viewers: readonly CanvasViewer[]): CanvasViewer[] {
  const extension = normalizeExtension(extname(entry.label));
  const fileName = basename(entry.label);
  return viewers.filter((viewer) => viewer.extensions.includes(extension)
    || viewer.pathGlobs.some((glob) => matchesPathGlob(fileName, glob)));
}

export function matchCanvasViewer(entry: ArtifactEntry, viewers: readonly CanvasViewer[]): CanvasViewer | undefined {
  return matchCanvasViewers(entry, viewers)[0];
}

function matchesPathGlob(fileName: string, glob: string): boolean {
  const normalized = glob.replaceAll("\\", "/");
  // `**/*.` is five characters; slicing four keeps the dot so the suffix test
  // cannot match `notes.svg` against a `**/*.g` style pattern.
  if (normalized.startsWith("**/*.")) return fileName.toLowerCase().endsWith(normalized.slice(4).toLowerCase());
  if (normalized.startsWith("**/")) return fileName === normalized.slice(3);
  return fileName === normalized;
}

function portableString(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Za-z0-9._ -]+$/u.test(value) && value.trim() !== "" ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "") : [];
}

function normalizeExtension(value: string): string {
  return value.replace(/^\./u, "").toLowerCase();
}
