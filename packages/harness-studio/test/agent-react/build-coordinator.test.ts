import { describe, expect, it } from "vitest";
import { createBuildCoordinator } from "../../src/agent-react/host/build-coordinator.js";
import { BuildGenerationSuperseded, type ObservationInput } from "../../src/agent-react/contracts/index.js";
import { createOxcCompiler } from "../../src/agent-react/kernel/compiler.js";
import { ORDERS_VIEW_MODULE, revisionOf, STAT_ROW_MODULE, TEST_RUNTIME_PACKAGES } from "./pipeline-fixture.js";

function coordinator(observations: ObservationInput[] = [], runtimeVersion = "1") {
  return createBuildCoordinator({
    compiler: createOxcCompiler(),
    runtimePackages: TEST_RUNTIME_PACKAGES,
    runtimeVersion,
    onObservation: (observation) => observations.push(observation),
  });
}

const ordersRevision = () => revisionOf("orders.dashboard", "/view.tsx", [ORDERS_VIEW_MODULE, STAT_ROW_MODULE]);

describe("AgentReactBuildCoordinator (AR-AC-4)", () => {
  it("links a multi-module Revision into a frozen, runnable Build Snapshot", async () => {
    const snapshot = await coordinator().build(ordersRevision());

    expect(snapshot.status).toBe("ready");
    expect(snapshot.diagnostics).toEqual([]);
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(snapshot.buildGeneration).toBe(1);
    expect(snapshot.artifactId).toBe("orders.dashboard");
    expect(snapshot.viewDeclaration?.capabilities).toEqual(["orders.read", "orders.refresh"]);
    expect(snapshot.semanticIndex.map((index) => index.module).sort()).toEqual(["/stat-row.tsx", "/view.tsx"]);
    expect(snapshot.sourceMaps.map((entry) => entry.module).sort()).toEqual(["/stat-row.tsx", "/view.tsx"]);
    expect(Object.isFrozen(snapshot.sourceMaps[0])).toBe(true);
    expect(Object.isFrozen(snapshot.semanticIndex[0])).toBe(true);
    expect(Object.isFrozen(snapshot.semanticIndex[0]?.jsxNodes[0])).toBe(true);
    expect(Object.isFrozen(snapshot.viewDeclaration?.state[0])).toBe(true);
  });

  it("keeps the build digest stable across identical builds", async () => {
    const revision = ordersRevision();
    const first = await coordinator().build(revision);
    const second = await coordinator().build(revision);

    expect(second.buildDigest).toBe(first.buildDigest);
    expect(second.bundle).toBe(first.bundle);
  });

  it("changes the build digest when the runtime version changes", async () => {
    const revision = ordersRevision();
    const first = await coordinator([], "1").build(revision);
    const second = await coordinator([], "2").build(revision);

    expect(second.buildDigest).not.toBe(first.buildDigest);
    expect(second.artifactDigest).toBe(first.artifactDigest);
  });

  it("changes build identity when effective compile limits change", async () => {
    const revision = ordersRevision();
    const first = await createBuildCoordinator({
      compiler: createOxcCompiler(),
      runtimePackages: TEST_RUNTIME_PACKAGES,
    }).build(revision);
    const second = await createBuildCoordinator({
      compiler: createOxcCompiler({ maxModuleBytes: 600 * 1024 }),
      runtimePackages: TEST_RUNTIME_PACKAGES,
    }).build(revision);

    expect(second.status).toBe("ready");
    expect(second.bundle).toBe(first.bundle);
    expect(second.buildPolicyDigest).not.toBe(first.buildPolicyDigest);
    expect(second.buildDigest).not.toBe(first.buildDigest);
  });

  it("changes build policy identity when an unused Bootstrap permission changes", async () => {
    const revision = ordersRevision();
    const first = await coordinator().build(revision);
    const second = await createBuildCoordinator({
      compiler: createOxcCompiler(),
      runtimePackages: [
        ...TEST_RUNTIME_PACKAGES,
        { specifier: "@studio/catalog", external: "./catalog-v1.js" },
      ],
    }).build(revision);

    expect(second.status).toBe("ready");
    expect(second.bundle).toBe(first.bundle);
    expect(second.buildPolicyDigest).not.toBe(first.buildPolicyDigest);
    expect(second.buildDigest).not.toBe(first.buildDigest);
  });

  it("changes the build digest when the Revision changes", async () => {
    const first = await coordinator().build(ordersRevision());
    const edited = revisionOf("orders.dashboard", "/view.tsx", [
      ORDERS_VIEW_MODULE,
      { ...STAT_ROW_MODULE, text: STAT_ROW_MODULE.text.replace("stat", "stat-row") },
    ]);
    const second = await coordinator().build(edited);

    expect(second.artifactDigest).not.toBe(first.artifactDigest);
    expect(second.buildDigest).not.toBe(first.buildDigest);
  });

  it("rejects a superseded generation instead of returning its bundle", async () => {
    const build = coordinator();
    const first = build.build(ordersRevision());
    const second = build.build(ordersRevision());

    await expect(first).rejects.toBeInstanceOf(BuildGenerationSuperseded);
    expect((await second).buildGeneration).toBe(2);
  });

  it("fails the build and observes a profile violation without emitting a bundle", async () => {
    const observations: ObservationInput[] = [];
    const revision = revisionOf("orders.dashboard", "/view.tsx", [
      { ...ORDERS_VIEW_MODULE, text: `${ORDERS_VIEW_MODULE.text}\nconsole.log("boot");\n` },
      STAT_ROW_MODULE,
    ]);

    const snapshot = await coordinator(observations).build(revision);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.bundle).toBe("");
    expect(snapshot.viewDeclaration).toBeDefined();
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain("profile/top-level-effect");
    expect(observations.map((observation) => observation.kind)).toContain("profileViolation");
  });

  it("fails a Revision whose entry declares no Artifact View", async () => {
    const revision = revisionOf("orders.dashboard", "/view.tsx", [
      { path: "/view.tsx", text: "export const Panel = () => <div />;\n" },
    ]);

    const snapshot = await coordinator().build(revision);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain("abi/missing-view");
  });

  it("enforces the module-count budget before compiling", async () => {
    const build = createBuildCoordinator({
      compiler: createOxcCompiler(),
      runtimePackages: TEST_RUNTIME_PACKAGES,
      maxModules: 1,
    });

    const snapshot = await build.build(ordersRevision());

    expect(snapshot.status).toBe("failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["limit/module-count"]);
  });

  it("requires the Trusted Bootstrap to provide the runtime specifiers", async () => {
    const build = createBuildCoordinator({
      compiler: createOxcCompiler(),
      runtimePackages: [{ specifier: "react", external: "react" }],
    });

    await expect(build.build(ordersRevision())).rejects.toThrow(/Trusted Bootstrap must provide/);
  });

  it("refuses a Revision whose digest does not name its current bytes", async () => {
    const revision = ordersRevision();
    const forged = { ...revision, digest: "sha256:forged" as const };

    const snapshot = await coordinator().build(forged);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toEqual(["revision/digest-mismatch"]);
  });

  it("refuses duplicate and non-normalized module paths from a manually constructed Revision", async () => {
    const revision = ordersRevision();
    const duplicate = { ...revision, modules: [...revision.modules, revision.modules[0]!] };
    const invalidPath = {
      ...revision,
      modules: [{ ...revision.modules[0]!, path: "/a/../view.tsx" }, ...revision.modules.slice(1)],
    };

    expect((await coordinator().build(duplicate)).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "revision/duplicate-module",
    ]);
    expect((await coordinator().build(invalidPath)).diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "revision/path-invalid",
    ]);
  });

  it("requires the static Artifact View id to match the descriptor id", async () => {
    const revision = revisionOf("catalog.orders", "/view.tsx", [ORDERS_VIEW_MODULE, STAT_ROW_MODULE]);

    const snapshot = await coordinator().build(revision);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain("abi/view-id-mismatch");
  });
});

describe("Linker allowlist (AR-AC-6)", () => {
  it("fails the link stage for a package the Profile never saw", async () => {
    const compiler = createOxcCompiler();
    // A compiler that accepts everything stands in for a bypassed Profile: the
    // linker must still refuse, so one defeated check does not produce a bundle.
    const permissive = {
      compilerVersion: compiler.compilerVersion,
      profileVersion: compiler.profileVersion,
      policyFingerprint: compiler.policyFingerprint,
      compileModule: (input: Parameters<typeof compiler.compileModule>[0]) =>
        compiler.compileModule({ ...input, allowedPackages: [...input.allowedPackages, "lodash"] }),
    };
    const build = createBuildCoordinator({ compiler: permissive, runtimePackages: TEST_RUNTIME_PACKAGES });
    const revision = revisionOf("orders.dashboard", "/view.tsx", [
      // The binding is used, because Oxc elides an unused import the way
      // TypeScript does and an elided import would never reach the linker.
      { ...ORDERS_VIEW_MODULE, text: `import { chunk } from "lodash";\n${ORDERS_VIEW_MODULE.text}\nexport const chunked = chunk;\n` },
      STAT_ROW_MODULE,
    ]);

    const snapshot = await build.build(revision);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.bundle).toBe("");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain("link/package-not-allowed");
  });

  it("fails the link stage for an import outside the Revision", async () => {
    const revision = revisionOf("orders.dashboard", "/view.tsx", [
      { ...ORDERS_VIEW_MODULE, text: ORDERS_VIEW_MODULE.text.replace("./stat-row.js", "./missing.js") },
      STAT_ROW_MODULE,
    ]);

    const snapshot = await coordinator().build(revision);

    expect(snapshot.status).toBe("failed");
    expect(snapshot.diagnostics.map((diagnostic) => diagnostic.code)).toContain("link/failed");
  });
});
