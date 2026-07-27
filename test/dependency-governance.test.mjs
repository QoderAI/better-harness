import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  analyzeDependencyGovernance,
  benchmarkClassifierVersions,
  classifyPathsWithVersion,
  generateSyntheticDependencyPaths,
} from "../scripts/dependency-governance/cli.mjs";

function git(cwd, args, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, ...options.env },
    input: options.input,
    stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
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

async function makeRepo() {
  const repo = await mkdtemp(path.join(os.tmpdir(), "better-harness-dependency-governance-"));
  git(repo, ["init", "-q"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  git(repo, ["config", "user.name", "Test User"]);
  return repo;
}

function commit(repo, message, isoDate) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-q", "-m", message], {
    env: {
      GIT_AUTHOR_DATE: isoDate,
      GIT_COMMITTER_DATE: isoDate,
    },
  });
}

test("dependency governance detector reports stale dependency files without inventing alerts", async () => {
  const repo = await makeRepo();
  try {
    await writeFixtureFile(repo, "package.json", JSON.stringify({
      scripts: {
        test: "node --test",
        "audit:deps": "npm audit --audit-level=high",
      },
      dependencies: {
        express: "^4.18.2",
      },
    }, null, 2));
    await writeFixtureFile(repo, "package-lock.json", JSON.stringify({ lockfileVersion: 3 }, null, 2));
    commit(repo, "add dependencies", "2025-01-01T00:00:00Z");

    await writeFixtureFile(repo, ".github/dependabot.yml", "version: 2\nupdates:\n  - package-ecosystem: npm\n    directory: /\n    schedule:\n      interval: weekly\n");
    await writeFixtureFile(repo, ".github/workflows/security.yml", "name: security\njobs:\n  deps:\n    steps:\n      - run: osv-scanner --lockfile package-lock.json\n");
    commit(repo, "add dependency automation", "2026-06-20T00:00:00Z");

    const report = await analyzeDependencyGovernance({
      cwd: repo,
      now: "2026-06-25T00:00:00Z",
      staleDays: 180,
    });

    assert.equal(report.status, "ok");
    assert.equal(report.analyzerVersion, "v5");
    assert.equal(report.summary.manifestCount, 1);
    assert.equal(report.summary.lockfileCount, 1);
    assert.equal(report.summary.updateAutomation.count, 1);
    assert.ok(report.summary.auditSignals.count >= 2);
    assert.equal(report.summary.alertEvidence.status, "unverified");
    assert.ok(report.summary.staleDependencyFiles.some((item) => item.path === "package.json"));
    assert.ok(report.summary.findings.some((item) => item.id === "dependency-files-stale"));
    assert.ok(!report.summary.findings.some((item) => item.id === "confirmed-dependency-alert"));
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("dependency governance CLI emits JSON for direct agent use", async () => {
  const repo = await makeRepo();
  try {
    await writeFixtureFile(repo, "pyproject.toml", "[project]\nname = \"demo\"\ndependencies = [\"requests\"]\n");
    await writeFixtureFile(repo, "requirements.txt", "requests==2.32.0\n");
    commit(repo, "add python dependencies", "2026-06-24T00:00:00Z");

    const result = spawnSync(process.execPath, [
      path.join(process.cwd(), "scripts/dependency-governance/cli.mjs"),
      "--cwd",
      repo,
      "--json",
      "--now",
      "2026-06-25T00:00:00Z",
    ], { encoding: "utf8" });

    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assert.equal(report.kind, "dependency-governance");
    assert.equal(report.summary.manifestCount, 2);
    assert.equal(report.summary.alertEvidence.status, "unverified");
  } finally {
    await rm(repo, { recursive: true, force: true });
  }
});

test("five classifier versions agree and the fifth version wins the bundled benchmark", () => {
  const paths = generateSyntheticDependencyPaths({ packageCount: 400, fillerCount: 8000 });
  const baseline = classifyPathsWithVersion(paths, "v5");

  for (const version of ["v1", "v2", "v3", "v4"]) {
    const candidate = classifyPathsWithVersion(paths, version);
    assert.deepEqual(candidate.counts, baseline.counts, `${version} must match v5 counts`);
  }

  const benchmark = benchmarkClassifierVersions({ paths, iterations: 80 });
  assert.equal(benchmark.best.version, "v5");
  assert.ok(benchmark.versions.every((item) => item.elapsedMs > 0));
});
