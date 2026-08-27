import {
  ARTIFACT_NODE_ATTRIBUTE,
  instanceAddress,
  sourceNodeId,
  type SourceSpan,
} from "../contracts/addressing.js";

/**
 * Per-frame map from a rendered element's address back to its source span.
 *
 * The registry is frame-scoped rather than global: two frames render the same
 * Artifact Digest during a staging swap, and a shared map would let the outgoing
 * frame's spans answer lookups for the incoming one.
 */
export interface NodeAddressRegistry {
  /** Records a span and returns the token written to `data-artifact-node`. */
  register(span: SourceSpan, key?: string | null): string;
  resolveSourceSpan(address: string): SourceSpan | undefined;
  /** Looks the stamped element up in a DOM subtree; the caller supplies the root. */
  resolveDomNode<T>(root: { querySelector(selectors: string): T | null }, address: string): T | null;
  size(): number;
  clear(): void;
}

export function createNodeAddressRegistry(artifactDigest: string): NodeAddressRegistry {
  const spans = new Map<string, SourceSpan>();
  return {
    register(span, key) {
      const address = instanceAddress({ artifactDigest, sourceNodeId: sourceNodeId(span), key });
      spans.set(address, span);
      return address;
    },
    resolveSourceSpan(address) {
      return spans.get(address);
    },
    resolveDomNode(root, address) {
      // Only resolve addresses this frame actually rendered, so a stale address
      // from a previous build cannot match a coincidentally identical attribute.
      return spans.has(address)
        ? root.querySelector(`[${ARTIFACT_NODE_ATTRIBUTE}="${address}"]`)
        : null;
    },
    size() {
      return spans.size;
    },
    clear() {
      spans.clear();
    },
  };
}
