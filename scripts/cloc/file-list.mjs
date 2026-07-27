import { spawnSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import path from "node:path";

import { toPosix } from "./languages.generated.mjs";

const GIT_MAX_BUFFER_BYTES = 256 * 1024 * 1024;
const WALKER_SKIP_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
  ".next",
  ".qoder",
  ".turbo",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "vendor",
]);

function git(cwd, args, { allowFailure = false } = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER_BYTES,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.status !== 0) {
    if (allowFailure) {
      return "";
    }
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.trim()}`);
  }
  return result.stdout;
}

export function resolveGitRoot(cwd) {
  const root = git(cwd, ["rev-parse", "--show-toplevel"], { allowFailure: true }).trim();
  return root ? realpathSync(path.resolve(root)) : null;
}

export function listGitFiles(repoRoot, { scope = "", trackedOnly = false } = {}) {
  const args = trackedOnly
    ? ["ls-files", "-z", "--cached"]
    : ["ls-files", "-z", "--cached", "--others", "--exclude-standard"];
  if (scope) {
    args.push("--", scope);
  }
  return git(repoRoot, args, { allowFailure: true })
    .split("\0")
    .filter(Boolean)
    .map(toPosix)
    .sort((a, b) => a.localeCompare(b));
}

function walkDirectory(root, directory, files) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!WALKER_SKIP_DIRS.has(entry.name)) {
        walkDirectory(root, path.join(directory, entry.name), files);
      }
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    files.push(toPosix(path.relative(root, path.join(directory, entry.name))));
  }
}

export function listWalkedFiles(root) {
  const files = [];
  walkDirectory(root, root, files);
  return files.sort((a, b) => a.localeCompare(b));
}

export function listInputFiles({ cwd = process.cwd(), paths = [], useGit = true, trackedOnly = false } = {}) {
  const resolvedCwd = realpathSync(path.resolve(cwd));
  const repoRoot = useGit ? resolveGitRoot(resolvedCwd) : null;

  if (paths.length > 0) {
    const root = repoRoot ?? resolvedCwd;
    return {
      root,
      strategy: "paths",
      files: paths.map((item) => toPosix(path.relative(root, path.resolve(resolvedCwd, item)))).sort((a, b) => a.localeCompare(b)),
    };
  }

  if (repoRoot) {
    const relativeScope = toPosix(path.relative(repoRoot, resolvedCwd));
    const scope = relativeScope && !relativeScope.startsWith("..") ? relativeScope : "";
    return {
      root: repoRoot,
      strategy: trackedOnly ? "git-tracked" : "git",
      files: listGitFiles(repoRoot, { scope, trackedOnly }),
    };
  }

  return {
    root: resolvedCwd,
    strategy: "walker",
    files: listWalkedFiles(resolvedCwd),
  };
}
