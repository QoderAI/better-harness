import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import type { HarnessIrBundle } from "../src/ir/index.js";
import { QODER_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";
import { resolveDeployment, resolveHarness } from "../src/resolver/resolve.js";

async function compile(source: string): Promise<HarnessIrBundle> {
  const result = await compileHarness(source);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result.bundle!;
}

describe("v0.3 explicit composition", () => {
  it("resolves the minimal example through its named deployment", async () => {
    const file = fileURLToPath(new URL("../examples/minimal.harness", import.meta.url));
    const bundle = await compile(await readFile(file, "utf8"));

    const { revision, report } = resolveDeployment(bundle, "my-agent-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    });

    expect(report.status).toBe("resolved");
    expect(revision?.deployment).toMatchObject({ id: "my-agent-qoder" });
    expect(revision?.target).toMatchObject({
      runtime: "qoder",
      adapter: "@harness/adapter-qoder",
    });
    expect(revision?.realization).toEqual([
      expect.objectContaining({
        capabilityId: "require-tests",
        dimension: "delivered",
        state: "satisfied",
        mechanism: "prompt-preamble",
      }),
    ]);
  });

  it("does not infer a deployment from a harness and runtime declaration", async () => {
    const bundle = await compile(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder {} }
      runtime qoder { adapter "@harness/adapter-qoder" }`);

    const result = resolveHarness(bundle, "h", "qoder", { adapter: QODER_ADAPTER_DESCRIPTOR });

    expect(result.revision).toBeUndefined();
    expect(result.report.errors).toEqual([
      "Harness 'h' has no declared deployment on runtime 'qoder'.",
    ]);
  });

  it("keeps deployment composition sparse rather than taking a cartesian product", async () => {
    const bundle = await compile(`language 0.3
      workflow a-session { session a }
      workflow b-session { session b }
      harness alpha { workflow a-session agent a {} }
      harness beta { workflow b-session agent b {} }
      runtime qoder { adapter "@harness/adapter-qoder" }
      runtime pi { adapter "@harness/adapter-pi" }
      deployment alpha-qoder { harness alpha runtime qoder }
      deployment beta-pi { harness beta runtime pi }`);

    expect(bundle.deployments.map((deployment) =>
      `${deployment.harness}:${deployment.runtime}`)).toEqual(["alpha:qoder", "beta:pi"]);
    expect(resolveHarness(bundle, "alpha", "pi").report.status).toBe("failed");
    expect(resolveHarness(bundle, "beta", "qoder").report.status).toBe("failed");
  });

  it("requires a deployment id when one harness has several runtime deployments", async () => {
    const bundle = await compile(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder {} }
      runtime qoder { adapter "@harness/adapter-qoder" }
      runtime pi { adapter "@harness/adapter-pi" }
      deployment h-qoder { harness h runtime qoder }
      deployment h-pi { harness h runtime pi }`);

    expect(resolveHarness(bundle, "h").report.errors.join("\n")).toContain(
      "multiple deployments; resolve by deployment id",
    );
    expect(resolveDeployment(bundle, "missing").report.errors).toEqual([
      "Deployment 'missing' is not defined in the bundle.",
    ]);
  });

  it("makes the deployment part of revision identity", async () => {
    const first = await compile(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder {} }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment first { harness h runtime qoder }`);
    const second = await compile(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder {} }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment second { harness h runtime qoder }`);

    const firstRevision = resolveDeployment(first, "first", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    }).revision!;
    const secondRevision = resolveDeployment(second, "second", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    }).revision!;

    expect(firstRevision.deployment.id).toBe("first");
    expect(secondRevision.deployment.id).toBe("second");
    expect(firstRevision.revisionId).not.toBe(secondRevision.revisionId);
  });
});
