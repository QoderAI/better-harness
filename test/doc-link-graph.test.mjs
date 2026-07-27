import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  buildGraph,
  classify,
  markdownFilesUnder,
  renderMermaid,
  repoRoot,
  relId,
} from "../scripts/doc-link-graph/cli.mjs";

const DOC_DIRS = [
  "skills",
  "references",
  "templates",
  "models",
  "docs",
  "case-studies",
  "hooks",
  "schemas",
];
const ROOT_DOCS = ["AGENTS.md", "README.md"];
const MD_TOKEN = /(?:\.\.?\/)*(?:[\w.-]+\/)*[\w.-]+\.md\b/g;

function allRepoDocs() {
  const seeds = [];
  for (const dir of DOC_DIRS) {
    const full = path.join(repoRoot, dir);
    if (existsSync(full)) {
      seeds.push(...markdownFilesUnder(full));
    }
  }
  for (const doc of ROOT_DOCS) {
    const full = path.join(repoRoot, doc);
    if (existsSync(full)) {
      seeds.push(full);
    }
  }
  return seeds;
}

test("all relative markdown doc links across the repo resolve", () => {
  const broken = [];
  for (const file of allRepoDocs()) {
    const text = readFileSync(file, "utf8");
    for (const token of new Set([...text.matchAll(MD_TOKEN)].map((m) => m[0]))) {
      if (classify(token, file).kind === "missing") {
        broken.push(`${relId(file)} -> ${token}`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    `Broken doc links (fix the reference or the moved file):\n${broken.join("\n")}`,
  );
});

test("Better Harness skill doc graph has no missing link targets", () => {
  const seeds = markdownFilesUnder(path.join(repoRoot, "skills/better-harness"));
  const graph = buildGraph(seeds, { follow: true });
  const missing = [...graph.nodes].filter(([, meta]) => meta.kind === "missing").map(([rel]) => rel);
  assert.deepEqual(missing, [], `Unresolvable link targets: ${missing.join(", ")}`);
});

test("Better Harness skill's English-first Markdown chain stays Han-script-free", () => {
  const skill = path.join(repoRoot, "skills/better-harness/SKILL.md");
  const graph = buildGraph([skill], { follow: true });
  const offenders = [];

  for (const [relativePath, meta] of graph.nodes) {
    if (meta.kind !== "resolved" || !relativePath.endsWith(".md")) continue;
    const lines = readFileSync(path.join(repoRoot, relativePath), "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (/\p{Script=Han}/u.test(line)) offenders.push(`${relativePath}:${index + 1}`);
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Han-script text must stay in locale-specific runtime owners, not the English-first Harness Markdown chain:\n${offenders.join("\n")}`,
  );
});

test("Better Harness skill routing references stay connected to SKILL.md", () => {
  const seeds = markdownFilesUnder(path.join(repoRoot, "skills/better-harness"));
  const graph = buildGraph(seeds, { follow: false });
  const skillEdges = [...graph.edges].filter((edge) => edge.startsWith("skills/better-harness/SKILL.md|"));
  // Every reference doc shipped with the skill must be reachable from
  // SKILL.md, otherwise agents can never be routed to it.
  for (const seed of seeds) {
    const rel = relId(seed);
    if (rel === "skills/better-harness/SKILL.md") {
      continue;
    }
    const reachable = [...graph.edges].some((edge) => edge.endsWith(`|${rel}`));
    assert.ok(reachable, `${rel} is not linked from any harness doc`);
  }
  assert.ok(skillEdges.length > 0, "SKILL.md should link to its reference docs");
});

test("generated mermaid graph in docs/ is current and parseable shape", () => {
  const seeds = markdownFilesUnder(path.join(repoRoot, "skills/better-harness"));
  const graph = buildGraph(seeds, { follow: false });
  const expected = renderMermaid(graph, "skills/better-harness");
  const generatedPath = path.join(repoRoot, "docs/better-harness-doc-links.mmd");
  assert.ok(existsSync(generatedPath), "docs/better-harness-doc-links.mmd is missing; run: node scripts/doc-link-graph/cli.mjs skills/better-harness");
  const actual = readFileSync(generatedPath, "utf8").replaceAll("\r\n", "\n");
  assert.equal(
    actual,
    expected,
    "docs/better-harness-doc-links.mmd is stale; regenerate with: node scripts/doc-link-graph/cli.mjs skills/better-harness",
  );
  assert.match(actual, /^flowchart LR$/mu);
});
