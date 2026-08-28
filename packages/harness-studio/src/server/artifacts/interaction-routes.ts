import { createHash } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  canonicalArtifactInteractionJson,
  type ArtifactInteractionActorV1,
  type ArtifactInteractionPreparedProposalV1,
  type ArtifactInteractionPrepareInputV1,
  type ArtifactInteractionProposalV1,
  type ArtifactInteractionTargetV1,
  type ArtifactInteractionTransitionReceiptV1,
  type ArtifactInteractionWorkspaceV1,
} from "../../contracts/artifact.js";
import { readJsonBody } from "../http-utils.js";
import type {
  ArtifactInteractionProposalState,
  HarnessStudioServerOptions,
  HarnessStudioState,
} from "../studio-types.js";
import { discoverArtifactProviderRuntime } from "./registry/artifact-provider-discovery.js";
import {
  respondArtifactJson,
  resolveArtifactRevisionPlugin,
  safeArtifactError,
} from "./routes.js";

const MAX_ACTIVE_PROPOSALS = 32;
const PROPOSAL_TTL_MS = 10 * 60 * 1_000;
const MAX_PREVIEW_BYTES = 4 * 1_024 * 1_024;
const MAX_TARGETS = 2_000;
const MAX_ACTIONS = 64;
const MAX_EVIDENCE = 64;

export interface RetainedArtifactInteractionBinding {
  artifactId: string;
  revision: string;
  providerId: string;
  contributionId: string;
  providerFingerprint: string;
  context: ArtifactInteractionProposalState["context"];
  runtime: ArtifactInteractionProposalState["runtime"];
}

export interface ArtifactInteractionProposalResponse {
  proposal: ArtifactInteractionProposalV1;
  preview: { uri: string; mediaType: string; label: string; digest: string };
}

class ArtifactInteractionAuthorizationError extends Error {}

export async function serveArtifactInteraction(
  response: ServerResponse,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<void> {
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  const interaction = resolved.resolution.interaction;
  if (interaction === undefined || resolved.resolution.provider === undefined) {
    respondArtifactJson(response, 404, { error: `Artifact '${id}' is review-only.` });
    return;
  }
  try {
    const workspace = assertArtifactInteractionWorkspace(await interaction.inspect({ entry: resolved.entry, descriptor: resolved.descriptor }), id, resolved.descriptor.revision.id);
    respondArtifactJson(response, 200, {
      workspace,
      runtime: { id: interaction.id, version: interaction.version, protocolVersion: interaction.protocolVersion },
    });
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}

export async function prepareArtifactInteractionProposal(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
): Promise<void> {
  expireProposals(state);
  if (state.artifactInteractionProposals.size >= MAX_ACTIVE_PROPOSALS) {
    respondArtifactJson(response, 429, { error: "Too many Artifact proposals are retained." });
    return;
  }
  const resolved = await resolveArtifactRevisionPlugin(options, id, revision);
  if ("error" in resolved) {
    respondArtifactJson(response, resolved.status, { error: resolved.error });
    return;
  }
  const interaction = resolved.resolution.interaction;
  const provider = resolved.resolution.provider;
  if (interaction === undefined || provider === undefined) {
    respondArtifactJson(response, 404, { error: `Artifact '${id}' is review-only.` });
    return;
  }
  try {
    const body = exactObject(await readJsonBody(request), ["targetAddress", "steering", "requestedBy", "requestId"], "proposal request");
    const requestedBy = actor(body.requestedBy, "requestedBy", "human");
    const steering = exactObject(body.steering, ["kind", "message"], "steering");
    const input = {
      targetAddress: boundedString(body.targetAddress, "targetAddress", 8_192),
      steering: {
        kind: boundedString(steering.kind, "steering.kind", 128),
        message: boundedString(steering.message, "steering.message", 8_192),
      },
      requestedBy,
      requestId: boundedIdentifier(body.requestId, "requestId"),
    } as const;
    const binding = {
      artifactId: id,
      revision: resolved.descriptor.revision.id,
      providerId: provider.providerId,
      contributionId: provider.contributionId,
      providerFingerprint: provider.fingerprint,
      context: { entry: resolved.entry, descriptor: resolved.descriptor },
      runtime: interaction,
    };
    const result = await prepareAndRetainArtifactInteractionProposal(state, binding, input);
    respondArtifactJson(response, 201, result);
  } catch (error) {
    respondArtifactJson(response, 422, { error: safeArtifactError(error) });
  }
}

/**
 * Invoke one already-selected Provider prepare capability and retain its opaque
 * continuation for the Host decision gate. Agent planning and direct browser
 * preparation share this path so proposal identity, bounds, and lifetime cannot
 * drift between the two entrypoints.
 */
export async function prepareAndRetainArtifactInteractionProposal(
  state: HarnessStudioState,
  binding: RetainedArtifactInteractionBinding,
  input: ArtifactInteractionPrepareInputV1,
  constraints: { proposedByKind?: ArtifactInteractionActorV1["kind"] } = {},
): Promise<ArtifactInteractionProposalResponse> {
  expireProposals(state);
  if (state.artifactInteractionProposals.size >= MAX_ACTIVE_PROPOSALS) {
    throw new Error("Too many Artifact proposals are retained.");
  }
  const prepared = assertPrepared(
    await binding.runtime.prepare(binding.context, input),
    binding.artifactId,
    binding.revision,
  );
  if (prepared.proposal.target.address !== input.targetAddress
    || prepared.proposal.steering.kind !== input.steering.kind
    || prepared.proposal.steering.message !== input.steering.message) {
    throw new Error("The Provider proposal does not match the retained target and steering.");
  }
  if (constraints.proposedByKind !== undefined && prepared.proposal.proposedBy.kind !== constraints.proposedByKind) {
    throw new Error(`The Provider proposal actor must be '${constraints.proposedByKind}'.`);
  }
  if (state.artifactInteractionProposals.has(prepared.proposal.proposalId)) {
    throw new Error("The Provider reused an active proposal id.");
  }
  const now = Date.now();
  state.artifactInteractionProposals.set(prepared.proposal.proposalId, {
    artifactId: binding.artifactId,
    revision: binding.revision,
    providerId: binding.providerId,
    contributionId: binding.contributionId,
    providerFingerprint: binding.providerFingerprint,
    context: binding.context,
    runtime: binding.runtime,
    prepared,
    createdAtMs: now,
    expiresAtMs: now + PROPOSAL_TTL_MS,
  });
  return proposalResponse(binding.artifactId, binding.revision.slice("sha256:".length), prepared);
}

export function serveArtifactInteractionPreview(
  response: ServerResponse,
  state: HarnessStudioState,
  id: string,
  revision: string,
  proposalId: string,
): void {
  expireProposals(state);
  const record = proposalRecord(state, id, revision, proposalId);
  if (record === undefined) {
    respondArtifactJson(response, 410, { error: "The Artifact proposal preview is no longer retained." });
    return;
  }
  const preview = record.prepared.preview;
  if (digestBytes(preview.bytes) !== preview.digest) {
    respondArtifactJson(response, 409, { error: "The Artifact proposal preview failed its digest check." });
    return;
  }
  response.writeHead(200, {
    "Content-Type": preview.mediaType,
    "Content-Length": preview.bytes.byteLength,
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(preview.bytes);
}

export async function decideArtifactInteractionProposal(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  id: string,
  revision: string,
  proposalId: string,
): Promise<void> {
  expireProposals(state);
  const record = proposalRecord(state, id, revision, proposalId);
  if (record === undefined) {
    respondArtifactJson(response, 410, { error: "The Artifact proposal is no longer retained." });
    return;
  }
  try {
    const body = exactObject(await readJsonBody(request), ["proposalDigest", "expectedRevision", "decision", "decisionId", "decidedBy"], "decision request");
    const decision = body.decision === "approve" || body.decision === "reject" ? body.decision : invalid("decision must be 'approve' or 'reject'.");
    const decisionId = boundedIdentifier(body.decisionId, "decisionId");
    const decidedBy = actor(body.decidedBy, "decidedBy", "human");
    const proposalDigest = digest(body.proposalDigest, "proposalDigest");
    const expectedRevision = digest(body.expectedRevision, "expectedRevision");
    if (proposalDigest !== record.prepared.proposal.proposalDigest
      || expectedRevision !== record.prepared.proposal.expectedRevision) {
      throw new Error("The decision does not match the retained proposal identity.");
    }
    if (record.terminal !== undefined) {
      if (record.terminal.decision === decision
        && record.terminal.decisionId === decisionId
        && record.terminal.actorId === decidedBy.id) {
        respondArtifactJson(response, 200, { receipt: record.terminal.receipt, replayed: true });
        return;
      }
      respondArtifactJson(response, 409, { error: "The Artifact proposal was already settled by another decision." });
      return;
    }
    if (record.settling !== undefined) {
      if (record.settling.decision !== decision
        || record.settling.decisionId !== decisionId
        || record.settling.actorId !== decidedBy.id) {
        respondArtifactJson(response, 409, { error: "The Artifact proposal is already settling another decision." });
        return;
      }
      const receipt = await record.settling.promise;
      respondArtifactJson(response, 200, { receipt, replayed: true });
      return;
    }
    const settlement = (async (): Promise<ArtifactInteractionTransitionReceiptV1> => {
      if (!(await providerStillAuthorized(options, record))) {
        throw new ArtifactInteractionAuthorizationError("The selected Artifact Provider is no longer active for this proposal.");
      }
      const receipt = assertReceipt(await record.runtime.decide(record.context, {
        prepared: record.prepared,
        decision,
        decisionId,
        decidedBy,
        decidedAt: new Date().toISOString(),
      }), record.prepared.proposal, decision, decisionId);
      record.terminal = { decision, decisionId, actorId: decidedBy.id, receipt };
      return receipt;
    })();
    record.settling = { decision, decisionId, actorId: decidedBy.id, promise: settlement };
    try {
      const receipt = await settlement;
      respondArtifactJson(response, 200, { receipt, replayed: false });
    } finally {
      if (record.settling?.promise === settlement) record.settling = undefined;
    }
  } catch (error) {
    respondArtifactJson(response, error instanceof ArtifactInteractionAuthorizationError ? 409 : 422, { error: safeArtifactError(error) });
  }
}

async function providerStillAuthorized(options: HarnessStudioServerOptions, record: ArtifactInteractionProposalState): Promise<boolean> {
  const runtime = await discoverArtifactProviderRuntime(options);
  const provider = runtime.providers.find((candidate) => candidate.id === record.providerId && candidate.fingerprint === record.providerFingerprint);
  if (provider === undefined) return false;
  return runtime.registry.activations.some((activation) => activation.providerId === record.providerId
    && activation.contributionId === record.contributionId
    && activation.fingerprint === record.providerFingerprint);
}

function proposalResponse(id: string, revision: string, prepared: ArtifactInteractionPreparedProposalV1): ArtifactInteractionProposalResponse {
  return {
    proposal: prepared.proposal,
    preview: {
      uri: `/api/artifacts/${encodeURIComponent(id)}/revisions/${revision}/interaction/proposals/${encodeURIComponent(prepared.proposal.proposalId)}/preview`,
      mediaType: prepared.preview.mediaType,
      label: prepared.preview.label,
      digest: prepared.preview.digest,
    },
  };
}

function proposalRecord(
  state: HarnessStudioState,
  id: string,
  revision: string,
  proposalId: string,
): ArtifactInteractionProposalState | undefined {
  const record = state.artifactInteractionProposals.get(proposalId);
  return record?.artifactId === id && record.revision === `sha256:${revision}` ? record : undefined;
}

function expireProposals(state: HarnessStudioState): void {
  const now = Date.now();
  for (const [proposalId, record] of state.artifactInteractionProposals) {
    if (record.expiresAtMs <= now) state.artifactInteractionProposals.delete(proposalId);
  }
}

export function assertArtifactInteractionWorkspace(value: ArtifactInteractionWorkspaceV1, artifactId: string, revision: string): ArtifactInteractionWorkspaceV1 {
  if (value.kind !== "HarnessStudioArtifactInteractionWorkspaceV1" || value.protocolVersion !== "1"
    || value.artifactId !== artifactId || value.revision !== revision || value.targets.length > MAX_TARGETS) {
    throw new Error("The Provider returned an invalid interaction workspace.");
  }
  boundedString(value.summary, "workspace.summary", 4_096);
  value.targets.forEach((entry, index) => target(entry, `workspace.targets[${String(index)}]`));
  boundedString(value.steering.kind, "workspace.steering.kind", 128);
  boundedString(value.steering.label, "workspace.steering.label", 256);
  boundedString(value.steering.placeholder, "workspace.steering.placeholder", 512, true);
  if (value.steering.agentInstruction !== undefined) boundedString(value.steering.agentInstruction, "workspace.steering.agentInstruction", 2_048);
  if (!Number.isInteger(value.steering.maxLength) || value.steering.maxLength < 1 || value.steering.maxLength > 8_192) {
    throw new Error("The Provider returned an invalid steering limit.");
  }
  return value;
}

function assertPrepared(value: ArtifactInteractionPreparedProposalV1, artifactId: string, revision: string): ArtifactInteractionPreparedProposalV1 {
  const proposal = value.proposal;
  if (proposal.kind !== "HarnessStudioArtifactInteractionProposalV1" || proposal.artifactId !== artifactId
    || proposal.expectedRevision !== revision || value.preview.bytes.byteLength > MAX_PREVIEW_BYTES) {
    throw new Error("The Provider returned an invalid Artifact proposal.");
  }
  boundedIdentifier(proposal.proposalId, "proposal.proposalId");
  target(proposal.target, "proposal.target");
  boundedString(proposal.summary, "proposal.summary", 4_096);
  boundedString(proposal.steering.kind, "proposal.steering.kind", 128);
  boundedString(proposal.steering.message, "proposal.steering.message", 8_192);
  if (proposal.actions.length > MAX_ACTIONS || proposal.verificationClaims.length > MAX_ACTIONS) throw new Error("The Artifact proposal is too large.");
  proposal.actions.forEach((action, index) => {
    boundedString(action.kind, `proposal.actions[${String(index)}].kind`, 128);
    boundedString(action.summary, `proposal.actions[${String(index)}].summary`, 1_024);
    if (action.target !== undefined) target(action.target, `proposal.actions[${String(index)}].target`);
  });
  proposal.verificationClaims.forEach((claim, index) => boundedString(claim, `proposal.verificationClaims[${String(index)}]`, 2_048));
  actor(proposal.proposedBy, "proposal.proposedBy");
  if (!Number.isFinite(Date.parse(proposal.preparedAt))) throw new Error("The Artifact proposal timestamp is invalid.");
  const { proposalDigest, ...content } = proposal;
  if (digest(proposalDigest, "proposal.proposalDigest") !== digestJson(content)) throw new Error("The Artifact proposal digest does not match its content.");
  boundedString(value.preview.mediaType, "preview.mediaType", 256);
  boundedString(value.preview.label, "preview.label", 256);
  if (digest(value.preview.digest, "preview.digest") !== digestBytes(value.preview.bytes)) throw new Error("The Artifact preview digest does not match its bytes.");
  return value;
}

function assertReceipt(
  value: ArtifactInteractionTransitionReceiptV1,
  proposal: ArtifactInteractionProposalV1,
  decision: "approve" | "reject",
  decisionId: string,
): ArtifactInteractionTransitionReceiptV1 {
  if (value.kind !== "HarnessStudioArtifactInteractionTransitionReceiptV1"
    || value.proposalId !== proposal.proposalId || value.proposalDigest !== proposal.proposalDigest
    || value.decision !== decision || value.decisionId !== decisionId || value.beforeRevision !== proposal.expectedRevision) {
    throw new Error("The Provider returned a receipt for a different decision.");
  }
  boundedIdentifier(value.transitionId, "receipt.transitionId");
  digest(value.afterRevision, "receipt.afterRevision");
  if (!["applied", "rejected", "stale", "failed"].includes(value.status)) throw new Error("The Provider returned an invalid transition status.");
  if (!["passed", "failed", "not-run"].includes(value.verification.status)) throw new Error("The Provider returned an invalid verification status.");
  boundedString(value.verification.summary, "receipt.verification.summary", 4_096);
  if (value.affectedTargets.length > MAX_ACTIONS || value.evidence.length > MAX_EVIDENCE || value.diagnostics.length > MAX_EVIDENCE) {
    throw new Error("The Provider receipt exceeds Host limits.");
  }
  value.affectedTargets.forEach((entry, index) => target(entry, `receipt.affectedTargets[${String(index)}]`));
  value.evidence.forEach((entry, index) => {
    boundedString(entry.kind, `receipt.evidence[${String(index)}].kind`, 128);
    boundedString(entry.label, `receipt.evidence[${String(index)}].label`, 1_024);
    if (entry.digest !== undefined) digest(entry.digest, `receipt.evidence[${String(index)}].digest`);
    if (entry.revision !== undefined) digest(entry.revision, `receipt.evidence[${String(index)}].revision`);
  });
  value.diagnostics.forEach((entry, index) => {
    boundedString(entry.code, `receipt.diagnostics[${String(index)}].code`, 128);
    boundedString(entry.message, `receipt.diagnostics[${String(index)}].message`, 2_048);
    if (!["info", "warning", "error"].includes(entry.severity)) throw new Error("The Provider returned an invalid diagnostic severity.");
  });
  if (value.status === "applied" && (value.afterRevision === value.beforeRevision
    || value.verification.status !== "passed" || value.evidence.length === 0)) {
    throw new Error("An applied receipt must advance revision with passed verification and evidence.");
  }
  if (value.status === "rejected" && (value.afterRevision !== value.beforeRevision || value.verification.status !== "not-run")) {
    throw new Error("A rejected receipt must preserve revision without running verification.");
  }
  if (!Number.isFinite(Date.parse(value.settledAt))) throw new Error("The Provider receipt timestamp is invalid.");
  return value;
}

function target(value: ArtifactInteractionTargetV1, path: string): ArtifactInteractionTargetV1 {
  boundedString(value.address, `${path}.address`, 8_192);
  boundedString(value.kind, `${path}.kind`, 128);
  boundedString(value.label, `${path}.label`, 1_024);
  if (value.description !== undefined) boundedString(value.description, `${path}.description`, 2_048);
  return value;
}

function actor(value: unknown, path: string, requiredKind?: ArtifactInteractionActorV1["kind"]): ArtifactInteractionActorV1 {
  const entry = exactObject(value, ["id", "kind", "label"], path);
  if (entry.kind !== "human" && entry.kind !== "agent" && entry.kind !== "system") throw new Error(`${path}.kind is invalid.`);
  if (requiredKind !== undefined && entry.kind !== requiredKind) throw new Error(`${path}.kind must be '${requiredKind}'.`);
  return {
    id: boundedIdentifier(entry.id, `${path}.id`),
    kind: entry.kind,
    label: boundedString(entry.label, `${path}.label`, 256),
  };
}

function exactObject(value: unknown, keys: readonly string[], path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${path} must be an object.`);
  const record = value as Record<string, unknown>;
  const allowed = new Set(keys);
  const unknownKey = Object.keys(record).find((key) => !allowed.has(key));
  if (unknownKey !== undefined) throw new Error(`${path}.${unknownKey} is not supported.`);
  const missing = keys.find((key) => !(key in record));
  if (missing !== undefined) throw new Error(`${path}.${missing} is required.`);
  return record;
}

function boundedString(value: unknown, path: string, maxLength: number, allowEmpty = false): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && value.trim() === "")) throw new Error(`${path} is invalid.`);
  return value;
}

function boundedIdentifier(value: unknown, path: string): string {
  const result = boundedString(value, path, 256);
  if (!/^[A-Za-z0-9][A-Za-z0-9:._-]*$/u.test(result)) throw new Error(`${path} is invalid.`);
  return result;
}

function digest(value: unknown, path: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`${path} is not a SHA-256 digest.`);
  return value as `sha256:${string}`;
}

function digestJson(value: unknown): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson(value)).digest("hex")}`;
}

function digestBytes(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function invalid(message: string): never {
  throw new Error(message);
}
