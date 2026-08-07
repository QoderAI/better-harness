import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const CLI = path.join(ROOT, "scripts", "better-harness.mjs");
const FIXTURES = path.join(ROOT, "test", "fixtures", "scripts-refactor-contract");

function runBetterHarness(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });
}

function readFixture(name) {
  return readFileSync(path.join(FIXTURES, name), "utf8").replaceAll("\r\n", "\n");
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertSuccessfulOutput(result, expected, label) {
  assert.equal(result.status, 0, `${label} failed:\n${result.stderr}`);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, expected);
}

function moduleFiles(root) {
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      files.push(...moduleFiles(entryPath));
    } else if (entry.isFile() && entry.name.endsWith(".mjs")) {
      files.push(entryPath);
    }
  }
  return files;
}

test("scripts refactor contract keeps one canonical doc-link graph CLI", () => {
  assert.equal(existsSync(path.join(ROOT, "scripts", "doc-link-graph.mjs")), false);
  assert.equal(existsSync(path.join(ROOT, "scripts", "doc-link-graph", "cli.mjs")), true);
});

test("scripts compose with session-analysis through its public surface", () => {
  const scriptsRoot = path.join(ROOT, "scripts");
  const capabilityRoot = path.join(scriptsRoot, "session-analysis");
  const publicSurface = path.join(capabilityRoot, "index.mjs");
  const rootShim = path.join(scriptsRoot, "session-analysis.mjs");
  const importSpecifier = /(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)["']([^"']+)["']/gu;
  const violations = [];

  for (const filePath of moduleFiles(scriptsRoot)) {
    if (filePath === rootShim || filePath.startsWith(`${capabilityRoot}${path.sep}`)) continue;
    const source = readFileSync(filePath, "utf8");
    for (const match of source.matchAll(importSpecifier)) {
      const specifier = match[1];
      if (!specifier.startsWith(".")) continue;
      const resolved = path.resolve(path.dirname(filePath), specifier);
      if (resolved.startsWith(`${capabilityRoot}${path.sep}`) && resolved !== publicSurface) {
        violations.push(`${path.relative(ROOT, filePath)} -> ${specifier}`);
      }
    }
  }

  assert.deepEqual(violations, []);
});

test("scripts refactor contract freezes human-readable CLI help", () => {
  const cases = [
    {
      label: "root maintainer help",
      args: ["--help", "--audience", "maintainer"],
      fixture: "root-help.txt",
    },
    {
      label: "Harness maintainer help",
      args: ["harness", "--help", "--audience", "maintainer"],
      fixture: "harness-help.txt",
    },
    {
      label: "session-analysis help",
      args: ["session-analysis", "--help"],
      fixture: "session-help.txt",
    },
  ];

  for (const entry of cases) {
    assertSuccessfulOutput(runBetterHarness(entry.args), readFixture(entry.fixture), entry.label);
  }
});

test("scripts refactor contract freezes machine-readable CLI output", () => {
  const cases = [
    {
      label: "command inventory",
      args: ["commands", "--json"],
      sha256: "22aa7464a87c2f8368abf6ea09ee905265b87bd72b0fd357389c03f54ba4c6c1",
    },
    {
      label: "OpenCLI schema",
      args: ["schema"],
      sha256: "87665184e20a7d61650b51b6835cf2bdce8a60c56ff0f3f922d6bc334ceec94b",
    },
    {
      label: "Harness command description",
      args: ["command", "describe", "harness", "--json"],
      sha256: "aa7aeb8d28360da25a83dc65b9fea583b9abf7ae2e665c307cf6c838937dd1d4",
    },
  ];

  for (const entry of cases) {
    const result = runBetterHarness(entry.args);
    assert.equal(result.status, 0, `${entry.label} failed:\n${result.stderr}`);
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "");
    assert.equal(
      sha256(result.stdout),
      entry.sha256,
      `${entry.label} changed; inspect the complete output before revising the baseline:\n${result.stdout}`,
    );
  }
});

test("scripts refactor contract freezes failure channels and diagnostics", () => {
  const cases = [
    {
      label: "unknown command",
      args: ["missing-capability"],
      stderr: "Unknown command: missing-capability\n\nUse `better-harness --help` to list commands.\n",
    },
    {
      label: "unknown Harness subcommand",
      args: ["harness", "missing-subcommand"],
      stderr: "Unknown subcommand for harness: missing-subcommand\n\nUse `better-harness harness --help` to list subcommands.\n",
    },
  ];

  for (const entry of cases) {
    const result = runBetterHarness(entry.args);
    assert.equal(result.status, 1, entry.label);
    assert.equal(result.signal, null);
    assert.equal(result.stdout, "");
    assert.equal(result.stderr, entry.stderr);
  }
});

test("scripts refactor contract keeps every exposed script path installable", () => {
  const result = runBetterHarness(["commands", "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const inventory = JSON.parse(result.stdout).data.commands;
  const exposedScripts = new Set();

  for (const command of inventory) {
    if (command.script) exposedScripts.add(command.script);
    for (const subcommand of command.subcommands ?? []) {
      exposedScripts.add(subcommand.script);
    }
  }

  assert.equal(exposedScripts.size > 0, true);
  for (const script of [...exposedScripts].sort()) {
    assert.equal(existsSync(path.join(ROOT, script)), true, `missing exposed script: ${script}`);
  }
});

test("scripts refactor contract keeps the direct session shim output identical", () => {
  const direct = spawnSync(process.execPath, [path.join(ROOT, "scripts", "session-analysis.mjs"), "--help"], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    },
  });

  assertSuccessfulOutput(direct, readFixture("session-help.txt"), "direct session-analysis help");
});
