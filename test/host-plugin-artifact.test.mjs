import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { artifactPackage, buildHostPluginArtifact } from "../scripts/packaging/build-host-plugin.mjs";
import {
  ARTIFACT_KIND,
  ARTIFACT_MARKER,
  ARTIFACT_SCHEMA_VERSION,
  verifyHostPluginArtifact,
} from "../scripts/packaging/verify-host-plugin.mjs";
import { createBundle } from "../scripts/npm-package/create-bundle.mjs";

function zipEntryNames(buffer) {
  const entries = new Set();
  let offset = 0;
  while (offset < buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const nameStart = offset + 30;
    const nameEnd = nameStart + nameLength;
    entries.add(buffer.toString("utf8", nameStart, nameEnd));
    offset = nameEnd + extraLength + compressedSize;
  }
  return entries;
}

test("runtime bundle includes the project license and runtime docs", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-runtime-bundle-"));
  const bundlePath = path.join(root, "better-harness-runtime.zip");

  try {
    const bundle = createBundle({ out: bundlePath });
    const archiveEntries = zipEntryNames(await readFile(bundlePath));
    for (const requiredPath of [
      "AGENTS.md",
      "LICENSE",
      "CHANGELOG.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "case-studies/factory/model/factory-readiness.md",
      "docs/glossary.md",
      "vendor/tree-sitter-wasm/LICENSE",
      "vendor/esbuild-wasm/LICENSE.md",
    ]) {
      assert.ok(bundle.entries.includes(requiredPath), requiredPath);
      assert.ok(archiveEntries.has(requiredPath), requiredPath);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host artifact package metadata preserves public source metadata", () => {
  const repository = { type: "git", url: "https://example.test/better-harness.git" };
  const generated = artifactPackage({
    name: "example",
    version: "1.2.3",
    license: "Apache-2.0",
    repository,
    homepage: "https://example.test/better-harness",
  });

  assert.equal(generated.private, true);
  assert.equal(generated.license, "Apache-2.0");
  assert.deepEqual(generated.repository, repository);
  assert.equal(generated.homepage, "https://example.test/better-harness");
  assert.throws(
    () => artifactPackage({ name: "example", version: "1.2.3" }),
    /Source package\.json must declare a license/,
  );
});

async function writeArtifactFile(root, relativePath, content = "fixture\n") {
  const filePath = path.join(root, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, content);
}

async function createMinimalHostArtifact(root) {
  for (const relativePath of [
    "LICENSE",
    "README.md",
    "AGENTS.md",
    "CHANGELOG.md",
    "CODE_OF_CONDUCT.md",
    "CONTRIBUTING.md",
    "case-studies/factory/model/factory-readiness.md",
    "docs/glossary.md",
    "hooks/hooks.json.template",
    "models/routing.md",
    "references/README.md",
    "references/loop-engineering/loop-blueprint.md",
    "scripts/better-harness.mjs",
    "skills/better-harness/SKILL.md",
    "templates/reporting/routing.md",
    "node_modules/@vscode/tree-sitter-wasm/package.json",
    "node_modules/@vscode/tree-sitter-wasm/LICENSE",
    "node_modules/esbuild-wasm/package.json",
    "node_modules/esbuild-wasm/LICENSE.md",
  ]) {
    await writeArtifactFile(root, relativePath);
  }
  await writeArtifactFile(root, ".codex-plugin/plugin.json", `${JSON.stringify({
    name: "better-harness",
    version: "1.2.3",
    skills: "./skills/",
  })}\n`);
  await writeArtifactFile(root, "package.json", `${JSON.stringify({
    name: "example",
    version: "1.2.3",
    private: true,
    license: "MIT",
  })}\n`);
  await writeArtifactFile(root, ARTIFACT_MARKER, `${JSON.stringify({
    kind: ARTIFACT_KIND,
    schemaVersion: ARTIFACT_SCHEMA_VERSION,
    host: "codex",
    pluginName: "better-harness",
    version: "1.2.3",
  })}\n`);
}

test("host artifact verifier requires license file and metadata", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-license-verifier-"));
  const pluginRoot = path.join(root, "better-harness");

  try {
    await createMinimalHostArtifact(pluginRoot);
    await verifyHostPluginArtifact(pluginRoot);

    await rm(path.join(pluginRoot, "LICENSE"));
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /Missing required artifact file: LICENSE/,
    );
    await writeArtifactFile(pluginRoot, "LICENSE");

    const dependencyLicense = path.join(
      pluginRoot,
      "node_modules",
      "@vscode",
      "tree-sitter-wasm",
      "LICENSE",
    );
    await rm(dependencyLicense);
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /Missing required artifact file: node_modules.*tree-sitter-wasm.*LICENSE/u,
    );
    await writeArtifactFile(pluginRoot, "node_modules/@vscode/tree-sitter-wasm/LICENSE");

    const packageJsonPath = path.join(pluginRoot, "package.json");
    const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
    delete packageJson.license;
    await writeFile(packageJsonPath, `${JSON.stringify(packageJson)}\n`);
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /package\.json must declare a license/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host artifact verifier rejects the retired Harness skill", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-skill-verifier-"));
  const pluginRoot = path.join(root, "better-harness");

  try {
    await createMinimalHostArtifact(pluginRoot);
    await writeArtifactFile(pluginRoot, "skills/harness/SKILL.md");
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /Artifact contains retired skill: skills\/harness/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host artifact verifier rejects the retired logo asset", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-logo-verifier-"));
  const pluginRoot = path.join(root, "better-harness");

  try {
    await createMinimalHostArtifact(pluginRoot);
    await writeArtifactFile(pluginRoot, "assets/logo.svg", "<svg/>\n");
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /Artifact contains forbidden path: assets\/logo\.svg/u,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Codex host plugin artifact is isolated, portable, and replaceable", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-plugin-"));
  const pluginRoot = path.join(root, "better-harness");

  try {
    const first = await buildHostPluginArtifact({ outputRoot: pluginRoot });
    assert.equal(first.host, "codex");
    assert.equal(first.pluginName, "better-harness");
    assert.equal(first.replaced, false);
    assert.ok(first.fileCount > 100);
    assert.ok(first.totalBytes > 1_000_000);

    const manifest = JSON.parse(await readFile(path.join(pluginRoot, ".codex-plugin", "plugin.json"), "utf8"));
    const packageJson = JSON.parse(await readFile(path.join(pluginRoot, "package.json"), "utf8"));
    const sourcePackageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    const sourceLicense = await readFile(path.resolve("LICENSE"), "utf8");
    assert.equal(manifest.version, packageJson.version);
    assert.equal(packageJson.private, true);
    assert.equal(packageJson.license, sourcePackageJson.license);
    assert.equal(await readFile(path.join(pluginRoot, "LICENSE"), "utf8"), sourceLicense);
    if (sourcePackageJson.repository !== undefined) {
      assert.deepEqual(packageJson.repository, sourcePackageJson.repository);
    }
    if (sourcePackageJson.homepage !== undefined) {
      assert.equal(packageJson.homepage, sourcePackageJson.homepage);
    }
    for (const requiredPath of [
      "AGENTS.md",
      "CHANGELOG.md",
      "CODE_OF_CONDUCT.md",
      "CONTRIBUTING.md",
      "case-studies/factory/model/factory-readiness.md",
      "docs/glossary.md",
      "node_modules/@vscode/tree-sitter-wasm/LICENSE",
      "node_modules/esbuild-wasm/LICENSE.md",
    ]) {
      assert.equal((await lstat(path.join(pluginRoot, requiredPath))).isFile(), true, requiredPath);
    }

    for (const forbidden of [
      ".agents",
      ".claude-plugin",
      ".cursor-plugin",
      ".idea",
      ".qoder",
      ".qoder-plugin",
      "benchmark",
      "dev",
      "test",
      path.join("assets", "logo.svg"),
      path.join("scripts", "packaging"),
      path.join("skills", "loop-blueprint"),
      path.join("skills", "harness"),
    ]) {
      assert.equal(await lstat(path.join(pluginRoot, forbidden)).catch(() => null), null, forbidden);
    }

    for (const dependency of ["@vscode/tree-sitter-wasm", "esbuild-wasm"]) {
      const stats = await lstat(path.join(pluginRoot, "node_modules", dependency, "package.json"));
      assert.equal(stats.isFile(), true);
      assert.equal(stats.isSymbolicLink(), false);
    }

    const cli = spawnSync(process.execPath, [path.join(pluginRoot, "scripts", "better-harness.mjs"), "--help"], {
      cwd: pluginRoot,
      encoding: "utf8",
    });
    assert.equal(cli.status, 0, cli.stderr);
    assert.match(cli.stdout, /Better Harness CLI/);

    const second = await buildHostPluginArtifact({ outputRoot: pluginRoot });
    assert.equal(second.replaced, true);
    assert.equal(second.version, first.version);

    await mkdir(path.join(pluginRoot, ".qoder-plugin"));
    await writeFile(path.join(pluginRoot, ".qoder-plugin", "plugin.json"), "{}\n");
    await assert.rejects(
      verifyHostPluginArtifact(pluginRoot),
      /forbidden top-level path: \.qoder-plugin/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host plugin builder refuses to replace an unowned directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-plugin-unowned-"));
  const pluginRoot = path.join(root, "better-harness");

  try {
    await mkdir(pluginRoot);
    await writeFile(path.join(pluginRoot, "keep.txt"), "user-owned\n");
    await assert.rejects(
      buildHostPluginArtifact({ outputRoot: pluginRoot }),
      /Refusing to replace unowned output directory/,
    );
    assert.equal(await readFile(path.join(pluginRoot, "keep.txt"), "utf8"), "user-owned\n");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host plugin builder requires the stable product directory name", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-plugin-name-"));

  try {
    await assert.rejects(
      buildHostPluginArtifact({ outputRoot: path.join(root, "unexpected-name") }),
      /must be named better-harness/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("host plugin builder refuses output inside canonical source roots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-host-plugin-overlap-"));
  const repoRoot = path.join(root, "repo");
  const outputRoot = path.join(repoRoot, "scripts", "better-harness");

  try {
    await mkdir(path.dirname(outputRoot), { recursive: true });
    await assert.rejects(
      buildHostPluginArtifact({ repoRoot, outputRoot }),
      /must not overlap canonical source roots/,
    );
    assert.equal(await lstat(outputRoot).catch(() => null), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
