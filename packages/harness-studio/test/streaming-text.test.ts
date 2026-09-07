import { describe, expect, it } from "vitest";
import { nextStreamingText } from "../src/app/run/streaming-text.js";

describe("streaming text reveal", () => {
  it("reveals about one twelfth of the current backlog per frame", () => {
    const target = "x".repeat(100);
    expect(nextStreamingText("", target)).toBe("x".repeat(8));
  });

  it("always advances by at least one Unicode code point", () => {
    expect(nextStreamingText("", "你好世界")).toBe("你");
    expect(nextStreamingText("", "😀done")).toBe("😀");
  });

  it("never cuts a UTF-16 surrogate pair", () => {
    let current = "";
    const target = "你好😀world";
    while (current !== target) {
      const next = nextStreamingText(current, target);
      expect(next.length).toBeGreaterThan(current.length);
      expect(() => new TextEncoder().encode(next)).not.toThrow();
      current = next;
    }
    expect(current).toBe(target);
  });

  it("flushes immediately when the message is complete", () => {
    expect(nextStreamingText("hello", "hello world", true)).toBe("hello world");
  });

  it("replaces immediately when the target is not an extension", () => {
    expect(nextStreamingText("old text", "replacement")).toBe("replacement");
  });

  it("does nothing when the target is already revealed", () => {
    expect(nextStreamingText("done", "done")).toBe("done");
  });
});
