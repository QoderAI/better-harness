import type { StructuralDiffLine, StructuralDiffSegment } from "../../contracts/structural-diff.js";
import type { StudioCodeToken } from "./code-highlight.js";

/**
 * The reading model behind the structural view: which rows changed, what text
 * each revision owns, and how the engine's novel runs combine with the theme's
 * syntax tokens.
 *
 * It is separate from the component because all of it is arithmetic over two
 * ordered run lists, and arithmetic is worth asserting on directly.
 */

export type StructuralRevision = "lhs" | "rhs";

export type StructuralRowChange = "added" | "removed" | "modified" | "unchanged";

export interface StructuralPaintedSegment {
  text: string;
  novel: boolean;
  /** difftastic's kind for the run this piece came from. */
  highlight: string;
  /** The theme's foreground for this piece, absent when the file is unhighlighted. */
  color?: string;
  /** Shiki's font-style bitmask, absent when the piece is plain. */
  fontStyle?: number;
}

/** A maximal run of consecutive changed rows: what a reviewer reads as one change. */
export interface StructuralChangeBlock {
  firstRow: number;
  lastRow: number;
}

export interface StructuralRevisionSource {
  /** The revision's own text, one line per row it is present on, in row order. */
  text: string;
  /** For each row, its line index in `text`, or `-1` where the revision has no line. */
  lineForRow: readonly number[];
}

/**
 * How one row changed. A row present on only one side is that side's polarity
 * even when the engine flagged nothing inside it, because the line itself is the
 * change.
 */
export function structuralRowChange(line: StructuralDiffLine): StructuralRowChange {
  const removed = line.rhs === null && line.lhs !== null;
  const added = line.lhs === null && line.rhs !== null;
  if (removed) return "removed";
  if (added) return "added";
  const novelLeft = line.lhs !== null && line.lhs.segments.some((segment) => segment.novel);
  const novelRight = line.rhs !== null && line.rhs.segments.some((segment) => segment.novel);
  if (novelLeft && novelRight) return "modified";
  if (novelRight) return "added";
  if (novelLeft) return "removed";
  return "unchanged";
}

/** Every change region in row order, so navigation moves by change and not by line. */
export function structuralChangeBlocks(lines: readonly StructuralDiffLine[]): StructuralChangeBlock[] {
  const blocks: StructuralChangeBlock[] = [];
  lines.forEach((line, row) => {
    if (structuralRowChange(line) === "unchanged") return;
    const open = blocks.at(-1);
    if (open !== undefined && open.lastRow === row - 1) open.lastRow = row;
    else blocks.push({ firstRow: row, lastRow: row });
  });
  return blocks;
}

/** The block a row belongs to, for marking the region the reader is on. */
export function blockIndexByRow(blocks: readonly StructuralChangeBlock[]): ReadonlyMap<number, number> {
  const index = new Map<number, number>();
  blocks.forEach((block, position) => {
    for (let row = block.firstRow; row <= block.lastRow; row += 1) index.set(row, position);
  });
  return index;
}

/**
 * One revision's text, assembled from the rows it is present on.
 *
 * Highlighting a whole side in one pass keeps multi-line constructs (template
 * literals, block comments) coloured as the language sees them, which a
 * line-by-line pass cannot do. Rows the engine did not return are simply absent:
 * the structural response deliberately never carries the whole file.
 */
export function revisionSource(
  lines: readonly StructuralDiffLine[],
  revision: StructuralRevision,
): StructuralRevisionSource {
  const texts: string[] = [];
  const lineForRow = lines.map((line) => {
    const side = line[revision];
    if (side === null) return -1;
    texts.push(side.segments.map((segment) => segment.text).join(""));
    return texts.length - 1;
  });
  return { text: texts.join("\n"), lineForRow };
}

/**
 * Combine the engine's novel runs with the theme's syntax tokens.
 *
 * Both lists cover the same line in order, so the result is their intersection:
 * every boundary from either side splits a piece. Adjacent pieces that agree on
 * all three roles are coalesced so the row does not become one span per
 * character.
 */
export function paintSegments(
  segments: readonly StructuralDiffSegment[],
  tokens: readonly StudioCodeToken[] | undefined,
): StructuralPaintedSegment[] {
  const painted: StructuralPaintedSegment[] = [];
  if (tokens === undefined) {
    for (const segment of segments) append(painted, { text: segment.text, novel: segment.novel, highlight: segment.highlight });
    return painted;
  }
  let tokenIndex = 0;
  let consumed = 0;
  for (const segment of segments) {
    let offset = 0;
    while (offset < segment.text.length) {
      const token = tokens[tokenIndex];
      // The token stream ran short: the rest of the line stays plain rather than
      // borrowing a neighbour's colour.
      if (token === undefined) {
        append(painted, { text: segment.text.slice(offset), novel: segment.novel, highlight: segment.highlight });
        break;
      }
      const available = token.content.length - consumed;
      if (available <= 0) {
        tokenIndex += 1;
        consumed = 0;
        continue;
      }
      const take = Math.min(available, segment.text.length - offset);
      append(painted, {
        text: segment.text.slice(offset, offset + take),
        novel: segment.novel,
        highlight: segment.highlight,
        color: token.color,
        fontStyle: token.fontStyle,
      });
      offset += take;
      consumed += take;
    }
  }
  return painted;
}

function append(painted: StructuralPaintedSegment[], piece: StructuralPaintedSegment): void {
  if (piece.text === "") return;
  const previous = painted.at(-1);
  if (previous !== undefined
    && previous.novel === piece.novel
    && previous.highlight === piece.highlight
    && previous.color === piece.color
    && previous.fontStyle === piece.fontStyle) {
    previous.text += piece.text;
    return;
  }
  painted.push({ ...piece });
}
