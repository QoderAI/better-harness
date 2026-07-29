import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeCloc } from "../scripts/cloc/analyze.mjs";
import { countFile, countFilesSummary } from "../scripts/cloc/count-file.mjs";
import { countBufferForLanguage } from "../scripts/cloc/scanners.mjs";

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input: options.input,
  });

  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }

  return result.stdout.trim();
}

async function writeFixtureFile(repo, filePath, content) {
  const absolute = path.join(repo, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function removeFixtureTree(root) {
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

async function makeRepo(files, { ignored = "" } = {}) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);

  if (ignored) {
    await writeFixtureFile(repo, ".gitignore", ignored);
  }
  for (const [filePath, content] of Object.entries(files)) {
    await writeFixtureFile(repo, filePath, content);
  }

  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

function languageRow(result, language) {
  const row = result.languages.find((item) => item.language === language);
  assert.ok(row, `missing ${language} row in ${JSON.stringify(result.languages)}`);
  return row;
}

test("hot scanners count code comments and blanks without quote false positives", () => {
  const js = countBufferForLanguage(Buffer.from([
    "const url = \"http://example.com\";",
    "// full line comment",
    "const block = '/* not comment */';",
    "/* block",
    " * still comment",
    " */",
    "const done = true; // trailing",
    "",
    "",
  ].join("\n")), "javascript");

  assert.deepEqual(js, { blank: 1, comment: 4, code: 3, lines: 8 });

  const rust = countBufferForLanguage(Buffer.from([
    "fn main() {",
    "  /* outer",
    "    /* inner */",
    "  */",
    "}",
  ].join("\n")), "rust");

  assert.deepEqual(rust, { blank: 0, comment: 3, code: 2, lines: 5 });

  const py = countBufferForLanguage(Buffer.from([
    "# comment",
    "value = '# not comment'",
    "value = 1 # trailing",
    "",
    "",
  ].join("\n")), "python");

  assert.deepEqual(py, { blank: 1, comment: 1, code: 2, lines: 4 });
});

test("html and no-comment scanners count template and data files", () => {
  const html = countBufferForLanguage(Buffer.from([
    "<main>",
    "  <!-- comment",
    "    still comment -->",
    "  <span>ok</span>",
    "</main>",
    "",
    "",
  ].join("\n")), "html");

  assert.deepEqual(html, { blank: 1, comment: 2, code: 3, lines: 6 });

  const json = countBufferForLanguage(Buffer.from("{\n  \"a\": 1\n}\n"), "json");
  assert.deepEqual(json, { blank: 0, comment: 0, code: 3, lines: 3 });
});

test("scanner fast paths preserve multiline string lines", () => {
  const js = countBufferForLanguage(Buffer.from([
    "const template = `",
    "",
    "`;",
  ].join("\n")), "javascript");

  assert.deepEqual(js, { blank: 0, comment: 0, code: 3, lines: 3 });
});

test("analyzeCloc uses git exclude-standard and includes untracked visible files", async () => {
  const repo = await makeRepo({
    "src/app.js": "const a = 1;\n// comment\n",
    "ignored.js": "const ignored = true;\n",
    "package-lock.json": JSON.stringify({ lockfileVersion: 3, packages: { "": {} } }, null, 2),
  }, { ignored: "ignored.js\n" });

  try {
    await writeFixtureFile(repo, "src/untracked.ts", "export const b = 2;\n");
    const result = await analyzeCloc({ cwd: repo, workers: 1 });

    assert.equal(result.status, "ok");
    assert.equal(result.fileList.strategy, "git");
    assert.ok(result.files.some((item) => item.path === "src/app.js"));
    assert.ok(result.files.some((item) => item.path === "src/untracked.ts"));
    assert.equal(result.files.some((item) => item.path === "ignored.js"), false);
    assert.equal(result.files.some((item) => item.path === "package-lock.json"), false);
    assert.equal(languageRow(result, "JavaScript").code, 1);
    assert.equal(languageRow(result, "TypeScript").code, 1);

    const trackedOnly = await analyzeCloc({ cwd: repo, workers: 1, trackedOnly: true });
    assert.equal(trackedOnly.fileList.strategy, "git-tracked");
    assert.ok(trackedOnly.files.some((item) => item.path === "src/app.js"));
    assert.equal(trackedOnly.files.some((item) => item.path === "src/untracked.ts"), false);
    assert.equal(trackedOnly.languages.some((item) => item.language === "TypeScript"), false);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("unsupported and lock files are skipped before reading content", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-skip-"));

  try {
    await writeFixtureFile(repo, "archive.zip", "not actually a zip\n");
    await writeFixtureFile(repo, "package-lock.json", JSON.stringify({ lockfileVersion: 3 }));

    assert.deepEqual(countFile(repo, "archive.zip"), {
      path: "archive.zip",
      skipped: true,
      reason: "unsupported",
    });
    assert.deepEqual(countFile(repo, "package-lock.json"), {
      path: "package-lock.json",
      skipped: true,
      reason: "unsupported",
    });
  } finally {
    await removeFixtureTree(repo);
  }
});

test("git-backed cloc skips tracked symlinks without leaking external targets", async (t) => {
  const repo = await makeRepo({
    "src/app.js": "const a = 1;\n",
  });
  const external = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-external-"));

  try {
    const externalTarget = path.join(external, "secret.js");
    await writeFile(externalTarget, "const secret = true;\n");
    try {
      await symlink(externalTarget, path.join(repo, "src", "external-link.js"));
    } catch (error) {
      t.skip(`symlink fixture unavailable on this platform: ${error.code ?? error.message}`);
      return;
    }
    git(repo, ["add", "src/external-link.js"]);
    git(repo, ["commit", "-q", "-m", "track symlink"]);

    const direct = countFile(repo, "src/external-link.js");
    assert.deepEqual(direct, {
      path: "src/external-link.js",
      skipped: true,
      reason: "non-regular",
    });

    const result = await analyzeCloc({ cwd: repo, workers: 1, trackedOnly: true });
    assert.equal(result.status, "ok");
    assert.equal(result.totals.files, 1);
    assert.deepEqual(result.skippedFiles, [{
      path: "src/external-link.js",
      reason: "non-regular",
    }]);
    assert.equal(JSON.stringify(result).includes(externalTarget), false);
  } finally {
    await removeFixtureTree(repo);
    await removeFixtureTree(external);
  }
});

test("cloc skips path candidates outside the repository boundary before reading", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-boundary-"));
  const external = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-boundary-external-"));

  try {
    const externalTarget = path.join(external, "secret.js");
    await writeFile(externalTarget, "const secret = true;\n");
    const escapedPath = path.relative(repo, externalTarget);

    assert.deepEqual(countFile(repo, escapedPath), {
      path: escapedPath.split(path.sep).join("/"),
      skipped: true,
      reason: "outside-repo",
    });
  } finally {
    await removeFixtureTree(repo);
    await removeFixtureTree(external);
  }
});

test("cloc accepts repository paths whose segment begins with two dots", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-dotdot-name-"));

  try {
    await writeFixtureFile(repo, "..generated/app.js", "const generated = true;\n");

    const result = countFile(repo, "..generated/app.js");
    assert.equal(result.skipped, false);
    assert.equal(result.path, "..generated/app.js");
    assert.equal(result.records[0].code, 1);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("worker and single-thread results match for mixed language fixtures", async () => {
  const repo = await makeRepo({
    "src/app.js": "const a = 1;\n// comment\n",
    "src/lib.rs": "fn main() {\n/* outer\n /* inner */\n*/\n}\n",
    "README.md": "# Title\n\n```js\nconst fenced = true;\n```\n",
  });

  try {
    const single = await analyzeCloc({ cwd: repo, workers: 1, markdownCode: true });
    const worker = await analyzeCloc({ cwd: repo, workers: 2, markdownCode: true });

    assert.deepEqual(worker.totals, single.totals);
    assert.deepEqual(worker.languages, single.languages);
    assert.equal(languageRow(worker, "JavaScript").files, 2);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("default worker selection stays conservative for large file sets", async () => {
  const files = {};
  for (let index = 0; index < 520; index += 1) {
    files[`src/file-${index}.js`] = `const value${index} = ${index};\n`;
  }
  const repo = await makeRepo(files);

  try {
    const result = await analyzeCloc({ cwd: repo });

    assert.equal(result.totals.files, 520);
    assert.ok(result.workers >= 1);
    assert.ok(result.workers <= 4);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("summary counting aggregates files without materializing file rows", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-cloc-summary-"));

  try {
    await writeFixtureFile(repo, "src/app.js", "const a = 1;\n// comment\n");
    await writeFixtureFile(repo, "README.md", "# Title\n\n```js\nconst fenced = true;\n```\n");
    await writeFixtureFile(repo, "archive.zip", "skip me\n");

    const summary = countFilesSummary(repo, ["src/app.js", "README.md", "archive.zip"], {
      markdownCode: true,
    });

    assert.equal(summary.totals.files, 2);
    assert.equal(summary.skipped, 1);
    assert.equal(summary.skippedFiles[0].path, "archive.zip");
    assert.equal(summary.languageStats.javascript.files, 2);
    assert.equal(summary.languageStats.markdown.files, 1);
    assert.equal("files" in summary, false);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("special parsers count component sections and notebook code cells", async () => {
  const repo = await makeRepo({
    "src/Widget.vue": [
      "<template>",
      "  <div><!-- template comment --><span>Hi</span></div>",
      "</template>",
      "<script lang=\"ts\">",
      "const msg: string = 'hi';",
      "// script comment",
      "</script>",
      "<style>",
      ".title { color: red; }",
      "</style>",
    ].join("\n"),
    "notebook.ipynb": JSON.stringify({
      metadata: { language_info: { name: "python" } },
      cells: [
        { cell_type: "markdown", source: ["# ignored\n"] },
        { cell_type: "code", source: ["# comment\n", "x = 1\n", "\n", "print(x)\n"] },
      ],
    }),
  });

  try {
    const result = await analyzeCloc({ cwd: repo, workers: 1 });

    assert.equal(languageRow(result, "Vue Template").code, 3);
    assert.equal(languageRow(result, "TypeScript").code, 1);
    assert.equal(languageRow(result, "TypeScript").comment, 1);
    assert.equal(languageRow(result, "CSS").code, 1);
    assert.equal(languageRow(result, "Python").code, 2);
    assert.equal(languageRow(result, "Python").comment, 1);
  } finally {
    await removeFixtureTree(repo);
  }
});

test("cli emits parser-safe json", async () => {
  const repo = await makeRepo({
    "src/app.mjs": "export const value = 1;\n",
  });

  try {
    const cli = path.join(process.cwd(), "scripts/cloc/cli.mjs");
    assert.equal(existsSync(cli), true);
    const result = spawnSync(process.execPath, [
      cli,
      "--cwd",
      repo,
      "--json",
      "--workers",
      "1",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "cloc");
    assert.equal(report.totals.files, 1);
    assert.equal("files" in report, false);
    assert.equal(languageRow(report, "JavaScript").code, 1);
  } finally {
    await removeFixtureTree(repo);
  }
});
