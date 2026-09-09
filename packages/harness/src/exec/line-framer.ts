/**
 * Byte-exact newline framing over a byte stream.
 *
 * Framing on bytes rather than on a decoded string is the whole point. A decoded
 * string counts UTF-16 units, so a byte budget checked against `.length` admits
 * roughly three times its stated size for CJK content — a mistake made
 * independently in two clients before this existed. `\n` never occurs inside a
 * multi-byte UTF-8 sequence, so splitting on bytes and decoding whole lines is
 * exact for any input.
 *
 * Line policy stays with the caller: this yields every complete line, including
 * empty ones, because how tolerant a protocol is of blank frames is the
 * protocol's decision rather than the framing layer's.
 */
export interface FramedChunk {
  /** Complete lines with the newline stripped, decoded as UTF-8. */
  readonly lines: readonly string[];
  /** Retained bytes exceeded the budget; the caller should fail its process. */
  readonly overflow: boolean;
}

export interface LineFramer {
  /** Appends one chunk and returns whatever it completed. */
  push(chunk: Buffer): FramedChunk;
  /** Drops retained bytes, for reuse across a restarted process. */
  reset(): void;
}

const NEWLINE = 0x0a;
const EMPTY: FramedChunk = { lines: [], overflow: false };

export function createLineFramer(maxBytes: number): LineFramer {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new RangeError("A line framer needs a positive byte budget.");
  }
  let buffer = Buffer.alloc(0);
  return {
    push(chunk: Buffer): FramedChunk {
      buffer = buffer.length === 0 ? Buffer.from(chunk) : Buffer.concat([buffer, chunk]);
      // Checked before splitting, so a caller that streams frames faster than it
      // consumes them is bounded by the same budget as one oversized frame.
      if (buffer.length > maxBytes) {
        buffer = Buffer.alloc(0);
        return { lines: [], overflow: true };
      }
      let newline = buffer.indexOf(NEWLINE);
      if (newline === -1) return EMPTY;
      const lines: string[] = [];
      while (newline !== -1) {
        lines.push(buffer.subarray(0, newline).toString("utf8"));
        buffer = buffer.subarray(newline + 1);
        newline = buffer.indexOf(NEWLINE);
      }
      return { lines, overflow: false };
    },
    reset(): void {
      buffer = Buffer.alloc(0);
    },
  };
}
