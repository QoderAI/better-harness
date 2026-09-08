import { createHash } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseAcpConversationSnapshot } from "@qoder-ai/harness/exec";
import { parseHarnessRunStreamEventV1 } from "@qoder-ai/harness/protocol";
import type { AcpConversationSnapshot, HarnessRunEvent } from "@qoder-ai/harness/exec";
export interface AcpConversationRecord {
  version: 1;
  agentId?: string;
  cwd?: string;
  runId: string;
  updatedAt: string;
  snapshot: AcpConversationSnapshot;
  events: Array<{ event: HarnessRunEvent; observedAt: string }>;
  truncated: boolean;
}
function location(directory: string, id: string): string { return join(directory, "conversations", `${createHash("sha256").update(id).digest("hex")}.json`); }
export async function saveAcpConversation(directory: string, record: AcpConversationRecord): Promise<void> {
  await mkdir(join(directory, "conversations"), { recursive: true });
  const destination = location(directory, record.runId);
  const temporary = `${destination}.tmp`;
  await writeFile(temporary, JSON.stringify(record), "utf8");
  await rename(temporary, destination);
}
export async function readAcpConversation(directory: string, id: string): Promise<AcpConversationRecord> {
  const data = JSON.parse(await readFile(location(directory, id), "utf8"));
  if (data.version !== 1 || data.runId !== id || !Array.isArray(data.events)) throw new Error("Invalid conversation record.");
  parseAcpConversationSnapshot(data.snapshot);
  if (typeof data.truncated !== "boolean" || !Number.isFinite(Date.parse(data.updatedAt))) throw new Error("Invalid conversation metadata.");
  for (const [index, item] of data.events.entries()) {
    if (!Number.isFinite(Date.parse(item.observedAt))) throw new Error("Invalid conversation observation time.");
    parseHarnessRunStreamEventV1({ kind: "HarnessRunStreamEventV1", runId: id, threadId: id, sequence: index + 1, event: item.event });
  }
  return data;
}

export async function listAcpConversations(directory: string): Promise<Array<{ runId: string; updatedAt: string; prompt: string; turnCount: number; agentId?: string; canRecover: boolean }>> {
  const { readdir } = await import("node:fs/promises");
  const files = await readdir(join(directory, "conversations")).catch(() => [] as string[]);
  const records = await Promise.all(files.filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(async name => {
    try {
      const record = JSON.parse(await readFile(join(directory, "conversations", name), "utf8")) as AcpConversationRecord;
      if (record.version !== 1 || typeof record.runId !== "string" || typeof record.updatedAt !== "string" || !Array.isArray(record.snapshot?.turns)) return [];
      return [{ canRecover: record.snapshot.capabilities?.recovery !== undefined, agentId: record.agentId, runId: record.runId, updatedAt: record.updatedAt, prompt: record.snapshot.turns[0]?.content.filter(block => block.type === "text").map(block => block.text).join("\n").slice(0, 200) ?? "", turnCount: record.snapshot.turns.length }];
    } catch { return []; }
  }));
  return records.flat().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 100);
}
