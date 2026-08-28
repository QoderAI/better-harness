/** Digest-addressed identity, always `sha256:<hex>`. */
export type Digest = `sha256:${string}`;

/**
 * Hashing is injected rather than imported.
 *
 * The Host hashes with `node:crypto`; a browser Compiler Worker would use
 * `crypto.subtle`. Neither belongs in a contract that the sandbox-side runtime
 * also has to load.
 */
export type DigestFn = (parts: readonly unknown[]) => Digest;

export interface ModuleSource {
  /** Revision-relative POSIX path, always starting with `/`. */
  readonly path: string;
  readonly text: string;
}

export interface ArtifactDescriptor {
  readonly id: string;
  /** Revision-relative path of the module carrying the default export. */
  readonly entry: string;
}

export interface ArtifactRevision {
  readonly digest: Digest;
  readonly modules: readonly ModuleSource[];
  readonly descriptor: ArtifactDescriptor;
}
