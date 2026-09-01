import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const RUN_ID_PATTERN = /^run_[A-Za-z0-9_-]+$/;
const TOOL_STATUSES = new Set(["preparing", "running", "completed", "failed", "result-unavailable", "interrupted"]);

export type SavedRunTimelineItem =
  | { kind: "message"; id: string; text: string; complete: boolean }
  | {
      kind: "tool-call";
      id: string;
      name: string;
      argsText: string;
      status: "preparing" | "running" | "completed" | "failed" | "result-unavailable" | "interrupted";
      resultText?: string;
      resultTruncated?: boolean;
      resultOriginalBytes?: number;
    };

/** One retained Debugger run: the browser-observed Harness evidence, frozen at run end. */
export interface SavedRunRecord {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error";
  runId?: string;
  threadId?: string;
  toolCallCount: number;
  warnings: string[];
  error?: string;
  result?: unknown;
  timeline: SavedRunTimelineItem[];
}

export interface SavedRunSummary {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error";
  toolCallCount: number;
}

/** Validates one complete retained record imported from a local Studio workspace. */
export function parseSavedRunRecord(value: unknown): SavedRunRecord {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Saved run record must be an object.");
  }
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !RUN_ID_PATTERN.test(record.id)) {
    throw new Error("Saved run id must be an opaque run_<token> id.");
  }
  if (typeof record.savedAt !== "string" || Number.isNaN(new Date(record.savedAt).valueOf())) {
    throw new Error("Saved run record requires an ISO savedAt timestamp.");
  }
  return {
    id: record.id,
    savedAt: new Date(record.savedAt).toISOString(),
    ...parseRunSnapshot(record),
  };
}

/** Validates a browser-submitted run snapshot into a persistable record body. */
export function parseRunSnapshot(value: unknown): Omit<SavedRunRecord, "id" | "savedAt"> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Run snapshot must be an object.");
  }
  const snapshot = value as Record<string, unknown>;
  const prompt = snapshot.prompt;
  if (typeof prompt !== "string" || prompt.trim().length === 0) throw new Error("Run snapshot requires a prompt.");
  const status = snapshot.status;
  if (status !== "finished" && status !== "error") throw new Error("Run snapshot status must be finished or error.");
  const warnings = Array.isArray(snapshot.warnings) ? snapshot.warnings.filter((entry): entry is string => typeof entry === "string") : [];
  const timelineInput = Array.isArray(snapshot.timeline) ? snapshot.timeline : [];
  const timeline = timelineInput.map(parseTimelineItem);
  return {
    prompt,
    status,
    ...(typeof snapshot.runId === "string" ? { runId: snapshot.runId } : {}),
    ...(typeof snapshot.threadId === "string" ? { threadId: snapshot.threadId } : {}),
    toolCallCount: timeline.filter((item) => item.kind === "tool-call").length,
    warnings,
    ...(typeof snapshot.error === "string" ? { error: snapshot.error } : {}),
    ...(snapshot.result !== undefined ? { result: snapshot.result } : {}),
    timeline,
  };
}

function parseTimelineItem(value: unknown): SavedRunTimelineItem {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Run timeline entries must be objects.");
  }
  const item = value as Record<string, unknown>;
  if (typeof item.id !== "string") throw new Error("Run timeline entries require a string id.");
  if (item.kind === "message") {
    return { kind: "message", id: item.id, text: typeof item.text === "string" ? item.text : "", complete: item.complete === true };
  }
  if (item.kind === "tool-call") {
    const status = typeof item.status === "string" && TOOL_STATUSES.has(item.status) ? item.status : "result-unavailable";
    return {
      kind: "tool-call",
      id: item.id,
      name: typeof item.name === "string" ? item.name : "unknown",
      argsText: typeof item.argsText === "string" ? item.argsText : "",
      status: status as Extract<SavedRunTimelineItem, { kind: "tool-call" }>["status"],
      ...(typeof item.resultText === "string" ? { resultText: item.resultText } : {}),
      ...(item.resultTruncated === true ? { resultTruncated: true } : {}),
      ...(typeof item.resultOriginalBytes === "number" ? { resultOriginalBytes: item.resultOriginalBytes } : {}),
    };
  }
  throw new Error("Run timeline entries must be messages or tool calls.");
}

/** Persists one validated run snapshot as a JSON file and returns its identity. */
export async function saveRunRecord(
  directory: string,
  snapshot: Omit<SavedRunRecord, "id" | "savedAt">,
): Promise<{ id: string; savedAt: string }> {
  const id = `run_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const savedAt = new Date().toISOString();
  const record: SavedRunRecord = { id, savedAt, ...snapshot };
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, `${id}.json`), `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { id, savedAt };
}

/** Lists saved run metadata newest-first, skipping unreadable files. */
export async function listRunRecords(directory: string): Promise<SavedRunSummary[]> {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch {
    return [];
  }
  const summaries: SavedRunSummary[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const record = JSON.parse(await readFile(join(directory, name), "utf8")) as SavedRunRecord;
      if (typeof record.id !== "string" || !RUN_ID_PATTERN.test(record.id)) continue;
      summaries.push({
        id: record.id,
        savedAt: typeof record.savedAt === "string" ? record.savedAt : "",
        prompt: typeof record.prompt === "string" ? record.prompt : "",
        status: record.status === "error" ? "error" : "finished",
        toolCallCount: typeof record.toolCallCount === "number" ? record.toolCallCount : 0,
      });
    } catch {
      // Malformed files stay on disk for inspection but never break the list.
    }
  }
  return summaries.sort((left, right) => right.savedAt.localeCompare(left.savedAt));
}

/** Reads one saved run by validated opaque id; the id never becomes a path segment unchecked. */
export async function readRunRecord(directory: string, id: string): Promise<SavedRunRecord> {
  if (!RUN_ID_PATTERN.test(id)) throw new Error("Run id must be an opaque run_<token> id.");
  return JSON.parse(await readFile(join(directory, `${id}.json`), "utf8")) as SavedRunRecord;
}
