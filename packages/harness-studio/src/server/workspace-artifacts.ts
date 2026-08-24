import { lstat, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";

import type { DebuggerSession } from "../app/session-debugger-model.js";

export interface WorkspaceArtifactSession {
  summary: {
    id: string;
    savedAt: string;
    prompt: string;
    provider?: string;
  };
  debugger: DebuggerSession;
}

export interface WorkspaceArtifactSourceObservation {
  relativePath: string;
  sessionId: string;
  savedAt: string;
  prompt: string;
  provider?: string;
}

/**
 * Resolve retained change resources back to current, regular workspace files.
 * Session paths are evidence leads only: the filesystem boundary is rechecked
 * here before any path becomes part of the Artifact authority.
 */
export async function collectWorkspaceArtifactObservations(
  workspacePath: string,
  sessions: readonly WorkspaceArtifactSession[],
): Promise<WorkspaceArtifactSourceObservation[]> {
  const root = await realpath(resolve(workspacePath));
  const observations = new Map<string, WorkspaceArtifactSourceObservation>();

  for (const session of sessions) {
    for (const event of session.debugger.events) {
      if (event.kind !== "change") continue;
      for (const call of event.toolCalls ?? []) {
        if (typeof call.resource !== "string") continue;
        const relativePath = await confinedRegularFile(root, call.resource);
        if (relativePath === undefined || relativePath === ".git" || relativePath.startsWith(".git/")) continue;
        const key = `${session.summary.id}\u0000${relativePath}`;
        if (observations.has(key)) continue;
        observations.set(key, {
          relativePath,
          sessionId: session.summary.id,
          savedAt: session.summary.savedAt,
          prompt: session.summary.prompt,
          ...(session.summary.provider === undefined ? {} : { provider: session.summary.provider }),
        });
      }
    }
  }

  return [...observations.values()].sort((left, right) =>
    right.savedAt.localeCompare(left.savedAt) || left.relativePath.localeCompare(right.relativePath));
}

async function confinedRegularFile(root: string, resource: string): Promise<string | undefined> {
  if (resource.trim() === "" || resource.includes("\u0000")) return undefined;
  const candidate = resolve(root, resource);
  if (isAbsolute(resource) && !withinRoot(root, candidate)) return undefined;
  if (!withinRoot(root, candidate)) return undefined;
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) return undefined;
    const physical = await realpath(candidate);
    if (!withinRoot(root, physical)) return undefined;
    const path = relative(root, candidate);
    if (path === "" || path === ".." || path.startsWith(`..${sep}`) || isAbsolute(path)) return undefined;
    return path.split(sep).join("/");
  } catch {
    return undefined;
  }
}

function withinRoot(root: string, target: string): boolean {
  return target === root || target.startsWith(root + sep);
}
