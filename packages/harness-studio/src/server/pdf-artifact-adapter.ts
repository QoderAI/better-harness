import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  PDF_ARTIFACT_PREVIEW_LIMITS,
  type ArtifactDataSnapshot,
  type ArtifactDiagnostic,
  type ArtifactSnapshotResource,
  type PdfArtifactPayload,
  type PdfPageSnapshot,
} from "../artifact-model.js";
import { artifactRevisionBase } from "./artifact-catalog.js";
import type {
  ArtifactAdaptContext,
  ArtifactAdapterImplementation,
  ArtifactResourceBytes,
} from "./artifact-adapter-contract.js";
import { artifactSnapshotCacheKey, readLruCache, writeLruCache } from "./bounded-opc-package.js";

const PDF_ADAPTER_ID = "studio.pdf-pdfjs";
const PDF_ADAPTER_VERSION = "1";
const PDF_SCHEMA_ID = "pdf/v1";
const PDF_RESOURCE_ID = "document";

interface CachedPdfSnapshot {
  snapshot: ArtifactDataSnapshot;
  resource: ArtifactResourceBytes;
}

const cache = new Map<string, CachedPdfSnapshot>();

/** A bounded, exact-revision PDF.js projection for Studio's native PDF surface. */
export const PDF_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: PDF_ADAPTER_ID,
  version: PDF_ADAPTER_VERSION,
  schemaId: PDF_SCHEMA_ID,
  adapt: async (context) => (await loadPdfSnapshot(context)).snapshot,
  readResource: async (context, resourceId) => (
    resourceId === PDF_RESOURCE_ID ? (await loadPdfSnapshot(context)).resource : undefined
  ),
};

export function resetPdfArtifactCache(): void {
  cache.clear();
}

async function loadPdfSnapshot({ entry, descriptor }: ArtifactAdaptContext): Promise<CachedPdfSnapshot> {
  if (
    descriptor.adapter.id !== PDF_ADAPTER_ID
    || descriptor.adapter.version !== PDF_ADAPTER_VERSION
    || descriptor.adapter.schemaId !== PDF_SCHEMA_ID
  ) {
    throw new Error("PDF snapshot requested with an unsupported adapter.");
  }
  const key = artifactSnapshotCacheKey(descriptor);
  const cached = readLruCache(cache, key);
  if (cached !== undefined) return cached;
  if ((await stat(entry.path)).size > PDF_ARTIFACT_PREVIEW_LIMITS.inputBytes) {
    throw new Error("PDF exceeds the adapter input limit.");
  }
  const bytes = new Uint8Array(await readFile(entry.path));
  if (bytes.byteLength > PDF_ARTIFACT_PREVIEW_LIMITS.inputBytes) {
    throw new Error("PDF exceeds the adapter input limit.");
  }
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== descriptor.revision.digest) {
    throw new Error("PDF bytes no longer match the requested artifact revision.");
  }

  const loadingTask = getDocument({
    data: bytes.slice(),
    disableAutoFetch: true,
    disableFontFace: true,
    disableRange: true,
    disableStream: true,
    enableXfa: false,
    useSystemFonts: false,
    useWorkerFetch: false,
  });
  try {
    const document = await loadingTask.promise;
    if (document.numPages < 1 || document.numPages > PDF_ARTIFACT_PREVIEW_LIMITS.pages) {
      throw new Error(`PDF page count must be between 1 and ${PDF_ARTIFACT_PREVIEW_LIMITS.pages}.`);
    }
    const pages: PdfPageSnapshot[] = [];
    for (let index = 1; index <= document.numPages; index += 1) {
      const page = await document.getPage(index);
      const width = Math.abs(page.view[2] - page.view[0]);
      const height = Math.abs(page.view[3] - page.view[1]);
      if (width > PDF_ARTIFACT_PREVIEW_LIMITS.pageDimensionPoints
        || height > PDF_ARTIFACT_PREVIEW_LIMITS.pageDimensionPoints
        || width * height > PDF_ARTIFACT_PREVIEW_LIMITS.pageAreaPoints) {
        throw new Error(`PDF page ${index} exceeds the page geometry limit.`);
      }
      const rotation = normalizeRotation(page.rotate);
      pages.push({ index, width, height, rotation });
      page.cleanup();
    }
    const diagnostics: ArtifactDiagnostic[] = [];
    const [javaScriptActions, attachments] = await Promise.all([
      document.getJSActions().catch(() => null),
      document.getAttachments().catch(() => null),
    ]);
    if (javaScriptActions !== null && Object.keys(javaScriptActions).length > 0) diagnostics.push({
      level: "warning",
      code: "PDF_ACTIVE_CONTENT_IGNORED",
      message: "PDF JavaScript actions are present but are not executed by Studio.",
    });
    if (attachments !== null && attachments.size > 0) diagnostics.push({
      level: "warning",
      code: "PDF_ATTACHMENTS_IGNORED",
      message: "Embedded PDF attachments are present but are not opened by Studio.",
    });
    diagnostics.push({
      level: "info",
      code: "PDF_READ_ONLY_RENDERER",
      message: "Studio renders bounded PDF pages without executing actions, forms, attachments, or external resources.",
    });

    const resourceUri = `${artifactRevisionBase(descriptor.id, descriptor.revision.digest)}/resources/${PDF_RESOURCE_ID}`;
    const resources: ArtifactSnapshotResource[] = [{
      id: PDF_RESOURCE_ID,
      label: descriptor.label,
      mediaType: "application/pdf",
      uri: resourceUri,
      size: bytes.byteLength,
    }];
    const payload: PdfArtifactPayload = {
      kind: "pdf/v1",
      resourceId: PDF_RESOURCE_ID,
      pageCount: pages.length,
      pages,
    };
    const result: CachedPdfSnapshot = {
      snapshot: {
        kind: ARTIFACT_DATA_SNAPSHOT_KIND,
        artifactId: descriptor.id,
        revisionId: descriptor.revision.id,
        snapshotId: descriptor.adapter.snapshotId,
        adapter: { id: descriptor.adapter.id, version: descriptor.adapter.version },
        schemaId: descriptor.adapter.schemaId,
        summary: { label: descriptor.label, family: descriptor.family, format: descriptor.format },
        structure: pages.map((page) => ({
          id: `page-${page.index}`,
          label: `Page ${page.index}`,
          address: `pdf:page/${page.index}`,
          kind: "pdf-page",
        })),
        semanticIndex: pages.map((page) => ({
          address: `pdf:page/${page.index}`,
          label: `Page ${page.index}`,
          kind: "pdf-page",
        })),
        resources,
        diagnostics,
        payload,
      },
      resource: { bytes, mediaType: "application/pdf", label: descriptor.label },
    };
    writeLruCache(cache, key, result);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/iu.test(message)) throw new Error("Password-protected PDFs are not supported.");
    throw error;
  } finally {
    await loadingTask.destroy();
  }
}

function normalizeRotation(rotation: number): 0 | 90 | 180 | 270 {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0;
}
