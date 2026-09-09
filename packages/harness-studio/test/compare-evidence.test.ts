import { fitComparePaneSizes } from "../src/app/run/compare-pane-sizes.js";
import { describe, it, expect } from 'vitest';
import { compareFileEvidence, comparisonLaneStatus } from '../src/app/run/compare-evidence.js';
import { initialRunState, type HarnessRunState } from '../src/app/run/run-store.js';

function state(paths: string[], status: 'completed' | 'failed' | 'interrupted' | 'result-unavailable' = 'completed'): HarnessRunState {
  const value = initialRunState();
  paths.forEach((path, index) => {
    const id = `read-${index}`;
    value.timelineKeys.push(id);
    value.timelineByKey.set(id, { kind: 'tool-call', id, name: 'Read file', argsText: '', status });
    value.acp.tools = new Map(value.acp.tools).set(id, { kind: 'read', input: { path }, locations: [{ path }] });
  });
  return value;
}
describe('Compare file evidence', () => {
  it('associates exact full paths across lanes, retaining repeated attempts and independent results', () => {
    const rows = compareFileEvidence([{ key: 'a', state: state(['/a/readme', '/a/readme']) }, { key: 'b', state: state(['/a/readme'], 'failed') }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.operations.map(call => [call.laneKey, call.status])).toEqual([['a', 'completed'], ['a', 'completed'], ['b', 'failed']]);
  });
  it('preserves Windows drives, UNC roots, POSIX paths and distinct aliases without basename matching', () => {
    const paths = ['C:\\work\\readme', 'D:\\work\\readme', '\\\\server\\share\\readme', '/a/readme', '/b/readme', 'readme', 'README'];
    expect(compareFileEvidence([{ key: 'a', state: state(paths) }]).map(row => row.path)).toEqual(paths);
  });
  it('does not infer a file or success from arbitrary input or command text', () => {
    const value = state(['/a']);
    value.acp.tools = new Map([['read-0', { kind: 'execute', input: { path: '/wrong', command: 'cat /secret' } }]]);
    expect(compareFileEvidence([{ key: 'a', state: value }])).toEqual([]);
  });
  it('uses the same explicit completion projection as the transcript and preserves missing results', () => {
    const value = state(['/a', '/b', '/c'], 'result-unavailable');
    value.acp.tools = new Map(value.acp.tools).set('read-0', { kind: 'read', input: { path: '/a' }, status: 'failed' });
    expect(compareFileEvidence([{ key: 'a', state: value }]).map(row => row.operations[0]!.status)).toEqual(['failed', 'result-unavailable', 'result-unavailable']);
    expect(compareFileEvidence([{ key: 'a', state: state(['/a'], 'interrupted') }])[0]!.operations[0]!.status).toBe('interrupted');
  });
});
describe('Compare lane outcome', () => {
  const conversation = (stopReason?: string): HarnessRunState => ({ ...initialRunState(), status: 'running', conversation: { sessionId: 'a', status: 'idle', capabilities: {}, queue: [], queuePaused: false, revision: 1, turns: stopReason ? [{ id: '1', content: [], turnId: '1', startedAt: '', stopReason }] : [] } });
  it('separates an idle connected session from completed, failed and interrupted turns', () => {
    expect(comparisonLaneStatus(conversation())).toBe('ready');
    expect(comparisonLaneStatus(conversation('end_turn'))).toBe('completed');
    expect(comparisonLaneStatus(conversation('error'))).toBe('error');
    expect(comparisonLaneStatus(conversation('cancelled'))).toBe('interrupted');
    expect(comparisonLaneStatus(conversation('max_tokens'))).toBe('stopped');
  });
  it('shows a current generation and transport failure ahead of past success', () => {
    const value = conversation('end_turn'); value.conversation!.status = 'generating';
    expect(comparisonLaneStatus(value)).toBe('running');
    expect(comparisonLaneStatus({ ...value, status: 'error' })).toBe('error');
  });
});

describe('Compare pane fitting', () => {
  it('keeps adjacent pane widths bounded when a saved split meets a smaller viewport', () => {
    expect(fitComparePaneSizes([300, 900], 700)).toEqual([220, 480]);
    expect(fitComparePaneSizes([1, 1, 1], 900)).toEqual([300, 300, 300]);
    const fitted = fitComparePaneSizes([100, 500, 600, 220], 1000);
    expect(fitted.every(size => size >= 220)).toBe(true);
    expect(fitted.reduce((sum, size) => sum + size, 0)).toBeCloseTo(1000);
    expect(fitComparePaneSizes([1, 3], 300)).toEqual([150, 150]);
  });
});
