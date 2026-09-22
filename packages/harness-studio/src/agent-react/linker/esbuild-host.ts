import { createRequire } from "node:module";
import path from "node:path";

/**
 * External Node cannot read Electron's virtual ASAR filesystem. esbuild-wasm
 * always spawns `node <package>/bin/esbuild` relative to the copy of
 * `lib/main.js` that was loaded, so the packaged engine has to be the
 * physical file under `app.asar.unpacked`.
 */
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

/** The script esbuild-wasm will execute once `lib/main.js` has been loaded. */
export function esbuildWorkerScript(packageEntry: string, paths: Pick<typeof path, "dirname" | "join"> = path): string {
  return paths.join(paths.dirname(packageEntry), "..", "bin", "esbuild");
}

const require = createRequire(import.meta.url);
let loaded: typeof import("esbuild-wasm") | undefined;

/** Load esbuild-wasm from the path its child process can actually open. */
export function loadEsbuild(): typeof import("esbuild-wasm") {
  loaded ??= require(unpackedBuildInputPath(require.resolve("esbuild-wasm"))) as typeof import("esbuild-wasm");
  return loaded;
}
