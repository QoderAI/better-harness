import { createHash, randomUUID } from "node:crypto";
import {
  ARTIFACT_INTERACTION_PROTOCOL_VERSION,
  canonicalArtifactInteractionJson,
  type ArtifactHostedIntentDestinationV1,
  type ArtifactHostedIntentOriginRefV1,
  type ArtifactHostedIntentOutcomeV1,
  type ArtifactInteractionActorV1,
  type ArtifactInteractionProvenanceV1,
  type ArtifactInteractionTargetV1,
} from "../../contracts/artifact.js";
import type { HarnessStudioServerOptions, HarnessStudioState } from "../studio-types.js";
import { artifactAuthorityId } from "./artifact-authority.js";
import { artifactSurfaceBindingId, digestHex } from "./registry/artifact-catalog.js";
import { resolveArtifactRevisionPlugin } from "./routes.js";

export class ArtifactInteractionProvenanceError extends Error {
  constructor(readonly status: 409 | 422, message: string) {
    super(message);
  }
}

export function parseArtifactHostedIntentOriginRef(value: unknown): ArtifactHostedIntentOriginRefV1 {
  if (!isRecord(value) || Object.keys(value).length !== 2
    || value.kind !== "HarnessStudioArtifactHostedIntentOriginRefV1"
    || typeof value.originId !== "string"
    || !/^origin:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(value.originId)) {
    throw new ArtifactInteractionProvenanceError(422, "The Canvas intent origin reference is invalid.");
  }
  return { kind: value.kind, originId: value.originId };
}

export async function resolveArtifactInteractionProvenance(
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  originRef: ArtifactHostedIntentOriginRefV1,
  destination: ArtifactHostedIntentDestinationV1,
  target: ArtifactInteractionTargetV1,
  draftMessage: string,
  adoptedBy: ArtifactInteractionActorV1,
  draftSteeringKind?: string,
): Promise<ArtifactInteractionProvenanceV1> {
  const outcome = retainedNativeSteeringOutcome(state, originRef.originId);
  assertOutcomeMatchesAdoption(outcome, destination, target, draftMessage, draftSteeringKind);
  await assertBindingsCurrent(state, options, {
    artifactId: outcome.artifactId,
    revision: outcome.revision,
    bindingId: outcome.bindingId,
  }, outcome.destination);
  const content = {
    kind: "HarnessStudioArtifactInteractionProvenanceV1",
    protocolVersion: ARTIFACT_INTERACTION_PROTOCOL_VERSION,
    originId: outcome.originRef.originId,
    adoptionId: `adoption:${randomUUID()}`,
    source: {
      artifactId: outcome.artifactId,
      revision: outcome.revision,
      bindingId: outcome.bindingId,
      intentId: outcome.intentId,
      target: outcome.sourceTarget,
    },
    destination: outcome.destination,
    draft: {
      selectionId: outcome.effect.selectionId,
      steeringId: outcome.effect.steeringId,
      target: outcome.effect.target,
      steering: outcome.effect.steering,
    },
    recordedBy: outcome.actor,
    recordedAt: outcome.recordedAt,
    adoptedBy,
    adoptedAt: new Date().toISOString(),
  } as const;
  return { ...content, provenanceDigest: digestJson(content) };
}

export async function assertArtifactInteractionProvenanceCurrent(
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  provenance: ArtifactInteractionProvenanceV1,
): Promise<void> {
  const { provenanceDigest, ...content } = provenance;
  if (digestJson(content) !== provenanceDigest) {
    throw stale("The retained Canvas intent provenance failed its digest check.");
  }
  await assertBindingsCurrent(state, options, provenance.source, provenance.destination);
}

function retainedNativeSteeringOutcome(
  state: HarnessStudioState,
  originId: string,
): ArtifactHostedIntentOutcomeV1 & {
  sourceTarget: ArtifactInteractionTargetV1;
  destination: ArtifactHostedIntentDestinationV1;
  originRef: ArtifactHostedIntentOriginRefV1;
  effect: Extract<ArtifactHostedIntentOutcomeV1["effect"], { kind: "steering" }>;
} {
  const authorityId = artifactAuthorityId(state);
  const now = Date.now();
  let matched: ArtifactHostedIntentOutcomeV1 | undefined;
  for (const [key, record] of state.artifactIntentAdmissions) {
    if ((record.outcome !== undefined || record.failure !== undefined) && record.expiresAtMs <= now) {
      state.artifactIntentAdmissions.delete(key);
      continue;
    }
    const outcome = record.outcome;
    if (record.authorityId !== authorityId || outcome?.originRef?.originId !== originId) continue;
    if (matched !== undefined) throw stale("The Canvas intent origin is ambiguous.");
    matched = outcome;
  }
  if (matched === undefined || matched.sourceTarget === undefined || matched.destination === undefined
    || matched.originRef === undefined || matched.effect.kind !== "steering") {
    throw stale("The Canvas intent origin is no longer retained for adoption.");
  }
  return matched as ArtifactHostedIntentOutcomeV1 & {
    sourceTarget: ArtifactInteractionTargetV1;
    destination: ArtifactHostedIntentDestinationV1;
    originRef: ArtifactHostedIntentOriginRefV1;
    effect: Extract<ArtifactHostedIntentOutcomeV1["effect"], { kind: "steering" }>;
  };
}

function assertOutcomeMatchesAdoption(
  outcome: ReturnType<typeof retainedNativeSteeringOutcome>,
  destination: ArtifactHostedIntentDestinationV1,
  target: ArtifactInteractionTargetV1,
  draftMessage: string,
  draftSteeringKind?: string,
): void {
  if (canonicalArtifactInteractionJson(outcome.destination) !== canonicalArtifactInteractionJson(destination)) {
    throw stale("The Canvas intent origin does not match this destination Artifact binding.");
  }
  if (canonicalArtifactInteractionJson(outcome.effect.target) !== canonicalArtifactInteractionJson(target)) {
    throw stale("The Canvas intent origin does not match the selected native target.");
  }
  if (outcome.effect.steering.message !== draftMessage) {
    throw stale("The Canvas intent draft changed before adoption.");
  }
  if (draftSteeringKind !== undefined && outcome.effect.steering.kind !== draftSteeringKind) {
    throw stale("The Canvas intent steering grammar changed before direct Provider preparation.");
  }
}

async function assertBindingsCurrent(
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  sourceIdentity: Pick<ArtifactInteractionProvenanceV1["source"], "artifactId" | "revision" | "bindingId">,
  destinationIdentity: ArtifactHostedIntentDestinationV1,
): Promise<void> {
  const expectedAuthority = artifactAuthorityId(state);
  const currentOptions = {
    ...options,
    artifactDirectory: state.artifactDirectory,
    artifactPaths: state.artifactPaths,
  };
  const source = await resolveArtifactRevisionPlugin(currentOptions, sourceIdentity.artifactId, digestHex(sourceIdentity.revision));
  if ("error" in source || source.descriptor.revision.id !== sourceIdentity.revision
    || source.descriptor.renderer.bindingId !== sourceIdentity.bindingId
    || artifactSurfaceBindingId(source.resolution) !== sourceIdentity.bindingId
    || source.resolution.intent === undefined) {
    throw stale("The Canvas source revision or intent binding changed before adoption.");
  }
  assertAuthority(state, expectedAuthority);
  const destination = await resolveArtifactRevisionPlugin(
    currentOptions,
    destinationIdentity.artifactId,
    digestHex(destinationIdentity.revision),
  );
  if ("error" in destination || destination.descriptor.label !== destinationIdentity.artifactLabel
    || destination.descriptor.revision.id !== destinationIdentity.revision
    || destination.descriptor.renderer.bindingId !== destinationIdentity.bindingId
    || artifactSurfaceBindingId(destination.resolution) !== destinationIdentity.bindingId
    || destination.resolution.interaction === undefined) {
    throw stale("The Canvas intent destination revision or interaction binding changed before adoption.");
  }
  assertAuthority(state, expectedAuthority);
}

function assertAuthority(state: HarnessStudioState, expected: string): void {
  if (artifactAuthorityId(state) !== expected) {
    throw stale("The Artifact authority changed while Canvas intent provenance was checked.");
  }
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson(value)).digest("hex")}`;
}

function stale(message: string): ArtifactInteractionProvenanceError {
  return new ArtifactInteractionProvenanceError(409, message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
