import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initSync, parse } from "es-module-lexer";
import { describe, expect, it } from "vitest";

initSync();

function resolvedBuiltGraph(entry: string): Set<string> {
  const visited = new Set<string>();
  const visit = (file: string): void => {
    if (visited.has(file)) return;
    visited.add(file);
    const [imports] = parse(readFileSync(file, "utf8"));
    for (const imported of imports) {
      if (!imported.n) continue;
      if (imported.n.startsWith(".")) visit(resolve(dirname(file), imported.n));
      else visited.add(imported.n);
    }
  };
  visit(entry);
  return visited;
}

describe("harness-ui package graph", () => {
  it("keeps the built main entry injection-only", () => {
    const graph = resolvedBuiltGraph(fileURLToPath(new URL("../dist/index.js", import.meta.url)));
    expect([...graph].some((item) =>
      item === "@qoder-ai/harness/exec" || item.includes("qoder-sdk") || item.includes("pi-sdk"),
    )).toBe(false);
  });
});
