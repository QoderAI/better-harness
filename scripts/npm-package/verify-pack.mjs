#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import os from "node:os";
import path from "node:path";

import { createBundle } from "./create-bundle.mjs";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDir, "..", "..");
function fail(message) {
  process.stderr.write(`pack verification failed: ${message}\n`);
  process.exit(1);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} exited ${result.status}\n${result.error?.message ?? result.stderr}`);
  }
  return result.stdout;
}

function npmInvocation(args) {
  const npmCliCandidates = [
    process.env.npm_execpath,
    process.platform === "win32"
      ? path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js")
      : null,
  ];
  const npmCli = npmCliCandidates.find((candidate) => candidate && existsSync(candidate));
  if (npmCli) {
    return { command: process.execPath, args: [npmCli, ...args] };
  }
  return { command: "npm", args };
}

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function verifyReleaseVersionAlignment() {
  const packageVersion = readJson("package.json").version;
  const versions = [
    [".qoder-plugin/plugin.json", readJson(".qoder-plugin/plugin.json").version],
    [".claude-plugin/plugin.json", readJson(".claude-plugin/plugin.json").version],
    [".claude-plugin/marketplace.json", readJson(".claude-plugin/marketplace.json").plugins?.[0]?.version],
    [".codex-plugin/plugin.json", readJson(".codex-plugin/plugin.json").version],
    [".cursor-plugin/plugin.json", readJson(".cursor-plugin/plugin.json").version],
  ];
  for (const [source, version] of versions) {
    if (version !== packageVersion) {
      fail(`${source} version ${version ?? "<missing>"} does not match package.json ${packageVersion}`);
    }
  }
}

function parsePackOutput(stdout) {
  try {
    const packs = JSON.parse(stdout);
    const pack = packs?.[0];
    if (!pack?.filename) {
      fail("npm pack did not report a tarball filename");
    }
    if (!Array.isArray(pack.files)) {
      fail("npm pack did not report packaged files");
    }
    return {
      filename: pack.filename,
      entries: new Set(pack.files.map((file) => `package/${file.path}`)),
    };
  } catch (error) {
    fail(`could not parse npm pack output: ${error.message}`);
  }
}

function zipEntries(filename) {
  const buffer = readFileSync(filename);
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

function hasPrefix(entries, prefix) {
  return [...entries].some((entry) => entry.startsWith(prefix));
}

function hasPathSegment(entries, segment) {
  return [...entries].some((entry) => entry.split("/").includes(segment));
}

function verifyPreviewScriptTarget(entries, packageJson, scriptName, prefix = "package/") {
  const command = packageJson.scripts?.[scriptName];
  const match = /^node\s+([^\s]+\.mjs)(?:\s|$)/u.exec(command ?? "");
  if (!match) {
    fail(`package.json script ${scriptName} must directly invoke a .mjs entrypoint`);
  }
  const entry = `${prefix}${match[1].replaceAll("\\", "/")}`;
  if (!entries.has(entry)) {
    fail(`package.json script ${scriptName} targets missing packaged entry ${entry}`);
  }
}

const keep = process.argv.includes("--keep");
verifyReleaseVersionAlignment();
const packageJson = readJson("package.json");
const npmPack = npmInvocation(["pack", "--json"]);
const pack = parsePackOutput(run(npmPack.command, npmPack.args));
const entries = pack.entries;

const required = [
  "package/package.json",
  "package/README.md",
  "package/AGENTS.md",
  "package/LICENSE",
  "package/CHANGELOG.md",
  "package/CODE_OF_CONDUCT.md",
  "package/CONTRIBUTING.md",
  "package/.qoder-plugin/plugin.json",
  "package/case-studies/factory/model/factory-readiness.md",
  "package/docs/glossary.md",
  "package/scripts/better-harness.mjs",
  "package/scripts/findings-recommend/findings-recommend.json",
  "package/scripts/findings-recommend/index.mjs",
  "package/scripts/review-trigger/cli.mjs",
  "package/scripts/coding-agent-practices/asset-baseline.mjs",
  "package/scripts/npm-package/create-bundle.mjs",
  "package/scripts/harness-analysis/canvas-preview/cli.mjs",
  "package/scripts/harness-analysis/canvas-preview/fixture.mjs",
  "package/scripts/harness-analysis/canvas-preview/index.mjs",
  "package/scripts/harness-analysis/canvas-preview/platform.mjs",
  "package/scripts/harness-analysis/canvas-preview/runtime.mjs",
  "package/scripts/harness-analysis/canvas-preview/server.mjs",
  "package/scripts/harness-analysis/canvas-preview/transform.mjs",
  "package/scripts/harness-analysis/canvas-preview-server.mjs",
  "package/scripts/harness-analysis/canvas-module-boundaries.mjs",
  "package/scripts/harness-analysis/evidence-bundle/cli.mjs",
  "package/scripts/harness-analysis/evidence-bundle/contract.mjs",
  "package/scripts/harness-analysis/evidence-bundle/index.mjs",
  "package/scripts/harness-analysis/evidence-bundle/session-evidence.mjs",
  "package/scripts/harness-analysis/evidence-bundle/project-harness.mjs",
  "package/scripts/harness-analysis/evidence-bundle/agent-customize.mjs",
  "package/scripts/harness-analysis/report-source/apply-review.mjs",
  "package/scripts/harness-analysis/report-source/episode-review.mjs",
  "package/scripts/harness-analysis/report-source/index.mjs",
  "package/scripts/harness-analysis/report-source/review-packet.mjs",
  "package/scripts/harness-analysis/report-source/source.mjs",
  "package/scripts/harness-analysis/apply-source-review.mjs",
  "package/scripts/harness-analysis/episode-evidence-review.mjs",
  "package/scripts/harness-analysis/report-review-packet.mjs",
  "package/scripts/harness-analysis/report-source.mjs",
  "package/scripts/harness-analysis/record-fix-output.mjs",
  "package/scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "package/scripts/session-analysis/episode-facts.mjs",
  "package/scripts/session-analysis/result-facts.mjs",
  "package/scripts/session-analysis/session-core-facts.mjs",
  "package/references/loop-engineering/loop-blueprint.md",
  "package/skills/better-harness/SKILL.md",
  "package/skills/better-harness/references/agent-customize.md",
  "package/skills/better-harness/references/asset-demand-reconciliation.md",
  "package/skills/better-harness/references/findings-review.md",
  "package/skills/better-harness/references/finding-bound-fix.md",
  "package/skills/better-harness/references/session-repeated-workflows.md",
  "package/skills/better-harness/references/session-evidence.md",
  "package/skills/better-harness/references/project-harness.md",
  "package/templates/reporting/harness-findings.input.json",
  "package/references/project-harness/design-md-contract.md",
  "package/references/session-evidence/README.md",
  "package/references/project-harness/README.md",
  "package/references/agent-customize/README.md",
  "package/case-studies/project-harness/design-md-complete-example.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "package/case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "package/case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
  "package/hooks/hooks.json.template",
  "package/hooks/git-scripts/blast-radius/parser.mjs",
];

const forbiddenPrefixes = [
  "package/.claude-plugin/",
  "package/.codex-plugin/",
  "package/.cursor-plugin/",
  "package/test/",
  "package/dev/",
  "package/.idea/",
  "package/.qoder/",
  "package/assets/wasm/",
  "package/node_modules/",
  "package/node_modules/esbuild-wasm/",
  "package/scripts/packaging/",
  "package/skills/loop-blueprint/",
  "package/skills/harness/",
];

for (const entry of required) {
  if (!entries.has(entry)) {
    fail(`missing required entry ${entry}`);
  }
}
verifyPreviewScriptTarget(entries, packageJson, "preview");
verifyPreviewScriptTarget(entries, packageJson, "preview:canvas");

for (const prefix of forbiddenPrefixes) {
  if (hasPrefix(entries, prefix)) {
    fail(`unexpected packaged path ${prefix}`);
  }
}
if (hasPathSegment(entries, ".plugin-eval")) {
  fail("npm package contains generated .plugin-eval state");
}

if (!keep) {
  rmSync(path.resolve(repoRoot, pack.filename), { force: true });
}

const tempDir = mkdtempSync(path.join(os.tmpdir(), "better-harness-pack-"));
const bundlePath = path.join(tempDir, "better-harness-runtime.zip");
const bundle = createBundle({ out: bundlePath });
const bundleEntries = zipEntries(bundlePath);
const requiredBundleEntries = [
  "package.json",
  "README.md",
  "AGENTS.md",
  "LICENSE",
  "CHANGELOG.md",
  "CODE_OF_CONDUCT.md",
  "CONTRIBUTING.md",
  ".qoder-plugin/plugin.json",
  "case-studies/factory/model/factory-readiness.md",
  "docs/glossary.md",
  "scripts/better-harness.mjs",
  "scripts/findings-recommend/findings-recommend.json",
  "scripts/findings-recommend/index.mjs",
  "scripts/review-trigger/cli.mjs",
  "scripts/coding-agent-practices/asset-baseline.mjs",
  "scripts/harness-analysis/canvas-preview/cli.mjs",
  "scripts/harness-analysis/canvas-preview/fixture.mjs",
  "scripts/harness-analysis/canvas-preview/index.mjs",
  "scripts/harness-analysis/canvas-preview/platform.mjs",
  "scripts/harness-analysis/canvas-preview/runtime.mjs",
  "scripts/harness-analysis/canvas-preview/server.mjs",
  "scripts/harness-analysis/canvas-preview/transform.mjs",
  "scripts/harness-analysis/canvas-preview-server.mjs",
  "scripts/harness-analysis/canvas-module-boundaries.mjs",
  "scripts/harness-analysis/evidence-bundle/cli.mjs",
  "scripts/harness-analysis/evidence-bundle/contract.mjs",
  "scripts/harness-analysis/evidence-bundle/index.mjs",
  "scripts/harness-analysis/evidence-bundle/session-evidence.mjs",
  "scripts/harness-analysis/evidence-bundle/project-harness.mjs",
  "scripts/harness-analysis/evidence-bundle/agent-customize.mjs",
  "scripts/harness-analysis/report-source/apply-review.mjs",
  "scripts/harness-analysis/report-source/episode-review.mjs",
  "scripts/harness-analysis/report-source/index.mjs",
  "scripts/harness-analysis/report-source/review-packet.mjs",
  "scripts/harness-analysis/report-source/source.mjs",
  "scripts/harness-analysis/apply-source-review.mjs",
  "scripts/harness-analysis/episode-evidence-review.mjs",
  "scripts/harness-analysis/report-review-packet.mjs",
  "scripts/harness-analysis/report-source.mjs",
  "scripts/harness-analysis/record-fix-output.mjs",
  "scripts/harness-analysis/preview-support/canvas-transform.mjs",
  "scripts/session-analysis/episode-facts.mjs",
  "scripts/session-analysis/result-facts.mjs",
  "scripts/session-analysis/session-core-facts.mjs",
  "references/loop-engineering/loop-blueprint.md",
  "skills/better-harness/SKILL.md",
  "skills/better-harness/references/agent-customize.md",
  "skills/better-harness/references/asset-demand-reconciliation.md",
  "skills/better-harness/references/findings-review.md",
  "skills/better-harness/references/finding-bound-fix.md",
  "skills/better-harness/references/session-repeated-workflows.md",
  "skills/better-harness/references/session-evidence.md",
  "skills/better-harness/references/project-harness.md",
  "templates/reporting/harness-findings.input.json",
  "references/project-harness/design-md-contract.md",
  "references/session-evidence/README.md",
  "references/project-harness/README.md",
  "references/agent-customize/README.md",
  "case-studies/project-harness/design-md-complete-example.md",
  "case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/SKILL.md",
  "case-studies/agent-customize/bug-diagnosis-skills/reproduce-frontend-bug/agents/openai.yaml",
  "case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/SKILL.md",
  "case-studies/agent-customize/bug-diagnosis-skills/diagnose-backend-bug/agents/openai.yaml",
  "hooks/git-scripts/blast-radius/parser.mjs",
  "vendor/tree-sitter-wasm/package.json",
  "vendor/tree-sitter-wasm/LICENSE",
  "vendor/tree-sitter-wasm/wasm/tree-sitter.js",
  "vendor/tree-sitter-wasm/wasm/tree-sitter.wasm",
  "vendor/tree-sitter-wasm/wasm/tree-sitter-javascript.wasm",
  "vendor/tree-sitter-wasm/wasm/tree-sitter-tsx.wasm",
  "vendor/esbuild-wasm/package.json",
  "vendor/esbuild-wasm/LICENSE.md",
  "vendor/esbuild-wasm/lib/main.js",
  "vendor/esbuild-wasm/esbuild.wasm",
];
const forbiddenBundlePrefixes = [
  ".claude-plugin/",
  ".codex-plugin/",
  ".cursor-plugin/",
  "test/",
  "dev/",
  ".idea/",
  ".qoder/",
  "assets/wasm/",
  "node_modules/",
  "scripts/packaging/",
  "skills/loop-blueprint/",
  "skills/harness/",
];

for (const entry of requiredBundleEntries) {
  if (!bundleEntries.has(entry)) {
    fail(`runtime bundle missing required entry ${entry}`);
  }
}
verifyPreviewScriptTarget(bundleEntries, packageJson, "preview", "");
verifyPreviewScriptTarget(bundleEntries, packageJson, "preview:canvas", "");

for (const prefix of forbiddenBundlePrefixes) {
  if (hasPrefix(bundleEntries, prefix)) {
    fail(`runtime bundle has unexpected path ${prefix}`);
  }
}
if (hasPathSegment(bundleEntries, ".plugin-eval")) {
  fail("runtime bundle contains generated .plugin-eval state");
}

if (!keep) {
  rmSync(tempDir, { recursive: true, force: true });
}

process.stdout.write(
  `pack verification passed: npm ${entries.size} entries, runtime zip ${bundleEntries.size} entries${keep ? ` in ${pack.filename} and ${bundlePath}` : ""}\n`,
);
