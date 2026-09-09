import { recordValue, type AcpSessionState } from './acp-session-state.js';
import type { TimelineItem } from './run-store.js';
export type AcpTool = AcpSessionState['tools'] extends ReadonlyMap<string, infer T> ? T : never;

/** One projection for the transcript and cross-lane evidence; never infer success. */
export function projectAcpTool(item: TimelineItem, tool?: AcpTool): TimelineItem {
  if (item.kind !== 'tool-call' || !tool) return item;
  const stringify = (value: unknown): string => typeof value === 'string' ? value : JSON.stringify(value);
  return { ...item,
    ...(tool.title === undefined ? {} : { name: tool.title }),
    ...(tool.input === undefined ? {} : { argsText: stringify(tool.input) }),
    ...(tool.output === undefined ? {} : { resultText: stringify(tool.output) }),
    ...(tool.status === 'failed' ? { status: 'failed' }
      : tool.status === 'completed' ? { status: 'completed' } : {}),
  };
}

/** Explicit ACP file references, shared by tool headers, mentions and Compare. */
export function observedToolPaths(tool?: AcpTool): string[] {
  const paths = new Set(tool?.locations?.map(location => location.path) ?? []);
  if (tool?.kind === 'read' || tool?.kind === 'edit' || tool?.kind === 'delete') {
    const input = recordValue(tool.input);
    for (const field of ['path', 'file_path', 'filePath']) if (typeof input?.[field] === 'string') paths.add(input[field]);
  }
  return [...paths].filter(path => path.trim());
}
