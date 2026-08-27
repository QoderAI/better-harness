import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { describeArtifactCatalog, indexArtifactDirectory } from "../src/server/artifacts/registry/artifact-catalog.js";
import {
  artifactCompileCount,
  artifactPreviewHtml,
  compileArtifactPreview,
  resetArtifactCompileRuntime,
  resolveArtifactCompileLimits,
} from "../src/server/artifacts/registry/artifact-compile-runtime.js";
import { resolveArtifactPlugin } from "../src/server/artifacts/registry/artifact-plugin-registry.js";

async function compileEntry(directory: string, label: string, limits?: Parameters<typeof compileArtifactPreview>[0]["limits"]) {
  const index = await indexArtifactDirectory(directory, { includeDigests: true });
  const entry = index.entries.find((candidate) => candidate.label === label)!;
  const resolution = resolveArtifactPlugin(entry);
  const descriptor = describeArtifactCatalog(index, (candidate) => resolveArtifactPlugin(candidate))
    .artifacts.find((candidate) => candidate.id === entry.id)!;
  return compileArtifactPreview({ artifactRoot: directory, entry, descriptor, buildRuntime: resolution.buildRuntime, limits });
}

describe("ArtifactCompileRuntime", () => {
  it("bundles confined React and CSS sources and reuses an unchanged build", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-compile-"));
    await writeFile(join(directory, "copy.ts"), 'export const copy = "first render";\n', "utf8");
    await writeFile(join(directory, "card.css"), ".card { color: rebeccapurple; }\n", "utf8");
    await writeFile(join(directory, "card.canvas.tsx"), [
      'import { copy } from "./copy.ts";',
      'import "./card.css";',
      'export default () => <main className="card">{copy}</main>;',
    ].join("\n"), "utf8");

    const first = await compileEntry(directory, "card.canvas.tsx");
    const second = await compileEntry(directory, "card.canvas.tsx");
    expect(first.snapshot.status).toBe("ready");
    expect(first.snapshot.runtime).toEqual({ id: "studio.sandboxed-react", version: "5" });
    expect(first.snapshot.buildId).toBe(second.snapshot.buildId);
    expect(first.snapshot.sequence).toBe(second.snapshot.sequence);
    expect(first.css).toContain("rebeccapurple");
    expect(first.code).toContain("first render");
    expect(artifactCompileCount()).toBe(1);
    const html = artifactPreviewHtml(first);
    expect(html).toContain("runtime.init");
    expect(html).toContain("renderCompleted");
    expect(html).not.toContain(directory);

    await writeFile(join(directory, "copy.ts"), 'export const copy = "newer render";\n', "utf8");
    const changed = await compileEntry(directory, "card.canvas.tsx");
    expect(changed.snapshot.status).toBe("ready");
    expect(changed.snapshot.buildId).not.toBe(first.snapshot.buildId);
    expect(changed.snapshot.revisionId).toBe(first.snapshot.revisionId);
    expect(changed.code).toContain("newer render");
    expect(artifactCompileCount()).toBe(2);
  });

  it("compiles one revision once when its build is requested concurrently", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-compile-"));
    await writeFile(join(directory, "concurrent.canvas.tsx"), 'export default () => <p>shared</p>;\n', "utf8");

    // The build route and the preview route both compile on demand, so two
    // Studio tabs opening the same artifact would otherwise run esbuild twice
    // over identical bytes.
    const [first, second] = await Promise.all([
      compileEntry(directory, "concurrent.canvas.tsx"),
      compileEntry(directory, "concurrent.canvas.tsx"),
    ]);
    expect(first.snapshot.status).toBe("ready");
    expect(second.snapshot.buildId).toBe(first.snapshot.buildId);
    expect(second.snapshot.sequence).toBe(first.snapshot.sequence);
    expect(artifactCompileCount()).toBe(1);
  });

  it("compiles explicit AgentReact projects through the production Worker and profile", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-agent-react-"));
    await writeFile(join(directory, "stat-row.tsx"), [
      "export function StatRow({value}:{value:number}) {",
      '  return <strong data-value="count">{value}</strong>;',
      "}",
    ].join("\n"), "utf8");
    await writeFile(join(directory, "orders.agent.canvas.tsx"), [
      'import { defineArtifactView, useArtifactAction, useArtifactState } from "@studio/agent-react";',
      'import { StatRow } from "./stat-row.js";',
      "function Orders() {",
      '  const [items, setItems] = useArtifactState<readonly string[]>("/items");',
      '  const showSource = useArtifactAction("studio.show-source");',
      "  return <main><h1>AgentReact orders</h1><StatRow value={items.length} />",
      '    <button onClick={() => setItems([...items, "next"])}>Add</button>',
      '    <button onClick={() => void showSource()}>Show source</button></main>;',
      "}",
      "export default defineArtifactView({",
      '  id: "orders",',
      '  state: { "/items": { schema: "list", version: 1 } },',
      '  capabilities: ["studio.show-source"],',
      "  component: Orders,",
      "});",
    ].join("\n"), "utf8");

    const compiled = await compileEntry(directory, "orders.agent.canvas.tsx");

    expect(compiled.snapshot.status, JSON.stringify(compiled.snapshot.diagnostics)).toBe("ready");
    expect(compiled.snapshot).toMatchObject({
      status: "ready",
      agentReact: {
        protocolVersion: "agent-react/1",
        view: {
          id: "orders",
          state: [{ path: "/items", schema: "list", version: 1 }],
          capabilities: ["studio.show-source"],
        },
      },
    });
    expect(compiled.code?.length).toBeGreaterThan(10_000);
    expect(JSON.stringify(compiled.snapshot)).not.toContain(directory);
  });

  it("compiles an AgentReact project through a barrel re-export", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-agent-react-barrel-"));
    await writeFile(join(directory, "orders.tsx"), [
      "export function Orders() {",
      "  return <main><h1>Orders through barrel</h1></main>;",
      "}",
    ].join("\n"), "utf8");
    await writeFile(join(directory, "index.ts"), 'export { Orders } from "./orders.js";\n', "utf8");
    await writeFile(join(directory, "orders.agent.canvas.tsx"), [
      'import { defineArtifactView } from "@studio/agent-react";',
      'import { Orders } from "./index.js";',
      'export default defineArtifactView({ id: "orders", component: Orders });',
    ].join("\n"), "utf8");

    const compiled = await compileEntry(directory, "orders.agent.canvas.tsx");

    expect(compiled.snapshot.status, JSON.stringify(compiled.snapshot.diagnostics)).toBe("ready");
    expect(compiled.snapshot.agentReact?.view.id).toBe("orders");
    expect(compiled.code).toContain("Orders through barrel");
  });

  it("does not cache a transient AgentReact build deadline", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-agent-react-timeout-"));
    await writeFile(join(directory, "orders.agent.canvas.tsx"), [
      'import { defineArtifactView } from "@studio/agent-react";',
      "function Orders() { return <h1>Orders</h1>; }",
      'export default defineArtifactView({ id: "orders", component: Orders });',
    ].join("\n"), "utf8");

    const first = await compileEntry(directory, "orders.agent.canvas.tsx", { timeoutMs: 1 });
    const second = await compileEntry(directory, "orders.agent.canvas.tsx", { timeoutMs: 1 });

    expect(first.snapshot.status).toBe("failed");
    expect(first.snapshot.diagnostics[0]?.message).toContain("deadline");
    expect(second.snapshot.status).toBe("failed");
    expect(artifactCompileCount()).toBe(2);
  });

  it("fails closed for package imports and filesystem escapes", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-compile-"));
    await writeFile(join(directory, "package.canvas.tsx"), 'import thing from "not-installed"; export default () => <p>{thing}</p>;\n', "utf8");
    await writeFile(join(directory, "escape.canvas.tsx"), 'import "../outside.ts"; export default () => <p>unsafe</p>;\n', "utf8");

    const packageBuild = await compileEntry(directory, "package.canvas.tsx");
    expect(packageBuild.snapshot.status).toBe("failed");
    expect(packageBuild.snapshot.previewUri).toBeUndefined();
    expect(packageBuild.snapshot.diagnostics[0]?.message).toContain("is not available in Artifact Preview");

    const escapeBuild = await compileEntry(directory, "escape.canvas.tsx");
    expect(escapeBuild.snapshot.status).toBe("failed");
    expect(escapeBuild.snapshot.diagnostics[0]?.message).toContain("escapes the artifact directory");
    expect(JSON.stringify(escapeBuild.snapshot)).not.toContain(directory);
  });

  it("compiles SVG and Beautiful Mermaid through trusted virtual React modules", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-documents-"));
    await writeFile(join(directory, "diagram.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><text>safe</text></svg>', "utf8");
    await writeFile(join(directory, "diagram.mmd"), "graph TD\n  Start --> Finish\n", "utf8");

    const svg = await compileEntry(directory, "diagram.svg");
    const mermaid = await compileEntry(directory, "diagram.mmd");

    expect(svg.snapshot.status).toBe("ready");
    expect(svg.code).toContain("image/svg+xml");
    expect(mermaid.snapshot.status).toBe("ready");
    expect(mermaid.code?.length).toBeGreaterThan(1_000);
    expect(mermaid.code?.length).toBeLessThan(4 * 1024 * 1024);
    expect(mermaid.snapshot.buildId).not.toBe(svg.snapshot.buildId);
  });

  it("keeps the Studio Mermaid dependency closure trusted inside an open repository", async () => {
    resetArtifactCompileRuntime();
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    const label = "docs/better-harness-doc-links.mmd";
    const index = await indexArtifactDirectory(repositoryRoot, { includeDigests: true, includePaths: [label] });
    const entry = index.entries[0]!;
    const resolution = resolveArtifactPlugin(entry);
    const descriptor = describeArtifactCatalog(index, (candidate) => resolveArtifactPlugin(candidate)).artifacts[0]!;

    const mermaid = await compileArtifactPreview({ artifactRoot: repositoryRoot, entry, descriptor, buildRuntime: resolution.buildRuntime });

    expect(mermaid.snapshot.status).toBe("ready");
    expect(mermaid.snapshot.diagnostics).toEqual([]);
  });

  it("keeps Beautiful Mermaid private to Studio-generated modules", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-packages-"));
    await writeFile(join(directory, "package.canvas.tsx"), [
      'import { renderMermaidSVG } from "beautiful-mermaid";',
      'export default () => <p>{renderMermaidSVG("graph TD\\nA-->B")}</p>;',
    ].join("\n"), "utf8");

    const build = await compileEntry(directory, "package.canvas.tsx");
    expect(build.snapshot.status).toBe("failed");
    expect(build.snapshot.diagnostics[0]?.message).toContain("is not available in Artifact Preview");
  });

  it("binds bounded host limit overrides into build and cache identity", async () => {
    resetArtifactCompileRuntime();
    const directory = await mkdtemp(join(tmpdir(), "artifact-limits-"));
    await writeFile(join(directory, "limited.canvas.tsx"), 'export default () => <p>bounded</p>;\n', "utf8");

    const first = await compileEntry(directory, "limited.canvas.tsx", { maxSourceBytes: 1_024 });
    const second = await compileEntry(directory, "limited.canvas.tsx", { maxSourceBytes: 2_048 });
    expect(first.snapshot.status).toBe("ready");
    expect(second.snapshot.status).toBe("ready");
    expect(second.snapshot.buildId).not.toBe(first.snapshot.buildId);
    expect(artifactCompileCount()).toBe(2);

    expect(() => resolveArtifactCompileLimits({ maxSourceFiles: 513 })).toThrow("no greater than 512");
    expect(() => resolveArtifactCompileLimits({ timeoutMs: 0 })).toThrow("positive integer");
  });
});
