import { readFileSync } from "node:fs";

import { analyzeCanvasModuleBoundaries } from "./canvas-module-boundaries.mjs";
import { transformCanvasSource } from "./canvas-preview/transform.mjs";
import { validateTaskLoopCanvasSplit } from "./task-loop-report.mjs";

function check(id, errors = [], warnings = [], summary = {}) {
  return { id, status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass", errors, warnings, summary };
}

function parseJson(filePath, label, errors) {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    errors.push(`${label} is not readable JSON: ${error.message}`);
    return null;
  }
}

export async function validateCursorCanvasArtifacts({ canvasPath, findingsPath, canvasDataPath }) {
  const checks = [];
  let source = "";
  const readErrors = [];
  try { source = readFileSync(canvasPath, "utf8"); } catch (error) { readErrors.push(`report.canvas.tsx is not readable: ${error.message}`); }
  const findings = parseJson(findingsPath, "findings.json", readErrors);
  const canvas = parseJson(canvasDataPath, "canvas.json", readErrors);
  checks.push(check("cursor-canvas-inputs", readErrors, [], {
    canvasPath,
    findingsPath,
    canvasDataPath,
  }));

  if (readErrors.length === 0) {
    const splitErrors = validateTaskLoopCanvasSplit(findings, canvas);
    checks.push(check("cursor-canvas-data", splitErrors, [], {
      findingCount: Array.isArray(findings?.findings) ? findings.findings.length : 0,
      contextUsageStatus: canvas?.summary?.contextUsage?.status ?? "unobserved",
    }));

    const boundaries = analyzeCanvasModuleBoundaries(source);
    const allowed = new Set(["cursor/canvas"]);
    const boundaryErrors = [
      ...(boundaries.syntaxError ? ["report.canvas.tsx has invalid module syntax"] : []),
      ...(boundaries.dynamicImport ? ["report.canvas.tsx must not use dynamic imports"] : []),
      ...boundaries.staticSources.filter((specifier) => !allowed.has(specifier))
        .map((specifier) => `report.canvas.tsx imports unsupported module: ${specifier}`),
      ...(!boundaries.staticSources.includes("cursor/canvas") ? ["report.canvas.tsx must import cursor/canvas"] : []),
      ...(source.includes("__BETTER_HARNESS_REPORT__") ? ["report.canvas.tsx still contains the data placeholder"] : []),
      ...(source.includes("qoder/canvas") ? ["Cursor Canvas must not import qoder/canvas"] : []),
    ];
    checks.push(check("cursor-canvas-boundaries", boundaryErrors, [], {
      imports: boundaries.staticSources,
    }));

    const requiredPatterns = [
      ["complete report header", /BETTER HARNESS · AGENT WORK LOOP/u],
      ["Fluency section", /function FluencyDimensions/u],
      ["project usage section", /function ProjectUsage/u],
      ["AI Agent Practice section", /function AgentPractice/u],
      ["Context Window section", /function ContextWindow/u],
      ["findings section", /function Findings/u],
      ["evidence section", /function EvidenceAndMethodology/u],
      ["newComposerChat action", /type:\s*["']newComposerChat["']/u],
      ["openFile action", /type:\s*["']openFile["']/u],
      ["openAgent action", /type:\s*["']openAgent["']/u],
      ["UsageBar", /<UsageBar\b/u],
    ];
    const contentErrors = requiredPatterns
      .filter(([, pattern]) => !pattern.test(source))
      .map(([label]) => `report.canvas.tsx is missing ${label}`);
    checks.push(check("cursor-canvas-content", contentErrors, [], {
      sectionCount: requiredPatterns.filter(([, pattern]) => pattern.test(source)).length,
      requiredSectionCount: requiredPatterns.length,
    }));

    const transformErrors = [];
    let bytes = 0;
    try {
      const transformed = transformCanvasSource(source, {
        sourcefile: "report.canvas.tsx",
        sourcePath: canvasPath,
      });
      bytes = Buffer.byteLength(transformed.code);
    } catch (error) {
      transformErrors.push(`Cursor Canvas TSX transform failed: ${error.message}`);
    }
    checks.push(check("cursor-canvas-transform", transformErrors, [], { transformedBytes: bytes }));
  }

  const errors = checks.flatMap((entry) => entry.errors.map((error) => `${entry.id}: ${error}`));
  const warnings = checks.flatMap((entry) => entry.warnings.map((warning) => `${entry.id}: ${warning}`));
  return {
    status: errors.length > 0 ? "fail" : warnings.length > 0 ? "warn" : "pass",
    checks,
    errors,
    warnings,
  };
}
