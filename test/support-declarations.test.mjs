import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { PROVIDER_COLLECTORS } from "../scripts/agent-customize/providers/index.mjs";
import {
  HOST_CAPABILITIES,
  HOST_IDS,
  hostIdsFor,
  listHostProfiles,
} from "../scripts/host-support/index.mjs";
import { createAnalyzer, SESSION_ANALYSIS_HELP } from "../scripts/session-analysis/index.mjs";

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

function assertCapabilitySet(actual, capability, label) {
  assert.deepEqual(
    sortedSet(actual),
    sortedSet(hostIdsFor(capability)),
    `${label} disagrees with the ${capability} host slice`,
  );
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

test("agent-customize provider registry matches its declared capability slice", () => {
  assertCapabilitySet([...PROVIDER_COLLECTORS.keys()], HOST_CAPABILITIES.AGENT_CUSTOMIZE, "PROVIDER_COLLECTORS");

  for (const platform of hostIdsFor(HOST_CAPABILITIES.AGENT_CUSTOMIZE)) {
    const providerModule = path.join(process.cwd(), "scripts", "agent-customize", "providers", `${platform}.mjs`);
    assert.ok(existsSync(providerModule), `missing configured-asset provider module: ${providerModule}`);
  }
});

// Hosts whose native plugin lifecycle has no validated contract yet. They stay
// listed here so `plugin` commands fail closed for them instead of inheriting a
// fabricated install route from another host.
const HOSTS_WITHOUT_LIFECYCLE_PROFILE = ["kimi", "grok"];

test("shadow host-support profiles retain parity with canonical providers", () => {
  const profiles = listHostProfiles();
  const catalogHosts = new Set(hostIdsFor(HOST_CAPABILITIES.AGENT_CUSTOMIZE));

  assert.deepEqual(
    sortedSet(profiles.map((profile) => profile.provider)),
    sortedSet(profiles.map((profile) => profile.hostId)),
    "host-support provider references disagree with their host ids",
  );
  for (const profile of profiles) {
    assert.ok(catalogHosts.has(profile.hostId), `host-support profile is not a catalog host: ${profile.hostId}`);
    assert.ok(PROVIDER_COLLECTORS.has(profile.provider), `missing public inventory provider for ${profile.hostId}`);
    assert.ok(profile.surfaces.length > 0, `host-support profile has no surfaces: ${profile.hostId}`);
  }

  const profiledHosts = new Set(profiles.map((profile) => profile.hostId));
  assert.deepEqual(
    [...catalogHosts].filter((hostId) => !profiledHosts.has(hostId)),
    HOSTS_WITHOUT_LIFECYCLE_PROFILE,
    "hosts without a lifecycle profile must stay explicit",
  );
});

test("session-analysis platform loader matches its declared capability slice", async () => {
  for (const platform of hostIdsFor(HOST_CAPABILITIES.SESSION_ANALYSIS)) {
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
  assertCapabilitySet(declared.split(", "), HOST_CAPABILITIES.SESSION_ANALYSIS, "session-analysis loadPlatform error");

  const declaredHelp = SESSION_ANALYSIS_HELP.match(/--platform <([a-z|]+)>/u)?.[1];
  assert.ok(declaredHelp, `exported session-analysis help does not declare a platform list:\n${SESSION_ANALYSIS_HELP}`);
  assertCapabilitySet(declaredHelp.split("|"), HOST_CAPABILITIES.SESSION_ANALYSIS, "SESSION_ANALYSIS_HELP platform list");
});

test("session-analysis CLI help and platform gate agree with the supported platforms", () => {
  const result = runBetterHarness(["session-analysis", "--help"]);
  assert.equal(result.status, 0, result.stderr);

  const declared = result.stdout.match(/--platform <([a-z|]+)>/u)?.[1];
  assert.ok(declared, `session-analysis help does not declare a platform list:\n${result.stdout}`);
  assertCapabilitySet(declared.split("|"), HOST_CAPABILITIES.SESSION_ANALYSIS, "session-analysis --help platform list");

  const gated = runBetterHarness(["session-analysis", "sources", "--platform", "__unsupported__", "--workspace", "."]);
  assert.notEqual(gated.status, 0, "session-analysis CLI accepted an unsupported platform");
  const gateDeclared = `${gated.stderr}${gated.stdout}`.match(/Supported platforms: ([a-z, ]+)\./u)?.[1];
  assert.ok(gateDeclared, `session-analysis CLI did not fail closed with a supported list:\n${gated.stderr}`);
  assertCapabilitySet(gateDeclared.split(", "), HOST_CAPABILITIES.SESSION_ANALYSIS, "session-analysis CLI platform gate");
});

test("harness analyze help and platform gate agree with the supported platforms", () => {
  const help = runBetterHarness(["harness", "analyze", "--help"]);
  assert.equal(help.status, 0, help.stderr);

  const declared = help.stdout.match(/--platform <name>\s+([a-z, ]+or [a-z]+)/u)?.[1];
  assert.ok(declared, `harness analyze help does not declare a platform list:\n${help.stdout}`);
  assertCapabilitySet(
    declared.match(/[a-z]+/gu).filter((word) => word !== "or"),
    HOST_CAPABILITIES.HARNESS_REPORT,
    "harness analyze --help platform list",
  );

  const gated = runBetterHarness(["harness", "analyze", "--platform", "__unsupported__", "--workspace", ".", "--format", "json"]);
  assert.notEqual(gated.status, 0, "harness analyze accepted an unsupported platform");
  const gatedOutput = `${gated.stderr}${gated.stdout}`;
  assert.match(gatedOutput, /unsupported Harness report platform/u);
  const gateDeclared = gatedOutput.match(/Supported platforms: ([a-z, ]+)\./u)?.[1];
  assert.ok(gateDeclared, `harness analyze did not name the supported set on rejection:\n${gatedOutput}`);
  assertCapabilitySet(gateDeclared.split(", "), HOST_CAPABILITIES.HARNESS_REPORT, "harness analyze platform gate");
});

test("asset-baseline provider gate lists exactly the supported platforms", () => {
  const result = runBetterHarness(["coding-agent-practices", "asset-baseline", "__unsupported__", "--workspace", "."]);
  assert.notEqual(result.status, 0, "asset-baseline accepted an unsupported provider");

  const declared = `${result.stderr}${result.stdout}`.match(/Supported providers: ([a-z, ]+)\./u)?.[1];
  assert.ok(declared, `asset-baseline did not fail closed with a supported list:\n${result.stderr}`);
  assertCapabilitySet(declared.split(", "), HOST_CAPABILITIES.ASSET_PRACTICES, "asset-baseline provider gate");
});

test("host adapter matrix documents every catalog host and its explicit capability modules", () => {
  const matrix = readFileSync(adapterMatrixPath, "utf8");

  for (const platform of HOST_IDS) {
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
  assertCapabilitySet(documentedProviders, HOST_CAPABILITIES.AGENT_CUSTOMIZE, "adapter matrix configured-asset providers");
  assertCapabilitySet(documentedPlatforms, HOST_CAPABILITIES.SESSION_ANALYSIS, "adapter matrix session platforms");
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
    ", WorkBuddy, or Grok, or a portable visual is explicitly requested",
    ", WorkBuddy Enterprise, or Grok, or a portable visual is explicitly requested",
  );
  assert.notEqual(prefixCollisionRouting, routing, "prefix-collision fixture did not replace the WorkBuddy route entry");
  assert.deepEqual(missingPortableHtmlRouteHosts(matrix, prefixCollisionRouting), ["WorkBuddy"]);
});
