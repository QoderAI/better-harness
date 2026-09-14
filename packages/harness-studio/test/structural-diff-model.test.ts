import { describe, expect, it } from "vitest";
import type { StructuralDiffLine, StructuralDiffSegment } from "../src/contracts/structural-diff.js";
import type { StudioCodeToken } from "../src/app/code/code-highlight.js";
import { highlightStudioCode } from "../src/app/code/code-highlight.js";
import {
  blockIndexByRow,
  paintSegments,
  revisionSource,
  structuralChangeBlocks,
  structuralRowChange,
} from "../src/app/code/structural-diff-model.js";

function segment(text: string, novel = false, highlight = "normal"): StructuralDiffSegment {
  return { text, novel, highlight };
}

function side(lineNumber: number, ...segments: StructuralDiffSegment[]) {
  return { lineNumber, segments };
}

function row(lhs: StructuralDiffLine["lhs"], rhs: StructuralDiffLine["rhs"]): StructuralDiffLine {
  return { lhs, rhs };
}

describe("structural row change", () => {
  it("reads a line present on one side only as that side's polarity", () => {
    expect(structuralRowChange(row(null, side(4, segment("added()", true))))).toBe("added");
    expect(structuralRowChange(row(side(4, segment("gone()", true)), null))).toBe("removed");
    // Even with nothing flagged inside it, the missing line is itself the change.
    expect(structuralRowChange(row(null, side(4, segment("added()"))))).toBe("added");
  });

  it("reads a flagged run as the polarity of the side that carries it", () => {
    expect(structuralRowChange(row(side(1, segment("a")), side(1, segment("a"), segment("b", true))))).toBe("added");
    expect(structuralRowChange(row(side(1, segment("a"), segment("b", true)), side(1, segment("a"))))).toBe("removed");
    expect(structuralRowChange(row(
      side(1, segment("x", true)),
      side(1, segment("y", true)),
    ))).toBe("modified");
  });

  it("reads an untouched pair as unchanged", () => {
    expect(structuralRowChange(row(side(9, segment("}")), side(9, segment("}"))))).toBe("unchanged");
  });
});

describe("structural change regions", () => {
  const lines = [
    row(side(1, segment("a")), side(1, segment("a"))),
    row(side(2, segment("b", true)), side(2, segment("B", true))),
    row(null, side(3, segment("new", true))),
    row(side(3, segment("c")), side(4, segment("c"))),
    row(side(4, segment("d")), side(5, segment("d"))),
    row(side(5, segment("e", true)), null),
  ];

  it("groups consecutive changed rows into one region", () => {
    expect(structuralChangeBlocks(lines)).toEqual([
      { firstRow: 1, lastRow: 2 },
      { firstRow: 5, lastRow: 5 },
    ]);
  });

  it("reports no region for a file the engine left alone", () => {
    expect(structuralChangeBlocks([lines[0]!, lines[3]!])).toEqual([]);
  });

  it("maps every row of a region back to its region", () => {
    const index = blockIndexByRow(structuralChangeBlocks(lines));
    expect([...index.entries()].sort((a, b) => a[0] - b[0])).toEqual([[1, 0], [2, 0], [5, 1]]);
    expect(index.get(0)).toBeUndefined();
    expect(index.get(3)).toBeUndefined();
  });
});

describe("revision source", () => {
  const lines = [
    row(side(1, segment("const a = 1;")), side(1, segment("const a = 1;"))),
    row(side(2, segment("drop();")), null),
    row(null, side(2, segment("add();", true))),
  ];

  it("assembles only the lines the revision actually has", () => {
    expect(revisionSource(lines, "lhs")).toEqual({
      text: "const a = 1;\ndrop();",
      lineForRow: [0, 1, -1],
    });
    expect(revisionSource(lines, "rhs")).toEqual({
      text: "const a = 1;\nadd();",
      lineForRow: [0, -1, 1],
    });
  });

  it("rebuilds each line from its own segments, in order", () => {
    const split = [row(
      null,
      side(1, segment("  return <div "), segment("id={id} ", true), segment("/>;")),
    )];
    expect(revisionSource(split, "rhs").text).toBe("  return <div id={id} />;");
  });
});

describe("painting flagged runs with syntax tokens", () => {
  const tokens = (...pieces: [string, string?][]): StudioCodeToken[] => pieces
    .map(([content, color]) => (color === undefined ? { content } : { content, color }));

  it("keeps the line's text and its flags when there are no tokens", () => {
    const segments = [segment("const "), segment("added", true), segment(" = 1;")];
    const painted = paintSegments(segments, undefined);
    expect(painted.map((piece) => piece.text).join("")).toBe("const added = 1;");
    expect(painted.filter((piece) => piece.novel).map((piece) => piece.text)).toEqual(["added"]);
    expect(painted.every((piece) => piece.color === undefined)).toBe(true);
  });

  it("splits a token that a flagged run starts inside", () => {
    // One token covers `alpha`, but only `pha` is flagged.
    const painted = paintSegments(
      [segment("al"), segment("pha", true)],
      tokens(["alpha", "#111111"]),
    );
    expect(painted).toEqual([
      { text: "al", novel: false, highlight: "normal", color: "#111111", fontStyle: undefined },
      { text: "pha", novel: true, highlight: "normal", color: "#111111", fontStyle: undefined },
    ]);
  });

  it("splits a flagged run that spans several tokens", () => {
    const painted = paintSegments(
      [segment("return ", false), segment("value;", true)],
      tokens(["return", "#a00000"], [" ", undefined], ["value", "#00a000"], [";", "#333333"]),
    );
    expect(painted.map((piece) => [piece.text, piece.novel, piece.color])).toEqual([
      ["return", false, "#a00000"],
      [" ", false, undefined],
      ["value", true, "#00a000"],
      [";", true, "#333333"],
    ]);
  });

  it("coalesces neighbours that agree on every role", () => {
    const painted = paintSegments(
      [segment("ab"), segment("cd")],
      tokens(["a", "#111111"], ["b", "#111111"], ["cd", "#111111"]),
    );
    expect(painted).toHaveLength(1);
    expect(painted[0]!.text).toBe("abcd");
  });

  it("leaves the tail plain when the token stream runs short", () => {
    const painted = paintSegments([segment("abcdef")], tokens(["abc", "#111111"]));
    expect(painted.map((piece) => [piece.text, piece.color])).toEqual([
      ["abc", "#111111"],
      ["def", undefined],
    ]);
  });

  it("paints a real highlighted line without changing one character of it", async () => {
    const source = "  const label = `name: ${value}`; // 说明";
    const lines = await highlightStudioCode(source, "src/view.ts", "light");
    expect(lines).toBeDefined();
    const segments = [
      segment("  const label = `name: ${"),
      segment("value", true),
      segment("}`; // 说明"),
    ];
    const painted = paintSegments(segments, lines![0]);
    expect(painted.map((piece) => piece.text).join("")).toBe(source);
    expect(painted.filter((piece) => piece.novel).map((piece) => piece.text).join("")).toBe("value");
    // The unchanged code around the flagged run is what was previously colourless.
    const coloured = new Set(painted.filter((piece) => !piece.novel && piece.color !== undefined).map((piece) => piece.color));
    expect(coloured.size).toBeGreaterThan(1);
  });
});
