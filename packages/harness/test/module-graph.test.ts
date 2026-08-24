import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";

initSync();

function resolvedModuleGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    const resolvedFile = resolveSourceFile(file);
    if (visited.has(resolvedFile)) return;
    visited.add(resolvedFile);
    const [imports] = parse(readFileSync(resolvedFile, "utf8"));
    for (const imported of imports) {
      if (imported.n) follow(imported.n, resolvedFile);
    }
  };
  const follow = (specifier: string, importer: string): void => {
    if (!specifier.startsWith(".")) {
      visited.add(specifier);
      return;
    }
    visit(resolve(dirname(importer), specifier));
  };
  visit(entry);
  return visited;
}

function resolveSourceFile(file: string): string {
  const candidates = [file, file.replace(/\.js$/u, ".ts"), file.replace(/\.js$/u, ".tsx")];
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Cannot resolve module graph entry '${file}'.`);
  return found;
}

describe("package module graph boundaries", () => {
  it("keeps the core and browser verdict entries outside Node and devtool owners", () => {
    const builtCore = fileURLToPath(new URL("../dist/index.js", import.meta.url));
    const builtVerdict = fileURLToPath(new URL("../dist/compare/verdict.js", import.meta.url));
    const core = resolvedModuleGraph(existsSync(builtCore) ? builtCore : fileURLToPath(new URL("../src/index.ts", import.meta.url)));
    const verdict = resolvedModuleGraph(existsSync(builtVerdict) ? builtVerdict : fileURLToPath(new URL("../src/compare/verdict.ts", import.meta.url)));
    const forbidden = [
      "/src/exec/", "/src/compare/runner", "/src/highlight/", "node:",
      "@qoder-ai/qoder-agent-sdk", "@earendil-works/pi-coding-agent", "shiki",
    ];
    for (const graph of [core, verdict]) {
      for (const item of graph) {
        const portableItem = item.replaceAll("\\", "/");
        expect(forbidden.some((needle) => portableItem.includes(needle)), item).toBe(false);
      }
    }
  });

  it("keeps the experiment evidence entry importable from a browser bundle", () => {
    // Asserted against the emitted module, not the source: the contract is what a
    // bundler resolves, and `import type` is indistinguishable from a real import
    // to a lexer reading TypeScript. `npm test` builds first via `pretest`.
    const built = fileURLToPath(new URL("../dist/experiment/evidence.js", import.meta.url));
    if (!existsSync(built)) {
      throw new Error("Run `npm run build -w @qoder-ai/harness` before asserting the emitted module graph.");
    }
    const graph = resolvedModuleGraph(built);

    // Studio renders lane configuration and per-contrast attribution in the
    // browser, so the manifest loader's filesystem access must stay out of reach.
    for (const item of graph) {
      const portableItem = item.replaceAll("\\", "/");
      expect(portableItem.includes("node:"), item).toBe(false);
      expect(portableItem.includes("/experiment/manifest"), item).toBe(false);
    }
  });
});
