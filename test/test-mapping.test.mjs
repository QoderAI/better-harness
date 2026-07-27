import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { analyzeTestMappings, runHook } from "../hooks/git-scripts/mapping-gate.mjs";

async function writeFixture(root, filePath, content = "") {
  const absolute = path.join(root, filePath);
  await mkdir(path.dirname(absolute), { recursive: true });
  await writeFile(absolute, content);
}

async function withTempDir(name, fn) {
  const root = await mkdtemp(path.join(os.tmpdir(), name));
  try {
    return await fn(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function changes(files) {
  return {
    files: files.map((filePath) => ({
      filePath,
      added: 1,
      deleted: 0,
      status: "modified",
    })),
  };
}

function config(core = []) {
  return {
    ignore: [],
    core,
  };
}

test("Java source maps src/main/java to changed src/test/java candidates", async () => {
  await withTempDir("better-harness-test-mapping-java-", async (root) => {
    await writeFixture(root, "src/main/java/com/example/OrderService.java", "class OrderService {}\n");
    await writeFixture(
      root,
      "src/test/java/com/example/OrderServiceTest.java",
      "class OrderServiceTest {}\n",
    );

    const report = await analyzeTestMappings(root, {
      config: config(),
      changes: changes([
        "src/main/java/com/example/OrderService.java",
        "src/test/java/com/example/OrderServiceTest.java",
      ]),
    });

    assert.equal(report.status, "ok");
    assert.deepEqual(report.skippedTestFiles, [
      "src/test/java/com/example/OrderServiceTest.java",
    ]);
    assert.equal(report.mappings[0].language, "java");
    assert.equal(report.mappings[0].status, "changed");
    assert.deepEqual(report.mappings[0].candidateTestFiles, [
      "src/test/java/com/example/OrderServiceTest.java",
      "src/test/java/com/example/OrderServiceTests.java",
      "src/test/java/com/example/OrderServiceIT.java",
    ]);
    assert.deepEqual(report.mappings[0].relatedTestFiles, [
      "src/test/java/com/example/OrderServiceTest.java",
    ]);
  });
});

test("Go critical-path missing test mapping blocks the Stop hook", async () => {
  await withTempDir("better-harness-test-mapping-go-", async (root) => {
    await writeFixture(root, "internal/auth/token.go", "package auth\nfunc Verify() bool { return true }\n");
    const core = [{ name: "auth core", paths: ["internal/auth/**"], risk: "high" }];

    const report = await analyzeTestMappings(root, {
      config: config(core),
      changes: changes(["internal/auth/token.go"]),
    });

    assert.equal(report.status, "blocked");
    assert.equal(report.shouldBlock, true);
    assert.equal(report.mappings[0].status, "missing");
    assert.equal(report.mappings[0].gate, "block");
    assert.deepEqual(report.mappings[0].candidateTestFiles, ["internal/auth/token_test.go"]);

    const result = await runHook(
      { betterHarnessWriteObserved: true },
      {
        cwd: root,
        mode: "stop",
        config: config(core),
        changes: changes(["internal/auth/token.go"]),
      },
    );

    assert.equal(result.exitCode, 2);
    assert.match(result.stderr, /blocked completion/);
    assert.match(result.stderr, /internal\/auth\/token_test\.go/);
  });
});

test("Python missing mapping is advisory outside critical paths", async () => {
  await withTempDir("better-harness-test-mapping-python-", async (root) => {
    await writeFixture(root, "service/routes.py", "def route():\n    return True\n");

    const report = await analyzeTestMappings(root, {
      config: config(),
      changes: changes(["service/routes.py"]),
    });

    assert.equal(report.status, "remind");
    assert.equal(report.shouldBlock, false);
    assert.equal(report.mappings[0].language, "python");
    assert.equal(report.mappings[0].status, "missing");
    assert.equal(report.mappings[0].gate, "remind");
    assert.deepEqual(report.mappings[0].candidateTestFiles, [
      "service/test_routes.py",
      "service/routes_test.py",
      "tests/service/test_routes.py",
      "tests/test_routes.py",
    ]);
  });
});

test("Python changed test file satisfies a mapped source file", async () => {
  await withTempDir("better-harness-test-mapping-python-changed-", async (root) => {
    await writeFixture(root, "service/routes.py", "def route():\n    return True\n");
    await writeFixture(root, "tests/service/test_routes.py", "def test_route():\n    assert True\n");

    const report = await analyzeTestMappings(root, {
      config: config(),
      changes: changes(["service/routes.py", "tests/service/test_routes.py"]),
    });

    assert.equal(report.status, "ok");
    assert.deepEqual(report.skippedTestFiles, ["tests/service/test_routes.py"]);
    assert.equal(report.mappings[0].status, "changed");
    assert.deepEqual(report.mappings[0].relatedTestFiles, [
      "tests/service/test_routes.py",
    ]);
  });
});

test("Python script names are normalized for test module suggestions", async () => {
  await withTempDir("better-harness-test-mapping-python-script-", async (root) => {
    await writeFixture(root, "hooks/dispatch-hook.py", "def run():\n    return True\n");

    const report = await analyzeTestMappings(root, {
      config: config(),
      changes: changes(["hooks/dispatch-hook.py"]),
    });

    assert.equal(report.mappings[0].status, "missing");
    assert.deepEqual(report.mappings[0].candidateTestFiles, [
      "hooks/test_dispatch_hook.py",
      "hooks/dispatch_hook_test.py",
      "tests/hooks/test_dispatch_hook.py",
      "tests/test_dispatch_hook.py",
    ]);
  });
});

test("PostToolUse hook returns advisory feedback without blocking", async () => {
  await withTempDir("better-harness-test-mapping-post-tool-", async (root) => {
    await writeFixture(root, "service/routes.py", "def route():\n    return True\n");

    const result = await runHook(
      { tool_name: "Write" },
      {
        cwd: root,
        mode: "post-tool",
        config: config(),
        changes: changes(["service/routes.py"]),
      },
    );

    assert.equal(result.exitCode, 0);
    const payload = JSON.parse(result.stdout);
    assert.match(payload.hookSpecificOutput.feedback, /missing test evidence/);
    assert.match(payload.hookSpecificOutput.feedback, /tests\/service\/test_routes\.py/);
  });
});
