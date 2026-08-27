import type { ArtifactViewDeclaration, ReactSemanticIndex } from "./compile.js";
import type { Diagnostic } from "./diagnostics.js";
import type { Digest } from "./revision.js";

export interface SourceMapChainEntry {
  readonly module: string;
  readonly map: string;
}

/**
 * A frozen, replayable compile+link result.
 *
 * The three version fields are part of the identity, not metadata: a snapshot can
 * only be replayed if the Revision *and* the rules that translated it are pinned.
 */
export interface BuildSnapshot {
  readonly buildDigest: Digest;
  readonly artifactDigest: Digest;
  readonly artifactId: string;
  readonly buildGeneration: number;
  readonly compilerVersion: string;
  readonly profileVersion: string;
  readonly runtimeVersion: string;
  /** Effective compiler, linker, limit, and Bootstrap policy identity. */
  readonly buildPolicyDigest: Digest;
  readonly status: "ready" | "failed";
  /** UTF-8 ESM bundle; empty when `status === "failed"`. */
  readonly bundle: string;
  readonly sourceMaps: readonly SourceMapChainEntry[];
  readonly semanticIndex: readonly ReactSemanticIndex[];
  readonly viewDeclaration?: ArtifactViewDeclaration;
  readonly diagnostics: readonly Diagnostic[];
}

/**
 * Raised instead of returning a stale bundle.
 *
 * A streaming agent commits Revisions faster than a build finishes. Resolving a
 * superseded generation would let an older bundle win the race and get staged over
 * the newer one.
 */
export class BuildGenerationSuperseded extends Error {
  constructor(readonly generation: number) {
    super(`Build generation ${generation} was superseded before it completed.`);
    this.name = "BuildGenerationSuperseded";
  }
}
