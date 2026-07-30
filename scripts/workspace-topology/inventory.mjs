import { spawn, spawnSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { normalizeRoute } from "./contract.mjs";

const GIT_MAX_BUFFER_BYTES = 128 * 1024 * 1024;
const STRUCTURAL_FILE_LIMIT = 100_000;
const STATIC_EXCLUDED_DIRS = new Set([
  ".build",
  ".cache",
  ".git",
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

function git(cwd, args) {
  return spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: GIT_MAX_BUFFER_BYTES,
  });
}

function warning(code) {
  return Object.freeze({ code });
}

function isStructuralRoute(route) {
  const base = path.posix.basename(route);
  return new Set([
    "AGENTS.md",
    "CLAUDE.md",
    "CLAUDE.local.md",
    "QWEN.md",
    "Cargo.toml",
    "go.mod",
    "go.work",
    "package.json",
    "pnpm-workspace.yaml",
  ]).has(base)
    || route === ".github/copilot-instructions.md"
    || (route.startsWith(".github/instructions/") && route.endsWith(".instructions.md"))
    || route.includes("/.claude/rules/")
    || route.startsWith(".claude/rules/")
    || route.includes("/.cursor/rules/")
    || route.startsWith(".cursor/rules/")
    || route.includes("/.qoder/rules/")
    || route.startsWith(".qoder/rules/");
}

const STRUCTURAL_PATHSPECS = Object.freeze([
  "AGENTS.md", "CLAUDE.md", "CLAUDE.local.md", "QWEN.md", "Cargo.toml", "go.mod", "go.work",
  "package.json", "pnpm-workspace.yaml", ".github/copilot-instructions.md",
  ":(top,glob)**/AGENTS.md", ":(top,glob)**/CLAUDE.md", ":(top,glob)**/CLAUDE.local.md",
  ":(top,glob)**/QWEN.md", ":(top,glob).github/instructions/**/*.instructions.md",
  ":(top,glob)**/Cargo.toml", ":(top,glob)**/go.mod", ":(top,glob)**/go.work",
  ":(top,glob)**/package.json", ":(top,glob)**/pnpm-workspace.yaml",
  ":(top,glob)**/.claude/rules/**", ":(top,glob)**/.cursor/rules/**",
  ":(top,glob)**/.qoder/rules/**",
]);

function boundedGitNullList(cwd, args, limit) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    const items = [];
    let pending = "";
    let stderr = "";
    let stopped = false;
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      if (stderr.length < 8_192) stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      if (stopped) return;
      pending += chunk;
      let separator;
      while ((separator = pending.indexOf("\0")) !== -1) {
        const raw = pending.slice(0, separator);
        pending = pending.slice(separator + 1);
        if (raw) items.push(normalizeRoute(raw));
        if (items.length > limit) {
          stopped = true;
          child.kill();
          break;
        }
      }
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (!stopped && code !== 0) {
        reject(Object.assign(new Error(`git ${args.join(" ")} failed: ${stderr.trim()}`), {
          code: "GIT_INVENTORY_FAILED",
        }));
        return;
      }
      const truncated = items.length > limit;
      resolve({
        items: items.slice(0, limit),
        observed: items.length,
        truncated,
      });
    });
  });
}

export function resolveGitRoot(workspace) {
  const result = git(workspace, ["rev-parse", "--show-toplevel"]);
  if (result.error?.code === "ENOENT") {
    return {
      gitRoot: null,
      gitAvailable: false,
      warning: warning("git-unavailable"),
    };
  }
  if (result.status !== 0) {
    return { gitRoot: null, gitAvailable: true, warning: null };
  }
  const candidate = String(result.stdout ?? "").trim();
  try {
    return { gitRoot: realpathSync(candidate), gitAvailable: true, warning: null };
  } catch {
    return {
      gitRoot: path.resolve(candidate),
      gitAvailable: true,
      warning: warning("git-root-realpath-unavailable"),
    };
  }
}

function excludedFallbackDirectory(name) {
  return STATIC_EXCLUDED_DIRS.has(name) || /^out(?:-|$)/u.test(name);
}

async function filesystemItems(root, maxFiles) {
  const items = [];
  const discoveryItems = [];
  let observed = 0;
  let visitedEntries = 0;
  let traversalTruncated = false;
  let structureTruncated = false;
  const maxVisitedEntries = maxFiles + STRUCTURAL_FILE_LIMIT;

  async function walk(absolute, relative = "") {
    if (traversalTruncated) return;
    let entries;
    try {
      entries = await readdir(absolute, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      visitedEntries += 1;
      if (visitedEntries > maxVisitedEntries) {
        traversalTruncated = true;
        return;
      }
      const route = normalizeRoute(relative ? `${relative}/${entry.name}` : entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (!excludedFallbackDirectory(entry.name)) {
          await walk(path.join(absolute, entry.name), route);
        }
      } else if (entry.isFile()) {
        if (observed <= maxFiles) items.push({ route, provenance: "filesystem" });
        observed += 1;
        if (isStructuralRoute(route)) {
          if (discoveryItems.length < STRUCTURAL_FILE_LIMIT) {
            discoveryItems.push({ route, provenance: "filesystem" });
          } else {
            structureTruncated = true;
          }
        }
      }
    }
  }

  await walk(root);
  return {
    items,
    discoveryItems,
    observed,
    traversalTruncated,
    structureTruncated,
  };
}

function boundedInventory(items, {
  maxFiles,
  discoveryItems = [],
  tracked,
  untracked,
  inventoryMode,
  ignoreMode,
  warnings = [],
}) {
  const stable = [...items].sort((left, right) => left.route.localeCompare(right.route));
  const retained = stable.slice(0, maxFiles);
  const uniqueDiscovery = [...new Map(discoveryItems.map((item) => [item.route, item])).values()]
    .sort((left, right) => left.route.localeCompare(right.route));
  const omitted = Math.max(0, tracked + untracked - retained.length);
  return {
    items: retained.map((item) => Object.freeze({ ...item })),
    discoveryItems: uniqueDiscovery.map((item) => Object.freeze({ ...item })),
    coverage: {
      inventoryMode,
      ignoreMode,
      tracked,
      untracked,
      scanned: retained.length,
      omitted,
      truncated: omitted > 0,
      warnings: [
        ...warnings,
        ...(omitted > 0 ? [warning("inventory-truncated")] : []),
      ],
    },
  };
}

export async function collectWorkspaceInventory({
  root,
  gitRoot,
  gitAvailable = true,
  maxFiles,
  initialWarnings = [],
}) {
  if (gitRoot) {
    try {
      const [trackedResult, untrackedResult, trackedStructure, untrackedStructure] = await Promise.all([
        boundedGitNullList(gitRoot, ["ls-files", "-z", "--cached"], maxFiles + 1),
        boundedGitNullList(gitRoot, ["ls-files", "-z", "--others", "--exclude-standard"], maxFiles + 1),
        boundedGitNullList(gitRoot, ["ls-files", "-z", "--cached", "--", ...STRUCTURAL_PATHSPECS], STRUCTURAL_FILE_LIMIT),
        boundedGitNullList(gitRoot, ["ls-files", "-z", "--others", "--exclude-standard", "--", ...STRUCTURAL_PATHSPECS], STRUCTURAL_FILE_LIMIT),
      ]);
      const byRoute = new Map();
      for (const route of untrackedResult.items) byRoute.set(route, { route, provenance: "untracked" });
      for (const route of trackedResult.items) byRoute.set(route, { route, provenance: "tracked" });
      const structureByRoute = new Map();
      for (const route of untrackedStructure.items) structureByRoute.set(route, { route, provenance: "untracked" });
      for (const route of trackedStructure.items) structureByRoute.set(route, { route, provenance: "tracked" });
      const countIsLowerBound = trackedResult.truncated || untrackedResult.truncated;
      const structureTruncated = trackedStructure.truncated || untrackedStructure.truncated;
      return boundedInventory([...byRoute.values()], {
        maxFiles,
        discoveryItems: [...structureByRoute.values()],
        tracked: trackedResult.observed,
        untracked: untrackedResult.observed,
        inventoryMode: "git",
        ignoreMode: "git-index",
        warnings: [
          ...initialWarnings,
          ...(countIsLowerBound ? [warning("inventory-count-lower-bound")] : []),
          ...(structureTruncated ? [warning("structural-inventory-truncated")] : []),
        ],
      });
    } catch {
      initialWarnings = [...initialWarnings, warning("git-inventory-unavailable")];
    }
  } else if (!gitAvailable) {
    initialWarnings = [...initialWarnings, warning("git-inventory-unavailable")];
  }

  const fallback = await filesystemItems(root, maxFiles);
  const lowerBound = fallback.observed > maxFiles + 1 || fallback.traversalTruncated;
  return boundedInventory(fallback.items, {
    maxFiles,
    discoveryItems: fallback.discoveryItems,
    tracked: 0,
    untracked: Math.min(fallback.observed, maxFiles + 1),
    inventoryMode: "filesystem-fallback",
    ignoreMode: "static",
    warnings: [
      ...initialWarnings,
      ...(lowerBound ? [warning("inventory-count-lower-bound")] : []),
      ...(fallback.traversalTruncated ? [warning("filesystem-discovery-truncated")] : []),
      ...(fallback.structureTruncated ? [warning("structural-inventory-truncated")] : []),
    ],
  });
}

export async function assertWorkspaceDirectory(workspace) {
  let info;
  try {
    info = await stat(workspace);
  } catch {
    throw Object.assign(new Error(`workspace does not exist: ${workspace}`), {
      code: "WORKSPACE_NOT_FOUND",
    });
  }
  if (!info.isDirectory()) {
    throw Object.assign(new Error(`workspace must be a directory: ${workspace}`), {
      code: "WORKSPACE_NOT_DIRECTORY",
    });
  }
}
