import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { workspaceToQoderSlug } from "../scripts/session-analysis/platforms/qoder.mjs";

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

function runBetterHarness(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    ...options,
  });
}

function git(cwd, args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed\n${result.stderr}`);
  }
}

async function writeFixtureFile(root, filePath, content) {
  const absolute = path.join(root, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function makeRepoFixture({ withSession = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-quickstart-"));
  const qoderHome = await mkdtemp(path.join(os.tmpdir(), "better-harness-quickstart-qoder-"));
  await writeFixtureFile(root, "package.json", JSON.stringify({ name: "quickstart-fixture" }, null, 2));
  await writeFixtureFile(root, "README.md", "# Quickstart Fixture\n");
  await writeFixtureFile(root, "AGENTS.md", "# Agent Rules\n");
  await writeFixtureFile(root, "src/app.mjs", "export function app() { return true; }\n");
  git(root, ["init", "-q"]);
  git(root, ["add", "."]);
  git(root, ["commit", "-q", "-m", "initial"]);
  if (withSession) {
    await writeFixtureFile(qoderHome, path.join("projects", workspaceToQoderSlug(root), "bavi-session.jsonl"), `${JSON.stringify({
      type: "user",
      sessionId: "bavi-session",
      timestamp: "2026-07-11T00:00:00.000Z",
      message: "verify the project change",
    })}\n`);
  }
  return { root, qoderHome };
}

test("Better Harness report emits a quickstart handoff as JSON", async () => {
  const fixture = await makeRepoFixture({ withSession: true });

  try {
    const result = runBetterHarness(["report", "--cwd", fixture.root, "--qoder-home", fixture.qoderHome, "--json"]);

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stderr, "");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.kind, "quickstart");
    assert.equal(payload.status, "ok");
    assert.equal(payload.nextStep.skill, "/better-harness");
    assert.equal(payload.evidence.sessions.route, "bavi");
    assert.equal(payload.evidence.sessions.usableSessionCount, 1);
    assert.equal(payload.nextStep.modelId, "agent-work-loop-v4");
    assert.doesNotMatch(result.stdout, /better-harness-agent-fluency/);
    assert.equal(payload.nextStep.outputDir, ".qoder/better-harness/<yyyy-mm-dd>/<hhmmss>-<target>/");
    assert.equal(payload.nextStep.outputFile, "report.canvas.tsx");
    assert.deepEqual(payload.nextStep.outputFiles, ["findings.json", "canvas.json", "report.canvas.tsx"]);
    assert.ok(Array.isArray(payload.moreEvidence) && payload.moreEvidence.length > 0);

    assert.equal(payload.evidence.project.available, true);
    assert.equal(payload.evidence.project.name, "quickstart-fixture");
    assert.ok("dependencies" in payload.evidence);
    assert.ok("worktree" in payload.evidence);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.qoderHome, { recursive: true, force: true });
  }
});

test("Better Harness report uses Software Fluency only when no sessions are available", async () => {
  const fixture = await makeRepoFixture();

  try {
    const result = runBetterHarness(["report", "--cwd", fixture.root, "--qoder-home", fixture.qoderHome, "--json"]);
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.evidence.sessions.usableSessionCount, 0);
    assert.equal(payload.evidence.sessions.route, "static-fallback");
    assert.equal(payload.nextStep.modelId, "software-fluency");
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.qoderHome, { recursive: true, force: true });
  }
});

test("Better Harness report prints a human two-step handoff by default", async () => {
  const fixture = await makeRepoFixture({ withSession: true });

  try {
    const result = runBetterHarness(["report", "--cwd", fixture.root, "--qoder-home", fixture.qoderHome], { cwd: fixture.root });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Better Harness Quickstart/);
    assert.match(result.stdout, /Step 1 - Evidence and model route/);
    assert.match(result.stdout, /Step 2 - Generate the report/);
    assert.match(result.stdout, /Bavi \/ Agent Work Loop/);
    assert.match(result.stdout, /\/better-harness/);
    assert.match(result.stdout, /\.qoder\/better-harness/);
    assert.match(result.stdout, /report\.canvas\.tsx/);
    assert.match(result.stdout, /quickstart-fixture/);
    assert.doesNotMatch(result.stdout, /better-harness-agent-fluency/);
    assert.doesNotMatch(result.stdout, /\x1b\[/);
    assert.throws(() => JSON.parse(result.stdout), SyntaxError);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
    await rm(fixture.qoderHome, { recursive: true, force: true });
  }
});

test("Better Harness report supports the quickstart alias and help", () => {
  const help = runBetterHarness(["report", "-h"]);
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Usage: better-harness report/);

  const describe = runBetterHarness(["command", "describe", "quickstart", "--json"]);
  assert.equal(describe.status, 0, describe.stderr);
  const payload = JSON.parse(describe.stdout);
  assert.equal(payload.data.command.name, "report");
});

test("Better Harness root help surfaces the Quickstart group", () => {
  const result = runBetterHarness(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Quickstart/);
  assert.match(result.stdout, /report/);
});
