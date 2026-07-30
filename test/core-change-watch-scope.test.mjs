import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertCompatibleAnalysisScope,
  fileRoleFor,
  fromAnalysisRelativePath,
  isDependencyOrGenerated,
  isPathInAnalysisScope,
  listTrackedFiles,
  literalGitPathspec,
  publicAnalysisScope,
  resolveAnalysisScope,
  scopePathspecArgs,
  toAnalysisRelativePath,
} from "../scripts/core-change-watch/common.mjs";
import { buildEvidencePack } from "../scripts/core-change-watch/evidence-pack.mjs";
import { collectBoundedGitHistory } from "../scripts/harness-analysis/learning-capture-evidence.mjs";
import { scanTaskLoopRepositoryEvidence } from "../scripts/harness-analysis/task-loop-repository-evidence.mjs";

function runGit(cwd, args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

async function writeFixture(root, relativePath, contents = "export const value = true;\n") {
  const absolutePath = path.join(root, ...relativePath.split("/"));
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, contents, "utf8");
}

test("analysis scope resolves repo and nested targets to one public contract", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-scope-"));
  const packageRoot = path.join(repoRoot, "packages", "editor app");
  try {
    await mkdir(packageRoot, { recursive: true });
    runGit(repoRoot, ["init", "--quiet"]);
    const gitRoot = path.resolve(runGit(repoRoot, ["rev-parse", "--show-toplevel"]).trim());

    const repoScope = resolveAnalysisScope({ repoRoot });
    assert.deepEqual(publicAnalysisScope(repoScope), {
      kind: "repo",
      route: ".",
      pathspecs: [],
    });
    assert.equal(repoScope.repoRoot, gitRoot);
    assert.equal(repoScope.targetRoot, gitRoot);
    assert.ok(Object.isFrozen(repoScope));
    assert.ok(Object.isFrozen(repoScope.pathspecs));

    const packageScope = resolveAnalysisScope({ cwd: packageRoot });
    assert.deepEqual(publicAnalysisScope(packageScope), {
      kind: "path",
      route: "packages/editor app",
      pathspecs: [":(top,literal)packages/editor app"],
    });
    assert.equal(packageScope.repoRoot, gitRoot);
    assert.equal(packageScope.targetRoot, path.join(gitRoot, "packages", "editor app"));

    assert.throws(
      () => resolveAnalysisScope({ repoRoot, packageRelPath: "../other" }),
      (error) => error.code === "INVALID_PACKAGE_SCOPE",
    );
    assert.throws(
      () => resolveAnalysisScope({ repoRoot, targetRoot: path.join(repoRoot, "..", "other") }),
      (error) => error.code === "INVALID_PACKAGE_SCOPE",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("analysis scope treats real-path aliases as one repository identity", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-scope-canonical-"));
  const linksRoot = await mkdtemp(path.join(tmpdir(), "better-harness-scope-links-"));
  const repoLink = path.join(linksRoot, "repo-link");
  const packageRoot = path.join(repoRoot, "packages", "app");
  try {
    await mkdir(packageRoot, { recursive: true });
    runGit(repoRoot, ["init", "--quiet"]);
    await symlink(repoRoot, repoLink, "dir");

    const scope = resolveAnalysisScope({
      repoRoot: repoLink,
      targetRoot: packageRoot,
    });

    assert.equal(scope.route, "packages/app");
    assert.equal(scope.repoRoot, await realpath(repoRoot));
    assert.equal(scope.targetRoot, await realpath(packageRoot));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(linksRoot, { recursive: true, force: true });
  }
});

test("scope path conversion is segment-aware and round trips local paths", () => {
  const scope = publicAnalysisScope({ kind: "path", route: "packages/app" });

  assert.equal(isPathInAnalysisScope("packages/app", scope), true);
  assert.equal(isPathInAnalysisScope("packages/app/src/main.ts", scope), true);
  assert.equal(isPathInAnalysisScope("packages/app-old/src/main.ts", scope), false);
  assert.equal(isPathInAnalysisScope("../packages/app/src/main.ts", scope), false);
  assert.equal(toAnalysisRelativePath("packages/app", scope), ".");
  assert.equal(toAnalysisRelativePath("packages/app/src/main.ts", scope), "src/main.ts");
  assert.equal(fromAnalysisRelativePath(".", scope), "packages/app");
  assert.equal(fromAnalysisRelativePath("src/main.ts", scope), "packages/app/src/main.ts");

  assert.throws(
    () => toAnalysisRelativePath("packages/app-old/src/main.ts", scope),
    (error) => error.code === "PATH_OUTSIDE_ANALYSIS_SCOPE",
  );
  assert.throws(
    () => fromAnalysisRelativePath("../other/src/main.ts", scope),
    (error) => error.code === "PATH_OUTSIDE_ANALYSIS_SCOPE",
  );
});

test("Git scope arguments use top-level literal pathspecs", () => {
  const route = "packages/app [legacy]";
  const scope = publicAnalysisScope({ kind: "path", route: `${route}/` });

  assert.equal(literalGitPathspec(route), ":(top,literal)packages/app [legacy]");
  assert.deepEqual(scopePathspecArgs(scope), ["--", ":(top,literal)packages/app [legacy]"]);
  assert.deepEqual(scopePathspecArgs(), ["--"]);
  assert.throws(
    () => publicAnalysisScope({ kind: "path", route, pathspecs: [route] }),
    (error) => error.code === "INVALID_ANALYSIS_SCOPE",
  );
});

test("analysis scope compatibility fails closed for package and Git-root mismatches", () => {
  const exampleRepo = path.join(tmpdir(), "better-harness-example-repo");
  const root = resolveAnalysisScope({ repoRoot: exampleRepo });
  const packageScope = resolveAnalysisScope({
    repoRoot: exampleRepo,
    packageRelPath: "packages/app",
  });

  assert.equal(assertCompatibleAnalysisScope(null, root), true);
  assert.equal(assertCompatibleAnalysisScope({ analysisScope: publicAnalysisScope(packageScope) }, packageScope), true);
  assert.throws(
    () => assertCompatibleAnalysisScope(null, packageScope, "project profile"),
    (error) => error.code === "ANALYSIS_SCOPE_MISMATCH" && /project profile/u.test(error.message),
  );
  assert.throws(
    () => assertCompatibleAnalysisScope(root, packageScope),
    (error) => error.code === "ANALYSIS_SCOPE_MISMATCH",
  );
  assert.throws(
    () => assertCompatibleAnalysisScope(
      { ...packageScope, repoRoot: path.join(tmpdir(), "better-harness-other-repo") },
      packageScope,
    ),
    (error) => error.code === "ANALYSIS_SCOPE_MISMATCH",
  );
});

test("tracked-file discovery isolates a special-character package route", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-git-scope-"));
  const targetRoute = "packages/app [legacy]";
  const tracked = [
    `${targetRoute}/build/compiler.ts`,
    `${targetRoute}/src/main.ts`,
    "packages/app [legacy]-old/src/main.ts",
    "packages/other/src/main.ts",
  ];
  try {
    runGit(repoRoot, ["init", "--quiet"]);
    for (const filePath of tracked) {
      await writeFixture(repoRoot, filePath);
    }
    runGit(repoRoot, ["add", "--all"]);

    const scope = resolveAnalysisScope({ repoRoot, packageRelPath: targetRoute });
    assert.deepEqual(listTrackedFiles(repoRoot, scope), [
      `${targetRoute}/build/compiler.ts`,
      `${targetRoute}/src/main.ts`,
    ]);
    assert.deepEqual(listTrackedFiles(repoRoot).sort(), [...tracked].sort());
    assert.throws(
      () => listTrackedFiles(path.join(repoRoot, "packages"), scope),
      (error) => error.code === "ANALYSIS_SCOPE_MISMATCH",
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("build is eligible source while explicit artifact directories remain generated", () => {
  assert.equal(isDependencyOrGenerated("build/compiler.ts"), false);
  assert.equal(fileRoleFor("build/compiler.ts"), "source");
  assert.equal(isDependencyOrGenerated("dist/compiler.ts"), true);
  assert.equal(fileRoleFor("dist/compiler.ts"), "generated");
});

test("evidence pack keeps project, history, diff, drift, and recommendations inside one package", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-pack-scope-"));
  try {
    runGit(repoRoot, ["init", "--quiet"]);
    runGit(repoRoot, ["config", "user.email", "test@example.com"]);
    runGit(repoRoot, ["config", "user.name", "Test User"]);
    await writeFixture(repoRoot, "package.json", JSON.stringify({ workspaces: ["packages/*"] }));
    await writeFixture(repoRoot, "AGENTS.md", "# root instructions\n");
    await writeFixture(repoRoot, "packages/a/package.json", JSON.stringify({ name: "package-a" }));
    await writeFixture(repoRoot, "packages/a/AGENTS.md", "# package a\n");
    await writeFixture(repoRoot, "packages/a/README.md", "# Package A\n");
    await writeFixture(repoRoot, "packages/a/build/compiler.ts");
    await writeFixture(repoRoot, "packages/a/src/api/client.ts", "export const api = 1;\n");
    await writeFixture(repoRoot, "packages/a/src/api/client.test.ts", "export const tested = true;\n");
    await writeFixture(repoRoot, "packages/b/package.json", JSON.stringify({
      name: "package-b",
      dependencies: { next: "^15.0.0" },
    }));
    await writeFixture(repoRoot, "packages/b/src/app.tsx", "export const App = () => null;\n");
    runGit(repoRoot, ["add", "--all"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "initial"]);

    await writeFixture(repoRoot, "packages/a/src/api/client.ts", "export const api = 2;\n");
    runGit(repoRoot, ["add", "packages/a"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "change package a"]);
    await writeFixture(repoRoot, "packages/b/src/app.tsx", "export const App = () => 'b';\n");
    runGit(repoRoot, ["add", "packages/b"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "change package b"]);

    await writeFixture(repoRoot, "packages/a/src/api/client.ts", "export const api = 3;\n");
    await writeFixture(repoRoot, "packages/a/src/new.ts", "export const fresh = true;\n");
    await writeFixture(repoRoot, "packages/b/docs/api.md", "# Sibling docs\n");
    await writeFixture(repoRoot, "packages/b/src/untracked.ts", "export const sibling = true;\n");

    const pack = await buildEvidencePack({
      cwd: repoRoot,
      packageRelPath: "packages/a",
      maxCommits: 20,
      maxCandidates: 10,
    });

    assert.deepEqual(pack.analysisScope, {
      kind: "path",
      route: "packages/a",
      pathspecs: [":(top,literal)packages/a"],
    });
    assert.equal(pack.projectProfile.projectInfo.name, "package-a");
    assert.equal(pack.projectProfile.projectInfo.readmeTitle, "Package A");
    assert.equal(pack.projectProfile.agentInstructions.rootCount, 1);
    assert.ok(pack.projectProfile.manifests.every((item) => item.path.startsWith("packages/a/")));
    assert.ok(pack.projectProfile.frameworks.every((item) => item.name !== "nextjs"));
    assert.ok(pack.projectProfile.languages.some((item) => item.language === "typescript"));
    assert.equal(fileRoleFor("packages/a/build/compiler.ts"), "source");
    assert.ok(pack.historyProfile.hotFiles.every((item) => item.path.startsWith("packages/a/")));
    assert.equal(pack.historyProfile.range.analyzedCommits, 2);
    assert.ok(pack.coreAnalysis.candidates.every((item) => item.path.startsWith("packages/a")));
    assert.ok(pack.diffImpact.changedFiles.every((item) => item.path.startsWith("packages/a/")));
    assert.ok(pack.diffImpact.changedFiles.some((item) => item.path === "packages/a/src/new.ts" && item.untracked));
    assert.ok(pack.changeDrift.changedFiles.every((item) => item.path.startsWith("packages/a/")));
    assert.ok(pack.changeDrift.findings.some((finding) => finding.driftType === "public-api-docs"));
    assert.ok(pack.changeDrift.findings.every((finding) =>
      finding.triggerFiles.every((filePath) => filePath.startsWith("packages/a/"))
      && finding.candidateCompanionFiles.every((filePath) => filePath.startsWith("packages/a/"))));
    assert.ok(pack.recommendedReads.every((item) => item.path.startsWith("packages/a")));
    assert.ok(pack.followUpActions.every((action) =>
      action.files.every((file) =>
        String(typeof file === "string" ? file : file.path).startsWith("packages/a"))));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("scoped evidence fails closed when the requested Git base is invalid", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-invalid-base-"));
  try {
    runGit(repoRoot, ["init", "--quiet"]);
    runGit(repoRoot, ["config", "user.email", "test@example.com"]);
    runGit(repoRoot, ["config", "user.name", "Test User"]);
    await writeFixture(repoRoot, "packages/app/src/main.ts");
    runGit(repoRoot, ["add", "--all"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "initial"]);

    await assert.rejects(
      buildEvidencePack({
        cwd: repoRoot,
        packageRelPath: "packages/app",
        baseRef: "refs/heads/definitely-missing",
      }),
      (error) => error?.code === "GIT_COMMAND_FAILED"
        && /definitely-missing/u.test(error.message),
    );
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test("lead repository history and static evidence consume the frozen package scope", async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), "better-harness-lead-scope-"));
  try {
    runGit(repoRoot, ["init", "--quiet"]);
    runGit(repoRoot, ["config", "user.email", "test@example.com"]);
    runGit(repoRoot, ["config", "user.name", "Test User"]);
    await writeFixture(repoRoot, "packages/a/package.json", JSON.stringify({ name: "a" }));
    await writeFixture(repoRoot, "packages/a/src/a.ts");
    await writeFixture(repoRoot, "packages/b/package.json", JSON.stringify({ name: "b" }));
    await writeFixture(repoRoot, "packages/b/.github/workflows/release.yml", "name: sibling\n");
    await writeFixture(repoRoot, "packages/b/src/b.ts");
    runGit(repoRoot, ["add", "--all"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "initial"]);
    await writeFixture(repoRoot, "packages/a/src/a.test.ts");
    runGit(repoRoot, ["add", "packages/a"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "fix package a"]);
    await writeFixture(repoRoot, "packages/b/src/b.test.ts");
    runGit(repoRoot, ["add", "packages/b"]);
    runGit(repoRoot, ["commit", "--quiet", "-m", "fix package b"]);

    const scope = resolveAnalysisScope({ repoRoot, packageRelPath: "packages/a" });
    const history = collectBoundedGitHistory(path.join(repoRoot, "packages/a"), {
      analysisScope: publicAnalysisScope(scope),
      limit: 20,
    });
    assert.equal(history.status, "complete");
    assert.ok(history.commits.flatMap((commit) => commit.files)
      .every((file) => file.path.startsWith("packages/a/")));

    const evidence = scanTaskLoopRepositoryEvidence({
      workspace: path.join(repoRoot, "packages/a"),
      analysisScope: publicAnalysisScope(scope),
    });
    assert.ok((evidence.aiAgentPractice.coverageRows ?? [])
      .flatMap((row) => row.paths ?? [])
      .every((file) => file.startsWith("packages/a/")));
    assert.doesNotMatch(JSON.stringify(evidence), /packages\/b/u);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});
