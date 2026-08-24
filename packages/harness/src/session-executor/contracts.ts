export const SESSION_EXECUTION_PLAN_VERSION = "session-execution-plan-v1" as const;
export const SESSION_EXECUTION_RECEIPT_VERSION = "session-execution-receipt-v1" as const;

export interface SessionExecutionConstraints {
  isolation: "detached-git-worktree";
  readTools: readonly ["read", "ls"];
  mutationTools: readonly ["edit", "write"];
  shell: false;
  deleteOrRename: false;
  extensions: false;
  skills: false;
  maxToolCalls: 64;
  maxDurationMs: 900000;
}

export const SESSION_EXECUTION_CONSTRAINTS: SessionExecutionConstraints = Object.freeze({
  isolation: "detached-git-worktree",
  readTools: Object.freeze(["read", "ls"] as const),
  mutationTools: Object.freeze(["edit", "write"] as const),
  shell: false,
  deleteOrRename: false,
  extensions: false,
  skills: false,
  maxToolCalls: 64,
  maxDurationMs: 900_000,
});

export interface SessionExecutionPlan {
  schemaVersion: typeof SESSION_EXECUTION_PLAN_VERSION;
  provider: "pi";
  planId: string;
  createdAt: string;
  workspace: {
    root: string;
    gitCommonDir: string;
    baseCommit: string;
    baseTree: string;
  };
  checkpoint: {
    sessionFile: string;
    sessionSha256: string;
    sessionId: string;
    sessionVersion: number;
    sourceCwd: string;
    entryCount: number;
    entryId: string;
    entryType: string;
    branchEntryIds: string[];
    branchDigest: string;
  };
  continuation: {
    /** Stored in the local plan so the execution is replayable. Receipts omit it. */
    prompt: string;
    promptSha256: string;
    commitMessage: string;
  };
  constraints: SessionExecutionConstraints;
  output: {
    ref: string;
    artifactDir: string;
  };
}

export interface PiCheckpointInspection {
  file: string;
  sha256: string;
  sessionId: string;
  version: number;
  sourceCwd: string;
  entryCount: number;
  entryId: string;
  entryType: string;
  branchEntryIds: string[];
  branchDigest: string;
}

export interface SessionContinuationRunnerInput {
  plan: SessionExecutionPlan;
  worktree: string;
  sourceSessionFile: string;
  sessionDirectory: string;
  artifactDir: string;
}

export interface SessionContinuationRunnerResult {
  provider?: "pi";
  executionSessionId: string;
  sessionFile: string;
  model?: { provider: string; id: string } | null;
  modelFallbackMessage?: string | null;
  toolCalls?: Array<{ id?: string; name: string }>;
  output?: string;
}

export type SessionContinuationRunner = (
  input: SessionContinuationRunnerInput,
) => Promise<SessionContinuationRunnerResult>;

export interface SessionExecutionReceipt {
  schemaVersion: typeof SESSION_EXECUTION_RECEIPT_VERSION;
  status: "prepared" | "complete";
  planId: string;
  provider: "pi";
  startedAt: string;
  completedAt: string | null;
  workspace: {
    root: string;
    baseCommit: string;
    baseTree: string;
  };
  checkpoint: {
    sourceSessionFile: string;
    frozenSessionFile: string;
    sourceSessionSha256: string;
    sourceSessionId: string;
    sourceSessionVersion: number;
    entryId: string;
    entryType: string;
    branchDigest: string;
  };
  execution: {
    sessionId: string;
    sessionFile: string;
    sessionSha256: string;
    model: { provider: string; id: string } | null;
    toolCalls: Array<{ id?: string; name: string }>;
    outputSha256: string;
  };
  result: {
    commit: string;
    tree: string;
    parent: string;
    ref: string;
    changedPaths: string[];
  };
  constraints: SessionExecutionConstraints;
  cleanup: {
    worktreeRemoved: boolean;
    warnings: string[];
  };
}

export class SessionExecutorError extends Error {
  readonly code: string;
  cleanupWarnings?: string[];

  constructor(code: string, message: string, options: ErrorOptions = {}) {
    super(message, options);
    this.name = "SessionExecutorError";
    this.code = code;
  }
}

export function sessionExecutorErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function sessionExecutorErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object" || !("code" in error)) return undefined;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : undefined;
}
