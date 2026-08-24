import type { ArtifactDigest } from "./model.js";

/** Host-neutral artifact classification used by Provider matchers. */
export type ArtifactKind =
  | "code"
  | "diff"
  | "docx"
  | "image"
  | "json"
  | "markdown"
  | "mermaid"
  | "pdf"
  | "pptx"
  | "svg"
  | "text"
  | "xlsx"
  | "unknown";

/**
 * One source selected by the host catalog.
 *
 * The path is server-private and must never be serialized to a browser response.
 * Local Provider adapters may use it only for the exact entry selected by the
 * host and remain subject to the host's confinement and activation policy.
 */
export interface ArtifactEntry {
  id: string;
  threadId: string;
  kind: ArtifactKind;
  label: string;
  path: string;
  size: number;
  digest?: ArtifactDigest;
}
