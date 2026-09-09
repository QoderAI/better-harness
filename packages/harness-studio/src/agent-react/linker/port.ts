import { linkArtifactBundle, type LinkInput, type LinkResult } from "./esbuild-linker.js";

export interface ArtifactLinker {
  readonly linkerVersion: string;
  readonly policyFingerprint: string;
  link(input: LinkInput): Promise<LinkResult>;
}

export interface ManagedArtifactLinker extends ArtifactLinker {
  close(): Promise<void>;
}

/** A host owns one isolated linker for a build and closes it on every exit. */
export type ArtifactLinkerFactory = (options: { readonly timeoutMs: number }) => ManagedArtifactLinker;

/** Standalone Studio retains its portable linker; native desktop injects Go. */
export const WASM_ARTIFACT_LINKER: ArtifactLinker = Object.freeze({
  linkerVersion: "esbuild-wasm-0.28.2+link-v1",
  policyFingerprint: "agent-react-vfs-es2022-v1",
  link: linkArtifactBundle,
});
