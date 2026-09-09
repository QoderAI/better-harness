import { describe, expect, it } from 'vitest';
import { activitySummary, conversationBlocks } from '../src/app/run/conversation-activity.js';
import type { TimelineItem } from '../src/app/run/run-store.js';
const message = (id: string, role?: 'thought' | 'user'): TimelineItem => ({ kind: 'message', id, role, text: id, complete: true });
const tool = (id: string, status: 'completed' | 'running' | 'failed' | 'interrupted' | 'result-unavailable' = 'completed'): TimelineItem => ({ kind: 'tool-call', id, name: id, status, argsText: '' });

describe('conversation activity', () => {
  it('preserves chronology and stops grouping at every user or assistant message', () => {
    const items = [message('u', 'user'), message('a', 'thought'), tool('b'), tool('c'), message('d'), tool('e'), message('f', 'user')];
    const blocks = conversationBlocks(items);
    expect(blocks.map(block => block.kind)).toEqual(['message', 'activity', 'message', 'activity', 'message']);
    expect(blocks.flatMap(block => block.kind === 'activity' ? block.items : [block.item])).toEqual(items);
    const appended = conversationBlocks([...items.slice(0, 4), tool('new')]);
    expect(appended[1].key).toBe(blocks[1].key);
    expect(conversationBlocks([])).toEqual([]);
  });
  it('summarizes observed kinds and exact paths without inferring a shell read or successful outcome', () => {
    const items = [message('thought', 'thought'), tool('a', 'running'), tool('b'), tool('c', 'interrupted'), tool('d', 'result-unavailable'), tool('e', 'running')];
    const summary = activitySummary(items, new Map([
      ['a', { id: 'a', kind: 'read', status: 'failed', locations: [{ path: 'C:\\src\\same.ts' }] }],
      ['b', { id: 'b', kind: 'execute', title: 'cat same.ts', status: 'completed' }],
      ['c', { id: 'c', kind: 'edit', input: { path: 'C:\\src\\same.ts' } }],
    ]));
    expect(summary.counts).toEqual({ thought: 1, read: 1, edit: 1, execute: 1, search: 0, other: 2 });
    expect(summary.statuses).toEqual({ running: 1, failed: 1, interrupted: 1, unavailable: 1 });
    expect(summary.paths).toEqual(['C:\\src\\same.ts']);
  });
  it('does not complete an active thought or merge duplicate tool names into one call', () => {
    const thought = { ...message('t', 'thought'), complete: false } as TimelineItem;
    expect(activitySummary([thought, tool('1'), tool('2')], new Map()).statuses.running).toBe(1);
    expect(activitySummary([tool('1'), tool('2')], new Map()).counts.other).toBe(2);
  });
});
