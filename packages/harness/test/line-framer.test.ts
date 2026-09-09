import { describe, expect, it } from "vitest";
import { createLineFramer } from "../src/exec/line-framer.js";

describe("line framer", () => {
  it("measures the budget in bytes, not UTF-16 units", () => {
    // 4 CJK characters are 12 bytes but only 4 string units. A framer that
    // counted string length would admit this against a 10-byte budget.
    const framer = createLineFramer(10);
    expect(framer.push(Buffer.from("你好世界\n", "utf8")).overflow).toBe(true);

    const roomy = createLineFramer(16);
    expect(roomy.push(Buffer.from("你好世界\n", "utf8"))).toEqual({ lines: ["你好世界"], overflow: false });
  });

  it("reassembles a line split mid-character across chunks", () => {
    const framer = createLineFramer(64);
    const encoded = Buffer.from("你好\n", "utf8");
    // Cut inside the first character's 3-byte sequence.
    expect(framer.push(encoded.subarray(0, 2))).toEqual({ lines: [], overflow: false });
    expect(framer.push(encoded.subarray(2))).toEqual({ lines: ["你好"], overflow: false });
  });

  it("yields every complete line in one chunk and retains the partial tail", () => {
    const framer = createLineFramer(64);
    expect(framer.push(Buffer.from('{"a":1}\n{"b":2}\ntail', "utf8"))).toEqual({
      lines: ['{"a":1}', '{"b":2}'],
      overflow: false,
    });
    expect(framer.push(Buffer.from("-end\n", "utf8"))).toEqual({ lines: ["tail-end"], overflow: false });
  });

  it("keeps empty lines so the protocol decides how tolerant to be", () => {
    const framer = createLineFramer(64);
    expect(framer.push(Buffer.from("\n\na\n", "utf8")).lines).toEqual(["", "", "a"]);
  });

  it("bounds a caller that streams frames faster than it consumes them", () => {
    const framer = createLineFramer(8);
    expect(framer.push(Buffer.from("ab\ncd\n", "utf8")).lines).toEqual(["ab", "cd"]);
    // Retained bytes reset with each consumed line, so a steady stream is fine.
    expect(framer.push(Buffer.from("ef\ngh\n", "utf8")).lines).toEqual(["ef", "gh"]);
    // A single unterminated run past the budget is not.
    expect(framer.push(Buffer.from("123456789", "utf8")).overflow).toBe(true);
  });

  it("reset drops retained bytes for a restarted process", () => {
    const framer = createLineFramer(64);
    expect(framer.push(Buffer.from("partial", "utf8")).lines).toEqual([]);
    framer.reset();
    expect(framer.push(Buffer.from("fresh\n", "utf8")).lines).toEqual(["fresh"]);
  });

  it("refuses a budget that cannot bound anything", () => {
    expect(() => createLineFramer(0)).toThrow(RangeError);
    expect(() => createLineFramer(1.5)).toThrow(RangeError);
  });
});
