/** Proposed follow-up contract. No analysis endpoint/engine is enabled yet. */
export interface MemoryAnalysisInput {
  version: 1;
  /** Server-resolved remembered project IDs, never renderer supplied paths. */
  projects: Array<{
    projectId: string;
    repositoryIdentity: string;
    revision: string;
    /** Required when analysis includes uncommitted files. */
    workingTreeDigest?: string;
  }>;
  /** Explicitly authorized immutable snapshots, not paths to read later. */
  snapshots: Array<{ digest: string; documentId: string; sourceId: string }>;
  limits: { maxFiles: number; maxBytes: number; timeoutMs: number };
}

export interface MemoryAstEvidence {
  projectId: string;
  revision: string;
  /** Repository-relative portable path. */
  path: string;
  contentDigest: string;
  language: string;
  parser: { name: string; version: string };
  symbol?: string;
  range: { startByte: number; endByte: number };
}

export interface MemoryAnalysisJob {
  version: 1;
  jobId: string;
  inputDigest: string;
  state: 'queued' | 'running' | 'succeeded' | 'partial' | 'failed' | 'cancelled';
  /** Monotonically increasing cursor for reconnect/polling. */
  sequence: number;
  createdAt: string;
  updatedAt: string;
  progress: { completedProjects: number; totalProjects: number; processedFiles: number };
  failures: Array<{ projectId: string; code: string; retryable: boolean }>;
  result?: { artifactId: string; digest: string };
}
