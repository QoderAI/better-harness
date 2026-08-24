import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Value } from "@sinclair/typebox/value";
import { describe, expect, it } from "vitest";
import { compileHarness } from "../src/compiler/compile.js";
import {
  HarnessIrBundleSchema,
  IR_VERSION,
  STANDARD_TOOL_CONTRACTS,
} from "../src/ir/index.js";

const FULL_SURFACE = fileURLToPath(new URL("../examples/full-surface.harness", import.meta.url));
const STANDARD = fileURLToPath(new URL("../examples/standard-coding.harness", import.meta.url));

function errors(result: Awaited<ReturnType<typeof compileHarness>>): string[] {
  return result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message);
}

describe("compileHarness v0.3", () => {
  it("lowers the complete authored surface into schema-valid v0.3 IR", async () => {
    const result = await compileHarness(await readFile(FULL_SURFACE, "utf8"));

    expect(errors(result)).toEqual([]);
    expect(Value.Check(HarnessIrBundleSchema, result.bundle)).toBe(true);
    expect(result.bundle?.irVersion).toBe(IR_VERSION);
    expect(result.bundle?.workflows.map((workflow) => workflow.mode)).toEqual([
      "state-machine",
      "programmatic",
    ]);
    expect(result.bundle?.deployments.map((deployment) => deployment.id)).toEqual([
      "full-qoder",
      "full-pi",
      "scripted-prime",
    ]);
    expect(result.bundle?.tools).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "workspace.read",
        contract: STANDARD_TOOL_CONTRACTS["workspace.read"],
        implicit: false,
      }),
      expect.objectContaining({
        id: "workspace.write",
        contract: STANDARD_TOOL_CONTRACTS["workspace.write"],
        implicit: true,
      }),
      expect.objectContaining({
        id: "review.approve",
        contract: "urn:better-harness:review.approve:v1",
        implicit: false,
      }),
    ]));
  });

  it("compiles the executable example with one explicit deployment", async () => {
    const result = await compileHarness(await readFile(STANDARD, "utf8"));

    expect(errors(result)).toEqual([]);
    expect(result.bundle?.workflows[0]).toMatchObject({ mode: "session", entry: "coder" });
    expect(result.bundle?.deployments).toEqual([
      expect.objectContaining({
        id: "standard-coding-qoder",
        harness: "standard-coding",
        runtime: "qoder",
      }),
    ]);
  });

  it("requires and validates the source language version", async () => {
    const missing = await compileHarness('skill s { description "x" }');
    const unsupported = await compileHarness('language 0.2\nskill s { description "x" }');

    expect(missing.bundle).toBeUndefined();
    expect(errors(missing).join("\n")).toContain("Expecting token of type 'language'");
    expect(unsupported.bundle).toBeUndefined();
    expect(errors(unsupported)).toContain("Unsupported Harness language version '0.2'; expected '0.3'.");
  });

  it("resolves references across versioned source files", async () => {
    const result = await compileHarness([
      {
        uri: "memory://harness/resources.harness",
        text: `language 0.3
          skill inspect { description "Inspect first." }
          workflow solo { session coder }
          runtime qoder { adapter "@harness/adapter-qoder" }`,
      },
      {
        uri: "memory://harness/assembly.harness",
        text: `language 0.3
          harness h { workflow solo agent coder { use skill inspect } }
          deployment h-qoder { harness h runtime qoder }`,
      },
    ]);

    expect(errors(result)).toEqual([]);
    expect(result.bundle?.harnesses[0].workflow).toBe("solo");
  });

  it("synthesizes only frozen standard tool contracts", async () => {
    const standard = await compileHarness(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder { require tool workspace.read } }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment h-qoder { harness h runtime qoder }`);
    const custom = await compileHarness(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder { require tool review.approve } }`);

    expect(errors(standard)).toEqual([]);
    expect(standard.bundle?.tools).toEqual([
      expect.objectContaining({
        id: "workspace.read",
        contract: "builtin:workspace.read@1",
        implicit: true,
      }),
    ]);
    expect(errors(custom).join("\n")).toContain(
      "Unknown tool 'review.approve'; declare it with a contract id",
    );
  });

  it("rejects a locally redefined standard tool contract", async () => {
    const result = await compileHarness(`language 0.3
      tool workspace.read { contract "urn:acme:read:v2" }`);

    expect(errors(result)).toContain(
      "Standard tool 'workspace.read' must use contract 'builtin:workspace.read@1', not 'urn:acme:read:v2'.",
    );
  });

  it("accepts DSL keywords as dotted capability name segments", async () => {
    const result = await compileHarness(`language 0.3
      tool review.connect { contract "urn:test:review.connect:v1" }
      workflow solo { session coder }
      harness h { workflow solo agent coder { require tool review.connect } }`);

    expect(errors(result)).toEqual([]);
    expect(result.bundle?.tools[0].id).toBe("review.connect");
  });

  it("rejects capability verbs that contradict declarations", async () => {
    const result = await compileHarness(`language 0.3
      skill inspect { description "Inspect." }
      workflow solo { session coder }
      harness h { workflow solo agent coder { require tool inspect } }`);

    expect(errors(result)).toContain(
      "'require' expects a tool, but 'inspect' is declared as a skill.",
    );
  });

  it("requires a session workflow to name exactly the harness's one role", async () => {
    const result = await compileHarness(`language 0.3
      workflow solo { session coder }
      harness h {
        workflow solo
        agent coder {}
        agent verifier {}
      }`);

    expect(errors(result).join("\n")).toContain("must declare exactly that one agent");
  });

  it("validates typed state-machine outcomes, reachability, and stops", async () => {
    const result = await compileHarness(`language 0.3
      workflow loop {
        state-machine
        entry author
        on author.ready -> verifier
        on verifier.unknown -> author
      }
      harness h {
        workflow loop
        agent author { outcomes { ready } }
        agent verifier { outcomes { passed } }
        agent unreachable {}
      }`);

    const messages = errors(result).join("\n");
    expect(messages).toContain("declares no stop condition");
    expect(messages).toContain("routes undeclared outcome 'verifier.unknown'");
    expect(messages).toContain("agent 'unreachable' is unreachable");
  });

  it("rejects missing and mixed workflow forms", async () => {
    const empty = await compileHarness("language 0.3\nworkflow empty {}");
    const mixed = await compileHarness(`language 0.3
      workflow mixed { program deno "flow.ts" state-machine entry coder stop when coder.done }`);

    expect(errors(empty).join("\n")).toContain("must declare exactly one");
    expect(errors(mixed).join("\n")).toContain("must declare exactly one");
  });

  it("rejects duplicate deployment ids and harness/runtime pairs", async () => {
    const result = await compileHarness(`language 0.3
      workflow solo { session coder }
      harness h { workflow solo agent coder {} }
      runtime qoder { adapter "@harness/adapter-qoder" }
      deployment one { harness h runtime qoder }
      deployment one { harness h runtime qoder }`);

    const messages = errors(result).join("\n");
    expect(messages).toContain("Duplicate deployment 'one'");
    expect(messages).toContain("Duplicate harness/runtime deployment 'h::qoder'");
  });

  it("validates MCP transport endpoint shape", async () => {
    const result = await compileHarness(`language 0.3
      mcp missing-command { transport stdio }
      mcp missing-url { transport http }
      mcp valid { transport sse url env.DOCS_MCP }`);

    expect(errors(result)).toEqual(expect.arrayContaining([
      "MCP 'missing-command' uses 'stdio' transport but declares no 'command'.",
      "MCP 'missing-url' uses 'http' transport but declares no 'url'.",
    ]));
  });

  it("rejects removed v0.2 authoring syntax instead of ignoring it", async () => {
    const result = await compileHarness(`language 0.3
      skill s { description "x" permissions { workspace read } }
      workflow solo { session coder }
      harness h { workflow solo agent coder { use skill s { minimum advisory } } }
      target qoder`);

    expect(result.bundle).toBeUndefined();
    expect(errors(result).length).toBeGreaterThan(0);
  });
});
