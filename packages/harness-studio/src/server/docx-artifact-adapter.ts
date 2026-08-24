import { createHash } from "node:crypto";
import { extname, posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactDiagnostic,
  type ArtifactSemanticIndexEntry,
  type ArtifactSnapshotResource,
  type ArtifactStructureNode,
  type DocxArtifactPayload,
  type DocxBlock,
  type DocxImageInline,
  type DocxParagraph,
  type DocxTable,
  type DocxTextRun,
} from "../artifact-model.js";
import { artifactRevisionBase } from "./artifact-catalog.js";
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

const DOCX_ADAPTER_ID = "studio.docx-ooxml";
const DOCX_ADAPTER_VERSION = "1";
const DOCX_SCHEMA_ID = "docx/v1";
const MAX_XML_BYTES = 8 * 1024 * 1024;

interface CachedDocxSnapshot {
  snapshot: ArtifactDataSnapshot;
  resources: Map<string, ArtifactResourceBytes>;
}

interface XmlElement {
  name: string;
  attributes: Record<string, string>;
  children: Array<XmlElement | string>;
}

interface PackageRelationship {
  id: string;
  type: string;
  target?: string;
  external: boolean;
}

interface StyleDefinition {
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
}

interface ParseState {
  archive: Record<string, Uint8Array>;
  relationships: Map<string, PackageRelationship>;
  styles: Map<string, StyleDefinition>;
  diagnostics: ArtifactDiagnostic[];
  resources: Map<string, ArtifactResourceBytes>;
  resourceRows: ArtifactSnapshotResource[];
  resourceBase: string;
  structure: ArtifactStructureNode[];
  semanticIndex: ArtifactSemanticIndexEntry[];
  paragraphNumber: number;
  tableNumber: number;
}

/** A bounded, read-only OOXML adapter for Studio's native DOCX renderer. */
export const DOCX_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: DOCX_ADAPTER_ID,
  version: DOCX_ADAPTER_VERSION,
  schemaId: DOCX_SCHEMA_ID,
  adapt: async (context) => (await loadDocxSnapshot(context)).snapshot,
  readResource: async (context, resourceId) => {
    if (!/^[A-Za-z0-9_-]+$/u.test(resourceId)) return undefined;
    return (await loadDocxSnapshot(context)).resources.get(resourceId);
  },
};

const cache = new Map<string, CachedDocxSnapshot>();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  preserveOrder: true,
});

export function resetDocxArtifactCache(): void {
  cache.clear();
}

async function loadDocxSnapshot({ entry, descriptor }: ArtifactAdaptContext): Promise<CachedDocxSnapshot> {
  if (
    descriptor.adapter.id !== DOCX_ADAPTER_ID
    || descriptor.adapter.version !== DOCX_ADAPTER_VERSION
    || descriptor.adapter.schemaId !== DOCX_SCHEMA_ID
  ) {
    throw new Error("DOCX snapshot requested with an unsupported adapter.");
  }
  const key = artifactSnapshotCacheKey(descriptor);
  const cached = readLruCache(cache, key);
  if (cached !== undefined) return cached;

  const archive = await loadBoundedOpcArchive({
    path: entry.path,
    expectedDigest: descriptor.revision.digest,
    format: "DOCX",
    include: (path) => path.startsWith("word/") || path === "_rels/.rels" || path === "[Content_Types].xml",
  });
  const result = materializeDocxSnapshot(archive, descriptor);
  assertBoundedArtifactSnapshot(result.snapshot, "DOCX");
  writeLruCache(cache, key, result);
  return result;
}

function materializeDocxSnapshot(
  archive: Record<string, Uint8Array>,
  descriptor: ArtifactDescriptor,
): CachedDocxSnapshot {
  const packageRelationships = relationshipMap(parseXml(archive, "_rels/.rels"), "");
  const documentRelationship = [...packageRelationships.values()].find((relationship) => relationship.type.endsWith("/officeDocument"));
  if (documentRelationship === undefined || documentRelationship.external || documentRelationship.target === undefined) {
    throw new Error("DOCX package office document relationship is missing or external.");
  }
  const documentPath = documentRelationship.target;
  assertMainDocumentContentType(parseXml(archive, "[Content_Types].xml"), documentPath);

  const document = parseXml(archive, documentPath);
  if (document.name !== "w:document") throw new Error("DOCX document root is missing.");
  const body = child(document, "w:body");
  if (body === undefined) throw new Error("DOCX document body is missing.");

  const relationshipPath = `${posix.dirname(documentPath)}/_rels/${posix.basename(documentPath)}.rels`;
  const relationships = archive[relationshipPath] === undefined
    ? new Map<string, PackageRelationship>()
    : relationshipMap(parseXml(archive, relationshipPath), documentPath);
  const styles = parseStyles(archive, relationships, documentPath);
  const diagnostics: ArtifactDiagnostic[] = [];
  const resources = new Map<string, ArtifactResourceBytes>();
  const resourceRows: ArtifactSnapshotResource[] = [];
  const structure: ArtifactStructureNode[] = [];
  const semanticIndex: ArtifactSemanticIndexEntry[] = [];
  const state: ParseState = {
    archive,
    relationships,
    styles,
    diagnostics,
    resources,
    resourceRows,
    resourceBase: `${artifactRevisionBase(descriptor.id, descriptor.revision.digest)}/resources`,
    structure,
    semanticIndex,
    paragraphNumber: 0,
    tableNumber: 0,
  };

  const blocks: DocxBlock[] = [];
  for (const block of elementChildren(body)) {
    if (block.name === "w:p") {
      const paragraph = parseParagraph(block, state);
      blocks.push(paragraph);
      addBlockIndex(paragraph, structure, semanticIndex);
    } else if (block.name === "w:tbl") {
      const table = parseTable(block, state);
      blocks.push(table);
      addBlockIndex(table, structure, semanticIndex);
    }
  }

  const headerRelationships = internalRelationshipsByType(relationships, "/header");
  const footerRelationships = internalRelationshipsByType(relationships, "/footer");
  const headersPresent = presentRelatedPart(headerRelationships, archive, diagnostics, "header");
  const footersPresent = presentRelatedPart(footerRelationships, archive, diagnostics, "footer");
  if (headersPresent || footersPresent) {
    diagnostics.push({
      level: "info",
      code: "DOCX_HEADER_FOOTER_PRESENT",
      message: "The document contains headers or footers; Studio reports their presence but does not include them in the body flow.",
    });
  }
  diagnostics.push({
    level: "info",
    code: "DOCX_BASELINE_RENDERER",
    message: "Studio provides a read-only OOXML body snapshot; editing, write-back, and Word pagination or layout parity are not supported.",
  });

  const payload: DocxArtifactPayload = { kind: "docx/v1", blocks, headersPresent, footersPresent };
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

function parseStyles(
  archive: Record<string, Uint8Array>,
  relationships: Map<string, PackageRelationship>,
  documentPath: string,
): Map<string, StyleDefinition> {
  const styleRelationship = [...relationships.values()].find((relationship) => relationship.type.endsWith("/styles") && !relationship.external);
  const fallbackPath = posix.join(posix.dirname(documentPath), "styles.xml");
  const stylesPath = styleRelationship?.target ?? (archive[fallbackPath] === undefined ? undefined : fallbackPath);
  if (stylesPath === undefined) return new Map();
  const root = parseXml(archive, stylesPath);
  if (root.name !== "w:styles") throw new Error("DOCX styles root is missing.");
  const result = new Map<string, StyleDefinition>();
  for (const style of children(root, "w:style")) {
    const id = attribute(style, "w:styleId");
    if (id === undefined) continue;
    const name = attribute(child(style, "w:name"), "w:val");
    const headingLevel = headingLevelFor(id) ?? headingLevelFor(name);
    result.set(id, headingLevel === undefined ? {} : { headingLevel });
  }
  return result;
}

function parseParagraph(paragraph: XmlElement, state: ParseState): DocxParagraph {
  state.paragraphNumber += 1;
  const number = state.paragraphNumber;
  const id = `paragraph-${number}`;
  const address = `docx:paragraph/${number}`;
  const properties = child(paragraph, "w:pPr");
  const styleId = attribute(child(properties, "w:pStyle"), "w:val");
  const headingLevel = (styleId === undefined ? undefined : state.styles.get(styleId)?.headingLevel) ?? headingLevelFor(styleId);
  const alignment = paragraphAlignment(attribute(child(properties, "w:jc"), "w:val"));
  const numberingProperties = child(properties, "w:numPr");
  const numId = attribute(child(numberingProperties, "w:numId"), "w:val");
  const level = nonNegativeInteger(attribute(child(numberingProperties, "w:ilvl"), "w:val"));
  const inlines: Array<DocxTextRun | DocxImageInline> = [];
  for (const content of elementChildren(paragraph)) {
    if (content.name === "w:r") parseRun(content, state, address, inlines);
    else if (content.name === "w:hyperlink" || content.name === "w:fldSimple" || content.name === "w:sdt") {
      for (const run of descendants(content, "w:r")) parseRun(run, state, address, inlines);
    }
  }
  const label = paragraphLabel(inlines, number);
  return {
    kind: "paragraph",
    id,
    label,
    address,
    ...(styleId === undefined ? {} : { styleId }),
    ...(headingLevel === undefined ? {} : { headingLevel }),
    ...(alignment === undefined ? {} : { alignment }),
    ...(numId === undefined || level === undefined ? {} : { numbering: { numId, level } }),
    inlines,
  };
}

function parseRun(
  run: XmlElement,
  state: ParseState,
  paragraphAddress: string,
  inlines: Array<DocxTextRun | DocxImageInline>,
): void {
  const properties = child(run, "w:rPr");
  let text = "";
  const flushText = (): void => {
    if (text === "") return;
    inlines.push(textRun(text, properties));
    text = "";
  };
  for (const content of elementChildren(run)) {
    if (content.name === "w:t") text += textContent(content);
    else if (content.name === "w:tab") text += "\t";
    else if (content.name === "w:br" || content.name === "w:cr") text += "\n";
    else if (content.name === "w:drawing" || content.name === "w:pict") {
      flushText();
      const image = parseImage(content, state, paragraphAddress);
      if (image !== undefined) inlines.push(image);
    }
  }
  flushText();
}

function textRun(text: string, properties: XmlElement | undefined): DocxTextRun {
  const fonts = child(properties, "w:rFonts");
  const fontFamily = attribute(fonts, "w:ascii")
    ?? attribute(fonts, "w:hAnsi")
    ?? attribute(fonts, "w:eastAsia")
    ?? attribute(fonts, "w:cs");
  const halfPoints = numberValue(attribute(child(properties, "w:sz"), "w:val"));
  const rawColor = attribute(child(properties, "w:color"), "w:val");
  const color = rawColor !== undefined && /^[0-9A-Fa-f]{6}$/u.test(rawColor) ? `#${rawColor.toUpperCase()}` : undefined;
  return {
    kind: "text",
    text,
    ...(fontFamily === undefined ? {} : { fontFamily }),
    ...(halfPoints === undefined || halfPoints < 0 ? {} : { fontSizePoints: halfPoints / 2 }),
    ...(color === undefined ? {} : { color }),
    ...(enabledProperty(child(properties, "w:b")) ? { bold: true } : {}),
    ...(enabledProperty(child(properties, "w:i")) ? { italic: true } : {}),
    ...(underlineProperty(child(properties, "w:u")) ? { underline: true } : {}),
    ...(enabledProperty(child(properties, "w:strike")) ? { strike: true } : {}),
  };
}

function parseImage(drawing: XmlElement, state: ParseState, paragraphAddress: string): DocxImageInline | undefined {
  const blip = descendants(drawing, "a:blip")[0];
  const relationshipId = attribute(blip, "r:embed");
  const relationship = relationshipId === undefined ? undefined : state.relationships.get(relationshipId);
  const mediaPath = relationship?.external === false && relationship.type.endsWith("/image") ? relationship.target : undefined;
  if (mediaPath === undefined || state.archive[mediaPath] === undefined) {
    state.diagnostics.push({
      level: "warning",
      code: "DOCX_IMAGE_MISSING",
      message: "An embedded image relationship could not be resolved.",
      address: paragraphAddress,
    });
    return undefined;
  }
  const bytes = state.archive[mediaPath]!;
  const resourceId = `media-${createHash("sha256").update(bytes).digest("hex").slice(0, 24)}`;
  if (!state.resources.has(resourceId)) {
    const mediaType = mediaTypeFor(mediaPath);
    state.resources.set(resourceId, { bytes, mediaType, label: posix.basename(mediaPath) });
    state.resourceRows.push({
      id: resourceId,
      label: posix.basename(mediaPath),
      mediaType,
      uri: `${state.resourceBase}/${resourceId}`,
      size: bytes.byteLength,
    });
  }
  const extent = descendants(drawing, "wp:extent")[0];
  const docProperties = descendants(drawing, "wp:docPr")[0];
  const widthEmu = nonNegativeNumber(attribute(extent, "cx"));
  const heightEmu = nonNegativeNumber(attribute(extent, "cy"));
  const alt = attribute(docProperties, "descr") ?? attribute(docProperties, "title") ?? attribute(docProperties, "name");
  return {
    kind: "image",
    resourceId,
    ...(alt === undefined ? {} : { alt }),
    ...(widthEmu === undefined ? {} : { widthEmu }),
    ...(heightEmu === undefined ? {} : { heightEmu }),
  };
}

function parseTable(table: XmlElement, state: ParseState): DocxTable {
  state.tableNumber += 1;
  const number = state.tableNumber;
  const id = `table-${number}`;
  const label = `Table ${number}`;
  const address = `docx:table/${number}`;
  const rows = children(table, "w:tr").map((row) => ({
    cells: children(row, "w:tc").map((cell) => ({
      paragraphs: children(cell, "w:p").map((paragraph) => parseParagraph(paragraph, state)),
    })),
  }));
  return { kind: "table", id, label, address, rows };
}

function addBlockIndex(
  block: DocxBlock,
  structure: ArtifactStructureNode[],
  semanticIndex: ArtifactSemanticIndexEntry[],
): void {
  const children = block.kind === "table"
    ? block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs.map((paragraph) => ({
      id: paragraph.id,
      label: paragraph.label,
      address: paragraph.address,
      kind: "paragraph",
    }))))
    : undefined;
  structure.push({
    id: block.id,
    label: block.label,
    address: block.address,
    kind: block.kind,
    ...(children === undefined || children.length === 0 ? {} : { children }),
  });
  semanticIndex.push({ address: block.address, label: block.label, kind: block.kind });
  if (block.kind === "table") {
    for (const paragraph of block.rows.flatMap((row) => row.cells.flatMap((cell) => cell.paragraphs))) {
      semanticIndex.push({ address: paragraph.address, label: paragraph.label, kind: "paragraph" });
    }
  }
}

function internalRelationshipsByType(
  relationships: Map<string, PackageRelationship>,
  typeSuffix: string,
): PackageRelationship[] {
  return [...relationships.values()].filter((relationship) => !relationship.external && relationship.type.endsWith(typeSuffix));
}

function presentRelatedPart(
  relationships: PackageRelationship[],
  archive: Record<string, Uint8Array>,
  diagnostics: ArtifactDiagnostic[],
  kind: "header" | "footer",
): boolean {
  let present = false;
  for (const relationship of relationships) {
    if (relationship.target !== undefined && archive[relationship.target] !== undefined) present = true;
    else {
      diagnostics.push({
        level: "warning",
        code: kind === "header" ? "DOCX_HEADER_MISSING" : "DOCX_FOOTER_MISSING",
        message: `A document ${kind} relationship could not be resolved.`,
      });
    }
  }
  return present;
}

function relationshipMap(root: XmlElement, ownerPath: string): Map<string, PackageRelationship> {
  if (root.name !== "Relationships") throw new Error("OOXML relationships root is missing.");
  const result = new Map<string, PackageRelationship>();
  for (const element of children(root, "Relationship")) {
    const id = attribute(element, "Id");
    const type = attribute(element, "Type");
    const rawTarget = attribute(element, "Target");
    if (id === undefined || type === undefined || rawTarget === undefined) throw new Error("OOXML relationship is malformed.");
    if (result.has(id)) throw new Error("OOXML relationship id is duplicated.");
    const external = attribute(element, "TargetMode") === "External";
    result.set(id, {
      id,
      type,
      external,
      ...(external ? {} : { target: resolvePackageTarget(ownerPath, rawTarget) }),
    });
  }
  return result;
}

function resolvePackageTarget(ownerPath: string, target: string): string {
  return resolveOpcPackageTarget(ownerPath, target, "DOCX");
}

function assertMainDocumentContentType(root: XmlElement, documentPath: string): void {
  if (root.name !== "Types") throw new Error("DOCX content types root is missing.");
  const expectedPartName = `/${documentPath}`;
  const override = children(root, "Override").find((entry) => attribute(entry, "PartName") === expectedPartName);
  const contentType = attribute(override, "ContentType");
  if (contentType !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") {
    throw new Error("DOCX main document content type is missing or unsupported.");
  }
}

function parseXml(archive: Record<string, Uint8Array>, path: string): XmlElement {
  const source = readBoundedOpcXmlSource(archive, path, "DOCX", MAX_XML_BYTES);
  const parsed: unknown = xmlParser.parse(source);
  if (!Array.isArray(parsed)) throw new Error("DOCX XML did not parse to an ordered tree.");
  const roots = parsed.flatMap(convertOrderedNode).filter((value): value is XmlElement => typeof value !== "string");
  const root = roots.find((element) => !element.name.startsWith("?"));
  if (root === undefined) throw new Error("DOCX XML root is missing.");
  return root;
}

function convertOrderedNode(value: unknown): Array<XmlElement | string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const source = value as Record<string, unknown>;
  const attributes = stringRecord(source[":@"]);
  const result: Array<XmlElement | string> = [];
  for (const [name, rawChildren] of Object.entries(source)) {
    if (name === ":@") continue;
    if (name === "#text") {
      if (typeof rawChildren === "string" || typeof rawChildren === "number") result.push(String(rawChildren));
      continue;
    }
    const values = Array.isArray(rawChildren) ? rawChildren : [];
    result.push({ name, attributes, children: values.flatMap(convertOrderedNode) });
  }
  return result;
}

function paragraphLabel(inlines: Array<DocxTextRun | DocxImageInline>, number: number): string {
  const value = inlines
    .filter((inline): inline is DocxTextRun => inline.kind === "text")
    .map((inline) => inline.text)
    .join("")
    .replace(/\s+/gu, " ")
    .trim();
  return value === "" ? `Paragraph ${number}` : value.slice(0, 80);
}

function headingLevelFor(value: string | undefined): 1 | 2 | 3 | 4 | 5 | 6 | undefined {
  if (value === undefined) return undefined;
  const match = /^(?:heading\s*|heading)([1-6])$/iu.exec(value.trim());
  return match === null ? undefined : Number(match[1]) as 1 | 2 | 3 | 4 | 5 | 6;
}

function paragraphAlignment(value: string | undefined): "left" | "center" | "right" | "justify" | undefined {
  if (value === "left" || value === "start") return "left";
  if (value === "center") return "center";
  if (value === "right" || value === "end") return "right";
  if (value === "both" || value === "distribute") return "justify";
  return undefined;
}

function enabledProperty(element: XmlElement | undefined): boolean {
  if (element === undefined) return false;
  const value = attribute(element, "w:val");
  return value === undefined || !["0", "false", "off", "none"].includes(value.toLowerCase());
}

function underlineProperty(element: XmlElement | undefined): boolean {
  return enabledProperty(element);
}

function mediaTypeFor(path: string): string {
  return ({
    ".bmp": "image/bmp",
    ".gif": "image/gif",
    ".jpeg": "image/jpeg",
    ".jpg": "image/jpeg",
    ".png": "image/png",
    ".svg": "image/svg+xml",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
    ".webp": "image/webp",
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream";
}

function descendants(element: XmlElement, name: string): XmlElement[] {
  const result: XmlElement[] = [];
  for (const candidate of elementChildren(element)) {
    if (candidate.name === name) result.push(candidate);
    result.push(...descendants(candidate, name));
  }
  return result;
}

function child(element: XmlElement | undefined, name: string): XmlElement | undefined {
  return elementChildren(element).find((candidate) => candidate.name === name);
}

function children(element: XmlElement | undefined, name: string): XmlElement[] {
  return elementChildren(element).filter((candidate) => candidate.name === name);
}

function elementChildren(element: XmlElement | undefined): XmlElement[] {
  return element?.children.filter((value): value is XmlElement => typeof value !== "string") ?? [];
}

function textContent(element: XmlElement): string {
  return element.children.map((value) => typeof value === "string" ? value : textContent(value)).join("");
}

function attribute(element: XmlElement | undefined, name: string): string | undefined {
  return element?.attributes[name];
}

function stringRecord(value: unknown): Record<string, string> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string | number] => typeof entry[1] === "string" || typeof entry[1] === "number")
    .map(([key, item]) => [key, String(item)]));
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^\d+$/u.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function nonNegativeNumber(value: string | undefined): number | undefined {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function numberValue(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
