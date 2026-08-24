import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { fileRoleFor } from "../../scripts/core-change-watch/common.mjs";
import { analyzeChangeDrift } from "../../scripts/core-change-watch/change-drift.mjs";
import { analyzeCoreCandidates } from "../../scripts/core-change-watch/core-candidates.mjs";
import { analyzeDiffImpact } from "../../scripts/core-change-watch/diff-impact.mjs";
import { buildEvidencePack } from "../../scripts/core-change-watch/evidence-pack.mjs";
import { analyzeGitHistoryProfile } from "../../scripts/core-change-watch/git-history-profile.mjs";
import { analyzeProjectProfile } from "../../scripts/core-change-watch/project-profile.mjs";
import { parseAndNormalizeQoderOutput } from "../../scripts/core-change-watch/qoder-consistency-schema.mjs";

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    input: options.input,
  });

  if (result.status !== 0) {
    if (options.allowFailure) {
      return "";
    }
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }

  return result.stdout.trim();
}

test("file role classification keeps CI/config/resources distinct from localization", () => {
  assert.equal(fileRoleFor(".github/workflows/ci.yml"), "configuration");
  assert.equal(fileRoleFor("src/resources/app.js"), "source");
  assert.equal(fileRoleFor("resources/lang/app.js"), "localization");
  assert.equal(fileRoleFor("config/app.php"), "configuration");
  assert.equal(fileRoleFor("database/migrations/2024_01_01_create_users.php"), "migration");
  assert.equal(fileRoleFor("AI_READINESS_FINDINGS.json"), "generated");
  assert.equal(fileRoleFor("REPORT_SUMMARY.txt"), "generated");
  assert.equal(fileRoleFor("test-report.canvas.tsx"), "generated");
});

async function writeFixtureFile(repo, filePath, content) {
  const absolute = path.join(repo, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeRepo(files) {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-core-analysis-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);

  for (const [filePath, content] of Object.entries(files)) {
    await writeFixtureFile(repo, filePath, content);
  }

  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", "initial"]);
  return repo;
}

test("project profile identifies language, manifest, source root, and entry signals", async () => {
  const repo = await makeRepo({
    "package.json": JSON.stringify({ scripts: { test: "node --test" }, dependencies: { express: "^5.0.0" } }),
    "src/app.ts": "export function app() { return true; }\n",
    "src/routes/Home.tsx": "export function Home() { return null; }\n",
    "src/app.test.ts": "import { app } from './app';\napp();\n",
    "dist/generated.js": "module.exports = {};\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });

    assert.equal(profile.status, "ok");
    assert.ok(profile.languages.some((item) => item.language === "typescript" && item.sourceFiles >= 1));
    assert.ok(profile.languages.some((item) => item.language === "tsx" && item.sourceFiles >= 1));
    assert.ok(profile.manifests.some((item) => item.path === "package.json"));
    assert.ok(profile.sourceRoots.some((item) => item.path === "src"));
    assert.ok(profile.entryCandidates.some((item) => item.path === "src/app.ts"));
    assert.equal(profile.totals.generatedOrDependencyFiles, 1);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("framework-specific evidence distinguishes FastAPI from generic Rails and TypeScript paths", async () => {
  const repo = await makeRepo({
    "pyproject.toml": "[project]\nname = \"fastapi-service\"\ndependencies = [\"fastapi>=0.116\"]\n",
    "app/api/routes.py": "def route(): return True\n",
    "app/services/search.py": "def search(): return []\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });
    const core = await analyzeCoreCandidates({ cwd: repo, profile, maxCommits: 20 });

    assert.ok(profile.frameworks.some((item) => item.name === "fastapi" && item.confidence === "high"));
    assert.equal(profile.frameworks.some((item) => item.name === "rails"), false);
    assert.equal(
      core.candidates
        .filter((item) => item.path === "app/api" || item.path.startsWith("app/api/"))
        .some((item) => item.reasons.some((reason) => /typescript/iu.test(reason))),
      false,
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("Just recipes are projected statically as unverified argv entry candidates", async () => {
  const repo = await makeRepo({
    "Justfile": [
      "default:",
      "    @just --list",
      "sync:",
      "    uv sync",
      "api-dev *args=\"\":",
      "    uv run uvicorn app.main:app {{args}}",
      "health:",
      "    curl http://localhost:7102/health",
      "[private]",
      "secret-maintenance:",
      "    echo hidden",
      "check: sync",
      "    just test",
      "",
    ].join("\r\n"),
    "app/main.py": "def main(): return True\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });
    const entries = profile.projectInfo.entryCandidates.filter((item) => item.kind === "just-recipe");

    for (const recipe of ["default", "sync", "api-dev", "health", "check"]) {
      const entry = entries.find((item) => item.command?.join(" ") === `just ${recipe}`);
      assert.ok(entry, recipe);
      assert.equal(entry.sourcePath, "Justfile");
      assert.equal(entry.executionStatus, "unverified");
    }
    assert.equal(entries.some((item) => item.command?.includes("secret-maintenance")), false);
    assert.deepEqual(
      profile.manifests.find((item) => item.path === "Justfile")?.scripts,
      ["api-dev", "check", "default", "health", "sync"],
    );
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("non-current historical paths stay in history but leave current reads and actions", async () => {
  const repo = await makeRepo({
    "src/core/current.ts": "export const current = true;\n",
    "src/core/legacy.ts": "export const legacy = 0;\n",
  });

  try {
    for (let index = 1; index <= 4; index += 1) {
      await writeFixtureFile(repo, "src/core/legacy.ts", `export const legacy = ${index};\n`);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch legacy ${index}`]);
    }
    git(repo, ["rm", "-q", "src/core/legacy.ts"]);
    git(repo, ["commit", "-q", "-m", "remove legacy source"]);
    await writeFixtureFile(repo, "src/core/new-service.ts", "export const added = true;\n");

    const pack = await buildEvidencePack({ cwd: repo, baseRef: "HEAD", maxCommits: 30 });
    const actionPaths = pack.followUpActions.flatMap((action) => action.files ?? []).map((item) => item.path);

    assert.ok(pack.historyProfile.hotFiles.some((item) => item.path === "src/core/legacy.ts"));
    assert.equal(pack.recommendedReads.some((item) => item.path === "src/core/legacy.ts"), false);
    assert.equal(actionPaths.includes("src/core/legacy.ts"), false);
    assert.ok(pack.recommendedReads.some((item) => item.path === "src/core/new-service.ts"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile summarizes project identity, scale, and AGENTS instruction density", async () => {
  const repo = await makeRepo({
    "package.json": JSON.stringify({
      name: "agent-guided-demo",
      description: "Demo app for agent guidance coverage",
      scripts: { test: "node --test" },
    }),
    "README.md": "# Agent Guided Demo\n\nA fixture project.\n",
    "AGENTS.md": "# Root instructions\n",
    "src/feature/AGENTS.md": "# Feature instructions\n",
    "src/feature/app.ts": "export function app() {\n  return true;\n}\n",
    "src/feature/view.tsx": "export function View() {\n  return null;\n}\n",
    "src/feature/view.test.tsx": "import { View } from './view';\nView();\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });
    const measuredProfile = await analyzeProjectProfile({ cwd: repo, measureSourceLines: true });
    const pack = await buildEvidencePack({ cwd: repo, maxCommits: 20, noHistory: true });
    const measuredPack = await buildEvidencePack({
      cwd: repo,
      maxCommits: 20,
      noHistory: true,
      measureSourceLines: true,
    });
    const cliResult = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts/core-change-watch/project-profile.mjs"),
      "--cwd",
      repo,
      "--json",
      "--measure-source-lines",
    ], { encoding: "utf8" });
    assert.equal(cliResult.status, 0, cliResult.stderr);
    const cliProfile = JSON.parse(cliResult.stdout);

    assert.equal(profile.projectInfo.name, "agent-guided-demo");
    assert.equal(profile.projectInfo.description, "Demo app for agent guidance coverage");
    assert.equal(profile.projectInfo.readmeTitle, "Agent Guided Demo");
    assert.equal(profile.projectInfo.measuredSourceLines, null);
    assert.equal(profile.projectInfo.sourceLineStatus, "skipped");
    assert.match(profile.projectInfo.sourceLineMethod, /not measured by default/);
    assert.ok(measuredProfile.projectInfo.measuredSourceLines >= 6);
    assert.equal(measuredProfile.projectInfo.sourceLineStatus, "complete");
    assert.match(measuredProfile.projectInfo.sourceLineMethod, /primary source files only/);
    assert.ok(cliProfile.projectInfo.measuredSourceLines >= 6);
    assert.equal(cliProfile.projectInfo.sourceLineStatus, "complete");
    assert.deepEqual(
      new Set(profile.projectInfo.primaryLanguages.map((item) => item.language)),
      new Set(["typescript", "tsx"]),
    );

    assert.equal(profile.agentInstructions.count, 2);
    assert.equal(profile.agentInstructions.rootCount, 1);
    assert.equal(profile.agentInstructions.nestedCount, 1);
    assert.equal(profile.agentInstructions.status, "adequate");
    assert.equal(profile.agentInstructions.suggestedMinimum, 1);
    assert.equal(profile.agentInstructions.sourceFilesUnderNestedInstructions, 2);
    assert.ok(profile.agentInstructions.files.some((item) => item.path === "src/feature/AGENTS.md" && item.scope === "src/feature"));

    assert.equal(pack.summary.projectInfo.name, "agent-guided-demo");
    assert.equal(pack.summary.projectInfo.sourceFiles, 2);
    assert.equal(pack.summary.projectInfo.measuredSourceLines, null);
    assert.equal(pack.summary.projectInfo.sourceLineStatus, "skipped");
    assert.ok(measuredPack.summary.projectInfo.measuredSourceLines >= 6);
    assert.equal(measuredPack.summary.projectInfo.sourceLineStatus, "complete");
    assert.equal(pack.summary.agentInstructions.status, "adequate");
    assert.equal(pack.summary.agentInstructions.count, 2);
    assert.equal("sourceLinesPerInstruction" in pack.summary.agentInstructions, false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("AGENTS instruction density uses file count instead of line count", async () => {
  const repo = await makeRepo({
    "package.json": JSON.stringify({ name: "few-large-files" }),
    "AGENTS.md": "# Root instructions\n",
    "src/large-a.ts": `${"export const a = true;\n".repeat(20000)}`,
    "src/large-b.ts": `${"export const b = true;\n".repeat(20000)}`,
    "src/large-c.ts": `${"export const c = true;\n".repeat(20000)}`,
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo, languages: "typescript" });
    const measuredProfile = await analyzeProjectProfile({
      cwd: repo,
      languages: "typescript",
      measureSourceLines: true,
    });

    assert.equal(profile.projectInfo.sourceFiles, 3);
    assert.equal(profile.projectInfo.measuredSourceLines, null);
    assert.equal(profile.projectInfo.sourceLineStatus, "skipped");
    assert.ok(measuredProfile.projectInfo.measuredSourceLines >= 60000);
    assert.equal(measuredProfile.agentInstructions.suggestedMinimum, 1);
    assert.equal(profile.agentInstructions.suggestedMinimum, 1);
    assert.equal(profile.agentInstructions.status, "adequate");
    assert.equal(profile.agentInstructions.sourceFilesPerInstruction, 3);
    assert.equal("sourceLinesPerInstruction" in profile.agentInstructions, false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("large root-only projects report thin AGENTS instruction density", async () => {
  const files = {
    "package.json": JSON.stringify({ name: "large-root-only" }),
    "AGENTS.md": "# Root instructions\n",
  };
  for (let index = 0; index < 501; index += 1) {
    files[`src/module_${String(index).padStart(3, "0")}.ts`] = `export const value${index} = ${index};\n`;
  }
  const repo = await makeRepo(files);

  try {
    const profile = await analyzeProjectProfile({ cwd: repo, languages: "typescript" });

    assert.equal(profile.totals.sourceFiles, 501);
    assert.equal(profile.agentInstructions.count, 1);
    assert.equal(profile.agentInstructions.rootCount, 1);
    assert.equal(profile.agentInstructions.nestedCount, 0);
    assert.equal(profile.agentInstructions.status, "thin");
    assert.equal(profile.agentInstructions.suggestedMinimum, 3);
    assert.equal(profile.agentInstructions.suggestedAdditional, 2);
    assert.equal(profile.agentInstructions.sourceFilesPerInstruction, 501);
    assert.equal(profile.agentInstructions.sourceFilesUnderNestedInstructions, 0);
    assert.ok(profile.agentInstructions.suggestedScopes.some((item) => item.path === "src"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("history and core candidate scoring combine hot paths with core path signals", async () => {
  const repo = await makeRepo({
    "package.json": "{}\n",
    "src/core/auth.ts": "export function authorize(role: string) { return role === 'admin'; }\n",
    "src/core/session.ts": "export function session() { return 'ok'; }\n",
    "src/features/page.ts": "export function page() { return true; }\n",
  });

  try {
    for (let index = 0; index < 3; index += 1) {
      await writeFixtureFile(
        repo,
        "src/core/auth.ts",
        `export function authorize(role: string) { return role === 'admin' || role === 'owner-${index}'; }\n`,
      );
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch auth ${index}`]);
    }

    const history = await analyzeGitHistoryProfile({ cwd: repo, maxCommits: 20 });
    const core = await analyzeCoreCandidates({ cwd: repo, maxCommits: 20, maxCandidates: 10 });

    assert.ok(history.hotFiles.some((item) => item.path === "src/core/auth.ts" && item.commits >= 3));

    const top = core.candidates[0];
    assert.equal(top.path, "src/core");
    assert.equal(top.confidence, "high");
    assert.ok(top.reasons.some((reason) => /core path/i.test(reason)));
    assert.ok(top.evidence.hotFiles.some((item) => item.path === "src/core/auth.ts"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("history separates supporting hotspots and evidence pack emits follow-up actions", async () => {
  const repo = await makeRepo({
    "package.json": "{}\n",
    "src/core/app.ts": "export function label() { return 'Start'; }\n",
    "src/ui/View.tsx": "export function View() { return null; }\n",
    "src/i18n/en-us.ts": "export const messages = { start: 'Start' };\n",
    "src/i18n/zh-cn.ts": "export const messages = { start: '开始' };\n",
    "docs/SESSION_FLOW_GUIDE.md": "# Session flow\n",
  });

  try {
    for (let index = 0; index < 5; index += 1) {
      await writeFixtureFile(repo, "src/i18n/en-us.ts", `export const messages = { start: 'Start ${index}' };\n`);
      await writeFixtureFile(repo, "src/i18n/zh-cn.ts", `export const messages = { start: '开始 ${index}' };\n`);
      await writeFixtureFile(repo, "docs/SESSION_FLOW_GUIDE.md", `# Session flow ${index}\n`);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch supporting ${index}`]);
    }

    for (let index = 0; index < 2; index += 1) {
      await writeFixtureFile(repo, "src/core/app.ts", `export function label() { return 'Start ${index}'; }\n`);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch source ${index}`]);
    }

    const history = await analyzeGitHistoryProfile({ cwd: repo, maxCommits: 50 });

    assert.deepEqual(history.historyWindows.map((item) => item.days), [30, 90, 180]);
    assert.deepEqual(history.historyWindows.map((item) => item.trendLabel), [
      "recent-hotspots",
      "sustained-hotspots",
      "legacy-or-long-range-hotspots",
    ]);
    assert.equal(history.hotFiles.some((item) => item.path.includes("i18n") || item.path.endsWith(".md")), false);
    assert.ok(history.hotFiles.every((item) => item.role === "source"));
    assert.ok(history.supportingHotFiles.some((item) => item.path === "src/i18n/en-us.ts" && item.role === "localization"));
    assert.ok(history.supportingHotFiles.some((item) => item.path === "docs/SESSION_FLOW_GUIDE.md" && item.role === "documentation"));

    await writeFixtureFile(repo, "src/core/app.ts", "export function label() { return 'Continue'; }\n");

    const pack = await buildEvidencePack({ cwd: repo, baseRef: "HEAD", maxCommits: 50 });
    const actionIds = pack.followUpActions.map((item) => item.id);

    assert.ok(actionIds.includes("inspect-primary-core"));
    assert.ok(actionIds.includes("apply-targeted-implementation"));
    assert.ok(actionIds.includes("sync-localization"));
    assert.ok(actionIds.includes("sync-documentation"));
    assert.ok(actionIds.includes("validate-impact"));
    assert.equal(pack.recommendedReads.some((item) => item.path.includes("i18n")), false);
    assert.equal(pack.evidenceSources.boundary, "static-local-git-and-file-analysis");
    assert.ok(pack.evidenceSources.unverifiedClaims.some((item) => item.claim === "tests passed" && item.status === "UNVERIFIED"));
    assert.ok(pack.reviewMatrix.some((item) => item.id === "core-supporting-separation" && item.status === "ready"));
    assert.ok(pack.reviewMatrix.some((item) => item.id === "agent-report-flexibility" && item.status === "ready"));
    assert.equal(pack.reviewMatrix.some((item) => item.id === "qoder-flexibility"), false);
    assert.ok(pack.agentGuidance.optionalReruns.some((item) => item.commandArgs.includes("--ignore")));

    const filteredPack = await buildEvidencePack({
      cwd: repo,
      baseRef: "HEAD",
      maxCommits: 50,
      ignore: "src/i18n/**,docs/**",
    });
    assert.equal(filteredPack.summary.filtersApplied, true);
    assert.ok(filteredPack.filters.historyProfile.ignoredCount >= 1);
    assert.equal(filteredPack.historyProfile.supportingHotFiles.some((item) => item.role === "localization"), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile and core candidates detect PHP framework signals without promoting support files", async () => {
  const repo = await makeRepo({
    "composer.json": JSON.stringify({
      require: { "laravel/framework": "^11.0" },
      "require-dev": { "pestphp/pest": "^3.0", "phpunit/phpunit": "^11.0" },
      scripts: { test: "pest" },
    }),
    "artisan": "#!/usr/bin/env php\n",
    "app/Http/Controllers/HomeController.php": "<?php class HomeController {}\n",
    "app/Models/User.php": "<?php class User {}\n",
    "routes/web.php": "<?php\n",
    "resources/lang/en/messages.php": "<?php return [];\n",
    "config/app.php": "<?php return [];\n",
    "database/migrations/2024_01_01_create_users.php": "<?php\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });
    const core = await analyzeCoreCandidates({ cwd: repo, maxCommits: 20, maxCandidates: 10 });

    assert.ok(profile.languages.some((item) => item.language === "php" && item.sourceFiles >= 3));
    assert.ok(profile.frameworks.some((item) => item.name === "laravel" && item.confidence === "high"));
    assert.ok(profile.manifests.some((item) => item.path === "composer.json" && item.kind === "php"));
    assert.equal(core.candidates.some((item) => item.path.startsWith("resources/lang")), false);
    assert.equal(core.candidates.some((item) => item.path.startsWith("database/migrations")), false);
    assert.ok(core.candidates.some((item) => item.path === "app/Http" && item.reasons.some((reason) => /laravel/i.test(reason))));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile detects Rails, Django, Spring, and NestJS framework signals", async () => {
  const repo = await makeRepo({
    "packages/server/package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^11.0.0" } }),
    "packages/server/src/app.module.ts": "export class AppModule {}\n",
    "Gemfile": "gem 'rails'\n",
    "config/routes.rb": "Rails.application.routes.draw do\nend\n",
    "requirements.txt": "Django==5.0\n",
    "manage.py": "print('django')\n",
    "pom.xml": "<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId></dependency></dependencies></project>\n",
    "src/main/java/com/example/Application.java": "class Application {}\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });
    const core = await analyzeCoreCandidates({ cwd: repo, maxCommits: 20, maxCandidates: 10, profile });
    const frameworks = new Set(profile.frameworks.map((item) => item.name));

    assert.ok(frameworks.has("nestjs"));
    assert.ok(frameworks.has("rails"));
    assert.ok(frameworks.has("django"));
    assert.ok(frameworks.has("spring"));
    assert.ok(core.candidates.some((item) => item.path === "packages/server" && item.reasons.some((reason) => /nestjs manifest boundary/.test(reason))));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile ignores framework manifests from dependency directories", async () => {
  const repo = await makeRepo({
    "node_modules/pkg/package.json": JSON.stringify({ dependencies: { "@nestjs/core": "^11.0.0" } }),
    "vendor/acme/pkg/composer.json": JSON.stringify({ require: { "symfony/http-kernel": "^7.0" } }),
    "src/app.ts": "export const app = true;\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });

    assert.deepEqual(profile.frameworks, []);
    assert.equal(profile.totals.generatedOrDependencyFiles, 2);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile lists nested framework manifests consistently", async () => {
  const repo = await makeRepo({
    "packages/api/composer.json": JSON.stringify({ require: { "laravel/framework": "^11.0" } }),
    "packages/api/Gemfile": "gem 'rails'\n",
    "packages/api/app/Http/Controllers/HomeController.php": "<?php class HomeController {}\n",
  });

  try {
    const profile = await analyzeProjectProfile({ cwd: repo });

    assert.ok(profile.frameworks.some((item) => item.name === "laravel"));
    assert.ok(profile.frameworks.some((item) => item.name === "rails"));
    assert.ok(profile.manifests.some((item) => item.path === "packages/api/composer.json" && item.kind === "php"));
    assert.ok(profile.manifests.some((item) => item.path === "packages/api/Gemfile" && item.kind === "ruby"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("core candidates skip docs/examples and keep dense package roots", async () => {
  const repo = await makeRepo({
    "pyproject.toml": "[project]\nname = \"demo\"\n",
    "httpx/__init__.py": "from .client import Client\n",
    "httpx/client.py": "class Client: pass\n",
    "httpx/_auth.py": "class Auth: pass\n",
    "httpx/_config.py": "class Config: pass\n",
    "examples/auth/demo.py": "def demo(): return True\n",
    "docs_src/security/tutorial.py": "def tutorial(): return True\n",
  });

  try {
    const core = await analyzeCoreCandidates({
      cwd: repo,
      languages: "python",
      maxCommits: 20,
      maxCandidates: 10,
    });

    assert.equal(core.candidates[0].path, "httpx");
    assert.equal(core.candidates.some((item) => item.path.startsWith("examples")), false);
    assert.equal(core.candidates.some((item) => item.path.startsWith("docs_src")), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("core candidates group direct source-root files under the root directory", async () => {
  const repo = await makeRepo({
    "package.json": "{}\n",
    "index.js": "module.exports = require('./lib/application');\n",
    "lib/application.js": "module.exports = function application() {};\n",
    "lib/request.js": "module.exports = function request() {};\n",
    "lib/response.js": "module.exports = function response() {};\n",
    "lib/utils.js": "module.exports = function utils() {};\n",
    "examples/auth/index.js": "module.exports = function example() {};\n",
  });

  try {
    const core = await analyzeCoreCandidates({
      cwd: repo,
      languages: "javascript",
      maxCommits: 20,
      maxCandidates: 10,
    });

    const lib = core.candidates.find((item) => item.path === "lib");
    assert.ok(lib);
    assert.equal(lib.confidence, "medium");
    assert.equal(core.candidates.some((item) => item.path.startsWith("examples")), false);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("core candidates do not mark one-commit bulk directories as high confidence", async () => {
  const files = {
    "package.json": "{}\n",
  };
  for (let index = 0; index < 24; index += 1) {
    files[`packages/bulk/file_${index}.js`] = `export const item${index} = true;\n`;
  }

  const repo = await makeRepo(files);

  try {
    const core = await analyzeCoreCandidates({
      cwd: repo,
      languages: "javascript",
      maxCommits: 20,
      maxCandidates: 10,
    });
    const history = await analyzeGitHistoryProfile({ cwd: repo, languages: "javascript", maxCommits: 20 });

    assert.equal(core.candidates.some((item) => item.confidence === "high"), false);
    assert.equal(history.confidence.confidence, "low");
    assert.ok(history.confidence.reasons.some((reason) => /single-commit|only 1 commits/i.test(reason)));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("project profile handles large git ls-files output without empty evidence", async () => {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-core-large-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);

  try {
    const emptyBlob = git(repo, ["hash-object", "-w", "--stdin"], { input: "" });
    const longSegment = "nested".repeat(40);
    const entries = [];
    for (let index = 0; index < 2600; index += 1) {
      entries.push(`100644 blob ${emptyBlob}\tsrc/${longSegment}/module_${String(index).padStart(4, "0")}.ts`);
    }
    git(repo, ["update-index", "--index-info"], { input: `${entries.join("\n")}\n` });

    const profile = await analyzeProjectProfile({ cwd: repo, languages: "typescript" });

    assert.equal(profile.totals.trackedFiles, 2600);
    assert.ok(profile.languages.some((item) => item.language === "typescript" && item.sourceFiles === 2600));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("qoder consistency schema preserves AI verdict while flagging score drift", () => {
  const normalized = parseAndNormalizeQoderOutput(`prelude\n\n\`\`\`json
{"verdict":"mostly_consistent","score":7,"confidence":"medium","mismatches":["count drift"],"strengths":["core paths align"],"notes":"needs review"}
\`\`\``);

  assert.equal(normalized.status, "needs-review");
  assert.equal(normalized.result.verdict, "mostly_consistent");
  assert.equal(normalized.result.scoreVerdict, "inconsistent");
  assert.ok(normalized.warnings.some((warning) => /maps to inconsistent/.test(warning)));
});

test("core-change-watch scripts stay static and do not invoke qodercli", () => {
  const root = process.cwd();
  const scriptDir = path.join(root, "scripts/core-change-watch");
  const scripts = readdirSync(scriptDir).filter((file) => file.endsWith(".mjs"));

  assert.equal(existsSync(path.join(scriptDir, "qoder-report-eval.mjs")), false);
  assert.ok(existsSync(path.join(scriptDir, "qoder-consistency-schema.mjs")));

  const combined = scripts
    .map((file) => readFileSync(path.join(scriptDir, file), "utf8"))
    .join("\n");
  assert.doesNotMatch(combined, /qoder-report-eval/);
  assert.doesNotMatch(combined, /\bqodercli\b/);
  assert.doesNotMatch(combined, /spawnSync\([^)]*qoder/);
});

test("diff impact and evidence pack flag changed core code with recommended reads", async () => {
  const repo = await makeRepo({
    "go.mod": "module example.com/demo\n\ngo 1.22\n",
    "cmd/server/main.go": "package main\n\nfunc main() {}\n",
    "internal/auth/service.go": "package auth\n\nfunc Verify(role string) bool { return role == \"admin\" }\n",
    "internal/http/routes.go": "package http\n\nfunc Routes() []string { return []string{\"/\"} }\n",
  });

  try {
    for (let index = 0; index < 3; index += 1) {
      await writeFixtureFile(
        repo,
        "internal/auth/service.go",
        `package auth\n\nfunc Verify(role string) bool { return role == "admin" || role == "owner-${index}" }\n`,
      );
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch auth ${index}`]);
    }
    await writeFixtureFile(
      repo,
      "internal/auth/service.go",
      "package auth\n\nfunc Verify(role string) bool { return role == \"admin\" || role == \"owner\" }\n",
    );

    const impact = await analyzeDiffImpact({ cwd: repo, baseRef: "HEAD" });
    const pack = await buildEvidencePack({ cwd: repo, baseRef: "HEAD", maxCommits: 20 });

    assert.equal(impact.status, "attention-required");
    assert.equal(impact.attentionRequired, true);
    assert.equal("coreCodeRules" in impact, false);
    assert.ok(impact.coreHits.some((item) => item.path === "internal/auth" && item.source === "candidate"));
    assert.ok(impact.reasons.some((reason) => /changed core candidate internal\/auth/i.test(reason)));
    assert.equal(pack.summary.reviewRecommended, true);
    assert.equal(pack.summary.attentionRequired, true);
    assert.equal("coreCodeRules" in pack.summary, false);
    assert.ok(pack.recommendedReads.some((item) => item.path === "internal/auth/service.go"));
    assert.equal(pack.diffImpact.changedFiles[0].language, "go");
    const diagnosticReview = pack.followUpActions.find((item) => item.id === "review-core-diagnostic-coverage");
    assert.ok(diagnosticReview);
    assert.equal(diagnosticReview.priority, "high");
    assert.ok(diagnosticReview.files.some((item) => item.path === "internal/auth/service.go"));
    assert.match(diagnosticReview.passCheck, /trigger through boundary or decision to failure, recovery, and result/i);
    assert.ok(pack.reviewMatrix.some((item) => item.id === "core-diagnostic-coverage" && item.status === "review"));
    assert.ok(pack.agentGuidance.reportFiltering.some((item) => /reader-facing finding/.test(item)));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("change drift flags public API changes without documentation companion updates", async () => {
  const repo = await makeRepo({
    "package.json": "{}\n",
    "README.md": "# API Demo\n",
    "docs/api.md": "# API reference\n",
    "src/api/client.ts": "export function createClient() { return 'v1'; }\n",
  });

  try {
    await writeFixtureFile(
      repo,
      "src/api/client.ts",
      "export function createClient(options?: { timeoutMs?: number }) { return 'v2'; }\n",
    );

    const drift = await analyzeChangeDrift({ cwd: repo, baseRef: "HEAD" });
    const pack = await buildEvidencePack({ cwd: repo, baseRef: "HEAD", maxCommits: 20, noHistory: true });

    assert.equal(drift.status, "advisory");
    assert.equal(drift.summary.findingCount, 1);
    assert.ok(drift.findings.some((finding) => finding.id === "public-api-doc-sync"));
    assert.ok(drift.findings[0].triggerFiles.includes("src/api/client.ts"));
    assert.ok(drift.findings[0].candidateCompanionFiles.includes("docs/api.md"));
    assert.equal(pack.summary.changeDrift.findingCount, 1);
    assert.ok(pack.changeDrift.findings.some((finding) => finding.driftType === "public-api-docs"));
    assert.ok(pack.followUpActions.some((action) => action.id === "sync-change-drift-public-api-doc-sync"));
    assert.ok(pack.reviewMatrix.some((item) => item.id === "change-drift-companion-coverage" && item.status === "review"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("change drift honors ignores when reusing changed file evidence", async () => {
  const repo = await makeRepo({
    "package.json": "{}\n",
    "README.md": "# API Demo\n",
    "src/api/client.ts": "export function createClient() { return 'v1'; }\n",
  });

  try {
    await writeFixtureFile(
      repo,
      "src/api/client.ts",
      "export function createClient(options?: { timeoutMs?: number }) { return 'v2'; }\n",
    );

    const impact = await analyzeDiffImpact({ cwd: repo, baseRef: "HEAD" });
    const drift = await analyzeChangeDrift({
      cwd: repo,
      baseRef: "HEAD",
      changedFiles: impact.changedFiles,
      ignore: "src/api/**",
    });

    assert.equal(drift.status, "ok");
    assert.equal(drift.summary.findingCount, 0);
    assert.equal(drift.filters.ignoredCount, 1);
    assert.equal(drift.summary.changedFiles, 0);
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("change drift excludes harness-owned artifacts but keeps real source changes", async () => {
  const repo = await makeRepo({
    "README.md": "# Harness Artifact Demo\n",
    "src/components/Button.tsx": "export function Button() { return null; }\n",
  });

  try {
    await writeFixtureFile(repo, "AI_READINESS_FINDINGS.json", "{\"findings\":[]}\n");
    await writeFixtureFile(repo, "REPORT_SUMMARY.txt", "generated report\n");
    await writeFixtureFile(repo, "test-report.canvas.tsx", "export const generated = true;\n");
    await writeFixtureFile(repo, ".qoder/better-harness/2026-07-01/000000-demo/findings.json", "{}\n");
    await writeFixtureFile(repo, ".qoder/better-harness/2026-07-01/000000-demo/report.canvas.tsx", "export default function Report() { return null; }\n");

    const artifactOnly = await analyzeChangeDrift({ cwd: repo, baseRef: "HEAD" });

    assert.equal(artifactOnly.status, "ok");
    assert.equal(artifactOnly.summary.changedFiles, 0);
    assert.equal(artifactOnly.summary.findingCount, 0);

    await writeFixtureFile(repo, "src/components/NewWidget.tsx", "export function NewWidget() { return null; }\n");

    const withSource = await analyzeChangeDrift({ cwd: repo, baseRef: "HEAD" });

    assert.equal(withSource.status, "advisory");
    assert.deepEqual(withSource.changedFiles.map((file) => file.path), ["src/components/NewWidget.tsx"]);
    assert.ok(withSource.findings.some((finding) => finding.driftType === "ui-story-snapshot"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("change drift detects missing tests, stories, setup docs, contracts, and CLI help companions", async () => {
  const repo = await makeRepo({
    "package.json": JSON.stringify({ scripts: { test: "node --test" } }),
    "README.md": "# Companion Demo\n\nUsage: cli --old\n",
    "docs/setup.md": "# Setup\n",
    "src/db/schema.sql": "CREATE TABLE users (id integer);\n",
    "src/components/Button.tsx": "export function Button() { return null; }\n",
    "src/components/Button.stories.tsx": "export default { title: 'Button' };\n",
    "src/errors/error-codes.ts": "export enum ErrorCode { Old = 'OLD' }\n",
    "test/error-contract.test.ts": "import '../src/errors/error-codes';\n",
    "src/cli/parser.ts": "export const options = ['--old'];\n",
    "test/cli-help.test.ts": "import '../src/cli/parser';\n",
    "package-lock.json": "{}\n",
  });

  try {
    await writeFixtureFile(repo, "src/db/schema.sql", "CREATE TABLE users (id integer, email text);\n");
    await writeFixtureFile(repo, "src/components/Button.tsx", "export function Button(props: { label?: string }) { return null; }\n");
    await writeFixtureFile(repo, "src/errors/error-codes.ts", "export enum ErrorCode { Old = 'OLD', New = 'NEW' }\n");
    await writeFixtureFile(repo, "src/cli/parser.ts", "export const options = ['--old', '--new'];\n");
    await writeFixtureFile(repo, "package-lock.json", "{\"lockfileVersion\":3}\n");

    const drift = await analyzeChangeDrift({ cwd: repo, baseRef: "HEAD" });
    const types = new Set(drift.findings.map((finding) => finding.driftType));

    assert.equal(drift.status, "advisory");
    assert.equal(types.has("schema-tests"), true);
    assert.equal(types.has("ui-story-snapshot"), true);
    assert.equal(types.has("error-contract"), true);
    assert.equal(types.has("cli-help-docs"), true);
    assert.equal(types.has("config-setup-docs"), false, "lockfile-only config changes should not trigger setup docs drift");
    assert.ok(drift.findings.every((finding) => finding.severity === "medium"));
    assert.ok(drift.findings.every((finding) => finding.confidence === "medium"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("supporting hot file changes remain companion evidence without core attention", async () => {
  const repo = await makeRepo({
    "src/core/service.ts": "export const core = true;\n",
    "docs/guide.md": "# Guide\n",
  });

  try {
    for (let index = 0; index < 4; index += 1) {
      await writeFixtureFile(repo, "docs/guide.md", `# Guide ${index}\n`);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-q", "-m", `touch docs ${index}`]);
    }

    await writeFixtureFile(repo, "docs/guide.md", "# Guide changed\n");

    const impact = await analyzeDiffImpact({ cwd: repo, baseRef: "HEAD", maxCommits: 20 });

    assert.equal(impact.status, "ok");
    assert.equal(impact.attentionRequired, false);
    assert.equal(impact.coreHits.length, 0);
    assert.ok(impact.companionHits.some((item) => item.path === "docs/guide.md" && item.role === "documentation"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("untracked files under inferred core paths require attention", async () => {
  const repo = await makeRepo({
    "src/core/service.ts": "export const core = true;\n",
    "src/features/view.ts": "export const view = true;\n",
  });

  try {
    await writeFixtureFile(repo, "src/core/new-service.ts", "export const addedCore = true;\n");

    const impact = await analyzeDiffImpact({ cwd: repo, baseRef: "HEAD" });

    assert.equal(impact.status, "attention-required");
    assert.equal(impact.attentionRequired, true);
    assert.ok(impact.changedFiles.some((item) => item.path === "src/core/new-service.ts" && item.untracked));
    assert.ok(impact.coreHits.some((item) => item.filePath === "src/core/new-service.ts" && item.source === "candidate"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});
