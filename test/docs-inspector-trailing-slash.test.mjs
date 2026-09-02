import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

import { aliasInspectorTrailingSlash } from "../docs/scripts/alias-inspector-trailing-slash.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const CANONICAL_INSPECTOR_URL = "https://qoderai.github.io/better-harness/inspector";

test("GitHub Pages static lookup serves Inspector with and without a trailing slash (AC-1)", async () => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "inspector-slash-"));
  try {
    const english = "<!doctype html><title>Harness Inspector | Better Harness</title>";
    const chinese = `${english}<html lang="zh-Hans">`;
    await writeFile(path.join(buildRoot, "inspector.html"), english);
    await mkdir(path.join(buildRoot, "zh-Hans"));
    await writeFile(path.join(buildRoot, "zh-Hans", "inspector.html"), chinese);
    await writeFile(path.join(buildRoot, "404.html"), "Not Found");

    const written = aliasInspectorTrailingSlash(buildRoot);

    assert.equal(written.length, 2);
    const englishAlias = await readFile(path.join(buildRoot, "inspector", "index.html"), "utf8");
    const chineseAlias = await readFile(
      path.join(buildRoot, "zh-Hans", "inspector", "index.html"),
      "utf8",
    );
    assert.equal(englishAlias, english);
    assert.equal(chineseAlias, chinese);
    assert.notEqual(englishAlias, "Not Found");
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
});

test("aliasing Inspector trailing-slash HTML fails when the page is missing (AC-1)", async () => {
  const buildRoot = await mkdtemp(path.join(os.tmpdir(), "inspector-slash-missing-"));
  try {
    await writeFile(path.join(buildRoot, "404.html"), "Not Found");
    assert.throws(() => aliasInspectorTrailingSlash(buildRoot), /No inspector\.html found/u);
  } finally {
    await rm(buildRoot, { recursive: true, force: true });
  }
});

test("docs production build aliases Inspector HTML after Docusaurus (AC-1)", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "docs", "package.json"), "utf8"));
  assert.equal(pkg.scripts.postbuild, "node scripts/alias-inspector-trailing-slash.mjs");
});

test("homepage and navbar Inspector links are slash-less (AC-2, AC-5)", async () => {
  const homepage = await readFile(path.join(repoRoot, "docs", "src", "pages", "index.js"), "utf8");
  const config = await readFile(path.join(repoRoot, "docs", "docusaurus.config.js"), "utf8");
  const inspectorPage = await readFile(
    path.join(repoRoot, "docs", "src", "pages", "inspector", "index.js"),
    "utf8",
  );

  assert.equal(extractUseBaseUrl(homepage, "inspectorUrl"), "/inspector");
  assert.equal(extractNavbarTo(config, "Inspector"), "/inspector");
  assert.equal(extractUseBaseUrl(inspectorPage, "demoUrl"), "/demo/harness-inspector/");
});

test("README Inspector sample URLs are slash-less (AC-3)", async () => {
  for (const relative of ["README.md", "README.zh-CN.md"]) {
    const markdown = await readFile(path.join(repoRoot, relative), "utf8");
    const hrefs = [...markdown.matchAll(/https:\/\/qoderai\.github\.io\/better-harness\/inspector\/?/gu)]
      .map((match) => match[0]);
    assert.ok(hrefs.length > 0, relative);
    assert.deepEqual([...new Set(hrefs)], [CANONICAL_INSPECTOR_URL]);
  }
});

function extractUseBaseUrl(source, binding) {
  const match = source.match(new RegExp(`const ${binding} = useBaseUrl\\("([^"]+)"\\);`));
  assert.ok(match, `missing useBaseUrl binding ${binding}`);
  return match[1];
}

function extractNavbarTo(source, label) {
  const match = source.match(new RegExp(`to:\\s*"([^"]+)",\\s*label:\\s*"${label}"`));
  assert.ok(match, `missing navbar item ${label}`);
  return match[1];
}
