export const ARTIFACT_CATALOG_RESPONSE_KIND = "HarnessStudioArtifactCatalogV2" as const;
export const ARTIFACT_DATA_SNAPSHOT_KIND = "ArtifactDataSnapshotV1" as const;
export const ARTIFACT_BUILD_SNAPSHOT_KIND = "ArtifactBuildSnapshotV1" as const;
export const ARTIFACT_PROVIDER_STATUS_RESPONSE_KIND = "HarnessStudioArtifactProviderStatusV1" as const;

export type ArtifactDigest = `sha256:${string}`;
export type ArtifactFamily = "documents" | "images-diagrams" | "data" | "source-text" | "other";

/**
 * Backing decides which half of the Artifact View lifecycle an artifact takes:
 * `data` goes Adapter -> Snapshot -> Renderer, `code` goes Adapter -> Compile
 * Runtime -> Build Snapshot -> Preview Runtime. Keeping both in the public
 * contract lets the Artifact View host compose their distinct lifecycles.
 */
export type ArtifactBacking = "data" | "code";

/**
 * Renderer types and capabilities grow as providers are added. Consumers must
 * treat an unrecognized value as unsupported, never as an invalid response, so
 * an older Studio tab keeps working against a newer server. The `(string & {})`
 * arm preserves completion for the known values while admitting future ones.
 */
export type KnownArtifactRendererType = "native" | "qoder-canvas" | "sandboxed-web" | "unavailable";
export type ArtifactRendererType = KnownArtifactRendererType | (string & {});
export type KnownArtifactCapability =
  | "compare"
  | "execute"
  | "live-update"
  | "navigate"
  | "outline"
  | "search"
  | "select"
  | "thumbnail"
  | "validate"
  | "zoom";
export type ArtifactCapability = KnownArtifactCapability | (string & {});
export type ArtifactRendererStatus = "ready" | "unavailable";

export interface ArtifactContentReference {
  uri: string;
  mediaType: string;
  digest: ArtifactDigest;
}

export interface ArtifactRevisionReference {
  id: ArtifactDigest;
  digest: ArtifactDigest;
  content: ArtifactContentReference;
}

export interface ArtifactAdapterReference {
  id: string;
  version: string;
  schemaId: string;
  snapshotId: ArtifactDigest;
  snapshotUri: string;
}

export interface ArtifactRendererReference {
  id: string;
  label: string;
  provider: string;
  type: ArtifactRendererType;
  status: ArtifactRendererStatus;
  /**
   * Stable identity of the selected adapter/runtime/surface binding.
   *
   * V2 clients must tolerate this being absent for older servers. Current
   * servers emit it for every ready renderer so a host can retain a mounted
   * surface across content revisions without retaining it across a binding
   * change.
   */
  bindingId?: ArtifactDigest;
  /** Present when the renderer is hosted by the server rather than by Studio. */
  viewUri?: string;
  reason?: string;
}

export interface ArtifactBuildReference {
  /** Mutable resolver for the latest build of this exact entry revision. */
  snapshotUri: string;
}

export interface ArtifactDescriptor {
  id: string;
  /**
   * Identity of the logical artifact across revisions. It is derived from the
   * catalog path alone, so it survives edits to this artifact and additions or
   * removals of unrelated files in the same directory.
   */
  threadId: string;
  label: string;
  size: number;
  family: ArtifactFamily;
  /** Stable lowercase format code, for example `pptx`. Never a display label. */
  format: string;
  backing: ArtifactBacking;
  revision: ArtifactRevisionReference;
  adapter: ArtifactAdapterReference;
  build?: ArtifactBuildReference;
  renderer: ArtifactRendererReference;
  capabilities: ArtifactCapability[];
}

export type ArtifactOmissionReason = "not-a-file" | "symlink" | "hard-link" | "outside-root";

/**
 * A directory entry the catalog declined to publish. Omissions are reported
 * rather than dropped: a file that vanishes silently from a run's outputs is
 * indistinguishable from one the run never produced, and that is exactly the
 * question someone reads an artifact catalog to answer.
 */
export interface ArtifactOmission {
  label: string;
  reason: ArtifactOmissionReason;
}

export interface ArtifactCatalogResponse {
  kind: typeof ARTIFACT_CATALOG_RESPONSE_KIND;
  snapshot: {
    catalogId: string;
    revision: ArtifactDigest;
  };
  artifacts: ArtifactDescriptor[];
  omitted: ArtifactOmission[];
}

export interface ArtifactProviderContributionStatus {
  id: string;
  label: string;
  support: "reviewed" | "experimental-local";
  active: boolean;
  lane?: "external-override" | "external-fallback";
}

/** Browser-safe provider diagnostics. Filesystem and executable paths stay server-private. */
export interface ArtifactProviderStatus {
  id: string;
  label: string;
  version?: string;
  acquisition: "operator-provisioned" | "local-derived-experimental";
  status: "ready" | "unavailable";
  receiptVerified: boolean;
  fingerprint?: ArtifactDigest;
  contributions: ArtifactProviderContributionStatus[];
  reason?: string;
}

export interface ArtifactProviderStatusResponse {
  kind: typeof ARTIFACT_PROVIDER_STATUS_RESPONSE_KIND;
  providers: ArtifactProviderStatus[];
}

export type ArtifactDiagnosticLevel = "info" | "warning" | "error";

export interface ArtifactDiagnostic {
  level: ArtifactDiagnosticLevel;
  code: string;
  message: string;
  address?: string;
}

export interface ArtifactStructureNode {
  id: string;
  label: string;
  address: string;
  kind: string;
  children?: ArtifactStructureNode[];
}

export interface ArtifactSemanticIndexEntry {
  address: string;
  label: string;
  kind: string;
}

export interface ArtifactSnapshotResource {
  id: string;
  label: string;
  mediaType: string;
  uri: string;
  size: number;
}

export interface RawArtifactPayload {
  kind: "artifact/raw-v1";
  content: ArtifactContentReference;
}

export interface PptxTextRun {
  text: string;
  fontFamily?: string;
  fontSizePoints?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
}

export interface PptxParagraph {
  alignment: "left" | "center" | "right";
  runs: PptxTextRun[];
}

export interface PptxElementBase {
  id: string;
  name: string;
  address: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation?: number;
}

export interface PptxShapeElement extends PptxElementBase {
  kind: "shape";
  fill?: string;
  line?: string;
  paragraphs: PptxParagraph[];
}

export interface PptxImageElement extends PptxElementBase {
  kind: "image";
  resourceId: string;
  alt?: string;
}

export type PptxElement = PptxShapeElement | PptxImageElement;

export interface PptxSlideSnapshot {
  id: string;
  label: string;
  address: string;
  background?: string;
  elements: PptxElement[];
  notesPresent: boolean;
  notesText?: string;
}

export interface PptxArtifactPayload {
  kind: "pptx/v1";
  width: number;
  height: number;
  slides: PptxSlideSnapshot[];
}

export interface PdfPageSnapshot {
  index: number;
  width: number;
  height: number;
  rotation: 0 | 90 | 180 | 270;
}

/** Public safety bounds for Studio's browser-consumable PDF projection. */
export const PDF_ARTIFACT_PREVIEW_LIMITS = Object.freeze({
  inputBytes: 64 * 1024 * 1024,
  pages: 500,
  pageDimensionPoints: 10_000,
  pageAreaPoints: 25_000_000,
  canvasDimensionPixels: 8_192,
  canvasAreaPixels: 16_000_000,
});

/** Bounded read-only projection; page pixels are rendered from the exact resource bytes. */
export interface PdfArtifactPayload {
  kind: "pdf/v1";
  resourceId: string;
  pageCount: number;
  pages: PdfPageSnapshot[];
}

export interface DocxTextRun {
  kind: "text";
  text: string;
  fontFamily?: string;
  fontSizePoints?: number;
  color?: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
}

export interface DocxImageInline {
  kind: "image";
  resourceId: string;
  alt?: string;
  widthEmu?: number;
  heightEmu?: number;
}

export type DocxInline = DocxTextRun | DocxImageInline;

export interface DocxParagraph {
  kind: "paragraph";
  id: string;
  label: string;
  address: string;
  styleId?: string;
  headingLevel?: 1 | 2 | 3 | 4 | 5 | 6;
  alignment?: "left" | "center" | "right" | "justify";
  numbering?: { numId: string; level: number };
  inlines: DocxInline[];
}

export interface DocxTableCell {
  paragraphs: DocxParagraph[];
}

export interface DocxTableRow {
  cells: DocxTableCell[];
}

export interface DocxTable {
  kind: "table";
  id: string;
  label: string;
  address: string;
  rows: DocxTableRow[];
}

export type DocxBlock = DocxParagraph | DocxTable;

/**
 * Bounded semantic projection of one DOCX revision.
 *
 * This is intentionally not a pagination or mutation model. Word layout and
 * writeback remain outside the capabilities advertised by the native surface.
 */
export interface DocxArtifactPayload {
  kind: "docx/v1";
  blocks: DocxBlock[];
  headersPresent: boolean;
  footersPresent: boolean;
}

export interface XlsxCellStyle {
  fill?: string;
  color?: string;
  fontFamily?: string;
  fontSizePoints?: number;
  bold?: boolean;
  italic?: boolean;
  horizontalAlignment?: "left" | "center" | "right";
  verticalAlignment?: "top" | "center" | "bottom";
  wrapText?: boolean;
  numberFormat?: string;
}

export interface XlsxCellSnapshot {
  address: string;
  row: number;
  column: number;
  value: string | number | boolean | null;
  display: string;
  formula?: string;
  style?: XlsxCellStyle;
}

export interface XlsxMergedRange {
  ref: string;
  startRow: number;
  startColumn: number;
  endRow: number;
  endColumn: number;
}

export interface XlsxColumnSnapshot {
  index: number;
  width?: number;
}

export interface XlsxRowSnapshot {
  index: number;
  height?: number;
}

/** Public safety bounds for the browser-consumable XLSX projection. */
export const XLSX_ARTIFACT_PREVIEW_LIMITS = Object.freeze({
  sheets: 64,
  rowsPerSheet: 10_000,
  columnsPerSheet: 256,
  populatedCells: 50_000,
});

export interface XlsxWorksheetSnapshot {
  id: string;
  label: string;
  address: string;
  rowCount: number;
  columnCount: number;
  cells: XlsxCellSnapshot[];
  mergedRanges: XlsxMergedRange[];
  columns: XlsxColumnSnapshot[];
  rows: XlsxRowSnapshot[];
}

/** Bounded read-only projection of workbook cells and presentation metadata. */
export interface XlsxArtifactPayload {
  kind: "xlsx/v1";
  activeSheetIndex: number;
  dateSystem: "1900" | "1904";
  definedNamesPresent: boolean;
  sheets: XlsxWorksheetSnapshot[];
}

export type MarkdownInline =
  | { kind: "text"; text: string }
  | { kind: "code"; text: string }
  | { kind: "break" }
  | { kind: "emphasis" | "strong" | "strike"; children: MarkdownInline[] }
  | { kind: "link"; href: string; title?: string; children: MarkdownInline[] }
  | { kind: "image"; alt: string; title?: string; resourceId?: string };

export type MarkdownTableAlignment = "left" | "center" | "right";

export interface MarkdownListItem {
  /** Present only for task list items, so an unchecked box stays distinct from a plain item. */
  checked?: boolean;
  blocks: MarkdownBlock[];
}

export type MarkdownBlock =
  | { kind: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; id: string; address: string; children: MarkdownInline[] }
  | { kind: "paragraph"; children: MarkdownInline[] }
  | { kind: "code"; language?: string; text: string }
  | { kind: "quote"; blocks: MarkdownBlock[] }
  | { kind: "list"; ordered: boolean; tight: boolean; start?: number; items: MarkdownListItem[] }
  | { kind: "table"; alignments: MarkdownTableAlignment[]; head: MarkdownInline[][]; rows: MarkdownInline[][][] }
  | { kind: "thematicBreak" }
  /** Verbatim source Studio declined to interpret, carried as text so nothing disappears. */
  | { kind: "rawHtml"; text: string };

/**
 * A parsed Markdown document.
 *
 * The payload is a block tree rather than an HTML string precisely because the
 * bytes are untrusted: a renderer that receives elements instead of markup has
 * no injection surface to get wrong, and every construct Studio does not
 * support is visible here as its own node rather than as markup it silently
 * passed through.
 */
export interface MarkdownArtifactPayload {
  kind: "markdown/v1";
  blocks: MarkdownBlock[];
}

export interface QoderCanvasArtifactPayload {
  kind: "qoder-canvas/v1";
  data: Record<string, unknown>;
}

/** Provider-owned payload carried by the common, validated snapshot envelope. */
export interface ExternalArtifactPayload {
  /** Namespaced so Studio can still discriminate every built-in payload. */
  kind: `external:${string}`;
  [key: string]: unknown;
}

export type ArtifactSnapshotPayload =
  | RawArtifactPayload
  | DocxArtifactPayload
  | XlsxArtifactPayload
  | PptxArtifactPayload
  | PdfArtifactPayload
  | MarkdownArtifactPayload
  | QoderCanvasArtifactPayload
  | ExternalArtifactPayload;

export interface ArtifactDataSnapshot {
  kind: typeof ARTIFACT_DATA_SNAPSHOT_KIND;
  artifactId: string;
  revisionId: ArtifactDigest;
  snapshotId: ArtifactDigest;
  adapter: {
    id: string;
    version: string;
  };
  schemaId: string;
  summary: {
    label: string;
    family: ArtifactFamily;
    format: string;
  };
  structure: ArtifactStructureNode[];
  semanticIndex: ArtifactSemanticIndexEntry[];
  resources: ArtifactSnapshotResource[];
  diagnostics: ArtifactDiagnostic[];
  payload: ArtifactSnapshotPayload;
}

export interface ArtifactBuildDiagnostic {
  level: "warning" | "error";
  message: string;
  source?: string;
  line?: number;
  column?: number;
}

/** Immutable result of compiling one code-backed Artifact project. */
export interface ArtifactBuildSnapshot {
  kind: typeof ARTIFACT_BUILD_SNAPSHOT_KIND;
  artifactId: string;
  revisionId: ArtifactDigest;
  buildId: ArtifactDigest;
  sequence: number;
  status: "ready" | "failed";
  runtime: {
    id: "studio.sandboxed-react";
    version: string;
  };
  previewUri?: string;
  diagnostics: ArtifactBuildDiagnostic[];
}

const ARTIFACT_FAMILIES = new Set<ArtifactFamily>(["documents", "images-diagrams", "data", "source-text", "other"]);
const ARTIFACT_BACKINGS = new Set<ArtifactBacking>(["data", "code"]);
const RENDERER_STATUSES = new Set<ArtifactRendererStatus>(["ready", "unavailable"]);

/**
 * Every server-declared reference must stay a same-origin Studio API path.
 *
 * The check deliberately does not pin the exact route shape: pinning it would
 * make the declared reference decorative, because a client that can only follow
 * URIs it could have built itself is not really following anything. What must
 * hold is the security property — the catalog can never point a fetch, an
 * `<img>`, or an iframe at another origin.
 */
function isStudioArtifactPath(value: unknown): value is string {
  return typeof value === "string"
    && value.startsWith("/api/artifacts/")
    && !value.startsWith("//")
    && !value.includes("\\")
    && !value.includes("..");
}

export function isArtifactCatalogResponse(value: unknown): value is ArtifactCatalogResponse {
  if (!isRecord(value) || value.kind !== ARTIFACT_CATALOG_RESPONSE_KIND) return false;
  if (!isRecord(value.snapshot)
    || typeof value.snapshot.catalogId !== "string"
    || !isDigest(value.snapshot.revision)
    || !Array.isArray(value.artifacts)
    || !Array.isArray(value.omitted)) return false;
  if (!value.omitted.every((omission) => isRecord(omission)
    && typeof omission.label === "string"
    && typeof omission.reason === "string")) return false;
  return value.artifacts.every(isArtifactDescriptor);
}

export function isArtifactDataSnapshot(value: unknown): value is ArtifactDataSnapshot {
  if (!isRecord(value) || value.kind !== ARTIFACT_DATA_SNAPSHOT_KIND) return false;
  if (typeof value.artifactId !== "string" || !isDigest(value.revisionId) || !isDigest(value.snapshotId)) return false;
  if (!isRecord(value.adapter) || typeof value.adapter.id !== "string" || typeof value.adapter.version !== "string") return false;
  if (typeof value.schemaId !== "string"
    || !isRecord(value.summary)
    || typeof value.summary.label !== "string"
    || !ARTIFACT_FAMILIES.has(value.summary.family as ArtifactFamily)
    || typeof value.summary.format !== "string") return false;
  if (!Array.isArray(value.structure) || !value.structure.every(isArtifactStructureNode)) return false;
  if (!Array.isArray(value.semanticIndex) || !value.semanticIndex.every(isArtifactSemanticIndexEntry)) return false;
  if (!Array.isArray(value.resources) || !value.resources.every((resource) => isRecord(resource)
    && typeof resource.id === "string"
    && typeof resource.label === "string"
    && typeof resource.mediaType === "string"
    && isStudioArtifactPath(resource.uri)
    && isFiniteNumber(resource.size) && resource.size >= 0)) return false;
  if (!Array.isArray(value.diagnostics) || !value.diagnostics.every(isArtifactDiagnostic)) return false;
  // An unknown payload kind is a renderer-selection problem, not a malformed
  // response: the envelope is still usable for outline and diagnostics.
  if (!isRecord(value.payload) || typeof value.payload.kind !== "string") return false;
  return isKnownArtifactPayload(value.payload);
}

function isKnownArtifactPayload(value: Record<string, unknown>): boolean {
  if (value.kind === "artifact/raw-v1") {
    return isRecord(value.content)
      && typeof value.content.mediaType === "string"
      && isStudioArtifactPath(value.content.uri)
      && isDigest(value.content.digest);
  }
  if (value.kind === "qoder-canvas/v1") return isRecord(value.data);
  if (value.kind === "markdown/v1") return Array.isArray(value.blocks) && value.blocks.every(isMarkdownBlock);
  if (value.kind === "docx/v1") {
    return Array.isArray(value.blocks)
      && value.blocks.every(isDocxBlock)
      && typeof value.headersPresent === "boolean"
      && typeof value.footersPresent === "boolean";
  }
  if (value.kind === "pptx/v1") {
    return isPositiveFiniteNumber(value.width)
      && isPositiveFiniteNumber(value.height)
      && Array.isArray(value.slides)
      && value.slides.every(isPptxSlide);
  }
  if (value.kind === "pdf/v1") {
    return typeof value.resourceId === "string"
      && Number.isInteger(value.pageCount)
      && (value.pageCount as number) > 0
      && (value.pageCount as number) <= PDF_ARTIFACT_PREVIEW_LIMITS.pages
      && Array.isArray(value.pages)
      && value.pages.length === value.pageCount
      && value.pages.every((page, index) => isPdfPage(page, index + 1));
  }
  if (value.kind === "xlsx/v1") {
    return isXlsxPayload(value);
  }
  return true;
}

function isPdfPage(value: unknown, expectedIndex: number): boolean {
  return isRecord(value)
    && Number.isInteger(value.index)
    && value.index === expectedIndex
    && isPositiveFiniteNumber(value.width)
    && isPositiveFiniteNumber(value.height)
    && (value.width as number) <= PDF_ARTIFACT_PREVIEW_LIMITS.pageDimensionPoints
    && (value.height as number) <= PDF_ARTIFACT_PREVIEW_LIMITS.pageDimensionPoints
    && (value.width as number) * (value.height as number) <= PDF_ARTIFACT_PREVIEW_LIMITS.pageAreaPoints
    && (value.rotation === 0 || value.rotation === 90 || value.rotation === 180 || value.rotation === 270);
}

function isArtifactStructureNode(value: unknown): boolean {
  return isRecord(value)
    && hasStringFields(value, ["id", "label", "address", "kind"])
    && (value.children === undefined
      || (Array.isArray(value.children) && value.children.every(isArtifactStructureNode)));
}

function isArtifactSemanticIndexEntry(value: unknown): boolean {
  return isRecord(value) && hasStringFields(value, ["address", "label", "kind"]);
}

function isArtifactDiagnostic(value: unknown): boolean {
  return isRecord(value)
    && (value.level === "info" || value.level === "warning" || value.level === "error")
    && hasStringFields(value, ["code", "message"])
    && isOptionalString(value.address);
}

function isPptxSlide(value: unknown): boolean {
  return isRecord(value)
    && hasStringFields(value, ["id", "label", "address"])
    && isOptionalString(value.background)
    && typeof value.notesPresent === "boolean"
    && isOptionalString(value.notesText)
    && Array.isArray(value.elements)
    && value.elements.every(isPptxElement);
}

function isPptxElement(value: unknown): boolean {
  if (!isRecord(value)
    || !hasStringFields(value, ["id", "name", "address"])
    || ![value.x, value.y, value.width, value.height].every(isFiniteNumber)
    || !isOptionalFiniteNumber(value.rotation)) return false;
  if (value.kind === "image") return typeof value.resourceId === "string" && isOptionalString(value.alt);
  return value.kind === "shape"
    && isOptionalString(value.fill)
    && isOptionalString(value.line)
    && Array.isArray(value.paragraphs)
    && value.paragraphs.every(isPptxParagraph);
}

function isPptxParagraph(value: unknown): boolean {
  return isRecord(value)
    && (value.alignment === "left" || value.alignment === "center" || value.alignment === "right")
    && Array.isArray(value.runs)
    && value.runs.every((run) => isRecord(run)
      && typeof run.text === "string"
      && isOptionalString(run.fontFamily)
      && isOptionalFiniteNumber(run.fontSizePoints)
      && isOptionalString(run.color)
      && isOptionalBoolean(run.bold)
      && isOptionalBoolean(run.italic));
}

function isDocxBlock(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "paragraph") return isDocxParagraph(value);
  return value.kind === "table"
    && hasStringFields(value, ["id", "label", "address"])
    && Array.isArray(value.rows)
    && value.rows.every((row) => isRecord(row)
      && Array.isArray(row.cells)
      && row.cells.every((cell) => isRecord(cell)
        && Array.isArray(cell.paragraphs)
        && cell.paragraphs.every(isDocxParagraph)));
}

function isDocxParagraph(value: unknown): boolean {
  return isRecord(value)
    && value.kind === "paragraph"
    && hasStringFields(value, ["id", "label", "address"])
    && isOptionalString(value.styleId)
    && (value.headingLevel === undefined
      || (typeof value.headingLevel === "number" && [1, 2, 3, 4, 5, 6].includes(value.headingLevel)))
    && (value.alignment === undefined || ["left", "center", "right", "justify"].includes(String(value.alignment)))
    && (value.numbering === undefined || (isRecord(value.numbering)
      && typeof value.numbering.numId === "string"
      && isNonNegativeInteger(value.numbering.level)))
    && Array.isArray(value.inlines)
    && value.inlines.every(isDocxInline);
}

function isDocxInline(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.kind === "image") {
    return typeof value.resourceId === "string"
      && isOptionalString(value.alt)
      && isOptionalFiniteNumber(value.widthEmu)
      && isOptionalFiniteNumber(value.heightEmu);
  }
  return value.kind === "text"
    && typeof value.text === "string"
    && isOptionalString(value.fontFamily)
    && isOptionalFiniteNumber(value.fontSizePoints)
    && isOptionalString(value.color)
    && [value.bold, value.italic, value.underline, value.strike].every(isOptionalBoolean);
}

function isXlsxPayload(value: Record<string, unknown>): boolean {
  if (!isNonNegativeInteger(value.activeSheetIndex)
    || (value.dateSystem !== "1900" && value.dateSystem !== "1904")
    || typeof value.definedNamesPresent !== "boolean"
    || !Array.isArray(value.sheets)
    || value.sheets.length > XLSX_ARTIFACT_PREVIEW_LIMITS.sheets
    || (value.sheets.length > 0 && value.activeSheetIndex >= value.sheets.length)) return false;
  const sheetIds = new Set<string>();
  let populatedCells = 0;
  for (const sheet of value.sheets) {
    if (!isXlsxWorksheet(sheet) || sheetIds.has(sheet.id)) return false;
    sheetIds.add(sheet.id);
    populatedCells += sheet.cells.length;
    if (populatedCells > XLSX_ARTIFACT_PREVIEW_LIMITS.populatedCells) return false;
  }
  return true;
}

function isXlsxWorksheet(value: unknown): value is XlsxWorksheetSnapshot {
  if (!isRecord(value)
    || !hasStringFields(value, ["id", "label", "address"])
    || !isPositiveInteger(value.rowCount)
    || value.rowCount > XLSX_ARTIFACT_PREVIEW_LIMITS.rowsPerSheet
    || !isPositiveInteger(value.columnCount)
    || value.columnCount > XLSX_ARTIFACT_PREVIEW_LIMITS.columnsPerSheet
    || !Array.isArray(value.cells)
    || !Array.isArray(value.mergedRanges)
    || !Array.isArray(value.columns)
    || !Array.isArray(value.rows)) return false;
  const rowCount = value.rowCount;
  const columnCount = value.columnCount;
  const cellCoordinates = new Set<string>();
  for (const cell of value.cells) {
    if (!isXlsxCell(cell, rowCount, columnCount)) return false;
    const key = `${cell.row}:${cell.column}`;
    if (cellCoordinates.has(key)) return false;
    cellCoordinates.add(key);
  }
  const mergedCoordinates = new Set<string>();
  for (const merge of value.mergedRanges) {
    if (!isXlsxMergedRange(merge, rowCount, columnCount)) return false;
    for (let row = merge.startRow; row <= merge.endRow; row += 1) {
      for (let column = merge.startColumn; column <= merge.endColumn; column += 1) {
        const key = `${row}:${column}`;
        if (mergedCoordinates.has(key)) return false;
        mergedCoordinates.add(key);
      }
    }
  }
  return value.columns.every((column) => isRecord(column)
      && isPositiveInteger(column.index)
      && column.index <= columnCount
      && isOptionalFiniteNumber(column.width))
    && value.rows.every((row) => isRecord(row)
      && isPositiveInteger(row.index)
      && row.index <= rowCount
      && isOptionalFiniteNumber(row.height));
}

function isXlsxCell(value: unknown, rowCount: number, columnCount: number): value is XlsxCellSnapshot {
  return isRecord(value)
    && typeof value.address === "string"
    && isPositiveInteger(value.row)
    && value.row <= rowCount
    && isPositiveInteger(value.column)
    && value.column <= columnCount
    && (value.value === null || ["string", "number", "boolean"].includes(typeof value.value))
    && (typeof value.value !== "number" || Number.isFinite(value.value))
    && typeof value.display === "string"
    && isOptionalString(value.formula)
    && (value.style === undefined || isXlsxCellStyle(value.style));
}

function isXlsxCellStyle(value: unknown): boolean {
  return isRecord(value)
    && [value.fill, value.color, value.fontFamily, value.numberFormat].every(isOptionalString)
    && isOptionalFiniteNumber(value.fontSizePoints)
    && [value.bold, value.italic, value.wrapText].every(isOptionalBoolean)
    && (value.horizontalAlignment === undefined || ["left", "center", "right"].includes(String(value.horizontalAlignment)))
    && (value.verticalAlignment === undefined || ["top", "center", "bottom"].includes(String(value.verticalAlignment)));
}

function isXlsxMergedRange(value: unknown, rowCount: number, columnCount: number): value is XlsxMergedRange {
  return isRecord(value)
    && typeof value.ref === "string"
    && [value.startRow, value.startColumn, value.endRow, value.endColumn].every(isPositiveInteger)
    && Number(value.startRow) <= Number(value.endRow)
    && Number(value.startColumn) <= Number(value.endColumn)
    && Number(value.endRow) <= rowCount
    && Number(value.endColumn) <= columnCount;
}

function isMarkdownBlock(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "heading") {
    return typeof value.level === "number" && [1, 2, 3, 4, 5, 6].includes(value.level)
      && hasStringFields(value, ["id", "address"])
      && Array.isArray(value.children) && value.children.every(isMarkdownInline);
  }
  if (value.kind === "paragraph") return Array.isArray(value.children) && value.children.every(isMarkdownInline);
  if (value.kind === "code") return isOptionalString(value.language) && typeof value.text === "string";
  if (value.kind === "quote") return Array.isArray(value.blocks) && value.blocks.every(isMarkdownBlock);
  if (value.kind === "list") {
    return typeof value.ordered === "boolean"
      && typeof value.tight === "boolean"
      && (value.start === undefined || isFiniteNumber(value.start))
      && Array.isArray(value.items)
      && value.items.every((item) => isRecord(item)
        && isOptionalBoolean(item.checked)
        && Array.isArray(item.blocks)
        && item.blocks.every(isMarkdownBlock));
  }
  if (value.kind === "table") {
    return Array.isArray(value.alignments)
      && value.alignments.every((alignment) => ["left", "center", "right"].includes(String(alignment)))
      && Array.isArray(value.head) && value.head.every(isMarkdownInlineArray)
      && Array.isArray(value.rows) && value.rows.every((row) => Array.isArray(row) && row.every(isMarkdownInlineArray));
  }
  if (value.kind === "thematicBreak") return true;
  return value.kind === "rawHtml" && typeof value.text === "string";
}

function isMarkdownInline(value: unknown): boolean {
  if (!isRecord(value) || typeof value.kind !== "string") return false;
  if (value.kind === "break") return true;
  if (value.kind === "text" || value.kind === "code") return typeof value.text === "string";
  if (value.kind === "emphasis" || value.kind === "strong" || value.kind === "strike") {
    return Array.isArray(value.children) && value.children.every(isMarkdownInline);
  }
  if (value.kind === "link") {
    return typeof value.href === "string"
      && isOptionalString(value.title)
      && Array.isArray(value.children)
      && value.children.every(isMarkdownInline);
  }
  return value.kind === "image"
    && typeof value.alt === "string"
    && isOptionalString(value.title)
    && isOptionalString(value.resourceId);
}

function isMarkdownInlineArray(value: unknown): boolean {
  return Array.isArray(value) && value.every(isMarkdownInline);
}

export function isArtifactBuildSnapshot(value: unknown): value is ArtifactBuildSnapshot {
  if (!isRecord(value) || value.kind !== ARTIFACT_BUILD_SNAPSHOT_KIND) return false;
  if (typeof value.artifactId !== "string" || !isDigest(value.revisionId) || !isDigest(value.buildId)) return false;
  if (typeof value.sequence !== "number" || !Number.isSafeInteger(value.sequence) || value.sequence < 1) return false;
  if (value.status !== "ready" && value.status !== "failed") return false;
  if (!isRecord(value.runtime)
    || value.runtime.id !== "studio.sandboxed-react"
    || typeof value.runtime.version !== "string") return false;
  if (value.previewUri !== undefined && !isStudioArtifactPath(value.previewUri)) return false;
  if (value.status === "ready" && value.previewUri === undefined) return false;
  return Array.isArray(value.diagnostics) && value.diagnostics.every((diagnostic) => isRecord(diagnostic)
    && (diagnostic.level === "warning" || diagnostic.level === "error")
    && typeof diagnostic.message === "string"
    && (diagnostic.source === undefined || typeof diagnostic.source === "string")
    && (diagnostic.line === undefined || typeof diagnostic.line === "number")
    && (diagnostic.column === undefined || typeof diagnostic.column === "number"));
}

function isArtifactDescriptor(value: unknown): value is ArtifactDescriptor {
  return isRecord(value)
    && typeof value.id === "string" && value.id !== ""
    && typeof value.threadId === "string" && value.threadId !== ""
    && typeof value.label === "string"
    && typeof value.size === "number" && Number.isFinite(value.size) && value.size >= 0
    && ARTIFACT_FAMILIES.has(value.family as ArtifactFamily)
    && typeof value.format === "string" && value.format !== ""
    && ARTIFACT_BACKINGS.has(value.backing as ArtifactBacking)
    && isRevision(value.revision)
    && isAdapter(value.adapter)
    && (value.build === undefined || (isRecord(value.build) && isStudioArtifactPath(value.build.snapshotUri)))
    && (value.backing !== "code" || value.build !== undefined)
    && isRenderer(value.renderer)
    && Array.isArray(value.capabilities)
    && value.capabilities.every((capability) => typeof capability === "string" && capability !== "");
}

function isRevision(value: unknown): value is ArtifactRevisionReference {
  return isRecord(value)
    && isDigest(value.id)
    && isDigest(value.digest)
    && value.id === value.digest
    && isRecord(value.content)
    && isStudioArtifactPath(value.content.uri)
    && typeof value.content.mediaType === "string" && value.content.mediaType !== ""
    && isDigest(value.content.digest)
    && value.content.digest === value.digest;
}

function isAdapter(value: unknown): value is ArtifactAdapterReference {
  return isRecord(value)
    && typeof value.id === "string" && value.id !== ""
    && typeof value.version === "string" && value.version !== ""
    && typeof value.schemaId === "string" && value.schemaId !== ""
    && isDigest(value.snapshotId)
    && isStudioArtifactPath(value.snapshotUri);
}

function isRenderer(value: unknown): value is ArtifactRendererReference {
  return isRecord(value)
    && typeof value.id === "string" && value.id !== ""
    && typeof value.label === "string" && value.label !== ""
    && typeof value.provider === "string" && value.provider !== ""
    && typeof value.type === "string" && value.type !== ""
    && RENDERER_STATUSES.has(value.status as ArtifactRendererStatus)
    && (value.bindingId === undefined || isDigest(value.bindingId))
    && (value.viewUri === undefined || isStudioArtifactPath(value.viewUri))
    && (value.reason === undefined || typeof value.reason === "string");
}

function isDigest(value: unknown): value is ArtifactDigest {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/u.test(value);
}

function hasStringFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return fields.every((field) => typeof value[field] === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isOptionalString(value: unknown): boolean {
  return value === undefined || typeof value === "string";
}

function isOptionalBoolean(value: unknown): boolean {
  return value === undefined || typeof value === "boolean";
}

function isOptionalFiniteNumber(value: unknown): boolean {
  return value === undefined || isFiniteNumber(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
