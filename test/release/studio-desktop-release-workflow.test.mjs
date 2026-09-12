import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "vitest";
import { parse } from "yaml";

const repositoryRoot = new URL("../../", import.meta.url);
const workflowUrl = new URL(".github/workflows/studio-desktop-release.yml", repositoryRoot);
const manifestUrl = new URL("packages/better-harness-desktop/package.json", repositoryRoot);

const readWorkflow = async () => parse(await readFile(workflowUrl, "utf8"));
const readManifest = async () =>
  JSON.parse(await readFile(manifestUrl, "utf8"));

const findStep = (steps, predicate) => {
  const step = steps.find(predicate);
  assert.ok(step, "expected step is missing from the workflow");
  return step;
};

describe("Studio desktop release workflow", () => {
  test("starts from a version tag and builds every desktop platform", async () => {
    const workflow = await readWorkflow();
    assert.deepEqual(workflow.on.push.tags, ["v*"]);
    assert.equal(workflow.on.pull_request, undefined);
    assert.deepEqual(
      workflow.jobs.installers.strategy.matrix.os,
      ["macos-latest", "windows-latest", "ubuntu-latest"],
    );
  });

  test("the desktop manifest actually declares each matrix installer target", async () => {
    const [workflow, manifest] = await Promise.all([readWorkflow(), readManifest()]);
    const platforms = workflow.jobs.installers.strategy.matrix.os;
    for (const [platform, key] of [
      ["macos-latest", "mac"],
      ["windows-latest", "win"],
      ["ubuntu-latest", "linux"],
    ]) {
      assert.ok(platforms.includes(platform), `${platform} is not in the matrix`);
      assert.ok(
        manifest.build[key]?.target?.length,
        `desktop package.json declares no ${key} installer target`,
      );
    }
  });

  test("runs the installer script the desktop workspace defines", async () => {
    const [workflow, manifest] = await Promise.all([readWorkflow(), readManifest()]);
    assert.ok(manifest.scripts.dist, "desktop package must define a dist script");
    const buildStep = findStep(
      workflow.jobs.installers.steps,
      (step) => typeof step.run === "string" && step.run.includes("dist"),
    );
    assert.equal(buildStep.run, "npm run dist -w @qoder-ai/better-harness-desktop");
  });

  test("keeps distribution unsigned", async () => {
    const workflow = await readWorkflow();
    const buildStep = findStep(
      workflow.jobs.installers.steps,
      (step) => typeof step.run === "string" && step.run.includes("dist"),
    );
    assert.equal(buildStep.env.CSC_IDENTITY_AUTO_DISCOVERY, "false");
  });

  test("uploads electron-builder's configured output and fails closed", async () => {
    const [workflow, manifest] = await Promise.all([readWorkflow(), readManifest()]);
    const upload = findStep(
      workflow.jobs.installers.steps,
      (step) => step.uses?.startsWith("actions/upload-artifact"),
    );
    assert.equal(
      upload.with.path,
      `packages/better-harness-desktop/${manifest.build.directories.output}/*`,
    );
    assert.equal(upload.with["if-no-files-found"], "error");
  });

  test("publishes the collected installers to the tag's GitHub release", async () => {
    const workflow = await readWorkflow();
    const release = workflow.jobs.release;
    assert.deepEqual(release.needs, "installers");
    assert.equal(release.permissions.contents, "write");
    const download = findStep(
      release.steps,
      (step) => step.uses?.startsWith("actions/download-artifact"),
    );
    const publish = findStep(
      release.steps,
      (step) => step.uses?.startsWith("softprops/action-gh-release"),
    );
    // Assets must be collected from the same directory the download step fills.
    assert.equal(publish.with.files, `${download.with.path}/*`);
  });

  test("bounds the cost of every release run", async () => {
    const workflow = await readWorkflow();
    const installers = workflow.jobs.installers;
    const release = workflow.jobs.release;

    // A hung build must not bill the default 360-minute job budget.
    assert.ok(Number.isInteger(installers["timeout-minutes"]), "installers job needs a timeout");
    assert.ok(Number.isInteger(release["timeout-minutes"]), "release job needs a timeout");

    // Caches belong to the unprivileged build job and must precede the build.
    const buildIndex = installers.steps.findIndex((step) => step.run?.includes("dist"));
    const cacheIndexes = installers.steps.flatMap((step, index) =>
      step.uses?.startsWith("actions/cache") ? [index] : [],
    );
    assert.ok(cacheIndexes.length >= 2, "cargo and electron caches must be restored before the build");
    assert.ok(
      cacheIndexes.every((index) => index < buildIndex),
      "caches must be restored before the build step",
    );

    // The privileged release job holds contents: write and must not cache.
    assert.equal(
      release.steps.some((step) => step.uses?.startsWith("actions/cache")),
      false,
      "the privileged release job must not restore a cache",
    );

    const upload = findStep(
      installers.steps,
      (step) => step.uses?.startsWith("actions/upload-artifact"),
    );
    assert.ok(
      Number.isInteger(upload.with["retention-days"]),
      "uploaded installers need a retention limit",
    );
  });
});
