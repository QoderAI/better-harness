import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { renderDoctor } from "../scripts/harness-doctor/cli.mjs";
import { runHarnessDoctor } from "../scripts/harness-doctor/index.mjs";
import { discoverHostExecutable } from "../scripts/plugin-lifecycle/index.mjs";

const cliPath = path.join(process.cwd(), "scripts", "better-harness.mjs");

// Windows paths carry backslashes, so leak assertions compare JSON-escaped text
// instead of building a regular expression from a raw path.
function encodedPath(value) {
  return JSON.stringify(value).slice(1, -1);
}

function runCli(args) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
}

const packageInfo = {
  name: "@qoderai/better-harness",
  version: "0.4.0",
  nodeRange: ">=22",
  npmRange: ">=10",
};

function installedPlugin(overrides = {}) {
  return {
    id: "better-harness@better-harness",
    name: "better-harness",
    version: packageInfo.version,
    enabled: true,
    installSources: ["user"],
    skills: [{ name: "better-harness" }],
    evidence: { path: "/fixture/better-harness/plugin.json" },
    ...overrides,
  };
}

test("doctor reports bounded runtime, privacy, and authorized-root facts", async () => {
  const result = await runHarnessDoctor({
    platform: "claude",
    workspace: process.cwd(),
    packageInfo: {
      name: "@qoderai/better-harness",
      version: "9.9.9",
      nodeRange: ">=22",
      npmRange: ">=10",
    },
    hostDiscovery: async () => "absent",
    inventoryCollector: async ({ provider }) => ({ provider, plugins: [], diagnostics: {} }),
  });
  assert.equal(result.runtime.version, "9.9.9");
  assert.equal(result.privacy.network, "none");
  assert.equal(result.privacy.writes, "none");
  assert.equal(result.privacy.transcripts, "not-read");
  assert.deepEqual(result.targets[0].authorizedRoots, ["~/.claude", "~/.claude.json"]);
  assert.equal(result.targets[0].hostDiscovery, "absent");
});

test("doctor preserves per-surface discovery when a host summary is present", async () => {
  const result = await runHarnessDoctor({
    platform: "codex",
    workspace: process.cwd(),
    packageInfo,
    hostDiscovery: async () => "absent",
    inventoryCollector: async ({ provider }) => ({
      provider,
      plugins: [],
      diagnostics: { appBundleExists: true },
    }),
  });

  const target = result.targets[0];
  assert.equal(target.hostDiscovery, "present");
  assert.deepEqual(
    target.lifecycle.map(({ surfaceId, scope, hostDiscovery }) => ({ surfaceId, scope, hostDiscovery })),
    [
      { surfaceId: "cli", scope: "user", hostDiscovery: "absent" },
      { surfaceId: "desktop", scope: "user", hostDiscovery: "present" },
    ],
  );

  const rendered = renderDoctor(result);
  assert.match(rendered, /cli@user\[absent\]:/u);
  assert.match(rendered, /desktop@user\[present\]:/u);
});

test("doctor preserves independent rows for multiple scopes on one surface", async () => {
  const result = await runHarnessDoctor({
    platform: "claude",
    workspace: process.cwd(),
    packageInfo,
    hostDiscovery: async () => "present",
    inventoryCollector: async ({ provider }) => ({
      provider,
      plugins: [
        installedPlugin({ id: "better-harness-user", installSources: ["user"] }),
        installedPlugin({ id: "better-harness-project", installSources: ["project"] }),
      ],
      diagnostics: {},
    }),
  });

  assert.deepEqual(
    result.targets[0].lifecycle.map(({ surfaceId, scope, hostDiscovery }) => ({
      surfaceId,
      scope,
      hostDiscovery,
    })),
    [
      { surfaceId: "cli", scope: "user", hostDiscovery: "present" },
      { surfaceId: "cli", scope: "project", hostDiscovery: "present" },
    ],
  );
  assert.match(renderDoctor(result), /cli@user\[present\]:.*cli@project\[present\]:/u);
});

test("doctor keeps Pi persistent and session-only surfaces distinct", async () => {
  const result = await runHarnessDoctor({
    platform: "pi",
    workspace: process.cwd(),
    packageInfo,
    hostDiscovery: async () => "present",
    inventoryCollector: async ({ provider }) => ({ provider, plugins: [], diagnostics: {} }),
  });

  assert.deepEqual(
    result.targets[0].lifecycle.map(({ surfaceId, scope, installation, verification }) => ({
      surfaceId,
      scope,
      installation,
      verification,
    })),
    [
      { surfaceId: "cli", scope: "user", installation: "not-installed", verification: "failed" },
      { surfaceId: "cli-session", scope: "session", installation: "session-only", verification: "unobserved" },
    ],
  );
  assert.match(renderDoctor(result), /cli@user\[present\]:not-installed\/failed/u);
  assert.match(renderDoctor(result), /cli-session@session\[present\]:session-only\/unobserved/u);

  const failedInventory = await runHarnessDoctor({
    platform: "pi",
    workspace: process.cwd(),
    packageInfo,
    hostDiscovery: async () => "present",
    inventoryCollector: async () => {
      throw new Error("persistent Pi inventory is unreadable");
    },
  });
  assert.equal(failedInventory.targets[0].inventory, "failed");
  assert.deepEqual(
    failedInventory.targets[0].lifecycle.map(({ surfaceId, scope, installation, verification }) => ({
      surfaceId,
      scope,
      installation,
      verification,
    })),
    [
      { surfaceId: "cli", scope: "user", installation: "unknown", verification: "unobserved" },
      { surfaceId: "cli-session", scope: "session", installation: "session-only", verification: "unobserved" },
    ],
  );
  assert.match(renderDoctor(failedInventory), /cli@user\[present\]:unknown\/unobserved/u);
  assert.match(renderDoctor(failedInventory), /cli-session@session\[present\]:session-only\/unobserved/u);
});

test("doctor keeps the host selector separate from Windows executable discovery", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-win32-"));
  try {
    const commandPath = path.join(root, "claude.cmd");
    await writeFile(commandPath, "@echo off\r\n");
    const doctorOptions = {
      platform: "claude",
      runtimePlatform: "win32",
      env: { Path: `${path.join(root, "missing")};${root}`, PathExt: " EXE ; CMD ; .cmd " },
      includeUserHome: false,
      inventoryCollector: async ({ provider }) => ({ provider, plugins: [], diagnostics: {} }),
    };
    const result = await runHarnessDoctor(doctorOptions);
    assert.equal(result.targets[0].hostId, "claude");
    assert.equal(result.targets[0].hostDiscovery, "present");
    assert.equal(await discoverHostExecutable(
      { executables: ["claude.cmd"] },
      { runtimePlatform: "win32", env: doctorOptions.env },
    ), "present");

    await unlink(commandPath);
    await writeFile(path.join(root, "claude"), "not a Windows command\n");
    const bareResult = await runHarnessDoctor(doctorOptions);
    assert.equal(bareResult.targets[0].hostDiscovery, "absent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("doctor reports the effective redacted host-home override", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-roots-"));
  try {
    const hostHome = path.join(workspace, "isolated claude home");
    await mkdir(hostHome);
    const result = await runHarnessDoctor({
      platform: "claude",
      hostHome,
      workspace,
      env: { PATH: "" },
      includeUserHome: false,
      inventoryCollector: async ({ provider }) => ({ provider, plugins: [], diagnostics: {} }),
    });
    assert.deepEqual(result.targets[0].authorizedRoots, [
      "<workspace>/isolated claude home",
      "<workspace>/isolated claude home/.claude.json",
    ]);
    assert.equal(JSON.stringify(result.targets).includes(encodedPath(workspace)), false);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("doctor reports every collector-resolved root and uses declared fallbacks on failure", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-captured-roots-"));
  try {
    const claudeHome = path.join(workspace, "custom claude");
    const claudeStatePath = path.join(workspace, "custom state.json");
    const captured = await runHarnessDoctor({
      platform: "claude",
      workspace,
      hostDiscovery: async () => "absent",
      inventoryCollector: async ({ provider }) => ({
        provider,
        claudeHome,
        claudeStatePath,
        plugins: [],
        diagnostics: {},
      }),
    });
    assert.deepEqual(captured.targets[0].authorizedRoots, [
      "<workspace>/custom claude",
      "<workspace>/custom state.json",
    ]);

    const failed = await runHarnessDoctor({
      platform: "qoder",
      workspace,
      hostDiscovery: async () => "absent",
      inventoryCollector: async () => {
        throw new Error("fixture inventory failure");
      },
    });
    assert.equal(failed.targets[0].inventory, "failed");
    assert.deepEqual(failed.targets[0].authorizedRoots, [
      "~/.qoder",
      "<platform-config>/Qoder/SharedClientCache",
    ]);

    const failedCodex = await runHarnessDoctor({
      platform: "codex",
      workspace,
      hostDiscovery: async () => "absent",
      inventoryCollector: async () => {
        throw new Error("fixture inventory failure");
      },
    });
    assert.deepEqual(failedCodex.targets[0].authorizedRoots, [
      "~/.codex",
      "<system-applications>/Codex.app",
    ]);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("doctor captures and redacts the isolated Codex CLI and desktop roots", async () => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-codex-roots-"));
  try {
    const hostHome = path.join(workspace, "isolated codex home");
    let capturedOptions;
    const result = await runHarnessDoctor({
      platform: "codex",
      workspace,
      hostHome,
      hostDiscovery: async () => "absent",
      inventoryCollector: async (providerOptions) => {
        capturedOptions = providerOptions;
        return {
          provider: providerOptions.provider,
          codexHome: providerOptions.codexHome,
          codexAppPath: providerOptions.codexAppPath,
          plugins: [],
          diagnostics: { appBundleExists: false },
        };
      },
    });
    assert.equal(capturedOptions.codexHome, hostHome);
    assert.equal(capturedOptions.codexAppPath, path.join(hostHome, "Applications", "Codex.app"));
    assert.deepEqual(result.targets[0].authorizedRoots, [
      "<workspace>/isolated codex home",
      "<workspace>/isolated codex home/Applications/Codex.app",
    ]);
    assert.equal(JSON.stringify(result.targets).includes(encodedPath(workspace)), false);
    const desktop = result.targets[0].lifecycle.find((surface) => surface.surfaceId === "desktop");
    assert.equal(result.targets[0].hostDiscovery, "absent");
    assert.equal(desktop.installation, "unknown");
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});

test("host discovery rejects directories named like executables", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-directory-"));
  try {
    await mkdir(path.join(root, "claude"));
    const result = await discoverHostExecutable(
      { executables: ["claude"] },
      { platform: "linux", env: { PATH: root } },
    );
    assert.equal(result, "absent");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("POSIX host discovery requires executable permission", {
  skip: process.platform === "win32" ? "POSIX mode bits are unavailable on Windows" : false,
}, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "better-harness-doctor-mode-"));
  try {
    const executable = path.join(root, "claude");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o644 });
    assert.equal(await discoverHostExecutable(
      { executables: ["claude"] },
      { platform: "linux", env: { PATH: root } },
    ), "absent");
    await chmod(executable, 0o755);
    assert.equal(await discoverHostExecutable(
      { executables: ["claude"] },
      { platform: "linux", env: { PATH: root } },
    ), "present");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("doctor help is side-effect-free even with invalid host inputs", () => {
  const result = runCli([
    "doctor",
    "--platform",
    "does-not-exist",
    "--host-home",
    "/private/path/must-not-be-read",
    "--help",
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.match(result.stdout, /Better Harness doctor/u);
  assert.doesNotMatch(result.stdout, /private\/path/u);
});

test("doctor emits one JSON usage envelope and exit 64", () => {
  const result = runCli(["doctor", "--platform", "--json"]);
  assert.equal(result.status, 64);
  assert.equal(result.stderr, "");
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.schemaVersion, "1");
  assert.equal(payload.command, "better-harness doctor");
  assert.equal(payload.status, "failed");
  assert.equal(payload.data, null);
  assert.equal(payload.artifacts.length, 0);
  assert.equal(payload.diagnostics[0].code, "MISSING_OPTION_VALUE");
  assert.equal(payload.meta.sideEffects, "read-only");
});
