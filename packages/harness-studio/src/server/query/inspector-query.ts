import { readFile } from "node:fs/promises";

const INSPECTOR_DATA_PATTERN = /<script\b(?=[^>]*\bid=["']inspector-data["'])(?=[^>]*\btype=["']application\/json["'])[^>]*>([\s\S]*?)<\/script>/iu;

/** Reads a self-contained Harness Inspector HTML report as raw text. */
export async function loadInspectorReport(reportPath: string): Promise<string> {
  return readFile(reportPath, "utf8");
}

/** Extracts and validates the privacy-filtered Inspector report JSON embedded in the HTML report. */
export function extractInspectorReportJson(html: string): string {
  const match = html.match(INSPECTOR_DATA_PATTERN);
  if (match?.[1] === undefined) {
    throw new Error("Inspector report does not contain embedded workbench data.");
  }
  const parsed = JSON.parse(match[1]);
  if (parsed === null || typeof parsed !== "object" || (parsed as { kind?: unknown }).kind !== "HarnessInspectorReportV1") {
    throw new Error("Inspector workbench data is not a HarnessInspectorReportV1 report.");
  }
  return JSON.stringify(parsed);
}

/** Reads the structured Inspector report JSON from a self-contained HTML report. */
export async function loadInspectorReportJson(reportPath: string): Promise<string> {
  return extractInspectorReportJson(await loadInspectorReport(reportPath));
}
