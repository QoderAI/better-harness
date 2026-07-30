import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { syncAssets } from "../docs/scripts/sync-assets.mjs";

async function writeFixture(root, relativePath, content) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

test("docs asset sync publishes the report as a clean directory route", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-docs-site-"));
  const repoRoot = path.join(root, "repo");
  const siteRoot = path.join(repoRoot, "docs");

  try {
    for (const [relativePath, content] of [
      ["assets/demo/better-harness-report.html", "report"],
      ["assets/demo/better-harness-findings-report.png", "image"],
      ["assets/demo/twenty-history.gif", "history"],
      ["assets/agent-work-loop-en.svg", "loop"],
      ["assets/better-harness-architecture-en.svg", "architecture"],
      ["assets/install/codex-add-marketplace.jpg", "install"],
    ]) {
      await writeFixture(repoRoot, relativePath, content);
    }
    await writeFixture(siteRoot, "static/demo/better-harness-report.html", "stale");

    assert.equal(syncAssets({ repoRoot, siteRoot }), 6);
    assert.equal(
      await readFile(
        path.join(siteRoot, "static/demo/better-harness-report/index.html"),
        "utf8",
      ),
      "report",
    );
    await assert.rejects(
      access(path.join(siteRoot, "static/demo/better-harness-report.html")),
      { code: "ENOENT" },
    );
    assert.equal(
      await readFile(path.join(siteRoot, "static/demo/twenty-history.gif"), "utf8"),
      "history",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
