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
  return readFileSync(path.join(FIXTURES, name), "utf8");
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
      sha256: "c2b6b8fc831753efdc0047baf4a37fc142d247109a3a424975dfd4d1763323b8",
    },
    {
      label: "OpenCLI schema",
      args: ["schema"],
      sha256: "8410994b9af5db28fb53bf66b2197924907b7baeba7a865277fa0cb5c36a6b89",
    },
    {
      label: "Harness command description",
      args: ["command", "describe", "harness", "--json"],
      sha256: "1efeceb766dbdfd97750a1e402f3892d0a08a374659945741084b75783bbd6a4",
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
