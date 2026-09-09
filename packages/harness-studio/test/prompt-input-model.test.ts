import { describe, expect, it } from "vitest";
import { findPromptMatch, replacePromptMatch } from "../src/app/components/ai-elements/prompt-input-model.js";

describe("plain-text prompt completion", () => {
  it("matches commands at line start and mentions at whitespace boundaries", () => {
    expect(findPromptMatch("/rev", 4)).toEqual({ trigger: "/", query: "rev", start: 0, end: 4 });
    expect(findPromptMatch("Review\n/rev HEAD", 11)).toEqual({ trigger: "/", query: "rev", start: 7, end: 11 });
    expect(findPromptMatch("Inspect @src later", 12)).toEqual({ trigger: "@", query: "src", start: 8, end: 12 });
    for (const value of ["email@example.com", "https://example.com", "some /rev", "/review HEAD", "hello"]) expect(findPromptMatch(value, value.length)).toBeUndefined();
    expect(findPromptMatch("@src", 2, 4)).toBeUndefined();
  });
  it("replaces only the caret range, preserving preceding text and the suffix", () => {
    const value = "Inspect @sr later";
    expect(replacePromptMatch(value, findPromptMatch(value, 11)!, "@src/file.ts")).toEqual({ value: "Inspect @src/file.ts later", caret: 20 });
    expect(replacePromptMatch("/rev", findPromptMatch("/rev", 4)!, "/review")).toEqual({ value: "/review ", caret: 8 });
  });
  it("preserves Windows and UNC references as opaque text", () => {
    for (const path of [String.raw`C:\Project Files\readme.md`, String.raw`\\server\share\readme.md`, "/home/user/readme.md"]) {
      expect(replacePromptMatch("@", findPromptMatch("@", 1)!, `@${path}`).value).toBe(`@${path} `);
    }
  });
});
