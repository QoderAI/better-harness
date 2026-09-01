import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";
import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";

/**
 * Architecture fitness functions for the AgentReact layering.
 *
 * These assert against the real import graph, parsed with oxc, rather than against
 * source text. Two of them are load-bearing rather than stylistic:
 *
 * - The runtime layer executes inside the sandbox frame. If it ever imports the
 *   kernel, a browser bundle pulls in `oxc-parser`'s native binding and fails to
 *   load at all — a diagram cannot catch that, an import edge can.
 * - The compiler and the runtime must compute a JSX element's address with the
 *   *same* function. Both importing `contracts/addressing.ts` is what makes a
 *   second, drifting copy impossible.
 */

const ROOT = resolve(import.meta.dirname, "..", "..", "src", "agent-react");

/** Layers in dependency order; `contracts` is the sink, `host` the orchestrator. */
const LAYERS = ["contracts", "kernel", "linker", "runtime", "host"] as const;
type Layer = (typeof LAYERS)[number];

/** Which layers each layer may import. A layer may always import itself. */
const ALLOWED_DEPENDENCIES: Readonly<Record<Layer, readonly Layer[]>> = {
  contracts: [],
  kernel: ["contracts"],
  linker: ["contracts"],
  runtime: ["contracts"],
  host: ["contracts", "kernel", "linker", "runtime"],
};

/** External npm packages each layer may depend on. */
const ALLOWED_PACKAGES: Readonly<Record<Layer, readonly string[]>> = {
  contracts: [],
  kernel: ["oxc-parser", "oxc-transform"],
  linker: ["esbuild-wasm"],
  runtime: ["react", "react/jsx-runtime"],
  host: ["react"],
};

/**
 * Layers that may use Node built-ins. `contracts` and `runtime` may not: both are
 * loaded inside the sandbox frame, where `node:crypto` does not exist. That
 * exclusion is why hashing enters the pipeline as an injected `DigestFn` and why
 * `contracts/addressing.ts` inlines its own hash.
 */
const NODE_BUILTINS_ALLOWED: ReadonlySet<Layer> = new Set(["kernel", "linker", "host"]);

interface ModuleRecord {
  /** Path relative to `src/agent-react`, POSIX-separated. */
  readonly id: string;
  readonly layer: Layer | "root";
  /** Resolved ids of same-package imports, in source order. */
  readonly localImports: readonly string[];
  /** Bare specifiers, including `node:` built-ins. */
  readonly packageImports: readonly string[];
  /** Export names defined in this module (not re-exports). */
  readonly ownExports: readonly string[];
}

async function tsFilesUnder(directory: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...(await tsFilesUnder(path)));
    else if (entry.isFile() && entry.name.endsWith(".ts")) found.push(path);
  }
  return found;
}

function layerOf(id: string): Layer | "root" {
  const [first] = id.split("/");
  return LAYERS.find((layer) => layer === first) ?? "root";
}

/**
 * Maps a specifier to a module id. Source imports use the emitted `.js`
 * extension, so `./x.js` resolves to the `./x.ts` on disk.
 */
function resolveLocal(fromId: string, specifier: string): string {
  const joined = posix.join(posix.dirname(fromId), specifier);
  return joined.replace(/\.js$/, ".ts");
}

async function readModule(absolutePath: string): Promise<ModuleRecord> {
  const id = relative(ROOT, absolutePath).split(sep).join(posix.sep);
  const text = await readFile(absolutePath, "utf8");
  const parsed = parseSync(absolutePath, text, { lang: "tsx" });
  expect(parsed.errors, `${id} must parse`).toEqual([]);

  const specifiers = [
    ...parsed.module.staticImports.map((entry) => entry.moduleRequest.value),
    ...parsed.module.staticExports.flatMap((statement) =>
      statement.entries.flatMap((entry) => (entry.moduleRequest ? [entry.moduleRequest.value] : [])),
    ),
    // Dynamic imports expose only a span, so read the literal back from source.
    ...parsed.module.dynamicImports.map((entry) =>
      text.slice(entry.moduleRequest.start, entry.moduleRequest.end).replace(/^["'`]|["'`]$/g, ""),
    ),
  ];

  const ownExports = parsed.module.staticExports.flatMap((statement) =>
    statement.entries.flatMap((entry) =>
      entry.moduleRequest === null && entry.exportName.name !== null ? [entry.exportName.name] : [],
    ),
  );

  return {
    id,
    layer: layerOf(id),
    localImports: specifiers.filter((s) => s.startsWith(".")).map((s) => resolveLocal(id, s)),
    packageImports: specifiers.filter((s) => !s.startsWith(".")),
    ownExports,
  };
}

const modules = await Promise.all((await tsFilesUnder(ROOT)).map(readModule));
const byId = new Map(modules.map((module) => [module.id, module]));
const inLayer = (layer: Layer) => modules.filter((module) => module.layer === layer);

/** Every edge as `{from, to}` pairs of module ids, for per-rule filtering. */
const edges = modules.flatMap((from) =>
  from.localImports.map((to) => ({ from, to: byId.get(to), toId: to })),
);

describe("agent-react layering", () => {
  it("sees every layer plus a top-level facade", () => {
    expect(new Set(modules.map((module) => module.layer))).toEqual(
      new Set([...LAYERS, "root"]),
    );
    // A rule that silently matches zero modules proves nothing.
    for (const layer of LAYERS) expect(inLayer(layer).length, layer).toBeGreaterThan(0);
  });

  it("resolves every relative import to a real module", () => {
    const unresolved = edges.filter((edge) => edge.to === undefined);
    expect(unresolved.map((edge) => `${edge.from.id} -> ${edge.toId}`)).toEqual([]);
  });

  it("keeps dependencies pointing down the layer stack", () => {
    const violations = edges.flatMap(({ from, to }) => {
      if (!to || from.layer === "root" || to.layer === from.layer) return [];
      const allowed = to.layer !== "root"
        && ALLOWED_DEPENDENCIES[from.layer as Layer].includes(to.layer);
      return allowed ? [] : [`${from.id} -> ${to.id}`];
    });
    expect(violations).toEqual([]);
  });

  it("crosses layers only through the target layer's barrel", () => {
    const violations = edges.flatMap(({ from, to }) => {
      if (!to || to.layer === from.layer || to.layer === "root") return [];
      // `contracts` is addressable file by file. Its barrel is `export *`, so
      // importing through it would pull every contract module into the sandbox
      // bundle — including `build.ts`, whose `BuildGenerationSuperseded` is real
      // emitted code the frame has no use for. Every other layer hides
      // implementation behind its barrel.
      if (to.layer === "contracts") return [];
      return to.id === `${to.layer}/index.ts` ? [] : [`${from.id} -> ${to.id}`];
    });
    expect([...new Set(violations)]).toEqual([]);
  });

  it("restricts each layer to its declared external packages", () => {
    const violations = modules.flatMap((module) => {
      if (module.layer === "root") return [];
      const allowed = ALLOWED_PACKAGES[module.layer];
      const builtinsOk = NODE_BUILTINS_ALLOWED.has(module.layer);
      return module.packageImports
        .filter((specifier) => {
          if (specifier.startsWith("node:")) return !builtinsOk;
          return !allowed.includes(specifier);
        })
        .map((specifier) => `${module.id} imports ${specifier}`);
    });
    expect(violations).toEqual([]);
  });

  it("has no import cycles", () => {
    const state = new Map<string, "visiting" | "done">();
    const cycles: string[] = [];
    const visit = (id: string, stack: readonly string[]): void => {
      if (state.get(id) === "done") return;
      if (state.get(id) === "visiting") {
        cycles.push([...stack.slice(stack.indexOf(id)), id].join(" -> "));
        return;
      }
      state.set(id, "visiting");
      for (const next of byId.get(id)?.localImports ?? []) visit(next, [...stack, id]);
      state.set(id, "done");
    };
    for (const module of modules) visit(module.id, []);
    expect(cycles).toEqual([]);
  });
});

describe("contracts layer", () => {
  it("depends on nothing outside itself", () => {
    const escaping = inLayer("contracts").flatMap((module) =>
      module.localImports
        .filter((id) => layerOf(id) !== "contracts")
        .map((id) => `${module.id} -> ${id}`),
    );
    expect(escaping).toEqual([]);
  });

  it("imports no package and no Node built-in, so the sandbox can load it", () => {
    // The runtime layer re-exports these contracts into the frame. A single
    // `node:crypto` here would break that load, which is why hashing is injected
    // as `DigestFn` instead of imported.
    const offenders = inLayer("contracts").flatMap((module) =>
      module.packageImports.map((specifier) => `${module.id} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("runtime layer", () => {
  it("stays browser-loadable: only react, no Node built-ins", () => {
    const offenders = inLayer("runtime").flatMap((module) =>
      module.packageImports
        .filter((specifier) => !ALLOWED_PACKAGES.runtime.includes(specifier))
        .map((specifier) => `${module.id} imports ${specifier}`),
    );
    expect(offenders).toEqual([]);
  });

  it("never reaches the kernel, which would drag a native binding into the frame", () => {
    const offenders = inLayer("runtime").flatMap((module) =>
      module.localImports
        .filter((id) => layerOf(id) === "kernel" || layerOf(id) === "linker" || layerOf(id) === "host")
        .map((id) => `${module.id} -> ${id}`),
    );
    expect(offenders).toEqual([]);
  });
});

describe("toolchain ownership", () => {
  it.each([
    ["oxc-parser", "kernel"],
    ["oxc-transform", "kernel"],
    ["esbuild-wasm", "linker"],
  ] as const)("confines %s to the %s layer", (specifier, owner) => {
    const importers = modules
      .filter((module) => module.packageImports.includes(specifier))
      .map((module) => module.id);
    expect(importers.length, `${specifier} must be used somewhere`).toBeGreaterThan(0);
    expect(importers.filter((id) => layerOf(id) !== owner)).toEqual([]);
  });
});

describe("shared addressing algorithm", () => {
  it.each(["stableHash", "sourceNodeId", "instanceAddress"])(
    "defines %s exactly once, in the contract both sides import",
    (name) => {
      const definers = modules
        .filter((module) => module.ownExports.includes(name))
        .map((module) => module.id);
      expect(definers).toEqual(["contracts/addressing.ts"]);
    },
  );

  it("is imported by both the compile-time and render-time sides", () => {
    const importsAddressing = (id: string): boolean => {
      const module = byId.get(id);
      if (!module) return false;
      return module.localImports.some((target) =>
        target === "contracts/addressing.ts" || target === "contracts/index.ts",
      );
    };
    expect(importsAddressing("kernel/semantic-index.ts")).toBe(true);
    expect(importsAddressing("runtime/address-registry.ts")).toBe(true);
    expect(importsAddressing("runtime/jsx-dev-runtime.ts")).toBe(true);
  });
});
