import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";

const PACKAGE_MARKER = path.join("packages", "harness-ui", "package.json");

/**
 * Resolve the singular Dashboard workspace. `BETTER_HARNESS_WORKSPACE` selects
 * it; otherwise the repository that contains this package is used, which keeps
 * the upload route and one-project collector pointed at the same evidence. The
 * working directory is probed instead of `import.meta.url` so the resolution
 * survives bundling into the Next.js server build. Multi-project page loading
 * composes this fallback through `resolveWorkspaces` below.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {string} [cwd]
 */
export function resolveWorkspace(env = process.env, cwd = process.cwd()) {
  if (env.BETTER_HARNESS_WORKSPACE) return path.resolve(env.BETTER_HARNESS_WORKSPACE);
  const current = path.resolve(cwd);
  if (existsSync(path.join(current, PACKAGE_MARKER))) return current;
  const fromPackageDirectory = path.resolve(current, "..", "..");
  if (existsSync(path.join(fromPackageDirectory, PACKAGE_MARKER))) return fromPackageDirectory;
  return current;
}

export function splitWorkspaceList(value, delimiter = path.delimiter) {
  return String(value ?? "")
    .split(delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Resolve only explicitly configured projects. The platform path-list
 * delimiter keeps Windows drive letters intact while still allowing a compact
 * environment variable on macOS and Linux.
 */
export function resolveWorkspaces(env = process.env, cwd = process.cwd()) {
  const configured = splitWorkspaceList(env.BETTER_HARNESS_WORKSPACES);
  const candidates = configured.length > 0 ? configured : [resolveWorkspace(env, cwd)];
  const seen = new Set();
  return candidates
    .map((workspace) => path.resolve(workspace))
    .filter((workspace) => {
      const key = process.platform === "win32" ? path.normalize(workspace).toLowerCase() : path.normalize(workspace);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

/**
 * A local-only identity: stable for this normalized checkout path without
 * sending that path to the Dashboard client or a stored upload record.
 */
export function workspaceIdentity(workspace) {
  const resolved = path.resolve(workspace);
  const identityBasis = process.platform === "win32" ? path.normalize(resolved).toLowerCase() : path.normalize(resolved);
  const digest = createHash("sha256").update(identityBasis).digest("hex").slice(0, 16);
  return {
    id: `local-workspace:${digest}`,
    label: path.basename(resolved) || "workspace",
  };
}
