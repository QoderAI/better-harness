import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "vitest";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const VITEST_CLI_PATH = fileURLToPath(new URL("../../node_modules/vitest/vitest.mjs", import.meta.url));

test("Vitest's default reporter identifies an intentional failure in the main log", async () => {
  const fixtureName = `.vitest-reporting-${randomUUID()}.test.mjs`;
  const fixturePath = path.join(ROOT, "test", "governance", fixtureName);
  const relativeFixture = path.relative(ROOT, fixturePath).split(path.sep).join("/");

  try {
    await writeFile(fixturePath, [
      'import assert from "node:assert/strict";',
      'import { test } from "vitest";',
      'test("intentional visible failure", () => assert.equal(1, 2));',
      "",
    ].join("\n"));

    const childEnv = {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    };
    for (const key of ["VITEST", "VITEST_POOL_ID", "VITEST_WORKER_ID"]) {
      delete childEnv[key];
    }

    const result = spawnSync(process.execPath, [
      VITEST_CLI_PATH,
      "run",
      relativeFixture,
      "--reporter=default",
    ], {
      cwd: ROOT,
      encoding: "utf8",
      env: childEnv,
    });
    const output = `${result.stdout}\n${result.stderr}`;

    assert.equal(result.status, 1, output);
    assert.ok(output.includes(relativeFixture), output);
    assert.ok(output.includes("intentional visible failure"), output);
    assert.ok(output.includes("Expected values to be strictly equal"), output);
    assert.ok(output.includes(`${fixtureName}:3:`), output);
  } finally {
    await rm(fixturePath, { force: true });
  }
});
