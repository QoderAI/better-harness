/** Native timing contract. Null durations mean unrecorded, never zero. */
export interface TimingEvidence { source: string; line: number; eventType: string; timestampMs: number }
export interface TimingSpan {
  id: string; kind: string; label: string; startMs: number | null; endMs: number | null; durationMs: number | null;
  basis: string; status: string; turnId: string | null; parentId: string | null; relationship: string | null;
  evidence: TimingEvidence[]; facts: Record<string, string | number | boolean | null>;
}
export interface TimingTurn {
  id: string; label: string; startMs: number; endMs: number | null; durationMs: number | null;
  isSubagent: boolean; parentSpanId: string | null; evidence: TimingEvidence[];
}
export interface TimingCoverage {
  files: number; events: number; invalidLines: number; invalidTimestamps: number; unreadableFiles: number;
  truncated: boolean; unpairedEvents: number; ambiguousPairs: number; clockConflicts: number;
}
export interface TimingMetric { kind: string; count: number; timedCount: number; durationMs: number | null; p95Ms: number | null; maxMs: number | null }
export interface TimingPart { label: string; durationMs: number; cumulativeMs: number; count: number; calls: {spanId:string;label:string;durationMs:number}[] }
export interface SessionTiming {
  breakdown: { totalMs: number; activityTotalMs: number; segments: { kind: string; activityMs: number; durationMs: number; cumulativeMs: number; parts: TimingPart[]; callParts: TimingPart[] }[] };
  id: string; provider: string; label: string; firstSeenMs: number | null; lastSeenMs: number | null; lastActivityMs: number | null;
  wallMs: number | null; completedTurnMs: number | null; timedUnionMs: number | null; unattributedTurnMs: number | null; longestMs: number | null;
  turnCount: number; toolCount: number; retryCount: number; metrics: TimingMetric[];
  subagents: { count: number; timedCount: number; cumulativeMs: number | null; elapsedMs: number | null; maxMs: number | null; peakConcurrency: number; unlinkedCount: number; unlinkedTurnCount: number };
  findings: { code: string; spanId: string | null; durationMs: number | null; count: number; label: string }[];
  coverage: TimingCoverage; status: string;
  /** 'recorded' only when the Agent's own evidence states a time to first token. */
  firstTokenStatus: 'unrecorded' | 'recorded'; firstTokenMs?: number | null;
}
export interface PerformanceCatalog {
  schemaVersion: 1; engine: 'rust'; provider: string; status: string; sessions: SessionTiming[];
  coverage: { discoveredSessions: number; omittedSessions: number; directoryLimitReached: boolean; unreadableDirectories: number };
}
export interface PerformanceDetail { schemaVersion: 1; engine: 'rust'; session: SessionTiming; turns: TimingTurn[]; spans: TimingSpan[]; totalSpans: number; omittedSpans: number }

const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const count = (v: unknown): v is number => Number.isSafeInteger(v) && Number(v) >= 0;
const nullableNumber = (v: unknown): boolean => v === null || count(v);
const text = (v: unknown): boolean => typeof v === 'string' && v.length <= 1024;
const nullableText = (v: unknown): boolean => v === null || text(v);
const array = (v: unknown, max: number, valid: (item: unknown) => boolean): boolean => Array.isArray(v) && v.length <= max && v.every(valid);
function evidence(v: unknown): boolean { return object(v) && text(v.source) && count(v.line) && text(v.eventType) && count(v.timestampMs); }
function timingPart(v: unknown): boolean {
  return object(v) && text(v.label) && count(v.durationMs) && count(v.cumulativeMs) && count(v.count)
    && array(v.calls, 80, c => object(c) && text(c.spanId) && text(c.label) && count(c.durationMs));
}
function summary(v: unknown): boolean {
  if (!object(v) || !text(v.id) || !text(v.label) || !text(v.provider) || !text(v.status)
    || (v.firstTokenStatus !== 'unrecorded' && v.firstTokenStatus !== 'recorded')
    || (v.firstTokenMs !== undefined && !nullableNumber(v.firstTokenMs))
    || (v.firstTokenStatus === 'unrecorded' && (v.firstTokenMs ?? null) !== null)) return false;
  if (!['firstSeenMs','lastSeenMs','lastActivityMs','wallMs','completedTurnMs','timedUnionMs','unattributedTurnMs','longestMs'].every(k => nullableNumber(v[k]))
    || !['turnCount','toolCount','retryCount'].every(k => count(v[k]))) return false;
  const b = v.breakdown;
  if (!object(b) || !count(b.totalMs) || !count(b.activityTotalMs) || !array(b.segments, 7, s => object(s) && text(s.kind) && count(s.activityMs) && count(s.durationMs) && count(s.cumulativeMs) && array(s.parts, 20000, timingPart) && array(s.callParts, 20000, timingPart))) return false;
  const c = v.coverage, s = v.subagents;
  return object(c) && typeof c.truncated === 'boolean' && ['files','events','invalidLines','invalidTimestamps','unreadableFiles','unpairedEvents','ambiguousPairs','clockConflicts'].every(k => count(c[k]))
    && object(s) && ['count','timedCount','peakConcurrency','unlinkedCount','unlinkedTurnCount'].every(k => count(s[k])) && ['cumulativeMs','elapsedMs','maxMs'].every(k => nullableNumber(s[k]))
    && array(v.metrics, 20, m => object(m) && text(m.kind) && count(m.count) && count(m.timedCount) && ['durationMs','p95Ms','maxMs'].every(k => nullableNumber(m[k])))
    && array(v.findings, 30, f => object(f) && text(f.code) && text(f.label) && nullableText(f.spanId) && nullableNumber(f.durationMs) && count(f.count));
}
export function isPerformanceResult(value: unknown, detail: boolean): value is PerformanceCatalog | PerformanceDetail {
  if (!object(value) || value.schemaVersion !== 1 || value.engine !== 'rust') return false;
  if (!detail) {
    const c = value.coverage;
    return text(value.provider) && text(value.status) && array(value.sessions, 500, summary) && object(c)
      && count(c.discoveredSessions) && count(c.omittedSessions) && count(c.unreadableDirectories) && typeof c.directoryLimitReached === 'boolean';
  }
  return summary(value.session) && count(value.totalSpans) && count(value.omittedSpans)
    && array(value.turns, 20000, t => object(t) && text(t.id) && text(t.label) && count(t.startMs) && nullableNumber(t.endMs) && nullableNumber(t.durationMs) && typeof t.isSubagent === 'boolean' && nullableText(t.parentSpanId) && array(t.evidence, 4, evidence))
    && array(value.spans, 4000, s => object(s) && ['id','kind','label','basis','status'].every(k => text(s[k]))
      && ['turnId','parentId','relationship'].every(k => nullableText(s[k])) && ['startMs','endMs','durationMs'].every(k => nullableNumber(s[k]))
      && array(s.evidence, 4, evidence) && object(s.facts) && Object.keys(s.facts).length <= 30
      && Object.values(s.facts).every(v => v === null || typeof v === 'boolean' || text(v) || typeof v === 'number' && Number.isFinite(v)));
}

export interface PerformanceSource {
  schemaVersion: 1; engine: 'rust'; source: string; line: number;
  startLine: number; content: string; truncated: boolean; scannedBytes: number;
}
export function isPerformanceSource(v: unknown): v is PerformanceSource {
  if (!object(v) || v.schemaVersion !== 1 || v.engine !== 'rust' || !text(v.source)
    || !count(v.line) || v.line < 1 || !count(v.startLine) || v.startLine < 1
    || typeof v.content !== 'string' || v.content.length > 60000
    || typeof v.truncated !== 'boolean' || !count(v.scannedBytes) || v.scannedBytes > 32 * 1024 * 1024) return false;
  const lines = v.content.split('\n');
  return lines.length <= 7 && v.startLine <= v.line && v.line < v.startLine + lines.length;
}
