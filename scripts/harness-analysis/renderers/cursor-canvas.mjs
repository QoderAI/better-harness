import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const CURSOR_CANVAS_FINDINGS_FILE = "findings.json";
export const CURSOR_CANVAS_DATA_FILE = "canvas.json";
export const CURSOR_CANVAS_FILE = "report.canvas.tsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CURSOR_CANVAS_TEMPLATE_FILE = path.resolve(__dirname, "../../../templates/canvas/better-harness-cursor.canvas.tsx");
const DATA_PLACEHOLDER = "/*__BETTER_HARNESS_REPORT__*/ null";

export function renderCursorCanvasTsx(reportData) {
  const template = readFileSync(CURSOR_CANVAS_TEMPLATE_FILE, "utf8");
  if (!template.includes(DATA_PLACEHOLDER)) {
    throw Object.assign(new Error("Cursor Canvas template is missing the report-data placeholder"), {
      code: "INVALID_CURSOR_CANVAS_TEMPLATE",
    });
  }
  const embedded = {
    summary: reportData.summary,
    findings: reportData.findings,
    target: reportData.target,
  };
  return template.replace(DATA_PLACEHOLDER, JSON.stringify(embedded));
}

export function renderCursorCanvas(reportData) {
  return {
    [CURSOR_CANVAS_FILE]: renderCursorCanvasTsx(reportData),
  };
}
