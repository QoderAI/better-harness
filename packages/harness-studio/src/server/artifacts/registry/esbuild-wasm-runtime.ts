import type { BuildOptions, BuildResult } from "esbuild-wasm";
import { esbuildWorkerScript, loadEsbuild, unpackedBuildInputPath } from "../../../agent-react/linker/esbuild-host.js";

export { esbuildWorkerScript, unpackedBuildInputPath };

/** The remaining production packager keeps the same WASM API and JS plugins. */
export function buildPreviewWithWasm(options: BuildOptions & { write: false }): Promise<BuildResult<BuildOptions & { write: false }>> {
  return loadEsbuild().build(options);
}
