/**
 * The addressing algorithm shared by the compiler and the runtime.
 *
 * This is the one contract module with executable code, and that is the point:
 * the Oxc semantic index computes a JSX element's id at compile time while the
 * sandbox-side `jsxDEV` computes it again at render time, and the two must agree
 * exactly or a resolved DOM node points at unrelated source. Two copies of "the
 * same" hash in two layers is precisely how that drifts, so both layers import
 * this one.
 *
 * That constraint also fixes the implementation: this module runs inside the
 * sandbox, so it may not use `node:crypto`, the DOM, or any dependency — hence
 * the inlined 64-bit FNV-1a below.
 */

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function stableHash(input: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash ^ BigInt(input.charCodeAt(index) & 0xffff)) * FNV_PRIME & MASK_64;
  }
  return hash.toString(16).padStart(16, "0");
}

export interface SourceSpan {
  readonly modulePath: string;
  readonly line: number;
  readonly column: number;
  readonly elementType: string;
}

/**
 * Identity of a JSX element *in the source*, stable for one Artifact Revision.
 *
 * Line and column come from the automatic development transform's `__source`, so
 * any edit above an element changes its id. That is intentional: cross-Revision
 * continuity is the semantic index's job, and pretending a span survives an edit
 * would let a stale annotation point at unrelated code.
 */
export function sourceNodeId(span: SourceSpan): string {
  return stableHash(`${span.modulePath}\u0000${span.line}\u0000${span.column}\u0000${span.elementType}`);
}

/**
 * Identity of a rendered element. `parentInstance` is optional because JSX
 * elements are created inner-first, so the creation-time stamp cannot know its
 * parent; a caller that already holds a parent instance (a tree walk, a
 * selection event) passes it to disambiguate repeated keys.
 */
export function instanceAddress(parts: {
  readonly artifactDigest: string;
  readonly sourceNodeId: string;
  readonly key?: string | null;
  readonly parentInstance?: string | null;
}): string {
  return stableHash([
    parts.artifactDigest,
    parts.sourceNodeId,
    parts.key ?? "",
    parts.parentInstance ?? "",
  ].join("\u0000"));
}

/** Attribute an intrinsic DOM element carries. */
export const ARTIFACT_NODE_ATTRIBUTE = "data-artifact-node";
/** Reserved prop a catalog component must forward to its root DOM element. */
export const ARTIFACT_NODE_PROP = "artifactNode";
