export type CompareScenario = "historical-replay" | "new-request-compare";

export interface CheckpointDisplayFact {
  label: string;
  value: string;
  detail?: string;
}

/**
 * Browser-safe projection of an adapter-owned checkpoint.
 *
 * Labels are data so Studio never needs a Git, PPTX, or provider-specific
 * rendering branch. The checkpoint plan and its digest remain authoritative.
 */
export interface CheckpointSourcePreview {
  status: "ready" | "unavailable";
  adapter: { id: string; label: string };
  resource: CheckpointDisplayFact;
  revision: CheckpointDisplayFact;
  history?: CheckpointDisplayFact;
  materialization: CheckpointDisplayFact & {
    timing: "on-run";
    count: number;
  };
  capabilities: {
    isolatedMaterialization: boolean;
    observedHistory: boolean;
    preserveResult: boolean;
  };
  limitation?: string;
}

export interface ExperimentSetupPreview {
  scenario: CompareScenario;
  checkpointSource: CheckpointSourcePreview;
  request: {
    label: string;
    prompt: string;
    promptHash: string;
    provenance: "verified-history" | "unverified-history" | "new";
    limitation?: string;
  };
  historicalGaps: Array<{ laneId: string; missing: string[] }>;
}

/** Browser-safe row returned by any checkpoint history adapter. */
export interface CheckpointHistoryItemPreview {
  id: string;
  title: string;
  requestPreview: string;
  occurredAt?: string;
  adapter: { id: string; label: string };
  provenance: "verified-history" | "unverified-history";
  checkpointVerified: boolean;
}

export interface CheckpointHistoryPreview {
  adapter: { id: string; label: string };
  items: CheckpointHistoryItemPreview[];
  limitation?: string;
}

/** Read-only projection of one history selection before a lock is written. */
export interface ResolvedHistoryDraftPreview {
  selection: CheckpointHistoryItemPreview;
  checkpoint: { digest: string };
  setup: ExperimentSetupPreview;
  lockable: boolean;
  limitation?: string;
}

export interface ExperimentLockReceipt {
  lockId: string;
  historyId: string;
  manifestDigest: string;
  checkpointDigest: string;
  manifestName: string;
}

interface SetupLane {
  origin: "observed" | "execute";
  trials?: number;
  identity?: { promptHash?: string };
}

export function deriveCompareScenario(lanes: readonly SetupLane[]): CompareScenario {
  return lanes.some((lane) => lane.origin === "observed")
    ? "historical-replay"
    : "new-request-compare";
}

export function countLaneMaterializations(lanes: readonly SetupLane[]): number {
  return lanes
    .filter((lane) => lane.origin === "execute")
    .reduce((count, lane) => count + (lane.trials ?? 1), 0);
}

export function deriveRequestProvenance(
  lanes: readonly SetupLane[],
  promptHash: string,
): ExperimentSetupPreview["request"]["provenance"] {
  const observed = lanes.filter((lane) => lane.origin === "observed");
  if (observed.length === 0) return "new";
  return observed.some((lane) => lane.identity?.promptHash === promptHash)
    ? "verified-history"
    : "unverified-history";
}

export function isExperimentRunnable(setup: ExperimentSetupPreview): boolean {
  return setup.checkpointSource.status === "ready" && setup.checkpointSource.materialization.count > 0;
}

export function canLockCompare(setup: ExperimentSetupPreview): boolean {
  return isExperimentRunnable(setup);
}
