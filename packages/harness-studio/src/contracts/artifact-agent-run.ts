import type { ArtifactDigest } from "./artifact.js";

export const ARTIFACT_AGENT_PLAN_KIND = "HarnessStudioArtifactAgentPlanV1" as const;
export const ARTIFACT_AGENT_EVIDENCE_KIND = "HarnessStudioArtifactAgentRunEvidenceV1" as const;

export type ArtifactAgentRunPhaseV1 = "observing" | "planning" | "validating" | "proposal";

/** Strict model output accepted before a Provider is allowed to prepare. */
export interface ArtifactAgentPlanV1 {
  kind: typeof ARTIFACT_AGENT_PLAN_KIND;
  summary: string;
  plan: readonly string[];
  providerSteering: { kind: string; message: string };
}

/** Browser-safe proof of the executor session that produced one plan. */
export interface ArtifactAgentRunEvidenceV1 {
  kind: typeof ARTIFACT_AGENT_EVIDENCE_KIND;
  runId: string;
  artifactId: string;
  revision: ArtifactDigest;
  targetAddress: string;
  agent: { id: string; label: string };
  executor: "acp";
  harnessRevisionId: string;
  permissionRequestsCancelled: number;
  sessionId?: string;
  model?: string;
  stopReason?: string;
}
