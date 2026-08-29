import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION,
  canonicalArtifactInteractionJson,
  type ArtifactHostedIntentAdmissionV1,
  type ArtifactHostedIntentDestinationClaimV1,
  type ArtifactHostedIntentDestinationV1,
  type ArtifactHostedIntentEnvelopeV1,
  type ArtifactHostedIntentJsonV1,
  type ArtifactHostedIntentOutcomeV1,
  type ArtifactHostedIntentRuntimeImplementation,
  type ArtifactDescriptor,
  type ArtifactEntry,
  type ArtifactInteractionRuntimeImplementation,
  type ArtifactInteractionTargetV1,
  type ArtifactInteractionWorkspaceV1,
} from "../../contracts/artifact.js";
import { readJsonBody } from "../http-utils.js";
import type {
  ArtifactHostedIntentAdmissionState,
  HarnessStudioServerOptions,
  HarnessStudioState,
} from "../studio-types.js";
import {
  artifactIdForLabel,
  artifactSurfaceBindingId,
  digestHex,
} from "./registry/artifact-catalog.js";
import { artifactAuthorityId } from "./artifact-authority.js";
import { assertArtifactInteractionWorkspace } from "./interaction-routes.js";
import { respondArtifactJson, resolveArtifactRevisionPlugin } from "./routes.js";

const MAX_ACTIVE_INTENTS = 256;
const MAX_PENDING_INTENTS = 8;
const MAX_PENDING_INTENTS_PER_BINDING = 4;
const INTENT_TTL_MS = 10 * 60 * 1_000;
const INTENT_ADMISSION_TIMEOUT_MS = 2_000;
const MAX_JSON_DEPTH = 16;
const MAX_JSON_NODES = 2_048;
const MAX_JSON_STRING_LENGTH = 8_192;
const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const HOST_ACTOR = Object.freeze({
  id: "system:hosted-artifact-surface",
  kind: "system",
  label: "Hosted Artifact surface",
} as const);

type IntentErrorCode =
  | "INTENT_INVALID"
  | "INTENT_PROTOCOL_UNSUPPORTED"
  | "INTENT_ARTIFACT_UNAVAILABLE"
  | "INTENT_REVISION_STALE"
  | "INTENT_BINDING_STALE"
  | "INTENT_RUNTIME_UNAVAILABLE"
  | "INTENT_DESTINATION_UNAVAILABLE"
  | "INTENT_DESTINATION_STALE"
  | "INTENT_ID_CONFLICT"
  | "INTENT_CAPACITY_EXCEEDED"
  | "INTENT_PROVIDER_TIMEOUT"
  | "INTENT_INTERNAL"
  | "INTENT_PROVIDER_REJECTED";

class ArtifactHostedIntentError extends Error {
  constructor(
    readonly code: IntentErrorCode,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function admitArtifactHostedIntent(
  request: IncomingMessage,
  response: ServerResponse,
  state: HarnessStudioState,
  options: HarnessStudioServerOptions,
  artifactId: string,
  revision: string,
): Promise<void> {
  // Capture the live authority synchronously, before body streaming or Provider
  // discovery can yield to a Project switch.
  const authorityId = artifactAuthorityId(state);
  try {
    expireIntentAdmissions(state);
    const envelope = assertIntentEnvelope(await readIntentBody(request), artifactId);
    assertCurrentAuthority(state, authorityId);
    const resolved = await resolveCurrentIntentBinding(options, artifactId, revision, envelope);
    assertCurrentAuthority(state, authorityId);
    const key = intentAdmissionKey(authorityId, envelope);
    const requestDigest = digestIntentEnvelope(envelope);
    const retained = state.artifactIntentAdmissions.get(key);
    if (retained !== undefined) {
      if (retained.requestDigest !== requestDigest) {
        throw new ArtifactHostedIntentError(
          "INTENT_ID_CONFLICT",
          409,
          "The intent id is already bound to different input.",
        );
      }
      if (retained.failure !== undefined) {
        throw new ArtifactHostedIntentError(
          retained.failure.code as IntentErrorCode,
          retained.failure.status,
          retained.failure.message,
        );
      }
      const outcome = retained.outcome ?? await retained.promise;
      respondArtifactJson(response, 200, { ...outcome, replayed: true });
      return;
    }
    if (state.artifactIntentAdmissions.size >= MAX_ACTIVE_INTENTS) {
      throw new ArtifactHostedIntentError(
        "INTENT_CAPACITY_EXCEEDED",
        429,
        "Too many Artifact intents are retained.",
      );
    }
    const pending = [...state.artifactIntentAdmissions.values()].filter((record) => record.outcome === undefined && record.failure === undefined);
    if (pending.length >= MAX_PENDING_INTENTS
      || pending.filter((record) => record.authorityId === authorityId && record.bindingId === envelope.bindingId).length >= MAX_PENDING_INTENTS_PER_BINDING) {
      throw new ArtifactHostedIntentError(
        "INTENT_CAPACITY_EXCEEDED",
        429,
        "Too many Artifact intents are pending.",
      );
    }

    const createdAtMs = Date.now();
    const promise = admitAndRevalidate(options, state, authorityId, artifactId, revision, envelope, resolved);
    const record: ArtifactHostedIntentAdmissionState = {
      authorityId,
      artifactId,
      revision: envelope.revision,
      bindingId: envelope.bindingId,
      intentId: envelope.intentId,
      requestDigest,
      promise,
      createdAtMs,
      expiresAtMs: createdAtMs + INTENT_TTL_MS,
    };
    state.artifactIntentAdmissions.set(key, record);
    try {
      const outcome = await promise;
      record.outcome = outcome;
      respondArtifactJson(response, 201, outcome);
    } catch (error) {
      if (error instanceof ArtifactHostedIntentError && error.code === "INTENT_PROVIDER_TIMEOUT") {
        record.failure = { code: error.code, status: error.status, message: error.message };
      } else if (state.artifactIntentAdmissions.get(key) === record) {
        state.artifactIntentAdmissions.delete(key);
      }
      throw error;
    }
  } catch (error) {
    const failure = toIntentError(error);
    respondArtifactJson(response, failure.status, {
      kind: "HarnessStudioArtifactHostedIntentErrorV1",
      code: failure.code,
      message: failure.message,
    });
  }
}

async function admitAndRevalidate(
  options: HarnessStudioServerOptions,
  state: HarnessStudioState,
  expectedAuthorityId: string,
  artifactId: string,
  revision: string,
  envelope: ArtifactHostedIntentEnvelopeV1,
  initial: Awaited<ReturnType<typeof resolveCurrentIntentBinding>>,
): Promise<ArtifactHostedIntentOutcomeV1> {
  let admitted: ArtifactHostedIntentAdmissionV1;
  const controller = new AbortController();
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        reject(new ArtifactHostedIntentError(
          "INTENT_PROVIDER_TIMEOUT",
          504,
          "The selected Artifact Provider did not admit the intent in time.",
        ));
        controller.abort();
      }, INTENT_ADMISSION_TIMEOUT_MS);
    });
    admitted = assertIntentAdmission(await Promise.race([
      initial.runtime.admit(
        { entry: initial.entry, descriptor: initial.descriptor },
        { intentId: envelope.intentId, intent: envelope.intent, signal: controller.signal },
      ),
      deadline,
    ]), envelope.intentId);
  } catch (error) {
    if (error instanceof ArtifactHostedIntentError && error.code === "INTENT_PROVIDER_TIMEOUT") throw error;
    throw new ArtifactHostedIntentError(
      "INTENT_PROVIDER_REJECTED",
      422,
      "The selected Artifact Provider rejected the intent.",
    );
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }

  if (!initial.capabilities.includes("select")
    || (admitted.effect.kind === "steering" && !initial.capabilities.includes("steer"))) {
    throw new ArtifactHostedIntentError(
      "INTENT_PROVIDER_REJECTED",
      422,
      "The selected Artifact Provider did not declare the admitted intent capability.",
    );
  }

  // Admission can await Provider work. Re-resolve after it returns so a late
  // result cannot steer a replacement file, Provider, runtime, or binding.
  if (artifactAuthorityId(state) !== expectedAuthorityId) {
    throw new ArtifactHostedIntentError(
      "INTENT_BINDING_STALE",
      409,
      "The Artifact authority changed while admission was pending.",
    );
  }
  const currentOptions = {
    ...options,
    artifactDirectory: state.artifactDirectory,
    artifactPaths: state.artifactPaths,
  };
  await resolveCurrentIntentBinding(currentOptions, artifactId, revision, envelope, initial.identity);
  assertCurrentAuthority(state, expectedAuthorityId);

  const destination = admitted.destination === undefined
    ? undefined
    : await resolveIntentDestination(
      currentOptions,
      admitted.destination,
      admitted.effect.target,
    );
  await resolveCurrentIntentBinding(currentOptions, artifactId, revision, envelope, initial.identity);
  assertCurrentAuthority(state, expectedAuthorityId);

  const selectionId = `selection:${randomUUID()}`;
  const recordedEffect = admitted.effect.kind === "selection"
    ? { kind: "selection", selectionId, target: admitted.effect.target } as const
    : {
      kind: "steering",
      selectionId,
      steeringId: `steering:${randomUUID()}`,
      target: admitted.effect.target,
      steering: admitted.effect.steering,
    } as const;
  const outcome = {
    kind: "HarnessStudioArtifactHostedIntentOutcomeV1",
    protocolVersion: ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION,
    artifactId,
    revision: envelope.revision,
    bindingId: envelope.bindingId,
    intentId: envelope.intentId,
    actor: HOST_ACTOR,
    recordedAt: new Date().toISOString(),
    status: "recorded",
    execution: "not-executed",
    effect: recordedEffect,
    replayed: false,
  } as const;
  if (admitted.sourceTarget === undefined || destination === undefined) return outcome;
  return {
    ...outcome,
    sourceTarget: admitted.sourceTarget,
    destination,
    originRef: {
      kind: "HarnessStudioArtifactHostedIntentOriginRefV1",
      originId: `origin:${randomUUID()}`,
    },
  };
}

async function resolveIntentDestination(
  options: HarnessStudioServerOptions,
  claim: ArtifactHostedIntentDestinationClaimV1,
  expectedTarget: ArtifactInteractionTargetV1,
): Promise<ArtifactHostedIntentDestinationV1> {
  const artifactId = artifactIdForLabel(claim.artifactLabel);
  const initial = await resolveDestinationBinding(options, artifactId, claim);
  let workspace: ArtifactInteractionWorkspaceV1;
  try {
    workspace = assertArtifactInteractionWorkspace(
      await initial.runtime.inspect({ entry: initial.entry, descriptor: initial.descriptor }),
      artifactId,
      claim.revision,
    );
  } catch {
    throw new ArtifactHostedIntentError(
      "INTENT_DESTINATION_UNAVAILABLE",
      422,
      "The Host could not inspect the exact destination interaction workspace.",
    );
  }
  const target = workspace.targets.find((candidate) => candidate.address === expectedTarget.address);
  if (target === undefined || canonicalArtifactInteractionJson(target) !== canonicalArtifactInteractionJson(expectedTarget)) {
    throw new ArtifactHostedIntentError(
      "INTENT_DESTINATION_STALE",
      409,
      "The Provider-resolved target is not present in the exact destination workspace.",
    );
  }
  await resolveDestinationBinding(options, artifactId, claim, initial.identity);
  return {
    artifactId,
    artifactLabel: initial.descriptor.label,
    revision: initial.descriptor.revision.id,
    bindingId: initial.bindingId,
  };
}

interface ResolvedDestinationBinding {
  entry: ArtifactEntry;
  descriptor: ArtifactDescriptor;
  runtime: ArtifactInteractionRuntimeImplementation;
  bindingId: `sha256:${string}`;
  identity: string;
}

async function resolveDestinationBinding(
  options: HarnessStudioServerOptions,
  artifactId: string,
  claim: ArtifactHostedIntentDestinationClaimV1,
  expectedIdentity?: string,
): Promise<ResolvedDestinationBinding> {
  const resolved = await resolveArtifactRevisionPlugin(options, artifactId, digestHex(claim.revision));
  if ("error" in resolved) {
    throw new ArtifactHostedIntentError(
      resolved.status === 409 ? "INTENT_DESTINATION_STALE" : "INTENT_DESTINATION_UNAVAILABLE",
      resolved.status === 409 ? 409 : 404,
      resolved.status === 409
        ? "The destination Artifact has moved past the Provider-resolved revision."
        : "The Provider-resolved destination Artifact is unavailable.",
    );
  }
  if (resolved.descriptor.label !== claim.artifactLabel || resolved.descriptor.revision.id !== claim.revision) {
    throw new ArtifactHostedIntentError(
      "INTENT_DESTINATION_STALE",
      409,
      "The destination Artifact identity does not match the Provider claim.",
    );
  }
  const runtime = resolved.resolution.interaction;
  const bindingId = resolved.descriptor.renderer.bindingId;
  if (runtime === undefined || resolved.descriptor.interaction === undefined || bindingId === undefined
    || resolved.descriptor.renderer.status !== "ready") {
    throw new ArtifactHostedIntentError(
      "INTENT_DESTINATION_UNAVAILABLE",
      422,
      "The Provider-resolved destination is not an interactive Artifact binding.",
    );
  }
  const provider = resolved.resolution.provider;
  const identity = canonicalArtifactInteractionJson({
    bindingId,
    provider: provider === undefined ? null : {
      providerId: provider.providerId,
      contributionId: provider.contributionId,
      fingerprint: provider.fingerprint,
    },
    runtime: { id: runtime.id, version: runtime.version, protocolVersion: runtime.protocolVersion },
  });
  if (expectedIdentity !== undefined && expectedIdentity !== identity) {
    throw new ArtifactHostedIntentError(
      "INTENT_DESTINATION_STALE",
      409,
      "The destination interaction binding changed while the target was inspected.",
    );
  }
  return { entry: resolved.entry, descriptor: resolved.descriptor, runtime, bindingId, identity };
}

interface ResolvedIntentBinding {
  entry: ArtifactEntry;
  descriptor: ArtifactDescriptor;
  runtime: ArtifactHostedIntentRuntimeImplementation;
  capabilities: readonly string[];
  identity: string;
}

async function resolveCurrentIntentBinding(
  options: HarnessStudioServerOptions,
  artifactId: string,
  revision: string,
  envelope: ArtifactHostedIntentEnvelopeV1,
  expectedIdentity?: string,
): Promise<ResolvedIntentBinding> {
  const resolved = await resolveArtifactRevisionPlugin(options, artifactId, revision);
  if ("error" in resolved) {
    throw new ArtifactHostedIntentError(
      resolved.status === 409 ? "INTENT_REVISION_STALE" : "INTENT_ARTIFACT_UNAVAILABLE",
      resolved.status === 409 ? 409 : 404,
      resolved.status === 409
        ? "The Artifact has moved past the intent revision."
        : "The Artifact is unavailable.",
    );
  }
  if (envelope.revision !== resolved.descriptor.revision.id) {
    throw new ArtifactHostedIntentError(
      "INTENT_REVISION_STALE",
      409,
      "The intent revision does not match the current Artifact revision.",
    );
  }
  const bindingId = artifactSurfaceBindingId(resolved.resolution);
  if (envelope.bindingId !== bindingId || resolved.descriptor.renderer.bindingId !== bindingId) {
    throw new ArtifactHostedIntentError(
      "INTENT_BINDING_STALE",
      409,
      "The intent binding does not match the current Artifact surface.",
    );
  }
  const runtime = resolved.resolution.intent;
  const provider = resolved.resolution.provider;
  if (runtime === undefined || provider === undefined || resolved.resolution.surface.kind !== "external-hosted"
    || resolved.descriptor.renderer.status !== "ready" || !resolved.resolution.capabilities.includes("select")) {
    throw new ArtifactHostedIntentError(
      "INTENT_RUNTIME_UNAVAILABLE",
      404,
      "The Artifact surface does not admit intents.",
    );
  }
  const identity = canonicalArtifactInteractionJson({
    bindingId,
    providerId: provider.providerId,
    contributionId: provider.contributionId,
    fingerprint: provider.fingerprint,
    runtime: { id: runtime.id, version: runtime.version, protocolVersion: runtime.protocolVersion },
  });
  if (expectedIdentity !== undefined && expectedIdentity !== identity) {
    throw new ArtifactHostedIntentError(
      "INTENT_BINDING_STALE",
      409,
      "The Artifact intent binding changed while admission was pending.",
    );
  }
  return {
    entry: resolved.entry,
    descriptor: resolved.descriptor,
    runtime,
    capabilities: resolved.resolution.capabilities,
    identity,
  };
}

function assertIntentEnvelope(value: unknown, artifactId: string): ArtifactHostedIntentEnvelopeV1 {
  const body = exactObject(value, [
    "kind",
    "protocolVersion",
    "artifactId",
    "revision",
    "bindingId",
    "intentId",
    "intent",
  ], "intent envelope");
  if (body.kind !== "HarnessStudioArtifactHostedIntentV1") {
    throw invalid("The request is not an Artifact hosted intent envelope.");
  }
  if (body.protocolVersion !== ARTIFACT_HOSTED_INTENT_PROTOCOL_VERSION) {
    throw new ArtifactHostedIntentError(
      "INTENT_PROTOCOL_UNSUPPORTED",
      422,
      "The Artifact hosted intent protocol version is unsupported.",
    );
  }
  if (body.artifactId !== artifactId) {
    throw invalid("The intent artifact does not match the admission route.");
  }
  const intent = exactJsonObject(body.intent, "intent");
  return {
    kind: body.kind,
    protocolVersion: body.protocolVersion,
    artifactId,
    revision: digest(body.revision, "revision"),
    bindingId: digest(body.bindingId, "bindingId"),
    intentId: boundedIdentifier(body.intentId, "intentId"),
    intent,
  };
}

function assertIntentAdmission(value: unknown, intentId: string): ArtifactHostedIntentAdmissionV1 {
  const admission = exactObject(
    value,
    ["intentId", "effect", "sourceTarget", "destination"],
    "Provider intent admission",
    ["sourceTarget", "destination"],
  );
  if (admission.intentId !== intentId) {
    throw new ArtifactHostedIntentError(
      "INTENT_PROVIDER_REJECTED",
      422,
      "The Provider intent id does not match the admitted intent.",
    );
  }
  const effect = exactObject(admission.effect, ["kind", "target", "steering"], "Provider intent effect", ["steering"]);
  const target = targetValue(effect.target);
  const sourceTarget = admission.sourceTarget === undefined ? undefined : targetValue(admission.sourceTarget);
  const destination = admission.destination === undefined ? undefined : destinationClaim(admission.destination);
  if ((sourceTarget === undefined) !== (destination === undefined)) {
    throw invalid("A Provider-native target admission requires both sourceTarget and destination.");
  }
  if (effect.kind === "selection") {
    if (effect.steering !== undefined) throw invalid("A selection effect cannot contain steering.");
    const result = {
      intentId,
      effect: { kind: "selection", target },
    } as const;
    return sourceTarget === undefined ? result : { ...result, sourceTarget, destination: destination! };
  }
  if (effect.kind !== "steering") throw invalid("The Provider intent effect kind is unsupported.");
  const steering = exactObject(effect.steering, ["kind", "message"], "Provider intent steering");
  const result = {
    intentId,
    effect: {
      kind: "steering",
      target,
      steering: {
        kind: boundedString(steering.kind, "steering.kind", 128),
        message: boundedString(steering.message, "steering.message", 8_192),
      },
    },
  } as const;
  return sourceTarget === undefined ? result : { ...result, sourceTarget, destination: destination! };
}

function destinationClaim(value: unknown): ArtifactHostedIntentDestinationClaimV1 {
  const destination = exactObject(value, ["artifactLabel", "revision"], "Provider intent destination");
  return {
    artifactLabel: portableArtifactLabel(destination.artifactLabel, "destination.artifactLabel"),
    revision: digest(destination.revision, "destination.revision"),
  };
}

function portableArtifactLabel(value: unknown, label: string): string {
  const result = boundedString(value, label, 1_024);
  if (result.startsWith("/") || result.includes("\\") || result.includes("\u0000")
    || result.split("/").some((segment) => segment === "" || segment === "." || segment === "..")) {
    throw invalid(`${label} must be a portable Artifact label.`);
  }
  return result;
}

function targetValue(value: unknown): ArtifactInteractionTargetV1 {
  const target = exactObject(value, ["address", "kind", "label", "description"], "Provider intent target", ["description"]);
  return {
    address: boundedString(target.address, "target.address", 8_192),
    kind: boundedString(target.kind, "target.kind", 128),
    label: boundedString(target.label, "target.label", 512),
    ...(target.description === undefined
      ? {}
      : { description: boundedString(target.description, "target.description", 2_048) }),
  };
}

function exactJsonObject(value: unknown, label: string): { readonly [key: string]: ArtifactHostedIntentJsonV1 } {
  if (!isRecord(value) || Array.isArray(value)) throw invalid(`${label} must be a JSON object.`);
  let nodes = 0;
  const visit = (candidate: unknown, depth: number): ArtifactHostedIntentJsonV1 => {
    nodes += 1;
    if (nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw invalid(`${label} exceeds the JSON complexity limit.`);
    if (candidate === null || typeof candidate === "boolean") return candidate;
    if (typeof candidate === "string") {
      if (candidate.length > MAX_JSON_STRING_LENGTH) throw invalid(`${label} contains a string over the length limit.`);
      return candidate;
    }
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (Array.isArray(candidate)) return candidate.map((entry) => visit(entry, depth + 1));
    if (!isRecord(candidate)) throw invalid(`${label} must contain only finite JSON values.`);
    const result: Record<string, ArtifactHostedIntentJsonV1> = Object.create(null) as Record<string, ArtifactHostedIntentJsonV1>;
    for (const key of Object.keys(candidate)) {
      if (UNSAFE_JSON_KEYS.has(key)) throw invalid(`${label} contains an unsafe object key.`);
      result[key] = visit(candidate[key], depth + 1);
    }
    return result;
  };
  return visit(value, 0) as { readonly [key: string]: ArtifactHostedIntentJsonV1 };
}

function exactObject(
  value: unknown,
  keys: readonly string[],
  label: string,
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isRecord(value) || Array.isArray(value)) throw invalid(`${label} must be an object.`);
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw invalid(`${label} contains an unsupported field '${key}'.`);
  }
  for (const key of keys) {
    if (!optional.includes(key) && !Object.hasOwn(value, key)) throw invalid(`${label} is missing '${key}'.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function digest(value: unknown, label: string): `sha256:${string}` {
  if (typeof value !== "string" || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    throw invalid(`${label} must be a SHA-256 digest.`);
  }
  return value as `sha256:${string}`;
}

function boundedIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value)) {
    throw invalid(`${label} must be a bounded portable identifier.`);
  }
  return value;
}

function boundedString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maxLength) {
    throw invalid(`${label} must be a non-empty string of at most ${maxLength} characters.`);
  }
  return value;
}

function assertCurrentAuthority(state: HarnessStudioState, expected: string): void {
  if (artifactAuthorityId(state) !== expected) {
    throw new ArtifactHostedIntentError(
      "INTENT_BINDING_STALE",
      409,
      "The Artifact authority changed while admission was pending.",
    );
  }
}

function intentAdmissionKey(authorityId: string, envelope: ArtifactHostedIntentEnvelopeV1): string {
  return canonicalArtifactInteractionJson([
    authorityId,
    envelope.artifactId,
    envelope.revision,
    envelope.bindingId,
    envelope.intentId,
  ]);
}

function digestIntentEnvelope(envelope: ArtifactHostedIntentEnvelopeV1): string {
  return `sha256:${createHash("sha256").update(canonicalArtifactInteractionJson(envelope)).digest("hex")}`;
}

function expireIntentAdmissions(state: HarnessStudioState): void {
  const now = Date.now();
  for (const [key, record] of state.artifactIntentAdmissions) {
    if ((record.outcome !== undefined || record.failure !== undefined) && record.expiresAtMs <= now) {
      state.artifactIntentAdmissions.delete(key);
    }
  }
}

function invalid(message: string): ArtifactHostedIntentError {
  return new ArtifactHostedIntentError("INTENT_INVALID", 400, message);
}

function toIntentError(error: unknown): ArtifactHostedIntentError {
  if (error instanceof ArtifactHostedIntentError) return error;
  return new ArtifactHostedIntentError("INTENT_INTERNAL", 500, "The Host could not admit the Artifact intent.");
}

async function readIntentBody(request: IncomingMessage): Promise<unknown> {
  try {
    return await readJsonBody(request);
  } catch (error) {
    if (error instanceof SyntaxError) throw invalid("The intent body is not valid JSON.");
    if (error instanceof Error && error.message === "Request body is too large.") throw invalid(error.message);
    throw error;
  }
}
