export const STOP_CONDITIONS = ["changes", "failures", "permissions", "tests", "responses"] as const;

export type StopCondition = typeof STOP_CONDITIONS[number];
export type DebuggerEventKind = "prompt" | "plan" | "explore" | "change" | "verify" | "response";
export type EvidenceLevel = "Exact" | "Correlated" | "Inferred";

export interface DebuggerToolCall {
  sourceCallId?: string;
  status?: string;
  id: string;
  name: string;
  summary: string;
  input: string;
  output: string;
  duration: string;
  resource?: string;
}

export interface DebuggerFileChange {
  path: string;
  additions: number;
  deletions: number;
  status: "modified" | "created" | "deleted";
}

export interface DebuggerDiff {
  path: string;
  beforeStart: number;
  before: string[];
  afterStart: number;
  after: string[];
}

export interface DebuggerValidation {
  command: string;
  status: "failed" | "passed";
  duration: string;
  summary: string;
  output: string[];
}

export interface DebuggerEvidenceLink {
  level: EvidenceLevel;
  label: string;
  detail: string;
}

export interface DebuggerRawAcp {
  direction: "Client → Agent" | "Agent → Client";
  method: string;
  rpcId: string;
  sessionId: string;
  toolCallId?: string;
  traceContext: string;
  payload: Record<string, unknown>;
}

export interface DebuggerEvent {
  id: string;
  kind: DebuggerEventKind;
  phase: string;
  title: string;
  summary: string;
  timestamp: string;
  relativeTime: string;
  stopConditions: StopCondition[];
  toolCalls?: DebuggerToolCall[];
  fileChanges?: DebuggerFileChange[];
  diff?: DebuggerDiff;
  validation?: DebuggerValidation;
  evidence: DebuggerEvidenceLink[];
  rawAcp: DebuggerRawAcp;
}

export interface DebuggerSession {
  models?: string[];
  tokenUsage?: Record<string, number>;
  id: string;
  name: string;
  agent: string;
  protocol: string;
  connection: string;
  mode: "Recorded sample" | "Retained run";
  startedAt: string;
  finishedAt: string;
  events: DebuggerEvent[];
}

export type RetainedRunTimelineItem =
  | { kind: "message"; id: string; text: string; complete: boolean; role?: "thought" | "user"; content?: unknown[] }
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

export interface RetainedRunRecord {
  id: string;
  savedAt: string;
  prompt: string;
  status: "finished" | "error";
  runId?: string;
  threadId?: string;
  warnings: string[];
  error?: string;
  result?: unknown;
  timeline: RetainedRunTimelineItem[];
}

export interface DebuggerCursor {
  eventId: string;
  toolCallId?: string;
}

export type StopConditionState = Record<StopCondition, boolean>;
