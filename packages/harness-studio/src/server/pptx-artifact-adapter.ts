import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactDiagnostic,
  type ArtifactDigest,
  type ArtifactSemanticIndexEntry,
  type ArtifactSnapshotResource,
  type ArtifactStructureNode,
  type PptxArtifactPayload,
  type PptxElement,
  type PptxParagraph,
  type PptxSlideSnapshot,
  type PptxTextRun,
} from "../artifact-model.js";
import { artifactRevisionBase } from "./artifact-catalog.js";
import type { ArtifactEntry } from "./artifact-catalog.js";
import {
  artifactSnapshotCacheKey,
  assertBoundedArtifactSnapshot,
  loadBoundedOpcArchive,
  readBoundedOpcXmlSource,
  readLruCache,
  resolveOpcPackageTarget,
  writeLruCache,
} from "./bounded-opc-package.js";
import type {
  ArtifactAdaptContext,
  ArtifactAdapterImplementation,
  ArtifactResourceBytes,
} from "./artifact-adapter-contract.js";

const PPTX_ADAPTER_ID = "studio.pptx-ooxml";
const PPTX_ADAPTER_VERSION = "1";
const PPTX_SCHEMA_ID = "pptx/v1";
const MAX_XML_BYTES = 8 * 1024 * 1024;

interface CachedPptxSnapshot {
  snapshot: ArtifactDataSnapshot;
  resources: Map<string, ArtifactResourceBytes>;
}

/** The Studio-native OOXML plugin, selected by the Artifact plugin registry. */
export const PPTX_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: PPTX_ADAPTER_ID,
  version: PPTX_ADAPTER_VERSION,
  schemaId: PPTX_SCHEMA_ID,
  adapt: async (context) => (await loadPptxSnapshot(context)).snapshot,
  readResource: async (context, resourceId) => {
    if (!/^[A-Za-z0-9_-]+$/u.test(resourceId)) return undefined;
    return (await loadPptxSnapshot(context)).resources.get(resourceId);
  },
};

const cache = new Map<string, CachedPptxSnapshot>();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
});

export function resetPptxArtifactCache(): void {
  cache.clear();
}

async function loadPptxSnapshot({ entry, descriptor }: ArtifactAdaptContext): Promise<CachedPptxSnapshot> {
  if (
    descriptor.adapter.id !== PPTX_ADAPTER_ID
    || descriptor.adapter.version !== PPTX_ADAPTER_VERSION
    || descriptor.adapter.schemaId !== PPTX_SCHEMA_ID
  ) {
    throw new Error("PPTX snapshot requested with an unsupported adapter.");
  }
  const key = artifactSnapshotCacheKey(descriptor);
  const cached = readLruCache(cache, key);
  if (cached !== undefined) return cached;
  const archive = await loadBoundedOpcArchive({
    path: entry.path,
    expectedDigest: descriptor.revision.digest,
    format: "PPTX",
    include: (path) => path.startsWith("ppt/") || path === "[Content_Types].xml",
  });
  const result = materializePptxSnapshot(archive, descriptor);
  assertBoundedArtifactSnapshot(result.snapshot, "PPTX");
  writeLruCache(cache, key, result);
  return result;
}

function materializePptxSnapshot(
  archive: Record<string, Uint8Array>,
  descriptor: ArtifactDescriptor,
): CachedPptxSnapshot {
  const presentation = parseXml(archive, "ppt/presentation.xml");
  const presentationRoot = record(presentation["p:presentation"], "PPTX presentation root is missing.");
  const slideSize = record(presentationRoot["p:sldSz"], "PPTX slide size is missing.");
  const width = positiveNumber(slideSize.cx, "PPTX slide width is invalid.");
  const height = positiveNumber(slideSize.cy, "PPTX slide height is invalid.");
  const presentationRelationships = relationshipMap(parseXml(archive, "ppt/_rels/presentation.xml.rels"), "ppt/presentation.xml");
  const slideIds = array(record(presentationRoot["p:sldIdLst"], "PPTX slide list is missing.")["p:sldId"]);
  if (slideIds.length === 0) throw new Error("PPTX has no slides.");

  const diagnostics: ArtifactDiagnostic[] = [];
  const resources = new Map<string, ArtifactResourceBytes>();
  const resourceRows: ArtifactSnapshotResource[] = [];
  const resourceBase = `${artifactRevisionBase(descriptor.id, descriptor.revision.digest)}/resources`;
  const semanticIndex: ArtifactSemanticIndexEntry[] = [];
  const structure: ArtifactStructureNode[] = [];
  const slides: PptxSlideSnapshot[] = [];

  slideIds.forEach((value, index) => {
    const slideId = record(value, "PPTX slide id is malformed.");
    const relationshipId = stringValue(slideId["r:id"]);
    const slidePath = relationshipId === undefined ? undefined : presentationRelationships.get(relationshipId);
    if (slidePath === undefined) throw new Error(`PPTX slide ${index + 1} relationship is missing.`);
    const parsed = parseSlide(archive, slidePath, index, resourceBase, diagnostics, resources, resourceRows, semanticIndex);
    slides.push(parsed.slide);
    structure.push({
      id: parsed.slide.id,
      label: parsed.slide.label,
      address: parsed.slide.address,
      kind: "slide",
      children: parsed.slide.elements.map((element) => ({
        id: element.id,
        label: element.name,
        address: element.address,
        kind: element.kind,
      })),
    });
    semanticIndex.push({ address: parsed.slide.address, label: parsed.slide.label, kind: "slide" });
  });

  diagnostics.push({
    level: "info",
    code: "PPTX_BASELINE_RENDERER",
    message: "Studio renders positioned OOXML shapes, text, images, and notes presence; themes, charts, SmartArt, animation, and grouped transforms may differ from PowerPoint.",
  });
  const payload: PptxArtifactPayload = { kind: "pptx/v1", width, height, slides };
  return {
    snapshot: {
      kind: ARTIFACT_DATA_SNAPSHOT_KIND,
      artifactId: descriptor.id,
      revisionId: descriptor.revision.id,
      snapshotId: descriptor.adapter.snapshotId,
      adapter: { id: descriptor.adapter.id, version: descriptor.adapter.version },
      schemaId: descriptor.adapter.schemaId,
      summary: { label: descriptor.label, family: descriptor.family, format: descriptor.format },
      structure,
      semanticIndex,
      resources: resourceRows,
      diagnostics,
      payload,
    },
    resources,
  };
}

function parseSlide(
  archive: Record<string, Uint8Array>,
  slidePath: string,
  index: number,
  resourceBase: string,
  diagnostics: ArtifactDiagnostic[],
  resources: Map<string, ArtifactResourceBytes>,
  resourceRows: ArtifactSnapshotResource[],
  semanticIndex: ArtifactSemanticIndexEntry[],
): { slide: PptxSlideSnapshot } {
  const root = record(parseXml(archive, slidePath)["p:sld"], "PPTX slide root is missing.");
  const common = record(root["p:cSld"], "PPTX common slide data is missing.");
  const shapeTree = record(common["p:spTree"], "PPTX shape tree is missing.");
  const relationshipPath = `${posix.dirname(slidePath)}/_rels/${posix.basename(slidePath)}.rels`;
  const relationships = archive[relationshipPath] === undefined
    ? new Map<string, string>()
    : relationshipMap(parseXml(archive, relationshipPath), slidePath);
  const slideNumber = index + 1;
  const slideAddress = `pptx:slide/${slideNumber}`;
  const elements: PptxElement[] = [];

  for (const value of array(shapeTree["p:sp"])) {
    const shape = parseShape(record(value, "PPTX shape is malformed."), slideNumber);
    if (shape !== undefined) {
      elements.push(shape);
      semanticIndex.push({ address: shape.address, label: shape.name, kind: "shape" });
    }
  }
  for (const value of array(shapeTree["p:pic"])) {
    const picture = record(value, "PPTX picture is malformed.");
    const parsed = parsePicture(picture, slideNumber, relationships, archive, resourceBase, resources, resourceRows, diagnostics);
    if (parsed !== undefined) {
      elements.push(parsed);
      semanticIndex.push({ address: parsed.address, label: parsed.name, kind: "image" });
    }
  }

  const notesRelationship = [...relationships.entries()].find(([, target]) => target.includes("/notesSlides/"));
  let notesText: string | undefined;
  if (notesRelationship !== undefined && archive[notesRelationship[1]] !== undefined) {
    const notes = parseXml(archive, notesRelationship[1]);
    notesText = scrubLocalPaths(collectText(notes).filter((text) => !/^\d+$/u.test(text.trim())).join("\n").trim()) || undefined;
  }
  const background = colorFromFill(recordOrUndefined(common["p:bg"])?.["p:bgPr"]);
  return {
    slide: {
      id: `slide-${slideNumber}`,
      label: `Slide ${slideNumber}`,
      address: slideAddress,
      ...(background === undefined ? {} : { background }),
      elements,
      notesPresent: notesRelationship !== undefined,
      ...(notesText === undefined ? {} : { notesText }),
    },
  };
}

function parseShape(shape: Record<string, unknown>, slideNumber: number): PptxElement | undefined {
  const props = recordOrUndefined(recordOrUndefined(shape["p:nvSpPr"])?.["p:cNvPr"]);
  const transform = recordOrUndefined(recordOrUndefined(shape["p:spPr"])?.["a:xfrm"]);
  const bounds = transformBounds(transform);
  if (bounds === undefined) return undefined;
  const id = stringValue(props?.id) ?? createHash("sha256").update(JSON.stringify(bounds)).digest("hex").slice(0, 12);
  const name = stringValue(props?.name) || `Shape ${id}`;
  const shapeAddress = `pptx:slide/${slideNumber}/shape/${portableAddressSegment(name, id)}`;
  const shapeProperties = recordOrUndefined(shape["p:spPr"]);
  return {
    kind: "shape",
    id: `shape-${id}`,
    name,
    address: shapeAddress,
    ...bounds,
    ...(colorFromFill(shapeProperties) === undefined ? {} : { fill: colorFromFill(shapeProperties) }),
    ...(colorFromLine(shapeProperties) === undefined ? {} : { line: colorFromLine(shapeProperties) }),
    paragraphs: parseParagraphs(recordOrUndefined(shape["p:txBody"])),
  };
}

function parsePicture(
  picture: Record<string, unknown>,
  slideNumber: number,
  relationships: Map<string, string>,
  archive: Record<string, Uint8Array>,
  resourceBase: string,
  resources: Map<string, ArtifactResourceBytes>,
  resourceRows: ArtifactSnapshotResource[],
  diagnostics: ArtifactDiagnostic[],
): PptxElement | undefined {
  const props = recordOrUndefined(recordOrUndefined(picture["p:nvPicPr"])?.["p:cNvPr"]);
  const transform = recordOrUndefined(recordOrUndefined(picture["p:spPr"])?.["a:xfrm"]);
  const bounds = transformBounds(transform);
  if (bounds === undefined) return undefined;
  const relationshipId = stringValue(recordOrUndefined(recordOrUndefined(picture["p:blipFill"])?.["a:blip"])?.["r:embed"]);
  const mediaPath = relationshipId === undefined ? undefined : relationships.get(relationshipId);
  if (mediaPath === undefined || archive[mediaPath] === undefined) {
    diagnostics.push({ level: "warning", code: "PPTX_IMAGE_MISSING", message: "A slide image relationship could not be resolved.", address: `pptx:slide/${slideNumber}` });
    return undefined;
  }
  const rawId = stringValue(props?.id) ?? createHash("sha256").update(mediaPath).digest("hex").slice(0, 12);
  const name = stringValue(props?.name) || posix.basename(mediaPath);
  const bytes = archive[mediaPath]!;
  // Address media by its bytes, not by its package path. The resource URL is
  // served immutable, so an id derived from `ppt/media/image1.png` would keep
  // pointing a year-long cache entry at the picture that path used to hold
  // after the deck replaced it.
  const resourceId = `media-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
  if (!resources.has(resourceId)) {
    const mediaType = mediaTypeFor(mediaPath);
    resources.set(resourceId, { bytes, mediaType, label: posix.basename(mediaPath) });
    resourceRows.push({
      id: resourceId,
      label: posix.basename(mediaPath),
      mediaType,
      uri: `${resourceBase}/${resourceId}`,
      size: bytes.byteLength,
    });
  }
  return {
    kind: "image",
    id: `image-${rawId}`,
    name,
    address: `pptx:slide/${slideNumber}/shape/${portableAddressSegment(name, rawId)}`,
    ...bounds,
    resourceId,
    ...(stringValue(props?.descr) === undefined ? {} : { alt: stringValue(props?.descr) }),
  };
}

function parseParagraphs(textBody: Record<string, unknown> | undefined): PptxParagraph[] {
  if (textBody === undefined) return [];
  return array(textBody["a:p"]).map((value) => {
    const paragraph = record(value, "PPTX paragraph is malformed.");
    const paragraphProperties = recordOrUndefined(paragraph["a:pPr"]);
    const defaultRun = recordOrUndefined(paragraphProperties?.["a:defRPr"]);
    const runs: PptxTextRun[] = [];
    for (const runValue of array(paragraph["a:r"])) {
      const run = record(runValue, "PPTX text run is malformed.");
      const text = stringValue(run["a:t"]);
      if (text === undefined) continue;
      const runProperties = recordOrUndefined(run["a:rPr"]);
      runs.push(textRun(text, runProperties, defaultRun));
    }
    const field = recordOrUndefined(paragraph["a:fld"]);
    const fieldText = stringValue(field?.["a:t"]);
    if (fieldText !== undefined) runs.push(textRun(fieldText, recordOrUndefined(field?.["a:rPr"]), defaultRun));
    if (paragraph["a:br"] !== undefined && runs.length > 0) runs.push({ text: "\n" });
    return { alignment: paragraphAlignment(stringValue(paragraphProperties?.algn)), runs };
  }).filter((paragraph) => paragraph.runs.length > 0);
}

function textRun(text: string, properties: Record<string, unknown> | undefined, defaults: Record<string, unknown> | undefined): PptxTextRun {
  const source = properties ?? defaults;
  const fontSize = numberValue(source?.sz);
  const fontFamily = stringValue(recordOrUndefined(source?.["a:latin"])?.typeface)
    ?? stringValue(recordOrUndefined(source?.["a:ea"])?.typeface);
  const color = colorFromFill(source);
  return {
    text,
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(fontSize === undefined ? {} : { fontSizePoints: fontSize / 100 }),
    ...(color === undefined ? {} : { color }),
    ...(stringValue(source?.b) === "1" || source?.b === true ? { bold: true } : {}),
    ...(stringValue(source?.i) === "1" || source?.i === true ? { italic: true } : {}),
  };
}

function relationshipMap(value: Record<string, unknown>, ownerPath: string): Map<string, string> {
  const root = record(value.Relationships, "OOXML relationships root is missing.");
  const result = new Map<string, string>();
  for (const entry of array(root.Relationship)) {
    const relationship = record(entry, "OOXML relationship is malformed.");
    const id = stringValue(relationship.Id);
    const target = stringValue(relationship.Target);
    if (id !== undefined && target !== undefined) result.set(id, resolvePackageTarget(ownerPath, target));
  }
  return result;
}

function resolvePackageTarget(ownerPath: string, target: string): string {
  return resolveOpcPackageTarget(ownerPath, target, "PPTX");
}

function parseXml(archive: Record<string, Uint8Array>, path: string): Record<string, unknown> {
  const source = readBoundedOpcXmlSource(archive, path, "PPTX", MAX_XML_BYTES);
  const parsed: unknown = xmlParser.parse(source);
  return record(parsed, "PPTX XML did not parse to an object.");
}

function transformBounds(transform: Record<string, unknown> | undefined): Pick<PptxElement, "x" | "y" | "width" | "height" | "rotation"> | undefined {
  if (transform === undefined) return undefined;
  const offset = recordOrUndefined(transform["a:off"]);
  const extent = recordOrUndefined(transform["a:ext"]);
  const x = numberValue(offset?.x);
  const y = numberValue(offset?.y);
  const width = numberValue(extent?.cx);
  const height = numberValue(extent?.cy);
  if (x === undefined || y === undefined || width === undefined || height === undefined || width < 0 || height < 0) return undefined;
  const rotation = numberValue(transform.rot);
  return { x, y, width, height, ...(rotation === undefined ? {} : { rotation: rotation / 60_000 }) };
}

function colorFromFill(value: unknown): string | undefined {
  const source = recordOrUndefined(value);
  const solid = recordOrUndefined(source?.["a:solidFill"]);
  const color = stringValue(recordOrUndefined(solid?.["a:srgbClr"])?.val);
  return color !== undefined && /^[0-9A-Fa-f]{6}$/u.test(color) ? `#${color.toUpperCase()}` : undefined;
}

function colorFromLine(value: Record<string, unknown> | undefined): string | undefined {
  return colorFromFill(recordOrUndefined(value?.["a:ln"]));
}

function paragraphAlignment(value: string | undefined): "left" | "center" | "right" {
  if (value === "ctr") return "center";
  if (value === "r") return "right";
  return "left";
}

function collectText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectText);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => key === "a:t" && typeof child === "string" ? [child] : collectText(child));
}

function mediaTypeFor(path: string): string {
  return ({
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".webp": "image/webp",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function portableAddressSegment(value: string, fallback: string): string {
  const segment = value.normalize("NFKC").replace(/[^\p{L}\p{N}._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return segment === "" ? fallback : segment;
}

function scrubLocalPaths(value: string): string {
  return value.replace(/(?:[A-Za-z]:\\|\/(?:Users|home|private|tmp|var)\/)[^\s)\]]+/gu, (path) => {
    const normalized = path.replaceAll("\\", "/");
    return `<local-path>/${normalized.slice(normalized.lastIndexOf("/") + 1)}`;
  });
}

function positiveNumber(value: unknown, message: string): number {
  const parsed = numberValue(value);
  if (parsed === undefined || parsed <= 0) throw new Error(message);
  return parsed;
}

function numberValue(value: unknown): number | undefined {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" || typeof value === "number" ? String(value) : undefined;
}

function array(value: unknown): unknown[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function recordOrUndefined(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}
