import { existsSync } from "node:fs";
import path from "node:path";

const PACKAGE_MARKER = path.join("packages", "harness-ui", "package.json");

/**
 * The Dashboard reads one workspace. `BETTER_HARNESS_WORKSPACE` selects it;
 * otherwise the repository that contains this package is used, which keeps the
 * server route, the collector, and the CLI pointed at the same evidence. The
 * working directory is probed instead of `import.meta.url` so the resolution
 * survives bundling into the Next.js server build.
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
