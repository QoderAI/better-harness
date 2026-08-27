import { describe, expect, it } from "vitest";
import { AGENT_REACT_PROFILE_VERSION, type CompileModuleOutput, type Diagnostic } from "../../src/agent-react/contracts/index.js";
import { createOxcCompiler } from "../../src/agent-react/kernel/compiler.js";

const compiler = createOxcCompiler();
const ALLOWED = ["react", "@studio/agent-react", "@studio/agent-react/jsx-dev-runtime"] as const;

async function compile(text: string, entry = false): Promise<CompileModuleOutput> {
  return compiler.compileModule({ module: { path: "/view.tsx", text }, entry, allowedPackages: ALLOWED });
}

function errors(output: CompileModuleOutput): readonly Diagnostic[] {
  return output.diagnostics.filter((diagnostic) => diagnostic.level === "error");
}

function codesOf(output: CompileModuleOutput): readonly string[] {
  return errors(output).map((diagnostic) => diagnostic.code);
}

const CONFORMING = `import { defineArtifactView, useArtifactState } from "@studio/agent-react";

function Panel() {
  const [orders] = useArtifactState<readonly string[]>("/orders");
  return <section className="panel"><span>{orders.length}</span></section>;
}

export default defineArtifactView({
  id: "orders.dashboard",
  state: { "/orders": { schema: "orders", version: 2 } },
  capabilities: ["orders.refresh", "orders.read", "orders.read"],
  component: Panel,
});
`;

describe("AgentReact Profile (AR-AC-2)", () => {
  it("reports its Profile version alongside the compiler version", () => {
    expect(compiler.profileVersion).toBe(AGENT_REACT_PROFILE_VERSION);
    expect(compiler.compilerVersion).toMatch(/^oxc-/);
    expect(compiler.policyFingerprint).toContain("maxModuleBytes");
  });

  it("emits code and no error diagnostics for a conforming module", async () => {
    const output = await compile(CONFORMING, true);

    expect(errors(output)).toEqual([]);
    expect(typeof output.code).toBe("string");
    expect(output.sourceMap).toBeTypeOf("string");
  });

  it.each([
    ["profile/commonjs", 'const fs = require("node:fs");'],
    ["profile/commonjs", "module.exports = Panel;"],
    ["profile/commonjs", "exports.Panel = Panel;"],
    ["profile/node-builtin", 'import { readFile } from "node:fs/promises";'],
    ["profile/node-builtin", 'import path from "path";'],
    ["profile/dynamic-import", 'const later = () => import("./panel.js");'],
    ["profile/package-not-allowed", 'import lodash from "lodash";'],
    ["profile/react-dom-root", "const mount = (node) => createRoot(node).render(null);"],
    ["profile/react-dom-root", "const mount = (node) => ReactDOM.render(null, node);"],
    ["profile/dynamic-eval", 'const run = () => eval("1");'],
    ["profile/dynamic-eval", 'const run = () => new Function("return 1");'],
    ["profile/worker", 'const spawn = () => new Worker("worker.js");'],
    ["profile/worker", "const sw = () => navigator.serviceWorker;"],
    ["profile/network", 'const load = () => fetch("/api/orders");'],
    ["profile/network", 'const live = () => new WebSocket("wss://example.test");'],
    ["profile/network", 'const beacon = () => navigator.sendBeacon("/x");'],
    ["profile/class-component", "class Panel extends React.Component {}"],
    ["profile/top-level-effect", 'console.log("boot");'],
    ["profile/top-level-effect", "for (let index = 0; index < 3; index += 1) {}"],
    ["profile/top-level-effect", "if (globalThis.debug) {}"],
  ])("refuses %s and emits no code", async (code, snippet) => {
    const output = await compile(`${CONFORMING}\n${snippet}\n`, true);

    expect(codesOf(output)).toContain(code);
    expect(output.code).toBeUndefined();
  });

  it("locates a refusal at the offending line and column", async () => {
    const output = await compile('import lodash from "lodash";\n', false);
    const [diagnostic] = errors(output);

    expect(diagnostic?.code).toBe("profile/package-not-allowed");
    expect(diagnostic?.module).toBe("/view.tsx");
    expect(diagnostic?.line).toBe(1);
    expect(diagnostic?.column).toBeGreaterThan(1);
  });

  it("accepts a module directive and internal relative imports", async () => {
    const output = await compile(`"use client";\nimport { StatRow } from "./stat-row.js";\nexport const Row = StatRow;\n`);

    expect(errors(output)).toEqual([]);
  });

  it("reports a syntax error instead of a Profile refusal", async () => {
    const output = await compile("export default function ( {\n");

    expect(codesOf(output)).toEqual(["syntax/parse-failed"]);
    expect(output.code).toBeUndefined();
  });

  it("enforces the per-module byte budget", async () => {
    const small = createOxcCompiler({ maxModuleBytes: 16 });
    const output = await small.compileModule({
      module: { path: "/view.tsx", text: CONFORMING },
      entry: true,
      allowedPackages: ALLOWED,
    });

    expect(codesOf(output)).toEqual(["limit/module-bytes"]);
  });
});

describe("Artifact View ABI (AR-AC-3)", () => {
  it("extracts the declaration exactly as written, sorted and deduplicated", async () => {
    const output = await compile(CONFORMING, true);

    expect(output.viewDeclaration).toEqual({
      id: "orders.dashboard",
      state: [{ path: "/orders", schema: "orders", version: 2 }],
      capabilities: ["orders.read", "orders.refresh"],
      componentName: "Panel",
      module: "/view.tsx",
    });
  });

  it("does not extract a declaration from a non-entry module", async () => {
    const output = await compile(CONFORMING, false);

    expect(output.viewDeclaration).toBeUndefined();
  });

  it("reports a missing view when the entry has no defineArtifactView default export", async () => {
    const output = await compile("export const Panel = () => <div />;\n", true);

    expect(codesOf(output)).toEqual(["abi/missing-view"]);
  });

  it("reports a missing view when defineArtifactView is not the runtime import", async () => {
    const source = `const defineArtifactView = (input) => input;
const Panel = () => <div />;
export default defineArtifactView({ id: "x", component: Panel });
`;
    const output = await compile(source, true);

    expect(codesOf(output)).toContain("abi/missing-view");
  });

  it.each([
    ["a computed id", 'id: ["orders", "dashboard"].join(".")'],
    ["a spread definition", "...base"],
    ["a mapped capability list", 'capabilities: ["a"].map((value) => value)'],
    ["a non-literal state version", 'state: { "/orders": { schema: "orders", version: VERSION } }'],
    ["a spread state descriptor", 'state: { "/orders": { ...base, schema: "orders", version: 1 } }'],
    ["an extra state descriptor field", 'state: { "/orders": { schema: "orders", version: 1, optional: true } }'],
    ["a relative state key", 'state: { "orders": { schema: "orders", version: 1 } }'],
    ["an inline component expression", "component: () => <div />"],
  ])("refuses %s as not static", async (_label, field) => {
    const source = `import { defineArtifactView } from "@studio/agent-react";
const VERSION = 2;
const base = { id: "x" };
const Panel = () => <div />;
export default defineArtifactView({
  id: "orders.dashboard",
  component: Panel,
  ${field},
});
`;
    const output = await compile(source, true);

    expect(codesOf(output)).toContain("abi/not-static");
    expect(output.viewDeclaration).toBeUndefined();
  });

  it("refuses a duplicated state path", async () => {
    const source = `import { defineArtifactView } from "@studio/agent-react";
const Panel = () => <div />;
export default defineArtifactView({
  id: "orders.dashboard",
  state: { "/orders": { schema: "orders", version: 1 }, "/orders": { schema: "orders", version: 2 } },
  component: Panel,
});
`;
    const output = await compile(source, true);

    expect(codesOf(output)).toContain("abi/duplicate-state-path");
  });

  it("accepts a component imported from another Revision module", async () => {
    const source = `import { defineArtifactView } from "@studio/agent-react";
import { Panel } from "./panel.js";
export default defineArtifactView({ id: "orders.dashboard", component: Panel });
`;
    const output = await compile(source, true);

    expect(output.viewDeclaration?.componentName).toBe("Panel");
    expect(errors(output)).toEqual([]);
  });

  it("rejects a component binding imported from a trusted package", async () => {
    const source = `import { useState as Panel } from "react";
import { defineArtifactView } from "@studio/agent-react";
export default defineArtifactView({ id: "orders.dashboard", component: Panel });
`;

    const output = await compile(source, true);

    expect(codesOf(output)).toContain("abi/not-static");
    expect(output.viewDeclaration).toBeUndefined();
  });
});

describe("React semantic index", () => {
  it("indexes components, JSX structure, and hook references", async () => {
    const output = await compile(CONFORMING, true);
    const index = output.semanticIndex;

    expect(index?.components).toEqual([{ name: "Panel", exported: false, line: 3 }]);
    expect(index?.imports).toEqual(["@studio/agent-react"]);
    expect(index?.exports).toEqual(["default"]);
    expect(index?.stateReferences).toEqual(["/orders"]);
    expect(index?.jsxNodes.map((node) => node.elementType)).toEqual(["section", "span"]);
    expect(index?.jsxNodes[0]).toMatchObject({ intrinsic: true, structurePath: [], staticAttributes: ["className"] });
    expect(index?.jsxNodes[1]?.structurePath).toEqual(["section"]);
  });

  it("indexes named and wildcard re-export sources as module dependencies", async () => {
    const output = await compile([
      'export { Panel } from "./panel.js";',
      'export * from "./shared.js";',
    ].join("\n"));

    expect(errors(output)).toEqual([]);
    expect(output.semanticIndex?.imports).toEqual(["./panel.js", "./shared.js"]);
  });

  it("gives two elements of the same type on different lines different source node ids", async () => {
    const source = `const Panel = () => (
  <div>
    <span>a</span>
    <span>b</span>
  </div>
);
export const Row = Panel;
`;
    const index = (await compile(source)).semanticIndex;
    const spans = index?.jsxNodes.filter((node) => node.elementType === "span") ?? [];

    expect(spans).toHaveLength(2);
    expect(spans[0]?.sourceNodeId).not.toBe(spans[1]?.sourceNodeId);
  });
});
