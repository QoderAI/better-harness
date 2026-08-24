import { describe, expect, it } from "vitest";
import { buildDebuggerPatch, normalizePatchPath, studioCodeLanguage } from "../src/app/code-rendering-model.js";

describe("Studio code rendering model", () => {
  it("infers the bounded lazy grammar set across portable paths", () => {
    expect(studioCodeLanguage("src/App.tsx")).toBe("tsx");
    expect(studioCodeLanguage("C:\\repo\\script.mjs")).toBe("javascript");
    expect(studioCodeLanguage("Dockerfile")).toBe("dockerfile");
    expect(studioCodeLanguage("GNUmakefile")).toBe("make");
    expect(studioCodeLanguage("docs/guide.md")).toBe("markdown");
    expect(studioCodeLanguage(".github/workflows/test.yml")).toBe("yaml");
    expect(studioCodeLanguage("src/main.py")).toBe("python");
    expect(studioCodeLanguage("src/lib.rs")).toBe("rust");
    expect(studioCodeLanguage("trace.jsonl")).toBe("json");
    expect(studioCodeLanguage("shader.unknown")).toBeUndefined();
    expect(studioCodeLanguage("docs/architecture.mmd")).toBe("mermaid");
    expect(studioCodeLanguage("docs/architecture.mermaid")).toBe("mermaid");
  });

  it("builds a normalized Git patch for the dedicated diff renderer", () => {
    const patch = buildDebuggerPatch({
      path: ".\\src\\app.ts",
      beforeStart: 4,
      before: ["const oldValue = 1;"],
      afterStart: 4,
      after: ["const newValue = 2;"],
    });
    expect(normalizePatchPath(".\\src\\app.ts")).toBe("src/app.ts");
    expect(patch).toContain("diff --git a/src/app.ts b/src/app.ts");
    expect(patch).toContain("@@ -4,1 +4,1 @@");
    expect(patch).toContain("-const oldValue = 1;");
    expect(patch).toContain("+const newValue = 2;");
  });
});
