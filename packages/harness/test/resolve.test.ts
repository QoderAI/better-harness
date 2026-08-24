import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import {
  HarnessRevisionSchema,
  ResolutionReportSchema,
  type HarnessIrBundle,
} from "../src/ir/index.js";
import { describeAdapter } from "../src/resolver/adapter-descriptor.js";
import { QODER_ADAPTER_DESCRIPTOR } from "../src/resolver/adapter-registry.js";
import { resolveDeployment, resolveHarness } from "../src/resolver/resolve.js";

const STANDARD = fileURLToPath(new URL("../examples/standard-coding.harness", import.meta.url));

async function compile(source: string): Promise<HarnessIrBundle> {
  const result = await compileHarness(source);
  expect(result.diagnostics.filter((diagnostic) => diagnostic.severity === "error")).toEqual([]);
  return result.bundle!;
}

function capabilitySource(capability: string, declaration = ""): string {
  return `language 0.3
    ${declaration}
    workflow solo { session coder }
    harness h { workflow solo agent coder { ${capability} } }
    runtime qoder { adapter "@harness/adapter-qoder" }
    deployment h-qoder { harness h runtime qoder }`;
}

describe("resolve v0.3 deployments", () => {
  it("produces a schema-valid deployment-bound revision and report", async () => {
    const bundle = await compile(await readFile(STANDARD, "utf8"));

    const { revision, report } = resolveDeployment(bundle, "standard-coding-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    });

    expect(report.errors).toEqual([]);
    expect(Value.Check(HarnessRevisionSchema, revision)).toBe(true);
    expect(Value.Check(ResolutionReportSchema, report)).toBe(true);
    expect(revision?.deployment.id).toBe("standard-coding-qoder");
    expect(revision?.realization).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capabilityId: "impact-analysis",
        dimension: "delivered",
        state: "satisfied",
        mechanism: "prompt-preamble",
      }),
      expect.objectContaining({
        capabilityId: "workspace.read",
        dimension: "exposed",
        state: "satisfied",
        mechanism: "host-tool:Read",
      }),
    ]));
    expect(revision).not.toHaveProperty("requestedPermissions");
    expect(revision).not.toHaveProperty("settings");
  });

  it("is deterministic for identical source, deployment, and adapter facts", async () => {
    const source = await readFile(STANDARD, "utf8");
    const first = resolveDeployment(await compile(source), "standard-coding-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    }).revision!;
    const second = resolveDeployment(await compile(source), "standard-coding-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    }).revision!;

    expect(first.revisionId).toBe(second.revisionId);
  });

  it("fails a tool requirement against prompt-only facts", async () => {
    const bundle = await compile(capabilitySource("require tool workspace.read"));

    const { revision, report } = resolveDeployment(bundle, "h-qoder");

    expect(revision).toBeUndefined();
    expect(report.realizations).toEqual([
      expect.objectContaining({
        capabilityId: "workspace.read",
        dimension: "exposed",
        state: "failed",
        mechanism: null,
      }),
    ]);
    expect(report.errors.join("\n")).toContain("prompt guidance cannot satisfy a tool requirement");
  });

  it("matches a custom tool by both id and exact contract", async () => {
    const bundle = await compile(capabilitySource(
      "require tool review.approve",
      'tool review.approve { contract "urn:test:review.approve:v1" }',
    ));
    const exact = describeAdapter({
      adapterId: "@harness/adapter-qoder",
      toolExposure: {
        "review.approve": {
          hostTool: "ReviewApprove",
          contract: "urn:test:review.approve:v1",
        },
      },
    });
    const mismatched = describeAdapter({
      adapterId: "@harness/adapter-qoder",
      toolExposure: {
        "review.approve": {
          hostTool: "ReviewApprove",
          contract: "urn:test:review.approve:v2",
        },
      },
    });

    expect(resolveDeployment(bundle, "h-qoder", { adapter: exact }).revision?.realization)
      .toContainEqual(expect.objectContaining({ mechanism: "host-tool:ReviewApprove" }));
    const failed = resolveDeployment(bundle, "h-qoder", { adapter: mismatched });
    expect(failed.revision).toBeUndefined();
    expect(failed.report.errors.join("\n")).toContain(
      "contract 'urn:test:review.approve:v2', expected 'urn:test:review.approve:v1'",
    );
  });

  it("fails or satisfies MCP based on an actual adapter connection fact", async () => {
    const bundle = await compile(capabilitySource(
      "connect mcp docs",
      "mcp docs { transport http url env.DOCS_MCP }",
    ));
    const disconnected = resolveDeployment(bundle, "h-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    });
    const connected = resolveDeployment(bundle, "h-qoder", {
      adapter: describeAdapter({
        adapterId: "@harness/adapter-qoder",
        mcpSupport: { mechanism: "mcp-client", transports: ["http"] },
      }),
    });
    const wrongTransport = resolveDeployment(bundle, "h-qoder", {
      adapter: describeAdapter({
        adapterId: "@harness/adapter-qoder",
        mcpSupport: { mechanism: "mcp-client", transports: ["stdio"] },
      }),
    });

    expect(disconnected.revision).toBeUndefined();
    expect(disconnected.report.realizations[0]).toMatchObject({
      dimension: "connected",
      state: "failed",
    });
    expect(connected.revision?.realization[0]).toMatchObject({
      dimension: "connected",
      state: "satisfied",
      mechanism: "mcp-client",
    });
    expect(wrongTransport.report.errors.join("\n")).toContain(
      "cannot connect MCP transport 'http'",
    );
  });

  it("rejects a typed state machine on shipped session-only adapters", async () => {
    const bundle = await compile(`language 0.3
      workflow loop {
        state-machine
        entry author
        on author.ready -> verifier
        stop when verifier.passed
      }
      harness h {
        workflow loop
        agent author { outcomes { ready } }
        agent verifier { outcomes { passed } }
      }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment h-qoder { harness h runtime qoder }`);

    const { revision, report } = resolveDeployment(bundle, "h-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    });

    expect(revision).toBeUndefined();
    expect(report.errors.join("\n")).toContain("cannot orchestrate state-machine workflow");
  });

  it("gates programmatic workflow mode and controller language independently", async () => {
    const bundle = await compile(`language 0.3
      workflow scripted { program deno "flow.ts" }
      harness h { workflow scripted agent driver {} }
      runtime prime { adapter "@harness/adapter-prime" }
      deployment h-prime { harness h runtime prime }`);
    const wrongLanguage = describeAdapter({
      adapterId: "@harness/adapter-prime",
      workflowModes: ["programmatic"],
      programmaticLanguages: ["python"],
    });
    const supported = describeAdapter({
      adapterId: "@harness/adapter-prime",
      workflowModes: ["programmatic"],
      programmaticLanguages: ["deno"],
    });

    expect(resolveDeployment(bundle, "h-prime", { adapter: wrongLanguage }).report.errors.join("\n"))
      .toContain("does not declare that controller language");
    expect(resolveDeployment(bundle, "h-prime", { adapter: supported }).report.status).toBe("resolved");
  });

  it("refuses realization facts from a different adapter package", async () => {
    const bundle = await compile(capabilitySource(""));
    const { revision, report } = resolveHarness(bundle, "h", "qoder", {
      adapter: describeAdapter({ adapterId: "@harness/adapter-other" }),
    });

    expect(revision).toBeUndefined();
    expect(report.errors).toEqual([
      "Runtime 'qoder' selects adapter '@harness/adapter-qoder', but the supplied realization descriptor describes '@harness/adapter-other'.",
    ]);
  });

  it("deep-freezes only the revision boundary", async () => {
    const bundle = await compile(capabilitySource(
      "use skill inspect",
      'skill inspect { description "Inspect first." }',
    ));
    const { revision, report } = resolveDeployment(bundle, "h-qoder", {
      adapter: QODER_ADAPTER_DESCRIPTOR,
    });

    expect(Object.isFrozen(revision)).toBe(true);
    expect(Object.isFrozen(revision?.deployment)).toBe(true);
    expect(Object.isFrozen(revision?.realization[0])).toBe(true);
    expect(Object.isFrozen(bundle)).toBe(false);
    expect(Object.isFrozen(report)).toBe(false);
  });
});
