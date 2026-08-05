import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { getHostProfile, getHostSurface } from "../scripts/host-support/index.mjs";
import { inspectPluginLifecycle } from "../scripts/plugin-lifecycle/index.mjs";
import {
  buildInventoryFailureStatusRow,
  buildObservedStatusRow,
  validatePluginLifecycleStatusRow,
} from "../scripts/plugin-lifecycle/status-row.mjs";

const expectedVersion = "0.4.0";

function installedPlugin(overrides = {}) {
  return {
    id: "better-harness@better-harness",
    name: "better-harness",
    version: expectedVersion,
    enabled: true,
    installSources: ["user"],
    skills: [{ name: "better-harness" }],
    evidence: { path: path.join("fixture", "plugin.json") },
    ...overrides,
  };
}

function observedRow() {
  return buildObservedStatusRow({
    profile: getHostProfile("claude"),
    surface: getHostSurface("claude", "cli"),
    plugin: installedPlugin(),
    scope: "user",
    hostDiscovery: "present",
    expectedVersion,
    options: {},
  });
}

test("observed and inventory-failure paths share one complete status-row shape", () => {
  const observed = observedRow();
  const failure = buildInventoryFailureStatusRow({
    profile: getHostProfile("claude"),
    surface: getHostSurface("claude", "cli"),
    hostDiscovery: "present",
    expectedVersion,
  });

  assert.equal(validatePluginLifecycleStatusRow(observed), true);
  assert.equal(validatePluginLifecycleStatusRow(failure), true);
  assert.deepEqual(Object.keys(failure), Object.keys(observed));
  assert.deepEqual(Object.keys(failure.plugin), Object.keys(observed.plugin));
  assert.deepEqual(Object.keys(failure.target), Object.keys(observed.target));
  assert.deepEqual(Object.keys(failure.version), ["relation"]);
  assert.equal(failure.installation, "unknown");
  assert.equal(failure.diagnostics[0].code, "INVENTORY_COLLECTION_FAILED");
});

test("status-row validation rejects every controlled state family independently", () => {
  const mutations = [
    (row) => { row.hostDiscovery = "maybe"; },
    (row) => { row.installation = "cached"; },
    (row) => { row.enablement = "maybe"; },
    (row) => { row.version.relation = "latest"; },
    (row) => { row.verification = "maybe"; },
    (row) => { row.activation = "loaded"; },
    (row) => { row.checks[0].status = "maybe"; },
    (row) => { row.evidence[0].class = "session-body"; },
    (row) => { row.diagnostics[0].severity = "debug"; },
  ];

  for (const mutate of mutations) {
    const row = structuredClone(observedRow());
    mutate(row);
    assert.throws(() => validatePluginLifecycleStatusRow(row), /PluginLifecycleStatusV1/u);
  }

  assert.throws(
    () => buildObservedStatusRow({
      profile: getHostProfile("claude"),
      surface: getHostSurface("claude", "cli"),
      plugin: installedPlugin(),
      scope: "session",
      hostDiscovery: "present",
      expectedVersion,
      options: {},
    }),
    /scope session is not declared/u,
  );
});

test("all-host status emits only rows accepted by the status model", async () => {
  const result = await inspectPluginLifecycle({
    host: "all",
    workspace: process.cwd(),
    packageInfo: {
      name: "@qoderai/better-harness",
      version: expectedVersion,
      nodeRange: ">=22",
      npmRange: ">=10",
    },
    hostDiscovery: async () => "present",
    inventoryCollector: async ({ provider }) => ({
      provider,
      plugins: [installedPlugin()],
      diagnostics: {},
    }),
  });

  assert.equal(result.rows.length, 11);
  assert.equal(result.rows.every(validatePluginLifecycleStatusRow), true);
});
