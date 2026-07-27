import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { pathExists } from "../session-analysis/fs.mjs";
import { expandHome, normalizeWorkspace } from "../session-analysis/paths.mjs";

const MARKDOWN_EXTENSIONS = new Set([".md", ".mdc", ".markdown"]);
const EXCLUDED_DIRECTORIES = new Set([".git", "node_modules", "vendor", "dist", "build", "target"]);
const COMMAND_PATTERN = /^(?:npm|pnpm|yarn|bun|make|node|python(?:3)?|pytest|ruff|go|cargo|mvn|gradle|qodercli|git)\b/iu;
const PACKAGE_MANAGER_PATTERN = /\b(npm|pnpm|yarn|bun)\b/giu;
const POSITIVE_DIRECTIVE = /\b(?:always|must|required to|use)\s+(.+)$/iu;
const NEGATIVE_DIRECTIVE = /\b(?:never|must not|do not|don't|avoid|forbid(?:den)?)\s+(.+)$/iu;

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, 10);
}

function slash(value) {
  return value.split(path.sep).join("/");
}

function relativeLabel(filePath, workspace, home, scope) {
  if (scope === "user") {
    return `user:${slash(path.relative(home, filePath))}`;
  }
  const relative = slash(path.relative(workspace, filePath));
  return relative.startsWith("../") ? `ancestor:${path.basename(filePath)}` : relative;
}

async function markdownFiles(root, maxDepth = 5) {
  const files = [];
  async function visit(current, depth) {
    if (depth > maxDepth) return;
    const entries = await readdir(current, { withFileTypes: true }).catch(() => []);
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      if (EXCLUDED_DIRECTORIES.has(entry.name)) continue;
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        await visit(filePath, depth + 1);
      } else if (entry.isFile() && MARKDOWN_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(filePath);
      }
    }
  }
  await visit(root, 0);
  return files;
}

function ancestors(workspace) {
  const values = [];
  let current = path.dirname(workspace);
  for (let depth = 0; depth < 16; depth += 1) {
    if (current === path.dirname(current)) break;
    values.unshift(current);
    current = path.dirname(current);
  }
  return values;
}

async function qoderSources(options) {
  const workspace = normalizeWorkspace(options.workspace);
  const home = path.resolve(expandHome(options.qoderHome ?? options["qoder-home"] ?? process.env.QODER_HOME ?? "~/.qoder"));
  const candidates = [];
  if (options.includeUserHome ?? options["include-user-home"]) {
    for (const filePath of await markdownFiles(path.join(home, "rules"), 4)) {
      candidates.push({ filePath, scope: "user", sourceKind: "qoder-rule", precedence: 10, home });
    }
  }
  for (const filePath of await markdownFiles(path.join(workspace, ".qoder", "rules"), 4)) {
    candidates.push({ filePath, scope: "project", sourceKind: "qoder-rule", precedence: 20, home });
  }
  candidates.push({
    filePath: path.join(workspace, "AGENTS.md"),
    scope: "project",
    sourceKind: "agents-md-compat",
    precedence: 30,
    home,
  });
  return { provider: "qoder", workspace, home, candidates };
}

async function claudeSources(options) {
  const workspace = normalizeWorkspace(options.workspace);
  const home = path.resolve(expandHome(options.claudeHome ?? options["claude-home"] ?? "~/.claude"));
  const candidates = [];
  if (options.includeUserHome ?? options["include-user-home"]) {
    candidates.push({
      filePath: path.join(home, "CLAUDE.md"),
      scope: "user",
      sourceKind: "claude-global",
      precedence: 10,
      home,
    });
    for (const filePath of await markdownFiles(path.join(home, "rules"), 4)) {
      candidates.push({ filePath, scope: "user", sourceKind: "claude-rule", precedence: 15, home });
    }
  }
  for (const ancestor of ancestors(workspace)) {
    for (const relativePath of ["CLAUDE.md", path.join(".claude", "CLAUDE.md")]) {
      candidates.push({
        filePath: path.join(ancestor, relativePath),
        scope: "ancestor",
        sourceKind: "claude-ancestor",
        precedence: 20,
        home,
      });
    }
  }
  for (const filePath of await markdownFiles(workspace, 5)) {
    const relativePath = slash(path.relative(workspace, filePath));
    const baseName = path.basename(filePath);
    const isRule = relativePath.startsWith(".claude/rules/");
    if (baseName === "CLAUDE.md" || baseName === "CLAUDE.local.md" || isRule) {
      candidates.push({
        filePath,
        scope: relativePath.includes("/") && relativePath !== ".claude/CLAUDE.md" && !isRule ? "nested" : "project",
        sourceKind: isRule ? "claude-rule" : baseName === "CLAUDE.local.md" ? "claude-local" : "claude-project",
        precedence: baseName === "CLAUDE.local.md" ? 40 : isRule ? 35 : 30,
        home,
      });
    }
  }
  return { provider: "claude", workspace, home, candidates };
}

async function codexSources(options) {
  const workspace = normalizeWorkspace(options.workspace);
  const home = path.resolve(expandHome(options.codexHome ?? options["codex-home"] ?? "~/.codex"));
  const candidates = [];
  if (options.includeUserHome ?? options["include-user-home"]) {
    candidates.push({
      filePath: path.join(home, "AGENTS.md"),
      scope: "user",
      sourceKind: "codex-global",
      precedence: 10,
      home,
    });
  }
  for (const ancestor of ancestors(workspace)) {
    candidates.push({
      filePath: path.join(ancestor, "AGENTS.md"),
      scope: "ancestor",
      sourceKind: "codex-ancestor",
      precedence: 20,
      home,
    });
  }
  for (const filePath of await markdownFiles(workspace, 5)) {
    if (path.basename(filePath) === "AGENTS.md") {
      candidates.push({
        filePath,
        scope: filePath === path.join(workspace, "AGENTS.md") ? "project" : "nested",
        sourceKind: "codex-project",
        precedence: 30,
        home,
      });
    }
  }
  return { provider: "codex", workspace, home, candidates };
}

async function sourceCandidates(options) {
  const provider = String(options.provider ?? "qoder").toLowerCase();
  if (provider === "qoder") return qoderSources(options);
  if (provider === "claude") return claudeSources(options);
  if (provider === "codex") return codexSources(options);
  return {
    provider,
    workspace: normalizeWorkspace(options.workspace),
    home: os.homedir(),
    candidates: [],
  };
}

async function loadLedger(options) {
  const context = await sourceCandidates(options);
  const seen = new Set();
  const sources = [];
  for (const candidate of context.candidates) {
    const filePath = path.resolve(candidate.filePath);
    if (seen.has(filePath) || !(await pathExists(filePath))) continue;
    seen.add(filePath);
    const text = await readFile(filePath, "utf8");
    sources.push({
      id: `${context.provider}-${hash(`${candidate.scope}:${filePath}`)}`,
      provider: context.provider,
      scope: candidate.scope,
      sourceKind: candidate.sourceKind,
      precedence: candidate.precedence,
      path: filePath,
      relativePath: relativeLabel(filePath, context.workspace, context.home, candidate.scope),
      text,
    });
  }
  sources.sort((left, right) => left.precedence - right.precedence || left.relativePath.localeCompare(right.relativePath));
  return { provider: context.provider, sources };
}

function normalizeLine(value) {
  return value
    .replace(/^\s*(?:[-*+]\s+|\d+[.)]\s+)/u, "")
    .replace(/^`+|`+$/gu, "")
    .replace(/\\/gu, "/")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

function paragraphs(source) {
  const lines = source.text.split(/\r?\n/u);
  const blocks = [];
  let current = [];
  let startLine = 1;
  function flush() {
    const normalized = normalizeLine(current.join(" "));
    if (normalized.length >= 24 && normalized.split(/\s+/u).length >= 4) {
      blocks.push({ source, line: startLine, normalized });
    }
    current = [];
  }
  lines.forEach((line, index) => {
    if (!line.trim()) {
      flush();
      startLine = index + 2;
      return;
    }
    if (current.length === 0) startLine = index + 1;
    current.push(line);
  });
  flush();
  return blocks;
}

function commandLines(source) {
  return source.text.split(/\r?\n/u).flatMap((line, index) => {
    const normalized = normalizeLine(line);
    return COMMAND_PATTERN.test(normalized) ? [{ source, line: index + 1, normalized }] : [];
  });
}

function sections(source) {
  const lines = source.text.split(/\r?\n/u);
  const values = [];
  let current = null;
  function flush() {
    if (current && current.lines.length >= 3) values.push(current);
  }
  lines.forEach((line, index) => {
    const heading = line.match(/^#{1,6}\s+(.+)$/u);
    if (heading) {
      flush();
      current = { source, line: index + 1, heading: normalizeLine(heading[1]), lines: [] };
      return;
    }
    if (!current) return;
    const normalized = normalizeLine(line);
    if (normalized.length >= 12) current.lines.push(normalized);
  });
  flush();
  return values;
}

function directives(source) {
  return source.text.split(/\r?\n/u).flatMap((line, index) => {
    const normalized = normalizeLine(line);
    const negative = normalized.match(NEGATIVE_DIRECTIVE);
    const positive = normalized.match(POSITIVE_DIRECTIVE);
    const match = negative ?? positive;
    if (!match) return [];
    return [{
      source,
      line: index + 1,
      normalized,
      polarity: negative ? "negative" : "positive",
      operation: normalizeLine(match[1]).replace(/[.!;:]+$/gu, ""),
      packageManagers: [...new Set([...normalized.matchAll(PACKAGE_MANAGER_PATTERN)].map((item) => item[1].toLowerCase()))],
    }];
  });
}

function location(item) {
  return { sourceId: item.source.id, source: item.source.relativePath, line: item.line };
}

function pairFinding(kind, severity, left, right, message) {
  const pairId = hash(`${kind}:${left.source.id}:${left.line}:${right.source.id}:${right.line}`);
  return {
    id: `${kind}-${pairId}`,
    severity,
    evidence: message,
    remediation: "Choose one canonical owner, keep provider scope explicit, and remove or rewrite only the proven duplicate or conflict.",
    rubricRef: "Deterministic Overlap And Conflict Review",
    host: left.source.provider,
    detector: kind,
    locations: [location(left), location(right)],
  };
}

function duplicateFindings(items, kind, message) {
  const byValue = new Map();
  for (const item of items) {
    const list = byValue.get(item.normalized) ?? [];
    list.push(item);
    byValue.set(item.normalized, list);
  }
  const findings = [];
  for (const matches of byValue.values()) {
    const sourceIds = new Set(matches.map((item) => item.source.id));
    if (sourceIds.size < 2) continue;
    for (let index = 0; index < matches.length; index += 1) {
      const left = matches[index];
      const right = matches.slice(index + 1).find((item) => item.source.id !== left.source.id);
      if (right) findings.push(pairFinding(kind, "warning", left, right, message(left, right)));
    }
  }
  return findings;
}

function conflictFindings(allDirectives) {
  const findings = [];
  for (let index = 0; index < allDirectives.length; index += 1) {
    const left = allDirectives[index];
    for (const right of allDirectives.slice(index + 1)) {
      if (left.source.id === right.source.id) continue;
      const oppositeSameOperation = left.polarity !== right.polarity && left.operation === right.operation;
      const managerNeutralLeft = left.operation.replace(/\b(?:npm|pnpm|yarn|bun)\b/gu, "<manager>");
      const managerNeutralRight = right.operation.replace(/\b(?:npm|pnpm|yarn|bun)\b/gu, "<manager>");
      const managerConflict =
        left.polarity === "positive" &&
        right.polarity === "positive" &&
        left.packageManagers.length === 1 &&
        right.packageManagers.length === 1 &&
        left.packageManagers[0] !== right.packageManagers[0] &&
        managerNeutralLeft === managerNeutralRight &&
        /\b(?:use|install|run)\b/u.test(left.normalized) &&
        /\b(?:use|install|run)\b/u.test(right.normalized);
      if (oppositeSameOperation || managerConflict) {
        findings.push(pairFinding(
          "instruction-conflict",
          "error",
          left,
          right,
          `Visible ${oppositeSameOperation ? "opposing directives" : "package-manager directives"} conflict between ${left.source.relativePath}:${left.line} and ${right.source.relativePath}:${right.line}.`,
        ));
      }
    }
  }
  return findings;
}

function sectionOverlapFindings(allSections) {
  const findings = [];
  for (let index = 0; index < allSections.length; index += 1) {
    const left = allSections[index];
    for (const right of allSections.slice(index + 1)) {
      if (left.source.id === right.source.id) continue;
      const leftLines = new Set(left.lines);
      const rightLines = new Set(right.lines);
      const shared = [...leftLines].filter((line) => rightLines.has(line));
      const denominator = Math.min(leftLines.size, rightLines.size);
      const overlap = denominator === 0 ? 0 : shared.length / denominator;
      if (shared.length < 3 || overlap < 0.75) continue;
      findings.push(pairFinding(
        "instruction-section-overlap",
        "warning",
        left,
        right,
        `Sections ${left.source.relativePath}:${left.line} and ${right.source.relativePath}:${right.line} share ${shared.length}/${denominator} stable normalized lines.`,
      ));
    }
  }
  return findings;
}

export async function reviewHostInstructions(options = {}) {
  const ledger = await loadLedger(options);
  const blocks = ledger.sources.flatMap(paragraphs);
  const commands = ledger.sources.flatMap(commandLines);
  const allSections = ledger.sources.flatMap(sections);
  const allDirectives = ledger.sources.flatMap(directives);
  const findings = [
    ...duplicateFindings(blocks, "instruction-exact-duplicate", (left, right) =>
      `Exact normalized instruction block appears in ${left.source.relativePath}:${left.line} and ${right.source.relativePath}:${right.line}.`
    ),
    ...duplicateFindings(commands, "instruction-command-duplicate", (left, right) =>
      `The same normalized command appears in ${left.source.relativePath}:${left.line} and ${right.source.relativePath}:${right.line}.`
    ),
    ...sectionOverlapFindings(allSections),
    ...conflictFindings(allDirectives),
  ];
  findings.sort((left, right) => left.id.localeCompare(right.id));
  return {
    provider: ledger.provider,
    sources: ledger.sources.map(({ text: _text, path: _path, ...source }) => source),
    findings,
  };
}
