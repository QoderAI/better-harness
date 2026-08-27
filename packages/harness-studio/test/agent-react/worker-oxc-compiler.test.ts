import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";
import { describe, expect, it } from "vitest";
import type { CompileModuleInput } from "../../src/agent-react/contracts/index.js";
import { createWorkerOxcCompiler } from "../../src/agent-react/host/worker-oxc-compiler.js";

const INPUT: CompileModuleInput = {
  module: {
    path: "/orders.tsx",
    text: `import { defineArtifactView } from "@studio/agent-react";
function Orders() { return <h1>Orders</h1>; }
export default defineArtifactView({ id: "orders", component: Orders });
`,
  },
  entry: true,
  allowedPackages: ["react", "@studio/agent-react", "@studio/agent-react/jsx-dev-runtime"],
};

describe("Worker Oxc compiler", () => {
  it("locks every optional native binding declared by the pinned Oxc packages", async () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    const lock = JSON.parse(await readFile(resolve(repositoryRoot, "package-lock.json"), "utf8")) as {
      packages: Record<string, { optionalDependencies?: Record<string, string>; [key: string]: unknown }>;
    };

    for (const packagePath of ["node_modules/oxc-parser", "node_modules/oxc-transform"]) {
      const optionalDependencies = lock.packages[packagePath]?.optionalDependencies ?? {};
      const missing = Object.keys(optionalDependencies)
        .filter((name) => lock.packages[`node_modules/${name}`] === undefined);
      expect(missing, `${packagePath} optional bindings missing from package-lock.json`).toEqual([]);
    }
    expect(lock.packages["node_modules/@oxc-parser/binding-darwin-x64"]).toMatchObject({
      version: "0.147.0",
      optional: true,
      os: ["darwin"],
      cpu: ["x64"],
    });
  });

  it("compiles through the emitted isolated Worker", async () => {
    const compiler = createWorkerOxcCompiler();
    try {
      const output = await compiler.compileModule(INPUT);

      expect(output.diagnostics).toEqual([]);
      expect(output.code).toContain("function Orders");
      expect(output.viewDeclaration).toMatchObject({ id: "orders", componentName: "Orders" });
    } finally {
      await compiler.close();
    }
  });

  it("terminates a timed-out Worker and starts a clean one for the next compile", async () => {
    let workerCount = 0;
    const compiler = createWorkerOxcCompiler({
      timeoutMs: 1_000,
      createWorker(url) {
        workerCount += 1;
        return workerCount === 1
          ? new Worker("setInterval(() => {}, 1_000);", { eval: true })
          : new Worker(url);
      },
    });
    try {
      const timedOut = await compiler.compileModule(INPUT);
      const recovered = await compiler.compileModule(INPUT);

      expect(timedOut.code).toBeUndefined();
      expect(timedOut.diagnostics).toEqual([expect.objectContaining({ code: "limit/compile-timeout" })]);
      expect(recovered.diagnostics).toEqual([]);
      expect(recovered.viewDeclaration?.id).toBe("orders");
      expect(workerCount).toBe(2);
    } finally {
      await compiler.close();
    }
  }, 10_000);

  it("refuses use after close", async () => {
    const compiler = createWorkerOxcCompiler();
    await compiler.close();

    await expect(compiler.compileModule(INPUT)).rejects.toThrow("compiler is closed");
  });
});
