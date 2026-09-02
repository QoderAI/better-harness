import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { resolveWorkspace, resolveWorkspaces, workspaceIdentity } from "@/scripts/workspace.mjs";
import { normalizeSessionLimit } from "@/scripts/collect-local-data.mjs";

import type { DashboardInput, DashboardProject, DashboardProjectSnapshot } from "./contracts";

const execFileAsync = promisify(execFile);

// Collecting every host adapter is slow enough to be worth reusing, and stale
// enough to expire: the page must be able to show evidence written after the
// server started without a restart.
const DEFAULT_REFRESH_MS = 30_000;

export function refreshMs(env: NodeJS.ProcessEnv = process.env) {
  const configured = Number(env.BETTER_HARNESS_REFRESH_MS ?? DEFAULT_REFRESH_MS);
  return Number.isFinite(configured) && configured >= 0 ? configured : DEFAULT_REFRESH_MS;
}

type CacheEntry<T> = { at: number; promise: Promise<T> };

/**
 * Reuse one collection for the configured window, age the entry from the end of
 * a slow collection rather than its start, and drop a failed collection so the
 * next request retries instead of caching the error forever.
 */
export function createTimedCache<T>({
  load,
  ttlMs,
  now = () => Date.now(),
}: {
  load: () => Promise<T>;
  ttlMs: () => number;
  now?: () => number;
}) {
  let entry: CacheEntry<T> | null = null;

  return {
    read() {
      if (entry && now() - entry.at < ttlMs()) return entry.promise;
      const created: CacheEntry<T> = {
        at: now(),
        promise: Promise.resolve()
          .then(load)
          .then(
            (value) => {
              created.at = now();
              return value;
            },
            (error: unknown) => {
              if (entry === created) entry = null;
              throw error;
            },
          ),
      };
      entry = created;
      return created.promise;
    },
    clear() {
      entry = null;
    },
  };
}

export function createKeyedTimedCache<K, T>({
  load,
  ttlMs,
  now = () => Date.now(),
}: {
  load: (key: K) => Promise<T>;
  ttlMs: () => number;
  now?: () => number;
}) {
  const caches = new Map<K, ReturnType<typeof createTimedCache<T>>>();
  return {
    read(key: K) {
      let cache = caches.get(key);
      if (!cache) {
        cache = createTimedCache({ load: () => load(key), ttlMs, now });
        caches.set(key, cache);
      }
      return cache.read();
    },
    clear() {
      for (const cache of caches.values()) cache.clear();
      caches.clear();
    },
  };
}

function collectorPath() {
  const candidates = [
    path.resolve(process.cwd(), "scripts", "collect-local-data.mjs"),
    path.resolve(process.cwd(), "packages", "harness-ui", "scripts", "collect-local-data.mjs"),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) throw new Error("Cannot locate the Harness Dashboard data collector.");
  return resolved;
}

export function collectorArgs(
  collector: string,
  env: NodeJS.ProcessEnv = process.env,
  workspace = resolveWorkspace(env),
) {
  const args = [collector, "--workspace", path.resolve(workspace)];
  const providers = env.BETTER_HARNESS_PROVIDERS?.trim();
  if (providers) args.push("--providers", providers);
  // An unset limit means every eligible session. A configured limit bounds the
  // work with `latest-n`, which the collector reports as an incomplete selection.
  const limit = env.BETTER_HARNESS_SESSION_LIMIT?.trim();
  if (limit) args.push("--limit", String(normalizeSessionLimit(limit)));
  return args;
}

export function collectorArgvList(
  collector: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  return resolveWorkspaces(env, cwd).map((workspace) => collectorArgs(collector, env, workspace));
}

export function listLocalDashboardProjects(
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
): DashboardProject[] {
  return resolveWorkspaces(env, cwd).map((workspace) => workspaceIdentity(workspace));
}

function configuredWorkspaceById(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
  cwd = process.cwd(),
) {
  const workspace = resolveWorkspaces(env, cwd)
    .find((candidate) => workspaceIdentity(candidate).id === id);
  if (!workspace) throw new Error("The requested project is not configured for this Dashboard.");
  return workspace;
}

async function collectWorkspaceData(args: string[]) {
  const { stdout } = await execFileAsync(process.execPath, args, {
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: 300_000,
  });
  return JSON.parse(stdout) as DashboardInput;
}

async function collectProject(id: string) {
  const collector = collectorPath();
  const workspace = configuredWorkspaceById(id);
  return collectWorkspaceData(collectorArgs(collector, process.env, workspace));
}

const dashboardCache = createKeyedTimedCache<string, DashboardInput>({
  load: collectProject,
  ttlMs: () => refreshMs(),
});

export function loadLocalDashboardProject(id: string) {
  configuredWorkspaceById(id);
  return dashboardCache.read(id);
}

export async function loadLocalDashboardProjectSnapshot(id: string): Promise<DashboardProjectSnapshot> {
  const project = listLocalDashboardProjects().find((candidate) => candidate.id === id);
  if (!project) throw new Error("The requested project is not configured for this Dashboard.");
  try {
    return { project, status: "ready", input: await loadLocalDashboardProject(id) };
  } catch {
    return {
      project,
      status: "failed",
      message: "Project collection failed. Retry this project or inspect the server log.",
    };
  }
}

export function clearLocalDashboardCache() {
  dashboardCache.clear();
}
