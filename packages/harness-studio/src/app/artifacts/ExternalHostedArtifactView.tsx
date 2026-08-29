import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import type {
  ArtifactDescriptor,
  ArtifactHostedIntentEnvelopeV1,
  ArtifactHostedIntentOutcomeV1,
  ArtifactHostedSelectionEventV1,
} from "../../contracts/artifact.js";
import type { ArtifactHostedIntentFailure, ArtifactSurfaceMountContext } from "./ArtifactSurface.js";

const MAX_INTENT_JSON_DEPTH = 16;
const MAX_INTENT_JSON_NODES = 2_048;
const MAX_INTENT_JSON_STRING_LENGTH = 8_192;
const MAX_INTENT_JSON_KEY_LENGTH = 256;
const MAX_INTENT_JSON_BYTES = 32_768;
const UNSAFE_INTENT_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/** Security boundary for server-hosted Provider documents. */
export function ExternalHostedArtifactView({ artifact, onSelection, onIntentOutcome, onIntentFailure }: ArtifactSurfaceMountContext): React.JSX.Element {
  const { t } = useTranslation("artifactViewers");
  const viewUri = artifact.renderer.viewUri;
  const frameRef = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    if (onSelection === undefined && onIntentOutcome === undefined) return;
    let current = true;
    let requestSequence = 0;
    const pending = new Set<AbortController>();
    const receive = (event: MessageEvent<unknown>): void => {
      const selection = hostedArtifactSelectionFromFrame(event, frameRef.current?.contentWindow ?? null, artifact);
      if (selection !== undefined) onSelection?.(selection);
      const intent = hostedArtifactIntentFromFrame(event, frameRef.current?.contentWindow ?? null, artifact);
      if (intent === undefined || onIntentOutcome === undefined) return;
      const request = ++requestSequence;
      const controller = new AbortController();
      pending.add(controller);
      void forwardHostedArtifactIntent(intent, artifact, controller.signal)
        .then((outcome) => {
          if (current && !controller.signal.aborted && request === requestSequence) onIntentOutcome(outcome);
        })
        .catch(() => {
          if (current && !controller.signal.aborted && request === requestSequence) {
            const failure: ArtifactHostedIntentFailure = {
              artifactId: artifact.id,
              revision: artifact.revision.id,
              bindingId: artifact.renderer.bindingId!,
              intentId: intent.intentId,
              requestSequence: request,
              message: "The Host rejected this Canvas intent. No action was executed.",
            };
            onIntentFailure?.(failure);
          }
        })
        .finally(() => pending.delete(controller));
    };
    window.addEventListener("message", receive);
    return () => {
      current = false;
      window.removeEventListener("message", receive);
      for (const controller of pending) controller.abort();
    };
  }, [artifact, onIntentFailure, onIntentOutcome, onSelection]);
  if (viewUri === undefined) {
    return <p className="artifact-status" role="alert">{t("external.noViewUri")}</p>;
  }
  return <iframe
    ref={frameRef}
    className="artifact-frame"
    title={t("external.previewTitle", { label: artifact.label })}
    src={viewUri}
    sandbox="allow-scripts"
    referrerPolicy="no-referrer"
  />;
}

/** Reject intent envelopes from unrelated or replaced iframe windows. */
export function hostedArtifactIntentFromFrame(
  event: Pick<MessageEvent<unknown>, "data" | "source">,
  frameWindow: Window | null,
  artifact: ArtifactDescriptor,
): ArtifactHostedIntentEnvelopeV1 | undefined {
  return frameWindow !== null && event.source === frameWindow
    ? hostedArtifactIntent(event.data, artifact)
    : undefined;
}

/** Decode only the exact, current Artifact/revision/binding intent envelope. */
export function hostedArtifactIntent(
  value: unknown,
  artifact: ArtifactDescriptor,
): ArtifactHostedIntentEnvelopeV1 | undefined {
  if (artifact.intent === undefined || artifact.renderer.bindingId === undefined || !isRecord(value)) return undefined;
  const keys = Object.keys(value).sort();
  if (keys.join("\0") !== ["artifactId", "bindingId", "intent", "intentId", "kind", "protocolVersion", "revision"].sort().join("\0")
    || value.kind !== "HarnessStudioArtifactHostedIntentV1" || value.protocolVersion !== "1"
    || value.artifactId !== artifact.id || value.revision !== artifact.revision.id
    || value.bindingId !== artifact.renderer.bindingId || !portableIdentifier(value.intentId)) return undefined;
  const intent = portableIntentJsonObject(value.intent);
  if (intent === undefined) return undefined;
  return {
    kind: value.kind,
    protocolVersion: value.protocolVersion,
    artifactId: value.artifactId,
    revision: value.revision,
    bindingId: value.bindingId,
    intentId: value.intentId,
    intent,
  };
}

/** POST one admitted envelope and reject a response for any replaced identity. */
export async function forwardHostedArtifactIntent(
  intent: ArtifactHostedIntentEnvelopeV1,
  artifact: ArtifactDescriptor,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<ArtifactHostedIntentOutcomeV1> {
  if (artifact.intent === undefined) throw new Error("The Artifact surface does not admit intents.");
  const response = await fetcher(artifact.intent.intentUri, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(intent),
    signal,
  });
  if (!response.ok) throw new Error(`Artifact intent admission failed (${response.status}).`);
  const value: unknown = await response.json();
  const outcome = hostedArtifactIntentOutcome(value, artifact, intent.intentId);
  if (outcome === undefined) throw new Error("Artifact intent admission returned a stale or invalid outcome.");
  return outcome;
}

/** Validate the Host outcome again at the async response boundary. */
export function hostedArtifactIntentOutcome(
  value: unknown,
  artifact: ArtifactDescriptor,
  intentId: string,
): ArtifactHostedIntentOutcomeV1 | undefined {
  if (artifact.renderer.bindingId === undefined || !isRecord(value) || !hasExactKeys(value, [
    "kind", "protocolVersion", "artifactId", "revision", "bindingId", "intentId", "actor", "recordedAt",
    "status", "execution", "effect", "replayed",
  ]) || !isRecord(value.actor) || !hasExactKeys(value.actor, ["id", "kind", "label"]) || !isRecord(value.effect)
    || value.kind !== "HarnessStudioArtifactHostedIntentOutcomeV1" || value.protocolVersion !== "1"
    || value.artifactId !== artifact.id || value.revision !== artifact.revision.id
    || value.bindingId !== artifact.renderer.bindingId || value.intentId !== intentId
    || value.status !== "recorded" || value.execution !== "not-executed" || typeof value.replayed !== "boolean"
    || typeof value.recordedAt !== "string" || !validIsoTime(value.recordedAt)
    || value.actor.id !== "system:hosted-artifact-surface" || value.actor.kind !== "system" || value.actor.label !== "Hosted Artifact surface"
    || !portableIdentifier(value.effect.selectionId)) return undefined;
  const target = intentTarget(value.effect.target);
  if (target === undefined) return undefined;
  const common = {
    kind: value.kind,
    protocolVersion: value.protocolVersion,
    artifactId: artifact.id,
    revision: artifact.revision.id,
    bindingId: artifact.renderer.bindingId,
    intentId,
    actor: { id: value.actor.id, kind: value.actor.kind, label: value.actor.label },
    recordedAt: value.recordedAt,
    status: value.status,
    execution: value.execution,
    replayed: value.replayed,
  } as const;
  if (value.effect.kind === "selection" && hasExactKeys(value.effect, ["kind", "selectionId", "target"])) {
    return { ...common, effect: { kind: "selection", selectionId: value.effect.selectionId, target } };
  }
  if (value.effect.kind !== "steering" || !hasExactKeys(value.effect, ["kind", "selectionId", "steeringId", "target", "steering"])
    || !portableIdentifier(value.effect.steeringId) || !isRecord(value.effect.steering)
    || !hasExactKeys(value.effect.steering, ["kind", "message"])
    || !boundedText(value.effect.steering.kind, 128) || !boundedText(value.effect.steering.message, 8_192)) return undefined;
  return {
    ...common,
    effect: {
      kind: "steering",
      selectionId: value.effect.selectionId,
      steeringId: value.effect.steeringId,
      target,
      steering: { kind: value.effect.steering.kind, message: value.effect.steering.message },
    },
  };
}

/** Reject observations from unrelated windows before decoding Provider data. */
export function hostedArtifactSelectionFromFrame(
  event: Pick<MessageEvent<unknown>, "data" | "source">,
  frameWindow: Window | null,
  artifact: ArtifactDescriptor,
): ArtifactHostedSelectionEventV1 | undefined {
  return frameWindow !== null && event.source === frameWindow
    ? hostedArtifactSelection(event.data, artifact)
    : undefined;
}

/** Resolve an iframe observation only against the exact Host-selected binding. */
export function hostedArtifactSelection(
  value: unknown,
  artifact: ArtifactDescriptor,
): ArtifactHostedSelectionEventV1 | undefined {
  if (artifact.interaction === undefined || artifact.renderer.bindingId === undefined
    || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const message = value as Record<string, unknown>;
  if (message.kind !== "HarnessStudioArtifactHostedSelectionV1" || message.protocolVersion !== "1"
    || message.artifactId !== artifact.id || message.revision !== artifact.revision.id
    || message.bindingId !== artifact.renderer.bindingId || typeof message.address !== "string"
    || message.address.trim() === "" || message.address.length > 8_192) return undefined;
  return {
    kind: message.kind,
    protocolVersion: message.protocolVersion,
    artifactId: message.artifactId,
    revision: message.revision,
    bindingId: message.bindingId,
    address: message.address,
  };
}

function intentTarget(value: unknown): ArtifactHostedIntentOutcomeV1["effect"]["target"] | undefined {
  if (!isRecord(value) || !hasExactKeys(value, ["address", "kind", "label"], ["description"])
    || !boundedText(value.address, 8_192) || !boundedText(value.kind, 128) || !boundedText(value.label, 512)
    || (value.description !== undefined && !boundedText(value.description, 2_048))) return undefined;
  return {
    address: value.address,
    kind: value.kind,
    label: value.label,
    ...(value.description === undefined ? {} : { description: value.description }),
  };
}

function portableIdentifier(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function boundedText(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim() !== "" && value.length <= maxLength;
}

function validIsoTime(value: string): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString() === value;
}

function hasExactKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.hasOwn(value, key)) && Object.keys(value).every((key) => allowed.has(key));
}

function portableIntentJsonObject(value: unknown): ArtifactHostedIntentEnvelopeV1["intent"] | undefined {
  if (!plainJsonObject(value)) return undefined;
  let nodes = 0;
  let jsonBytes = 0;
  const encoder = new TextEncoder();
  const ancestors = new WeakSet<object>();
  const consume = (bytes: number): boolean => {
    jsonBytes += bytes;
    return jsonBytes <= MAX_INTENT_JSON_BYTES;
  };
  const consumeString = (text: string): boolean => consume(encoder.encode(JSON.stringify(text)).byteLength);
  const visit = (candidate: unknown, depth: number): ArtifactHostedIntentEnvelopeV1["intent"][string] | undefined => {
    nodes += 1;
    if (nodes > MAX_INTENT_JSON_NODES || depth > MAX_INTENT_JSON_DEPTH) return undefined;
    if (candidate === null) return consume(4) ? candidate : undefined;
    if (typeof candidate === "boolean") return consume(candidate ? 4 : 5) ? candidate : undefined;
    if (typeof candidate === "string") {
      return candidate.length <= MAX_INTENT_JSON_STRING_LENGTH && consumeString(candidate) ? candidate : undefined;
    }
    if (typeof candidate === "number") {
      return Number.isFinite(candidate) && consume(JSON.stringify(candidate).length) ? candidate : undefined;
    }
    if (typeof candidate !== "object" || candidate === null || ancestors.has(candidate)) return undefined;
    if (Array.isArray(candidate)) {
      if (!consume(2)) return undefined;
      ancestors.add(candidate);
      const result: Array<ArtifactHostedIntentEnvelopeV1["intent"][string]> = [];
      for (const [index, entry] of candidate.entries()) {
        if (index > 0 && !consume(1)) return undefined;
        const normalized = visit(entry, depth + 1);
        if (normalized === undefined) return undefined;
        result.push(normalized);
      }
      ancestors.delete(candidate);
      return result;
    }
    if (!plainJsonObject(candidate)) return undefined;
    if (!consume(2)) return undefined;
    ancestors.add(candidate);
    const result: Record<string, ArtifactHostedIntentEnvelopeV1["intent"][string]> = Object.create(null) as Record<string, ArtifactHostedIntentEnvelopeV1["intent"][string]>;
    for (const [index, key] of Object.keys(candidate).entries()) {
      if (UNSAFE_INTENT_KEYS.has(key) || key.length > MAX_INTENT_JSON_KEY_LENGTH
        || (index > 0 && !consume(1)) || !consumeString(key) || !consume(1)) return undefined;
      const normalized = visit(candidate[key], depth + 1);
      if (normalized === undefined) return undefined;
      result[key] = normalized;
    }
    ancestors.delete(candidate);
    return result;
  };
  const normalized = visit(value, 0);
  if (!plainJsonObject(normalized)) return undefined;
  return normalized;
}

function plainJsonObject(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}
