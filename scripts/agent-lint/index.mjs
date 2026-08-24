import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { collectAgentCustomizeInventory } from "../agent-customize/index.mjs";
import { parseFrontmatter } from "../agent-customize/core/items.mjs";
import { enrichFindingWithRecommendation } from "../findings-recommend.mjs";
import { isDirectory, normalizeWorkspace, pathExists } from "../session-analysis/index.mjs";
import { ownerRouteForPath, routeContains } from "../workspace-topology/index.mjs";
import { reviewHostInstructions } from "./host-instructions.mjs";
import { reviewHookAssets } from "./hook-review.mjs";

const ROOT_ENTRYPOINTS = [
  { relativePath: "AGENTS.md", sourceKind: "agents-md" },
  { relativePath: "CLAUDE.md", sourceKind: "claude-md" },
  { relativePath: ".claude/CLAUDE.md", sourceKind: "claude-md" },
  { relativePath: "CLAUDE.local.md", sourceKind: "claude-local" },
];
const FIXED_ENTRYPOINTS = [
  { relativePath: ".github/copilot-instructions.md", sourceKind: "copilot-instructions" },
];
const RULE_DIRECTORIES = [
  { relativePath: ".cursor/rules", sourceKind: "cursor-rule", extensions: new Set([".md", ".mdc"]) },
  { relativePath: ".qoder/rules", sourceKind: "qoder-rule", extensions: new Set([".md", ".mdc"]) },
  { relativePath: ".claude/rules", sourceKind: "claude-rule", extensions: new Set([".md", ".mdc"]) },
];
const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown", ".mdc"]);
const DEFAULT_EXCLUDED_DIRS = new Set([
  ".git",
  ".hg",
  ".svn",
  "node_modules",
  "vendor",
  "target",
  "dist",
  "build",
  ".next",
  ".cache",
  "coverage",
]);
const DEFAULT_CHILD_EXCLUDES = new Set(["results", "node_modules", ".git", "vendor", "target", "dist", "build"]);
const MANIFEST_FILES = [
  "package.json",
  "Makefile",
  "pyproject.toml",
  "go.mod",
  "Cargo.toml",
  "composer.json",
  "pom.xml",
  "build.gradle",
  "build.gradle.kts",
  "Gemfile",
];
const VERIFICATION_PATTERN = /\b(npm|pnpm|yarn|bun|make|pytest|ruff|eslint|prettier|biome|go test|cargo test|cargo build|composer|phpunit|mvn|gradle|go vet|go build|test|tests|lint|typecheck|build)\b/iu;
const RISK_PATTERN = /\b(secret|credential|production|prod|migration|destructive|delete|generated|do not|never|avoid|forbid|forbidden|approval|permission)\b/iu;
const PROJECT_FACT_PATTERN = /\b(package manager|runtime|version|node|python|go|php|java|ruby|architecture|structure|workspace|monorepo|service|app)\b/iu;
const DECISION_RULE_PATTERN = /\b(ask|plan|review|before|after|do not touch|must|should|prefer|avoid|when|never)\b/iu;
const PROFILE_AGENTS_MD_REVIEW = "agents-md-review";
const PROFILE_AGENT_ASSETS_REVIEW = "agent-assets-review";

function splitLogicalLines(text) {
  const lines = text.split(/\r\n|\n|\r/u);
  if (text.endsWith("\n") || text.endsWith("\r")) {
    return lines.slice(0, -1);
  }
  return lines;
}

function normalizeSlash(value) {
  return value.split(path.sep).join("/");
}

function uniqueByPath(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    if (seen.has(item.path)) {
      continue;
    }
    seen.add(item.path);
    result.push(item);
  }
  return result;
}

function stripOptionalAngles(destination) {
  if (destination.startsWith("<") && destination.endsWith(">")) {
    return destination.slice(1, -1);
  }
  return destination;
}

function parseLinkDestination(rawDestination) {
  const trimmed = rawDestination.trim();
  if (trimmed.startsWith("<")) {
    const closeIndex = trimmed.indexOf(">");
    return closeIndex === -1 ? trimmed : trimmed.slice(0, closeIndex + 1);
  }
  const [destination] = trimmed.split(/\s+/u);
  return destination ?? "";
}

function normalizeReferenceId(value) {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

export function headingAnchor(text) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[`*_~[\]()]/gu, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function parseReferenceDefinition(line, lineNumber) {
  const match = line.match(/^[ \t]{0,3}\[([^\]]+)\]:[ \t]*(.+?)[ \t]*$/u);
  if (!match) {
    return null;
  }
  return {
    id: normalizeReferenceId(match[1]),
    label: match[1],
    destination: stripOptionalAngles(parseLinkDestination(match[2])),
    line: lineNumber,
  };
}

function isEscaped(text, index) {
  let slashCount = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) {
    slashCount += 1;
  }
  return slashCount % 2 === 1;
}

function parseInlineCode(line, lineNumber) {
  const spans = [];
  const pattern = /`([^`\n]+)`/gu;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (isEscaped(line, match.index)) {
      continue;
    }
    spans.push({
      text: match[1],
      line: lineNumber,
      column: match.index + 1,
    });
  }
  return spans;
}

function parseInlineLinks(line, lineNumber) {
  const links = [];
  const pattern = /!?\[([^\]\n]+)\]\(([^)\n]+)\)/gu;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (line[match.index] === "!" || isEscaped(line, match.index)) {
      continue;
    }
    links.push({
      text: match[1],
      destination: stripOptionalAngles(parseLinkDestination(match[2])),
      line: lineNumber,
      column: match.index + 1,
      kind: "inline",
    });
  }
  return links;
}

function linkFallsInsideInlineCode(link, spans) {
  return spans.some((span) => {
    if (span.line !== link.line) return false;
    const codeStart = span.column;
    const codeEnd = span.column + span.text.length + 1;
    return link.column >= codeStart && link.column <= codeEnd;
  });
}

function parseReferenceLinks(line, lineNumber, definitions) {
  const links = [];
  const pattern = /(?<!!)\[([^\]\n]+)\]\[([^\]\n]*)\]/gu;
  let match;
  while ((match = pattern.exec(line)) !== null) {
    if (isEscaped(line, match.index)) {
      continue;
    }
    const referenceId = normalizeReferenceId(match[2] || match[1]);
    const definition = definitions.get(referenceId);
    links.push({
      text: match[1],
      destination: definition?.destination ?? "",
      line: lineNumber,
      column: match.index + 1,
      kind: "reference",
      referenceId,
      definitionLine: definition?.line,
      unresolved: !definition,
    });
  }
  return links;
}

function parseFencedCodeMarker(line) {
  const match = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*([^`]*)$/u);
  if (!match) {
    return null;
  }
  return {
    marker: match[1][0],
    length: match[1].length,
    language: match[2].trim().split(/\s+/u)[0] ?? "",
  };
}

function closesFence(line, fence) {
  const escapedMarker = fence.marker === "`" ? "`" : "~";
  const match = line.match(new RegExp(`^[ \\t]{0,3}${escapedMarker}{${fence.length},}[ \\t]*$`, "u"));
  return Boolean(match);
}

export function parseMarkdownDocument({ path: filePath, relativePath, text }) {
  const lines = splitLogicalLines(text);
  const headings = [];
  const links = [];
  const referenceDefinitions = [];
  const inlineCode = [];
  const codeFences = [];
  const definitions = new Map();
  let openFence = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;

    if (openFence) {
      if (closesFence(line, openFence)) {
        codeFences.push({
          language: openFence.language,
          startLine: openFence.startLine,
          endLine: lineNumber,
        });
        openFence = null;
      }
      continue;
    }

    const fence = parseFencedCodeMarker(line);
    if (fence) {
      openFence = { ...fence, startLine: lineNumber };
      continue;
    }

    const definition = parseReferenceDefinition(line, lineNumber);
    if (definition) {
      definitions.set(definition.id, definition);
      referenceDefinitions.push(definition);
      continue;
    }

    const heading = line.match(/^(#{1,6})[ \t]+(.+?)[ \t#]*$/u);
    if (heading) {
      headings.push({
        depth: heading[1].length,
        text: heading[2].trim(),
        line: lineNumber,
        anchor: headingAnchor(heading[2]),
      });
    }

    const lineInlineCode = parseInlineCode(line, lineNumber);
    inlineCode.push(...lineInlineCode);
    links.push(...parseInlineLinks(line, lineNumber)
      .filter((link) => !linkFallsInsideInlineCode(link, lineInlineCode)));
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    if (codeFences.some((fence) => lineNumber >= fence.startLine && lineNumber <= fence.endLine)) {
      continue;
    }
    if (parseReferenceDefinition(line, lineNumber)) {
      continue;
    }
    links.push(...parseReferenceLinks(line, lineNumber, definitions)
      .filter((link) => !linkFallsInsideInlineCode(link, inlineCode)));
  }

  links.sort((left, right) => left.line - right.line || left.column - right.column);

  return {
    path: filePath,
    relativePath,
    lineCount: lines.length,
    byteCount: Buffer.byteLength(text, "utf8"),
    headings,
    links,
    referenceDefinitions,
    inlineCode,
    codeFences,
  };
}

function isExternalDestination(destination) {
  return /^[a-z][a-z0-9+.-]*:/iu.test(destination) || destination.startsWith("//");
}

function splitDestination(destination) {
  const hashIndex = destination.indexOf("#");
  if (hashIndex === -1) {
    return { filePart: destination, anchor: undefined };
  }
  return {
    filePart: destination.slice(0, hashIndex),
    anchor: destination.slice(hashIndex + 1) || undefined,
  };
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isInsideWorkspace(workspace, filePath) {
  const relative = path.relative(workspace, filePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function resolveReference({ workspace, ownerPath, ownerHeadings, link }) {
  const destination = link.destination;
  if (!destination) {
    return {
      ...link,
      kind: "unsupported",
      exists: null,
    };
  }
  if (destination.startsWith("#")) {
    const anchor = destination.slice(1);
    return {
      ...link,
      kind: "anchor",
      exists: ownerHeadings.some((heading) => heading.anchor === anchor),
      anchor,
      relativePath: normalizeSlash(path.relative(workspace, ownerPath)),
    };
  }
  if (isExternalDestination(destination)) {
    return {
      ...link,
      kind: "external",
      exists: null,
    };
  }

  const { filePart, anchor } = splitDestination(destination);
  const decodedFilePart = safeDecodeURIComponent(filePart);
  const resolvedPath = path.resolve(path.dirname(ownerPath), decodedFilePart);
  if (!isInsideWorkspace(workspace, resolvedPath)) {
    return {
      ...link,
      kind: "unsupported",
      exists: null,
      anchor,
    };
  }

  return {
    ...link,
    kind: "local",
    path: resolvedPath,
    relativePath: normalizeSlash(path.relative(workspace, resolvedPath)),
    exists: await pathExists(resolvedPath),
    anchor,
  };
}

function isMarkdownPath(filePath) {
  return MARKDOWN_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function parseFile(filePath, workspace, extra = {}) {
  const text = await readFile(filePath, "utf8");
  return {
    ...parseMarkdownDocument({
      path: filePath,
      relativePath: normalizeSlash(path.relative(workspace, filePath)),
      text,
    }),
    ...extra,
  };
}

async function listFiles(rootPath, options = {}) {
  const files = [];
  const maxDepth = options.maxDepth ?? Infinity;

  async function visit(currentPath, depth) {
    if (depth > maxDepth) {
      return;
    }
    let entries;
    try {
      entries = await readdir(currentPath, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile() && (!options.match || options.match(fullPath))) {
        files.push(fullPath);
      }
    }
  }

  if (await isDirectory(rootPath)) {
    await visit(rootPath, 0);
  }
  return files;
}

async function collectRuleEntrypoints(workspace, provider) {
  const entrypoints = [];
  const directories = provider === "qoder"
    ? RULE_DIRECTORIES.filter((item) => item.sourceKind === "qoder-rule")
    : provider === "claude"
      ? RULE_DIRECTORIES.filter((item) => item.sourceKind === "claude-rule")
    : provider
      ? []
      : RULE_DIRECTORIES;
  for (const ruleDirectory of directories) {
    const rootPath = path.join(workspace, ruleDirectory.relativePath);
    const files = await listFiles(rootPath, {
      maxDepth: 4,
      match: (filePath) => ruleDirectory.extensions.has(path.extname(filePath).toLowerCase()),
    });
    entrypoints.push(
      ...files.map((filePath) => ({
        path: filePath,
        relativePath: normalizeSlash(path.relative(workspace, filePath)),
        sourceKind: ruleDirectory.sourceKind,
        nested: false,
      })),
    );
  }
  return entrypoints;
}

async function collectNestedEntrypoints(workspace, maxEntrypointDepth, provider) {
  if (provider === "qoder") return [];
  const activeNames = provider === "claude"
    ? new Set(["CLAUDE.md"])
    : provider === "codex"
      ? new Set(["AGENTS.md"])
      : new Set(["AGENTS.md", "CLAUDE.md"]);
  const files = await listFiles(workspace, {
    maxDepth: maxEntrypointDepth,
    match: (filePath) => activeNames.has(path.basename(filePath)),
  });
  return files
    .filter((filePath) => !ROOT_ENTRYPOINTS.some((entrypoint) => path.join(workspace, entrypoint.relativePath) === filePath))
    .map((filePath) => ({
      path: filePath,
      relativePath: normalizeSlash(path.relative(workspace, filePath)),
      sourceKind: "nested-agent-guide",
      nested: true,
    }));
}

function topologyScopeOwnerRoute(route) {
  if (route === ".claude/CLAUDE.md"
    || route === ".github/copilot-instructions.md"
    || route.startsWith(".github/instructions/")) return ".";
  for (const marker of ["/.claude/rules/", "/.cursor/rules/", "/.qoder/rules/"]) {
    const normalized = `/${route}`;
    const index = normalized.indexOf(marker);
    if (index !== -1) {
      return normalized.slice(1, index) || ".";
    }
  }
  const owner = path.posix.dirname(route);
  return owner === "." ? "." : owner;
}

function topologyScopeSourceKind(route) {
  const base = path.posix.basename(route);
  if (route === ".github/copilot-instructions.md") return "copilot-instructions";
  if (route.startsWith(".github/instructions/") && route.endsWith(".instructions.md")) {
    return "copilot-instructions";
  }
  if (route.includes("/.claude/rules/") || route.startsWith(".claude/rules/")) return "claude-rule";
  if (route.includes("/.cursor/rules/") || route.startsWith(".cursor/rules/")) return "cursor-rule";
  if (route.includes("/.qoder/rules/") || route.startsWith(".qoder/rules/")) return "qoder-rule";
  if (base === "AGENTS.md") return route === "AGENTS.md" ? "agents-md" : "nested-agent-guide";
  if (base === "CLAUDE.md") return route === "CLAUDE.md" ? "claude-md" : "nested-agent-guide";
  if (base === "CLAUDE.local.md") return "claude-local";
  if (base === "QWEN.md") return "qwen-md-context";
  return "nested-agent-guide";
}

function topologyScopeApplies(topology, scope) {
  if (topology.target.route === ".") return true;
  const ownerRoute = topologyScopeOwnerRoute(scope.route);
  return routeContains(ownerRoute, topology.target.route)
    || routeContains(topology.target.route, ownerRoute);
}

async function topologyEntrypoints(topology, provider) {
  const workspace = normalizeWorkspace(topology.gitRoot ?? topology.requestedWorkspace);
  const selected = (topology.instructionScopes?.items ?? [])
    .filter((scope) => !provider || scope.provider === provider)
    .filter((scope) => topologyScopeApplies(topology, scope));
  const grouped = new Map();

  for (const scope of selected) {
    const current = grouped.get(scope.route);
    const providers = [...new Set([...(current?.providers ?? []), scope.provider])].sort();
    grouped.set(scope.route, {
      route: scope.route,
      providers,
      activation: current && (current.activation !== "effective" || scope.activation !== "effective")
        ? "candidate"
        : scope.activation,
    });
  }

  const entrypoints = [];
  for (const scope of [...grouped.values()].sort((left, right) => left.route.localeCompare(right.route))) {
    const filePath = path.join(workspace, ...scope.route.split("/"));
    if (!await pathExists(filePath)) continue;
    const sourceKind = topologyScopeSourceKind(scope.route);
    entrypoints.push({
      path: filePath,
      relativePath: scope.route,
      sourceKind,
      nested: sourceKind === "nested-agent-guide",
      activation: scope.activation,
      packageRoute: ownerRouteForPath(topology, scope.route),
      ...(provider ? { provider } : { providers: scope.providers }),
    });
  }
  return entrypoints;
}

export async function discoverAgentEntrypoints(options = {}) {
  const topology = options.topology;
  const provider = options.provider ? String(options.provider).toLowerCase() : undefined;
  if (topology) return topologyEntrypoints(topology, provider);

  const workspace = normalizeWorkspace(options.workspace);
  const maxEntrypointDepth = Number(options.maxEntrypointDepth ?? options["max-entrypoint-depth"] ?? 4);
  const entrypoints = [];

  const rootDefinitions = provider === "claude"
    ? ROOT_ENTRYPOINTS.filter((item) => item.sourceKind.startsWith("claude-"))
    : provider === "qoder" || provider === "codex"
      ? ROOT_ENTRYPOINTS.filter((item) => item.sourceKind === "agents-md")
      : ROOT_ENTRYPOINTS;
  for (const definition of rootDefinitions) {
    const filePath = path.join(workspace, definition.relativePath);
    if (await pathExists(filePath)) {
      entrypoints.push({
        path: filePath,
        relativePath: definition.relativePath,
        sourceKind: definition.sourceKind,
        nested: false,
      });
    }
  }

  entrypoints.push(...await collectRuleEntrypoints(workspace, provider));

  for (const definition of provider ? [] : FIXED_ENTRYPOINTS) {
    const filePath = path.join(workspace, definition.relativePath);
    if (await pathExists(filePath)) {
      entrypoints.push({
        path: filePath,
        relativePath: definition.relativePath,
        sourceKind: definition.sourceKind,
        nested: false,
      });
    }
  }

  entrypoints.push(...await collectNestedEntrypoints(workspace, maxEntrypointDepth, provider));
  return uniqueByPath(entrypoints);
}

function summarizeEntrypoints(entrypoints) {
  const canonicalAgentsMd = entrypoints.some((entrypoint) => entrypoint.relativePath === "AGENTS.md");
  const nestedInstructionCount = entrypoints.filter((entrypoint) => entrypoint.nested).length;
  const primaryEntrypoint = canonicalAgentsMd
    ? "AGENTS.md"
    : entrypoints.find((entrypoint) => entrypoint.relativePath === "CLAUDE.md")?.relativePath ?? entrypoints[0]?.relativePath;
  return {
    canonicalAgentsMd,
    vendorOnly: !canonicalAgentsMd && entrypoints.length > 0,
    multiEntrypoint: entrypoints.length > 1,
    nestedInstructionCount,
    primaryEntrypoint,
  };
}

export async function collectAgentInstructionGraph(options = {}) {
  const workspace = options.topology
    ? normalizeWorkspace(options.topology.gitRoot ?? options.topology.requestedWorkspace)
    : normalizeWorkspace(options.workspace);
  const maxReferenceDepth = Number(options.maxReferenceDepth ?? options["max-reference-depth"] ?? 0);
  const entrypoints = await discoverAgentEntrypoints({ ...options, workspace });
  const queue = entrypoints.map((entrypoint) => ({ ...entrypoint, filePath: entrypoint.path, depth: 0 }));

  const documents = [];
  const seen = new Set();

  while (queue.length > 0) {
    const current = queue.shift();
    const key = current.filePath;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const parsed = await parseFile(current.filePath, workspace, {
      sourceKind: current.sourceKind,
      entrypoint: current.depth === 0,
      ...(current.activation ? { activation: current.activation } : {}),
      ...(current.packageRoute ? { packageRoute: current.packageRoute } : {}),
      ...(current.provider ? { provider: current.provider } : {}),
      ...(current.providers ? { providers: current.providers } : {}),
    });
    const references = [];
    for (const link of parsed.links) {
      const reference = await resolveReference({
        workspace,
        ownerPath: current.filePath,
        ownerHeadings: parsed.headings,
        link,
      });
      references.push(reference);
      if (
        reference.kind === "local" &&
        reference.exists &&
        current.depth < maxReferenceDepth &&
        isMarkdownPath(reference.path)
      ) {
        queue.push({ filePath: reference.path, depth: current.depth + 1 });
      }
    }

    documents.push({
      ...parsed,
      references,
    });
  }

  documents.sort((left, right) => left.relativePath.localeCompare(right.relativePath));

  return {
    kind: "agent-instruction-graph",
    workspace,
    entrypoints,
    entrypointSummary: summarizeEntrypoints(entrypoints),
    documents,
  };
}

export function summarizeGraph(graph) {
  return {
    entrypoints: graph.entrypoints.length,
    documents: graph.documents.length,
    links: graph.documents.reduce((count, document) => count + document.links.length, 0),
    references: graph.documents.reduce((count, document) => count + document.references.length, 0),
    missingReferences: graph.documents.reduce(
      (count, document) => count + document.references.filter((reference) => reference.exists === false).length,
      0,
    ),
  };
}

function countFindings(findings, severity) {
  return findings.filter((finding) => finding.severity === severity).length;
}

function documentText(document) {
  return [
    ...document.headings.map((heading) => heading.text),
    ...document.inlineCode.map((span) => span.text),
    ...document.links.map((link) => `${link.text} ${link.destination}`),
  ].join("\n");
}

async function readDocumentText(document) {
  try {
    return await readFile(document.path, "utf8");
  } catch {
    return documentText(document);
  }
}

function rootAgentsDocument(graph) {
  return graph.documents.find((document) => document.relativePath === "AGENTS.md");
}

function withAgentsMdRecommendation(finding) {
  const enriched = enrichFindingWithRecommendation(finding, [
    `agent-lint.agents-md-review.${finding.id}`,
    finding.id,
  ]);
  if (!enriched.remediation && enriched.recommendation?.en) {
    return {
      ...enriched,
      remediation: enriched.recommendation.en,
    };
  }
  return enriched;
}

function agentsMdFinding(id, severity, evidence, options = {}) {
  return finding(id, severity, evidence, undefined, options);
}

function lengthFinding(document) {
  if (!document) {
    return null;
  }
  if (document.lineCount >= 200) {
    return agentsMdFinding(
      "root-length-hard-cap",
      "warning",
      `${document.relativePath} is ${document.lineCount} lines; 200+ line root guides are capped by the review rubric.`,
      {
        file: document.relativePath,
        line: 1,
        rubricRef: "Length And Density Gates",
      },
    );
  }
  if (document.lineCount > 180) {
    return agentsMdFinding(
      "root-length-overloaded",
      "warning",
      `${document.relativePath} is ${document.lineCount} lines; roots above 180 lines are overloaded by default.`,
      {
        file: document.relativePath,
        line: 1,
        rubricRef: "Length And Density Gates",
      },
    );
  }
  if (document.lineCount > 120) {
    return agentsMdFinding(
      "root-length-borderline",
      "advisory",
      `${document.relativePath} is ${document.lineCount} lines; 121-180 lines needs a clear split rationale.`,
      {
        file: document.relativePath,
        line: 1,
        rubricRef: "Length And Density Gates",
      },
    );
  }
  if (document.lineCount > 80) {
    return agentsMdFinding(
      "root-length-acceptable",
      "advisory",
      `${document.relativePath} is ${document.lineCount} lines; this is acceptable for multi-tool repositories.`,
      {
        file: document.relativePath,
        line: 1,
        rubricRef: "Length And Density Gates",
      },
    );
  }
  return null;
}

async function collectManifestEvidence(workspace) {
  const manifests = [];
  for (const name of MANIFEST_FILES) {
    const filePath = path.join(workspace, name);
    if (await pathExists(filePath)) {
      manifests.push({
        name,
        path: filePath,
        relativePath: name,
      });
    }
  }
  return manifests;
}

function finding(id, severity, evidence, remediation, options = {}) {
  const result = {
    id,
    severity,
    evidence,
    remediation,
  };
  for (const key of [
    "rubricRef",
    "whyThisMatters",
    "file",
    "line",
    "assetKind",
    "assetName",
    "scope",
    "sourceLabel",
    "packageRoute",
    "ownerRoute",
  ]) {
    if (options[key] !== undefined) {
      result[key] = options[key];
    }
  }
  return result;
}

export async function applyAgentsMdReviewProfile(graph, options = {}) {
  const findings = [];
  const agents = rootAgentsDocument(graph);
  const entrypointSummary = graph.entrypointSummary;
  const manifests = await collectManifestEvidence(graph.workspace);
  const entrypointDocuments = graph.documents.filter((document) => document.entrypoint);
  const instructionText = (await Promise.all(entrypointDocuments.map(readDocumentText))).join("\n");
  const agentsText = agents ? await readDocumentText(agents) : "";
  const hostInstructionReview = await reviewHostInstructions({ ...options, workspace: graph.workspace });
  findings.push(...hostInstructionReview.findings);

  if (graph.entrypoints.length === 0) {
    findings.push(agentsMdFinding(
      "no-agent-entrypoint",
      "warning",
      "No supported agent instruction entrypoint was found.",
      { rubricRef: "Core Idea" },
    ));
  }

  if (!entrypointSummary.canonicalAgentsMd) {
    findings.push(agentsMdFinding(
      "no-canonical-agents-md",
      "warning",
      "No root AGENTS.md was found; policy currently lives only in vendor-specific surfaces.",
      { rubricRef: "AGENTS.md And CLAUDE.md Split" },
    ));
  }

  if (entrypointSummary.multiEntrypoint) {
    findings.push(agentsMdFinding(
      "multi-entrypoint-review",
      "warning",
      `Detected ${graph.entrypoints.length} agent instruction entrypoints.`,
      { rubricRef: "AGENTS.md And CLAUDE.md Split" },
    ));
  }

  const rootLengthFinding = lengthFinding(agents);
  if (rootLengthFinding) {
    findings.push(rootLengthFinding);
  }

  for (const document of graph.documents) {
    for (const reference of document.references ?? []) {
      if (reference.exists === false) {
        findings.push(agentsMdFinding(
          "missing-local-reference",
          "error",
          `${document.relativePath}:${reference.line} points to missing local reference ${reference.destination}.`,
          {
            file: document.relativePath,
            line: reference.line,
            rubricRef: "Review Criteria",
          },
        ));
      }
    }
  }

  const agentsLocalRefs = (agents?.references ?? []).filter(
    (reference) => reference.kind === "local" && reference.exists,
  );
  if (agents && agents.lineCount > 80 && agentsLocalRefs.length === 0) {
    findings.push(agentsMdFinding(
      "long-root-without-progressive-references",
      "advisory",
      `${agents.relativePath} is ${agents.lineCount} lines and has no local Markdown references.`,
      {
        file: agents.relativePath,
        line: 1,
        rubricRef: "Progressive Disclosure",
        whyThisMatters:
          "progressive disclosure keeps the root agent guide lean and loads deeper docs only when task-relevant, reducing instruction bloat and context rot.",
      },
    ));
  }

  if (manifests.length > 0 && !VERIFICATION_PATTERN.test(instructionText)) {
    findings.push(agentsMdFinding(
      "missing-verification-command",
      "warning",
      `Found manifests (${manifests.map((manifest) => manifest.relativePath).join(", ")}) but no visible verification command in agent instructions.`,
      { rubricRef: "Must-Have Sections" },
    ));
  }

  if (agents && !RISK_PATTERN.test(agentsText)) {
    findings.push(agentsMdFinding(
      "missing-risk-controls",
      "advisory",
      `${agents.relativePath} does not include visible risk-control language.`,
      { file: agents.relativePath, line: 1, rubricRef: "Must-Have Sections" },
    ));
  }

  if (agents && !PROJECT_FACT_PATTERN.test(agentsText)) {
    findings.push(agentsMdFinding(
      "missing-project-facts",
      "advisory",
      `${agents.relativePath} does not include visible project fact language.`,
      { file: agents.relativePath, line: 1, rubricRef: "Must-Have Sections" },
    ));
  }

  if (agents && !DECISION_RULE_PATTERN.test(agentsText)) {
    findings.push(agentsMdFinding(
      "missing-decision-rules",
      "advisory",
      `${agents.relativePath} does not include visible decision-rule language.`,
      { file: agents.relativePath, line: 1, rubricRef: "Must-Have Sections" },
    ));
  }

  return {
    profile: PROFILE_AGENTS_MD_REVIEW,
    manifestEvidence: manifests,
    hostInstructionReview,
    findings: findings.map(withAgentsMdRecommendation),
  };
}

export function summarizeFindings(findings) {
  return {
    findings: findings.length,
    errors: countFindings(findings, "error"),
    warnings: countFindings(findings, "warning"),
    advisories: countFindings(findings, "advisory"),
  };
}

function assetScopeIncluded(item, options = {}) {
  if (item.enabled === false || item.pluginEnabled === false) {
    return false;
  }
  if (item.scope === "project") {
    return true;
  }
  if (item.scope === "plugin" && item.workspaceScoped === true) {
    return true;
  }
  if ((options.includeUserHome ?? options["include-user-home"]) && item.scope === "user") {
    return true;
  }
  if ((options.includePluginAssets ?? options["include-plugin-assets"]) && item.scope === "plugin") {
    return true;
  }
  return false;
}

function selectedAssetItems(inventory, collection, options = {}) {
  return (inventory.manage?.[collection] ?? []).filter((item) => assetScopeIncluded(item, options));
}

function summarizeAssetInventory(inventory, options = {}) {
  return {
    skills: selectedAssetItems(inventory, "skills", options).length,
    mcps: selectedAssetItems(inventory, "mcps", options).length,
    commands: selectedAssetItems(inventory, "commands", options).length,
    hooks: selectedAssetItems(inventory, "hooks", options).length,
    rules: selectedAssetItems(inventory, "rules", options).length,
    agents: selectedAssetItems(inventory, "subagents", options).length,
    plugins: selectedAssetItems(inventory, "plugins", options).length,
  };
}

function relativeAssetPath(workspace, filePath) {
  if (!filePath) {
    return undefined;
  }
  const relative = normalizeSlash(path.relative(workspace, filePath));
  return relative.startsWith("..") ? filePath : relative;
}

async function parseAssetMarkdown(filePath, workspace, options = {}) {
  const document = await parseFile(filePath, workspace);
  const references = [];
  for (const link of document.links) {
    references.push(
      await resolveReference({
        workspace,
        ownerPath: filePath,
        ownerHeadings: document.headings,
        link,
      }),
    );
  }
  if (options.includeInlineCodePaths) {
    for (const link of inlineCodePathReferences(document.inlineCode, document.links)) {
      references.push(
        await resolveReference({
          workspace,
          ownerPath: filePath,
          ownerHeadings: document.headings,
          link,
        }),
      );
    }
  }
  return { ...document, references };
}

async function parseSkillAssetDocuments(filePath, workspace, maxReferenceDepth = 0, options = {}) {
  const documents = [];
  const queue = [{ filePath, depth: 0 }];
  const seen = new Set();
  while (queue.length > 0) {
    const current = queue.shift();
    if (seen.has(current.filePath)) {
      continue;
    }
    seen.add(current.filePath);
    const document = await parseAssetMarkdown(current.filePath, workspace, options);
    documents.push(document);
    for (const reference of document.references) {
      if (
        reference.kind === "local" &&
        reference.exists &&
        current.depth < maxReferenceDepth &&
        isMarkdownPath(reference.path)
      ) {
        queue.push({ filePath: reference.path, depth: current.depth + 1 });
      }
    }
  }
  return documents;
}

function inlineCodePathReferences(inlineCodeSpans, markdownLinks = []) {
  return inlineCodeSpans
    .map((span) => inlineCodePathReference(span, markdownLinks))
    .filter(Boolean);
}

function inlineCodePathReference(span, markdownLinks) {
  const destination = span.text.trim();
  if (!destination || /\s/u.test(destination) || /[<>*?[\]{}]/u.test(destination)) {
    return null;
  }
  if (markdownLinks.some((link) => link.line === span.line && link.text.includes(span.text))) {
    return null;
  }
  if (!/^(?:\.{1,2}\/|references\/|templates\/|models\/|scripts\/|docs\/|schemas\/|assets\/|case-studies\/)/u.test(destination)) {
    return null;
  }
  const { filePart } = splitDestination(destination);
  if (!MARKDOWN_EXTENSIONS.has(path.extname(filePart).toLowerCase())) {
    return null;
  }
  return {
    text: destination,
    destination,
    line: span.line,
    column: span.column,
    kind: "inline-code-path",
  };
}

function explicitSkillOptions(options = {}) {
  const values = [
    ...(Array.isArray(options.skills) ? options.skills : []),
    ...(Array.isArray(options.skill) ? options.skill : options.skill ? [options.skill] : []),
  ];
  return values.filter(Boolean);
}

async function collectExplicitSkillAssets(options, workspace) {
  const skills = [];
  const findings = [];
  for (const target of explicitSkillOptions(options)) {
    const targetPath = path.resolve(workspace, target);
    const filePath = path.basename(targetPath) === "SKILL.md" ? targetPath : path.join(targetPath, "SKILL.md");
    if (!(await pathExists(filePath))) {
      findings.push(finding(
        "skill-target-not-found",
        "error",
        `${target} does not resolve to an existing SKILL.md.`,
        "Pass an existing skill directory or SKILL.md file.",
        {
          file: normalizeSlash(path.relative(workspace, filePath)),
          assetKind: "skill",
          assetName: path.basename(path.dirname(filePath)),
          scope: "project",
          sourceLabel: path.basename(workspace),
          rubricRef: "Skill Review",
        },
      ));
      continue;
    }
    const text = await readFile(filePath, "utf8");
    const metadata = parseFrontmatter(text);
    const name = path.basename(path.dirname(filePath));
    skills.push({
      id: `explicit:${filePath}`,
      kind: "skill",
      scope: "project",
      sourceLabel: path.basename(workspace),
      filePath,
      name,
      explicit: true,
      declaredName: metadata.name && metadata.name !== name ? metadata.name : undefined,
      description: metadata.description ?? "",
      evidence: {
        path: filePath,
        relativePath: normalizeSlash(path.relative(workspace, filePath)),
      },
    });
  }
  return { skills, findings };
}

function uniqueAssetsByFilePath(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const key = item.filePath ?? item.evidence?.path ?? item.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}

function skillDescriptionFinding(skill, file, description) {
  if (!description) {
    return finding(
      "skill-missing-description",
      "warning",
      `${skill.name} does not declare a frontmatter description.`,
      "Add a concise trigger-focused description so agents know when to load the skill.",
      {
        file,
        assetKind: "skill",
        assetName: skill.name,
        scope: skill.scope,
        sourceLabel: skill.sourceLabel,
        rubricRef: "Agent Skills Specification",
      },
    );
  }
  if (description.length < 16) {
    return finding(
      "skill-description-too-short",
      "warning",
      `${skill.name} has a very short description.`,
      "Describe the observable trigger and scope in one concise sentence.",
      {
        file,
        assetKind: "skill",
        assetName: skill.name,
        scope: skill.scope,
        sourceLabel: skill.sourceLabel,
        rubricRef: "Agent Skills Specification",
      },
    );
  }
  return null;
}

function parseAgentFrontmatter(text) {
  const normalized = String(text ?? "").replace(/^\uFEFF/u, "");
  if (!normalized.startsWith("---")) {
    return { present: false, valid: false, source: "", metadata: {}, body: normalized };
  }
  const match = normalized.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u);
  if (!match) {
    return { present: true, valid: false, source: "", metadata: {}, body: "" };
  }
  return {
    present: true,
    valid: true,
    source: match[1],
    metadata: parseFrontmatter(normalized),
    body: normalized.slice(match[0].length).trim(),
  };
}

function frontmatterList(source, key) {
  const lines = String(source ?? "").split(/\r?\n/u);
  const values = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(new RegExp(`^${key}:\\s*(.*)$`, "iu"));
    if (!match) continue;
    const inline = match[1].trim();
    if (inline) {
      values.push(...inline.replace(/^\[|\]$/gu, "").split(","));
    }
    while (index + 1 < lines.length) {
      const item = lines[index + 1].match(/^\s+-\s+(.+)$/u);
      if (!item) break;
      index += 1;
      values.push(item[1]);
    }
    break;
  }
  return values
    .map((value) => value.trim().replace(/^['"]|['"]$/gu, ""))
    .filter(Boolean);
}

function customAgentFinding(agent, graph, id, severity, evidence, remediation, options = {}) {
  const filePath = agent.filePath ?? agent.evidence?.path;
  return finding(id, severity, evidence, remediation, {
    file: relativeAssetPath(graph.workspace, filePath),
    assetKind: "subagent",
    assetName: agent.name,
    scope: agent.scope,
    sourceLabel: agent.sourceLabel,
    rubricRef: "Custom Agent Review",
    ...options,
  });
}

async function reviewCustomAgentAsset(agent, graph, provider) {
  const findings = [];
  const filePath = agent.filePath ?? agent.evidence?.path;
  if (!filePath) return findings;
  const raw = await readFile(filePath, "utf8").catch(() => "");
  if (!raw) return findings;
  const profile = parseAgentFrontmatter(raw);
  const file = relativeAssetPath(graph.workspace, filePath);

  if (!profile.present) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-missing-frontmatter",
      "error",
      `${file} has no Custom Agent frontmatter.`,
      "Add parseable frontmatter with the provider-required name, routing description, and bounded tool declaration.",
    ));
    return findings;
  }
  if (!profile.valid) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-malformed-frontmatter",
      "error",
      `${file} has malformed Custom Agent frontmatter.`,
      "Close the frontmatter block and keep each provider field parseable.",
    ));
    return findings;
  }

  const declaredName = String(profile.metadata.name ?? "").trim();
  const description = String(profile.metadata.description ?? "").trim();
  const invocableName = path.basename(filePath, path.extname(filePath));
  const tools = frontmatterList(profile.source, "tools");
  if (provider === "qoder" && !declaredName) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-missing-name",
      "error",
      `${file} does not declare the Qoder-required name.`,
      "Add a unique lowercase, hyphenated name that matches the invocable profile filename.",
    ));
  }
  if (provider === "qoder" && declaredName && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(declaredName)) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-invalid-name",
      "warning",
      `${file} declares a name that is not a lowercase hyphenated identifier.`,
      "Use lowercase letters, numbers, and single hyphens for predictable manual invocation.",
    ));
  }
  if (provider === "qoder" && declaredName && declaredName !== invocableName) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-name-mismatch",
      "warning",
      `${file} declares ${declaredName}, while the invocable filename is ${invocableName}.`,
      "Align the declared name and filename so manual and automatic routing expose one stable identity.",
    ));
  }
  if (!description) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-missing-description",
      "warning",
      `${file} has no routing description.`,
      "Describe the focused task and observable trigger so the main Agent can delegate reliably.",
    ));
  } else if (description.length < 16) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-description-too-short",
      "warning",
      `${file} has a very short routing description.`,
      "Name the focused task, when to delegate it, and the expected result in one concise sentence.",
    ));
  }
  if (!profile.body) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-empty-prompt",
      "error",
      `${file} has no system-prompt body.`,
      "Add a focused role, workflow boundary, expected output, and important limitations.",
    ));
  } else if (profile.body.length < 40) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-prompt-too-short",
      "warning",
      `${file} has an extremely short system-prompt body.`,
      "State the focused role, expected output, and important limits explicitly.",
    ));
  }
  if (profile.body.length > 30_000) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-prompt-too-large",
      "warning",
      `${file} exceeds the 30,000-character portable prompt ceiling.`,
      "Keep always-needed routing and constraints in the profile and move conditional detail behind local references.",
    ));
  }

  const declaresTools = /^tools\s*:/imu.test(profile.source);
  if (!declaresTools || tools.some((tool) => ["*", "all"].includes(tool.toLowerCase()))) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-unbounded-tools",
      "advisory",
      `${file} does not expose an explicit least-privilege tool boundary.`,
      "Declare only the tools needed for this specialist role, or document why inherited access is required.",
    ));
  }
  const readOnlyRole = /\b(?:read[- ]only|review[- ]only|do not (?:edit|write|modify)|never (?:edit|write|modify))\b/iu.test(`${description}\n${profile.body}`);
  const writeTools = tools.filter((tool) => /^(?:edit|write|apply_patch)$/iu.test(tool));
  if (readOnlyRole && writeTools.length > 0) {
    findings.push(customAgentFinding(
      agent,
      graph,
      "custom-agent-tool-role-conflict",
      "error",
      `${file} declares a read-only role but grants write-capable tools.`,
      "Remove write-capable tools or revise the role contract and approval boundary.",
    ));
  }

  const document = await parseFile(filePath, graph.workspace);
  for (const link of document.links) {
    const reference = await resolveReference({
      workspace: graph.workspace,
      ownerPath: filePath,
      ownerHeadings: document.headings,
      link,
    });
    if (reference.exists === false) {
      findings.push(customAgentFinding(
        agent,
        graph,
        "custom-agent-missing-local-reference",
        "error",
        `${file}:${reference.line} points to missing local reference ${reference.destination}.`,
        "Repair the link, add the referenced resource, or remove stale profile guidance.",
        { line: reference.line },
      ));
    }
  }
  return findings;
}

async function reviewSkillAsset(skill, graph, options = {}) {
  const findings = [];
  const filePath = skill.filePath ?? skill.evidence?.path;
  if (!filePath) {
    return findings;
  }
  const file = relativeAssetPath(graph.workspace, filePath);
  const descriptionFinding = skillDescriptionFinding(skill, file, skill.description ?? "");
  if (descriptionFinding) {
    findings.push(descriptionFinding);
  }
  if (skill.declaredName) {
    findings.push(finding(
      "skill-name-mismatch",
      "advisory",
      `${file} declares skill name ${skill.declaredName}, but the folder exposes ${skill.name}.`,
      "Keep the frontmatter name aligned with the skill folder for predictable discovery.",
      {
        file,
        assetKind: "skill",
        assetName: skill.name,
        scope: skill.scope,
        sourceLabel: skill.sourceLabel,
        rubricRef: "Agent Skills Specification",
      },
    ));
  }

  const maxReferenceDepth = skill.explicit
    ? Number(options.maxSkillReferenceDepth ?? options["max-skill-reference-depth"] ?? options.maxReferenceDepth ?? options["max-reference-depth"] ?? 1)
    : 0;
  const documents = await parseSkillAssetDocuments(filePath, graph.workspace, maxReferenceDepth, {
    includeInlineCodePaths: skill.explicit,
  });
  const document = documents[0];
  if (document.lineCount >= 500) {
    findings.push(finding(
      "skill-length-hard-cap",
      "warning",
      `${file} is ${document.lineCount} lines; long skills should move detail into references.`,
      "Keep SKILL.md as a compact workflow router and move variants, examples, and schemas into linked references.",
      {
        file,
        line: 1,
        assetKind: "skill",
        assetName: skill.name,
        scope: skill.scope,
        sourceLabel: skill.sourceLabel,
        rubricRef: "Progressive Disclosure",
      },
    ));
  }

  for (const checkedDocument of documents) {
    const documentFile = relativeAssetPath(graph.workspace, checkedDocument.path);
    for (const reference of checkedDocument.references) {
      if (reference.exists === false) {
        findings.push(finding(
          "skill-missing-local-reference",
          "error",
          `${documentFile}:${reference.line} points to missing local reference ${reference.destination}.`,
          "Repair the link, add the referenced skill resource, or remove stale guidance.",
          {
            file: documentFile,
            line: reference.line,
            assetKind: "skill",
            assetName: skill.name,
            scope: skill.scope,
            sourceLabel: skill.sourceLabel,
            rubricRef: "Skill Review",
          },
        ));
      }
    }
  }

  const existingLocalReferences = documents.flatMap((checkedDocument) =>
    checkedDocument.references.filter((reference) => reference.kind === "local" && reference.exists)
  );
  if (document.lineCount > 120 && existingLocalReferences.length === 0) {
    findings.push(finding(
      "skill-long-without-progressive-references",
      "advisory",
      `${file} is ${document.lineCount} lines and has no existing local Markdown references.`,
      "Use one-hop references for conditional details so the skill loads only task-relevant context.",
      {
        file,
        line: 1,
        assetKind: "skill",
        assetName: skill.name,
        scope: skill.scope,
        sourceLabel: skill.sourceLabel,
        rubricRef: "Progressive Disclosure",
      },
    ));
  }
  return findings;
}

function commandName(command) {
  return path.basename(command ?? "").toLowerCase().replace(/\.cmd$/u, "");
}

function packageRunnerArgument(args = []) {
  return args.find(
    (arg) =>
      arg &&
      !arg.startsWith("-") &&
      !arg.startsWith(".") &&
      !arg.startsWith("http:") &&
      !arg.startsWith("https:"),
  );
}

function packageReferenceHasVersion(value) {
  if (!value || value.startsWith("http:") || value.startsWith("https:")) {
    return true;
  }
  if (value.startsWith("@")) {
    return value.slice(1).includes("@");
  }
  return value.includes("@");
}

function reviewMcpAssets(mcps, skills, commands, workspace) {
  const findings = [];
  for (const mcp of mcps) {
    const file = relativeAssetPath(workspace, mcp.filePath ?? mcp.evidence?.path);
    if (!mcp.command && !mcp.url && !mcp.toolCount && !mcp.resourceCount) {
      findings.push(finding(
        "mcp-missing-command-or-url",
        "error",
        `${mcp.name} has no visible command, url, runtime tools, or runtime resources.`,
        "Declare the MCP transport boundary or remove the stale server entry.",
        {
          file,
          assetKind: "mcp",
          assetName: mcp.name,
          scope: mcp.scope,
          sourceLabel: mcp.sourceLabel,
          rubricRef: "MCP Tools And Security",
        },
      ));
    }
    if (typeof mcp.url === "string" && /^http:\/\//iu.test(mcp.url)) {
      findings.push(finding(
        "mcp-remote-without-tls",
        "warning",
        `${mcp.name} uses a non-TLS remote MCP URL.`,
        "Use HTTPS or document why the local transport is intentionally plaintext and sandboxed.",
        {
          file,
          assetKind: "mcp",
          assetName: mcp.name,
          scope: mcp.scope,
          sourceLabel: mcp.sourceLabel,
          rubricRef: "MCP Security Best Practices",
        },
      ));
    }
    if ((mcp.directSecretEnvKeys ?? []).length > 0) {
      findings.push(finding(
        "mcp-direct-secret-env-value",
        "error",
        `${mcp.name} has direct secret-looking env values for keys: ${mcp.directSecretEnvKeys.join(", ")}.`,
        "Reference environment variables or a secret store instead of embedding credential values in MCP config.",
        {
          file,
          assetKind: "mcp",
          assetName: mcp.name,
          scope: mcp.scope,
          sourceLabel: mcp.sourceLabel,
          rubricRef: "MCP Security Best Practices",
        },
      ));
    }
    const runner = commandName(mcp.command);
    if (["npx", "bunx", "uvx"].includes(runner)) {
      const packageArg = packageRunnerArgument(mcp.args ?? []);
      if (packageArg && !packageReferenceHasVersion(packageArg)) {
        findings.push(finding(
          "mcp-unpinned-package-runner",
          "advisory",
          `${mcp.name} runs ${runner} with unpinned package ${packageArg}.`,
          "Pin the package version or document the trusted update boundary for this MCP server.",
          {
            file,
            assetKind: "mcp",
            assetName: mcp.name,
            scope: mcp.scope,
            sourceLabel: mcp.sourceLabel,
            rubricRef: "MCP Security Best Practices",
          },
        ));
      }
    }
  }

  if (mcps.length > 0 && skills.length === 0 && commands.length === 0) {
    findings.push(finding(
      "mcp-without-workflow-owner",
      "warning",
      `Detected ${mcps.length} MCP server entries but no project Skill or Command owner.`,
      "Add a Skill or Command that explains when to use the external access and what validation or approval boundary applies.",
      {
        assetKind: "mcp",
        assetName: "project MCPs",
        rubricRef: "Coding Agent Practices Routing",
        whyThisMatters: "MCP provides access to external systems; a Skill or Command should own repeatable workflow judgment.",
      },
    ));
  }
  return findings;
}

export async function applyAgentAssetsReviewProfile(graph, options = {}) {
  const provider = options.provider ?? "qoder";
  const inventory = options.inventory
    ?? await collectAgentCustomizeInventory({ ...options, provider, workspace: graph.workspace });
  const explicitSkillTarget = explicitSkillOptions(options).length > 0;
  const explicitSkillResult = await collectExplicitSkillAssets(options, graph.workspace);
  const explicitSkills = explicitSkillResult.skills;
  const inventorySkills = explicitSkillTarget ? [] : selectedAssetItems(inventory, "skills", options);
  const skills = uniqueAssetsByFilePath([...inventorySkills, ...explicitSkills]);
  const mcps = explicitSkillTarget ? [] : selectedAssetItems(inventory, "mcps", options);
  const commands = explicitSkillTarget ? [] : selectedAssetItems(inventory, "commands", options);
  const hooks = explicitSkillTarget ? [] : selectedAssetItems(inventory, "hooks", options);
  const customAgents = explicitSkillTarget ? [] : selectedAssetItems(inventory, "subagents", options);
  const skillFindings = (await Promise.all(skills.map((skill) => reviewSkillAsset(skill, graph, options)))).flat();
  const customAgentFindings = (await Promise.all(
    customAgents.map((agent) => reviewCustomAgentAsset(agent, graph, provider)),
  )).flat();
  const mcpFindings = reviewMcpAssets(mcps, skills, commands, graph.workspace);
  const hookFindings = await reviewHookAssets(hooks, graph.workspace);
  const summary = explicitSkillTarget
    ? { skills: skills.length, mcps: 0, commands: 0, hooks: 0, rules: 0, agents: 0, plugins: 0 }
    : summarizeAssetInventory(inventory, options);
  return {
    profile: PROFILE_AGENT_ASSETS_REVIEW,
    assetInventory: {
      provider,
      summary,
    },
    findings: [
      ...explicitSkillResult.findings,
      ...skillFindings,
      ...customAgentFindings,
      ...hookFindings,
      ...mcpFindings,
    ],
  };
}

async function singleWorkspacePayload(options = {}) {
  const graph = await collectAgentInstructionGraph(options);
  const profileResult = options.profile === PROFILE_AGENTS_MD_REVIEW
    ? await applyAgentsMdReviewProfile(graph, options)
    : options.profile === PROFILE_AGENT_ASSETS_REVIEW
      ? await applyAgentAssetsReviewProfile(graph, options)
      : { findings: [], manifestEvidence: [], assetInventory: undefined };
  const findings = profileResult.findings.map((item) => {
    if (!options.topology || typeof item?.file !== "string") return item;
    const route = normalizeSlash(item.file);
    if (!route || path.isAbsolute(route) || route === ".." || route.startsWith("../")) return item;
    const packageRoute = ownerRouteForPath(options.topology, route);
    return {
      ...item,
      packageRoute,
      ownerRoute: packageRoute,
    };
  });
  return {
    kind: "agent-lint",
    profile: options.profile,
    summary: {
      ...summarizeGraph(graph),
      ...summarizeFindings(findings),
    },
    graph,
    manifestEvidence: profileResult.manifestEvidence,
    hostInstructionReview: profileResult.hostInstructionReview,
    assetInventory: profileResult.assetInventory,
    findings,
  };
}

async function childWorkspaces(rootPath, excludes = DEFAULT_CHILD_EXCLUDES) {
  const entries = await readdir(rootPath, { withFileTypes: true }).catch(() => []);
  return entries
    .filter((entry) => entry.isDirectory() && !excludes.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      workspace: path.join(rootPath, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

export async function runAgentLint(options = {}) {
  if (options.scanChildren || options["scan-children"] || options.workspaceRoot || options["workspace-root"]) {
    const workspaceRoot = normalizeWorkspace(options.workspaceRoot ?? options["workspace-root"] ?? options.workspace ?? ".");
    const children = await childWorkspaces(workspaceRoot);
    const projects = [];
    for (const child of children) {
      const payload = await singleWorkspacePayload({ ...options, workspace: child.workspace });
      projects.push({
        name: child.name,
        workspace: child.workspace,
        summary: payload.summary,
        graph: payload.graph,
        manifestEvidence: payload.manifestEvidence,
        hostInstructionReview: payload.hostInstructionReview,
        assetInventory: payload.assetInventory,
        findings: payload.findings,
      });
    }
    const findings = projects.flatMap((project) => project.findings.map((item) => ({ ...item, project: project.name })));
    return {
      kind: "agent-lint",
      profile: options.profile,
      workspaceRoot,
      summary: {
        projects: projects.length,
        findings: findings.length,
        errors: countFindings(findings, "error"),
        warnings: countFindings(findings, "warning"),
        advisories: countFindings(findings, "advisory"),
      },
      projects,
      findings,
    };
  }

  return singleWorkspacePayload(options);
}
