import type { MarkdownBlock, MarkdownInline, MarkdownListItem, MarkdownTableAlignment, ArtifactDiagnostic } from "./artifact.js";
const MAX_BLOCKS = 5_000;
const MAX_BLOCK_DEPTH = 8;
const MAX_INLINE_DEPTH = 8;
const MAX_INLINE_NODES = 50_000;
const MAX_IMAGE_COUNT = 64;
const LINKABLE_SCHEME = /^(?:https?:|mailto:)/iu;

export function inlineText(nodes: readonly MarkdownInline[]): string {
  return nodes.map((node) => {
    if (node.kind === "text" || node.kind === "code") return node.text;
    if (node.kind === "image") return node.alt;
    if (node.kind === "break") return " ";
    return inlineText(node.children);
  }).join("");
}

export interface PendingImage {
  node: Extract<MarkdownInline, { kind: "image" }>;
  source: string;
}

export interface ParsedMarkdown {
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
