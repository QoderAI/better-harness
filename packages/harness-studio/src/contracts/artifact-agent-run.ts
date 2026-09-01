import type { ArtifactDigest, ArtifactInteractionProvenanceV1 } from "./artifact.js";

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
  provenance?: ArtifactInteractionProvenanceV1;
  sessionId?: string;
  model?: string;
  stopReason?: string;
}

export type ArtifactAgentStreamEventV1 =
  | { type: "run-started"; runId: string }
  | { type: "phase"; phase: ArtifactAgentRunPhaseV1; summary: string }
  | { type: "action"; action: "permission-cancelled"; summary: string }
  | { type: "plan"; plan: ArtifactAgentPlanV1 }
  | { type: "evidence"; evidence: ArtifactAgentRunEvidenceV1 }
  | { type: "proposal"; proposal: unknown }
  | { type: "run-finished"; proposalId: string }
  | { type: "run-error"; message: string };
