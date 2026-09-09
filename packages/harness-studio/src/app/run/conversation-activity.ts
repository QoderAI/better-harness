import type { TimelineItem } from './run-store.js';
import { observedToolPaths, projectAcpTool, type AcpTool } from './acp-tool-projection.js';

export type ConversationBlock = { kind: 'message'; key: string; item: TimelineItem }
  | { kind: 'activity'; key: string; items: TimelineItem[] };

/** Group only adjacent activity; prose and user messages are hard boundaries. */
export function conversationBlocks(items: readonly TimelineItem[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [];
  for (const item of items) {
    const key = `${item.kind}:${item.id}`;
    if (item.kind === 'message' && item.role !== 'thought') blocks.push({ kind: 'message', key, item });
    else {
      const last = blocks.at(-1);
      if (last?.kind === 'activity') last.items.push(item);
      else blocks.push({ kind: 'activity', key, items: [item] });
    }
  }
  return blocks;
}

export function activitySummary(items: readonly TimelineItem[], tools: ReadonlyMap<string, AcpTool>) {
  const counts = { thought: 0, read: 0, edit: 0, execute: 0, search: 0, other: 0 };
  const statuses = { running: 0, failed: 0, interrupted: 0, unavailable: 0 };
  const paths = new Set<string>();
  for (const item of items) {
    if (item.kind === 'message') {
      counts.thought++;
      if (!item.complete) statuses.running++;
      continue;
    }
    const tool = tools.get(item.id);
    const kind = tool?.kind;
    counts[kind === 'read' || kind === 'edit' || kind === 'execute' || kind === 'search' ? kind : 'other']++;
    for (const path of observedToolPaths(tool)) paths.add(path);
    const projected = projectAcpTool(item, tool);
    if (projected.kind !== 'tool-call') continue;
    if (projected.status === 'running' || projected.status === 'preparing') statuses.running++;
    else if (projected.status === 'failed') statuses.failed++;
    else if (projected.status === 'interrupted') statuses.interrupted++;
    else if (projected.status === 'result-unavailable') statuses.unavailable++;
  }
  return { counts, statuses, paths: [...paths] };
}
