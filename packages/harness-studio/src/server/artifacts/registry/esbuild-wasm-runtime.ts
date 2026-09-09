import { createRequire } from "node:module";
import path from "node:path";
import type { BuildOptions, BuildResult } from "esbuild-wasm";

/** External Node cannot read Electron's virtual ASAR filesystem. Resolve the
 * engine itself from its unpacked closure so its relative child script works. */
export function unpackedBuildInputPath(filename: string, paths: Pick<typeof path, "dirname" | "extname" | "join" | "relative"> = path): string {
  let directory = paths.dirname(filename);
  for (;;) {
    if (paths.extname(directory) === ".asar") {
      return paths.join(`${directory}.unpacked`, paths.relative(directory, filename));
    }
    const parent = paths.dirname(directory);
    if (parent === directory) return filename;
    directory = parent;
  }
}

const require = createRequire(import.meta.url);
let engine: typeof import("esbuild-wasm") | undefined;

/** The remaining production packager keeps the same WASM API and JS plugins. */
export function buildPreviewWithWasm(options: BuildOptions & { write: false }): Promise<BuildResult<BuildOptions & { write: false }>> {
  engine ??= require(unpackedBuildInputPath(require.resolve("esbuild-wasm"))) as typeof import("esbuild-wasm");
  return engine.build(options);
}
