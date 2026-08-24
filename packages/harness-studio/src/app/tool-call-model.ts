export interface ToolPayloadView {
  formatted: string;
  summary: string;
  structured: boolean;
}

/** Turn streamed JSON arguments or retained tool output into a compact card model. */
export function describeToolPayload(source: string, emptyLabel: string): ToolPayloadView {
  const trimmed = source.trim();
  if (trimmed.length === 0) {
    return { formatted: emptyLabel, summary: emptyLabel, structured: false };
  }
  try {
    const value = JSON.parse(trimmed) as unknown;
    return {
      formatted: JSON.stringify(value, null, 2),
      summary: summarizeValue(value),
      structured: true,
    };
  } catch {
    return {
      formatted: source,
      summary: singleLine(source, 72),
      structured: false,
    };
  }
}

function summarizeValue(value: unknown): string {
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["path", "file_path", "command", "query", "url"] as const) {
      if (typeof record[key] === "string" && record[key].length > 0) {
        return singleLine(record[key], 72);
      }
    }
    const keys = Object.keys(record);
    return `${keys.length} parameter${keys.length === 1 ? "" : "s"}`;
  }
  return singleLine(String(value), 72);
}

function singleLine(value: string, limit: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
}
