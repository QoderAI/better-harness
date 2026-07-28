import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const skippedDirectories = new Set([
  ".codex",
  ".git",
  ".idea",
  ".qoder",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "vendor",
]);
const textFilePattern =
  /(?:^|\.)(?:cjs|css|csv|graphql|html|ini|java|js|json|jsx|md|mjs|mmd|py|rs|scss|sh|svg|toml|ts|tsx|txt|xml|yaml|yml)$/i;
const retiredTerms = [
  {
    label: "retired source codename",
    pattern: new RegExp(`(^|[^A-Za-z])${["co", "sy"].join("")}`, "i"),
  },
  {
    label: "retired IDE product name",
    pattern: new RegExp(["ling", "ma"].join(""), "i"),
  },
  {
    label: "personal username",
    pattern: new RegExp(["pho", "dal"].join(""), "i"),
  },
];
const historicalPathPrefixes = [
  "dev/terminal-demo/",
  "docs/specs/",
  "test/terminal-demo.test.mjs",
];

async function textFiles(root) {
  const files = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!skippedDirectories.has(entry.name)) {
        files.push(...(await textFiles(path.join(root, entry.name))));
      }
      continue;
    }
    if (entry.isFile() && textFilePattern.test(entry.name)) {
      files.push(path.join(root, entry.name));
    }
  }
  return files;
}

test("maintained text does not contain retired product names", async () => {
  const violations = [];
  for (const filePath of await textFiles(repoRoot)) {
    const relativePath = path.relative(repoRoot, filePath).replaceAll(path.sep, "/");
    if (historicalPathPrefixes.some((prefix) => relativePath.startsWith(prefix))) continue;
    const lines = (await readFile(filePath, "utf8")).split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      for (const term of retiredTerms) {
        if (term.pattern.test(line)) {
          violations.push(`${path.relative(repoRoot, filePath)}:${index + 1} (${term.label})`);
        }
      }
    }
  }

  assert.deepEqual(violations, []);
});
