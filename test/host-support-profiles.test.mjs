import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
  getHostProfile,
  getHostSurface,
  listHostProfiles,
  resolveHostId,
  supportedHostIds,
  validateHostProfiles,
} from "../scripts/host-support/index.mjs";
import { evidence, operation, shell } from "../scripts/host-support/profile-builders.mjs";

const HOSTS = ["claude", "codex", "qoder", "cursor", "qwen", "copilot", "pi", "workbuddy"];
const contractFixture = JSON.parse(readFileSync(
  new URL("./fixtures/plugin-lifecycle/native-help-contracts.v1.json", import.meta.url),
  "utf8",
));

test("host-support profiles cover the canonical host set and aliases", () => {
  assert.deepEqual(supportedHostIds(), HOSTS);
  assert.deepEqual(supportedHostIds({ managedOnly: true }), HOSTS.slice(0, -1));
  assert.equal(resolveHostId("claude-code"), "claude");
  assert.equal(resolveHostId("qwen-code"), "qwen");
  assert.equal(resolveHostId("github-copilot"), "copilot");
  assert.equal(resolveHostId("does-not-exist"), undefined);
  assert.equal(validateHostProfiles(listHostProfiles()), true);
  for (const profile of listHostProfiles()) {
    assert.equal(profile.inventoryHomeOption, `${profile.provider}Home`);
    assert.equal(profile.inventoryHomeRoutes[0].option, profile.inventoryHomeOption);
    assert.equal(profile.inventoryHomeRoutes[0].relativePath, "");
    assert.equal(profile.inventoryHomeRoutes.every((route) => typeof route.fallbackLabel === "string"), true);
    assert.equal(profile.surfaces.every((surface) => typeof surface.observation?.kind === "string"), true);
    assert.equal(profile.surfaces.every((surface) => typeof surface.observation?.discoverySource === "string"), true);
  }
  assert.deepEqual(getHostProfile("claude").inventoryHomeRoutes, [
    { option: "claudeHome", relativePath: "", fallbackLabel: "~/.claude" },
    { option: "claudeStatePath", relativePath: ".claude.json", fallbackLabel: "~/.claude.json" },
  ]);
  assert.deepEqual(getHostProfile("codex").inventoryHomeRoutes, [
    { option: "codexHome", relativePath: "", fallbackLabel: "~/.codex" },
    {
      option: "codexAppPath",
      relativePath: "Applications/Codex.app",
      fallbackLabel: "<system-applications>/Codex.app",
    },
  ]);
  assert.deepEqual(getHostProfile("qoder").inventoryHomeRoutes, [
    { option: "qoderHome", relativePath: "", fallbackLabel: "~/.qoder" },
    {
      option: "qoderSharedClientCacheRoot",
      relativePath: "SharedClientCache",
      fallbackLabel: "<platform-config>/Qoder/SharedClientCache",
    },
  ]);
  assert.deepEqual(getHostProfile("cursor").inventoryHomeRoutes, [
    { option: "cursorHome", relativePath: "", fallbackLabel: "~/.cursor" },
    {
      option: "stateDbPath",
      relativePath: "state.vscdb",
      fallbackLabel: "<platform-config>/Cursor/User/globalStorage/state.vscdb",
    },
  ]);
});

test("surface observation policy captures host differences declaratively", () => {
  assert.equal(getHostSurface("codex", "cli").observation.kind, "inventory");
  assert.deepEqual(getHostSurface("codex", "desktop").observation, {
    kind: "desktop-cache",
    discoveryDiagnostic: "appBundleExists",
    evidenceRouteOption: "codexAppPath",
    discoverySource: "diagnostic",
  });
  assert.deepEqual(getHostSurface("qoder", "desktop").observation, {
    kind: "bundled",
    discoverySource: "unobserved",
  });
  assert.equal(getHostSurface("cursor", "agent").observation.kind, "session-only");
  assert.equal(getHostSurface("cursor", "agent").observation.discoverySource, "executable");
  assert.equal(getHostSurface("pi", "cli").observation.kind, "inventory");
  assert.equal(getHostSurface("pi", "cli").observation.discoverySource, "executable");
  assert.equal(getHostSurface("pi", "cli-session").observation.kind, "session-only");
  assert.equal(getHostSurface("pi", "cli-session").observation.discoverySource, "executable");
  assert.equal(getHostSurface("qwen", "cli").scopeArtifactPolicy, "shared");
  assert.equal(getHostSurface("claude", "cli").scopeArtifactPolicy, "independent");
});

test("native home and shared-artifact declarations have matching reviewable evidence", () => {
  for (const host of ["claude", "codex", "qwen"]) {
    const surface = getHostSurface(host, "cli");
    const fixture = contractFixture.hosts[host].nativeHomeBinding;
    assert.equal(surface.nativeHomeBinding.kind, fixture.kind);
    assert.equal(surface.nativeHomeBinding.variable, fixture.variable);
    assert.equal(surface.nativeHomeBinding.contractEvidence.id, fixture.evidenceId);
  }
  const qwen = getHostSurface("qwen", "cli");
  assert.equal(qwen.scopeArtifactEvidence.id, contractFixture.hosts.qwen.scopeArtifactPolicy.evidenceId);
  assert.equal(qwen.scopeArtifactPolicy, contractFixture.hosts.qwen.scopeArtifactPolicy.kind);
});

test("each canonical host owns one independently importable profile module", async () => {
  const profilesRoot = new URL("../scripts/host-support/profiles/", import.meta.url);
  const modules = readdirSync(profilesRoot)
    .filter((name) => name.endsWith(".mjs"))
    .map((name) => name.slice(0, -4))
    .sort();
  assert.deepEqual(modules, [...HOSTS].sort());

  for (const host of HOSTS) {
    const module = await import(new URL(`${host}.mjs`, profilesRoot));
    assert.equal(module.default.hostId, host);
    assert.equal(module.default.provider, host);
  }
});

test("profile builders reject untyped shell steps and unsupported executable claims", () => {
  assert.throws(() => shell("qwen extensions list", "invalid"), /argv array/u);
  assert.throws(() => shell([], "invalid"), /argv array/u);
  assert.throws(() => operation("supported", [], evidence("missing-step")), /require steps/u);
  assert.throws(() => operation("supported", [shell(["tool", "list"], "listed")]), /contract evidence/u);
  assert.throws(() => operation("guessed"), /Unknown lifecycle disposition/u);
});

test("multi-surface hosts require an explicit surface", () => {
  assert.equal(getHostSurface("codex"), undefined);
  assert.equal(getHostSurface("qoder"), undefined);
  assert.equal(getHostSurface("pi"), undefined);
  assert.equal(getHostSurface("codex", "cli").displayName, "Codex CLI");
  assert.equal(getHostSurface("qoder", "desktop").distributionKind, "bundled");
  assert.equal(getHostSurface("claude").surfaceId, "cli");
});

test("supported lifecycle operations carry typed steps and contract evidence", () => {
  for (const profile of listHostProfiles()) {
    for (const surface of profile.surfaces) {
      for (const [operationName, operation] of Object.entries(surface.lifecycle)) {
        if (operation.disposition !== "supported") continue;
        assert.ok(operation.contractEvidence, `${profile.hostId}/${surface.surfaceId}/${operationName}`);
        assert.ok(operation.steps.length > 0, `${profile.hostId}/${surface.surfaceId}/${operationName}`);
        for (const step of operation.steps) {
          if (step.kind === "shell") {
            assert.ok(Array.isArray(step.argv));
            assert.equal(step.argv.every((arg) => typeof arg === "string"), true);
          }
        }
      }
    }
  }
});

test("known contract gaps remain explicit instead of becoming shell commands", () => {
  const cursor = getHostSurface("cursor", "agent");
  assert.equal(cursor.lifecycle.install.disposition, "unavailable");
  assert.equal(cursor.lifecycle.install.steps.length, 0);
  assert.equal(cursor.lifecycle.install.contractEvidence.kind, "contract-drift");

  const qoder = getHostSurface("qoder", "cli");
  assert.equal(qoder.lifecycle.install.disposition, "manual");
  assert.equal(qoder.lifecycle.update.disposition, "unavailable");

  const pi = getHostSurface("pi", "cli");
  assert.deepEqual(pi.scopes, ["user", "project"]);
  assert.equal(pi.defaultScope, "user");
  assert.equal(pi.lifecycle.install.disposition, "manual");
  assert.equal(pi.lifecycle.update.disposition, "unavailable");
  assert.equal(pi.lifecycle.remove.disposition, "unavailable");

  const piSession = getHostSurface("pi", "cli-session");
  assert.deepEqual(piSession.scopes, ["session"]);
  assert.equal(piSession.defaultScope, "session");
  assert.equal(piSession.lifecycle.install.disposition, "manual");
  assert.match(piSession.lifecycle.install.steps[0].instruction, /pi -e git:github\.com\/QoderAI\/better-harness/u);
  assert.equal(piSession.lifecycle.update.disposition, "not-applicable");
  assert.equal(piSession.lifecycle.remove.disposition, "not-applicable");

  const qwen = getHostSurface("qwen", "cli");
  assert.equal(qwen.lifecycle.update.disposition, "unavailable");
  assert.equal(qwen.lifecycle.remove.disposition, "unavailable");

  assert.equal(getHostProfile("workbuddy").managed, false);
});

test("native help summaries bind six observed CLIs and one unobserved Pi contract", () => {
  assert.deepEqual(Object.keys(contractFixture.hosts), HOSTS.slice(0, -1));
  assert.deepEqual(
    Object.entries(contractFixture.hosts)
      .filter(([, value]) => value.observation === "native-help")
      .map(([host]) => host),
    ["claude", "codex", "qwen", "copilot"],
  );
  assert.equal(contractFixture.hosts.qoder.observation, "native-help-with-drift");
  assert.equal(contractFixture.hosts.cursor.observation, "native-help-with-drift");
  assert.equal(contractFixture.hosts.pi.observation, "unobserved");
  assert.equal(contractFixture.hosts.pi.version, null);
  assert.equal(contractFixture.hosts.pi.installedPackageSource.package, "@earendil-works/pi-coding-agent");
  assert.equal(contractFixture.hosts.pi.installedPackageSource.version, "0.83.0");
  assert.equal(contractFixture.hosts.pi.installedPackageSource.observation, "installed-package-source");
  assert.equal(contractFixture.hosts.pi.installedPackageSource.nativeExecutableObservation, "unobserved");
  const piEvidenceIds = new Set(
    contractFixture.hosts.pi.installedPackageSource.evidence.map((entry) => entry.evidenceId),
  );
  const piPersistent = getHostSurface("pi", "cli");
  const piSession = getHostSurface("pi", "cli-session");
  for (const operation of [piPersistent.lifecycle.install, piPersistent.lifecycle.verify]) {
    assert.equal(operation.contractEvidence.id, "pi-persistent-package-settings-source");
    assert.equal(operation.contractEvidence.kind, "installed-package-source");
    assert.equal(piEvidenceIds.has(operation.contractEvidence.id), true);
  }
  for (const operation of [piSession.lifecycle.install, piSession.lifecycle.verify]) {
    assert.equal(operation.contractEvidence.id, "pi-temporary-extension-source");
    assert.equal(operation.contractEvidence.kind, "installed-package-source");
    assert.equal(piEvidenceIds.has(operation.contractEvidence.id), true);
  }

  for (const profile of listHostProfiles().filter((entry) => entry.managed)) {
    for (const surface of profile.surfaces) {
      for (const operation of Object.values(surface.lifecycle)) {
        if (!operation.contractEvidence) continue;
        assert.equal(
          operation.contractEvidence.fixture,
          "test/fixtures/plugin-lifecycle/native-help-contracts.v1.json",
        );
      }
    }
  }
});

test("host profile validation rejects executable steps without contract evidence", () => {
  const fixture = structuredClone(listHostProfiles());
  delete fixture[0].surfaces[0].lifecycle.install.contractEvidence;
  assert.throws(() => validateHostProfiles(fixture), /lacks evidence/u);
});

test("host profile validation rejects invalid inventory and observation routing", () => {
  const missingHomeOption = structuredClone(listHostProfiles());
  delete missingHomeOption[0].inventoryHomeOption;
  assert.throws(() => validateHostProfiles(missingHomeOption), /inventory home option/u);

  const unknownObservation = structuredClone(listHostProfiles());
  unknownObservation[0].surfaces[0].observation.kind = "host-special-case";
  assert.throws(() => validateHostProfiles(unknownObservation), /observation kind/u);

  const unknownDiscoverySource = structuredClone(listHostProfiles());
  unknownDiscoverySource[0].surfaces[0].observation.discoverySource = "host-special-case";
  assert.throws(() => validateHostProfiles(unknownDiscoverySource), /discovery source/u);

  const missingDiscoveryDiagnostic = structuredClone(listHostProfiles());
  delete missingDiscoveryDiagnostic[1].surfaces[1].observation.discoveryDiagnostic;
  assert.throws(() => validateHostProfiles(missingDiscoveryDiagnostic), /requires a diagnostic/u);

  const mismatchedBundledObservation = structuredClone(listHostProfiles());
  mismatchedBundledObservation[2].surfaces[0].observation.kind = "inventory";
  assert.throws(() => validateHostProfiles(mismatchedBundledObservation), /must use bundled observation/u);

  const unknownEvidenceRoute = structuredClone(listHostProfiles());
  unknownEvidenceRoute[1].surfaces[1].observation.evidenceRouteOption = "missingCodexRoute";
  assert.throws(() => validateHostProfiles(unknownEvidenceRoute), /Unknown observation evidence route/u);
});
