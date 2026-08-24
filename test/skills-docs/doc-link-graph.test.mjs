import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { test } from "vitest";

import {
  buildGraph,
  classify,
  markdownFilesUnder,
  renderMermaid,
  repoRoot,
  relId,
} from "../../scripts/doc-link-graph/cli.mjs";

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
// Docs that cannot reach a target with a relative path — the Docusaurus site
// tree, and repository docs that ship inside a host plugin artifact whose
// allowlist excludes `.agents/` and `.github/` — cite it as a repository URL
// instead. Those citations are real links to real files, so they need the same
// integrity guarantee a relative link gets.
const REPO_BLOB_URL = /https:\/\/github\.com\/QoderAI\/better-harness\/blob\/([^/\s)]+)\/([^)\s#]+)/g;
const PINNED_COMMIT = /^[0-9a-f]{40}$/u;
// A bare `foo.md` link usually names a file convention in an analyzed target
// repository rather than a file here, which is why `classify` leaves it
// conceptual. These names are the conventions; anything else that is written as
// link syntax is meant to resolve.
const CONVENTION_DOC_NAMES = new Set([
  "AGENTS.md",
  "CHANGELOG.md",
  "CLAUDE.local.md",
  "CLAUDE.md",
  "CODEX.md",
  "CONTRIBUTING.md",
  "DESIGN.md",
  "GEMINI.md",
  "MEMORY.md",
  "QODER.md",
  "README.md",
  "SECURITY.md",
  "SKILL.md",
  "SUPPORT.md",
  "report.md",
]);
const MARKDOWN_LINK = /\]\(([^)\s#]+\.md)(?:#[^)]*)?\)/g;
const MD_TOKEN = /(?:\.\.?\/)*(?:[\w.-]+\/)*[\w.-]+\.md\b/g;
// Bilingual reader surfaces: the Docusaurus site tree (including its zh-Hans
// locale mirror and specs that quote Chinese reader copy) and the root README
// pair. Skill docs cite them for human readers, but an agent does not load them
// as routing, so they are outside the English-first chain rather than
// suppressed violations of it.
const READER_SURFACE_PREFIXES = ["docs/", "README.md", "README.zh-CN.md"];
// Guards against an over-broad prefix silently emptying the scan; the chain
// held 107 agent-loadable docs when this floor was set.
const MIN_ENGLISH_FIRST_DOCS = 50;

function isReaderSurface(relativePath) {
  return READER_SURFACE_PREFIXES.some(
    (prefix) => relativePath === prefix || relativePath.startsWith(prefix),
  );
}

test("doc-link graph uses the canonical CLI and POSIX repository paths", () => {
  assert.equal(existsSync(path.join(repoRoot, "scripts", "doc-link-graph.mjs")), false);
  const skillPath = path.join(repoRoot, "skills", "better-harness", "SKILL.md");
  assert.equal(relId(skillPath), "skills/better-harness/SKILL.md");
  assert.doesNotMatch(relId(skillPath), /\\/u);
});

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

test("repository URLs pointing at a mutable ref resolve to real files", () => {
  // A relative link rots loudly when its target moves, because the link graph
  // fails. A repository URL rots silently. Checking the path component keeps
  // both citation styles under the same guarantee. Commit-pinned URLs are
  // deliberate references to history and stay out of scope.
  const broken = [];
  for (const file of allRepoDocs()) {
    for (const [, ref, target] of readFileSync(file, "utf8").matchAll(REPO_BLOB_URL)) {
      if (PINNED_COMMIT.test(ref)) continue;
      if (!existsSync(path.join(repoRoot, target))) {
        broken.push(`${relId(file)} -> ${ref}/${target}`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    `Repository URLs whose path no longer exists:\n${broken.join("\n")}`,
  );
});

test("bare filename markdown links resolve unless they name a file convention", () => {
  // `classify` cannot tell `custom-agents-review.md` (a real sibling doc one
  // directory up) from `AGENTS.md` (a convention in a repository under
  // analysis), so it treats every slash-free token as conceptual and checks
  // neither. Restricting the check to link syntax and excluding the convention
  // names recovers the first case without reintroducing false positives.
  const broken = [];
  for (const file of allRepoDocs()) {
    for (const [, target] of readFileSync(file, "utf8").matchAll(MARKDOWN_LINK)) {
      if (target.includes("/") || target.startsWith(".") || CONVENTION_DOC_NAMES.has(target)) continue;
      if (!existsSync(path.resolve(path.dirname(file), target))) {
        broken.push(`${relId(file)} -> ${target}`);
      }
    }
  }
  assert.deepEqual(
    broken,
    [],
    `Bare filename links that do not resolve next to their doc:\n${broken.join("\n")}`,
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
  let scanned = 0;

  for (const [relativePath, meta] of graph.nodes) {
    if (meta.kind !== "resolved" || !relativePath.endsWith(".md")) continue;
    if (isReaderSurface(relativePath)) continue;
    scanned += 1;
    const lines = readFileSync(path.join(repoRoot, relativePath), "utf8").split(/\r?\n/u);
    for (const [index, line] of lines.entries()) {
      if (/\p{Script=Han}/u.test(line)) offenders.push(`${relativePath}:${index + 1}`);
    }
  }

  assert.ok(
    scanned >= MIN_ENGLISH_FIRST_DOCS,
    `only ${scanned} agent-loadable docs were scanned; the reader-surface exclusion is too broad`,
  );
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
