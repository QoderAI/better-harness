export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

export interface SessionUsageSummary {
  kind: "better-harness.session-usage-summary";
  schemaVersion: 1;
  selection: {
    strategy: string;
    eligibleCount: number;
    analyzedCount: number;
    complete: boolean;
  };
  usageEfficiency: {
    accountingMode: "exact" | "host-estimated" | "effort-proxy" | string;
    coverage: {
      analyzedSessionCount: number;
      responseCount: number;
      usageFieldObservedCount: number;
      nonZeroUsageCount: number;
      modelAttributedResponseCount: number;
      unattributedResponseCount: number;
      exactCreditsAvailable: boolean;
    };
    longSessions: {
      longActiveCount: number;
      longWallCount: number;
      wallOnlyCount: number;
    };
    tokenTotals: TokenTotals | null;
    modelUsage: Array<{
      model: string;
      responseCount: number;
      usageFieldObservedCount: number;
      nonZeroUsageCount: number;
      tokenTotals: TokenTotals | null;
    }>;
    outcomeReview: {
      status: string;
      reviewedCandidateCount: number;
      reviewedActiveLongCount: number;
      comparableModelOutcomeEvidence: boolean;
      reason: string | null;
    };
    candidateCount: number;
    opportunityCount: number;
  };
  evidenceBoundary: {
    hasEligibleSessions: boolean;
    requiresSemanticReview: boolean;
    exactCostAvailable: boolean;
    warningCodes: string[];
  };
}

export interface UsageActivity {
  schemaVersion: number;
  dateBasis: "UTC";
  measurementBasis: string;
  truncated: boolean;
  dates: string[];
  sessions: {
    total: number;
    starts: number[];
    activeMinutes: number[];
  };
  models: Array<{ name: string; total: number; daily: number[] }>;
  skills: Array<{ name: string; total: number; daily: number[] }>;
  tokens?: {
    observedResponseCount: number;
    totals: TokenTotals;
    daily: {
      inputTokens: number[];
      outputTokens: number[];
      cacheReadInputTokens: number[];
      cacheCreationInputTokens: number[];
    };
  };
}

export interface AssetInventoryReport {
  kind: "agent-lint";
  profile: "agent-assets-review";
  assetInventory: {
    provider: string;
    summary: {
      skills: number;
      mcps: number;
      commands: number;
      hooks: number;
      rules: number;
      agents: number;
      plugins: number;
    };
  };
  findings: Array<{
    severity: "error" | "warning" | "advisory" | string;
    assetKind?: string;
  }>;
}

export interface TaskEvidencePacket {
  kind: "better-harness.task-evidence-packet";
  schemaVersion: 1;
  generatedAt: string;
  workspace: { label: string };
  task: {
    id: string;
    title: string;
    intent: string;
    scope: string[];
    nonGoals: string[];
    acceptance: Array<{ id: string; status: "passed" | "failed" | "unobserved"; summary: string }>;
  };
  assets: Array<{
    kind: string;
    id: string;
    match: "exact" | "ambiguous" | "unresolved";
    stage: string;
    outcome: "succeeded" | "failed" | "unobserved";
    attribution: string;
  }>;
  observations: Array<{
    kind: string;
    status: "passed" | "failed" | "observed" | "unobserved";
    summary: string;
    evidenceRef?: string;
  }>;
  coverage: {
    acceptance: Record<"total" | "passed" | "failed" | "unobserved", number>;
    assetMatches: Record<"total" | "exact" | "ambiguous" | "unresolved", number>;
    assetOutcomes: Record<"total" | "succeeded" | "failed" | "unobserved", number>;
    observations: Record<"total" | "passed" | "failed" | "observed" | "unobserved", number>;
  };
  privacy: {
    profile: string;
    redactions: number;
    excludedEvidence: string[];
  };
}

export interface ContextUsage {
  schemaVersion: number;
  status: "observed" | "unobserved";
  evidence: "cursor-native-context-usage-canvas" | "cursor-native-composer-state";
  capturedAt?: string;
  totalTokensUsed?: number;
  contextWindowSize?: number;
  percentFull?: number;
  categories: Array<{ id: string; label: string; estimatedTokens: number }>;
  items: Array<{
    id: string;
    categoryId: string;
    label: string;
    estimatedTokens: number;
    characterCount: number;
  }>;
  coverage: {
    snapshotCount?: number;
    itemCount: number;
    sourceItemCount: number;
    truncated: boolean;
    rawTextOmitted: true;
  };
  actions: { openAgentId: string | null };
}

export interface DashboardInput {
  generatedAt: string;
  sources: {
    sessionProviders: string[];
    assetProviders: string[];
    tokenProviders: string[];
    errors: Array<{ source: string; message: string }>;
  };
  usageSummary: SessionUsageSummary;
  usageActivity: UsageActivity;
  contextUsage?: ContextUsage;
  assetInventories: AssetInventoryReport[];
  evidencePackets: TaskEvidencePacket[];
}
