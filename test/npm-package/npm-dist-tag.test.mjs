import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, test } from "vitest";
import { parse } from "yaml";

import {
  resolveNpmDistTag,
  resolvePackageRelease,
} from "../../scripts/npm-package/npm-dist-tag.mjs";

describe("npm release dist-tag", () => {
  test.each([
    ["0.7.0", "latest"],
    ["0.7.0-alpha1", "alpha"],
    ["0.7.0-alpha.2", "alpha"],
    ["0.7.0-beta3", "beta"],
    ["0.7.0-rc.1", "rc"],
  ])("maps %s to %s", (version, expected) => {
    assert.equal(resolveNpmDistTag(version), expected);
  });

  test.each(["0.7", "v0.7.0", "0.7.0-next.1", "0.7.0-preview1"])(
    "rejects unsupported version %s",
    (version) => {
      assert.throws(() => resolveNpmDistTag(version));
    },
  );

  test("reads the selected package version", async () => {
    const repositoryRoot = await mkdtemp(path.join(os.tmpdir(), "better-harness-release-"));
    try {
      await writeFile(
        path.join(repositoryRoot, "package.json"),
        `${JSON.stringify({ version: "0.7.0-alpha1" }, null, 2)}\n`,
        "utf8",
      );

      assert.deepEqual(await resolvePackageRelease("better-harness", repositoryRoot), {
        packageName: "better-harness",
        version: "0.7.0-alpha1",
        tag: "alpha",
      });
      await assert.rejects(() => resolvePackageRelease("unknown", repositoryRoot));
    } finally {
      await rm(repositoryRoot, { recursive: true, force: true });
    }
  });
});

test("release workflow passes the resolved tag to every npm publish branch", async () => {
  const workflow = parse(await readFile(
    new URL("../../.github/workflows/release.yml", import.meta.url),
    "utf8",
  ));
  const publishCommands = workflow.jobs.publish.steps
    .filter((step) => step.name?.startsWith("Publish"))
    .map((step) => step.run);

  assert.equal(publishCommands.length, 2);
  for (const command of publishCommands) {
    assert.match(command, /--tag "\$\{\{ steps\.release\.outputs\.tag \}\}"/);
  }
});
