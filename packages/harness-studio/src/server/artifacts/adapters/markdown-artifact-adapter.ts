import { parseMarkdown, inlineText, type PendingImage, type ParsedMarkdown } from "../../../contracts/markdown-parser.js";
export { parseMarkdown } from "../../../contracts/markdown-parser.js";
/**
 * The Studio-native Markdown plugin.
 *
 * The adapter produces a block tree, never HTML. Artifact bytes are untrusted
 * output from a run, and a renderer handed elements instead of markup has no
 * injection surface to get wrong. Everything Studio declines to interpret —
 * raw HTML, an unsupported link scheme, an image it will not fetch — survives
 * as its own node plus a diagnostic, so a reader can see what was skipped
 * rather than wondering why part of the document vanished.
 */
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, stat } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactDiagnostic,
  type ArtifactSemanticIndexEntry,
  type ArtifactSnapshotResource,
  type ArtifactStructureNode,
  type MarkdownArtifactPayload,
  type MarkdownBlock,
  type MarkdownInline,
  type MarkdownListItem,
  type MarkdownTableAlignment,
} from "../../../contracts/artifact.js";
import { artifactRevisionBase } from "../registry/artifact-catalog.js";
import type {
  ArtifactAdaptContext,
  ArtifactAdapterImplementation,
  ArtifactResourceBytes,
} from "../../../contracts/artifact.js";

const MARKDOWN_ADAPTER_ID = "studio.markdown-commonmark";
const MARKDOWN_ADAPTER_VERSION = "1";
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_IMAGE_COUNT = 64;
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;

/** Schemes a rendered link may actually target. Everything else stays text. */
const IMAGE_MEDIA_TYPES = new Map<string, string>([
  [".avif", "image/avif"],
  [".gif", "image/gif"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

interface CachedMarkdownSnapshot {
  snapshot: ArtifactDataSnapshot;
  resources: Map<string, ArtifactResourceBytes>;
}

export const MARKDOWN_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: MARKDOWN_ADAPTER_ID,
  version: MARKDOWN_ADAPTER_VERSION,
  schemaId: "markdown/v1",
  adapt: async (context) => (await loadMarkdownSnapshot(context)).snapshot,
  readResource: async (context, resourceId) => {
    if (!/^[A-Za-z0-9_-]+$/u.test(resourceId)) return undefined;
    return (await loadMarkdownSnapshot(context)).resources.get(resourceId);
  },
};

const cache = new Map<string, CachedMarkdownSnapshot>();

export function resetMarkdownArtifactCache(): void {
  cache.clear();
}

async function loadMarkdownSnapshot(context: ArtifactAdaptContext): Promise<CachedMarkdownSnapshot> {
  const { entry, descriptor } = context;
  if (descriptor.adapter.id !== MARKDOWN_ADAPTER_ID || descriptor.adapter.version !== MARKDOWN_ADAPTER_VERSION) {
    throw new Error("Markdown adapter received a descriptor bound to a different adapter.");
  }
  const key = `${descriptor.id} ${descriptor.revision.id}`;
  const cached = cache.get(key);
  if (cached !== undefined) return cached;

  if ((await stat(entry.path)).size > MAX_INPUT_BYTES) throw new Error("Markdown exceeds the adapter input limit.");
  const source = await readFile(entry.path, "utf8");
  const parsed = parseMarkdown(source);
  const resolved = await resolveMarkdownImages(parsed, entry.path, descriptor);

  const headings = collectHeadings(parsed.blocks);
  const snapshot: ArtifactDataSnapshot = {
    kind: ARTIFACT_DATA_SNAPSHOT_KIND,
    artifactId: descriptor.id,
    revisionId: descriptor.revision.id,
    snapshotId: descriptor.adapter.snapshotId,
    adapter: { id: descriptor.adapter.id, version: descriptor.adapter.version },
    schemaId: descriptor.adapter.schemaId,
    summary: { label: descriptor.label, family: descriptor.family, format: descriptor.format },
    structure: headingStructure(headings),
    semanticIndex: headings.map((heading): ArtifactSemanticIndexEntry => ({
      address: heading.address,
      label: heading.label,
      kind: `heading-${heading.level}`,
    })),
    resources: resolved.resourceRows,
    diagnostics: [...parsed.diagnostics, ...resolved.diagnostics],
    payload: { kind: "markdown/v1", blocks: parsed.blocks } satisfies MarkdownArtifactPayload,
  };
  if (Buffer.byteLength(JSON.stringify(snapshot), "utf8") > MAX_SNAPSHOT_BYTES) {
    throw new Error("Markdown snapshot exceeds the response limit.");
  }
  const materialized = { snapshot, resources: resolved.resources };
  cache.set(key, materialized);
  while (cache.size > MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  return materialized;
}

interface HeadingEntry {
  id: string;
  label: string;
  address: string;
  level: number;
}

function collectHeadings(blocks: readonly MarkdownBlock[]): HeadingEntry[] {
  // Only top-level headings define the outline. A heading nested inside a quote
  // or a list item is part of that block's content, not a document section.
  return blocks.flatMap((block) => block.kind === "heading"
    ? [{ id: block.id, label: inlineText(block.children), address: block.address, level: block.level }]
    : []);
}

/** Nest each heading under the nearest preceding heading of a lower level. */
function headingStructure(headings: readonly HeadingEntry[]): ArtifactStructureNode[] {
  const roots: ArtifactStructureNode[] = [];
  const open: Array<{ level: number; node: ArtifactStructureNode }> = [];
  for (const heading of headings) {
    const node: ArtifactStructureNode = {
      id: heading.id,
      label: heading.label === "" ? "Untitled section" : heading.label,
      address: heading.address,
      kind: `heading-${heading.level}`,
    };
    while (open.length > 0 && open.at(-1)!.level >= heading.level) open.pop();
    const parent = open.at(-1)?.node;
    if (parent === undefined) roots.push(node);
    else (parent.children ??= []).push(node);
    open.push({ level: heading.level, node });
  }
  return roots;
}

interface ResolvedImages {
  resources: Map<string, ArtifactResourceBytes>;
  resourceRows: ArtifactSnapshotResource[];
  diagnostics: ArtifactDiagnostic[];
}

/**
 * Bind each image to bytes Studio is willing to serve.
 *
 * Only files beside the document qualify. A remote image is not fetched: doing
 * so would make Studio issue a request chosen by untrusted artifact bytes, which
 * reports the operator's address to whoever wrote the document. An unresolved
 * image keeps its alt text and earns a diagnostic.
 */
async function resolveMarkdownImages(
  parsed: ParsedMarkdown,
  documentPath: string,
  descriptor: ArtifactDescriptor,
): Promise<ResolvedImages> {
  const resources = new Map<string, ArtifactResourceBytes>();
  const resourceRows: ArtifactSnapshotResource[] = [];
  const diagnostics: ArtifactDiagnostic[] = [];
  const reported = new Set<string>();
  const resourceBase = `${artifactRevisionBase(descriptor.id, descriptor.revision.digest)}/resources`;
  const root = await realpath(dirname(documentPath));
  const byPath = new Map<string, string>();
  let totalBytes = 0;

  const decline = (code: string, message: string): void => {
    if (reported.has(code)) return;
    reported.add(code);
    diagnostics.push({ level: "warning", code, message });
  };

  for (const image of parsed.images) {
    const target = image.source.trim();
    if (target === "" || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(target) || target.startsWith("//")) {
      decline("MARKDOWN_IMAGE_REMOTE", "Remote images are not fetched; Studio shows their alt text instead of requesting a URL chosen by artifact bytes.");
      continue;
    }
    const cachedId = byPath.get(target);
    if (cachedId !== undefined) {
      image.node.resourceId = cachedId;
      continue;
    }
    if (resources.size >= MAX_IMAGE_COUNT) {
      decline("MARKDOWN_IMAGE_LIMIT", `Only the first ${MAX_IMAGE_COUNT} images in a document are served.`);
      continue;
    }
    const resolvedPath = resolve(root, decodeImagePath(target));
    if (!isWithin(root, resolvedPath)) {
      decline("MARKDOWN_IMAGE_OUTSIDE", "An image path outside the artifact's own directory is not served.");
      continue;
    }
    const mediaType = IMAGE_MEDIA_TYPES.get(extname(resolvedPath).toLowerCase());
    if (mediaType === undefined) {
      decline("MARKDOWN_IMAGE_TYPE", "An image whose extension is not a supported image type is not served.");
      continue;
    }
    let bytes: Uint8Array;
    try {
      const stats = await lstat(resolvedPath);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink > 1) {
        decline("MARKDOWN_IMAGE_LINKED", "An image must resolve to one regular, non-linked file beside the document.");
        continue;
      }
      if (stats.size > MAX_IMAGE_FILE_BYTES || totalBytes + stats.size > MAX_IMAGE_TOTAL_BYTES) {
        decline("MARKDOWN_IMAGE_SIZE", "An image past the adapter's size budget is not served.");
        continue;
      }
      if (!isWithin(root, await realpath(resolvedPath))) {
        decline("MARKDOWN_IMAGE_OUTSIDE", "An image path outside the artifact's own directory is not served.");
        continue;
      }
      bytes = await readFile(resolvedPath);
    } catch {
      decline("MARKDOWN_IMAGE_MISSING", "An image referenced by the document could not be read.");
      continue;
    }
    totalBytes += bytes.byteLength;
    // Address media by its bytes: the resource URL is served immutable, so an
    // id derived from the referenced path would keep a long-lived cache entry
    // pointing at the picture that path used to hold.
    const resourceId = `media-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
    if (!resources.has(resourceId)) {
      const label = relative(root, resolvedPath).split(sep).join("/");
      resources.set(resourceId, { bytes, mediaType, label });
      resourceRows.push({ id: resourceId, label, mediaType, uri: `${resourceBase}/${resourceId}`, size: bytes.byteLength });
    }
    byPath.set(target, resourceId);
    image.node.resourceId = resourceId;
  }
  return { resources, resourceRows, diagnostics };
}

function decodeImagePath(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isWithin(root: string, path: string): boolean {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(resolvedRoot + sep);
}
