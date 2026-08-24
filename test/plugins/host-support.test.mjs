import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import {
  getHostDescriptor,
  HOST_CAPABILITIES,
  HOST_DESCRIPTORS,
  HOST_IDS,
  hostHomeValue,
  hostIdsFor,
  normalizedHostHomeOptions,
} from "../../scripts/host-support/index.mjs";
import {
  normalizeCheckupOptions,
  providerHomeField,
} from "../../scripts/coding-agent-practices/checkup/contract.mjs";
import { createSelectionProfileBundle } from "../../scripts/session-analysis/selection-profile.mjs";

test("host catalog owns stable identity and home option metadata", () => {
  assert.equal(new Set(HOST_IDS).size, HOST_IDS.length);
  assert.deepEqual(HOST_DESCRIPTORS.map((host) => host.id), HOST_IDS);
  for (const host of HOST_DESCRIPTORS) {
    assert.equal(host.homeOption, `${host.id}-home`);
    assert.equal(host.homeProperty, `${host.id}Home`);
    assert.equal(getHostDescriptor(host.id), host);
    assert.ok(host.displayName);
  }
});

test("capability projections are immutable, ordered, and independently addressed", () => {
  for (const capability of Object.values(HOST_CAPABILITIES)) {
    const hostIds = hostIdsFor(capability);
    assert.ok(Object.isFrozen(hostIds));
    assert.deepEqual(hostIds, HOST_DESCRIPTORS
      .filter((host) => host.capabilities.includes(capability))
      .map((host) => host.id));
    for (const host of HOST_DESCRIPTORS) {
      assert.equal(hostIds.includes(host.id), host.capabilities.includes(capability),
        `${host.id}:${capability}`);
    }
  }
  const dsh = getHostDescriptor("dsh");
  assert.ok(Object.isFrozen(dsh.capabilities));
  assert.deepEqual(dsh.capabilities, [
    HOST_CAPABILITIES.SESSION_ANALYSIS,
    HOST_CAPABILITIES.AGENT_CUSTOMIZE,
    HOST_CAPABILITIES.ASSET_PRACTICES,
    HOST_CAPABILITIES.HARNESS_REPORT,
    HOST_CAPABILITIES.EVIDENCE_BUNDLE,
  ]);
  for (const capability of [
    HOST_CAPABILITIES.SESSION_ANALYSIS,
    HOST_CAPABILITIES.AGENT_CUSTOMIZE,
    HOST_CAPABILITIES.ASSET_PRACTICES,
    HOST_CAPABILITIES.HARNESS_REPORT,
    HOST_CAPABILITIES.EVIDENCE_BUNDLE,
  ]) {
    assert.equal(hostIdsFor(capability).includes("dsh"), true, capability);
  }
  for (const capability of [
    HOST_CAPABILITIES.REPORT_RENDERING,
    HOST_CAPABILITIES.CHECKUP,
  ]) {
    assert.equal(hostIdsFor(capability).includes("dsh"), false, capability);
  }
  assert.throws(() => hostIdsFor("unknown"), /Unknown host capability/u);
});

test("host home normalization accepts generic, camel-case, and dashed inputs", () => {
  for (const host of HOST_DESCRIPTORS) {
    const dashedHome = `/isolated/dashed/${host.id}`;
    const camelHome = `/isolated/camel/${host.id}`;
    assert.equal(hostHomeValue({ [host.homeOption]: dashedHome }, host.id), dashedHome);
    assert.equal(hostHomeValue({ [host.homeProperty]: camelHome }, host.id), camelHome);
    assert.deepEqual(normalizedHostHomeOptions({ [host.homeOption]: dashedHome }, host.id), {
      home: dashedHome,
      [host.homeProperty]: dashedHome,
      [host.homeOption]: dashedHome,
    });
    assert.equal(hostHomeValue({ home: "/generic", [host.homeOption]: dashedHome }, host.id), "/generic");
  }
});

test("Checkup binds only its declared host slice", () => {
  const checkupHosts = hostIdsFor(HOST_CAPABILITIES.CHECKUP);
  for (const hostId of checkupHosts) {
    assert.equal(providerHomeField(hostId), getHostDescriptor(hostId).homeProperty);
    assert.equal(normalizeCheckupOptions({ provider: hostId }).provider, hostId);
  }
  for (const hostId of HOST_IDS.filter((candidate) => !checkupHosts.includes(candidate))) {
    assert.equal(providerHomeField(hostId), null);
    assert.throws(
      () => normalizeCheckupOptions({ provider: hostId }),
      new RegExp(`Unsupported checkup provider: ${hostId}`, "u"),
    );
  }
});

test("selection profiles route every declared host home through the generic analyzer contract", async () => {
  for (const hostId of hostIdsFor(HOST_CAPABILITIES.SESSION_ANALYSIS)) {
    const host = getHostDescriptor(hostId);
    const isolatedHome = `/isolated/session/${hostId}`;
    const observed = [];
    const analyzer = {
      async analyze(options) {
        observed.push(options);
        return { scope: { until: options.until }, sessions: [] };
      },
      async resolveScope(options) {
        observed.push(options);
        return { workspace: options.workspace, home: options.home };
      },
      async readSession() {
        throw new Error("readSession must not run for an empty discovery set");
      },
    };
    await createSelectionProfileBundle({
      platform: hostId,
      workspace: "/isolated/workspace",
      until: "2026-08-03T00:00:00.000Z",
      [host.homeOption]: isolatedHome,
    }, {
      async createAnalyzer(requestedHost) {
        assert.equal(requestedHost, hostId);
        return analyzer;
      },
    });
    assert.equal(observed.length, 2);
    for (const options of observed) {
      assert.equal(options.home, isolatedHome);
      assert.equal(options[host.homeProperty], isolatedHome);
    }
  }
});

test("asset-integrity CLI accepts every declared asset host and rejects unknown hosts", (t) => {
  const isolatedRoot = mkdtempSync(path.join(os.tmpdir(), "better-harness-host-gate-"));
  t.onTestFinished(() => rmSync(isolatedRoot, { recursive: true, force: true }));
  const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");
  for (const hostId of hostIdsFor(HOST_CAPABILITIES.ASSET_PRACTICES)) {
    const host = getHostDescriptor(hostId);
    const result = spawnSync(process.execPath, [
      cliPath,
      "coding-agent-practices",
      "asset-integrity",
      hostId,
      "--workspace",
      isolatedRoot,
      `--${host.homeOption}`,
      isolatedRoot,
      ...(hostId === "claude" ? ["--claude-state", path.join(isolatedRoot, "missing-claude-state.json")] : []),
      "--json",
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(result.status, 0, `${hostId}: ${result.stderr}`);
    assert.equal(JSON.parse(result.stdout).kind, "asset-integrity-review");
  }

  const rejected = spawnSync(process.execPath, [
    cliPath,
    "coding-agent-practices",
    "asset-integrity",
    "unknown-host",
    "--workspace",
    isolatedRoot,
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.notEqual(rejected.status, 0);
  assert.match(`${rejected.stderr}${rejected.stdout}`, /Unsupported provider: unknown-host/u);
});
