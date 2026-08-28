import { createHash } from "node:crypto";
import type { ArtifactDescriptor, Digest, ModuleSource } from "../contracts/index.js";

/**
 * Content addressing for the POC.
 *
 * `node:crypto` keeps this synchronous, which the digest call sites rely on. A
 * browser Compiler Worker would swap in `crypto.subtle.digest`; that is why every
 * consumer takes a `DigestFn` rather than importing this module directly.
 */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function digestParts(parts: readonly unknown[]): Digest {
  return `sha256:${sha256Hex(JSON.stringify(parts))}`;
}

/**
 * A Revision digest must not depend on the order in which the agent happened to
 * stream its modules, otherwise the same source text produces a different
 * identity per run and nothing downstream can be cached or replayed.
 */
export function digestArtifactRevision(
  descriptor: ArtifactDescriptor,
  modules: readonly ModuleSource[],
): Digest {
  const ordered = [...modules]
    .map((module) => [module.path, sha256Hex(module.text)] as const)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return digestParts([descriptor.id, descriptor.entry, ordered]);
}
