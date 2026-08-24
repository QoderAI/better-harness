import { describe, expect, it } from "vitest";
import { parseStudioPatchFiles, studioPatchCacheKey } from "../src/app/StudioDiff.js";

describe("Artifact Diff rendering model", () => {
  it("retains every file and hunk from a multi-file patch", () => {
    const patch = [
      "diff --git a/src/first.ts b/src/first.ts",
      "--- a/src/first.ts",
      "+++ b/src/first.ts",
      "@@ -1 +1 @@",
      "-export const first = 1;",
      "+export const first = 2;",
      "diff --git a/docs/guide.md b/docs/guide.md",
      "--- a/docs/guide.md",
      "+++ b/docs/guide.md",
      "@@ -1 +1,2 @@",
      " # Guide",
      "+Complete diff rendering.",
      "",
    ].join("\n");

    const files = parseStudioPatchFiles(patch);
    expect(files.map((file) => file.name)).toEqual(["src/first.ts", "docs/guide.md"]);
    expect(files.map((file) => file.hunks.length)).toEqual([1, 1]);
    expect(files[0]!.additionLines.join("")).toContain("export const first = 2;");
    expect(files[1]!.additionLines.join("")).toContain("Complete diff rendering.");
  });

  it("gives equal-length patch revisions distinct highlight identities", () => {
    const first = "@@ -1 +1 @@\n-const n = 1;\n+const n = 2;\n";
    const second = "@@ -1 +1 @@\n-const n = 3;\n+const n = 4;\n";
    expect(first).toHaveLength(second.length);
    expect(studioPatchCacheKey(first)).not.toBe(studioPatchCacheKey(second));
  });
});
