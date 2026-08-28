import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "vitest";

import { getHostProfile } from "../../scripts/host-support/index.mjs";
import { runHarnessDoctor } from "../../scripts/harness-doctor/index.mjs";
import {
  buildPluginLifecyclePlan,
  inspectPluginLifecycle,
  matchesBetterHarnessPlugin,
  stableDigest,
  verifyPluginLifecycle,
  withTimeout,
} from "../../scripts/plugin-lifecycle/index.mjs";

const packageInfo = {
  name: "@qoderai/better-harness",
  version: "0.4.0",
  nodeRange: ">=22",
  npmRange: ">=10",
};

function plugin(overrides = {}) {
  return {
    id: "better-harness@better-harness",
    name: "better-harness",
    version: "0.4.0",
    enabled: true,
    installSources: ["user"],
    skills: [{ name: "better-harness" }],
    evidence: { path: path.join(os.homedir(), ".fixture-host", "plugins", "better-harness", "plugin.json") },
    ...overrides,
  };
}

function collectorWith(pluginsByProvider = {}) {
  return async ({ provider }) => ({
    provider,
    plugins: pluginsByProvider[provider] ?? [],
    diagnostics: {},
  });
}

const baseOptions = {
  packageInfo,
  hostDiscovery: async () => "present",
  workspace: process.cwd(),
};

test("Better Harness identity matching rejects display-name-only candidates", () => {
  const profile = getHostProfile("codex");
  assert.equal(matchesBetterHarnessPlugin(plugin(), profile), true);
  assert.equal(matchesBetterHarnessPlugin({ displayName: "Better Harness", name: "other" }, profile), false);
  assert.equal(matchesBetterHarnessPlugin({ name: "@qoderai/better-harness" }, getHostProfile("pi")), true);
  assert.equal(matchesBetterHarnessPlugin({ piPackageSource: "git:github.com/QoderAI/better-harness" }, getHostProfile("pi")), true);
  assert.equal(matchesBetterHarnessPlugin({ name: "@qoder-ai/better-harness", piPackageSource: "npm:@qoder-ai/better-harness" }, getHostProfile("pi")), true);
  assert.equal(matchesBetterHarnessPlugin({ id: "better-harness" }, profile), true);
  assert.equal(matchesBetterHarnessPlugin({ remotePluginId: "git+ssh://git@github.com/QoderAI/better-harness.git#main" }, profile), true);
});

test("status covers every host and preserves WorkBuddy as unsupported", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "all",
    inventoryCollector: collectorWith({
      claude: [plugin({ claudePluginId: "better-harness@better-harness" })],
      codex: [plugin({ codexPluginId: "better-harness@better-harness" })],
      qoder: [plugin({ qoderPluginId: "better-harness@better-harness" })],
      cursor: [plugin({ cursorPluginId: "better-harness" })],
      qwen: [plugin()],
      copilot: [plugin({ copilotPluginName: "better-harness" })],
      pi: [plugin({ name: "@qoderai/better-harness", piPackageSource: "git:github.com/QoderAI/better-harness" })],
    }),
  });

  assert.deepEqual(
    [...new Set(result.rows.map((row) => row.target.hostId))],
    ["claude", "codex", "qoder", "cursor", "qwen", "copilot", "pi", "workbuddy"],
  );
  const workbuddy = result.rows.find((row) => row.target.hostId === "workbuddy");
  assert.equal(workbuddy.verification, "unobserved");
  assert.ok(workbuddy.diagnostics.some((item) => item.code === "PLUGIN_LIFECYCLE_UNSUPPORTED"));
  const desktop = result.rows.find((row) => row.target.hostId === "codex" && row.target.surfaceId === "desktop");
  assert.equal(desktop.installation, "unknown");
  assert.ok(desktop.diagnostics.some((item) => item.code === "DESKTOP_ENABLEMENT_UNOBSERVED"));
});

test("status keeps multiple installation scopes as independent rows", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "claude",
    inventoryCollector: collectorWith({
      claude: [
        plugin({ id: "better-harness-user", installSources: ["user"] }),
        plugin({ id: "better-harness-project", installSources: ["project"] }),
      ],
    }),
  });
  assert.deepEqual(result.rows.map((row) => row.target.scope), ["user", "project"]);
});

test("status routes isolated homes for inventory surfaces and skips bounded static surfaces", async () => {
  for (const host of ["claude", "codex", "qoder", "cursor", "qwen", "copilot", "pi", "workbuddy"]) {
    let captured;
    const hostHome = path.join(os.tmpdir(), `${host} lifecycle home`);
    await inspectPluginLifecycle({
      ...baseOptions,
      host,
      hostHome,
      inventoryCollector: async (options) => {
        captured = options;
        return { provider: options.provider, plugins: [], diagnostics: {} };
      },
    });
    const profile = getHostProfile(host);
    const inventoryRequired = profile.surfaces.some((surface) => (
      !["bundled", "session-only"].includes(surface.observation.kind)
    ));
    if (!inventoryRequired) {
      assert.equal(captured, undefined, host);
      continue;
    }
    for (const route of profile.inventoryHomeRoutes) {
      assert.equal(
        captured[route.option],
        route.relativePath ? path.join(hostHome, route.relativePath) : hostHome,
      );
    }
  }
});

test("direct status calls normalize relative roots and keep fallback evidence inside the isolated boundary", async () => {
  let captured;
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qwen",
    workspace: ".",
    hostHome: "relative-status-qwen-home",
    inventoryCollector: async (options) => {
      captured = options;
      return { provider: options.provider, plugins: [], diagnostics: {} };
    },
  });
  assert.equal(captured.workspace, process.cwd());
  assert.equal(captured.qwenHome, path.resolve("relative-status-qwen-home"));
  assert.equal(result.rows[0].evidence[0].path, "<workspace>/relative-status-qwen-home");

  const failed = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qwen",
    workspace: ".",
    hostHome: "relative-status-qwen-home",
    inventoryCollector: async () => { throw new Error("fixture failure"); },
  });
  assert.equal(failed.status, "failed");
  assert.equal(failed.rows[0].evidence[0].path, "<workspace>/relative-status-qwen-home");
});

test("status excludes foreign workspace installs and fails closed on unsupported scopes", async () => {
  const foreignClaude = await inspectPluginLifecycle({
    ...baseOptions,
    host: "claude",
    inventoryCollector: collectorWith({
      claude: [plugin({ applicable: false, installSources: ["project"], projectPath: "/other/workspace" })],
    }),
  });
  assert.equal(foreignClaude.rows.some((row) => row.installation === "installed"), false);

  const unknownQoderScope = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qoder",
    surface: "cli",
    inventoryCollector: collectorWith({ qoder: [plugin({ installSources: ["other"] })] }),
  });
  assert.equal(unknownQoderScope.rows[0].installation, "unknown");
  assert.equal(unknownQoderScope.rows[0].verification, "unobserved");
  assert.ok(unknownQoderScope.rows[0].diagnostics.some((item) => item.code === "INSTALL_SCOPE_UNSUPPORTED"));
});

test("Pi keeps persistent inventory separate from session-only activation", async () => {
  const empty = await inspectPluginLifecycle({
    ...baseOptions,
    host: "pi",
    inventoryCollector: collectorWith(),
  });
  assert.deepEqual(
    empty.rows.map((row) => [row.target.surfaceId, row.target.scope, row.installation]),
    [
      ["cli", "user", "not-installed"],
      ["cli-session", "session", "session-only"],
    ],
  );
  const emptySession = empty.rows.find((row) => row.target.surfaceId === "cli-session");
  assert.equal(emptySession.verification, "unobserved");
  assert.ok(emptySession.diagnostics.some((item) => item.code === "SESSION_ACTIVATION_UNOBSERVED"));
  assert.equal(emptySession.diagnostics.some((item) => item.code === "PLUGIN_NOT_INSTALLED"), false);

  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "pi",
    inventoryCollector: collectorWith({
      pi: [plugin({
        name: "@qoderai/better-harness",
        piPackageSource: "git:github.com/QoderAI/better-harness",
        installSources: ["project"],
      })],
    }),
  });
  const persistent = result.rows.find((row) => row.target.surfaceId === "cli");
  const session = result.rows.find((row) => row.target.surfaceId === "cli-session");
  assert.equal(persistent.target.scope, "project");
  assert.equal(persistent.installation, "installed");
  assert.equal(session.target.scope, "session");
  assert.equal(session.installation, "session-only");
  assert.equal(session.version.relation, "unobserved");
  assert.equal(session.checks.length, 0);
  assert.equal(session.evidence.some((item) => item.path.includes("fixture-host")), false);
});

test("Pi session-only status ignores persistent inventory collection failure", async () => {
  let inventoryCalls = 0;
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "pi",
    surface: "cli-session",
    inventoryCollector: async () => {
      inventoryCalls += 1;
      throw new Error("persistent Pi settings are unreadable");
    },
  });
  assert.equal(inventoryCalls, 0);
  assert.equal(result.status, "partial");
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].target.scope, "session");
  assert.equal(result.rows[0].installation, "session-only");
  assert.equal(result.rows[0].verification, "unobserved");
  assert.equal(result.diagnostics.some((item) => item.code === "INVENTORY_COLLECTION_FAILED"), false);
});

test("bundled Qoder desktop does not borrow CLI plugin evidence", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qoder",
    inventoryCollector: collectorWith({
      qoder: [plugin({ version: "9.9.9", skills: [], evidence: { path: "/fixture/qoder-cli/plugin.json" } })],
    }),
  });
  const desktop = result.rows.find((row) => row.target.surfaceId === "desktop");
  assert.equal(desktop.hostDiscovery, "unobserved");
  assert.equal(desktop.installation, "bundled");
  assert.equal(desktop.version.relation, "unobserved");
  assert.equal(desktop.verification, "partial");
  assert.equal(desktop.evidence.some((item) => item.path.includes("qoder-cli")), false);
  assert.equal(desktop.diagnostics.some((item) => item.code === "BETTER_HARNESS_SKILL_MISSING"), false);

  let inventoryCalls = 0;
  const selectedDesktop = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qoder",
    surface: "desktop",
    inventoryCollector: async () => {
      inventoryCalls += 1;
      throw new Error("Qoder CLI inventory is unavailable");
    },
  });
  assert.equal(inventoryCalls, 0);
  assert.equal(selectedDesktop.rows.length, 1);
  assert.equal(selectedDesktop.rows[0].hostDiscovery, "unobserved");
  assert.equal(selectedDesktop.rows[0].installation, "bundled");
  assert.equal(selectedDesktop.diagnostics.some((item) => item.code === "INVENTORY_COLLECTION_FAILED"), false);
});

test("Codex desktop uses only app discovery and bounded desktop evidence", async () => {
  const workspace = path.join(os.tmpdir(), "better-harness-codex-desktop-workspace");
  const hostHome = path.join(workspace, "isolated codex home");
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "codex",
    workspace,
    hostHome,
    hostDiscovery: async () => "absent",
    inventoryCollector: collectorWith({
      codex: [plugin({
        version: "9.9.9",
        skills: [],
        evidence: { path: "/fixture/codex-cli/plugin.json" },
      })],
    }),
  });
  const desktop = result.rows.find((row) => row.target.surfaceId === "desktop");
  assert.equal(desktop.hostDiscovery, "unobserved");
  assert.equal(desktop.installation, "unknown");
  assert.equal(desktop.enablement, "unknown");
  assert.equal(desktop.version.relation, "unobserved");
  assert.equal(desktop.verification, "unobserved");
  assert.deepEqual(desktop.checks, []);
  assert.deepEqual(desktop.evidence, [{
    class: "local-config",
    path: "<workspace>/isolated codex home/Applications/Codex.app",
  }]);
  assert.equal(desktop.evidence.some((item) => item.path.includes("codex-cli")), false);
  assert.equal(desktop.diagnostics.some((item) => item.code === "BETTER_HARNESS_SKILL_MISSING"), false);

  const discovered = await inspectPluginLifecycle({
    ...baseOptions,
    host: "codex",
    surface: "desktop",
    hostDiscovery: async () => "absent",
    inventoryCollector: async ({ provider }) => ({
      provider,
      plugins: [],
      diagnostics: { appBundleExists: true },
    }),
  });
  assert.equal(discovered.rows[0].hostDiscovery, "present");
  assert.equal(discovered.rows[0].installation, "unknown");
  assert.equal(discovered.rows[0].version.relation, "unobserved");
  assert.equal(discovered.rows[0].evidence[0].path, "<system-applications>/Codex.app");

  const absent = await inspectPluginLifecycle({
    ...baseOptions,
    host: "codex",
    surface: "desktop",
    hostDiscovery: async () => "present",
    inventoryCollector: async ({ provider }) => ({
      provider,
      plugins: [],
      diagnostics: { appBundleExists: false },
    }),
  });
  assert.equal(absent.rows[0].hostDiscovery, "absent");
  assert.equal(absent.rows[0].installation, "unknown");
});

test("inventory failure does not project CLI discovery onto Codex Desktop", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "codex",
    hostDiscovery: async () => "present",
    inventoryCollector: async () => { throw new Error("fixture inventory failure"); },
  });
  const cli = result.rows.find((row) => row.target.surfaceId === "cli");
  const desktop = result.rows.find((row) => row.target.surfaceId === "desktop");
  assert.equal(cli.hostDiscovery, "present");
  assert.equal(desktop.hostDiscovery, "unobserved");
  assert.ok(desktop.diagnostics.some((item) => item.code === "INVENTORY_COLLECTION_FAILED"));
});

test("status ordering and digests do not depend on process locale", () => {
  const source = `
    import { inspectPluginLifecycle, stableDigest } from "./scripts/plugin-lifecycle/index.mjs";
    const plugins = ["ä.json", "z.json"].map((name) => ({
      id: "better-harness-" + name,
      name: "better-harness",
      version: "0.4.0",
      enabled: true,
      installSources: ["user"],
      skills: [{ name: "better-harness" }],
      evidence: { path: "/fixture/" + name },
    }));
    const result = await inspectPluginLifecycle({
      host: "claude",
      workspace: process.cwd(),
      packageInfo: ${JSON.stringify(packageInfo)},
      hostDiscovery: async () => "present",
      inventoryCollector: async () => ({ provider: "claude", plugins, diagnostics: {} }),
    });
    process.stdout.write(stableDigest(result.rows));
  `;
  const digestFor = (lang) => {
    const result = spawnSync(process.execPath, ["--input-type=module", "--eval", source], {
      cwd: process.cwd(),
      env: { ...process.env, LANG: lang, LC_ALL: lang },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout;
  };
  assert.equal(digestFor("en_US.UTF-8"), digestFor("sv_SE.UTF-8"));
});

test("invalid status targets fail before host inventory collection", async () => {
  let inventoryCalls = 0;
  await assert.rejects(
    inspectPluginLifecycle({
      ...baseOptions,
      host: "claude",
      surface: "desktop",
      inventoryCollector: async () => {
        inventoryCalls += 1;
        return { plugins: [], diagnostics: {} };
      },
    }),
    (error) => error.code === "UNKNOWN_HOST_SURFACE",
  );
  assert.equal(inventoryCalls, 0);
});

test("disabled installs remain installed while verification stays partial", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "claude",
    inventoryCollector: collectorWith({ claude: [plugin({ enabled: false })] }),
  });
  assert.equal(result.rows[0].installation, "installed");
  assert.equal(result.rows[0].enablement, "disabled");
  assert.equal(result.rows[0].verification, "partial");
  assert.ok(result.rows[0].diagnostics.some((item) => item.code === "PLUGIN_DISABLED"));
});

test("status redacts evidence paths under the user home", async () => {
  const secretHome = path.join(os.homedir(), "private-account-name");
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qwen",
    inventoryCollector: collectorWith({ qwen: [plugin({ evidence: { path: path.join(secretHome, "extension.json") } })] }),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, new RegExp(secretHome.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));
  assert.match(serialized, /~\/private-account-name/u);
});

test("status redacts Windows drive paths case-insensitively", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "qwen",
    platform: "win32",
    home: "C:\\Users\\Alice",
    inventoryCollector: collectorWith({
      qwen: [plugin({ evidence: { path: "c:\\users\\ALICE\\.qwen\\extensions\\better-harness.json" } })],
    }),
  });
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /alice/iu);
  assert.equal(result.rows[0].evidence[0].path, "~/.qwen/extensions/better-harness.json");
});

test("install plans are deterministic, typed, and perform no implicit update", async () => {
  const options = {
    ...baseOptions,
    action: "install",
    host: "qwen",
    surface: "cli",
    scope: "project",
    inventoryCollector: collectorWith(),
  };
  const first = await buildPluginLifecyclePlan(options);
  const second = await buildPluginLifecyclePlan(options);
  assert.equal(first.planId, second.planId);
  assert.equal(first.effects, "none");
  assert.equal(first.state, "ready");
  assert.deepEqual(first.steps[0].argv, [
    "qwen", "extensions", "install", "QoderAI/better-harness", "--scope", "project",
  ]);
  assert.equal(first.steps.every((step) => step.effects === "external"), true);
  assert.equal(first.steps.every((step) => step.externalImpact === "host-plugin-state"), true);
  assert.equal(first.steps.every((step) => step.preconditions.length === 2), true);
  assert.equal(first.activation.newSessionRequired, true);
  assert.equal(first.recovery.length, 3);
  assert.deepEqual(first.target.expectedSource, {
    pluginId: "better-harness",
    repository: "QoderAI/better-harness",
  });

  const installed = await buildPluginLifecyclePlan({
    ...options,
    inventoryCollector: collectorWith({ qwen: [plugin({ installSources: ["project"] })] }),
  });
  assert.equal(installed.state, "noop");
  assert.deepEqual(installed.steps, []);
  assert.match(installed.notes[0], /does not imply update/u);
});

test("Qwen non-link install markers resolve the copied extension artifact and prevent duplicate install plans", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-qwen-non-link-"));
  const qwenHome = path.join(root, ".qwen");
  const workspace = path.join(root, "workspace");
  const extensionRoot = path.join(qwenHome, "extensions", "better-harness");
  const writeJson = async (filePath, value) => {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  };
  try {
    await mkdir(workspace, { recursive: true });
    await writeJson(path.join(extensionRoot, ".qwen-extension-install.json"), {
      type: "local",
      source: path.join(root, "deleted-source-checkout"),
      originSource: "QoderAI/better-harness",
    });
    await writeJson(path.join(extensionRoot, "qwen-extension.json"), {
      name: "better-harness",
      version: "0.4.0",
      displayName: "Better Harness",
    });
    await mkdir(path.join(extensionRoot, "skills", "better-harness"), { recursive: true });
    await writeFile(
      path.join(extensionRoot, "skills", "better-harness", "SKILL.md"),
      "---\nname: better-harness\ndescription: Better Harness.\n---\n",
    );
    await writeJson(path.join(qwenHome, "extension-store", "state.json"), {
      version: 2,
      generation: 1,
      legacyProjectionHash: "0".repeat(64),
      extensions: {
        ["a".repeat(64)]: {
          name: "better-harness",
          artifactGeneration: 1,
          defaultActivation: "enabled",
          workspaceOverrides: {},
        },
      },
    });

    const options = {
      ...baseOptions,
      host: "qwen",
      surface: "cli",
      scope: "user",
      workspace,
      hostHome: qwenHome,
    };
    const status = await inspectPluginLifecycle(options);
    assert.equal(status.rows[0].installation, "installed");
    assert.equal(status.rows[0].target.scope, "user");

    const plan = await buildPluginLifecyclePlan({ ...options, action: "install" });
    assert.equal(plan.state, "noop");
    assert.deepEqual(plan.steps, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("update fails closed when absent and remove preserves non-plugin state", async () => {
  const update = await buildPluginLifecyclePlan({
    ...baseOptions,
    action: "update",
    host: "copilot",
    surface: "cli",
    inventoryCollector: collectorWith(),
  });
  assert.equal(update.state, "blocked");
  assert.ok(update.blockers.some((item) => item.code === "PLUGIN_NOT_INSTALLED"));
  assert.deepEqual(update.steps, []);

  const remove = await buildPluginLifecyclePlan({
    ...baseOptions,
    action: "remove",
    host: "copilot",
    surface: "cli",
    inventoryCollector: collectorWith({ copilot: [plugin()] }),
  });
  assert.equal(remove.state, "ready");
  assert.deepEqual(remove.steps[0].argv, ["copilot", "plugin", "uninstall", "better-harness@better-harness"]);
  assert.ok(remove.retention.includes("Better Harness reports"));
  assert.ok(remove.retention.includes("configured marketplace"));
});

test("unverified host contracts and WorkBuddy remain blocked", async () => {
  const cursor = await buildPluginLifecyclePlan({
    ...baseOptions,
    action: "install",
    host: "cursor",
    surface: "agent",
    inventoryCollector: collectorWith(),
  });
  assert.equal(cursor.state, "blocked");
  assert.ok(cursor.blockers.some((item) => item.code === "HOST_CONTRACT_STALE"));
  assert.deepEqual(cursor.steps, []);

  const workbuddy = await buildPluginLifecyclePlan({
    ...baseOptions,
    action: "install",
    host: "workbuddy",
    surface: "skills",
    inventoryCollector: collectorWith(),
  });
  assert.equal(workbuddy.state, "blocked");
  assert.ok(workbuddy.blockers.some((item) => item.code === "PLUGIN_LIFECYCLE_UNSUPPORTED"));

  await assert.rejects(
    buildPluginLifecyclePlan({
      ...baseOptions,
      action: "install",
      host: "workbuddy",
      surface: "unknown",
      inventoryCollector: collectorWith(),
    }),
    (error) => error.code === "UNKNOWN_HOST_SURFACE",
  );
});

test("Pi session plans preserve the transient -e lifecycle boundary", async () => {
  const install = await buildPluginLifecyclePlan({
    ...baseOptions,
    action: "install",
    host: "pi",
    surface: "cli-session",
    scope: "session",
    inventoryCollector: collectorWith({ pi: [plugin({
      name: "@qoderai/better-harness",
      piPackageSource: "git:github.com/QoderAI/better-harness",
      installSources: ["user"],
    })] }),
  });
  assert.equal(install.state, "manual");
  assert.equal(install.target.scope, "session");
  assert.equal(install.observed[0].installation, "session-only");
  assert.equal(install.steps.length, 1);
  assert.equal(install.steps[0].kind, "manual");
  assert.match(install.steps[0].instruction, /pi -e git:github\.com\/QoderAI\/better-harness/u);
  assert.equal(install.steps[0].cwd, undefined);

  for (const action of ["update", "remove"]) {
    const plan = await buildPluginLifecyclePlan({
      ...baseOptions,
      action,
      host: "pi",
      surface: "cli-session",
      scope: "session",
      inventoryCollector: collectorWith(),
    });
    assert.equal(plan.state, "blocked", action);
    assert.deepEqual(plan.steps, [], action);
    assert.ok(plan.blockers.some((item) => item.code === "LIFECYCLE_OPERATION_NOT_APPLICABLE"), action);
  }
});

test("Codex Desktop manual plans do not collapse unknown installation into absence", async () => {
  for (const action of ["update", "remove"]) {
    const plan = await buildPluginLifecyclePlan({
      ...baseOptions,
      action,
      host: "codex",
      surface: "desktop",
      scope: "user",
      inventoryCollector: async ({ provider }) => ({
        provider,
        plugins: [],
        diagnostics: { appBundleExists: true },
      }),
    });
    assert.equal(plan.observed[0].installation, "unknown", action);
    assert.equal(plan.state, "manual", action);
    assert.equal(plan.status, "partial", action);
    assert.equal(plan.steps.length, 1, action);
    assert.equal(plan.steps[0].kind, "desktop-ui", action);
    assert.equal(plan.blockers.some((item) => item.code === "PLUGIN_NOT_INSTALLED"), false, action);
  }
});

test("every host emits an explicit plan and verification result", async () => {
  const cases = [
    ["claude", "cli", "user", "ready"],
    ["codex", "cli", "user", "ready"],
    ["codex", "desktop", "user", "manual"],
    ["qoder", "desktop", "bundled", "noop"],
    ["qoder", "cli", "user", "manual"],
    ["cursor", "agent", "session", "blocked"],
    ["qwen", "cli", "user", "ready"],
    ["copilot", "cli", "user", "ready"],
    ["pi", "cli", "user", "manual"],
    ["pi", "cli-session", "session", "manual"],
    ["workbuddy", "skills", "user", "blocked"],
  ];
  for (const [host, surface, scope, state] of cases) {
    const plan = await buildPluginLifecyclePlan({
      ...baseOptions,
      action: "install",
      host,
      surface,
      scope,
      inventoryCollector: collectorWith(),
    });
    assert.equal(plan.state, state, `${host}/${surface}`);
  }

  const verification = await verifyPluginLifecycle({
    ...baseOptions,
    host: "all",
    inventoryCollector: collectorWith(),
  });
  assert.deepEqual(
    [...new Set(verification.rows.map((row) => row.target.hostId))].sort(),
    ["claude", "codex", "copilot", "cursor", "pi", "qoder", "qwen", "workbuddy"],
  );
});

test("all-host inventory failure is operational failure, not partial success", async () => {
  const result = await inspectPluginLifecycle({
    ...baseOptions,
    host: "all",
    inventoryCollector: async () => {
      throw new Error(`${os.homedir()}/private/provider-state`);
    },
  });
  assert.equal(result.status, "failed");
  const inventoryRows = result.rows.filter((row) => {
    const surface = getHostProfile(row.target.hostId).surfaces.find(
      (candidate) => candidate.surfaceId === row.target.surfaceId,
    );
    return !["bundled", "session-only"].includes(surface.observation.kind);
  });
  const boundedRows = result.rows.filter((row) => !inventoryRows.includes(row));
  assert.equal(
    inventoryRows.every((row) => row.diagnostics.some((item) => item.code === "INVENTORY_COLLECTION_FAILED")),
    true,
  );
  assert.equal(
    boundedRows.every((row) => row.diagnostics.every((item) => item.code !== "INVENTORY_COLLECTION_FAILED")),
    true,
  );
  assert.doesNotMatch(JSON.stringify(result), new RegExp(os.homedir().replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"));

  const verification = await verifyPluginLifecycle({
    ...baseOptions,
    host: "qwen",
    inventoryCollector: async () => {
      throw new Error("fixture inventory failure");
    },
  });
  assert.equal(verification.status, "failed");
  assert.equal(verification.diagnostics[0].code, "INVENTORY_COLLECTION_FAILED");
});

test("verification fails when an installed plugin omits the canonical Skill", async () => {
  const result = await verifyPluginLifecycle({
    ...baseOptions,
    host: "claude",
    inventoryCollector: collectorWith({ claude: [plugin({ skills: [] })] }),
  });
  assert.equal(result.status, "failed");
  assert.equal(result.summary.failed, 1);
  assert.ok(result.diagnostics.some((item) => item.code === "BETTER_HARNESS_SKILL_MISSING"));
});

async function snapshotTree(root) {
  const files = [];
  async function visit(current, relative = "") {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const nextRelative = relative ? path.join(relative, entry.name) : entry.name;
      const next = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(next, nextRelative);
      else if (entry.isSymbolicLink()) files.push([nextRelative, `symlink:${await readlink(next)}`]);
      else files.push([nextRelative, await readFile(next, "utf8")]);
    }
  }
  await visit(root);
  return files;
}

test("status, plan, and verify do not mutate an isolated host home", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-plugin-readonly-"));
  const hostHome = path.join(root, "codex home");
  const workspace = path.join(root, "workspace ü");
  try {
    await mkdir(hostHome, { recursive: true });
    await mkdir(workspace, { recursive: true });
    const workspaceLink = path.join(root, "workspace link ü");
    await symlink(workspace, workspaceLink, "dir");
    await writeFile(path.join(hostHome, "keep.txt"), "user-owned\n");
    const before = await snapshotTree(root);
    await inspectPluginLifecycle({ host: "codex", hostHome, workspace: workspaceLink, env: { PATH: "" } });
    await buildPluginLifecyclePlan({ action: "install", host: "codex", surface: "cli", hostHome, workspace: workspaceLink, env: { PATH: "" } });
    await verifyPluginLifecycle({ host: "codex", hostHome, workspace: workspaceLink, env: { PATH: "" } });
    await runHarnessDoctor({ platform: "codex", hostHome, workspace: workspaceLink, env: { PATH: "" } });
    assert.deepEqual(await snapshotTree(root), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("stable plan digests ignore object key ordering", () => {
  assert.equal(stableDigest({ b: 2, a: { d: 4, c: 3 } }), stableDigest({ a: { c: 3, d: 4 }, b: 2 }));
});

test("plan ids remain stable when inventory instance order changes", async () => {
  const firstPlugin = plugin({
    id: "better-harness-first",
    evidence: { path: path.join(os.homedir(), ".claude", "plugins", "first.json") },
  });
  const secondPlugin = plugin({
    id: "better-harness-second",
    evidence: { path: path.join(os.homedir(), ".claude", "plugins", "second.json") },
  });
  let reverse = false;
  const inventoryCollector = async ({ provider }) => {
    const plugins = provider === "claude"
      ? (reverse ? [secondPlugin, firstPlugin] : [firstPlugin, secondPlugin])
      : [];
    reverse = !reverse;
    return { provider, plugins, diagnostics: {} };
  };
  const options = {
    ...baseOptions,
    action: "remove",
    host: "claude",
    surface: "cli",
    scope: "user",
    inventoryCollector,
  };
  const first = await buildPluginLifecyclePlan(options);
  const second = await buildPluginLifecyclePlan(options);
  assert.equal(first.planId, second.planId);
  assert.deepEqual(first.currentObservation, second.currentObservation);
});

test("read-only operations honor their timeout", async () => {
  await assert.rejects(
    withTimeout(() => new Promise(() => {}), 5),
    (error) => error.code === "COMMAND_TIMEOUT" && error.retryable === true,
  );
});
