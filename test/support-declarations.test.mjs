import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PROVIDER_COLLECTORS } from "../scripts/agent-customize/providers/index.mjs";
import { createAnalyzer, SESSION_ANALYSIS_HELP } from "../scripts/session-analysis/index.mjs";

// Canonical support declaration (roadmap A-06): CLI help, provider registry,
// session platforms, report platforms, and docs must all agree on this set.
const SUPPORTED_PLATFORMS = ["qoder", "codex", "claude", "cursor", "qwen", "copilot", "pi", "workbuddy"];

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");
const adapterMatrixPath = path.join(process.cwd(), "docs", "adapters", "README.md");
const reportRoutingPath = path.join(process.cwd(), "templates", "reporting", "routing.md");

function runBetterHarness(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

function sortedSet(values) {
  return [...new Set(values)].sort();
}

function assertSameSet(actual, label) {
  assert.deepEqual(sortedSet(actual), sortedSet(SUPPORTED_PLATFORMS), `${label} disagrees with the supported platform set`);
}

function portableHtmlMatrixHosts(matrix) {
  return matrix
    .split("\n")
    .map((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cells) => cells[6] === "self-contained HTML + Markdown")
    .map((cells) => cells[1]);
}

function portableHtmlRouteHosts(routing) {
  const declaration = routing.match(
    /\| Portable HTML report \| Active host is (.+?), or a portable visual is explicitly requested \|/u,
  )?.[1];
  assert.ok(declaration, "reporting/routing.md does not declare a Portable HTML report route");
  return new Set(declaration.split(/,\s*(?:or\s+)?/u).map((host) => host.trim()));
}

function missingPortableHtmlRouteHosts(matrix, routing) {
  const htmlHosts = portableHtmlMatrixHosts(matrix);
  assert.ok(htmlHosts.length > 0, "adapter matrix declares no self-contained HTML + Markdown hosts");
  const routeHosts = portableHtmlRouteHosts(routing);
  return htmlHosts.filter((host) => !routeHosts.has(host));
}

test("agent-customize provider registry declares exactly the supported platforms", () => {
  assertSameSet([...PROVIDER_COLLECTORS.keys()], "PROVIDER_COLLECTORS");

  for (const platform of SUPPORTED_PLATFORMS) {
    const providerModule = path.join(process.cwd(), "scripts", "agent-customize", "providers", `${platform}.mjs`);
    assert.ok(existsSync(providerModule), `missing configured-asset provider module: ${providerModule}`);
  }
});

test("session-analysis platform loader declares exactly the supported platforms", async () => {
  for (const platform of SUPPORTED_PLATFORMS) {
    const platformModule = path.join(process.cwd(), "scripts", "session-analysis", "platforms", `${platform}.mjs`);
    assert.ok(existsSync(platformModule), `missing session platform module: ${platformModule}`);
  }

  let message = "";
  try {
    await createAnalyzer("__unsupported__");
  } catch (error) {
    message = error.message;
  }
  const declared = message.match(/Supported platforms: ([a-z, ]+)\./u)?.[1];
  assert.ok(declared, `platform loader did not fail closed with a supported list: ${message}`);
  assertSameSet(declared.split(", "), "session-analysis loadPlatform error");

  const declaredHelp = SESSION_ANALYSIS_HELP.match(/--platform <([a-z|]+)>/u)?.[1];
  assert.ok(declaredHelp, `exported session-analysis help does not declare a platform list:\n${SESSION_ANALYSIS_HELP}`);
  assertSameSet(declaredHelp.split("|"), "SESSION_ANALYSIS_HELP platform list");
});

test("session-analysis CLI help and platform gate agree with the supported platforms", () => {
  const result = runBetterHarness(["session-analysis", "--help"]);
  assert.equal(result.status, 0, result.stderr);

  const declared = result.stdout.match(/--platform <([a-z|]+)>/u)?.[1];
  assert.ok(declared, `session-analysis help does not declare a platform list:\n${result.stdout}`);
  assertSameSet(declared.split("|"), "session-analysis --help platform list");

  const gated = runBetterHarness(["session-analysis", "sources", "--platform", "__unsupported__", "--workspace", "."]);
  assert.notEqual(gated.status, 0, "session-analysis CLI accepted an unsupported platform");
  const gateDeclared = `${gated.stderr}${gated.stdout}`.match(/Supported platforms: ([a-z, ]+)\./u)?.[1];
  assert.ok(gateDeclared, `session-analysis CLI did not fail closed with a supported list:\n${gated.stderr}`);
  assertSameSet(gateDeclared.split(", "), "session-analysis CLI platform gate");
});

test("harness analyze help and platform gate agree with the supported platforms", () => {
  const help = runBetterHarness(["harness", "analyze", "--help"]);
  assert.equal(help.status, 0, help.stderr);

  const declared = help.stdout.match(/--platform <name>\s+([a-z, ]+or [a-z]+)/u)?.[1];
  assert.ok(declared, `harness analyze help does not declare a platform list:\n${help.stdout}`);
  assertSameSet(declared.match(/[a-z]+/gu).filter((word) => word !== "or"), "harness analyze --help platform list");

  const gated = runBetterHarness(["harness", "analyze", "--platform", "__unsupported__", "--workspace", ".", "--format", "json"]);
  assert.notEqual(gated.status, 0, "harness analyze accepted an unsupported platform");
  const gatedOutput = `${gated.stderr}${gated.stdout}`;
  assert.match(gatedOutput, /unsupported Harness report platform/u);
  const gateDeclared = gatedOutput.match(/Supported platforms: ([a-z, ]+)\./u)?.[1];
  assert.ok(gateDeclared, `harness analyze did not name the supported set on rejection:\n${gatedOutput}`);
  assertSameSet(gateDeclared.split(", "), "harness analyze platform gate");
});

test("asset-baseline provider gate lists exactly the supported platforms", () => {
  const result = runBetterHarness(["coding-agent-practices", "asset-baseline", "__unsupported__", "--workspace", "."]);
  assert.notEqual(result.status, 0, "asset-baseline accepted an unsupported provider");

  const declared = `${result.stderr}${result.stdout}`.match(/Supported providers: ([a-z, ]+)\./u)?.[1];
  assert.ok(declared, `asset-baseline did not fail closed with a supported list:\n${result.stderr}`);
  assertSameSet(declared.split(", "), "asset-baseline provider gate");
});

test("host adapter matrix documents exactly the supported platforms", () => {
  const matrix = readFileSync(adapterMatrixPath, "utf8");

  for (const platform of SUPPORTED_PLATFORMS) {
    assert.ok(
      matrix.includes(`scripts/agent-customize/providers/${platform}.mjs`),
      `adapter matrix is missing the configured-asset provider for ${platform}`,
    );
    assert.ok(
      matrix.includes(`scripts/session-analysis/platforms/${platform}.mjs`),
      `adapter matrix is missing the session platform for ${platform}`,
    );
  }

  const documentedProviders = [...matrix.matchAll(/agent-customize\/providers\/([a-z-]+)\.mjs/gu)].map((match) => match[1]);
  const documentedPlatforms = [...matrix.matchAll(/session-analysis\/platforms\/([a-z-]+)\.mjs/gu)].map((match) => match[1]);
  assertSameSet(documentedProviders, "adapter matrix configured-asset providers");
  assertSameSet(documentedPlatforms, "adapter matrix session platforms");
});

test("adapter-matrix portable HTML hosts appear in the portable HTML report route", () => {
  const matrix = readFileSync(adapterMatrixPath, "utf8");
  const routing = readFileSync(reportRoutingPath, "utf8");

  // Hosts whose matrix Default Output cell claims the portable HTML pipeline.
  // One-directional on purpose: a host may drop the matrix claim first (for
  // example a pending durable-report gap) without breaking report routing.
  for (const host of missingPortableHtmlRouteHosts(matrix, routing)) {
    assert.fail(`Portable HTML report route is missing matrix HTML host: ${host}`);
  }

  const prefixCollisionRouting = routing.replace(
    ", or WorkBuddy, or a portable visual is explicitly requested",
    ", or WorkBuddy Enterprise, or a portable visual is explicitly requested",
  );
  assert.notEqual(prefixCollisionRouting, routing, "prefix-collision fixture did not replace the WorkBuddy route entry");
  assert.deepEqual(missingPortableHtmlRouteHosts(matrix, prefixCollisionRouting), ["WorkBuddy"]);
});
