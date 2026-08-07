import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CAPABILITY_IDS,
  CAPABILITY_STATES,
  READINESS_CONTRACT_VERSION,
  READINESS_LEVELS,
  REQUIRED_CAPABILITIES,
} from "../scripts/loop-readiness/contract.mjs";
import { evaluateReadiness, ReadinessInputError } from "../scripts/loop-readiness/evaluate.mjs";

const repoRoot = process.cwd();
const cliPath = path.join(repoRoot, "scripts", "loop-readiness", "cli.mjs");
const facadePath = path.join(repoRoot, "scripts", "better-harness.mjs");
const fixturesDir = path.join(repoRoot, "test", "fixtures", "loop-readiness");

function fixture(name) {
  return path.join(fixturesDir, name);
}

function loadFixture(name) {
  return JSON.parse(readFileSync(fixture(name), "utf8"));
}

function runCli(args, options = {}) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    encoding: "utf8",
  });
}

function runFacade(args) {
  return spawnSync(process.execPath, [facadePath, ...args], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function assertInvalid(fn, code) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof ReadinessInputError, `expected ReadinessInputError, got ${error}`);
    assert.equal(error.code, code, `expected ${code}, got ${error.code}: ${error.message}`);
    return error;
  }
  return assert.fail(`expected ReadinessInputError ${code}, but no error was thrown`);
}

// AC-1: versioned contract module.

test("contract exports the five levels, five states, and a coherent v1 matrix", () => {
  assert.equal(READINESS_CONTRACT_VERSION, 1);
  assert.deepEqual([...READINESS_LEVELS], [
    "read-only-observation",
    "plan-only",
    "human-approved-apply",
    "scheduled-read-only",
    "scheduled-bounded-apply",
  ]);
  assert.deepEqual([...CAPABILITY_STATES], ["available", "partial", "unavailable", "blocked", "failed"]);
  assert.equal(CAPABILITY_IDS.length, 14);
  assert.deepEqual(Object.keys(REQUIRED_CAPABILITIES).sort(), [...READINESS_LEVELS].sort());
  for (const [level, required] of Object.entries(REQUIRED_CAPABILITIES)) {
    assert.ok(required.length > 0, `${level} must require at least one capability`);
    for (const id of required) {
      assert.ok(CAPABILITY_IDS.includes(id), `${level} requires unknown capability ${id}`);
    }
  }
  // The strictest level requires every contract capability.
  assert.deepEqual([...REQUIRED_CAPABILITIES["scheduled-bounded-apply"]].sort(), [...CAPABILITY_IDS].sort());
  // Contract data is frozen.
  assert.ok(Object.isFrozen(READINESS_LEVELS));
  assert.ok(Object.isFrozen(REQUIRED_CAPABILITIES));
  assert.ok(Object.isFrozen(REQUIRED_CAPABILITIES["read-only-observation"]));
});

test("evaluator rejects an unsupported readinessContractVersion", () => {
  const error = assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("unsupported-version.json") }),
    "UNSUPPORTED_CONTRACT_VERSION",
  );
  assert.match(error.message, /supports only version 1/);
});

// AC-2: allowed decision envelope.

test("all required capabilities available returns an allowed envelope with consumed evidence", () => {
  for (const level of READINESS_LEVELS) {
    const decision = evaluateReadiness({ level, assessment: loadFixture("all-available.json") });
    assert.equal(decision.kind, "loop-readiness-decision");
    assert.equal(decision.schemaVersion, 1);
    assert.equal(decision.readinessContractVersion, 1);
    assert.equal(decision.level, level);
    assert.equal(decision.status, "allowed");
    assert.deepEqual(decision.blockingCapabilities, []);
    assert.deepEqual(
      decision.observations.map((observation) => observation.id).sort(),
      [...REQUIRED_CAPABILITIES[level]].sort(),
      `${level} must consume exactly its required observations`,
    );
    for (const observation of decision.observations) {
      assert.match(observation.evidence, /^fixture: /);
    }
  }
});

// AC-3: prevented decision envelope, absence reports unavailable.

test("a blocked required capability prevents the level and reports its state", () => {
  const decision = evaluateReadiness({ level: "human-approved-apply", assessment: loadFixture("one-blocked.json") });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(decision.blockingCapabilities, [{ id: "isolated-execution", state: "blocked" }]);
});

test("an explicitly unavailable required capability prevents the level", () => {
  const decision = evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("explicit-unavailable.json") });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(decision.blockingCapabilities, [{ id: "evidence-source", state: "unavailable" }]);
});

test("an absent required capability prevents the level as unavailable", () => {
  const decision = evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("one-absent.json") });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(decision.blockingCapabilities, [{ id: "privacy-boundary", state: "unavailable" }]);
});

test("mixed partial and failed observations list every blocking capability", () => {
  const decision = evaluateReadiness({ level: "scheduled-read-only", assessment: loadFixture("mixed-partial-failed.json") });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(
    decision.blockingCapabilities.sort((left, right) => left.id.localeCompare(right.id)),
    [
      { id: "budget-policy", state: "partial" },
      { id: "stop-condition", state: "failed" },
    ],
  );
});

test("empty observations prevent the level listing every required capability", () => {
  const decision = evaluateReadiness({ level: "plan-only", assessment: loadFixture("empty-observations.json") });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(
    decision.blockingCapabilities.map((capability) => capability.id).sort(),
    [...REQUIRED_CAPABILITIES["plan-only"]].sort(),
  );
  for (const capability of decision.blockingCapabilities) {
    assert.equal(capability.state, "unavailable");
  }
});

test("a non-required contract capability observed blocked is ignored", () => {
  const decision = evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("non-required-blocked.json") });
  assert.equal(decision.status, "allowed");
  assert.deepEqual(decision.blockingCapabilities, []);
  assert.equal(decision.observations.some((observation) => observation.id === "plan-artifact-write"), false);
});

// Spec mutation regression: removing one required observation flips the
// decision to prevented and lists exactly that capability as unavailable.

test("removing one required observation from a passing assessment flips to prevented", () => {
  const assessment = loadFixture("all-available.json");
  assessment.observations = assessment.observations.filter((observation) => observation.id !== "rollback-reference");
  const decision = evaluateReadiness({ level: "scheduled-bounded-apply", assessment });
  assert.equal(decision.status, "prevented");
  assert.deepEqual(decision.blockingCapabilities, [{ id: "rollback-reference", state: "unavailable" }]);
});

// Invalid input never becomes a decision.

test("evaluator rejects every input the assessment contract rejects", () => {
  const valid = loadFixture("all-available.json");
  assertInvalid(() => evaluateReadiness({ level: "bogus", assessment: valid }), "UNKNOWN_LEVEL");
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("unknown-capability.json") }),
    "UNKNOWN_CAPABILITY",
  );
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("unknown-state.json") }),
    "UNKNOWN_STATE",
  );
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("duplicate-observation.json") }),
    "DUPLICATE_OBSERVATION",
  );
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: loadFixture("empty-evidence.json") }),
    "EMPTY_EVIDENCE",
  );
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: { ...valid, extra: true } }),
    "UNKNOWN_FIELD",
  );
  assertInvalid(
    () => evaluateReadiness({ level: "read-only-observation", assessment: { kind: "loop-readiness-assessment", readinessContractVersion: 1 } }),
    "MALFORMED_ASSESSMENT",
  );
  assertInvalid(() => evaluateReadiness({ level: "read-only-observation", assessment: [] }), "MALFORMED_ASSESSMENT");
});

// AC-4: CLI exit codes and parser-safe envelopes.

test("CLI --help exits 0 and documents levels and exit codes", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0, result.stderr);
  for (const level of READINESS_LEVELS) {
    assert.ok(result.stdout.includes(level), `help must document level ${level}`);
  }
  assert.match(result.stdout, /Exit codes:/);
  assert.match(result.stdout, /0 {2}allowed decision/);
  assert.match(result.stdout, /2 {2}prevented decision/);
});

test("CLI with no arguments prints help and exits 0 without a decision", () => {
  const result = runCli([]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: better-harness loop readiness/);
  assert.doesNotMatch(result.stdout, /Decision:/);
});

test("CLI allowed decision exits 0 with parser-safe JSON on stdout", () => {
  const result = runCli(["--level", "read-only-observation", "--assessment", fixture("all-available.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.kind, "loop-readiness-decision");
  assert.equal(decision.status, "allowed");
  assert.equal(result.stderr, "");
});

test("CLI prevented decision exits 2 with the documented non-success envelope", () => {
  const result = runCli(["--level", "human-approved-apply", "--assessment", fixture("one-blocked.json"), "--json"]);
  assert.equal(result.status, 2, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.status, "prevented");
  assert.deepEqual(decision.blockingCapabilities, [{ id: "isolated-execution", state: "blocked" }]);
});

test("CLI human mode prints a readable allowed summary and exits 0", () => {
  const result = runCli(["--level", "read-only-observation", "--assessment", fixture("all-available.json")]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Decision: allowed/);
  assert.match(result.stdout, /Level: read-only-observation/);
});

test("CLI human mode prints a readable prevented summary and exits 2", () => {
  const result = runCli(["--level", "read-only-observation", "--assessment", fixture("one-absent.json")]);
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stdout, /Decision: prevented/);
  assert.match(result.stdout, /privacy-boundary: unavailable/);
});

test("CLI invalid inputs exit 1 with a parser-safe error envelope and never a decision", () => {
  const cases = [
    { args: ["--level", "bogus", "--assessment", fixture("all-available.json"), "--json"], code: "UNKNOWN_LEVEL", match: /Unknown readiness level/ },
    { args: ["--level", "read-only-observation", "--assessment", fixture("malformed.json"), "--json"], code: "MALFORMED_ASSESSMENT", match: /not valid JSON/ },
    { args: ["--level", "read-only-observation", "--assessment", fixture("does-not-exist.json"), "--json"], code: "UNREADABLE_ASSESSMENT", match: /Cannot read assessment file/ },
    { args: ["--level", "read-only-observation", "--assessment", fixture("unsupported-version.json"), "--json"], code: "UNSUPPORTED_CONTRACT_VERSION", match: /supports only version 1/ },
    { args: ["--level", "read-only-observation", "--assessment", fixture("unknown-capability.json"), "--json"], code: "UNKNOWN_CAPABILITY", match: /Unknown capability id/ },
    { args: ["--level", "read-only-observation", "--json"], code: "INVALID_USAGE", match: /--assessment/ },
    { args: ["--unknown-flag", "--json"], code: "INVALID_USAGE", match: /Unknown argument/ },
  ];
  for (const { args, code, match } of cases) {
    const result = runCli(args);
    assert.equal(result.status, 1, `${args.join(" ")} must exit 1:\n${result.stdout}${result.stderr}`);
    const envelope = JSON.parse(result.stdout);
    assert.equal(envelope.kind, "loop-readiness-error", args.join(" "));
    assert.equal(envelope.code, code, `${args.join(" ")} expected ${code}, got ${envelope.code}`);
    assert.match(envelope.message, match);
    assert.equal(envelope.status, undefined, "invalid input must never carry a decision status");
  }
});

test("CLI human-mode invalid input reports the error on stderr", () => {
  const result = runCli(["--level", "bogus", "--assessment", fixture("all-available.json")]);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown readiness level/);
});

test("CLI accepts --level=<id> equals form", () => {
  const result = runCli(["--level=read-only-observation", "--assessment", fixture("all-available.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.status, "allowed");
  assert.equal(decision.level, "read-only-observation");
});

test("CLI accepts --assessment=<file> equals form", () => {
  const result = runCli(["--level", "read-only-observation", `--assessment=${fixture("all-available.json")}`, "--json"]);
  assert.equal(result.status, 0, result.stderr);
  const decision = JSON.parse(result.stdout);
  assert.equal(decision.status, "allowed");
});

test("CLI -h short flag prints help and exits 0", () => {
  const result = runCli(["-h"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: better-harness loop readiness/);
  for (const level of READINESS_LEVELS) {
    assert.ok(result.stdout.includes(level), `help must document level ${level}`);
  }
  assert.match(result.stdout, /Exit codes:/);
});

test("CLI --assessment without value exits 1 with INVALID_USAGE", () => {
  const result = runCli(["--json", "--level", "read-only-observation", "--assessment"]);
  assert.equal(result.status, 1);
  const envelope = JSON.parse(result.stdout);
  assert.equal(envelope.kind, "loop-readiness-error");
  assert.equal(envelope.code, "INVALID_USAGE");
  assert.match(envelope.message, /--assessment/);
});

// AC-5: the gate reads only the assessment file.

// Matches side-effect imports, default/named imports, and re-exports in both
// quote styles; plain `export const` declarations never match.
const IMPORT_PATTERN = /^import\s+["']([^"']+)["'];|^(?:import|export)\b[^;]*?\bfrom\s+["']([^"']+)["'];/gmu;

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//gu, " ").replace(/^\s*\/\/.*$/gmu, "");
}

function importSpecifiers(source) {
  return [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1] ?? match[2]);
}

test("import allowlist pattern catches side-effect, single-quote, and re-export forms", () => {
  assert.deepEqual(importSpecifiers('import "node:http";\n'), ["node:http"]);
  assert.deepEqual(importSpecifiers("import x from 'node:net';\n"), ["node:net"]);
  assert.deepEqual(importSpecifiers('export { x } from "node:dns";\n'), ["node:dns"]);
  assert.deepEqual(importSpecifiers('import {\n  a,\n} from "./contract.mjs";\n'), ["./contract.mjs"]);
  assert.deepEqual(importSpecifiers('export const KIND = "value";\n'), []);
});

test("import allowlist defenses flag obfuscated static imports", () => {
  // Same-line double import: only the first specifier is captured, so the
  // leftover import token must trip the residue check.
  const doubled = 'import a from "node:fs";import b from "node:net";\n';
  assert.deepEqual(importSpecifiers(doubled), ["node:fs"]);
  assert.match(doubled.replace(IMPORT_PATTERN, ""), /\bimport\b/u);
  // Line-prefix obfuscation survives comment stripping as a residue token.
  const prefixed = stripComments('/**/import x from "node:net";\n');
  assert.match(prefixed.replace(IMPORT_PATTERN, ""), /\bimport\b/u);
  const semiPrefixed = ';import x from "node:net";\n';
  assert.match(semiPrefixed.replace(IMPORT_PATTERN, ""), /\bimport\b/u);
  // Re-export obfuscation carries no import token but leaves a from clause.
  const reExport = ';export { x } from "node:dns";\n';
  assert.match(reExport.replace(IMPORT_PATTERN, ""), /\bfrom\s*["']/u);
  // Indented and semicolon-free imports are caught by the declaration count.
  for (const sneaky of ['  import "node:os";\n', 'import "node:os"\n']) {
    const lines = sneaky.split(/\r?\n/u).filter((line) => /^\s*(?:import\b|export\b[^;]*?\bfrom\b)/u.test(line));
    assert.ok(lines.length > importSpecifiers(sneaky).length, `declaration count must flag: ${sneaky.trim()}`);
  }
});

test("gate modules keep the static import allowlist", () => {
  const allowlists = {
    "contract.mjs": [],
    "evaluate.mjs": ["./contract.mjs"],
    "cli.mjs": ["node:fs", "./contract.mjs", "./evaluate.mjs"],
  };
  for (const [file, allowed] of Object.entries(allowlists)) {
    const source = stripComments(readFileSync(path.join(repoRoot, "scripts", "loop-readiness", file), "utf8"));
    const specifiers = importSpecifiers(source);
    assert.deepEqual(specifiers.sort(), [...allowed].sort(), `${file} imports outside its allowlist`);
    const declarationLines = source
      .split(/\r?\n/u)
      .filter((line) => /^\s*(?:import\b|export\b[^;]*?\bfrom\b)/u.test(line));
    assert.equal(
      declarationLines.length,
      specifiers.length,
      `${file} has import/export-from lines the allowlist pattern did not capture`,
    );
    const residue = source.replace(IMPORT_PATTERN, "");
    assert.doesNotMatch(residue, /\bimport\b/u, `${file} contains an import the allowlist pattern did not capture`);
    assert.doesNotMatch(residue, /\bfrom\s*["']/u, `${file} contains a re-export the allowlist pattern did not capture`);
    assert.doesNotMatch(source, /\brequire\s*\(/u, `${file} must not use require`);
    assert.doesNotMatch(source, /import\s*\(/u, `${file} must not use dynamic import`);
  }
});

test("CLI evaluates from an empty temporary working directory without workspace scanning", () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "loop-readiness-"));
  try {
    const result = runCli(
      ["--level", "read-only-observation", "--assessment", fixture("all-available.json"), "--json"],
      { cwd: tempDir },
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).status, "allowed");
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

// Facade wiring: the loop group dispatches and reports its registry entry.

test("better-harness loop readiness dispatches through the root facade", () => {
  const result = runFacade(["loop", "readiness", "--level", "plan-only", "--assessment", fixture("all-available.json"), "--json"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).status, "allowed");

  const direct = runCli(["--level", "plan-only", "--assessment", fixture("all-available.json"), "--json"]);
  assert.equal(result.stdout, direct.stdout, "facade stdout must match direct invocation byte for byte");
  assert.equal(result.stderr, direct.stderr, "facade stderr must match direct invocation");
  assert.equal(result.status, direct.status, "facade exit code must match direct invocation");

  const prevented = runFacade(["loop", "readiness", "--level", "plan-only", "--assessment", fixture("empty-observations.json"), "--json"]);
  assert.equal(prevented.status, 2, prevented.stderr);
});

test("command inventory registers the loop group with the readiness subcommand", () => {
  const result = runFacade(["commands", "--json", "--audience", "advanced"]);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  const loop = payload.data.commands.find((command) => command.name === "loop");
  assert.ok(loop, "loop group must appear in the advanced command inventory");
  assert.equal(loop.kind, "group");
  assert.equal(loop.audience, "advanced");
  const readiness = loop.subcommands.find((subcommand) => subcommand.name === "readiness");
  assert.ok(readiness, "loop group must expose the readiness subcommand");
  assert.equal(readiness.script, "scripts/loop-readiness/cli.mjs");
});
