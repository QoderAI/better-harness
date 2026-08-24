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
} from "../artifact-model.js";
import { artifactRevisionBase } from "./artifact-catalog.js";
import type {
  ArtifactAdaptContext,
  ArtifactAdapterImplementation,
  ArtifactResourceBytes,
} from "./artifact-adapter-contract.js";

const MARKDOWN_ADAPTER_ID = "studio.markdown-commonmark";
const MARKDOWN_ADAPTER_VERSION = "1";
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const MAX_BLOCKS = 5_000;
const MAX_BLOCK_DEPTH = 8;
const MAX_INLINE_DEPTH = 8;
const MAX_INLINE_NODES = 50_000;
const MAX_IMAGE_COUNT = 64;
const MAX_IMAGE_FILE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_TOTAL_BYTES = 24 * 1024 * 1024;
const MAX_SNAPSHOT_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 8;

/** Schemes a rendered link may actually target. Everything else stays text. */
const LINKABLE_SCHEME = /^(?:https?:|mailto:)/iu;
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

function inlineText(nodes: readonly MarkdownInline[]): string {
  return nodes.map((node) => {
    if (node.kind === "text" || node.kind === "code") return node.text;
    if (node.kind === "image") return node.alt;
    if (node.kind === "break") return " ";
    return inlineText(node.children);
  }).join("");
}

interface PendingImage {
  node: Extract<MarkdownInline, { kind: "image" }>;
  source: string;
}

interface ParsedMarkdown {
  blocks: MarkdownBlock[];
  diagnostics: ArtifactDiagnostic[];
  images: PendingImage[];
}

interface ParseContext {
  diagnostics: ArtifactDiagnostic[];
  reported: Set<string>;
  images: PendingImage[];
  headingSlugs: Map<string, number>;
  blockCount: number;
  inlineCount: number;
  headingIndex: number;
}

function note(context: ParseContext, code: string, message: string): void {
  // One diagnostic per class of skipped construct: a document with two hundred
  // raw HTML tags should say that HTML is not rendered, not say it two hundred
  // times.
  if (context.reported.has(code)) return;
  context.reported.add(code);
  context.diagnostics.push({ level: "warning", code, message });
}

export function parseMarkdown(source: string): ParsedMarkdown {
  const context: ParseContext = {
    diagnostics: [],
    reported: new Set(),
    images: [],
    headingSlugs: new Map(),
    blockCount: 0,
    inlineCount: 0,
    headingIndex: 0,
  };
  const lines = source.replaceAll("\r\n", "\n").replaceAll("\r", "\n").split("\n");
  const front = frontMatter(lines);
  const blocks = [...front.blocks, ...parseBlocks(lines.slice(front.next), context, 0)];
  context.diagnostics.push({
    level: "info",
    code: "MARKDOWN_BASELINE_RENDERER",
    message: "Studio renders headings, paragraphs, emphasis, links, images, code, quotes, lists, task items, tables, and rules. Reference-style links, footnotes, and embedded HTML are shown as source text.",
  });
  return { blocks, diagnostics: context.diagnostics, images: context.images };
}

/**
 * Leading YAML front matter, kept as a code block.
 *
 * Recognising it is not cosmetic: without it the closing `---` sits directly
 * under a line of text and reads as a setext underline, which turns a document's
 * metadata into a heading. Showing it rather than dropping it keeps the rule
 * that nothing in the source silently disappears.
 */
function frontMatter(lines: readonly string[]): { blocks: MarkdownBlock[]; next: number } {
  if (lines[0]?.trim() !== "---") return { blocks: [], next: 0 };
  const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
  if (end === -1) return { blocks: [], next: 0 };
  return { blocks: [{ kind: "code", language: "yaml", text: lines.slice(1, end).join("\n") }], next: end + 1 };
}

const ATX_HEADING = /^ {0,3}(#{1,6})(?:\s+(.*?))?\s*$/u;
const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`]*)$/u;
const THEMATIC_BREAK = /^ {0,3}([-*_])[ \t]*(?:\1[ \t]*){2,}$/u;
const BLOCK_QUOTE = /^ {0,3}> ?/u;
const BULLET_ITEM = /^( {0,3})([-*+])(?:[ \t]+(.*))?$/u;
const ORDERED_ITEM = /^( {0,3})(\d{1,9})([.)])(?:[ \t]+(.*))?$/u;
const TASK_MARKER = /^\[([ xX])\][ \t]+/u;
const TABLE_DELIMITER = /^ {0,3}\|?(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*:?-*:?[ \t]*\|?[ \t]*$/u;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/u;
const HTML_BLOCK_START = /^ {0,3}<\/?[A-Za-z][A-Za-z0-9-]*(?:[\s/>]|$)/u;

function parseBlocks(lines: readonly string[], context: ParseContext, depth: number): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  if (depth > MAX_BLOCK_DEPTH) {
    note(context, "MARKDOWN_NESTING_LIMIT", "Markdown nesting past the supported depth is shown as plain text.");
    const text = lines.join("\n").trim();
    return text === "" ? [] : [{ kind: "paragraph", children: [{ kind: "text", text }] }];
  }
  const push = (block: MarkdownBlock): void => {
    context.blockCount += 1;
    if (context.blockCount <= MAX_BLOCKS) blocks.push(block);
  };

  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence !== null) {
      const marker = fence[1]!;
      const language = fence[2]!.trim().split(/\s+/u)[0] ?? "";
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !isFenceClose(lines[index]!, marker)) {
        body.push(lines[index]!);
        index += 1;
      }
      if (index < lines.length) index += 1;
      push({ kind: "code", ...(language === "" ? {} : { language }), text: body.join("\n") });
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading !== null) {
      const level = heading[1]!.length as 1 | 2 | 3 | 4 | 5 | 6;
      const children = parseInline(stripClosingHashes(heading[2] ?? ""), context, 0);
      push({ kind: "heading", level, ...headingIdentity(inlineText(children), context), children });
      index += 1;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      push({ kind: "thematicBreak" });
      index += 1;
      continue;
    }

    if (BLOCK_QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && BLOCK_QUOTE.test(lines[index]!)) {
        quoted.push(lines[index]!.replace(BLOCK_QUOTE, ""));
        index += 1;
      }
      push({ kind: "quote", blocks: parseBlocks(quoted, context, depth + 1) });
      continue;
    }

    const list = parseList(lines, index, context, depth);
    if (list !== undefined) {
      push(list.block);
      index = list.next;
      continue;
    }

    const table = parseTable(lines, index, context);
    if (table !== undefined) {
      push(table.block);
      index = table.next;
      continue;
    }

    if (/^ {4,}\S/u.test(line)) {
      const body: string[] = [];
      while (index < lines.length && (/^ {4,}/u.test(lines[index]!) || lines[index]!.trim() === "")) {
        body.push(lines[index]!.replace(/^ {4}/u, ""));
        index += 1;
      }
      while (body.length > 0 && body.at(-1)!.trim() === "") body.pop();
      push({ kind: "code", text: body.join("\n") });
      continue;
    }

    if (HTML_BLOCK_START.test(line)) {
      const body: string[] = [];
      while (index < lines.length && lines[index]!.trim() !== "") {
        body.push(lines[index]!);
        index += 1;
      }
      note(context, "MARKDOWN_HTML_NOT_RENDERED", "Embedded HTML is shown as source text; Studio does not execute or render markup from artifact bytes.");
      push({ kind: "rawHtml", text: body.join("\n") });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length && lines[index]!.trim() !== "") {
      // A setext underline belongs to the paragraph above it, so it ends the
      // paragraph without starting a block of its own. This is checked before
      // the general interrupt test because `---` also reads as a thematic
      // break, and reading it that way turns an underlined title into a
      // title-less rule.
      if (paragraph.length > 0 && SETEXT_UNDERLINE.test(lines[index]!)) break;
      if (startsNewBlock(lines, index, context, depth)) break;
      paragraph.push(lines[index]!);
      index += 1;
    }
    const underline = index < lines.length ? SETEXT_UNDERLINE.exec(lines[index]!) : null;
    if (underline !== null && paragraph.length > 0) {
      const level = underline[1]!.startsWith("=") ? 1 : 2;
      const children = parseInline(paragraph.join("\n").trim(), context, 0);
      push({ kind: "heading", level, ...headingIdentity(inlineText(children), context), children });
      index += 1;
      continue;
    }
    if (paragraph.length > 0) push({ kind: "paragraph", children: parseInline(paragraph.join("\n").trim(), context, 0) });
  }
  return blocks;
}

/** Whether the line interrupts an open paragraph. */
function startsNewBlock(lines: readonly string[], index: number, context: ParseContext, depth: number): boolean {
  const line = lines[index]!;
  return FENCE.test(line)
    || ATX_HEADING.test(line)
    || THEMATIC_BREAK.test(line)
    || BLOCK_QUOTE.test(line)
    || HTML_BLOCK_START.test(line)
    || parseList(lines, index, context, depth) !== undefined;
}

function isFenceClose(line: string, marker: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith(marker[0]!.repeat(marker.length)) && /^[`~]+$/u.test(trimmed);
}

function stripClosingHashes(value: string): string {
  return value.replace(/\s+#+\s*$/u, "").trim();
}

function headingIdentity(label: string, context: ParseContext): { id: string; address: string } {
  const base = label.toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "-").replace(/^-+|-+$/gu, "").slice(0, 64);
  const stem = base === "" ? "section" : base;
  const seen = context.headingSlugs.get(stem) ?? 0;
  context.headingSlugs.set(stem, seen + 1);
  context.headingIndex += 1;
  return {
    id: seen === 0 ? stem : `${stem}-${seen}`,
    address: `markdown:heading/${context.headingIndex}`,
  };
}

function parseList(
  lines: readonly string[],
  start: number,
  context: ParseContext,
  depth: number,
): { block: MarkdownBlock; next: number } | undefined {
  const first = BULLET_ITEM.exec(lines[start]!) ?? ORDERED_ITEM.exec(lines[start]!);
  if (first === null) return undefined;
  const ordered = ORDERED_ITEM.test(lines[start]!) && BULLET_ITEM.exec(lines[start]!) === null;
  // A thematic break wins over a bullet item: `---` is a rule, not an empty
  // list whose marker happens to repeat.
  if (THEMATIC_BREAK.test(lines[start]!)) return undefined;

  const items: MarkdownListItem[] = [];
  let tight = true;
  let index = start;
  let sawBlank = false;
  while (index < lines.length) {
    const line = lines[index]!;
    if (line.trim() === "") {
      sawBlank = true;
      index += 1;
      continue;
    }
    const match = ordered ? ORDERED_ITEM.exec(line) : BULLET_ITEM.exec(line);
    if (match === null || THEMATIC_BREAK.test(line)) break;
    if (sawBlank && items.length > 0) tight = false;
    sawBlank = false;
    const markerWidth = line.length - (ordered ? line.replace(ORDERED_ITEM, "$4") : line.replace(BULLET_ITEM, "$3")).length;
    const body: string[] = [(ordered ? match[4] : match[3]) ?? ""];
    index += 1;
    while (index < lines.length) {
      const continuation = lines[index]!;
      if (continuation.trim() === "") {
        // A blank line only continues the item when indented content follows.
        const next = lines[index + 1];
        if (next === undefined || next.trim() === "" || !isIndentedBy(next, markerWidth)) break;
        body.push("");
        index += 1;
        continue;
      }
      if (!isIndentedBy(continuation, markerWidth)) break;
      body.push(continuation.slice(markerWidth));
      index += 1;
    }
    items.push(listItem(body, context, depth));
  }
  if (items.length === 0) return undefined;
  const startNumber = ordered ? Number.parseInt(first[2]!, 10) : undefined;
  return {
    block: {
      kind: "list",
      ordered,
      tight,
      ...(startNumber !== undefined && startNumber !== 1 ? { start: startNumber } : {}),
      items,
    },
    next: index,
  };
}

function isIndentedBy(line: string, width: number): boolean {
  return /^\s/u.test(line) && line.slice(0, width).trim() === "";
}

function listItem(body: readonly string[], context: ParseContext, depth: number): MarkdownListItem {
  const task = TASK_MARKER.exec(body[0] ?? "");
  const lines = task === null ? [...body] : [body[0]!.slice(task[0].length), ...body.slice(1)];
  const blocks = parseBlocks(lines, context, depth + 1);
  return task === null ? { blocks } : { checked: task[1]!.toLowerCase() === "x", blocks };
}

function parseTable(
  lines: readonly string[],
  start: number,
  context: ParseContext,
): { block: MarkdownBlock; next: number } | undefined {
  const header = lines[start]!;
  const delimiter = lines[start + 1];
  if (!header.includes("|") || delimiter === undefined || !TABLE_DELIMITER.test(delimiter)) return undefined;
  const alignments = splitRow(delimiter).map((cell): MarkdownTableAlignment => {
    const trimmed = cell.trim();
    if (trimmed.startsWith(":") && trimmed.endsWith(":")) return "center";
    return trimmed.endsWith(":") ? "right" : "left";
  });
  const head = splitRow(header).map((cell) => parseInline(cell.trim(), context, 0));
  if (head.length === 0) return undefined;
  const rows: MarkdownInline[][][] = [];
  let index = start + 2;
  while (index < lines.length && lines[index]!.trim() !== "" && lines[index]!.includes("|")) {
    const cells = splitRow(lines[index]!).map((cell) => parseInline(cell.trim(), context, 0));
    // Pad or trim to the header width so a ragged row cannot shift columns.
    while (cells.length < head.length) cells.push([]);
    rows.push(cells.slice(0, head.length));
    index += 1;
  }
  return {
    block: {
      kind: "table",
      alignments: head.map((_, column) => alignments[column] ?? "left"),
      head,
      rows,
    },
    next: index,
  };
}

function splitRow(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let index = 0;
  const trimmed = line.trim().replace(/^\|/u, "").replace(/\|$/u, "");
  while (index < trimmed.length) {
    const character = trimmed[index]!;
    if (character === "\\" && trimmed[index + 1] === "|") {
      current += "|";
      index += 2;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      index += 1;
      continue;
    }
    current += character;
    index += 1;
  }
  cells.push(current);
  return cells;
}

function parseInline(source: string, context: ParseContext, depth: number): MarkdownInline[] {
  const nodes: MarkdownInline[] = [];
  if (depth > MAX_INLINE_DEPTH) return source === "" ? [] : [{ kind: "text", text: source }];
  let buffer = "";
  let index = 0;
  const push = (node: MarkdownInline): void => {
    context.inlineCount += 1;
    if (context.inlineCount <= MAX_INLINE_NODES) nodes.push(node);
  };
  const flush = (): void => {
    if (buffer === "") return;
    push({ kind: "text", text: buffer });
    buffer = "";
  };

  while (index < source.length) {
    const character = source[index]!;

    if (character === "\\" && index + 1 < source.length && /[!-/:-@[-`{-~]/u.test(source[index + 1]!)) {
      buffer += source[index + 1]!;
      index += 2;
      continue;
    }

    if (character === "\n") {
      if (/ {2,}$/u.test(buffer) || buffer.endsWith("\\")) {
        buffer = buffer.replace(/(?: {2,}|\\)$/u, "");
        flush();
        push({ kind: "break" });
      } else {
        buffer += "\n";
      }
      index += 1;
      continue;
    }

    if (character === "`") {
      const run = /^`+/u.exec(source.slice(index))![0];
      const close = source.indexOf(run, index + run.length);
      const nextIsLonger = source[close + run.length] === "`";
      if (close !== -1 && !nextIsLonger) {
        const text = source.slice(index + run.length, close);
        flush();
        push({ kind: "code", text: text.startsWith(" ") && text.endsWith(" ") && text.trim() !== "" ? text.slice(1, -1) : text });
        index = close + run.length;
        continue;
      }
    }

    if (character === "!" && source[index + 1] === "[") {
      const label = matchBracket(source, index + 1);
      const target = label === undefined ? undefined : readLinkTarget(source, label.end);
      if (label !== undefined && target !== undefined) {
        flush();
        const node: Extract<MarkdownInline, { kind: "image" }> = {
          kind: "image",
          alt: label.text,
          ...(target.title === undefined ? {} : { title: target.title }),
        };
        context.images.push({ node, source: target.href });
        push(node);
        index = target.end;
        continue;
      }
    }

    if (character === "[") {
      const label = matchBracket(source, index);
      const target = label === undefined ? undefined : readLinkTarget(source, label.end);
      if (label !== undefined && target !== undefined) {
        flush();
        const href = safeHref(target.href, context);
        const children = parseInline(label.text, context, depth + 1);
        push(href === undefined
          ? { kind: "text", text: label.text }
          : { kind: "link", href, ...(target.title === undefined ? {} : { title: target.title }), children });
        index = target.end;
        continue;
      }
      if (label !== undefined && source[label.end] === "[") {
        note(context, "MARKDOWN_REFERENCE_LINK", "Reference-style links are shown as their label text; Studio resolves inline link targets only.");
      }
    }

    const emphasis = matchEmphasis(source, index);
    if (emphasis !== undefined) {
      flush();
      push({ kind: emphasis.kind, children: parseInline(emphasis.text, context, depth + 1) });
      index = emphasis.end;
      continue;
    }

    if (character === "<") {
      const autolink = /^<([A-Za-z][A-Za-z0-9+.-]*:[^<>\s]+|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)>/u.exec(source.slice(index));
      if (autolink !== null) {
        const raw = autolink[1]!;
        const href = safeHref(raw.includes(":") ? raw : `mailto:${raw}`, context);
        flush();
        push(href === undefined ? { kind: "text", text: raw } : { kind: "link", href, children: [{ kind: "text", text: raw }] });
        index += autolink[0].length;
        continue;
      }
      if (/^<\/?[A-Za-z][A-Za-z0-9-]*(?:\s[^<>]*)?\/?>/u.test(source.slice(index))) {
        note(context, "MARKDOWN_HTML_NOT_RENDERED", "Embedded HTML is shown as source text; Studio does not execute or render markup from artifact bytes.");
      }
    }

    buffer += character;
    index += 1;
  }
  flush();
  return nodes;
}

/** Find the `]` that closes the `[` at `start`, tracking nested brackets. */
function matchBracket(source: string, start: number): { text: string; end: number } | undefined {
  let level = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index]!;
    if (character === "\\") {
      index += 1;
      continue;
    }
    if (character === "[") level += 1;
    else if (character === "]") {
      level -= 1;
      if (level === 0) return { text: source.slice(start + 1, index), end: index + 1 };
    }
  }
  return undefined;
}

function readLinkTarget(source: string, start: number): { href: string; title?: string; end: number } | undefined {
  if (source[start] !== "(") return undefined;
  let index = start + 1;
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  let href = "";
  if (source[index] === "<") {
    const close = source.indexOf(">", index + 1);
    if (close === -1) return undefined;
    href = source.slice(index + 1, close);
    index = close + 1;
  } else {
    let level = 0;
    while (index < source.length && !/\s/u.test(source[index]!)) {
      const character = source[index]!;
      if (character === "(") level += 1;
      if (character === ")") {
        if (level === 0) break;
        level -= 1;
      }
      href += character;
      index += 1;
    }
  }
  while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  let title: string | undefined;
  const quote = source[index];
  if (quote === '"' || quote === "'") {
    const close = source.indexOf(quote, index + 1);
    if (close === -1) return undefined;
    title = source.slice(index + 1, close);
    index = close + 1;
    while (index < source.length && /\s/u.test(source[index]!)) index += 1;
  }
  if (source[index] !== ")") return undefined;
  return { href, ...(title === undefined ? {} : { title }), end: index + 1 };
}

/**
 * Link targets Studio is willing to render as a link.
 *
 * An in-document anchor stays, because the renderer scrolls to it without ever
 * touching the address bar. Everything else must be an absolute `http(s)` or
 * `mailto:` target: a relative path would resolve against Studio's own routes
 * rather than the artifact set, and every other scheme — `javascript:` first
 * among them — is a way for artifact bytes to act through a reader's click.
 */
function safeHref(raw: string, context: ParseContext): string | undefined {
  const value = raw.trim();
  if (value === "") return undefined;
  if (value.startsWith("#")) return value.length > 1 ? value : undefined;
  if (LINKABLE_SCHEME.test(value)) return value;
  note(
    context,
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value) ? "MARKDOWN_LINK_SCHEME_BLOCKED" : "MARKDOWN_LINK_RELATIVE",
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)
      ? "Links are limited to http, https, and mailto targets; other schemes are shown as text."
      : "Relative links are shown as text, because they would resolve against Studio rather than the artifact set.",
  );
  return undefined;
}

function matchEmphasis(
  source: string,
  index: number,
): { kind: "emphasis" | "strong" | "strike"; text: string; end: number } | undefined {
  for (const [marker, kind] of [["***", "strong"], ["**", "strong"], ["__", "strong"], ["~~", "strike"], ["*", "emphasis"], ["_", "emphasis"]] as const) {
    if (!source.startsWith(marker, index)) continue;
    // An underscore inside a word is part of the word — snake_case_names must
    // not turn into emphasis.
    if (marker.startsWith("_") && /[\p{Letter}\p{Number}]/u.test(source[index - 1] ?? "")) continue;
    const close = source.indexOf(marker, index + marker.length);
    if (close === -1 || close === index + marker.length) continue;
    if (marker.startsWith("_") && /[\p{Letter}\p{Number}]/u.test(source[close + marker.length] ?? "")) continue;
    return { kind: marker === "***" ? "strong" : kind, text: source.slice(index + marker.length, close), end: close + marker.length };
  }
  return undefined;
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
