/** Public desktop adapter; importing it does not launch a compiler process. */
export { createGoEsbuildLinker, GO_ESBUILD_LINKER_VERSION, type GoEsbuildLinker, type GoEsbuildLinkerOptions } from "./agent-react/host/go-esbuild-linker.js";
export type { ArtifactLinkerFactory, ManagedArtifactLinker } from "./agent-react/linker/port.js";
