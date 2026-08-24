import { posix } from "node:path";
import { XMLParser } from "fast-xml-parser";
import {
  ARTIFACT_DATA_SNAPSHOT_KIND,
  type ArtifactDataSnapshot,
  type ArtifactDescriptor,
  type ArtifactDiagnostic,
  type ArtifactSemanticIndexEntry,
  type ArtifactStructureNode,
  type XlsxArtifactPayload,
  XLSX_ARTIFACT_PREVIEW_LIMITS,
  type XlsxCellSnapshot,
  type XlsxCellStyle,
  type XlsxMergedRange,
  type XlsxWorksheetSnapshot,
} from "../artifact-model.js";
import type { ArtifactAdaptContext, ArtifactAdapterImplementation } from "./artifact-adapter-contract.js";
import {
  artifactSnapshotCacheKey,
  assertBoundedArtifactSnapshot,
  loadBoundedOpcArchive,
  readBoundedOpcXmlSource,
  readLruCache,
  resolveOpcPackageTarget,
  writeLruCache,
} from "./bounded-opc-package.js";

const XLSX_ADAPTER_ID = "studio.xlsx-ooxml";
const XLSX_ADAPTER_VERSION = "1";
const XLSX_SCHEMA_ID = "xlsx/v1";
const MAX_XML_BYTES = 16 * 1024 * 1024;
const MAX_SHEETS = XLSX_ARTIFACT_PREVIEW_LIMITS.sheets;
const MAX_ROWS_PER_SHEET = XLSX_ARTIFACT_PREVIEW_LIMITS.rowsPerSheet;
const MAX_COLUMNS_PER_SHEET = XLSX_ARTIFACT_PREVIEW_LIMITS.columnsPerSheet;
const MAX_CELLS = XLSX_ARTIFACT_PREVIEW_LIMITS.populatedCells;

interface CachedXlsxSnapshot {
  snapshot: ArtifactDataSnapshot;
}

interface PackageRelationship {
  id: string;
  type: string;
  target?: string;
  external: boolean;
}

interface ParsedStyles {
  cellStyles: XlsxCellStyle[];
}

interface ParseBudget {
  cellCount: number;
}

/** A bounded, read-only OOXML adapter for Studio's native XLSX renderer. */
export const XLSX_ARTIFACT_ADAPTER: ArtifactAdapterImplementation = {
  id: XLSX_ADAPTER_ID,
  version: XLSX_ADAPTER_VERSION,
  schemaId: XLSX_SCHEMA_ID,
  adapt: async (context) => (await loadXlsxSnapshot(context)).snapshot,
};

const cache = new Map<string, CachedXlsxSnapshot>();
const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "",
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: false,
  removeNSPrefix: true,
});

export function resetXlsxArtifactCache(): void {
  cache.clear();
}

async function loadXlsxSnapshot({ entry, descriptor }: ArtifactAdaptContext): Promise<CachedXlsxSnapshot> {
  if (
    descriptor.adapter.id !== XLSX_ADAPTER_ID
    || descriptor.adapter.version !== XLSX_ADAPTER_VERSION
    || descriptor.adapter.schemaId !== XLSX_SCHEMA_ID
  ) {
    throw new Error("XLSX snapshot requested with an unsupported adapter.");
  }
  const key = artifactSnapshotCacheKey(descriptor);
  const cached = readLruCache(cache, key);
  if (cached !== undefined) return cached;
  const archive = await loadBoundedOpcArchive({
    path: entry.path,
    expectedDigest: descriptor.revision.digest,
    format: "XLSX",
    include: (path) => path.startsWith("xl/") || path === "_rels/.rels" || path === "[Content_Types].xml",
  });
  const result = materializeXlsxSnapshot(archive, descriptor);
  assertBoundedArtifactSnapshot(result.snapshot, "XLSX");
  writeLruCache(cache, key, result);
  return result;
}

function materializeXlsxSnapshot(
  archive: Record<string, Uint8Array>,
  descriptor: ArtifactDescriptor,
): CachedXlsxSnapshot {
  const rootRelationships = relationshipMap(parseXml(archive, "_rels/.rels"), "");
  const workbookRelationship = [...rootRelationships.values()].find((relationship) => relationship.type.endsWith("/officeDocument"));
  if (workbookRelationship === undefined || workbookRelationship.external || workbookRelationship.target === undefined) {
    throw new Error("XLSX package workbook relationship is missing or external.");
  }
  const workbookPath = workbookRelationship.target;
  const workbook = rootObject(parseXml(archive, workbookPath), "workbook", "XLSX workbook root is missing.");
  const workbookRelationshipPath = `${posix.dirname(workbookPath)}/_rels/${posix.basename(workbookPath)}.rels`;
  const workbookRelationships = relationshipMap(parseXml(archive, workbookRelationshipPath), workbookPath);
  const sharedStringsRelationship = [...workbookRelationships.values()].find((relationship) => relationship.type.endsWith("/sharedStrings") && !relationship.external);
  const stylesRelationship = [...workbookRelationships.values()].find((relationship) => relationship.type.endsWith("/styles") && !relationship.external);
  const sharedStrings = sharedStringsRelationship?.target === undefined ? [] : parseSharedStrings(archive, sharedStringsRelationship.target);
  const styles = stylesRelationship?.target === undefined ? { cellStyles: [] } : parseStyles(archive, stylesRelationship.target);
  const diagnostics: ArtifactDiagnostic[] = [];
  const structure: ArtifactStructureNode[] = [];
  const semanticIndex: ArtifactSemanticIndexEntry[] = [];
  const workbookProperties = optionalRecord(workbook.workbookPr);
  const dateSystem = truthyAttribute(workbookProperties?.date1904) ? "1904" : "1900";
  const workbookView = firstRecord(optionalRecord(workbook.bookViews)?.workbookView);
  const requestedActiveSheetIndex = nonNegativeInteger(workbookView?.activeTab) ?? 0;
  const definedNamesPresent = asArray(optionalRecord(workbook.definedNames)?.definedName).length > 0;
  const sheetRows = asArray(optionalRecord(workbook.sheets)?.sheet);
  if (sheetRows.length === 0) throw new Error("XLSX workbook has no worksheets.");
  if (sheetRows.length > MAX_SHEETS) throw new Error("XLSX workbook exceeds the worksheet limit.");
  const budget: ParseBudget = { cellCount: 0 };
  const sheets = sheetRows.map((sheetValue, index) => {
    const sheet = record(sheetValue, "XLSX worksheet declaration is malformed.");
    const label = requiredString(sheet.name, "XLSX worksheet name is missing.");
    const relationshipId = requiredString(sheet.id, "XLSX worksheet relationship is missing.");
    const relationship = workbookRelationships.get(relationshipId);
    if (relationship === undefined || relationship.external || relationship.target === undefined || !relationship.type.endsWith("/worksheet")) {
      throw new Error(`XLSX worksheet ${index + 1} relationship is missing or external.`);
    }
    const parsed = parseWorksheet(archive, relationship.target, label, index, sharedStrings, styles, dateSystem, diagnostics, budget);
    structure.push({ id: parsed.id, label: parsed.label, address: parsed.address, kind: "worksheet" });
    semanticIndex.push({ address: parsed.address, label: parsed.label, kind: "worksheet" });
    for (const cell of parsed.cells) {
      if (cell.display !== "" || cell.formula !== undefined) {
        semanticIndex.push({ address: `${parsed.address}/cell/${cell.address}`, label: cell.display || cell.address, kind: "cell" });
      }
    }
    return parsed;
  });
  diagnostics.push({
    level: "info",
    code: "XLSX_BASELINE_RENDERER",
    message: "Studio renders bounded worksheet cells, cached formula results, merged ranges, dimensions, and basic styles; formulas are not recalculated and charts, drawings, pivots, conditional formatting, and Excel layout parity are not supported.",
  });
  const payload: XlsxArtifactPayload = {
    kind: "xlsx/v1",
    activeSheetIndex: Math.min(requestedActiveSheetIndex, sheets.length - 1),
    dateSystem,
    definedNamesPresent,
    sheets,
  };
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
      resources: [],
      diagnostics,
      payload,
    },
  };
}

function parseWorksheet(
  archive: Record<string, Uint8Array>,
  path: string,
  label: string,
  index: number,
  sharedStrings: string[],
  styles: ParsedStyles,
  dateSystem: "1900" | "1904",
  diagnostics: ArtifactDiagnostic[],
  budget: ParseBudget,
): XlsxWorksheetSnapshot {
  const worksheet = rootObject(parseXml(archive, path), "worksheet", `XLSX worksheet ${index + 1} root is missing.`);
  const cells: XlsxCellSnapshot[] = [];
  let maxRow = 1;
  let maxColumn = 1;
  let truncated = false;
  for (const rowValue of asArray(optionalRecord(worksheet.sheetData)?.row)) {
    const row = record(rowValue, "XLSX worksheet row is malformed.");
    for (const cellValue of asArray(row.c)) {
      budget.cellCount += 1;
      if (budget.cellCount > MAX_CELLS) throw new Error("XLSX workbook exceeds the populated-cell limit.");
      const parsed = parseCell(record(cellValue, "XLSX worksheet cell is malformed."), sharedStrings, styles, dateSystem, diagnostics);
      maxRow = Math.max(maxRow, parsed.row);
      maxColumn = Math.max(maxColumn, parsed.column);
      if (parsed.row <= MAX_ROWS_PER_SHEET && parsed.column <= MAX_COLUMNS_PER_SHEET) cells.push(parsed);
      else truncated = true;
    }
  }
  const mergedRanges = parseMergedRanges(worksheet, diagnostics);
  for (const merge of mergedRanges) {
    maxRow = Math.max(maxRow, merge.endRow);
    maxColumn = Math.max(maxColumn, merge.endColumn);
    if (merge.endRow > MAX_ROWS_PER_SHEET || merge.endColumn > MAX_COLUMNS_PER_SHEET) truncated = true;
  }
  const rowCount = Math.min(maxRow, MAX_ROWS_PER_SHEET);
  const columnCount = Math.min(maxColumn, MAX_COLUMNS_PER_SHEET);
  if (truncated) diagnostics.push({
    level: "warning",
    code: "XLSX_SHEET_TRUNCATED",
    message: `${label} exceeds the ${MAX_ROWS_PER_SHEET} row by ${MAX_COLUMNS_PER_SHEET} column Studio preview window; cells outside it are omitted.`,
    address: `xlsx:sheet/${index + 1}`,
  });
  const columns = parseColumns(worksheet, columnCount);
  const rows = asArray(optionalRecord(worksheet.sheetData)?.row).flatMap((rowValue) => {
    const row = record(rowValue, "XLSX worksheet row is malformed.");
    const rowIndex = positiveInteger(row.r);
    const height = positiveNumber(row.ht);
    return rowIndex === undefined || rowIndex > rowCount ? [] : [{ index: rowIndex, ...(height === undefined ? {} : { height }) }];
  });
  return {
    id: `sheet-${index + 1}`,
    label,
    address: `xlsx:sheet/${index + 1}`,
    rowCount,
    columnCount,
    cells,
    mergedRanges: mergedRanges.filter((merge) => merge.endRow <= rowCount && merge.endColumn <= columnCount),
    columns,
    rows,
  };
}

function parseCell(
  cell: Record<string, unknown>,
  sharedStrings: string[],
  styles: ParsedStyles,
  dateSystem: "1900" | "1904",
  diagnostics: ArtifactDiagnostic[],
): XlsxCellSnapshot {
  const address = requiredString(cell.r, "XLSX cell address is missing.");
  const coordinate = parseCellAddress(address);
  const type = stringValue(cell.t);
  const styleIndex = nonNegativeInteger(cell.s) ?? 0;
  const baseStyle = styles.cellStyles[styleIndex] ?? {};
  const formula = textValue(cell.f);
  const rawValue = textValue(cell.v);
  let value: XlsxCellSnapshot["value"];
  if (type === "s") {
    const sharedStringIndex = nonNegativeInteger(rawValue);
    if (sharedStringIndex === undefined || sharedStrings[sharedStringIndex] === undefined) {
      throw new Error(`XLSX shared string reference is invalid at ${address}.`);
    }
    value = sharedStrings[sharedStringIndex]!;
  } else if (type === "inlineStr") value = collectText(cell.is);
  else if (type === "str") value = rawValue ?? "";
  else if (type === "b") value = rawValue === "1" || rawValue === "true";
  else if (type === "e") {
    value = rawValue ?? "#ERROR!";
    diagnostics.push({ level: "warning", code: "XLSX_CELL_ERROR", message: `The workbook contains a cached formula error (${value}).`, address: `xlsx:cell/${address}` });
  } else if (type === "d") value = rawValue ?? "";
  else if (rawValue === undefined || rawValue === "") value = null;
  else {
    const numeric = Number(rawValue);
    if (!Number.isFinite(numeric)) throw new Error(`XLSX numeric value is invalid at ${address}.`);
    value = numeric;
  }
  const style: XlsxCellStyle = {
    ...baseStyle,
    ...(baseStyle.horizontalAlignment === undefined ? { horizontalAlignment: typeof value === "number" ? "right" : "left" } : {}),
    ...(typeof value === "number" && value < 0 && baseStyle.numberFormat?.includes("[Red]") ? { color: "#D13438" } : {}),
  };
  return {
    address,
    row: coordinate.row,
    column: coordinate.column,
    value,
    display: formatCellValue(value, style.numberFormat, dateSystem),
    ...(formula === undefined ? {} : { formula }),
    ...(Object.keys(style).length === 0 ? {} : { style }),
  };
}

function parseSharedStrings(archive: Record<string, Uint8Array>, path: string): string[] {
  const parsed = parseXml(archive, path);
  if (parsed.sst === "") return [];
  const root = rootObject(parsed, "sst", "XLSX shared strings root is missing.");
  return asArray(root.si).map((value) => collectText(value));
}

function parseStyles(archive: Record<string, Uint8Array>, path: string): ParsedStyles {
  const root = rootObject(parseXml(archive, path), "styleSheet", "XLSX styles root is missing.");
  const customFormats = new Map<number, string>();
  for (const value of asArray(optionalRecord(root.numFmts)?.numFmt)) {
    const format = record(value, "XLSX number format is malformed.");
    const id = nonNegativeInteger(format.numFmtId);
    const code = stringValue(format.formatCode);
    if (id !== undefined && code !== undefined) customFormats.set(id, code);
  }
  const fonts = asArray(optionalRecord(root.fonts)?.font).map((value) => parseFont(record(value, "XLSX font is malformed.")));
  const fills = asArray(optionalRecord(root.fills)?.fill).map((value) => parseFill(record(value, "XLSX fill is malformed.")));
  const cellStyles = asArray(optionalRecord(root.cellXfs)?.xf).map((value) => {
    const xf = record(value, "XLSX cell style is malformed.");
    const font = fonts[nonNegativeInteger(xf.fontId) ?? 0] ?? {};
    const fill = fills[nonNegativeInteger(xf.fillId) ?? 0];
    const numberFormatId = nonNegativeInteger(xf.numFmtId) ?? 0;
    const alignment = optionalRecord(xf.alignment);
    const horizontalAlignment = enumValue(alignment?.horizontal, ["left", "center", "right"] as const);
    const verticalAlignment = enumValue(alignment?.vertical, ["top", "center", "bottom"] as const);
    return {
      ...font,
      ...(fill === undefined ? {} : { fill }),
      ...(horizontalAlignment === undefined ? {} : { horizontalAlignment }),
      ...(verticalAlignment === undefined ? {} : { verticalAlignment }),
      ...(truthyAttribute(alignment?.wrapText) ? { wrapText: true } : {}),
      ...(numberFormatId === 0 ? {} : { numberFormat: customFormats.get(numberFormatId) ?? BUILTIN_NUMBER_FORMATS.get(numberFormatId) ?? `builtin:${numberFormatId}` }),
    } satisfies XlsxCellStyle;
  });
  return { cellStyles };
}

function parseFont(font: Record<string, unknown>): XlsxCellStyle {
  const name = stringValue(optionalRecord(font.name)?.val);
  const size = positiveNumber(optionalRecord(font.sz)?.val);
  const color = rgbColor(optionalRecord(font.color)?.rgb);
  return {
    ...(name === undefined ? {} : { fontFamily: name }),
    ...(size === undefined ? {} : { fontSizePoints: size }),
    ...(color === undefined ? {} : { color }),
    ...(font.b !== undefined && !falsyElement(font.b) ? { bold: true } : {}),
    ...(font.i !== undefined && !falsyElement(font.i) ? { italic: true } : {}),
  };
}

function parseFill(fill: Record<string, unknown>): string | undefined {
  const pattern = optionalRecord(fill.patternFill);
  if (stringValue(pattern?.patternType) !== "solid") return undefined;
  return rgbColor(optionalRecord(pattern?.fgColor)?.rgb);
}

function parseColumns(worksheet: Record<string, unknown>, columnCount: number): Array<{ index: number; width?: number }> {
  const result = new Map<number, number | undefined>();
  for (const value of asArray(optionalRecord(worksheet.cols)?.col)) {
    const column = record(value, "XLSX column metadata is malformed.");
    const min = positiveInteger(column.min);
    const max = positiveInteger(column.max);
    const width = positiveNumber(column.width);
    if (min === undefined || max === undefined || max < min) throw new Error("XLSX column metadata range is invalid.");
    for (let index = min; index <= Math.min(max, columnCount); index += 1) result.set(index, width);
  }
  return [...result.entries()].map(([index, width]) => ({ index, ...(width === undefined ? {} : { width }) }));
}

function parseMergedRanges(worksheet: Record<string, unknown>, diagnostics: ArtifactDiagnostic[]): XlsxMergedRange[] {
  const result: XlsxMergedRange[] = [];
  const occupied = new Set<string>();
  for (const value of asArray(optionalRecord(worksheet.mergeCells)?.mergeCell)) {
    const merge = record(value, "XLSX merged range is malformed.");
    const ref = requiredString(merge.ref, "XLSX merged range reference is missing.");
    const [startText, endText] = ref.split(":");
    if (startText === undefined || endText === undefined) throw new Error("XLSX merged range reference is invalid.");
    const start = parseCellAddress(startText);
    const end = parseCellAddress(endText);
    if (end.row < start.row || end.column < start.column) throw new Error("XLSX merged range bounds are invalid.");
    if ((end.row - start.row + 1) * (end.column - start.column + 1) > MAX_ROWS_PER_SHEET * MAX_COLUMNS_PER_SHEET) {
      throw new Error("XLSX merged range exceeds the preview limit.");
    }
    for (let row = start.row; row <= Math.min(end.row, MAX_ROWS_PER_SHEET); row += 1) {
      for (let column = start.column; column <= Math.min(end.column, MAX_COLUMNS_PER_SHEET); column += 1) {
        const key = `${row}:${column}`;
        if (occupied.has(key)) throw new Error("XLSX merged ranges overlap.");
        occupied.add(key);
      }
    }
    result.push({ ref, startRow: start.row, startColumn: start.column, endRow: end.row, endColumn: end.column });
  }
  if (result.length > 1_000) diagnostics.push({ level: "warning", code: "XLSX_MANY_MERGES", message: "The workbook contains more than 1,000 merged ranges." });
  return result;
}

function relationshipMap(root: Record<string, unknown>, sourcePath: string): Map<string, PackageRelationship> {
  const relationshipsRoot = rootObject(root, "Relationships", "OOXML relationship root is missing.");
  const result = new Map<string, PackageRelationship>();
  for (const value of asArray(relationshipsRoot.Relationship)) {
    const relationship = record(value, "OOXML relationship is malformed.");
    const id = requiredString(relationship.Id, "OOXML relationship id is missing.");
    const type = requiredString(relationship.Type, "OOXML relationship type is missing.");
    if (result.has(id)) throw new Error("OOXML relationship ids must be unique.");
    const external = stringValue(relationship.TargetMode)?.toLowerCase() === "external";
    const targetText = stringValue(relationship.Target);
    result.set(id, {
      id,
      type,
      external,
      ...(external || targetText === undefined ? {} : { target: resolvePackageTarget(sourcePath, targetText) }),
    });
  }
  return result;
}

function parseXml(archive: Record<string, Uint8Array>, path: string): Record<string, unknown> {
  const source = readBoundedOpcXmlSource(archive, path, "XLSX", MAX_XML_BYTES);
  return record(xmlParser.parse(source), "XLSX XML part is malformed.");
}

function rootObject(source: Record<string, unknown>, name: string, message: string): Record<string, unknown> {
  return record(source[name], message);
}

function resolvePackageTarget(sourcePath: string, target: string): string {
  return resolveOpcPackageTarget(sourcePath, target, "XLSX");
}

function parseCellAddress(value: string): { row: number; column: number } {
  const match = /^([A-Z]{1,3})([1-9][0-9]*)$/u.exec(value.toUpperCase());
  if (match === null) throw new Error("XLSX cell address is invalid.");
  let column = 0;
  for (const character of match[1]!) column = column * 26 + character.charCodeAt(0) - 64;
  const row = Number(match[2]);
  if (!Number.isSafeInteger(row) || column > 16_384 || row > 1_048_576) throw new Error("XLSX cell address exceeds worksheet bounds.");
  return { row, column };
}

function formatCellValue(value: XlsxCellSnapshot["value"], numberFormat: string | undefined, dateSystem: "1900" | "1904"): string {
  if (value === null) return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "string") return value;
  if (numberFormat === undefined || numberFormat.startsWith("builtin:")) return String(value);
  const normalized = numberFormat.replace(/"[^"]*"/gu, "").replace(/\[[^\]]*\]/gu, "");
  if (/[ymd]/iu.test(normalized)) return formatExcelDate(value, dateSystem, /[hs]/iu.test(normalized));
  if (normalized.includes("%")) {
    const decimals = normalized.match(/\.([0#]+)%/u)?.[1]?.length ?? 0;
    return `${(value * 100).toFixed(decimals)}%`;
  }
  const decimals = normalized.match(/\.([0#]+)/u)?.[1]?.length ?? 0;
  const useGrouping = normalized.includes(",");
  const formatted = new Intl.NumberFormat("en-US", { useGrouping, minimumFractionDigits: decimals, maximumFractionDigits: decimals }).format(value);
  return normalized.includes("$") ? `$${formatted}` : formatted;
}

function formatExcelDate(serial: number, dateSystem: "1900" | "1904", includeTime: boolean): string {
  const epoch = dateSystem === "1904" ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
  const date = new Date(epoch + serial * 86_400_000);
  if (!Number.isFinite(date.getTime())) return String(serial);
  const iso = date.toISOString();
  return includeTime ? iso.slice(0, 19).replace("T", " ") : iso.slice(0, 10);
}

function collectText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(collectText).join("");
  if (typeof value !== "object" || value === null) return "";
  const source = value as Record<string, unknown>;
  if (typeof source["#text"] === "string") return source["#text"];
  if (source.t !== undefined) return collectText(source.t);
  if (source.r !== undefined) return collectText(source.r);
  return "";
}

function textValue(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object" && value !== null) return textValue((value as Record<string, unknown>)["#text"]);
  return undefined;
}

function rgbColor(value: unknown): string | undefined {
  const text = stringValue(value);
  if (text === undefined || !/^(?:[0-9A-Fa-f]{6}|[0-9A-Fa-f]{8})$/u.test(text)) return undefined;
  return `#${text.slice(-6).toUpperCase()}`;
}

function falsyElement(value: unknown): boolean {
  if (typeof value !== "object" || value === null) return false;
  const val = stringValue((value as Record<string, unknown>).val);
  return val === "0" || val?.toLowerCase() === "false";
}

function truthyAttribute(value: unknown): boolean {
  const text = stringValue(value)?.toLowerCase();
  return text === "1" || text === "true" || text === "on";
}

function enumValue<const T extends readonly string[]>(value: unknown, values: T): T[number] | undefined {
  const text = stringValue(value);
  return text === undefined ? undefined : values.find((candidate) => candidate === text);
}

function firstRecord(value: unknown): Record<string, unknown> | undefined {
  const first = asArray(value)[0];
  return first === undefined ? undefined : record(first, "XLSX metadata is malformed.");
}

function asArray(value: unknown): unknown[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function record(value: unknown, message: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error(message);
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | undefined {
  return value === undefined ? undefined : record(value, "XLSX metadata is malformed.");
}

function requiredString(value: unknown, message: string): string {
  const result = stringValue(value);
  if (result === undefined || result === "") throw new Error(message);
  return result;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function nonNegativeInteger(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^\d+$/u.test(value) ? Number(value) : Number.NaN;
  return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : undefined;
}

function positiveInteger(value: unknown): number | undefined {
  const numeric = nonNegativeInteger(value);
  return numeric !== undefined && numeric > 0 ? numeric : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(numeric) && numeric > 0 ? numeric : undefined;
}

const BUILTIN_NUMBER_FORMATS = new Map<number, string>([
  [1, "0"],
  [2, "0.00"],
  [3, "#,##0"],
  [4, "#,##0.00"],
  [9, "0%"],
  [10, "0.00%"],
  [14, "yyyy-mm-dd"],
  [15, "yyyy-mm-dd"],
  [16, "yyyy-mm-dd"],
  [17, "yyyy-mm-dd"],
  [18, "hh:mm"],
  [19, "hh:mm"],
  [20, "hh:mm"],
  [21, "hh:mm:ss"],
  [22, "yyyy-mm-dd hh:mm"],
]);
