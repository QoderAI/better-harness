import { projectAcpTool, observedToolPaths } from './acp-tool-projection.js';
import { timelineItems, type HarnessRunState, type TimelineItem } from './run-store.js';
export interface CompareEvidenceLane { key: string; state: HarnessRunState }
export interface FileOperation {
  laneKey: string; toolId: string; title: string; kind?: string;
  status: Extract<TimelineItem, { kind: 'tool-call' }>['status'];
}
export interface ComparedFile { path: string; operations: FileOperation[] }

/** Native paths are opaque host evidence. Do not guess aliases or parse shell text. */
export function compareFileEvidence(lanes: readonly CompareEvidenceLane[]): ComparedFile[] {
  const files = new Map<string, ComparedFile>();
  for (const lane of lanes) for (const item of timelineItems(lane.state)) {
    const tool = lane.state.acp.tools.get(item.id);
    const projected = projectAcpTool(item, tool);
    if (projected.kind !== 'tool-call') continue;
    for (const path of observedToolPaths(tool)) {
      const file = files.get(path) ?? { path, operations: [] };
      file.operations.push({ laneKey: lane.key, toolId: item.id, title: projected.name, kind: tool?.kind, status: projected.status });
      files.set(path, file);
    }
  }
  return [...files.values()];
}

export function comparisonLaneStatus(state: HarnessRunState): string {
  if (state.status === 'error') return 'error';
  if (state.pendingPermissions.length) return 'permission';
  const conversation = state.conversation;
  if (conversation?.status === 'generating') return 'running';
  if (conversation?.status === 'cancelling') return 'cancelling';
  const last = conversation?.turns.at(-1);
  if (last?.error || last?.stopReason === 'error') return 'error';
  if (last?.stopReason === 'cancelled') return 'interrupted';
  if (last?.stopReason === 'end_turn') return 'completed';
  if (last?.stopReason) return 'stopped';
  if (conversation?.status === 'closed') return 'closed';
  if (state.status === 'running' && (state.connection || state.acp.prepared || conversation?.status === 'idle')) return 'ready';
  return state.status;
}
