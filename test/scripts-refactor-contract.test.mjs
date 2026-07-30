import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

test("scripts refactor contract keeps one canonical doc-link graph CLI", () => {
  assert.equal(existsSync(path.join(ROOT, "scripts", "doc-link-graph.mjs")), false);
  assert.equal(existsSync(path.join(ROOT, "scripts", "doc-link-graph", "cli.mjs")), true);
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
      sha256: "7516e20456bd5e09ed8228f2c413da5ac17b6b03c75428afbfcb276ea793cfb1",
    },
    {
      label: "OpenCLI schema",
      args: ["schema"],
      sha256: "c47b7751fe2372a4100f63bbfe52047c5d916071cfd50793495a173e9267b1c3",
    },
    {
      label: "Harness command description",
      args: ["command", "describe", "harness", "--json"],
      sha256: "7bfdf90239d7c021dc97375a6b82c40ea435847fe57e2774fcdc56ec7c56bacd",
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
