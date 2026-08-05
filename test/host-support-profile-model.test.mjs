import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  defineHostProfile,
  defineSurface,
  desktopUi,
  evidence,
  hostCommand,
  manual,
  operation,
  shell,
} from "../scripts/host-support/profile-builders.mjs";
import {
  validateContractEvidence,
  validateHostProfile,
  validateHostProfileRegistry,
} from "../scripts/host-support/profile-model.mjs";

const HOSTS = ["claude", "codex", "qoder", "cursor", "qwen", "copilot", "pi", "workbuddy"];

function validSurface(overrides = {}) {
  return defineSurface({
    surfaceId: "cli",
    displayName: "Example CLI",
    distributionKind: "package",
    scopes: ["user"],
    defaultScope: "user",
    lifecycle: {
      install: operation("supported", [shell(["example", "install"], "installed")], evidence("example-install")),
      update: operation("unavailable"),
      remove: operation("unavailable"),
      verify: operation("supported", [shell(["example", "list"], "listed")], evidence("example-list")),
    },
    ...overrides,
  });
}

function validProfile(overrides = {}) {
  return defineHostProfile({
    hostId: "example",
    aliases: [],
    displayName: "Example",
    managed: true,
    executables: ["example"],
    surfaces: [validSurface()],
    ...overrides,
  });
}

test("typed builders reject malformed evidence and every instruction representation locally", () => {
  assert.throws(() => evidence(""), /evidence id/u);
  assert.throws(
    () => validateContractEvidence({ id: "x", kind: "help", observedAt: "today", fixture: "fixture.json" }),
    /evidence date/u,
  );
  assert.throws(() => shell("example list", "listed"), /argv array/u);
  assert.throws(() => manual("", "done"), /instruction is missing/u);
  assert.throws(() => hostCommand("", "done"), /host command is missing/u);
  assert.throws(() => desktopUi("", "done"), /instruction is missing/u);
  assert.throws(
    () => shell(["example", "list"], "listed", { command: "example list" }),
    /exactly one typed instruction/u,
  );
  const protectedShell = shell(["example", "list"], "listed", {
    kind: "manual",
    argv: ["other"],
    expected: "other",
  });
  assert.deepEqual(protectedShell, {
    kind: "shell",
    argv: ["example", "list"],
    expected: "listed",
  });
});

test("operation and surface builders fail before aggregate registry loading", () => {
  const step = manual("Open the host UI.", "The plugin is visible.");
  assert.throws(() => operation("manual", [step]), /lacks evidence/u);
  assert.throws(() => operation("manual", [], evidence("manual-empty")), /require steps/u);
  assert.throws(() => operation("unavailable", [step]), /cannot declare steps/u);

  const base = validSurface();
  assert.throws(
    () => defineSurface({ ...structuredClone(base), lifecycle: { ...structuredClone(base.lifecycle), apply: operation("unavailable") } }),
    /operations must be exact/u,
  );
  assert.throws(
    () => defineSurface({ ...structuredClone(base), scopes: ["user", "user"] }),
    /repeats scopes/u,
  );
  assert.throws(
    () => defineSurface({ ...structuredClone(base), scopeValues: { project: "project" } }),
    /not declared/u,
  );
  assert.throws(
    () => defineSurface({
      ...structuredClone(base),
      observation: { kind: "inventory", discoverySource: "diagnostic" },
    }),
    /requires a diagnostic/u,
  );
  assert.throws(
    () => defineSurface({
      ...structuredClone(base),
      observation: { kind: "inventory", discoverySource: "unknown" },
    }),
    /discovery source/u,
  );
});

test("host builders validate local identity and deeply freeze every declaration", async () => {
  assert.throws(() => validProfile({ hostId: "Example" }), /host id/u);
  assert.throws(() => validProfile({ aliases: ["Bad Alias"] }), /host alias/u);
  assert.throws(() => validProfile({ executables: [] }), /Managed host has no executable/u);

  const profile = (await import("../scripts/host-support/profiles/claude.mjs")).default;
  const surface = profile.surfaces[0];
  const lifecycleOperation = surface.lifecycle.install;
  const step = lifecycleOperation.steps[1];
  for (const value of [
    profile,
    profile.aliases,
    profile.identity,
    profile.identity.nativeIds,
    profile.inventoryHomeRoutes,
    profile.inventoryHomeRoutes[0],
    profile.surfaces,
    surface,
    surface.scopes,
    surface.lifecycle,
    lifecycleOperation,
    lifecycleOperation.steps,
    lifecycleOperation.contractEvidence,
    step,
    step.argv,
  ]) {
    assert.equal(Object.isFrozen(value), true);
  }
  assert.throws(() => surface.scopes.push("session"), TypeError);
  assert.throws(() => { step.argv[0] = "other"; }, TypeError);
});

test("inventory home routes stay unique and inside the isolated root", () => {
  assert.doesNotThrow(() => validProfile({
    inventoryHomeRoutes: [
      { option: "exampleHome", relativePath: "", fallbackLabel: "~/.example" },
      {
        option: "exampleAppPath",
        relativePath: "Applications/Example.app",
        fallbackLabel: "<system-applications>/Example.app",
      },
    ],
  }));
  assert.throws(
    () => validProfile({
      inventoryHomeRoutes: [
        { option: "exampleHome", relativePath: "", fallbackLabel: "~/.example" },
        { option: "exampleState", relativePath: "../real-home.json", fallbackLabel: "~/.example-state" },
      ],
    }),
    /must stay inside/u,
  );
  assert.throws(
    () => validProfile({
      inventoryHomeRoutes: [
        { option: "exampleHome", relativePath: "", fallbackLabel: "~/.example" },
        { option: "exampleHome", relativePath: "state", fallbackLabel: "~/.example-state" },
      ],
    }),
    /Duplicate inventory home route/u,
  );
  assert.throws(
    () => validProfile({
      inventoryHomeRoutes: [{ option: "exampleState", relativePath: "state", fallbackLabel: "~/.example-state" }],
    }),
    /Primary inventory home route is missing/u,
  );
  assert.throws(
    () => validProfile({
      inventoryHomeRoutes: [
        { option: "exampleHome", relativePath: "", fallbackLabel: "~/.example" },
        { option: "exampleState", relativePath: "state" },
      ],
    }),
    /fallback/u,
  );
  assert.throws(
    () => validProfile({
      inventoryHomeRoutes: [
        { option: "exampleHome", relativePath: "", fallbackLabel: "/Users/private/.example" },
      ],
    }),
    /must be redacted/u,
  );
  for (const fallbackLabel of [
    "../private/.example",
    "Users/Alice/.example",
    "~/../private/.example",
    "<platform-config>/../private",
    "<System-Applications>/Example.app",
    "<system applications>/Example.app",
  ]) {
    assert.throws(
      () => validProfile({
        inventoryHomeRoutes: [
          { option: "exampleHome", relativePath: "", fallbackLabel },
        ],
      }),
      /must be redacted/u,
    );
  }
});

test("every host module is independently valid and aggregate checks own only identity collisions", async () => {
  const profiles = [];
  for (const host of HOSTS) {
    const profile = (await import(`../scripts/host-support/profiles/${host}.mjs`)).default;
    assert.equal(validateHostProfile(profile), true);
    profiles.push(profile);
  }
  assert.equal(validateHostProfileRegistry(profiles), true);

  const duplicateId = structuredClone(profiles);
  duplicateId[1].hostId = duplicateId[0].hostId;
  assert.throws(() => validateHostProfileRegistry(duplicateId), /Duplicate host id/u);

  const aliasConflictsWithId = structuredClone(profiles);
  aliasConflictsWithId[1].aliases = [profiles[0].hostId];
  assert.throws(() => validateHostProfileRegistry(aliasConflictsWithId), /alias conflicts with host id/u);

  const duplicateAlias = structuredClone(profiles);
  duplicateAlias[0].aliases = ["shared-host"];
  duplicateAlias[1].aliases = ["shared-host"];
  assert.throws(() => validateHostProfileRegistry(duplicateAlias), /Duplicate host alias/u);
});

test("host-support registry facade delegates local schema ownership", () => {
  const indexSource = readFileSync(
    new URL("../scripts/host-support/index.mjs", import.meta.url),
    "utf8",
  );
  assert.match(indexSource, /validateHostProfileRegistry/u);
  assert.doesNotMatch(indexSource, /HOST_DISTRIBUTION_KINDS|HOST_SCOPES|LIFECYCLE_OPERATION_NAMES/u);
  assert.doesNotMatch(indexSource, /distributionKind|defaultScope|contractEvidence|step\.kind/u);

  const builderSource = readFileSync(
    new URL("../scripts/host-support/profile-builders.mjs", import.meta.url),
    "utf8",
  );
  assert.match(builderSource, /profile-model\.mjs/u);
  assert.match(builderSource, /validateHostSurface/u);
  assert.match(builderSource, /validateHostProfile/u);
  assert.match(builderSource, /deepFreeze/u);
});
