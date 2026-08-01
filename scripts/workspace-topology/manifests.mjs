import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

import { normalizeRoute, routeContains } from "./contract.mjs";

const PACKAGE_MARKERS = new Set(["package.json", "go.mod", "Cargo.toml"]);
const CONTAINER_ROOTS = new Set([
  "apps",
  "extensions",
  "native",
  "packages",
  "plugins",
  "services",
]);

function warning(code, route = undefined) {
  return Object.freeze({ code, ...(route ? { route } : {}) });
}

function dirnameRoute(route) {
  const value = path.posix.dirname(route);
  return value === "." ? "." : normalizeRoute(value);
}

function joinRoute(base, value) {
  const normalized = String(value ?? "").replaceAll("\\", "/").replace(/^\.\/+/u, "");
  return normalizeRoute(base === "." ? normalized : `${base}/${normalized}`);
}

function globToRegExp(pattern) {
  const normalized = normalizeRoute(pattern, "workspace pattern");
  let source = "";
  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index];
    const next = normalized[index + 1];
    if (char === "*" && next === "*") {
      source += ".*";
      index += 1;
    } else if (char === "*") {
      source += "[^/]*";
    } else if (char === "?") {
      source += "[^/]";
    } else {
      source += char.replace(/[|\\{}()[\]^$+?.]/gu, "\\$&");
    }
  }
  return new RegExp(`^${source}$`, "u");
}

function packageWorkspacePatterns(value) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object" && Array.isArray(value.packages)) return value.packages;
  return [];
}

function parsePnpmPackages(text) {
  const patterns = [];
  let inPackages = false;
  for (const rawLine of String(text).split(/\r?\n/u)) {
    const line = rawLine.replace(/\s+#.*$/u, "");
    if (/^packages\s*:\s*$/u.test(line.trim())) {
      inPackages = true;
      continue;
    }
    if (inPackages && /^\S/u.test(line) && !/^-/u.test(line.trim())) break;
    const match = inPackages ? line.match(/^\s*-\s*["']?([^"']+?)["']?\s*$/u) : null;
    if (match) patterns.push(match[1].trim());
  }
  return patterns;
}

function parseGoWorkUses(text) {
  const withoutComments = String(text).replace(/\/\/.*$/gmu, "");
  const patterns = [];
  const block = withoutComments.match(/\buse\s*\(([\s\S]*?)\)/u);
  if (block) {
    for (const line of block[1].split(/\r?\n/u)) {
      const value = line.trim().split(/\s+/u)[0];
      if (value) patterns.push(value);
    }
  }
  for (const match of withoutComments.matchAll(/^\s*use\s+([^\s(][^\s]*)/gmu)) {
    patterns.push(match[1]);
  }
  return patterns;
}

function parseCargoWorkspace(text) {
  const section = [];
  let inWorkspace = false;
  for (const line of String(text).split(/\r?\n/u)) {
    if (/^\s*\[workspace\]\s*$/u.test(line)) {
      inWorkspace = true;
      continue;
    }
    if (inWorkspace && /^\s*\[[^\]]+\]\s*$/u.test(line)) break;
    if (inWorkspace) section.push(line);
  }
  const workspace = section.join("\n");
  const quotedArray = (name) => {
    const body = workspace.match(new RegExp(`\\b${name}\\s*=\\s*\\[([\\s\\S]*?)\\]`, "u"))?.[1] ?? "";
    return [...body.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
  };
  return { include: quotedArray("members"), exclude: quotedArray("exclude") };
}

function patternMatches(pattern, route) {
  try {
    return globToRegExp(pattern).test(route);
  } catch {
    return false;
  }
}

function containedPatterns(patterns, manifestDir, manifestRoute, warnings) {
  const contained = [];
  for (const pattern of patterns) {
    try {
      contained.push(joinRoute(manifestDir, pattern));
    } catch {
      warnings.push(warning("workspace-pattern-outside-root", manifestRoute));
    }
  }
  return contained;
}

function markerDirectories(items, marker) {
  return items
    .filter((item) => path.posix.basename(item.route) === marker)
    .map((item) => dirnameRoute(item.route));
}

function addMember(map, route, kind, discoveredBy, manifestRoute = null) {
  if (route === ".") return;
  const current = map.get(route);
  const nextKind = current?.kind === "manifest" || kind === "manifest" ? "manifest" : "convention";
  map.set(route, {
    route,
    kind: nextKind,
    discoveredBy: [...new Set([...(current?.discoveredBy ?? []), discoveredBy])].sort(),
    manifestRoute: current?.manifestRoute ?? manifestRoute,
  });
}

function isWithinRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === ""
    || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function isInstructionRoute(route) {
  const base = path.posix.basename(route);
  const extension = path.posix.extname(route).toLowerCase();
  return base === "AGENTS.md"
    || base === "CLAUDE.md"
    || base === "CLAUDE.local.md"
    || base === "QWEN.md"
    || route === ".github/copilot-instructions.md"
    || (route.startsWith(".github/instructions/") && route.endsWith(".instructions.md"))
    || ((route.includes("/.claude/rules/") || route.startsWith(".claude/rules/"))
      && new Set([".md", ".mdc"]).has(extension))
    || ((route.includes("/.cursor/rules/") || route.startsWith(".cursor/rules/"))
      && new Set([".md", ".mdc"]).has(extension))
    || ((route.includes("/.qoder/rules/") || route.startsWith(".qoder/rules/"))
      && new Set([".md", ".mdc"]).has(extension));
}

async function safeStructureItems(root, items, warnings) {
  const canonicalRoot = await realpath(root);
  const trackedRoutes = new Set(
    items.filter((item) => item.provenance === "tracked").map((item) => item.route),
  );
  const safe = [];
  for (const item of items) {
    const absolute = path.resolve(root, ...item.route.split("/"));
    try {
      const canonical = await realpath(absolute);
      const metadata = await lstat(canonical);
      const canonicalRoute = path.relative(canonicalRoot, canonical).split(path.sep).join("/");
      const safeRedirect = canonicalRoute === item.route
        || (
          item.provenance === "tracked"
          && trackedRoutes.has(canonicalRoute)
          && isInstructionRoute(item.route)
          && isInstructionRoute(canonicalRoute)
          && dirnameRoute(item.route) === dirnameRoute(canonicalRoute)
        );
      if (!metadata.isFile() || !isWithinRoot(canonicalRoot, canonical) || !safeRedirect) {
        warnings.push(warning("structure-entry-unsafe", item.route));
        continue;
      }
      safe.push({ ...item, canonical });
    } catch {
      warnings.push(warning("structure-entry-unavailable", item.route));
    }
  }
  return safe;
}

async function readInventoryFile(root, item, warnings) {
  try {
    return await readFile(item.canonical, "utf8");
  } catch {
    warnings.push(warning("manifest-read-unavailable", item.route));
    return null;
  }
}

function candidateConventionRoute(instructionRoute, manifestParents) {
  const owner = dirnameRoute(instructionRoute);
  if (manifestParents.has(owner)) return owner;
  const parts = owner === "." ? [] : owner.split("/");
  if (CONTAINER_ROOTS.has(parts[0]) && parts.length >= 2) {
    return `${parts[0]}/${parts[1]}`;
  }
  if (parts[0] === "src" && parts[1] === "product") return "src/product";
  if (parts[0] === "cli") return "cli";
  return null;
}

function scopeActivation(provider, ownerRoute, targetRoute) {
  const appliesToTarget = routeContains(ownerRoute, targetRoute);
  if (new Set(["codex", "claude", "qwen", "copilot", "pi"]).has(provider)) {
    return appliesToTarget ? "effective" : "candidate";
  }
  if (provider === "qoder") return ownerRoute === "." ? "effective" : "candidate";
  return "candidate";
}

export async function discoverWorkspaceStructure({
  root,
  items,
  targetRoute,
}) {
  const members = new Map();
  const warnings = [];
  const structureItems = await safeStructureItems(root, items, warnings);
  const manifestParents = new Set();
  const blockedConventionPatterns = [];
  const manifestItems = structureItems.filter((item) => new Set([
    "package.json",
    "pnpm-workspace.yaml",
    "go.work",
    "Cargo.toml",
  ]).has(path.posix.basename(item.route)));

  for (const item of manifestItems) {
    const base = path.posix.basename(item.route);
    const manifestDir = dirnameRoute(item.route);
    const text = await readInventoryFile(root, item, warnings);
    if (text === null) continue;

    let patterns = [];
    let exclusions = [];
    let marker = null;
    let source = null;
    try {
      if (base === "package.json") {
        const parsed = JSON.parse(text);
        patterns = packageWorkspacePatterns(parsed.workspaces);
        marker = "package.json";
        source = `${item.route}#workspaces`;
        manifestParents.add(manifestDir);
      } else if (base === "pnpm-workspace.yaml") {
        patterns = parsePnpmPackages(text);
        marker = "package.json";
        source = item.route;
      } else if (base === "go.work") {
        patterns = parseGoWorkUses(text);
        marker = "go.mod";
        source = item.route;
      } else if (base === "Cargo.toml") {
        const parsed = parseCargoWorkspace(text);
        patterns = parsed.include;
        exclusions = parsed.exclude;
        marker = "Cargo.toml";
        source = `${item.route}#[workspace]`;
        manifestParents.add(manifestDir);
      }
    } catch {
      warnings.push(warning("manifest-parse-unavailable", item.route));
      continue;
    }

    if (!source || patterns.length === 0) continue;
    const directories = markerDirectories(structureItems, marker);
    const includes = containedPatterns(
      patterns.filter((pattern) => !String(pattern).trim().startsWith("!")),
      manifestDir,
      item.route,
      warnings,
    );
    const excludes = containedPatterns([
      ...exclusions,
      ...patterns
        .filter((pattern) => String(pattern).trim().startsWith("!"))
        .map((pattern) => String(pattern).trim().slice(1)),
    ], manifestDir, item.route, warnings);
    blockedConventionPatterns.push(...excludes);
    for (const directory of directories) {
      if (!includes.some((pattern) => patternMatches(pattern, directory))) continue;
      if (excludes.some((pattern) => patternMatches(pattern, directory))) continue;
      addMember(members, directory, "manifest", source, item.route);
    }
  }

  const packageMarkerParents = new Set(
    structureItems
      .filter((item) => PACKAGE_MARKERS.has(path.posix.basename(item.route)))
      .map((item) => dirnameRoute(item.route))
      .filter((route) => route !== "."),
  );
  for (const route of packageMarkerParents) {
    if (blockedConventionPatterns.some((pattern) => patternMatches(pattern, route))) continue;
    const covered = [...members.values()].some((member) => routeContains(member.route, route));
    if (!covered) addMember(members, route, "convention", "nested-package-manifest");
  }

  const instructionScopes = [];
  const instructionItems = structureItems.filter((item) => isInstructionRoute(item.route));

  for (const item of instructionItems) {
    const base = path.posix.basename(item.route);
    let ownerRoute = dirnameRoute(item.route);
    const rows = [];
    if (base === "AGENTS.md") {
      rows.push(
        ["codex", ownerRoute],
        ["qoder", ownerRoute],
        ["cursor", ownerRoute],
        ["qwen", ownerRoute],
        ["copilot", ownerRoute],
        ["pi", ownerRoute],
      );
    } else if (base === "CLAUDE.md" || base === "CLAUDE.local.md") {
      if (item.route === ".claude/CLAUDE.md") ownerRoute = ".";
      rows.push(["claude", ownerRoute]);
    } else if (base === "QWEN.md") {
      rows.push(["qwen", ownerRoute]);
    } else if (item.route === ".github/copilot-instructions.md") {
      ownerRoute = ".";
      rows.push(["cursor", ownerRoute], ["copilot", ownerRoute]);
    } else if (item.route.startsWith(".github/instructions/") && item.route.endsWith(".instructions.md")) {
      ownerRoute = ".";
      rows.push(["copilot", ownerRoute]);
    } else if (item.route.includes("/.claude/rules/") || item.route.startsWith(".claude/rules/")) {
      ownerRoute = normalizeRoute(item.route.split("/.claude/rules/")[0] || ".");
      rows.push(["claude", ownerRoute]);
    } else if (item.route.includes("/.cursor/rules/") || item.route.startsWith(".cursor/rules/")) {
      ownerRoute = normalizeRoute(item.route.split("/.cursor/rules/")[0] || ".");
      rows.push(["cursor", ownerRoute]);
    } else if (item.route.includes("/.qoder/rules/") || item.route.startsWith(".qoder/rules/")) {
      ownerRoute = normalizeRoute(item.route.split("/.qoder/rules/")[0] || ".");
      rows.push(["qoder", ownerRoute]);
    }
    for (const [provider, scopeRoute] of rows) {
      instructionScopes.push({
        route: item.route,
        provider,
        activation: provider === "cursor" && item.route === ".github/copilot-instructions.md"
          ? "candidate"
          : item.route.startsWith(".github/instructions/")
          ? "candidate"
          : scopeActivation(provider, scopeRoute, targetRoute),
      });
    }

    if (base === "AGENTS.md" || base === "CLAUDE.md" || base === "QWEN.md") {
      const conventionRoute = candidateConventionRoute(item.route, packageMarkerParents);
      if (conventionRoute) {
        const covered = [...members.values()].some((member) => routeContains(member.route, conventionRoute));
        if (!covered) addMember(members, conventionRoute, "convention", "nested-instruction-scope");
      }
    }
  }

  return {
    members: [...members.values()].sort((left, right) => left.route.localeCompare(right.route)),
    instructionScopes: instructionScopes.sort((left, right) =>
      left.route.localeCompare(right.route) || left.provider.localeCompare(right.provider)),
    warnings,
  };
}
