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
      /** Distinct cache relationships behind the retained counters. */
      cacheAccountingModes: string[];
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
  mcps?: Array<{ name: string; total: number; daily: number[] }>;
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

export type AssetKind = "skill" | "mcp" | "command" | "hook" | "rule" | "agent" | "plugin";

export interface AssetIdentity {
  kind: AssetKind | string;
  /** Workspace-relative path, or a scope-qualified name when outside it. */
  id: string;
  name: string;
  scope: string;
  /**
   * Present only when the host declared one. This is the field a Task evidence
   * packet's versioned asset can be compared against; an absent revision means
   * the asset declared none, not that it is unversioned.
   */
  revision?: string;
  publisher?: string;
}

export interface AssetInventoryReport {
  kind: "agent-lint";
  profile: "agent-assets-review";
  assetInventory: {
    provider: string;
    /** Configured instances for this host. Several hosts may read one file. */
    summary: {
      skills: number;
      mcps: number;
      commands: number;
      hooks: number;
      rules: number;
      agents: number;
      plugins: number;
    };
    assets?: AssetIdentity[];
    assetsTruncated?: boolean;
  };
  findings: Array<{
    severity: "error" | "warning" | "advisory" | string;
    assetKind?: string;
  }>;
}

export interface ProviderUsageRow {
  provider: string;
  analyzedSessions: number;
  eligibleSessions: number;
  responseCount: number;
  modelAttributedResponseCount: number;
  activeMinutes: number;
  accountingMode: string;
  cacheAccountingModes: string[];
  tokenTotals: TokenTotals | null;
  editCount: number;
  episodeCount: number;
}

export interface NamedCount {
  name: string;
  count: number;
}

export interface DeliverySignals {
  validationAfterEdit: {
    status: "validated-after-edit" | "edit-without-validation" | "no-edit-observed" | string;
    editCount: number;
    validationAfterEditCount: number;
    relevantValidationCount: number;
  };
  validationCommands: NamedCount[];
  episodes: {
    episodeCount: number;
    eligibleEpisodeCount: number;
    closedEpisodeCount: number;
    unobservedClosureCount: number;
  };
  friction: NamedCount[];
  topTools: NamedCount[];
  observedHooks: NamedCount[];
}

export interface CommitAttribution {
  graceMinutes: number;
  correlatedSessionCount: number;
  commitCount: number;
  attributedCommits: number;
  linesAdded: number;
  linesRemoved: number;
  attributedLinesAdded: number;
  attributedLinesRemoved: number;
  byConfidence: Record<"explicit" | "high" | "medium" | "low", number>;
  byPlatform: Array<{ platform: string; commitCount: number }>;
  /**
   * One reference per attributed commit, bounded. The join key between a
   * delivered commit and the session that earned the attribution; fewer entries
   * than `attributedCommits` means the list was bounded.
   */
  attributedCommitRefs: Array<{
    commit: string;
    sessionId: string;
    platform: string | null;
    confidence: "explicit" | "high" | "medium";
  }>;
}

export interface WorkspaceTopologyProjection {
  target: string;
  memberCount: number;
  members: Array<{ route: string; kind: string }>;
  instructionScopes: { total: number; effective: number; candidate: number };
  trackedFiles: number;
}

export interface EvidenceDelivery {
  organization: string;
  endpoint: string;
  acceptedAt: string;
  receiptState: "accepted" | "duplicate" | string;
  packetDigest: string;
  packetBytes: number;
  packet: TaskEvidencePacket;
}

export interface TaskEvidencePacket {
  kind: "better-harness.task-evidence-packet";
  schemaVersion: 1;
  generatedAt: string;
  workspace: { label: string };
  links?: {
    projectRef?: string;
    sessionRefs: string[];
    commitRefs: string[];
    artifactRefs: string[];
  };
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
    publisher?: string;
    revision?: string;
    summary?: string;
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
  kind: "better-harness.dashboard-input";
  schemaVersion: 1;
  generatedAt: string;
  workspace: { id: string; label: string };
  /** The dated boundary every series below shares. */
  window: {
    firstDate: string | null;
    lastDate: string | null;
    dayCount: number;
    truncated: boolean;
  };
  sources: {
    sessionProviders: string[];
    assetProviders: string[];
    tokenProviders: string[];
    errors: Array<{ source: string; message: string }>;
  };
  usageSummary: SessionUsageSummary;
  usageActivity: UsageActivity;
  providerBreakdown: ProviderUsageRow[];
  deliverySignals: DeliverySignals | null;
  commitAttribution?: CommitAttribution;
  topology?: WorkspaceTopologyProjection;
  contextUsage?: ContextUsage;
  assetInventories: AssetInventoryReport[];
  evidenceDeliveries: {
    items: EvidenceDelivery[];
    total: number;
    truncated: boolean;
  };
}

export interface DashboardProject {
  id: string;
  label: string;
}

export type DashboardProjectSnapshot =
  | { project: DashboardProject; status: "ready"; input: DashboardInput }
  | { project: DashboardProject; status: "failed"; message: string };
