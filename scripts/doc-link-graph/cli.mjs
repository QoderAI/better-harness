#!/usr/bin/env node
// Parse markdown doc references under a directory (default: skills/better-harness)
// and emit a Mermaid flowchart of the doc-to-doc link graph.
//
// References are collected from three contexts that all appear in skill docs:
// markdown links [text](path.md), backtick spans `path.md`, and bare path
// tokens inside fenced blocks (e.g. dot digraph labels). A token only becomes
// a graph edge when it resolves to a file, or when it is path-like (contains
// a slash) so a broken relative link stays visible instead of vanishing.
// Bare names that resolve nowhere (AGENTS.md, report.md) describe files in
// analyzed target repos, not this repo, so they are skipped.

import { readFileSync, readdirSync, statSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export function parseArgs(argv) {
  const args = { target: "skills/better-harness", out: null, follow: false };
  const rest = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--out") {
      args.out = argv[++i];
    } else if (arg === "--follow") {
      args.follow = true;
    } else if (arg === "--help" || arg === "-h") {
      console.log(
        "Usage: node scripts/doc-link-graph/cli.mjs [targetDir] [--out file.mmd] [--follow]\n" +
          "  targetDir  directory of markdown docs to seed from (default: skills/better-harness)\n" +
          "  --out      output .mmd path (default: docs/<target-name>-doc-links.mmd)\n" +
          "  --follow   also parse resolved docs outside targetDir (one transitive pass)",
      );
      process.exit(0);
    } else {
      rest.push(arg);
    }
  }
  if (rest[0]) {
    args.target = rest[0];
  }
  return args;
}

// Directories that never hold authored repo docs: dependency trees and the
// Docusaurus build output that lives alongside the site under docs/.
const SKIPPED_DIR_NAMES = new Set(["node_modules", "build"]);

export function markdownFilesUnder(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    if (SKIPPED_DIR_NAMES.has(entry) || entry.startsWith(".")) {
      continue;
    }
    const full = path.join(dir, entry);
    const stats = statSync(full);
    if (stats.isDirectory()) {
      found.push(...markdownFilesUnder(full));
    } else if (entry.endsWith(".md")) {
      found.push(full);
    }
  }
  return found;
}

// Path-like .md tokens: optional ./ ../ prefixes, then segments. Allows
// dotfiles segments like .github. Excludes URLs by rejecting tokens that
// follow "//" (protocol) via the char class (no ":" allowed).
const MD_TOKEN = /(?:\.\.?\/)*(?:[\w.-]+\/)*[\w.-]+\.md\b/g;

function extractTokens(text) {
  const tokens = new Set();
  for (const match of text.matchAll(MD_TOKEN)) {
    tokens.add(match[0]);
  }
  return [...tokens];
}

export function classify(token, fromFile) {
  const fromDir = path.dirname(fromFile);
  const resolved = path.resolve(fromDir, token);
  if (existsSync(resolved)) {
    return { kind: "resolved", file: resolved };
  }
  // Some docs cite multi-segment paths from the repo root rather than
  // relative to themselves; accept those when the file actually exists.
  // Bare names (AGENTS.md, DESIGN.md) stay conceptual — in these docs they
  // describe files in analyzed target repos, not this repo's root files.
  const fromRepoRoot = path.resolve(repoRoot, token);
  if (token.includes("/") && !token.startsWith(".") && existsSync(fromRepoRoot)) {
    return { kind: "resolved", file: fromRepoRoot };
  }
  // Unresolved but path-like: report as a broken link only when the first
  // path segment exists as a directory next to the doc. Otherwise the token
  // names a file convention in analyzed target repos (e.g.
  // .github/copilot-instructions.md), not a relative link in this repo.
  if (token.includes("/")) {
    const firstSegment = token.split("/")[0];
    const anchor = path.resolve(fromDir, firstSegment);
    if ((firstSegment === "." || firstSegment === ".." || existsSync(anchor)) && resolved.startsWith(repoRoot)) {
      return { kind: "missing", file: resolved };
    }
  }
  return { kind: "conceptual", file: null };
}

export function relId(file) {
  return path.relative(repoRoot, file).split(path.sep).join("/");
}

function nodeId(rel) {
  return "n_" + rel.replace(/[^\w]/g, "_");
}

function nodeLabel(rel) {
  return rel.replaceAll('"', "'");
}

export function buildGraph(seedFiles, { follow }) {
  const nodes = new Map(); // rel -> { kind }
  const edges = new Set(); // "from|to" rel pairs
  const conceptual = new Map(); // token -> count
  const queue = [...seedFiles];
  const parsed = new Set();
  const seedSet = new Set(seedFiles.map((f) => relId(f)));

  while (queue.length > 0) {
    const file = queue.shift();
    const fromRel = relId(file);
    if (parsed.has(fromRel)) {
      continue;
    }
    parsed.add(fromRel);
    if (!nodes.has(fromRel)) {
      nodes.set(fromRel, { kind: "resolved" });
    }
    const text = readFileSync(file, "utf8");
    for (const token of extractTokens(text)) {
      const target = classify(token, file);
      if (target.kind === "conceptual") {
        conceptual.set(token, (conceptual.get(token) ?? 0) + 1);
        continue;
      }
      const toRel = target.kind === "resolved" ? relId(target.file) : relId(target.file);
      if (toRel === fromRel) {
        continue;
      }
      const existing = nodes.get(toRel);
      if (!existing || (existing.kind === "missing" && target.kind === "resolved")) {
        nodes.set(toRel, { kind: target.kind });
      }
      edges.add(`${fromRel}|${toRel}`);
      if (follow && target.kind === "resolved" && !parsed.has(toRel) && !seedSet.has(toRel)) {
        queue.push(target.file);
      }
    }
  }
  return { nodes, edges, conceptual };
}

function groupOf(rel) {
  const dir = path.posix.dirname(rel);
  return dir === "." ? "(repo root)" : dir;
}

export function renderMermaid({ nodes, edges }, targetRel) {
  const lines = [];
  lines.push("---");
  lines.push(`title: Doc link graph for ${targetRel}`);
  lines.push("---");
  lines.push("flowchart LR");

  const groups = new Map();
  for (const [rel, meta] of nodes) {
    const group = groupOf(rel);
    if (!groups.has(group)) {
      groups.set(group, []);
    }
    groups.get(group).push([rel, meta]);
  }

  let groupIndex = 0;
  const missingIds = [];
  for (const [group, members] of [...groups.entries()].sort()) {
    lines.push(`  subgraph sg${groupIndex}["${group}/"]`);
    for (const [rel, meta] of members.sort()) {
      const base = path.basename(rel);
      if (meta.kind === "missing") {
        lines.push(`    ${nodeId(rel)}["${nodeLabel(base)} (missing)"]`);
        missingIds.push(nodeId(rel));
      } else {
        lines.push(`    ${nodeId(rel)}["${nodeLabel(base)}"]`);
      }
    }
    lines.push("  end");
    groupIndex += 1;
  }

  for (const edge of [...edges].sort()) {
    const [fromRel, toRel] = edge.split("|");
    const dashed = nodes.get(toRel)?.kind === "missing";
    lines.push(`  ${nodeId(fromRel)} ${dashed ? "-.->" : "-->"} ${nodeId(toRel)}`);
  }

  if (missingIds.length > 0) {
    lines.push("  classDef missing fill:#fee2e2,stroke:#dc2626,color:#7f1d1d;");
    lines.push(`  class ${missingIds.join(",")} missing;`);
  }
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(repoRoot, args.target);
  if (!existsSync(targetDir) || !statSync(targetDir).isDirectory()) {
    console.error(`Target directory not found: ${targetDir}`);
    process.exit(1);
  }
  const targetRel = relId(targetDir);
  const seeds = markdownFilesUnder(targetDir);
  if (seeds.length === 0) {
    console.error(`No markdown files under ${targetRel}`);
    process.exit(1);
  }

  const graph = buildGraph(seeds, { follow: args.follow });
  const mermaid = renderMermaid(graph, targetRel);

  const outPath = path.resolve(
    repoRoot,
    args.out ?? path.join("docs", `${path.basename(targetRel)}-doc-links.mmd`),
  );
  mkdirSync(path.dirname(outPath), { recursive: true });
  writeFileSync(outPath, mermaid, "utf8");

  const missing = [...graph.nodes].filter(([, meta]) => meta.kind === "missing");
  console.log(`Parsed ${seeds.length} seed docs under ${targetRel}${args.follow ? " (+transitive)" : ""}`);
  console.log(`Graph: ${graph.nodes.size} files, ${graph.edges.size} links -> ${relId(outPath)}`);
  if (missing.length > 0) {
    console.log(`Missing link targets (${missing.length}):`);
    for (const [rel] of missing) {
      console.log(`  - ${rel}`);
    }
  }
  if (graph.conceptual.size > 0) {
    const names = [...graph.conceptual.keys()].sort().join(", ");
    console.log(`Skipped conceptual file names (not paths in this repo): ${names}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
