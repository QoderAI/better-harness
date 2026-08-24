import { describe, expect, it } from "vitest";
import { highlightStudioCode } from "../src/app/code-highlight.js";

describe("Studio syntax highlighting", () => {
  it("loads one grammar on demand without changing the source text", async () => {
    const source = '{\n  "ok": true\n}';
    const lines = await highlightStudioCode(source, "result.json");
    expect(lines).toBeDefined();
    expect(lines!.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(source);
    expect(lines!.flat().some((token) => token.color !== undefined)).toBe(true);
  });

  it("preserves common repository source across light and dark token themes", async () => {
    const source = "def render(value: str):\n    return f'Hello {value}'";
    const light = await highlightStudioCode(source, "src/render.py", "light");
    const dark = await highlightStudioCode(source, "src/render.py", "dark");
    const reconstruct = (lines: NonNullable<typeof light>): string => lines
      .map((line) => line.map((token) => token.content).join(""))
      .join("\n");

    expect(light).toBeDefined();
    expect(dark).toBeDefined();
    expect(reconstruct(light!)).toBe(source);
    expect(reconstruct(dark!)).toBe(source);
    expect(new Set(light!.flat().map((token) => token.color))).not.toEqual(new Set(dark!.flat().map((token) => token.color)));
  });

  it("keeps unknown sources as plain text", async () => {
    await expect(highlightStudioCode("plain output", "terminal.txt")).resolves.toBeUndefined();
  });

  it("highlights a large stylesheet without changing its text", async () => {
    const source = Array.from({ length: 2_000 }, (_, index) => `.row-${index} { color: var(--color-text); }`).join("\n");
    const lines = await highlightStudioCode(source, "workbench.css", "dark");
    expect(lines).toBeDefined();
    expect(lines!.map((line) => line.map((token) => token.content).join("")).join("\n")).toBe(source);
    expect(lines!.flat().some((token) => token.color !== undefined)).toBe(true);
  });
});
