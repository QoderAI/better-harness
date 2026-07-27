import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const QODER_CANVAS_FINDINGS_FILE = "findings.json";
export const QODER_CANVAS_DATA_FILE = "canvas.json";
export const QODER_CANVAS_FILE = "report.canvas.tsx";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const QODER_CANVAS_TEMPLATE_FILE = path.resolve(__dirname, "../../../templates/canvas/better-harness-insights.canvas.tsx");

export function renderCanvasTsx() {
  return readFileSync(QODER_CANVAS_TEMPLATE_FILE, "utf8");
}

export function renderQoderCanvas() {
  return {
    [QODER_CANVAS_FILE]: renderCanvasTsx(),
  };
}
